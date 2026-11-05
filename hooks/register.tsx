// session-meter: tiempo de sesión y tokens de entrada/salida, sobre el prompt.
//
// Basado en el mod de ejemplo token-weather:
// misma banda AbovePrompt, pero con totales acumulados y actualización en vivo.
//
// session.start: lee cuándo empezó la sesión y arranca un reloj de 5 s que
//   redibuja la banda (el tiempo avanza aunque no haya turnos).
// turn.step: cada respuesta del modelo (principal y subagentes). Mientras llega
//   el streaming suma una estimación de salida (~4 caracteres por token); al
//   terminar suma el `usage` real que reporta la API y descarta la estimación.
//   Tras cada respuesta relee $.session.usage(): límites de uso y, en la
//   conversación principal, el contexto ocupado.
//   Al llegar al 90 % de contexto muestra un aviso, una vez hasta que baje.
// session.end (clear): /clear reinicia el contador.
// ui.render (AbovePrompt): a la izquierda un velocímetro con el % de contexto
//   (gauge.ts: braille en la terminal, SVG en la app); a la derecha dos líneas: tiempo y tokens, y contexto y límites
//   de uso del plan. En terminales angostas, solo las dos líneas.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Totals } from '../types'
import { COLS, gaugeRows, gaugeSvg } from './gauge'

const ZERO: Totals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 }

const totals = atom({ plugin: 'session-meter', key: 'totals' } as const, ZERO)
const startedAt = atom({ plugin: 'session-meter', key: 'startedAt' } as const, 0)
// En $.state para que una recarga del mod no repita el aviso.
const warned90 = atom({ plugin: 'session-meter', key: 'warned90' } as const, false)

const WARN_AT = 90

// Caracteres de salida recibidos en respuestas que aún están llegando.
// Variable del módulo: una recarga del mod la reinicia, lo cual es correcto.
let liveChars = 0

// Última lectura del contexto ocupado (las mismas cifras que la status line).
// Se vuelve a leer en session.start, así que no necesita sobrevivir recargas.
type ContextReading = { percent: number; tokens: number; window: number }
let context: ContextReading | null = null

// Ventanas de límite de uso del plan, según la última respuesta de la API.
// Se releen en session.start.
type LimitReading = { kind: string; percent: number; resetsAt: number | null }
let limits: LimitReading[] = []

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    if ((await read($, startedAt)) === 0) {
      const usage = await $.session.usage()
      await update($, startedAt, () => usage.startedAt || 0)
    }
    if ((await read($, startedAt)) === 0) {
      const now = await $.clock.now()
      await update($, startedAt, () => now)
    }

    await readUsage($, true)

    // Redibuja cada 5 segundos para que el tiempo transcurrido avance.
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    $.ui.invalidate('ui.render')

    return result
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    let mine = 0

    try {
      for await (const chunk of stream) {
        if (chunk.kind === 'text' || chunk.kind === 'thinking') {
          mine += chunk.text.length
          liveChars += chunk.text.length
          $.ui.invalidate('ui.render')
        } else if (chunk.kind === 'input') {
          mine += chunk.json.length
          liveChars += chunk.json.length
          $.ui.invalidate('ui.render')
        }
        yield chunk
      }

      const response = await stream.result
      const usage = response.usage
      if (usage) {
        await update($, totals, t => ({
          input: t.input + usage.input_tokens,
          cacheRead: t.cacheRead + usage.cache_read_input_tokens,
          cacheWrite: t.cacheWrite + usage.cache_creation_input_tokens,
          output: t.output + usage.output_tokens,
          requests: t.requests + 1,
        }))
      }
      // Los límites cambian con cualquier respuesta; el contexto es el de
      // la conversación principal, así que los subagentes no lo mueven.
      await readUsage($, !e.agentId)

      return response
    } finally {
      // La estimación de esta respuesta se reemplaza por el valor real.
      liveChars = Math.max(0, liveChars - mine)
      $.ui.invalidate('ui.render')
    }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, totals, () => ZERO)
      await update($, startedAt, () => now)
      liveChars = 0
      context = null
      await update($, warned90, () => false)
    }

    return next(e)
  })

  // Tras compactar, el contexto baja: se vuelve a leer.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await readUsage($, true)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const start = await read($, startedAt)
    const t = await read($, totals)
    const now = await $.clock.now()
    const elapsed = start > 0 ? now - start : 0
    const inputAll = t.input + t.cacheRead + t.cacheWrite
    const live = Math.round(liveChars / 4)

    const columns = e.props.bodyColumns ?? 80
    const isWide = columns >= 70
    // En la terminal el velocímetro es braille (4 filas, con el % dentro) y en terminales
    // angostas queda solo el texto; en la app y el editor es un SVG.
    const isTerminal = e.surface === 'terminal'
    const hasGauge = !isTerminal || columns >= 60

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui

    const info = (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="cyan" bold>
            {`⏱ ${duration(elapsed)}`}
          </Text>
          <Text>{`   ↓ entrada ${short(inputAll)}`}</Text>
          {isWide && t.cacheRead > 0 && (
            <Text dimColor>{` (caché ${short(t.cacheRead)})`}</Text>
          )}
          <Text>{`   ↑ salida ${short(t.output)}`}</Text>
          {live > 0 && <Text color="yellow">{` +~${short(live)} en curso`}</Text>}
          {isWide && <Text dimColor>{`   ${t.requests} resp.`}</Text>}
        </Box>
        <Box flexDirection="row">
          {context && !hasGauge && (
            <Text color={levelColor(context.percent)} bold>
              {`◔ contexto ${context.percent}%`}
            </Text>
          )}
          {context && (hasGauge || isWide) && (
            <Text dimColor>
              {hasGauge
                ? `contexto ${short(context.tokens)}/${short(context.window)}`
                : ` (${short(context.tokens)}/${short(context.window)})`}
            </Text>
          )}
          {limits.map((limit, i) => (
            <Text color={levelColor(limit.percent)}>
              {`${context || i > 0 ? '   ' : ''}${limitLabel(limit.kind)} ${limit.percent}%`}
              {limit.resetsAt !== null && isWide
                ? ` (reinicia en ${duration(Math.max(0, limit.resetsAt - now), true)})`
                : ''}
            </Text>
          ))}
        </Box>
      </Box>
    )

    if (!hasGauge) {
      return <Box paddingX={1}>{info}</Box>
    }

    const percent = context ? context.percent : null

    if (!isTerminal && 'Svg' in ui) {
      const { Svg } = ui

      return (
        <Box flexDirection="row" alignItems="center" paddingX={1}>
          <Svg
            source={gaugeSvg(percent)}
            alt={percent === null ? 'Contexto: sin lectura' : `Contexto al ${percent}%`}
            width={80}
            height={72}
          />
          <Box flexDirection="column" marginLeft={2}>
            {info}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="row" paddingX={1}>
        <Box flexDirection="column" width={COLS}>
          {gaugeRows(percent).map(row => (
            <Text>
              {row.map(seg =>
                seg.color ? (
                  <Text color={seg.color} bold={seg.bold}>
                    {seg.text}
                  </Text>
                ) : (
                  seg.text
                ),
              )}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center" marginLeft={2}>
          {info}
        </Box>
      </Box>
    )
  })
}

// Lee límites de uso y (si se pide) el contexto ocupado. La llamada
// simple de $.session.usage() no tiene costo: no pide desglose ni cuenta tokens.
async function readUsage($: EngineInterface, withContext: boolean): Promise<void> {
  try {
    const usage = await $.session.usage()

    limits = usage.rateLimits.map(limit => {
      const reset = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN

      return {
        kind: limit.kind,
        percent: Math.round(limit.percentUsed),
        resetsAt: Number.isNaN(reset) ? null : reset,
      }
    })

    const window = usage.context.window
    if (withContext && window) {
      const tokens = usage.context.tokens ?? 0
      const percent = Math.round(usage.context.percent ?? (tokens / window) * 100)
      context = { percent, tokens, window }
      await warnIfFull($, percent)
    }
    $.ui.invalidate('ui.render')
  } catch {
    // Sin lectura esta vez: la banda conserva la anterior.
  }
}

// Avisa una vez al cruzar el 90 %; al bajar (tras /compact) se rearma.
async function warnIfFull($: EngineInterface, percent: number): Promise<void> {
  const isWarned = await read($, warned90)

  if (percent >= WARN_AT && !isWarned) {
    await update($, warned90, () => true)
    $.ui.toast(
      `⚠ Contexto al ${percent}%: haz /compact o cierra la tarea antes de que se compacte solo.`,
      { timeoutMs: 15000 },
    )
  } else if (percent < WARN_AT && isWarned) {
    await update($, warned90, () => false)
  }
}

function limitLabel(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (kind === 'spend_limit') return 'gasto'

  return kind
}

function levelColor(percent: number): string {
  if (percent < 50) return 'green'
  if (percent < 75) return 'yellow'
  if (percent < 90) return 'magenta'

  return 'red'
}

function duration(ms: number, isCoarse = false): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (isCoarse) {
    // Para los reinicios: días y horas, u horas y minutos.
    const d = Math.floor(s / 86400)
    const hh = Math.floor((s % 86400) / 3600)
    const min = Math.floor((s % 3600) / 60)
    if (d > 0) return `${d}d ${hh}h`
    if (hh > 0) return `${hh}h ${min}m`

    return `${min}m`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')

  return h > 0 ? `${h}h ${mm}m ${ss}s` : `${m}m ${ss}s`
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`

  return String(n)
}
