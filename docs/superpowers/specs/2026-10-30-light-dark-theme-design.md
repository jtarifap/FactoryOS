# Diseño: tema claro y oscuro

- **Objetivo:** permitir alternar entre tema claro y oscuro en FactoryOS sin cambiar el tema oscuro actual como apariencia predeterminada.
- **Interfaz:** añadir un botón accesible con icono de sol/luna en el encabezado, inmediatamente a la izquierda de la etiqueta “LOCAL / WINDOWS”; al activarlo cambia el tema y el icono refleja la acción disponible o el tema activo de forma coherente.
- **Persistencia:** recordar el tema elegido en `localStorage`; si no hay preferencia guardada, iniciar en oscuro.
- **Implementación:** usar variables CSS para los colores de ambos temas y un atributo/clase de tema en el documento, controlado desde el TypeScript existente. Sin nuevas dependencias.
- **Enfoques considerados:** dos hojas CSS (simple al principio, duplicaría estilos) y variables CSS (un solo conjunto de estilos, fácil de mantener). Se eligieron variables CSS.
- **No incluido:** detectar automáticamente la preferencia del sistema, cambios de diseño ajenos al tema o persistencia en el servidor.
- **Verificación:** comprobar visualmente ambos temas, alternancia, persistencia al recargar, accesibilidad básica del botón y ejecutar build/pruebas existentes.
