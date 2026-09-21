# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

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

### Cambiado
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
