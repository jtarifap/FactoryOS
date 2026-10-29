# Worker Serialization and Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure only one job runs at a time and cancellation stops every child process without overwriting the cancelled state.

**Architecture:** Keep the existing FIFO job queue and add an explicit worker lease for the complete async job lifecycle. Track every job-owned child process centrally so cancel handles brain, agents, and npm verification, with Windows tree termination retained.

**Tech Stack:** Node.js, TypeScript, node:test, child_process.

**Spec:** `docs/superpowers/specs/2026-10-28-prioridades-altas-seguridad-y-fiabilidad-design.md` — Etapa 1.

## Global Constraints

- Los nuevos trabajos quedan `queued`; no se rechazan por existir un trabajo activo.
- No reescribir la aplicación ni cambiar el stack.
- No cambiar modelos, credenciales o datos locales del usuario.
- No publicar cambios ni ejecutar `git push`.
- Mantener compatibilidad con Windows y el `taskkill /T /F` existente.
- No pasar a otra prioridad si pruebas focalizadas, `npm test` o `npm run build` fallan.

## Review Focus

- Dos llamadas simultáneas al worker antes de crear un proceso no deben iniciar dos trabajos — prueba de worker lease.
- Cancelar durante brain debe detener el proceso y conservar `cancelled` — prueba de proceso brain.
- Cancelar durante `npm install`, build o test debe detener el hijo registrado y conservar `cancelled` — pruebas para child process en verificación.
- Cancelar un trabajo en cola no debe afectar el proceso de otro trabajo — prueba de aislamiento por job ID.
- El cierre normal de un hijo no debe dejar un registro activo reutilizable — prueba de limpieza del registro.

---

### Preflight: preserve validated baseline

- [x] Usar `superpowers:using-git-worktrees` para crear un worktree desde `main`; no editar el árbol original.
- [x] En el worktree, ejecutar `npm test` y `npm run build` antes de cambios; si falla alguno, parar e informar, sin alterar ni limpiar `main`.
- [x] Confirmar que `main` conserva el mismo commit y el mismo estado limpio antes de comenzar Task 1.

### Task 1: Worker-wide lease

**Files:**
- Create: `server/job-coordinator.ts`
- Test: `tests/job-coordinator.test.mjs`
- Modify: `server/index.ts`

**Interfaces:**
- Produces `WorkerLease.tryAcquire(): (() => void) | null`; el release es idempotente.

- [x] **Step 1: Write the failing test** para dos `tryAcquire()` consecutivos: el primero entrega release, el segundo devuelve `null`, y después de release se puede adquirir de nuevo; comprobar también release doble.
- [x] **Step 2: Run test to verify it fails** con `node --test tests/job-coordinator.test.mjs`; esperado: falla por módulo/interfaz inexistente.
- [x] **Step 3: Implement `WorkerLease`** en `server/job-coordinator.ts` y usarlo al entrar y salir del ciclo completo de `worker()`, incluyendo errores y cola vacía.
- [x] **Step 4: Run focused test**; esperado: PASS.

### Task 2: Per-job child registry and cancellation state

**Files:**
- Modify: `server/job-coordinator.ts`
- Test: `tests/job-coordinator.test.mjs`
- Modify: `server/index.ts`

**Interfaces:**
- Produces `JobProcessRegistry.add(jobId: string, child: ChildProcess): void`, `remove(jobId: string, child: ChildProcess): void`, `cancel(jobId: string): void`, `isCancelled(jobId: string): boolean`, `finish(jobId: string): Promise<void>` (resolves only after all tracked children emit `close`).
- El registro recibe la función de terminación de procesos como dependencia para probarlo sin lanzar procesos reales.

- [x] **Step 1: Add failing tests** para registrar dos hijos en un job, cancelar y terminar ambos; cancelar otro ID no toca esos hijos; un hijo agregado después de cancelar se termina inmediatamente; `finish()` limpia tombstone/children.
- [x] **Step 2: Run focused test**; esperado: falla por los comportamientos aún no implementados.
- [x] **Step 3: Implement `JobProcessRegistry`** con estado aislado por `jobId`; registra `close` para quitar hijos, evita que un hijo nuevo sobreviva a un job ya cancelado y `finish()` espera la salida de todos los hijos existentes.
- [x] **Step 4: Run focused test**; esperado: PASS.
- [x] **Step 5: Add failing wiring/cancellation tests** que cubran el uso del lease y registro en `runLightAgent`, `runAgent`, `execInProject`, validación previa de modelos, endpoint cancel y cierre del worker; cancelar no puede acabar en `failed`/`done`.
- [x] **Step 6: Route all job-owned spawns through registry** en esas fases; el endpoint cancel invoca `cancel(jobId)`; no registrar procesos de preview como jobs. Tras cada await cancelable, preservar el estado `cancelled` hasta el cierre.
- [x] Los timeouts de validación, brain y npm esperan `close` tras matar el árbol antes de resolver la fase; si no, podrían solapar procesos.
- [x] **Step 7: Run focused tests**, luego `npm test` y `npm run build`; esperado: todas PASS.
- [x] **Step 8: Stage gate:** solo continuar al plan de QA cuando se hayan revisado las salidas completas y el estado de trabajo siga preservado.
- [x] Review fix: hijos registrados después de cancelación permanecen en el registro hasta `close`; el retry recibe 409 mientras ese job siga activo.
- [x] Review fix: en Windows, `taskkill /T /F` termina el árbol antes de señalizar el handle del padre; prueba un proceso padre e hijo real.
