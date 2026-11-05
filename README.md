# session-meter

Mod de Claude Code que dibuja una banda sobre el prompt: un velocímetro con el %
de contexto ocupado y, al lado, el tiempo de la sesión, los tokens consumidos y los
límites de uso del plan, actualizándose en tiempo real.

En la terminal:

```text
  ⣠⡶⠶⠿⠶⢶⣄    ⏱ 12m   ↓ entrada 125.4k (caché 110.2k)   ↑ salida 8.2k   14 resp.
⢠⡾⠋  ⢸  ⠙⢷⡄  contexto 68.2k/200k   5h 42% (reinicia en 2h 10m)   7d 18% (reinicia en 4d 6h)
⣼⡇   ⣼   ⢸⣧
⢸⡇  34%  ⢸⡇
```

- **Velocímetro**: arco con degradé de verde a rojo, aguja roja y el % dentro. En la terminal se dibuja en braille; en la app de escritorio, VS Code y el móvil, como imagen (SVG). En terminales de menos de 60 columnas se oculta y queda `◔ contexto N%` en texto.
- **⏱ tiempo**: desde que empezó la sesión (`$.session.usage().startedAt`); avanza cada minuto (mientras llega una respuesta se redibuja más seguido). No se redibuja más seguido porque en algunas terminales (Cursor, VS Code) cada redibujo borra la selección del mouse.
- **↓ entrada**: suma de los tokens de entrada de cada respuesta del modelo (sin caché + leídos de caché + escritos en caché). Entre paréntesis, la parte leída de caché.
- **↑ salida**: suma de los tokens de salida reportados por la API.
- **+~N en curso**: estimación (~4 caracteres por token) de la respuesta que se está recibiendo; al terminar se reemplaza por el valor real.
- **contexto**: tokens ocupados de la ventana de contexto (mismas cifras que la status line). Se actualiza tras cada respuesta del hilo principal y después de compactar.
- **Aviso al 90 %**: cuando el contexto llega al 90 % aparece un aviso arriba a la derecha (15 s) sugiriendo `/compact`. Sale una sola vez y se vuelve a activar cuando el contexto baja del 90 %.
- **5h / 7d**: cuánto llevas usado de las ventanas de límite del plan (5 horas y semanal) y en cuánto se reinician. Aparecen después de la primera respuesta, que es cuando la API los informa; con clave de API puede que no aparezcan.
- **resp.**: cantidad de respuestas del modelo contadas (incluye subagentes).

Basado en el mod de ejemplo `token-weather`.

## Instalación

En una sesión de Claude Code, en la terminal:

```text
/plugin install session-meter --marketplace nterrazas/session-meter
```

Responde `y` para agregar el marketplace y elige el alcance (usuario recomendado). Desde una terminal normal:

```bash
claude plugin install session-meter --marketplace nterrazas/session-meter
```

Reinicia la sesión para que se cargue.

### Desde una copia local

```bash
claude plugin marketplace add ~/claude-mods
claude plugin install session-meter@nterrazas-mods --scope user
```

O desde dentro de Claude Code: `/plugin install session-meter@nterrazas-mods`.

Para probarlo en una sola sesión sin instalar: `claude --plugin-dir ~/claude-mods/session-meter`.

## Desactivar / desinstalar

```bash
claude plugin disable session-meter     # se puede volver a activar con enable
claude plugin uninstall session-meter   # lo quita por completo
```

Dentro de una sesión, la banda también se puede contraer con `ctrl+x ctrl+a` o el `[-]` de la derecha.

## Limitaciones

- Los tokens se cuentan desde que el mod se cargó en el proceso; en una sesión reanudada no incluye lo consumido antes.
- `/clear` reinicia tiempo y tokens.
- La banda `AbovePrompt` se dibuja solo en terminal y escritorio; otro mod que use la misma banda compite por ella.
