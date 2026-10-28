# PROFESSIONAL.md - Informe profesional de estado y trabajo pendiente
# Taridev Software Factory 2.0 (proyecto local C:\Projects\Dev\DevFactory)

## 1. Objetivo
Evolucionar DevFactory a un asistente/fabrica autonoma de software estable sobre el stack actual (Node.js, TypeScript, Vite), iniciando desde el codigo existente sin reescribir desde cero.

## 2. Alcance implementado realmente (verificado con comprobaciones)
### Backend (server/index.ts y modulos auxiliares)
- Modelos: GET /api/models (parse de opencode models --verbose), POST /api/models/test (prueba con timeout y deteccion de cuota/credenciales).
- Jobs con ciclo: queued/running/done/failed/cancelled + needs_intervention/validated.
- Pipeline con fase brain (STATIC / SIMPLE / COMPLEJA) para decidir etapas.
- Autocorreccion limitada (<=3 intentos) con verifyProject (npm install/build/test) y mensajes de error claros.
- Delivery Manager: genera DELIVERY_REPORT.md.
- Preview: start/stop/status y static serving (/preview-static/:slug/*).
- ZIP: GET /api/projects/zip?directory=<slug> con exclusiones seguras.
- Persistencia basica (data/jobs.json, data/settings.json), cancelacion, reintento, borrado, modificacion de proyecto existente con checkpoint.
- Seguridad: validacion de rutas, tree-kill de procesos, argumentos estructurados.

### Frontend historico perdido en intentos de cuadrar sintaxis
- La interfaz quedo reducida a un esqueleto minimo por un incidente de sintaxis en web/main.ts durante la integracion de cambios masivos.
- La interfaz queda en Estructura minima valid para build; las paneras/tablas han sido substituidas parcialmente.
- TODO: restauracion completa del UI (selectores, tooltip, jobs, logs, preview, botones).

### Incidente de datos
- Se borraron accidentalmente jobs/model-tests/settings en un momento mientras se intentaba limpiar archivos temporales. settings reinicializado a defaults (autoApprove:false). Los proyectos permanecen en projects/.

## 3. Arquitectura principal
- API Node/TS (server/index.ts), worker secuencial, spawn OpenCode, prematureesescuencias persistidas.
- UI Vite (`web/`), proxy `/api` → 127.0.0.1:4177.
- Directorios: data/ (jobs, settings, logs, zips), projects/<slug>-id/.

## 4. Tareas pendientes (PROFESSIONAL PLAN)
### Fase A – Restauracion de Frontend (prioridad 1)
- Recrear contenedor completo (settings panel con toggles, mode common/independent, autoApprove warning).
- Restaurar selects, tooltips de modelo, panel de preview y acciones de jobs.

### Fase B – Seguridad y calidad
- Definir pruebas unitarias/integracion en backend y frontend.
- Rate-limits y validacion mas estricta.
- Escanear secretos antes de ZIP.

### Fase C – Integracion
- Reanudar proyecto, ciclo QA/Developer automatizado completo, pruebas E2E por CLI.
- Logging mas fino y cancelacion granular.

## 5. Restricciones operativas actuales
- No se hicieron despliegues ni push.
- README actualizado con los ultimos cambios.
- No se modifiquen archivos fuera de los ya creados/modificados descritos.

## 6. Instrucciones para revisar
- Compilacion: `npm run build` deberia pasar.
- Arranque: `npm run dev` (API + Vite).
- Salud: http://127.0.0.1:4177/api/health
