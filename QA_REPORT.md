# QA Report - FactoryOS 2.0

## README: capturas del panel (2026-11-04)

- Se retiran las tres capturas antiguas (`public/images/captLanding.jpg`, `captApp1.jpg`, `captApp2.jpg`), que mostraban el panel sin menu lateral y ya solo se referenciaban desde el README. Los ficheros se eliminaron por quedar huerfanos (262 KB).
- Se incorporan las seis capturas actuales de `web/design/capturas_design/`: Dashboard, Nuevo proyecto, Trabajos, Vista previa, Ajustes y Dashboard con error. Cada una enlaza a su version completa y lleva su pie de foto.
- Las rutas se verifican contra el arbol del repositorio: las seis existen.
- Texto actualizado con los cambios de las dos ultimas entregas: menu lateral y Dashboard (secciones, hash de la vista, cabecera con `taridev`), vista previa (eleccion de script, `npm install` previo, deteccion del puerto real, argumentos extra, logs en error y URL absoluta para el caso estatico) y el proxy `/preview-static` de Vite. Tambien se corrige la linea que afirmaba que el panel avisaba de los proveedores sin conectar en Ajustes, porque ese aviso se elimino.
- `npm test`: **182/182 PASS**. `npm run build`: **PASS**.

## Vista previa: la app no se ve en el frame (2026-11-03)

- Sintoma: al seleccionar un proyecto y pulsar **Arrancar**, el frame mostraba la web de FactoryOS en lugar de la app del proyecto.
- Causa 1 (routing): la URL de la vista previa estatica era relativa (`/preview-static/<proyecto>/`), asi que el iframe la pedia al origen del panel (Vite, 5173), donde Vite responde con su propia `index.html` (la landing). Medido: via 5177 el titulo era "FactoryOS - fabrica autonoma de software"; via 4177 (la API) era "Jorge Tarifa - Dev & IA". El proxy de Vite solo reenviaba `/api`. Correccion: la API devuelve ahora una URL absoluta a su propio origen y Vite proxya tambien `/preview-static`.
- Causa 2 (puerto): se asignaba un puerto libre pero no se garantizaba que la app lo usara. `vite` ignora la variable `PORT` y solo acepta `--port`, y un `node dist/server.js` puede fijar el suyo. Medido: la app escuchaba en 3000 y la API devolvia `http://localhost:60605/`, un puerto sin nadie detras. Correccion: se deduce el puerto real de la salida del proceso, se comprueban los puertos habituales si la app es silenciosa y se verifica la URL antes de responder. El tiempo de espera bajo de 62 s a 3 s.
- Causa 3 (script y BOM): solo se aceptaban `start`, `dev` y `preview`, y un `package.json` con marca BOM de Windows devolvia "package.json invalido". Correccion: `server/preview-plan.ts` elige entre `dev`, `start`, `preview`, `serve` y `watch`, y parsea el JSON tolerando el BOM.
- Causa 4 (dependencias): sin `node_modules` la app no arrancaba y no se decia por que. Correccion: se ejecuta `npm install` antes de arrancar y se informa si falla.
- Causa 5 (Detener): el boton **Detener** no mataba la app. `killTree` lanzaba `taskkill /T /F` y acto seguido `proc.kill()`, que mataba el envoltorio antes de que taskkill pudiera recorrer el arbol; el proceso `node` quedaba huerfano y seguia escuchando. Se comprueba que el `server/job-coordinator.ts` ya resolvia esa misma carrera y se aplica alli el mismo patron.
- Mejoras de la vista: campo **Argumentos extra** para pasar flags al script, enlace **Abrir la app en una pestana nueva**, y los logs del proceso visibles cuando la app no arranca.
- `npm test`: **182/182 PASS** (nuevos ficheros `tests/preview-plan.test.mjs` y `tests/preview-kill.test.mjs`).
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- Validacion real: app de prueba con script `start` que ignora `PORT` y escucha en 3000 -> la API devuelve `http://127.0.0.1:3000/` en 3 s y **Detener** libera el puerto sin dejar procesos. App con script `dev` -> recibe `--port` y los argumentos extra (`node server.js --host 127.0.0.1 --port 49205`). Proyecto estatico -> el iframe muestra la landing del proyecto ("Construyo el futuro, linea a linea") y no la de FactoryOS. Sin errores de consola.

## Menu lateral y Dashboard (2026-11-03)

- Referencia de diseño: `web/design/2. Dashboard` (maqueta y PNG exportados). Se replican sus valores (sidebar de 220 px, items con `padding:10px 12px`, activo en `#ff9f1c` con barra izquierda de 2 px, contenido con `padding:28px 32px`) sobre las variables de tema ya existentes, por lo que el tema claro funciona sin duplicar colores.
- Estructura: cabecera de 52 px a ancho completo (logo, `taridev`, toggle de tema y chip `Local / Windows` a la derecha) y cuerpo con menú lateral fijo + zona de contenido. Se retira el `max-width:1100px` del panel anterior, que quedaba corto con el menú.
- Menú: Dashboard · Nuevo proyecto · Trabajos · Vista previa · Ajustes. La vista activa se marca en el menú y se guarda en el hash (`#/dashboard`), de modo que sobrevive a una recarga y se puede enlazar.
- Dashboard con datos reales de `/api/jobs`: tarjetas Activos (queued+running), Finalizados (done+validated), Con error (failed+needs_intervention) y Coste IA del mes (suma de `tokens.cost` de los trabajos actualizados este mes). La tabla lista Trabajo, Estado, Fase, Coste IA y Actualizado.
- Decision: donde la maqueta pintaba una barra de progreso se muestra la fase real del trabajo. OpenCode no expone un porcentaje y una barra estimada seria un dato inventado.
- Decision: el coste se mantiene en dolares con `formatCost()` para que cuadre con el resto del panel; la maqueta usaba euros.
- `npm test`: **170/170 PASS** (nuevos ficheros `tests/navigation.test.mjs` y `tests/dashboard.test.mjs`; `tests/common-model.test.mjs` ampliado con el DOM minimo del menu y la navegacion).
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- Validacion real en navegador: las 5 vistas conmutan sin errores de consola, el item activo se marca, la cabecera muestra `taridev` junto al toggle y al chip, el Dashboard pinta las 4 tarjetas y la tabla con los 6 trabajos reales, y a 1280 px las tarjetas caben en una fila sin desbordar la tabla.
- Red de seguridad antes de empezar: tag `backup/pre-sidebar-2026-11-03`, rama `backup/pre-sidebar-2026-11-03` y copia `backups/factoryos-pre-sidebar-2026-11-03.zip` (excluye `node_modules`, `.git`, `dist`, `data`, `projects`).

## Modelos de OpenRouter en el panel (2026-11-03)

- Sintoma: el proveedor `openrouter` no aparecia en el desplegable de modelos aunque su API estuviera activa en la app Desktop de OpenCode.
- Causa 1 (parseo): el parser de `opencode models --verbose` solo aceptaba ids `provider/model`. Los ids de OpenRouter tienen un segmento mas y caracteres `~` y `:` (`openrouter/openai/gpt-4.1`, `openrouter/~anthropic/claude-opus-latest`, `openrouter/thinkingmachines/inkling:free`), asi que se descartaban y ademas contaminaban el JSON del modelo anterior. Medido sobre la salida real: 171 bloques, 164 correctos, 7 corruptos, 0 de openrouter.
- Causa 2 (validacion): la validacion de ids de `agent-model-config` rechazaba esos ids, por lo que la seleccion no podia guardarse ni escribirse en los agentes.
- Causa 3 (credenciales): el CLI que lanza FactoryOS lee `~/.local/share/opencode/auth.json`, mientras la app Desktop guarda las claves en su base SQLite (`credential`). El CLI no ve las de la app Desktop hasta conectarlas con `opencode auth login --provider <id>`. FactoryOS no lee ni copia ningun valor de credencial.
- Cambios: `server/model-list.ts` (parser tolerante a bloques, ids multi-segmento, catalogo con prefijo de proveedor y sin modelos deprecados), `server/agent-model-config.ts` (validacion compartida), `server/opencode-providers.ts` + `/api/models/providers` (proveedores conectados en OpenCode, solo identificadores), `web/model-select.ts` + `web/main.ts` (agrupacion por proveedor, modelo configurado que no esta en el catalogo visible como "no disponible", aviso de proveedores sin conectar).
- `npm test`: **155/155 PASS** (nuevos ficheros `tests/model-list.test.mjs`, `tests/opencode-providers.test.mjs`, `tests/model-select.test.mjs` y ampliacion de `tests/agent-model-config.test.mjs`).
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- Validacion real local: `/api/models` devuelve 543 modelos de 7 proveedores, 364 de `openrouter` y 0 deprecados; el desplegable del panel muestra los grupos `openrouter:364`; guardar `openrouter/openai/gpt-4.1-nano` escribe ese `model:` en los seis agentes; la prueba de conexion contra ese modelo responde `ok: true` en 9,3 s. La configuracion original (`ollama-cloud/beam`) quedo restaurada.
- Limitacion: `groq` y `minimax-coding-plan` siguen conectados solo en la app Desktop; el panel los avisa con el comando `opencode auth login --provider <id>` para conectarlos en el CLI.

## Consumo de tokens por trabajo (2026-11-03)

- Cada trabajo usa una base SQLite aislada de OpenCode en `data/opencode/<job-id>.db`; al terminar cada fase se leen las sesiones del Factory-manager y de todos sus subagentes.
- El total se acumula en `job.tokens` y se muestra en la tarjeta del trabajo y en el resumen global del panel.
- Si la base no está disponible (por ejemplo, versión de Node sin `node:sqlite`), se usa el respaldo de eventos `step_finish` del flujo JSON de OpenCode.
- Al finalizar un proyecto se escribe `factory/consumo-tokens.md` con el desglose y el coste estimado; el ZIP lo incluye.
- Se eliminó `OPENCODE_DB=:memory:` global: las pruebas y listados de modelos conservan una base en memoria, mientras los trabajos persisten su base aislada.
- cancelar/borrar un trabajo elimina su base de tokens; un reintento conserva el consumo acumulado de los intentos anteriores.
- `npm test`: **132/132 PASS** (incluye parser, base SQLite con sesiones padre/hija, cableado del servidor y render de tokens en el panel).
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- Validación real local: una consulta creada por `/api/jobs` terminó `done` con `tokens.total = 7135` (entrada 7038, salida 97) y el trabajo eliminado borró su base aislada.

## Factory-manager, modelos y consultas (2026-11-02)

- Factory-manager es agente `primary` y `default_agent`; los cinco especialistas son `subagent`.
- FactoryOS enruta las consultas directamente a Factory-manager y dirige los proyectos nuevos/modificaciones al pipeline que él decida.
- El panel tiene seis selectores de modelo y conserva los modos independiente/común; la selección se persiste en `data/settings.json` y en el frontmatter de cada agente.
- La configuración activa se consultó por API: modo independiente, seis agentes y versión de migración 2.
- `opencode agent list` confirma Factory-manager como `primary` y los cinco especialistas como `subagent`.
- Prueba visual sin enviar consulta: Proyecto es el tipo inicial; en Consulta aparecen «Consultar», «Escribe aquí tu consulta», «Respuestas» y «Respuestas a tus consultas», y se oculta el selector de proyecto. Al volver a Proyecto se restauran los campos y el selector.
- `npm test`: **119/119 PASS**.
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- `git diff --check`: sin errores; solo avisos de conversión LF/CRLF de Windows.
- No se hizo una ejecución de proyecto/consulta con proveedor real durante esta revisión.

Validación anterior: 2026-10-31. Alcance: validación completa del proyecto principal (FactoryOS) y revisión del proyecto `responde-a-las-preguntas-a0c4a165`.

## Resultado

- `npm test`: **88/88 PASS**.
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- `git diff --check`: sin errores; Git muestra únicamente avisos de conversión LF/CRLF de Windows en `web/main.ts`.
- No se ejecutó generación con proveedor real ni se leyeron credenciales.

## Proyecto `responde-a-las-preguntas-a0c4a165`

Este proyecto contiene únicamente un archivo `respuestas.txt` con 8 líneas de respuestas clasificadas (constelación, sandalia, Segre, archipiélago, dulzura, trampolín, asco, Alcanar). No tiene `package.json`, scripts de build, tests ni dependencias. Es un archivo de datos estático sin proceso de compilación ni pruebas automatizadas.

## Prioridad 1 — worker y cancelación

- Lease excluye workers solapados durante todo el ciclo; los nuevos trabajos continúan en cola FIFO.
- Se registran procesos de validación de modelos, consultas, agentes y npm por ID de trabajo. Cancelar termina el árbol de procesos y deja el estado `cancelled`.
- El lease no se libera hasta que los hijos registrados cierran, incluso después de timeout. Esto evita avanzar de fase o trabajo mientras siga vivo un hijo.
- Endpoint de cancelación solo acepta trabajos `queued` o `running`.
- Retry devuelve 409 mientras el worker anterior todavía mantiene el registro del job. En Windows, `taskkill /T /F` termina el árbol antes de señalizar el padre; un test crea y termina una pareja real de procesos.
- Pruebas usan procesos simulados y verificaciones de integración del cableado; no se lanzó un trabajo OpenCode completo con proveedor.

## Prioridad 2 — criterios de QA

- Proyecto estático requiere `index.html` y se reporta como verificación superficial.
- Proyecto con `package.json` requiere `build` o `test`; se ejecutan todos los configurados, en orden build/test. Sin controles, con JSON inválido o con fallo de comando, QA falla.
- Evidencia automatizada estructurada se anexa a `QA_REPORT.md` sin reemplazar notas existentes ni copiar salida cruda.
- `index.html` debe ser un archivo regular; los resultados QA son estructurados y una salida de compilador no puede fingir resultados.

## Prioridad 3 — entrega

- Añadido `.opencode/agents/delivery-manager.md`.
- `validated` exige proceso exitoso y un `DELIVERY_REPORT.md` actualizado en esa fase, no vacío y con cinco secciones completas. En caso contrario, el trabajo queda `failed` con motivo/log.
- El informe anterior no se borra antes de ejecutar el agente.
- El estado previo del informe (mtime/tamaño/inode) se compara con el posterior; una fecha futura preexistente no prueba que el agente lo haya generado.

## Prioridad 4 — seguridad

- ZIP escanea nombres y patrones de secreto de alta confianza; un hallazgo o límite excedido bloquea el ZIP y reporta solo rutas, nunca valores.
- Se empaqueta un snapshot con los mismos bytes que se inspeccionaron, no el directorio modificable original. Variantes en mayúsculas de rutas excluidas se inspeccionan o bloquean según el matcher de tar.
- Preview estático niega rutas sensibles, traversal, project roots que sean junctions fuera de `projects/` y symlinks que salgan del proyecto.
- Metadata variable de jobs y tooltip de modelos se renderiza mediante `textContent` y nodos DOM.
- Pruebas usan exclusivamente secretos sintéticos. No garantizan detección de todos los formatos posibles.
- Límites deliberados del escáner: 20 000 entradas, 1 MiB por archivo y 50 MiB total. Proyectos con archivos mayores pueden quedar bloqueados aunque sean legítimos.
- Integración ZIP se probó con `tar.exe` y un proyecto temporal limpio; archivos de credenciales ficticios fueron bloqueados.

## Cobertura pendiente

- E2E completo del worker contra un proveedor OpenCode real y modelos externos.
- Pruebas de carga/concurrencia prolongadas con procesos OpenCode reales.
- La API sigue siendo local sin autenticación; no exponer a Internet.
- El escaneo usa fingerprints de alta confianza y no sustituye revisión manual ni gestor de secretos.

## Landing como entrada (2026-10-30)

- `web/index.html` es la landing estática (antes en `projects/web-estatica-landing-page-de-factoryos-ef57418e`), con estilos en `web/landing.css`; el panel de FactoryOS pasa a `web/app.html`.
- Los botones **Empezar** y **Crear mi primer proyecto** navegan a `/app.html`; el logo del panel vuelve a `/`.
- `vite.config.ts` declara ambas páginas como entradas; en desarrollo `npm run dev` sirve `/` y `/app.html`.
- `npm test`: **76/76 PASS** (incluye `tests/landing.test.mjs` y las pruebas de visibilidad del modo de selección).
- `npm run build`: **PASS**; genera `dist/index.html` (landing), `dist/app.html` (panel) y assets con hash.
- Comprobación manual con Vite en `127.0.0.1:5173`: `/` responde 200 con `landing.css` y sin `/main.ts`; `/app.html` responde 200 con `/main.ts`.
- Revisión final: se corrigió el contraste de los CTA en hover (`.cta:hover`) y los enlaces muertos de Docs/GitHub, que ahora apuntan al repositorio real. Las pruebas cubren ambas regresiones y que `vite.config.ts` declare las dos entradas.
- Se alineó verticalmente el logo con el nombre FactoryOS en la landing y el panel (mismo `viewBox`), con prueba de regresión.
- Repositorio y enlaces actualizados a `github.com/jtarifap/FactoryOS`; el remoto `origin` apunta a la nueva URL y `git ls-remote` responde en `main`.
- Se eliminó la línea descriptiva «Agentes OpenCode · Brain STATIC/SIMPLE/COMPLEJA · Preview local · ZIP · Modificación» del header del panel.
- En modo «Independientes por agente» se oculta «Modelo común / fallback» y se muestran los agentes; en «Modelo común» ocurre lo contrario. Se añadió la regla CSS `#common-model-section[hidden]` y pruebas de ambos modos.
- Se estabilizó la prueba de frescura de `DELIVERY_REPORT.md` (margen de 1 s) para evitar falsos rojos por resolución de mtime.
- Se regeneró `public/images/captApp2.jpg` (1091×837) con el modo «Independientes por agente» ya corregido: sin «Modelo común / fallback» y con los selectores por agente visibles. Las tres capturas del README se muestran a 250 px de ancho.
- No se han añadido dependencias ni se ha ejecutado ningún proveedor real. El proyecto original en `projects/` se mantiene intacto (no está versionado).

## Tema claro/oscuro (landing) (2026-10-30)

- Añadido botón sol/luna detrás de "GitHub" en `index.html`, con tema claro/oscuro compartido (`factoryos-theme`), persistencia y funcionamiento .

- `npm test`: **88/88 PASS**; incluye pruebas de preferencia predeterminada oscura, persistencia, alternancia, accesibilidad del icono y su posición justo antes de «LOCAL / WINDOWS».
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- Verificación manual en navegador: ambas paletas, tema oscuro inicial sin preferencia guardada, persistencia tras recargar, icono/etiqueta dinámicos y foco de teclado visibles.
- Sin nuevas dependencias; la preferencia se guarda solo en `localStorage`.
