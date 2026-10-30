# Usos de Anatomy en Valweb

Fecha: 2026-10-30. Estado: caso 1 elegido por el usuario e implementado como material de capacitación; casos 2 y 3 siguen como propuestas.

Usaría `/anatomy` para explicar procesos que hoy requieren varios pasos del manual, empezando por **cargar, revisar y publicar una base CSV**. Una máquina de inspección isométrica permitiría entender por qué recibir un archivo no lo hace visible de inmediato. El objetivo es ayudar al administrador a operar Valweb, sin añadir animación a las tareas habituales.

## Alcance y criterio Ponytail

El caso 1 se entrega en [HTML autónomo](../../../manuales/figuras/carga-csv/index.html), con figura estática enlazada desde el manual, fuentes y pruebas propias. No cambia pantallas del panel, llamadas, fixtures, exportaciones ni datos de Valweb. No añade dependencias.

Una figura se justifica si explica una decisión que el operador debe tomar. Para instrucciones cortas conservaría texto y el componente existente `HelpPopover`. Para arquitectura y relaciones entre servicios usaría diagramas convencionales. Anatomy aporta valor cuando el movimiento de un mecanismo reconocible explica el comportamiento.

## Alternativas consideradas

| Alternativa | Ventaja | Coste o límite |
| --- | --- | --- |
| Conservar manuales y ayudas de texto | Ya existen y son fáciles de mantener | El lector debe reconstruir mentalmente los estados del proceso |
| Añadir una figura didáctica al material de capacitación | Permite explorar errores, revisión y publicación sin operar datos reales | Requiere mantener el modelo de la explicación alineado con Valweb |
| Integrar figuras en el panel | Ayuda disponible durante la operación | Añade peso, movimiento y mantenimiento a pantallas de trabajo |

El usuario eligió implementar el caso 1 como figura didáctica para el material de capacitación, siguiendo la segunda alternativa. La integración en el panel solo tendría sentido si la figura resuelve una duda recurrente que el manual no cubre bien.

## Casos concretos por prioridad

### 1. Carga y publicación de registros

**Público y ubicación:** administradores; complemento de la sección «Cargar y publicar registros» del [manual del panel](../../../manuales/panel-administracion-admin.md).

**Objeto:** mesa de inspección de fichas con bandeja de entrada, guías ajustables para el mapeo de columnas, un puesto de revisión y una palanca que coloca la base aprobada en el expositor de consulta. Una ficha se desplaza por la mesa y el expositor cambia únicamente al publicar.

**Qué enseña:** cargar, procesar, revisar y publicar son pasos distintos. El worker procesa el archivo; puede pedir mapeo o corrección. La base candidata lista espera revisión antes de publicarse. El alfanumérico identifica la búsqueda; el folio conserva su valor como texto.

**Interacción propuesta:** recorrer un ejemplo válido y otro con errores, corregir el mapeo y accionar «Publicar» en la simulación. El texto exterior describe el estado y la acción disponible. Publicar la base no debe representarse como activar automáticamente el enlace: la activación tiene requisitos adicionales.

**Referencia del comportamiento:** [procesamiento y estados CSV](../../../src/features/imports/runner.ts), [interfaz de importaciones](../../../src/components/import-panel.tsx) y [reglas de validaciones](../../../src/features/validations/service.ts).

### 2. Procesamiento de imágenes desde Local o NFS

**Público y ubicación:** administradores y operadores del almacenamiento; sección de imágenes del manual, con posible ayuda ampliada desde Imágenes más adelante.

**Objeto:** estación de revelado con bandeja de originales `por_procesar/`, prensa de procesamiento, bandeja de revisión de reemplazos y archivo de copias administradas. La ficha conserva su alfanumérico mientras cambia de original a imagen procesada.

**Qué enseña:** depositar por FTP no inicia el procesamiento; el administrador debe pulsar «Procesar». Los reemplazos requieren confirmación. Los originales se retiran solo después de publicar y verificar que siguen siendo los capturados; puede quedar limpieza pendiente sin perder la publicación. Una desconexión NFS no cambia silenciosamente el destino a Local. La relación con un registro usa el nombre alfanumérico, no el folio.

**Interacción propuesta:** simular una imagen nueva, un reemplazo y un destino no disponible. No mezclar estas reglas con las del CSV o asumir que todo lote de imágenes requiere la misma revisión.

**Referencia del comportamiento:** [captura y limpieza de originales](../../../src/features/imports/directory.ts), [procesamiento de lotes](../../../src/features/imports/runner.ts), [selección de almacenamiento](../../../src/features/images/locations.ts) y [resolución del almacenamiento](../../../src/features/images/filesystem.ts).

### 3. Consulta de un enlace protegido y entrega de imagen

**Público y ubicación:** equipo comercial y personal de soporte; complemento de la [guía del enlace público](../../../manuales/ventas-enlace-publico.md). Menor prioridad que los dos casos operativos.

**Objeto:** archivador con cerradura de acceso, selector de código y ventanilla de entrega. Abrir la cerradura representa contar con acceso a esa validación protegida; el selector representa buscar el alfanumérico. Encontrar una ficha permite mostrar los campos configurados y, cuando corresponde, su imagen.

**Qué enseña:** autorización, existencia del registro y disponibilidad de imagen son condiciones distintas. No todos los enlaces exigen iniciar sesión. La entrega de imagen comprueba una autorización ligada al navegador y el estado vigente. No prometer imposibilidad de copia: quien recibe los píxeles puede capturarlos.

**Interacción propuesta:** acceso permitido/denegado y código encontrado/no encontrado, con datos de demostración. La explicación pública omite rutas privadas, cookies y detalles de tokens.

**Referencia del comportamiento:** [acceso a consultas](../../../src/features/public/access.ts), [consulta y entrega de imagen](../../../src/features/public/service.ts) y [concesiones de imagen](../../../src/features/public/grants.ts).

## Primera entrega propuesta

Una sola figura del caso CSV, tamaño **Figure** de Anatomy: un mecanismo de 40–80 piezas, SVG y controles HTML accesibles. El detalle corresponde a guías, topes, rodillos, bandejas y piezas de la mesa; cada parte debe contribuir a entender la inspección. No necesita WebGL, shaders ni una escena Hero.

Se construiría primero como HTML independiente con datos sintéticos y sin llamadas a la aplicación. El manual tendría una imagen estática con explicación textual; la versión interactiva sería un complemento consultable por separado. Así, leer el manual no dependería de ejecutar JavaScript.

Los estados, el movimiento y la lectura textual saldrían del mismo modelo de demostración. Los contadores representarían exclusivamente ese ejemplo; no serían métricas ni progreso real de importaciones.

### Condiciones para aceptar la figura

- Se entiende que la base candidata no se consulta antes de publicarse y que publicar no equivale a activar el enlace.
- Los estados coinciden con el comportamiento vigente del runner, sin tiempos ni porcentajes inventados.
- Controles utilizables con teclado, foco visible, explicación textual equivalente y movimiento reducido; ninguna instrucción depende solo de animación o color.
- Lectura correcta en móvil de 390 px y escritorio; pausa fuera de pantalla y ausencia de desplazamiento horizontal causado por la figura.
- Verificación visual y geométrica con las herramientas de Anatomy; comprobación pequeña del modelo para impedir publicar el ejemplo con errores.
- Sin datos de clientes, rutas reales del servidor ni acceso a servicios de producción.

Si se decide integrarla posteriormente en React/Next.js, revisar primero la documentación instalada de Next y reutilizar las convenciones de movimiento y ayuda del proyecto. La figura no debe añadir trabajo por fotograma al resto del panel.

## Qué dejaría fuera

No usaría Anatomy para decorar login, tablas, filtros, formularios, estadísticas o cada estado vacío. Tampoco sustituiría el visor documental, los controles reales de importación ni sus mensajes de error. No crearía una librería general de figuras, telemetría adicional, nuevos endpoints o nuevas dependencias.

La implementación del caso 1 sigue el [plan de Superpowers](../plans/2026-10-30-anatomy-csv.md). Los otros casos y la integración en el panel requieren una decisión posterior. No se publica en la galería de Anatomy ni se despliegan cambios.

## Verificación y límites

La recomendación se contrastó con los manuales, los estados de importación y los servicios de imágenes y consulta pública citados. El caso 1 incorpora comprobación del modelo, auditoría de geometría y recorrido en Chromium para estados, teclado, móvil y movimiento reducido. Estas comprobaciones no demuestran una mejora de comprensión: antes de ampliar el trabajo, conviene comprobar con un administrador si distingue carga, publicación y activación usando la figura.
