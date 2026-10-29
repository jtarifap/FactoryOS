# ZIP, Preview and UI Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent sensitive project files/secrets from being exported or previewed, and prevent project metadata from becoming executable HTML in the UI.

**Architecture:** Share a conservative project-file security policy across ZIP scanning and preview path resolution. ZIP creation fails closed on high-confidence secret detections without returning secret values; dynamic UI content is rendered with text nodes.

**Tech Stack:** Node.js, TypeScript, Windows tar, node:test, DOM APIs.

**Spec:** `docs/superpowers/specs/2026-10-28-prioridades-altas-seguridad-y-fiabilidad-design.md` — Etapa 4.

**Prerequisite:** Execute in the same isolated worktree after the worker/cancellation, QA, and delivery plans all pass their complete stage gates. Do not start this plan if any earlier gate is red.

## Global Constraints

- ZIP: mantener exclusiones existentes y bloquear archivos con nombre de credencial/clave o contenido de secreto de alta confianza.
- Ante hallazgos, reportar solo rutas afectadas; nunca valores de secreto.
- Preview no debe servir archivos sensibles ni rutas fuera del proyecto.
- Datos variables de jobs se insertan mediante nodos/texto, no interpolación en `innerHTML`.
- Usar únicamente fixtures sintéticos; no acceder a secretos reales.
- No publicar cambios ni ejecutar `git push`.
- No pasar a otra prioridad si pruebas focalizadas, `npm test` o `npm run build` fallan.

## Review Focus

- Rutas URL codificadas, doble codificación, separadores Windows y traversal no escapan de proyecto — pruebas resolver de preview.
- Directorio de proyecto que sea symlink/junction hacia fuera de `projects/` no puede servir ni exportar su objetivo — pruebas de handlers.
- `.env`, credenciales y claves privadas no se sirven y bloquean el ZIP según contrato — fixtures sintéticos.
- Clave de alta confianza en contenido de archivo hace fallar ZIP sin filtrar su valor — prueba de respuesta.
- Binarios/archivos grandes no se leen sin límite ni se tratan como texto accidentalmente — pruebas de límites.
- Nombre de job con `<img onerror=...>` se muestra literal sin crear elemento — prueba DOM/render.

---

### Task 1: Shared sensitive-file policy

**Files:**
- Create: `server/project-security.ts`
- Test: `tests/project-security.test.mjs`

**Interfaces:**
- Produce `isSensitiveRelativePath(relative: string): boolean`.
- Produce `findSecretCandidates(projectRoot: string): string[]` (rutas relativas únicamente; lanza `ProjectScanLimitError` ante presupuesto excedido); excluir directorios `.git`, `node_modules`, `.cache`; no excluir `dist`; inspeccionar máximo 20 000 entradas, 1 MiB por archivo y 50 MiB en total. Si se excede un límite, fallar cerrado y no crear ZIP.
- Produce `createScannedSnapshot(projectRoot: string, snapshotRoot: string): string[]`; copiar al snapshot exactamente los bytes limitados y examinados, omitiendo las mismas exclusiones, y empaquetar solo ese snapshot.
- Directory walking must stream entries (not materialize full directories); file reads enforce per-file and total byte caps while reading, not only from an earlier stat.
- Produce `resolveProjectFile(projectRoot: string, encodedRelativePath: string): { absolutePath: string; relativePath: string } | null`; decodifica una sola vez, rechaza separadores Windows/traversal y valida containment real contra symlinks.
- Nombres bloqueados incluyen `.env*`, credenciales/secrets, llaves/certificados (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`), además de componentes `.git`, `node_modules` y `.cache`. Contenido de texto busca fingerprints de alta confianza (AWS `AKIA…`, tokens GitHub `gh*_…`, encabezados private key); fixtures solo sintéticos.
- Las exclusiones son case-sensitive como el matcher de Windows tar: variantes de mayúsculas de `.git`, `node_modules` y `.cache` bloquean ZIP; variantes `.LOG` se inspeccionan porque el matcher no las excluye.

- [x] **Step 1: Write failing tests** para `.env*`, nombres de credenciales/llaves, `node_modules`, archivos benignos y marcadores sintéticos de tokens/PEM.
- [x] **Step 2: Run test to verify failure**: `node --test tests/project-security.test.mjs`.
- [x] **Step 3: Implement policy** sin imprimir/retornar contenido de archivos, con límites explícitos y traversal-resistant walk.
- [x] **Step 4: Run focused test**; esperado: PASS.

### Task 2: Enforce policy in ZIP and preview

**Files:**
- Modify: `server/zip.ts`
- Modify: `server/runner.ts`
- Modify: `package.json` (registrar `tsx` para importar handlers TS en pruebas node:test)
- Test: `tests/zip-security.test.mjs`, `tests/preview-security.test.mjs`

**Interfaces:** consume `isSensitiveRelativePath`, `findSecretCandidates`, `createScannedSnapshot` and `resolveProjectFile` from Task 1.

- [x] **Step 1: Write failing integration tests** importando handlers TS con `node --import tsx --test`; usar proyectos temporales dentro de `projects/`; comprobar handler ZIP rechaza hallazgos/límites, no devuelve valores secretos, y entrega ZIP limpio con archivo normal.
- [x] **Step 2: Write failing preview tests** para archivo sensible, archivo benigno, `%2e%2e`, `%252e%252e`, slash/backslash codificados y ruta raíz.
- [x] **Step 3: Run focused tests** con `node --import tsx --test tests/zip-security.test.mjs tests/preview-security.test.mjs tests/preview-security-wiring.test.mjs`; esperado: FAIL en seguridad ausente.
- [x] **Step 4: Set `npm test` to load `tsx`, integrate scanned snapshot before ZIP creation and `resolveProjectFile` before static reads**; si scan incompleto/candidato, responder sin empaquetar ni transmitir.
- [x] **Step 5: Run focused integration tests**; esperado: PASS en Windows con el empaquetador disponible.

### Task 3: Safe job metadata rendering

**Files:**
- Modify: `web/main.ts`
- Create: `web/safe-dom.ts`
- Test: `tests/safe-dom.test.mjs`, `tests/safe-dom-wiring.test.mjs`

- [x] **Step 1: Write failing DOM regression tests** con job.name/phase y metadata de modelo que contienen HTML/event handlers; afirmar que aparecen como texto y no se crean elementos/script handlers.
- [x] **Step 2: Run focused test**; esperado: FAIL con el render actual.
- [x] **Step 3: Implement safe DOM render helpers** y reemplazar interpolación dinámica en job summary y tooltip de modelos; conservar solo `innerHTML` estático para placeholders/layout.
- [x] **Step 4: Run focused test**; esperado: PASS.
- [x] **Step 5: Run full gate**: `npm test` y `npm run build`; esperado: PASS.

### Task 4: Final security stage gate

- [x] Revisar fixtures y respuestas para confirmar que ningún valor secreto se guarda, imprime o entrega.
- [x] Ejecutar `npm test` y `npm run build` completos; esperado: cero fallos.
- [x] Review fix pass: scanned bytes are copied into a private temp snapshot and only that snapshot is archived; mixed-case excluded names are scanned/blocked rather than silently skipped.
- [x] Revisar `git diff --check` y el diff completo del worktree; no incluir `data/`, `projects/`, `node_modules/`, `.env` ni ZIP generado.
- [x] Solo entonces marcar las prioridades altas como terminadas; sin commit/push sin petición expresa.
