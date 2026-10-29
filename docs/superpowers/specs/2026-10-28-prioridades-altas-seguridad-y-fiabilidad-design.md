# Diseño: prioridades altas de fiabilidad y seguridad

## Intención

Mejorar las prioridades altas identificadas en `PROFESSIONAL.md` sin poner en riesgo el desarrollo que ya está validado. El usuario requiere avanzar una prioridad por vez, comprobarla antes de pasar a la siguiente y retirar solo el cambio actual si la verificación falla.

## Enfoques considerados

1. **Cambios secuenciales en `main` con backup manual.** Es sencillo, pero mezcla el trabajo nuevo con la rama principal y deja más riesgo de perder o sobrescribir una versión validada.
2. **Cambios agrupados y verificación al final.** Reduce pasos, pero dificulta localizar regresiones y contradice el requisito de validar antes de avanzar.
3. **Worktree aislado y etapas secuenciales con barreras de pruebas (seleccionado).** Mantiene intacto el estado base y cada prioridad debe pasar pruebas focalizadas, suite completa y build antes de comenzar la siguiente. Si falla, investigar y retirar exclusivamente la etapa no validada.

## Objetivos

- Ejecutar una sola tarea a la vez y dar semántica coherente a cancelación en todas las fases/procesos.
- Hacer que QA falle de forma explícita cuando el proyecto no ofrezca verificaciones suficientes o estas no se ejecuten.
- Definir claramente el agente de entrega y no marcar una entrega como validada cuando falle un requisito obligatorio.
- Evitar filtrar archivos sensibles mediante ZIP/preview y evitar inyección de contenido de proyecto en el DOM.
- Preservar todos los avances validados y probar cada etapa antes de continuar.

## No objetivos

- Reescribir la aplicación o cambiar el stack.
- Añadir autenticación pública, rate-limiting completo o E2E integral en esta serie.
- Cambiar la configuración de modelos, credenciales o datos locales del usuario.
- Publicar cambios o ejecutar `git push`.

## Alcance y orden

### Etapa 1 — Serialización y cancelación

- Asegurar que la exclusión mutua cubra el ciclo completo del worker, no solamente algunos procesos OpenCode.
- Registrar/cancelar el proceso hijo actual también durante brain y verificaciones técnicas.
- Evitar que la transición al terminar una fase convierta una cancelación en fallo o resultado exitoso.
- Regresión: dos trabajos nunca deben ejecutar fases simultáneamente; cancelar en cada tipo de fase termina procesos y deja un estado terminal consistente.
- Decisión: conservar la cola existente. Los nuevos trabajos quedan `queued`; no se rechazan por existir un trabajo activo.

### Etapa 2 — Criterios de QA

- No declarar verificación técnica suficiente si existen `package.json` pero no hay scripts verificables, salvo que se defina y compruebe un caso estático legítimo.
- Exigir salida exitosa de los controles anunciados y propagar resultados a estado/error/reporte.
- Regresión: ausencia de scripts, fallo de build/test, y caso estático permitido.
- Contrato propuesto: proyecto estático válido requiere `index.html`; proyecto con `package.json` debe tener al menos un script `build` o `test`, y se ejecutan todos los que existan entre esos dos. Si no hay controles verificables, QA falla de forma explícita.

### Etapa 3 — Entrega

- Incorporar una definición local válida para `delivery-manager` o elegir explícitamente un mecanismo compatible ya existente.
- Hacer visible el fallo del Delivery Manager; no marcar como `validated` si el informe obligatorio no se pudo completar.
- Regresión: informe creado lleva a validación; fallo no queda falsamente validado.
- Decisión propuesta: añadir definición local dedicada de `delivery-manager`; el informe se considera presente solo si `DELIVERY_REPORT.md` existe, no está vacío y contiene sus apartados obligatorios.

### Etapa 4 — Seguridad inmediata

- Excluir del ZIP archivos sensibles y ampliar el filtro con pruebas de contenido empaquetado, sin inspeccionar ni exponer secretos reales.
- Proteger preview para que no sirva archivos sensibles ni permita traversal/codificación alternativa.
- Eliminar inserción de datos variables de trabajos en `innerHTML`, construyendo nodos/texto de forma segura.
- Regresión: fixtures sintéticos para `.env`, claves de prueba, traversal, nombres con HTML y archivos benignos.
- Política propuesta: omitir del ZIP dependencias, VCS, cachés y logs; ante archivos con nombres de credenciales/claves o contenido que coincida con patrones de secreto de alta confianza, cancelar el ZIP y reportar solo las rutas afectadas (nunca el valor). Preview bloquea esos mismos archivos sensibles.

## Salvaguardas y verificación

- Crear un worktree independiente desde el estado actual de `main`; no alterar el árbol original.
- Antes de cada etapa: añadir una prueba de regresión que demuestre el fallo.
- Después del cambio: ejecutar primero pruebas focalizadas; después `npm test` y `npm run build`.
- No iniciar la etapa siguiente si cualquier verificación falla.
- Si una etapa falla, aplicar diagnóstico sistemático y retirar solo los cambios de esa etapa dentro del worktree; conservar las etapas ya validadas.
- No crear commits ni publicar sin solicitud explícita; nunca hacer push.
- Al final, informar límites que queden pendientes en lugar de afirmar más de lo verificado.

## Detalles que se dejan al implementador

- La abstracción para propagar cancelación a worker, OpenCode y comandos npm manteniendo compatibilidad Windows.
- El listado exacto y testeado de patrones sensibles, implementado como una política compartida entre ZIP y preview.
- El formato y comprobaciones automatizadas de los apartados obligatorios del informe de entrega.
