# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [1.2.0] - 2026-09-21

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
