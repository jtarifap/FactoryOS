# QA Report — DevFactory 2.0

Fecha de validación: 2026-10-28. Alcance: cambios de prioridades altas en worktree aislado `high-priority-hardening`; el código rastreado de `main` sigue en `66bfce5`. Los documentos de diseño/plan están sin seguimiento en el checkout original.

## Resultado

- `npm test`: **62/62 PASS**.
- `npm run build`: **PASS** (`tsc --noEmit` + Vite build).
- `git diff --check`: sin errores; Git muestra únicamente avisos de conversión LF/CRLF de Windows.
- No se ejecutó generación con proveedor real ni se leyeron credenciales.

## Prioridad 1 — worker y cancelación

- Lease excluye workers solapados durante todo el ciclo; los nuevos trabajos continúan en cola FIFO.
- Se registran procesos de validación de modelos, brain, agentes y npm por ID de trabajo. Cancelar termina el árbol de procesos y deja el estado `cancelled`.
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
- `npm test`: **71/71 PASS** (incluye `tests/landing.test.mjs`, 9 pruebas nuevas).
- `npm run build`: **PASS**; genera `dist/index.html` (landing), `dist/app.html` (panel) y assets con hash.
- Comprobación manual con Vite en `127.0.0.1:5173`: `/` responde 200 con `landing.css` y sin `/main.ts`; `/app.html` responde 200 con `/main.ts`.
- Revisión final: se corrigió el contraste de los CTA en hover (`.cta:hover`) y los enlaces muertos de Docs/GitHub, que ahora apuntan al repositorio real. Las pruebas cubren ambas regresiones y que `vite.config.ts` declare las dos entradas.
- No se han añadido dependencias ni se ha ejecutado ningún proveedor real. El proyecto original en `projects/` se mantiene intacto (no está versionado).
