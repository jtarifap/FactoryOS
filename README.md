# FactoryOS
Fábrica autónoma de software con multiagentes IA para planificar, desarrollar, probar, corregir y entregar aplicaciones automáticamente.

## Requisitos

- Windows 10/11.
- Node.js 20.19+ (o 22.12+ recomendado), npm, Git y OpenCode CLI instalado y autenticado.
- Un modelo OpenCode capaz de editar archivos y usar herramientas. Comprueba `opencode --version` y `opencode run --help`.
- Instala dependencias con `npm install`.

## Iniciar

1. Ejecuta `npm install` en esta carpeta.
2. Abre una terminal y ejecuta `npm run dev`.
3. Visita **http://127.0.0.1:5173**.
4. Crea un proyecto de prueba pequeno. Los proyectos se crean en `projects/`.

## Funcionamiento

- API Node.js/TypeScript en 127.0.0.1:4177.
- Interfaz Vite/TypeScript en 127.0.0.1:5173.
- Cola persistida en `data/jobs.json`, un trabajo a la vez.
- Worker con exclusión durante todo el ciclo y cancelación por árbol de procesos en todas las fases; un trabajo cancelado no se convierte en `failed` al cerrar. La cola conserva su orden.
- Fases segun complejidad:
- brain: fase ligera que clasifica la solicitud como STATIC, SIMPLE o COMPLEJA.
- STATIC: developer (genera index.html + estilos + README) sin QA.
- SIMPLE: developer (implementa + tests) + qa-reviewer (valida).
- COMPLEJA: factory-manager (PLAN.md) + developer (siguendo plan) + qa-reviewer (valida).
- Correccion automatica: tras las fases, se ejecuta una verificacion tecnica real (npm install/build/test). Si falla, developer recibe el error concreto y se repite hasta 3 intentos. Si no se logra -> estado `Requiere intervencion`.
- QA técnico: los proyectos de paquete deben tener al menos un script `build` o `test`; se ejecutan todos los configurados. Proyectos estáticos requieren `index.html` y se etiquetan como verificación superficial. El resultado automático se añade a `QA_REPORT.md` sin volcar salida cruda.
- Delivery Manager: revisa la entrega y genera DELIVERY_REPORT.md (funcionalidades, dependencias, variables de entorno, instrucciones, problemas conocidos).
- Un trabajo solo queda `validated` si el agente dedicado termina correctamente y genera/actualiza en esa fase un `DELIVERY_REPORT.md` no vacío con las cinco secciones requeridas; fallos quedan `failed` con motivo.
- Los agentes se configuran por agente (factory-manager, developer, qa-reviewer, delivery-manager) con selector desplegable y prueba individual por modelo.
- El selector **Modelo común / fallback** también incluye **Probar** y tooltip al pasar el cursor o recibir foco. Todas las pruebas usan el modelo seleccionado con el agente integrado `build` y una instrucción de responder solo OK, sin herramientas: no ejecutan los planes de los agentes de fábrica ni cambian los modelos seleccionados. El resultado sí se registra en el historial y estado del modelo.
- `autoApprove` (casilla): si esta marcada, los agentes ejecutan herramientas sin pedir permiso; desmarcada, OpenCode las rechaza y se informa en el log.
- Vista previa desde DevFactory: arranca apps Node (puerto web asignado) o sirve estaticos desde `projects/`.
- El refresco automático conserva el proyecto seleccionado en **Vista previa y ZIP** y en el selector de modificación, mientras el proyecto siga existiendo.
- Los modelos se obtienen de `opencode models --verbose` y se prueban con `opencode run ... "Responde OK"` (timeout ~90s, con deteccion de cuota, credenciales, rate limit, timeout y retries abortadas cuando aparece un error real).
- Logs limitados y cancelacion desde el panel. Cada fase tiene un timeout de 20 min.
- Se persiste `data/settings.json`, `data/jobs.json`, `data/model-tests.json` (historico de pruebas). Al reiniciar, jobs en ejecucion -> `failed` + lastError.
- Proyectos generados en `projects/<slug>-<id>/` con README, codigo, tests, dist, QA_REPORT, DELIVERY_REPORT.
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
- No se ejecutan comandos fuera de `projects/`.
- ZIP aplica detección por nombres y fingerprints de alta confianza; no es un escáner universal ni reemplaza la revisión del proyecto.
- No se hace push ni despliegue sin autorizacion.
- Procesos hijos se detienen en cancelacion mediante `taskkill /T /F`.

## Estructura y QA

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

- `npm run build` verifica TypeScript y construye la interfaz.
- `npm test` ejecuta pruebas unitarias/regresión y handlers ZIP/preview con fixtures sintéticos; no llama a proveedores reales. En Windows, los tests de ZIP usan `tar.exe`.
- `curl http://127.0.0.1:4177/api/health` comprueba la API mientras esta en ejecucion.
- Crea un proyecto "hola mundo" desde DevFactory y observa logs/QA report.
