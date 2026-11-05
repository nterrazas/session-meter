// Velocímetro de la banda. En la terminal se dibuja en braille: cada celda es
// un carácter de 2×4 puntos, así el arco queda fino. Arco de 240° con degradé
// verde → amarillo → naranja → rojo, aguja roja y el porcentaje dentro, entre
// las dos patas del arco. En la app y el editor se usa gaugeSvg.
//
// Los puntos braille son casi cuadrados, así que el arco se ve redondo.

export const COLS = 11
export const ROWS = 4

export type Segment = { text: string; color: string | null; bold?: boolean }

const W = COLS * 2 // puntos de ancho
const H = ROWS * 4 // puntos de alto
const CX = (W - 1) / 2
const CY = 10.5
const R_OUT = 10.6
const R_IN = 8.4
const NEEDLE = 7.2
const START = 210 // grados, abajo a la izquierda (0 %)
const SWEEP = 240 // hasta abajo a la derecha (100 %)

export const NEEDLE_COLOR = '#ff3b30'
const IDLE_COLOR = '#6b6b6b'

// Bit de cada punto dentro de un carácter braille, por [columna][fila].
const BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

const STOPS: Array<[number, [number, number, number]]> = [
  [0, [0x3f, 0xc3, 0x4a]],
  [0.45, [0xe8, 0xd8, 0x2e]],
  [0.72, [0xf2, 0x8c, 0x28]],
  [1, [0xe0, 0x30, 0x2b]],
]

/** Color del arco en la fracción f (0 a 1). */
export function gradient(f: number): string {
  const x = Math.min(1, Math.max(0, f))
  for (let i = 1; i < STOPS.length; i++) {
    const [f1, c1] = STOPS[i]!
    const [f0, c0] = STOPS[i - 1]!
    if (x <= f1) {
      const t = (x - f0) / (f1 - f0)
      const mix = c0.map((v: number, k: number) => Math.round(v + (c1[k]! - v) * t))

      return '#' + mix.map((v: number) => v.toString(16).padStart(2, '0')).join('')
    }
  }

  return '#e0302b'
}

/** Fracción del arco (0 a 1) en la que cae el punto, o null si queda fuera. */
function arcFraction(x: number, y: number): number | null {
  let angle = (Math.atan2(CY - y, x - CX) * 180) / Math.PI
  if (angle < -90) angle += 360
  const f = (START - angle) / SWEEP

  return f >= 0 && f <= 1 ? f : null
}

/**
 * Las ROWS filas del velocímetro con la aguja en `percent` (null: sin lectura,
 * sin aguja). Cada fila es una lista de tramos de un mismo estilo; la última
 * lleva el porcentaje entre las patas del arco.
 */
export function gaugeRows(percent: number | null): Segment[][] {
  // Lienzo de W × H puntos: fracción del arco (-1 si no hay arco) y aguja.
  const ring: number[] = Array(W * H).fill(-1)
  const needle: boolean[] = Array(W * H).fill(false)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - CX, y - CY)
      if (d >= R_IN && d <= R_OUT) {
        const f = arcFraction(x, y)
        if (f !== null) ring[y * W + x] = f
      }
    }
  }

  if (percent !== null) {
    const p = Math.min(100, Math.max(0, percent))
    const rad = ((START - (SWEEP * p) / 100) * Math.PI) / 180
    for (let t = 0; t <= NEEDLE; t += 0.25) {
      const x = Math.round(CX + t * Math.cos(rad))
      const y = Math.round(CY - t * Math.sin(rad))
      if (y >= 0 && y < H && x >= 0 && x < W) needle[y * W + x] = true
    }
  }
  // Eje de la aguja.
  for (const i of [10 * W + 10, 10 * W + 11, 11 * W + 10, 11 * W + 11]) needle[i] = true

  const label = percent === null ? '--%' : `${Math.round(percent)}%`
  const labelFrom = Math.floor((COLS - label.length) / 2)
  const labelColor = percent === null ? IDLE_COLOR : gradient(percent / 100)

  const rows: Segment[][] = []
  for (let row = 0; row < ROWS; row++) {
    const cells: Segment[] = []
    for (let col = 0; col < COLS; col++) {
      let bits = 0
      let hasNeedle = false
      let sum = 0
      let count = 0
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const x = col * 2 + dx
          const y = row * 4 + dy
          const bit = BITS[dx]![dy]!
          const f = ring[y * W + x]!
          if (needle[y * W + x]) {
            bits |= bit
            hasNeedle = true
          } else if (f >= 0) {
            bits |= bit
            sum += f
            count++
          }
        }
      }
      const color = hasNeedle
        ? percent === null
          ? IDLE_COLOR
          : NEEDLE_COLOR
        : count > 0
          ? gradient(sum / count)
          : null
      cells.push({ text: bits ? String.fromCharCode(0x2800 + bits) : ' ', color })
    }

    // El porcentaje, dentro del velocímetro entre las patas del arco.
    if (row === ROWS - 1) {
      for (let i = 0; i < label.length; i++) {
        cells[labelFrom + i] = { text: label[i]!, color: labelColor, bold: true }
      }
    }

    // Junta celdas vecinas del mismo estilo en un solo tramo.
    const merged: Segment[] = []
    for (const cell of cells) {
      const last = merged[merged.length - 1]
      if (last && last.color === cell.color && !!last.bold === !!cell.bold) last.text += cell.text
      else merged.push({ ...cell })
    }
    rows.push(merged)
  }

  return rows
}

/**
 * El mismo velocímetro en SVG, para la app de escritorio, VS Code y el móvil,
 * donde el braille se ve con puntos sueltos. Arco con degradé, marcas cada
 * 10 %, aguja roja y el porcentaje abajo.
 */
export function gaugeSvg(percent: number | null): string {
  const cx = 60
  const cy = 60
  const r = 44
  const at = (f: number, radius: number): [number, number] => {
    const rad = ((START - SWEEP * f) * Math.PI) / 180

    return [cx + radius * Math.cos(rad), cy - radius * Math.sin(rad)]
  }
  const n = (v: number) => v.toFixed(1)
  const [x0, y0] = at(0, r)
  const [x1, y1] = at(1, r)

  let ticks = ''
  for (let i = 0; i <= 10; i++) {
    const major = i % 5 === 0
    const [ax, ay] = at(i / 10, major ? 30 : 33)
    const [bx, by] = at(i / 10, 37)
    ticks += `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}" stroke="#8a8a8a" stroke-width="${major ? 2.2 : 1.4}" stroke-linecap="round"/>`
  }

  let needle = ''
  let label = '--%'
  let labelColor = '#8a8a8a'
  if (percent !== null) {
    const p = Math.min(100, Math.max(0, percent)) / 100
    const [nx, ny] = at(p, 34)
    needle =
      `<line x1="${cx}" y1="${cy}" x2="${n(nx)}" y2="${n(ny)}" stroke="${NEEDLE_COLOR}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="${NEEDLE_COLOR}"/>`
    label = `${Math.round(percent)}%`
    labelColor = gradient(p)
  } else {
    needle = `<circle cx="${cx}" cy="${cy}" r="6" fill="#8a8a8a"/>`
  }

  const stops = STOPS.map(([f, c]) => {
    const hex = '#' + c.map((v: number) => v.toString(16).padStart(2, '0')).join('')

    return `<stop offset="${f}" stop-color="${hex}"/>`
  }).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 108" width="120" height="108">` +
    `<defs><linearGradient id="g" x1="${n(x0 - 6)}" y1="0" x2="${n(x1 + 6)}" y2="0" gradientUnits="userSpaceOnUse">${stops}</linearGradient></defs>` +
    `<path d="M ${n(x0)} ${n(y0)} A ${r} ${r} 0 1 1 ${n(x1)} ${n(y1)}" fill="none" stroke="url(#g)" stroke-width="10" stroke-linecap="round"/>` +
    ticks +
    needle +
    `<text x="${cx}" y="100" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="17" font-weight="700" fill="${labelColor}">${label}</text>` +
    `</svg>`
  )
}
