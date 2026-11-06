# Ruta rápida para modificaciones puntuales y control de presupuesto

Fecha: 2026-11-06

## Intención

Una modificación de texto en un proyecto existente costó 0,12 USD y 4,5 M de tokens.
El pipeline de creación (diseño → desarrollo → entrega) y la ausencia de límites reales
de gasto hacen que tareas triviales cuesten como una creación completa.

## Objetivos

- Aplicar un presupuesto de tokens de verdad, por fase y con corte real.
- Ejecutar las modificaciones puntuales con un solo agente (developer).
- Evitar fases inútiles: diseño y entrega no se regeneran para cambios de texto.
- Permitir forzar el alcance desde el panel sin depender del criterio del LLM.

## No objetivos

- No se cambia el pipeline de creación de proyectos.
- No se introducen modelos nuevos ni proveedores.
- No se elimina la verificación técnica existente.

## Enfoque elegido

### 1. Clasificación determinista

`server/modification-scope.ts`:

```ts
export type ModificationScope = "quick" | "full";
export function classifyModification(request: string): ModificationScope;
```

`quick` cuando la acción es `modify`, la petición tiene 600 caracteres o menos y no
contiene términos de funcionalidad (añadir, crear, sección, formulario, API, login,
pago, base de datos, componente, ruta, instalar, migrar, etc.). En cualquier otro
caso, `full`.

El panel envía `scope: "auto" | "quick" | "full"`; `auto` usa el clasificador.
El selector solo se muestra cuando hay un proyecto existente elegido.

### 2. Ruta rápida

Con `scope: "quick"` el worker no invoca al factory-manager ni al pipeline:
ejecuta `runAgent(j, "developer", prompt)` con el encargo acotado, verifica el
proyecto con `verifyProject` y termina en `done` / "Cambio aplicado". No exige
`DELIVERY_REPORT` fresco.

### 3. Presupuesto aplicado

- Rápido: 60.000 tokens.
- Completo: `presupuesto_tokens` de `factory/plan.json`; si falta, 200.000.
- `runAgent` consulta `readTokenUsageFromDb(j.id)` cada 15 s y mata el árbol de
  procesos al superar el límite (corte real, no a posteriori).
- Estado resultante: `needs_intervention` con el motivo y los tokens consumidos.

### 4. Diseñador

`.opencode/agents/disenador.md` pasa a `edit: true` para poder actualizar
`factory/diseno.md` en modificaciones.

### 5. Entrega

El pipeline completo mantiene la regla de `DELIVERY_REPORT` fresco. El prompt del
factory-manager añade que, en modificaciones puntuales, no se regeneran diseño ni
entrega.

## Decisiones del socio

- Umbral del clasificador: 600 caracteres.
- Límite de la ruta rápida: 60.000 tokens.
- Selector de alcance visible solo con proyecto existente.
