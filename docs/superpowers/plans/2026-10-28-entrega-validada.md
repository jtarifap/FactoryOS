# Delivery Manager Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `validated` means a complete delivery report was actually produced by the dedicated delivery agent.

**Architecture:** Add a local `delivery-manager` agent definition and a pure report validator. The worker may transition to `validated` only after agent success and a non-empty report containing every required section; otherwise it records a clear failure.

**Tech Stack:** OpenCode agent Markdown, Node.js, TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-10-28-prioridades-altas-seguridad-y-fiabilidad-design.md` — Etapa 3.

**Prerequisite:** Execute in the same isolated worktree after both the worker/cancellation and QA plans pass their complete stage gates. Do not start this plan if either gate is red.

## Global Constraints

- Añadir definición local dedicada de `delivery-manager`.
- Un informe obligatorio fallido o incompleto no permite estado `validated`.
- No incluir secretos en el informe ni leer credenciales.
- No publicar cambios ni ejecutar `git push`.
- No pasar a otra prioridad si pruebas focalizadas, `npm test` o `npm run build` fallan.

## Review Focus

- Archivo ausente, vacío o solo espacios falla — pruebas del validador.
- Cada apartado obligatorio se valida sin aceptar sinónimos ambiguos — pruebas de contrato.
- Agent exit nonzero nunca alcanza `validated` — test de transición del worker.
- Report generado antes de iniciar la fase no puede falsear resultado — comprobar borrado/mtime o estado de salida en prueba.
- El fallo del delivery manager conserva logs y presenta `lastError` legible — prueba de salida del job.

---

### Task 1: Define and validate delivery report

**Files:**
- Create: `.opencode/agents/delivery-manager.md`
- Create: `server/delivery-report.ts`
- Test: `tests/delivery-report.test.mjs`

**Interfaces:**
- Produce `validateDeliveryReport(content: string): { ok: boolean; missing: string[] }`.
- Produce `captureDeliveryReportState(directory: string): { mtimeNs: bigint; size: bigint; ino: bigint } | null` and `wasDeliveryReportUpdatedSince(directory: string, phaseStartedAtNs: bigint, before: DeliveryReportState | null): boolean`; require mtime after phase start and a state change from before phase.
- Capture phase start as a bigint nanosecond timestamp and require `stat(..., { bigint: true }).mtimeNs` for the report to be later than that start; do not delete/overwrite the prior report before the agent runs.
- Requerir encabezados Markdown exactos: `## Funcionalidades`, `## Dependencias`, `## Variables de entorno`, `## Instalación y ejecución`, `## Problemas conocidos y limitaciones`.
- Each required heading must have non-whitespace body text before the next heading.

- [x] **Step 1: Write failing tests** para reporte completo, cuerpo vacío, sección sin contenido, cada encabezado ausente y reporte antiguo frente a uno actualizado durante fase.
- [x] **Step 2: Run focused test to verify failure**: `node --test tests/delivery-report.test.mjs`.
- [x] **Step 3: Add agent definition** con límites de proyecto y esos cinco encabezados; implementa validador determinista que ignore mayúsculas/minúsculas al cotejar encabezados y compruebe cuerpo no vacío.
- [x] **Step 4: Run focused test**; esperado: PASS.

### Task 2: Gate the validated transition

**Files:**
- Modify: `server/index.ts`
- Test: `tests/delivery-report.test.mjs` o `tests/job-delivery.test.mjs`

**Interfaces:**
- Produce `validateDeliveryCompletion(agentOk: boolean, reportFresh: boolean, content: string): { ok: boolean; error?: string }`.

- [x] **Step 1: Add failing tests** para agent failure, report ausente/antiguo/inválido y report completo/fresco con agent exit 0; comprobar que el worker solo marca `validated` en el caso válido.
- [x] **Step 2: Run focused test**; esperado: FAIL antes de cambiar la transición.
- [x] **Step 3: Require process success plus valid `DELIVERY_REPORT.md` updated during this phase** antes de asignar `validated`; compare bigint `mtimeNs` against phase-start timestamp without deleting the previous report; on any failure set `failed`, phase and safe `lastError`, and preserve the cause in logs.
- [x] **Step 4: Run focused tests**; esperado: PASS.
- [x] **Step 5: Run full gate**: `npm test` y `npm run build`; esperado: PASS.
- [x] **Step 6: Stage gate:** no empezar seguridad antes de que los estados validated/failed cumplan contrato.
