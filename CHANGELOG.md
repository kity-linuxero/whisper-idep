# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [2.1.0] - 2026-09-23

### Agregado
- Privacidad: los audios ya no se guardan. El archivo subido y el WAV
  convertido se borran apenas termina cada trabajo (bien, con error o
  cancelado); solo quedan las transcripciones para descargar. Al arrancar, la
  app borra cualquier audio que haya quedado en disco de versiones anteriores
  o de una caída. Requiere whisper-engine ≥ 1.0.1 para que el motor tampoco
  conserve el audio.

## [2.0.0] - 2026-09-22

Cambio de arquitectura: el motor de transcripción pasa a ser
[whisper-engine](https://github.com/kity-linuxero/whisper-engine), una API
REST por HTTP, en lugar del acceso por SSH con comandos forzados. **Requiere
cambiar la configuración** (ver "Migrar desde 1.x" en el README).

### Cambiado (incompatible)
- La comunicación con el motor es por HTTP con token Bearer
  (`ENGINE_URL`, `ENGINE_TOKEN`). Se eliminan `CT110_HOST`, `SSH_USER`,
  `SSH_KEY_PATH` y `KNOWN_HOSTS_PATH`; si siguen definidas y falta
  `ENGINE_URL`, la app no arranca y explica cómo migrar.
- La imagen Docker ya no incluye `openssh-client` ni `rsync`, y el compose ya
  no monta `secrets/`.

### Agregado
- La lista de modelos sale del motor (`GET /api/models`): el formulario ofrece
  los que el motor tenga instalados, no solo small/medium.
- Descarga de resultados en `.srt` y `.vtt` además de `.txt` y `.json`.
- `GET /api/health` informa si el motor está alcanzable y su versión.
- El idioma que se muestra en el resultado es el configurado en el motor.
- Instalador nativo para Debian (`install/app-install.sh`) e instalador de
  LXC para Proxmox VE (`install/lxc/whisper-app.sh`).
- Imagen publicada en GHCR (`ghcr.io/kity-linuxero/whisper-idep`) y licencia MIT.
- Cada trabajo guarda en qué motor corrió (`engine_id`), base para repartir
  trabajos entre varios motores en una versión futura.

### Corregido
- Cortes breves de red con el motor durante una transcripción ya no hacen
  fallar el trabajo: se tolera hasta ~1 minuto sin respuesta.

## [1.7.0] - 2026-09-21

### Cambiado
- Umbrales de aviso de "trabajo posiblemente trabado" subidos de 1/3
  minutos a 3/5 minutos — el aviso anterior saltaba demasiado pronto y
  generaba falsas alarmas en escenarios de contencion de CPU normal.

### Agregado
- Version desplegada visible en el pie de pagina, con link al CHANGELOG
  en GitHub. Se expone via `GET /api/health` (leyendo `package.json`) y el
  frontend la pide una vez al cargar.

## [1.6.0] - 2026-09-21

### Agregado
- Duracion real del audio (medida con `ffprobe` sobre el WAV convertido),
  guardada por separado de cuanto tardo la transcripcion en si.

### Cambiado
- La columna "Duracion" del historial (que generaba confusion: no se sabia
  si era la del audio o la de la transcripcion) se separa en dos columnas:
  "Audio" y "Tardo". Lo mismo en los chips del resultado.
- `duration_seconds` ahora mide solo la fase de transcripcion en el motor
  (antes incluia tambien la conversion con ffmpeg y la subida/bajada por
  rsync, mezclando tiempo de red con tiempo de computo real).
- Nueva columna `audio_duration_seconds` (migracion `005_audio_duration.sql`).

## [1.5.0] - 2026-09-21

### Cambiado
- La columna "Motor" (GPU/CPU) del historial se reemplaza por "Duración"
  (cuanto tardo realmente la transcripcion) — en el uso diario resulto mas
  util que saber que motor de computo se uso. El chip "Motor" del
  resultado tambien se saca, dejando Modelo/Idioma/Tiempo. El dato de
  compute_device se sigue guardando en la base para diagnostico, solo deja
  de mostrarse en la interfaz principal.
- Tema oscuro rediseñado: paleta neutra tradicional (grises, estilo
  GitHub/VS Code dark) en vez del verde institucional tiñendo todo el
  fondo/bordes/texto. El verde de marca queda solo como color de acento
  (botones, links, chips), igual que en el tema claro.
- Arreglado de paso un problema de contraste preexistente: el texto del
  estado "Listo" era verde oscuro sobre fondo verde oscuro en tema oscuro,
  casi ilegible.

## [1.4.0] - 2026-09-21

### Agregado
- **Deteccion de trabajos posiblemente trabados**: cada vez que el motor
  reporta una novedad real (cambio de fase o una linea de progreso nueva
  de `whisper-cli`), se guarda el momento exacto (`last_progress_at`). El
  frontend calcula cuanto hace de la ultima novedad y avisa: mas de 60s
  sin cambios ("puede ser contencion de CPU normal") o mas de 180s
  ("probablemente trabado, considerar cancelar"). Se ve tanto en la
  tarjeta de progreso como en el historial, asi que se puede notar sin
  tener que estar mirando el reloj o comparando manualmente contra cuanto
  dura habitualmente ese audio.
- Nueva columna `last_progress_at` (migracion `004_last_progress_at.sql`).

## [1.3.0] - 2026-09-21

### Agregado
- Identidad visual IDEP: paleta derivada del flyer `#enredATE'26` (verde
  menta sobre verde casi negro), logo y favicon propios, y pie de página
  "Desarrollado por IDEP" con enlace al sitio del equipo.
- Tema claro/oscuro conmutable desde el header, con la preferencia
  persistida en `localStorage` y arranque siguiendo `prefers-color-scheme`
  cuando no hay nada guardado.
- Zona de carga con arrastrar y soltar (drag & drop), además de la
  selección de archivo tradicional, con nombre y tamaño visibles.
- Botón "Actualizar" en la tarjeta de historial para refrescarlo a demanda.
- Captura de pantalla de la app en el README.

### Cambiado
- El botón de tema ahora muestra el ícono correcto (sol en claro, luna en
  oscuro) con una animación de rotación y fundido al cambiar — antes
  siempre mostraba el sol sin importar el tema activo.
- Interfaz responsiva de verdad: en celular el historial pasa de tabla a
  tarjetas apiladas, sin scroll horizontal ni texto cortado.
- `style.css` reescrito desde cero sobre variables CSS (tokens de color,
  tipografía, radios, sombra) en vez de valores hardcodeados.
- Metadatos del resultado (modelo, motor, idioma, tiempo) pasan de texto
  plano a chips individuales.
- La fase corta de la barra de progreso (`indeterminate`) ahora se anima
  con rayas diagonales en vez de quedar estática, respetando
  `prefers-reduced-motion`.
- Se mantiene el frontend sin dependencias de build ni CDN (sigue siendo
  HTML/CSS/JS plano) y la API no cambió.

### Notas
- Este PR se armó sobre una versión anterior del frontend (antes de
  cancelar/borrar de la v1.2.0); al integrarlo se reincorporaron el botón
  "Cancelar", las acciones "Cancelar"/"Borrar" del historial y el progreso
  en vivo (%) manteniendo el nuevo diseño visual.

## [1.2.0] - 2026-09-21

### Agregado
- **Cancelar trabajos**: `POST /api/jobs/:id/cancel` funciona tanto para
  trabajos todavia en cola como para trabajos activos (converting/
  uploading/transcribing) — mata el proceso correspondiente (ffmpeg o
  ssh/rsync) en el momento en que se pide.
- **Borrar del historial**: `DELETE /api/jobs/:id` ahora tambien cancela el
  trabajo si estaba activo y borra sus archivos locales (antes solo
  borraba la fila de la base de datos, dejando archivos huerfanos).
- Boton "Cancelar" en la vista de progreso y acciones "Cancelar"/"Borrar"
  por fila en el historial, con confirmacion antes de ejecutar.
- El historial ahora muestra el progreso (%) en vivo de trabajos activos,
  y se actualiza cada 4s (antes 10s) para que cancelar se sienta responsivo.
- Como el estado de cada trabajo vive en el servidor (no en el navegador),
  todo esto funciona desde cualquier sesion o dispositivo, no solo desde
  donde se subio el audio originalmente.
- Nuevo estado `cancelled` en la base de datos (migracion
  `003_cancelled_status.sql`, recrea la tabla `jobs` para ampliar el
  `CHECK` de `status`).

## [1.1.1] - 2026-09-21

### Arreglado
- Bug real encontrado en produccion: `whisper-cli` imprime la transcripcion
  completa a stdout ademas de escribirla a los archivos de salida; el
  cliente SSH del backend nunca leia ese stream, lo que impedia que Node
  emitiera el evento de cierre del proceso una vez terminado. Resultado:
  el trabajo terminaba de verdad en el motor (archivos de salida ya
  existian) pero la app se quedaba colgada para siempre en "transcribing"
  al 100%, sin avisar. Se arregla drenando stdout en todas las llamadas
  SSH/rsync (`ssh.stdout.resume()`).

## [1.1.0] - 2026-09-21

### Agregado
- Botones de descarga (`.txt` / `.json`) directamente en el resultado
  recién generado, además de los ya existentes en el historial.
- Indicador de motor de cómputo por trabajo (GPU/CPU), leyendo los logs
  propios de whisper.cpp/OpenVINO en vez de asumirlo — detecta el caso de
  fallback silencioso a CPU.
- Columna "Motor" en la tabla de historial.
- `README.md` y este `CHANGELOG.md`.
- `.env.example` con las variables de entorno esperadas por la app.

### Cambiado
- `docker-compose.yml` ya no tiene la IP interna del servidor ni otros
  valores de infraestructura hardcodeados: se leen de un `.env` local
  (no versionado) vía `env_file` e interpolación de variables.
- Nueva columna `compute_device` en la tabla `jobs` (migración
  `002_compute_device.sql`).

### Notas
- El idioma de transcripción ya estaba fijado a español (`-l es`) desde la
  implementación inicial, a nivel del script dispatcher del motor — se
  documenta explícitamente en el README y se muestra en la UI para que
  quede visible.

## [1.0.0] - 2026-09-20

### Agregado
- Implementación inicial: cola de trabajos asíncrona de un solo worker,
  progreso real vía `whisper-cli --print-progress` sobre SSH, selección de
  modelo (`small`/`medium`), historial persistente en SQLite (WAL).
- Comunicación con el motor whisper.cpp por SSH con usuario restringido y
  comando forzado (sin shell interactiva), transferencia de audio/resultados
  vía `rsync`/`rrsync`.
- Conversión de formato de entrada con `ffmpeg` antes de enviar al motor.
- Recuperación de trabajos interrumpidos por reinicio del contenedor
  (se marcan `failed`, sin reintento automático).
- Frontend propio sin dependencias de build (HTML/CSS/JS plano), con
  progreso de subida real vía XHR y polling de estado cada 1.5s.
- Seguridad delegada por completo al reverse proxy externo (sin login
  propio en la app).
