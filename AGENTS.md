# AGENTS.md

Guía para cualquier agente (o persona) que trabaje en este repo.

## Versionado (SemVer)

Este proyecto sigue [SemVer](https://semver.org/lang/es/) de forma estricta:
`MAJOR.MINOR.PATCH`.

- **PATCH** (`x.y.Z`): correcciones de bugs, ajustes de UI/copy, retoques de
  paleta/estilos, tuning de umbrales o configuración, refactors internos, o
  cualquier cambio que no agregue una capacidad nueva. **Por defecto, si hay
  duda, es PATCH.**
- **MINOR** (`x.Y.0`): funcionalidad nueva y compatible hacia atrás (un botón
  o endpoint nuevo, un dato nuevo que se empieza a mostrar/guardar, etc.).
- **MAJOR** (`X.0.0`): cambios incompatibles. Debería ser rarísimo en esta
  app — reservado para un cambio de arquitectura de fondo.

**Regla práctica:** una release puede mezclar varios cambios chicos; se
versiona según el de **mayor impacto** incluido, no según la cantidad de
archivos tocados. Si todos los cambios de esa release son cosméticos o
correctivos, es PATCH aunque toquen varios archivos.

Ejemplos de este mismo proyecto que en retrospectiva deberían haber sido
PATCH y se subieron como MINOR por error: cambiar la columna "Motor" por
"Duración" en el historial, recolorear el tema oscuro, ajustar los umbrales
de aviso de trabajo trabado (todos en v1.5.0/v1.7.0). No se renumeran
versiones ya publicadas — esta guía es para no repetir el error de acá en
adelante.

Cada bump de versión (`package.json`) va acompañado de una entrada en
[`CHANGELOG.md`](CHANGELOG.md) con el mismo número, formato
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).
