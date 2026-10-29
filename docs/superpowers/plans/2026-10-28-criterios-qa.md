# Project Verification and QA Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a project from passing QA when it has no executed, meaningful verification.

**Architecture:** Extract deterministic project-check discovery from the worker into a small module. Static projects pass only with `index.html`; package projects must define `build` or `test`, and every defined one is executed and reported.

**Tech Stack:** Node.js, TypeScript, node:test, npm scripts.

**Spec:** `docs/superpowers/specs/2026-10-28-prioridades-altas-seguridad-y-fiabilidad-design.md` — Etapa 2.

**Prerequisite:** Execute in the same isolated worktree after the worker/cancellation plan passes its complete stage gate. Do not start this plan if that gate is red.

## Global Constraints

- Proyecto estático válido requiere `index.html`.
- Proyecto con `package.json` debe tener al menos un script `build` o `test`; ejecutar todos los que existan.
- No declarar QA correcto si no se ejecutó una comprobación.
- No cambiar modelos, credenciales o datos locales del usuario.
- No publicar cambios ni ejecutar `git push`.
- No pasar a otra prioridad si pruebas focalizadas, `npm test` o `npm run build` fallan.

## Review Focus

- `package.json` inválido debe fallar con motivo legible — test de parseo.
- Sin `build` ni `test` no se puede marcar verificado — test de ausencia de controles.
- Si están ambos scripts, ambos se ejecutan — test de plan de verificación.
- Un script no cero debe fallar QA y conservar logs — test de proceso fallido.
- Static sin `index.html` falla; con `index.html` pasa explícitamente como verificación superficial — pruebas de ambos casos.

---

### Task 1: Discover verification contract

**Files:**
- Create: `server/project-verification.ts`
- Test: `tests/project-verification.test.mjs`

**Interfaces:**
- Produce `getProjectVerification(directory: string): { kind: "static" | "package" | "invalid"; scripts: Array<"build" | "test">; error?: string }`.
- `static` exige un archivo regular `index.html` (no directorio ni symlink); `package` exige JSON válido y al menos un script build/test; `invalid` incluye razón segura.
- Produce `runProjectChecks(directory: string, scripts: Array<"build" | "test">, run: (directory: string, script: "build" | "test") => Promise<{ ok: boolean; output: string }>): Promise<{ ok: boolean; summary: string; output: string; checks: Array<{ command: "npm run build" | "npm test"; ok: boolean }> }>`; la salida cruda nunca forma parte del resumen estructurado.
- Evidencia QA se genera desde resultados `checks` tipados, no parseando texto de salida de procesos.

- [x] **Step 1: Write failing tests** con directorios temporales para estático válido, HTML ausente, package malformado, package sin scripts y package con build/test; añadir pruebas de `runProjectChecks` para orden build/test, resumen de salidas y parada en el primer fallo.
- [x] **Step 2: Run test to verify it fails** con `node --test tests/project-verification.test.mjs`; esperado: falla por módulo/interfaz inexistente.
- [x] **Step 3: Implement `getProjectVerification` and `runProjectChecks`**; descubrimiento no ejecuta comandos ni lee fuera del directorio proporcionado.
- [x] **Step 4: Run focused test**; esperado: PASS.
- [x] Review fix: `index.html` must be a regular non-symlink file.

### Task 2: Enforce discovered checks in worker

**Files:**
- Modify: `server/index.ts`
- Test: `tests/project-verification.test.mjs` y/o `tests/verify-project.test.mjs`

**Interfaces:** consume `getProjectVerification` and `runProjectChecks` from Task 1.
- Produce `appendVerificationEvidence(directory: string, checks: Array<{ command: "npm install" | "npm run build" | "npm test"; ok: boolean }>, ok: boolean): void`; append only this structured data (no raw process output) to `QA_REPORT.md`.

- [x] **Step 1: Add failing tests** that `verifyProject` delegates to discovery/runner and records evidence; test that evidence appends without erasing existing QA report text and labels pass/fail.
- [x] **Step 2: Run focused test**; esperado: FAIL porque el worker todavía usa la verificación permisiva.
- [x] **Step 3: Replace permissive `verifyProject` branches** con el contrato común; mantener `npm install` solo cuando falten dependencias; adaptar el runner inyectado a `npm run <script>` y propagar resúmenes seguros al trabajo y QA_REPORT.
- [x] **Step 4: Run focused tests**; esperado: PASS.
- [x] **Step 5: Run full gate** con `npm test` y `npm run build`; esperado: PASS sin afirmar verificación de proyectos generados que no se haya ejecutado.
- [x] **Step 6: Stage gate:** solo continuar al plan de entrega si los dos comandos y los casos static/package pasan.
- [x] Review fix: evidencia QA usa objetos de resultado tipados; la salida del comando se mantiene separada y nunca se parsea como resultados.
