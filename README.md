# FactoryOS
Fábrica autónoma de software con multiagentes IA para planificar, desarrollar, probar, corregir y entregar aplicaciones automáticamente.

<p align="center">
  <a href="public/images/captLanding.jpg"><img src="public/images/captLanding.jpg" alt="Landing de FactoryOS" width="250"></a>
  <a href="public/images/captApp1.jpg"><img src="public/images/captApp1.jpg" alt="Panel de FactoryOS en modo Modelo común" width="250"></a>
  <a href="public/images/captApp2.jpg"><img src="public/images/captApp2.jpg" alt="Panel de FactoryOS con modelos por agente" width="250"></a>
</p>

Repositorio: <https://github.com/jtarifap/FactoryOS>

## Requisitos

- Windows 10/11.
- Node.js 20.19+ (o 22.12+ recomendado), npm, Git y OpenCode CLI instalado y autenticado.
- Un modelo OpenCode capaz de editar archivos y usar herramientas. Comprueba `opencode --version` y `opencode run --help`.
- Instala dependencias con `npm install`.

## Iniciar

1. Ejecuta `npm install` en esta carpeta.
2. Abre una terminal y ejecuta `npm run dev`.
3. Visita **http://127.0.0.1:5173**: verás la landing. Pulsa **Empezar** para abrir el panel de FactoryOS en **/app.html**.
4. Crea un proyecto de prueba pequeno. Los proyectos se crean en `projects/`.

## Interfaz web

- `web/index.html` + `web/landing.css`: landing estática en `/`.
- `web/app.html` + `web/main.ts`: panel de FactoryOS en `/app.html`.
- Los botones **Empezar** y **Crear mi primer proyecto** de la landing abren el panel; el logo del panel vuelve a la landing.
- Tema claro/oscuro: botón sol/luna junto a **LOCAL / WINDOWS** en el panel y después de **GitHub** en la landing, con persistencia en `localStorage` y oscuro por defecto.
- `vite.config.ts` declara ambas páginas como entradas: `npm run build` genera `dist/index.html` y `dist/app.html`.

## Funcionamiento

- API Node.js/TypeScript en 127.0.0.1:4177.
- Interfaz Vite/TypeScript en 127.0.0.1:5173: `/` sirve la landing estática (`web/index.html` + `web/landing.css`) y `/app.html` el panel de FactoryOS (`web/main.ts`).
- Cola persistida en `data/jobs.json`, un trabajo a la vez.
- Worker con exclusión durante todo el ciclo y cancelación por árbol de procesos en todas las fases; un trabajo cancelado no se convierte en `failed` al cerrar. La cola conserva su orden.
- Factory-manager es el agente principal y predeterminado en OpenCode; es el único punto de entrada de la factoría y decide complejidad, stack y pipeline. Developer, QA, Diseñador, Auditoría de Seguridad y Delivery Manager son subagentes.
- En FactoryOS, el tipo de solicitud se selecciona explícitamente: **Proyecto** (predeterminado) o **Consulta**. Si se selecciona un directorio existente, se enruta como modificación al proyecto seleccionado.
- En Consulta, **Consultar** / **Escribe aquí tu consulta** es la entrada y **Respuestas** / **Respuestas a tus consultas** es la salida de solo lectura. Factory-manager responde directamente, sin crear directorios ni lanzar el pipeline.
- Al volver a Proyecto, se restauran Nombre, Solicitud y el selector Proyecto existente; los campos se limpian para evitar enviar la consulta anterior como solicitud de proyecto.
- Corrección automática: tras el pipeline se ejecuta una verificación técnica real (npm install/build/test). Si falla, Factory-manager coordina la corrección con el subagente adecuado, hasta 3 intentos. Si no se logra -> estado `Requiere intervención`.
- QA técnico: los proyectos de paquete deben tener al menos un script `build` o `test`; se ejecutan todos los configurados. Proyectos estáticos requieren `index.html` y se etiquetan como verificación superficial. El resultado automático se añade a `QA_REPORT.md` sin volcar salida cruda.
- Delivery Manager genera `ENTREGA.md` y `DELIVERY_REPORT.md` (con funcionalidades, dependencias, variables de entorno, instrucciones y problemas conocidos).
- Un proyecto solo queda `validated` si el pipeline termina correctamente y genera/actualiza un `DELIVERY_REPORT.md` reciente con las cinco secciones requeridas; las consultas terminan como `done`, sin artefactos de proyecto.
- Cada agente tiene su selector de modelo y botón **Probar**. Los modos **Independientes por agente** y **Modelo común** se guardan en `data/settings.json` y en el `model` del frontmatter OpenCode de cada agente.
- La configuración anterior había quedado en un solo modelo común; al recuperar el modo independiente, los seis agentes parten de ese modelo y se pueden personalizar por separado.
- La prueba del modelo usa el agente integrado `build` con una instrucción de responder solo OK, sin herramientas: no ejecuta los planes de los agentes de fábrica. El resultado se registra en el historial y estado del modelo.
- `autoApprove` (casilla): si esta marcada, los agentes ejecutan herramientas sin pedir permiso; desmarcada, OpenCode las rechaza y se informa en el log.
- Vista previa desde FactoryOS: arranca apps Node (puerto web asignado) o sirve estaticos desde `projects/`.
- El refresco automático conserva el proyecto seleccionado en **Vista previa y ZIP** y en el selector de modificación, mientras el proyecto siga existiendo.
- Los modelos se obtienen de `opencode models --verbose` y se prueban con `opencode run ... "Responde OK"` (timeout ~90s, con deteccion de cuota, credenciales, rate limit, timeout y retries abortadas cuando aparece un error real).
- Logs limitados y cancelación desde el panel. Las fases de proyecto tienen un timeout de 20 min; las consultas directas a Factory-manager, de 2 min.
- Cada trabajo muestra su consumo de tokens (entrada, salida, razonamiento y caché) y el coste estimado. El total incluye al Factory-manager y a los subagentes que hayan intervenido, y el panel muestra además el consumo global registrado.
- Para medir tokens sin mezclar trabajos, cada job usa una base SQLite aislada de OpenCode en `data/opencode/<job-id>.db`; si no se puede leer, se usa el respaldo de eventos `step_finish`. Al terminar un proyecto se escribe `factory/consumo-tokens.md` con el desglose.
- Se persiste `data/settings.json`, `data/jobs.json`, `data/model-tests.json` (historico de pruebas) y las bases de tokens en `data/opencode/`. Al reiniciar, jobs en ejecucion -> `failed` + lastError.
- Proyectos generados en `projects/<slug>-<id>/` con README, código, tests, dist, QA_REPORT, ENTREGA y DELIVERY_REPORT.
- Modificacion de proyectos existentes: endpoint `/api/jobs` acepta `directory` existente + checkpoint automático en `projects/<slug>-<id>-checkpoint`.
- Vista previa: arranca/detiene apps y sirve estáticos con MIME; niega archivos sensibles, traversal codificado y symlinks fuera del proyecto.
- ZIP: excluye `.git`, `node_modules`, `.cache` y logs. Antes de crear el archivo inspecciona nombres y fingerprints de alta confianza; si encuentra credenciales/llaves o no puede completar el escaneo, bloquea la descarga sin devolver valores secretos. Empaqueta un snapshot de los bytes inspeccionados. Límites: 20 000 entradas, 1 MiB por archivo y 50 MiB inspeccionados.
- El escaneo conservador puede bloquear proyectos con archivos legítimos grandes; no garantiza detectar todo formato de secreto. No empaquetes proyectos con credenciales.

## Endpoints principales

- /api/health - estado
- /api/settings - config persistida (GET/PUT) incluye autoApprove
- /api/models - lista de modelos con metadata
- /api/models/test - prueba individual de modelo
- /api/jobs - lista/crea/modifica trabajos (con delete/retry/cancel)
- /api/projects - listado de proyectos
- /api/projects/zip?directory=<slug> - descarga ZIP
- /api/preview/start|stop|status - gestion de apps generadas
- /preview-static/:slug/* - archivos estaticos protegidos

## Seguridad y persistencia

- Jobs cancelados/no terminados -> `failed` al reiniciar, con lastError human-readable.
- Las bases de tokens de `data/opencode/` contienen sesiones de OpenCode: permanecen en local, no se publican y se eliminan al borrar el trabajo.
- No se ejecutan comandos fuera de `projects/`.
- ZIP aplica detección por nombres y fingerprints de alta confianza; no es un escáner universal ni reemplaza la revisión del proyecto.
- No se hace push ni despliegue sin autorizacion.
- Procesos hijos se detienen en cancelacion mediante `taskkill /T /F`.

## Estructura y QA

- `web/`: landing (`index.html`, `landing.css`) y panel (`app.html`, `main.ts`, `style.css`).
- `server/`: API Node.js/TypeScript, ejecución de agentes y lectura del consumo de tokens.
- `shared/`: cálculo y formato de tokens compartido entre servidor y panel.
- `tests/`: pruebas de API, ZIP, preview y landing.
- `projects/`: proyectos generados por la fábrica.
- Cada proyecto incluye `README.md`, `package.json`, codigo, tests, `dist/`, `QA_REPORT.md`.
- `QA_REPORT.md` se genera con evidencias reales (build/test).
- `DELIVERY_REPORT.md` genera resumen de entrega.

## Advertencias

- Primera ejecucion no validada con tu proveedor/modelo OpenCode: hay que probar el CLI en tu Windows.
- En Windows el lanzamiento de archivos .cmd puede depender de la version de Node.
- Los permisos de OpenCode pueden requerir aprobacion interactiva si autoApprove esta desactivado.
- El estado `done`/`validated`/`needs_intervention` significa que se ha ejecutado el flujo sin errores de proceso; aun asi consulta QA_REPORT.md.
- No es seguro exponer esta API en Internet: sin autenticacion.
- No uses proyectos con credenciales en esta alpha.
- Al reiniciar, los trabajos en ejecucion pasan a `failed` y se puede usar `Reintentar`.
- README.md dentro de cada proyecto es la guia de uso.

## Prueba rapida

- `npm run build` verifica TypeScript y construye la landing y el panel en `dist/`.
- `npm test` ejecuta pruebas unitarias/regresión y handlers ZIP/preview con fixtures sintéticos; no llama a proveedores reales. En Windows, los tests de ZIP usan `tar.exe`.
- Para usar el agente principal en OpenCode, selecciona `factory-manager` en la lista de agentes o ejecuta `opencode run --agent factory-manager "tu petición"` desde el proyecto.
- `tests/landing.test.mjs` valida la landing: secciones, estilos y botones que abren `/app.html`.
- `curl http://127.0.0.1:4177/api/health` comprueba la API mientras esta en ejecucion.
- Crea un proyecto "hola mundo" desde FactoryOS y observa logs/QA report.
