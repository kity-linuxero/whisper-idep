# whisper-app

Frontend propio de transcripción de audio/video en español. El motor es
[whisper-engine](https://github.com/kity-linuxero/whisper-engine): una API REST
sobre [whisper.cpp](https://github.com/ggml-org/whisper.cpp) que corre en CPU o
en una iGPU Intel vía OpenVINO, en el mismo servidor o en otro. Pensado para reuniones
largas (30-40+ minutos), donde una API síncrona clásica se topa con timeouts
de proxies, tuneles y clientes HTTP.

## Características

- **Cola de trabajos asíncrona**: subís el archivo y el servidor responde al
  instante con un `id` de trabajo. Ninguna conexión HTTP queda abierta
  durante los minutos que dura la transcripción — así se evita cualquier
  timeout de proxy/CDN/cliente.
- **Progreso real, no estimado**: se lee directamente la salida de
  `whisper-cli --print-progress` en el motor remoto, no un cálculo por
  tiempo transcurrido.
- **Selección de modelo**: el formulario ofrece los modelos que tenga
  instalados el motor. Por ejemplo, `small` (rápido, ~3x tiempo real) o
  `medium` (más preciso, mejor con cruces de voces, ~5x más lento).
- **Idioma fijado en el motor** (español por defecto): se fuerza el idioma
  para que no haga auto-detección en audios con ruido o tramos poco claros.
- **Duración de cada transcripción**: se muestra en el resultado y en el
  historial cuánto tardó realmente, así se puede comparar entre modelos o
  detectar si algo anda más lento de lo esperado.
- El motor de cómputo (GPU/CPU) sigue detectándose y guardándose (leyendo
  los propios logs de whisper.cpp/OpenVINO) para diagnóstico, aunque ya no
  se muestra en la interfaz principal — la duración resultó más útil en el
  uso diario.
- **Descarga de resultados**: la transcripción se baja en `.txt`, `.json`
  (con segmentos y timestamps) o como subtítulos `.srt`/`.vtt`, tanto desde
  el resultado recién generado como desde el historial.
- **Historial persistente**: todos los trabajos (archivo, modelo, motor,
  estado, fecha, duración) quedan en SQLite y sobreviven reinicios del
  contenedor.
- **Un solo trabajo a la vez**: el motor tiene una sola CPU/iGPU, así que
  la cola nunca corre dos transcripciones en paralelo.
- **Cancelar y borrar**: cualquier trabajo (en cola o corriendo) se puede
  cancelar, y cualquier trabajo terminado se puede borrar del historial
  (elimina también sus archivos). Como el estado vive en el servidor, se ve
  y se puede accionar desde cualquier sesión/dispositivo que abra la página,
  no solo desde donde se subió el audio.
- **Aviso de trabajos posiblemente trabados**: si un trabajo activo pasa
  3 minutos sin ninguna novedad real del motor, se avisa (posible
  contención de CPU); a los 5 minutos, aviso más fuerte (probablemente
  trabado, conviene cancelar).
- El pie de página muestra la versión desplegada, con link al
  [CHANGELOG](https://github.com/kity-linuxero/whisper-idep/blob/main/CHANGELOG.md)
  en GitHub.
- **Recuperación ante caídas**: si el contenedor se reinicia con un trabajo
  a medio camino, ese trabajo queda marcado `failed` en vez de colgado
  para siempre; no hay reintentos automáticos.
- **Identidad IDEP**: desarrollado por [IDEP Informática](https://www.idepba.com.ar/idep-informatica/).

## Interfaz

Frontend propio sin dependencias de build ni CDN (HTML/CSS/JS plano,
servido directo desde `src/public/`). Tema claro/oscuro conmutable desde
el header (la preferencia se guarda en `localStorage`), interfaz
responsiva — el historial pasa a tarjetas apiladas en celular — y
estética IDEP (paleta del flyer `#enredATE'26`, logo y favicon propios).

## Captura de pantalla

![Transcriptor de audio IDEP](docs/screenshot.png)

## Arquitectura

```
Usuario (navegador) ──HTTPS──▶ reverse proxy (auth) ──▶ whisper-app (Node/Express + SQLite)
                                                                │
                                                     HTTP + token Bearer
                                                                ▼
                                                  whisper-engine (whisper.cpp, CPU o iGPU)
```

> **La app no tiene autenticación propia.** Se delega por completo al reverse
> proxy que la expone a internet (usuario/contraseña vía Access List, Basic
> Auth, SSO, o lo que corresponda). No expongas este puerto directamente a
> internet sin ese proxy delante.

- La conversión de formato (mp3/m4a/video/etc. → WAV 16 kHz mono) ocurre
  acá, con `ffmpeg`, antes de mandar el audio al motor. Así se sube menos
  data que con un video y se conoce la duración del audio.
- Con el motor se habla por su API REST: subir el WAV (`POST /v1/jobs`),
  consultar el progreso cada 2 s, bajar los resultados y borrar el trabajo
  del motor. El historial y los resultados quedan en la app.

## Ciclo de vida de un trabajo

`queued → converting → uploading → transcribing → done | failed | cancelled`

## Instalación

Primero hace falta un motor
[whisper-engine](https://github.com/kity-linuxero/whisper-engine) andando, con su
URL y su token. Su README explica cómo instalarlo en LXC o en Docker. Después,
cualquiera de estas opciones:

### Opción A: LXC en Proxmox VE

En el **host** de Proxmox, como root:

```bash
git clone https://github.com/kity-linuxero/whisper-idep.git
cd whisper-idep
./install/lxc/whisper-app.sh --engine-url http://192.168.1.50:8080 --engine-token <token> \
    --ip 192.168.1.60/24 --gw 192.168.1.1
```

Crea un CT Debian 13 unprivileged (2 cores, 1 GB de RAM, 8 GB de disco; se
cambia con `--cores`, `--memory` y `--disk`). Adentro instala la app como servicio
systemd y verifica que llegue al motor. Otros flags: `--ctid`, `--hostname`,
`--storage`, `--bridge`, `--vlan`, `--dns`, `--port`, `--yes`.

### Opción B: Debian 12/13 existente

```bash
git clone https://github.com/kity-linuxero/whisper-idep.git
cd whisper-idep
sudo ./install/app-install.sh --engine-url http://192.168.1.50:8080 --engine-token <token>
```

| | |
|---|---|
| App | `/opt/whisper-app` |
| Historial (SQLite) y archivos | `/var/lib/whisper-app` |
| Config | `/etc/whisper-app/app.env` |
| Servicio | `systemctl status whisper-app` · `journalctl -u whisper-app -f` |

Volver a correr el script actualiza el código y conserva la config y el historial.

### Opción C: Docker

```bash
git clone https://github.com/kity-linuxero/whisper-idep.git
cd whisper-idep
cp .env.example .env    # completar ENGINE_URL y ENGINE_TOKEN
docker compose up -d    # usa la imagen de GHCR; con --build la construye localmente
```

### Todo en uno (motor + app en la misma máquina, Docker)

El repo del motor trae `docker-compose.full.yml`, que levanta los dos juntos. Ver
[whisper-engine → Todo en uno](https://github.com/kity-linuxero/whisper-engine#todo-en-uno-motor--frontend).

## Variables de entorno

Ver [`.env.example`](.env.example). En Docker van en `.env`; en la instalación
nativa, en `/etc/whisper-app/app.env`. Ninguno de los dos se versiona.

| Variable           | Descripción                                              |
|--------------------|----------------------------------------------------------|
| `ENGINE_URL`       | URL base de whisper-engine (ej. `http://10.0.0.5:8080`). |
| `ENGINE_TOKEN`     | Token Bearer del motor.                                  |
| `ENGINE_POLL_MS`   | Cada cuánto se consulta el progreso (default 2000).      |
| `PORT` / `HOST`    | Puerto e IP donde escucha la app.                        |
| `BIND_HOST`        | (Docker) IP del host donde se publica el puerto.         |
| `DB_PATH`          | Ruta del archivo SQLite.                                 |
| `UPLOADS_DIR`      | Directorio de subidas y resultados.                      |
| `MAX_UPLOAD_MB`    | Límite de tamaño de archivo subido.                      |
| `MAX_JOB_MINUTES`  | Timeout duro por trabajo de transcripción.               |

`MAX_UPLOAD_MB` tiene que ser coherente con el límite del motor y con el del
reverse proxy (`client_max_body_size` en nginx).

## Migrar desde 1.x

La 1.x hablaba con el motor por SSH (usuario restringido con comandos forzados
y rsync). Desde la 2.0 el motor es whisper-engine por HTTP:

1. Instalar [whisper-engine](https://github.com/kity-linuxero/whisper-engine)
   (puede ser un LXC nuevo, en paralelo al motor viejo) y anotar su URL y token.
2. En el `.env` de la app, borrar `CT110_HOST`, `SSH_USER`, `SSH_KEY_PATH` y
   `KNOWN_HOSTS_PATH`, y agregar `ENGINE_URL` y `ENGINE_TOKEN`.
3. Actualizar y reiniciar (`docker compose up -d --build`). Al arrancar, una
   migración de la base adapta la tabla de trabajos. **El historial y los
   resultados de la 1.x se conservan**; los trabajos viejos se siguen bajando
   en `.txt`/`.json`.
4. Una vez verificado, se puede borrar `secrets/` (la clave SSH) y, en el
   servidor del motor viejo, el usuario restringido y su `authorized_keys`.

## API

- `GET /api/models` — modelos disponibles en el motor → `{default, models}`.
- `POST /api/jobs` — multipart (`audio`, `model`) → `201 {id, status}`.
- `GET /api/jobs?limit=&offset=` — historial.
- `GET /api/jobs/:id` — estado/progreso de un trabajo (para polling).
- `GET /api/jobs/:id/result?format=txt|json|srt|vtt` — descarga del resultado
  (`409` si el trabajo no terminó).
- `POST /api/jobs/:id/cancel` — cancela un trabajo en cola o en curso
  (`409` si ya terminó). El estado pasa a `cancelled` de forma asíncrona,
  apenas el proceso que se está matando termina de salir.
- `DELETE /api/jobs/:id` — borra un trabajo del historial (si estaba activo,
  se cancela primero) y elimina sus archivos locales.
- `GET /api/health` — healthcheck; incluye `engine: {ok, version}`.

## Versiones

Ver [`CHANGELOG.md`](CHANGELOG.md) para el historial de versiones y
[`AGENTS.md`](AGENTS.md) para la política de versionado.

## Licencia

[MIT](LICENSE).
