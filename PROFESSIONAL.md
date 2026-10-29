# DevFactory 2.0 — estado profesional

## Objetivo

Evolucionar la fábrica local de software sin reescribir el producto existente. Stack: Node.js, TypeScript, Vite y OpenCode CLI. Sigue siendo una aplicación local de un único proceso; no es un servicio distribuido.

## Estado verificado

La revisión actual se hizo en el worktree `high-priority-hardening`, derivado del commit `66bfce5` de `main`. El código rastreado de `main` permanece en ese commit; los documentos de diseño/plan se conservan sin seguimiento en el checkout original. Las prioridades altas A–D de abajo están implementadas en el worktree y pasan las verificaciones registradas en `QA_REPORT.md`; todavía no se integraron a `main`.

### Producto existente

- UI con configuración de modelos por agente, botón de prueba y tooltip; trabajos con logs/acciones; formulario de creación/modificación; preview y ZIP.
- Pipeline brain `STATIC` / `SIMPLE` / `COMPLEJA`, worker persistido, cancelación, corrección acotada y Delivery Manager.
- Preview estático/dinámico, ZIP y checkpoint al modificar proyectos.

### Prioridad A — exclusión del worker y cancelación: completada

- Lease cubre todo el worker y mantiene el procesamiento serial FIFO.
- Procesos de validación, brain, agentes y npm se registran por trabajo; la cancelación no convierte el resultado en `failed`.
- El worker espera el cierre de los hijos después de cancelar o terminar por timeout antes de liberar el lease.
- Retry no inicia una nueva ejecución mientras la anterior conserve procesos registrados; el test Windows comprueba terminación real de padre e hijo.

### Prioridad B — validación técnica: completada

- Static requiere `index.html` y se califica como verificación superficial.
- Package requiere al menos `build` o `test`; ejecuta todos los configurados. Ausencia, JSON inválido o fallo de comando no pasan.
- Resumen real se agrega a `QA_REPORT.md` sin volcar la salida cruda del proceso.
- `index.html` debe ser archivo regular; resultados QA son estructurados y no se infieren de la salida cruda.

### Prioridad C — entrega validada: completada

- Agente local `delivery-manager` y contrato de cinco secciones completas en `DELIVERY_REPORT.md`.
- Estado `validated` exige salida exitosa, archivo actualizado durante esa fase y secciones con contenido. Un fallo queda visible como `failed`; no se borra el informe anterior.
- La frescura se verifica comparando mtime y estado previo, para rechazar informes antiguos con fechas futuras.

### Prioridad D — seguridad ZIP/preview/UI: completada

- ZIP bloquea rutas de credenciales y patrones de secreto de alta confianza; límites del escáner: 20 000 entradas, 1 MiB por archivo y 50 MiB total.
- El ZIP usa un snapshot de los bytes inspeccionados; roots junction fuera de `projects/` se rechazan.
- Preview estático rechaza archivos sensibles, traversal y symlinks que salen del proyecto.
- Resumen de trabajos y tooltip usan creación de nodos/texto; metadata del proyecto no se interpreta como HTML.

## Pendientes

### Prioridad media

1. Añadir proxy `/preview-static` en Vite: actualmente `vite.config.ts` solo proxya `/api`, por lo que preview estático durante `npm run dev` puede fallar desde el origen del frontend.
2. Consultar `/api/preview/status` desde la UI para refrescar estado y logs; comprobar también que el proceso dinámico realmente abrió el puerto antes de informar éxito.
3. Alinear reintento de `needs_intervention`: la UI ofrece acción, pero el backend actualmente acepta reintento solo desde `failed` o `cancelled`.
4. Añadir una acción de restauración desde checkpoint; hoy se crea checkpoint, pero no existe flujo de recuperación desde la UI.
5. Mejorar errores de red/HTTP de los controles del frontend para que no fallen silenciosamente.

### Prioridad posterior

- Pruebas E2E del ciclo completo con un proveedor OpenCode real; las pruebas actuales no consumen cuota ni autentican contra modelos.
- Pruebas de carga/concurrencia prolongadas con procesos reales en Windows.
- Autenticación y rate-limit si en algún momento se expone la API fuera de localhost; actualmente no debe exponerse a Internet.
- Mejorar persistencia/backup y recuperación de `data/jobs.json`/`settings.json`.
- La inspección de ZIP es conservadora y basada en nombres y fingerprints conocidos; no garantiza detectar todos los secretos. Revisar manualmente proyectos con credenciales.

## QA de esta revisión

- `npm test`: 62/62 PASS.
- `npm run build`: PASS.
- `git diff --check`: sin errores; solo avisos de conversión de fin de línea LF/CRLF de Windows.
- Informe detallado y límites: `QA_REPORT.md`.

## Operación y seguridad

- Arranque local: `npm install && npm run dev`; UI `http://127.0.0.1:5173`, API `http://127.0.0.1:4177`.
- No se leyeron credenciales ni se ejecutó push/deploy.
- Los cambios están aislados en el worktree y rama `high-priority-hardening`; no se crearon commits ni se modificó `main`.
