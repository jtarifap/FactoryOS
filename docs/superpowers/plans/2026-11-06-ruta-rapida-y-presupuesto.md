# Ruta rápida para modificaciones y presupuesto real — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una modificación puntual cueste un solo agente y que ningún trabajo pueda superar su presupuesto de tokens.

**Architecture:** Un clasificador determinista en servidor decide `quick` o `full`; el worker ejecuta el developer directo en `quick`. `runAgent` vigila el consumo real desde la base de OpenCode cada 15 s y corta el proceso al superar el límite. El panel solo envía el alcance elegido.

**Tech Stack:** Node.js + TypeScript, `node:test`, Vite/TypeScript en el panel.

**Spec:** `docs/superpowers/specs/2026-11-06-ruta-rapida-y-presupuesto-design.md`

## Global Constraints

- Sin dependencias nuevas.
- Umbral del clasificador: 600 caracteres.
- Presupuesto rápido: 60.000 tokens; completo: `presupuesto_tokens` del plan, si falta 200.000.
- El panel no debe romper el flujo existente ni introducir autenticación.
- Todo el texto de interfaz en español.

## Review Focus

- Petición de modificación larga o con palabras de funcionalidad: debe ir por `full`.
- Proyecto sin `package.json`: la verificación rápida no debe fallar ni ejecutar npm.
- Consumo real ilegible (base ausente): el presupuesto no debe abortar por error de lectura.
- Trabajo cancelado durante el corte por presupuesto: debe quedar `cancelled`, no `needs_intervention`.
- Selector de alcance visible en modo consulta: debe ocultarse igual que el selector de proyecto.

---

### Task 1: Clasificador de alcance

**Files:**
- Create: `server/modification-scope.ts`
- Test: `tests/modification-scope.test.mjs`

**Interfaces:**
- Produces: `type ModificationScope = "quick" | "full"`; `classifyModification(request: string): ModificationScope`; `QUICK_SCOPE_MAX_CHARS = 600`; `QUICK_SCOPE_BUDGET = 60_000`.

- [ ] **Step 1: Escribir el test que falla**

Aserciones: texto corto de cambio de texto → `quick`; petición de 601 caracteres → `full`; "añade una sección de contacto" → `full`; "cambia el color del botón" → `quick`; cadena vacía → `full`.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `node --import tsx --test tests/modification-scope.test.mjs`

- [ ] **Step 3: Implementar el clasificador**

Lista de términos de funcionalidad en minúsculas; normaliza a minúsculas y sin acentos antes de buscar.

- [ ] **Step 4: Verificar que pasa**

- [ ] **Step 5: Commit**

### Task 2: Presupuesto por trabajo

**Files:**
- Create: `server/job-budget.ts`
- Test: `tests/job-budget.test.mjs`

**Interfaces:**
- Produces: `resolveBudget(scope: ModificationScope, planBudget?: unknown): number`; `isOverBudget(used: number, budget: number): boolean`.

- [ ] **Step 1: Test que falla**: rápido ignora el plan y devuelve 60.000; completo con plan válido devuelve ese número; completo sin plan devuelve 200.000; valores negativos, cero o no numéricos se ignoran; `isOverBudget` compara en estricto mayor.

- [ ] **Step 2: Ejecutar y ver el fallo**

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Verificar**

- [ ] **Step 5: Commit**

### Task 3: Cableado en el servidor

**Files:**
- Modify: `server/index.ts` (tipo `Job`, POST `/api/jobs`, `runAgent`, `worker`)
- Test: `tests/quick-modification-wiring.test.mjs`

**Interfaces:**
- Consumes: `classifyModification`, `resolveBudget`, `isOverBudget`.
- Produces: `Job.scope?: ModificationScope`; `jobBudget(j)` interno.

- [ ] **Step 1: Test de cableado que falla**: el fuente incluye `scope` en el POST, usa `classifyModification` para `auto`, llama a `runAgent` con `developer` en la ruta rápida sin invocar `factory-manager`, y `runAgent` consulta `readTokenUsageFromDb` con un intervalo y mata el árbol al superar el presupuesto.

- [ ] **Step 2: Ejecutar y ver el fallo**

- [ ] **Step 3: Implementar**

Reglas:
- `scope` solicitado se valida contra `auto|quick|full`; desconocido → 400.
- En `quick`: validar el modelo del developer, ejecutar solo developer, verificar y cerrar en `done` / "Cambio aplicado".
- En `full`: comportamiento actual.
- Presupuesto: leer `factory/plan.json` tras la fase del manager; en `quick` usar el límite fijo.
- Corte: temporizador de 15 s en `runAgent`; si se supera, registrar motivo, matar el árbol y resolver `false`. El worker marca `needs_intervention` salvo que esté cancelado.

- [ ] **Step 4: Verificar**

- [ ] **Step 5: Commit**

### Task 4: Selector de alcance en el panel

**Files:**
- Modify: `web/main.ts`, `web/api-types.ts`, `web/style.css`
- Test: `tests/common-model.test.mjs`

**Interfaces:**
- Consumes: nada nuevo del servidor salvo el campo `scope` en el payload.

- [ ] **Step 1: Test que falla**: con proyecto existente el formulario muestra un select de alcance con `auto`, `quick` y `full`; al enviar una modificación el payload incluye `scope`; en modo consulta el selector se oculta.

- [ ] **Step 2: Ejecutar y ver el fallo**

- [ ] **Step 3: Implementar**

`Job.scope`, selector bajo "Proyecto existente" oculto en consulta y visible solo con proyecto, `scope` en el payload de `action: "modify"`.

- [ ] **Step 4: Verificar**

- [ ] **Step 5: Commit**

### Task 5: Agentes, documentación y cierre

**Files:**
- Modify: `.opencode/agents/disenador.md`, `.opencode/agents/factory-manager.md`, `README.md`, `QA_REPORT.md`
- Test: `tests/factory-agents.test.mjs` si existe cobertura de frontmatter; si no, verificación de texto en el test de cableado.

- [ ] **Step 1: Test que falla**: el diseñador declara `edit: true`.

- [ ] **Step 2: Implementar**: `edit: true`; nota en el prompt del manager sobre no regenerar diseño/entrega en cambios puntuales; README y QA con la ruta rápida y el presupuesto.

- [ ] **Step 3: Verificación final**

```
npm test
npx tsc --noEmit
npm run build
```

- [ ] **Step 4: Commit**
