# QA_REPORT.md - Ultimo reporte de calidad
Fecha: 2026-10-28 (local)

## Corrección: selección de proyecto durante refresco automático
- Causa: cada 3 segundos se reconstruían las opciones sin conservar la selección.
- Se conserva la selección actual de Vista previa/ZIP y modificación, incluso si cambia mientras llega la respuesta HTTP; si el proyecto desaparece, vuelve al placeholder.
- Regresión: tres pruebas reprodujeron la pérdida de selección antes de corregirla; también se comprueba el proyecto eliminado.
- Verificación: `npm test` PASS (10/10); `npm run build` PASS.

## Corrección: timeout al probar modelos
- Causa reproducida: `factory-manager` interpreta la prueba como una tarea de planificación y empieza a revisar archivos, en lugar de responder OK.
- La comprobación ahora usa el agente integrado `build`, instrucción explícita sin herramientas y salida JSON. Un proceso que termina sin texto del modelo ya no cuenta como conexión válida.
- `Free usage limit reached` se reconoce inmediatamente como límite gratuito, sin esperar 90 segundos.
- Verificación real: POST `/api/models/test` con `openai/gpt-6-luna` y `factory-manager` devolvió `{ "ok": true, "duration": 4442 }` tras la corrección.
- `npm test`: 6/6 pasan. `npm run build`: PASS.
- Esta verificación no garantiza cuota ni disponibilidad de otros modelos/proveedores.

## Corrección: modelo común / fallback
- Añadidos botón **Probar** y tooltip (hover y foco), usando el estilo existente.
- Pruebas de regresión: 3 fallaban antes de la corrección; 3 pasan después. Cubren envío del modelo seleccionado, tooltip y recuperación ante error de conexión.
- Navegador local: botón presente, 162 opciones, tooltip visible con el ID seleccionado y oculto al salir.
- Las pruebas automatizadas simulan HTTP; no ejecutan modelos reales ni consumen cuota.
- El resto de este documento conserva verificaciones e incidencias históricas; no representa una nueva validación completa de la aplicación.

## Comandos ejecutados
- `npm run build` -> PASS (tsc --noEmit + vite build)
- `npm run dev` (tsx watcher + vite start) local
- GET/POST endpoints verificados (health, settings, models, models/test)
- Preview estatico/dinamico (HTTP 200)
- ZIP descarga (HTTP 200, 15581 bytes)

## Restultados reales
- Backend core functions presentes.
- Frontend simplificado (reducido por incidente de sintaxis).
- Incidente de datos: settings/jobs/model-tests reseteados (autoApprove:false, defaults).
- Verificado con browser: tooltip, mode common, preview.

## Problemas pendientes
- Restauracion completa interfaz.
- Unit tests reales no creados (requiere re implementar o limpiar UI).

## Instrucciones de arranque
npm install && npm run dev
>
