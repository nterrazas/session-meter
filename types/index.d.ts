// Totales de tokens de la sesión, sumados de cada respuesta del modelo.
export type Totals = {
  /** Tokens de entrada sin caché. */
  input: number
  /** Tokens de entrada leídos de la caché. */
  cacheRead: number
  /** Tokens de entrada escritos en la caché. */
  cacheWrite: number
  /** Tokens de salida generados. */
  output: number
  /** Respuestas del modelo contadas. */
  requests: number
}

declare module 'claude-code' {
  interface PluginState {
    'session-meter': {
      totals: Totals
      /** Inicio de la sesión, en milisegundos desde epoch (0 = sin leer). */
      startedAt: number
      /** Ya se avisó que el contexto llegó al 90 % (se rearma al bajar). */
      warned90: boolean
    }
  }
}
