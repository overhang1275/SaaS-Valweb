# Valweb · Computer Forms — sistema visual

Valweb es la plataforma de validación documental de **Computer Forms**. Esta versión sustituye la dirección frambuesa de las fases iniciales por instrucción explícita del propietario. La UI muestra datos reales de PostgreSQL; los conceptos y fixtures de prueba nunca se convierten en métricas de producción.

## Identidad y color

El SVG oficial se guarda en `public/brand/computerforms.svg`, obtenido de https://computerforms.com.mx/brand/logo.svg y revisado sin scripts ni referencias externas. Se mantiene el nombre Valweb como producto con firma Computer Forms, sin alterar el logo corporativo.

| Token | Valor | Uso |
|---|---|---|
| brand-navy / text | `#002a45` | Texto principal y botones primarios |
| brand-red / accent | `#e5213c` | Marca, subrayado de selección, foco e indicadores |
| brand-yellow | `#f8af00` | Color corporativo secundario; reservado, sin usarlo como texto sobre blanco |
| brand-ink | `#242c47` | Navy corporativo secundario |
| accent-ink | `#aa1b30` | Texto rojo accesible y selección sobre fondos claros |
| ground | `#f5f7fa` | Lienzo frío neutro |
| surface | `#ffffff` | Paneles y formularios |
| raised | `#eef2f6` | Controles y estados de hover |
| border / control | `#e2e8ef` / `#cbd5df` | Separadores y límites interactivos |
| muted | `#5e6e80` | Texto secundario con contraste AA |

Éxito verde, advertencia ámbar y error rojo comunican estado con texto e icono, nunca solo color. Navy/blanco14.82:1; muted/ground4.87:1; rojo oscuro/soft6.58:1. El rojo oficial/blanco4.55:1 tiene poco margen, por eso el texto pequeño usa accent-ink y los CTA navy. Amarillo/blanco no es accesible y no se usa.

## Tipografía, espacio y superficie

DM Sans local, pesos400/500/600/700. Títulos24–30px, secciones16–20, cuerpo14–16, ayudas13, metadatos12. Figuras de métricas28–34 con números tabulares. Inputs de texto móviles16px. Controles táctiles al menos44px, foco visible3px y estados pressed/disabled/loading explícitos.

Base de4/8px, separación de campos20–22, superficies20–24, gutters20 móvil/28–36 desktop. Sidebar248px (210 tablet); contenido máximo1440px. Grid del editor: contenido flexible + inspector300px y gutter24; al reducir ancho se apila. Radios8px controles,12px grupos,16px superficies,18px overlays. Sombras pequeñas derivadas de navy, una elevación mayor exclusiva de overlays. Blur corto solo en header sticky y fondo de overlays, sin glow, canvas ni vídeo decorativo.

## Arquitectura de información

- **Resumen:** validaciones recientes y conteos reales, acceso a creación y guía del flujo, información personal secundaria en disclosure.
- **Validaciones:** búsqueda por nombre/título y filtro de estado mediante GET, tabla con acciones y scroll interior, vacío con siguiente acción y recuperación de búsqueda sin resultados.
- **Estándar de búsquedas administrativas:** todos los listados con búsqueda utilizan `SearchFilters` y `SearchFilterInput` de `src/components/search-filters.tsx`, derivados del catálogo “Imágenes por alfanumérico”. Panel blanco con etiquetas visibles, icono de búsqueda, acción Buscar, ayuda, valores en URL mediante GET, indicador “Filtros aplicados” y enlace “Limpiar filtros”. Los filtros avanzados existentes se agrupan en “Más filtros” y se abren cuando están aplicados. Cada pantalla conserva sus campos, límites y semántica; limpiar reinicia los controles y conserva el contexto de vista cuando corresponde. El diseño se apila en móvil. La verificación pública por código utiliza su flujo documental, sin filtros administrativos. Los futuros listados con búsquedas deben reutilizar este patrón.
- **Editor:** pestañas enlazables Resumen / Registros e imágenes / Apariencia / Ajustes. La selección vive en `?tab=` con historial del navegador. Radix gestiona teclado, selección y paneles. Los formularios se mantienen montados para conservar cambios y archivos al cambiar de pestaña.
- **Contexto del editor:** disponibilidad y enlace en inspector persistente en desktop, estadísticas reales visibles. En móvil los tabs secundarios muestran primero su contenido; métricas permanecen en Resumen y publicación/enlace siguen disponibles debajo del panel.
- **Registros e imágenes:** recepción CSV/ZIP, trabajos con progreso y estados semánticos; historial por disclosure y reporte detallado descargable dentro del trabajo. Errores y trabajo reciente abiertos; anteriores completos recogidos. Catálogo completo en ruta paginada, preview de cuatro imágenes para reducir peso.
- **Apariencia:** modo de imagen y campos visibles. **Ajustes:** textos, descripción y zona de riesgo recogida, con confirmación antes de borrar.
- **Clientes/usuarios:** pestaña **Listado** con búsqueda, filtros y tabla paginada en servidor a 25/50 filas; pestaña independiente **Crear cuenta** o **Invitar usuario** para el formulario. No se colocan formularios al pie de las listas. Una sola franja de resultados/paginación al pie; si cabe en una página, solo rango y total, sin controles inútiles ni contadores repetidos. Las pestañas conservan filtros, página, historial y borradores al alternar. Invitar usuario contiene únicamente nombre, correo y selección de cuenta: no lleva buscador. El rol cliente no ve invitación ni acciones administrativas.
- **Ajustes generales:** acceso exclusivo de administradores; estado real de base, procesador y almacenamiento en filas, conteos de cargas y recuperación con confirmación. Comprobación visible cada10segundos; no se inventa disponibilidad si falta el gestor de servicios. Conserva el shell y los tokens existentes, con botones planos y texto de firma/pie de al menos11px.
- **Navegación móvil:** sheet Radix con título/descripcion, foco contenido, Escape y cierre al navegar. Breadcrumbs en editor y regreso en rutas profundas.
- **Ayuda:** popovers accesibles para reglas que no deben alargar permanentemente la pantalla. Sin tooltip obligatorio para entender un icono.
- **Confirmaciones:** AlertDialog compartido para publicar, reemplazar, eliminar, desactivar o suspender; foco inicial en Cancelar, Escape cancela y el foco regresa al control original. Se conserva el contrato de Server Actions y validaciones servidor.

No se añade command palette: las cuatro rutas principales no la requieren. No se trasladan formularios largos a modales ni se cambia el modelo de permisos por estética.

## Movimiento y carga

`--motion-fast:120ms`, `--motion-normal:180ms`, `--motion-panel:240ms`, `--ease:cubic-bezier(.22,1,.36,1)`. Feedback de botones y flechas, entrada corta de páginas/tabs, sheet lateral y diálogo centrado. MotionConfig con reducedMotion=user y LazyMotion/domAnimation; CSS anula transiciones, desplazamientos y shimmer con prefers-reduced-motion. El contenido debe seguir legible sin movimiento.

Skeletons específicos de lista, dashboard, formulario, editor y galería conservan la anatomía de cada ruta; skeleton de consulta pública y fondo de imagen con aspect-ratio reservan espacio hasta su carga. Carga anunciada mediante status/aria-busy y formas decorativas aria-hidden. No se inventan gráficas, avatares remotos ni mapas inexistentes. Errores ofrecen reintento; un registro no encontrado nunca conserva la imagen anterior. Los campos ocultos se siguen filtrando en servidor.

## Componentes y ejemplos

Componentes en `src/components/ui/`: MotionProvider/PageTransition, ConfirmationProvider/useConfirm, HelpPopover, Skeleton/PageSkeleton/ResultSkeleton. Tabs y sheet en ValidationWorkspace/MobileNavigation. Son React/TypeScript, con primitivas Radix personalizadas siguiendo composición shadcn y tokens propios; no se instala un segundo sistema visual.

```tsx
<HelpPopover label="Requisitos para activar"><p>Publica una base y relaciona sus imágenes.</p></HelpPopover>
<PageSkeleton variant="editor" />
// Dentro de ConfirmationProvider:
const confirm = useConfirm();
if (await confirm("¿Eliminar este archivo?")) await deleteFile();
```

## Referencias y decisiones

- Awesome Design MD: https://github.com/voltagent/awesome-design-md, registrado en `.codex/agents/desig-auditor.toml`. Referencias pertinentes y evidencia en informes de design-auditor.
- React Bits: https://reactbits.dev/, referencia de continuidad e interacción, sin copiar efectos de fondo ni cursores ajenos al producto.
- shadcn/ui y Radix: patrones accesibles de tabs, sheet, popover y alertdialog personalizados.
- Motion: motor de animación React. CSS para estados sencillos y skeletons.
- Magic UI / Aceternity / Origin UI: referencias consultadas; no se importan catálogos completos.
- GSAP, React Spring, Lottie, Rive y React Three Fiber no se añaden: no hay timelines complejos, ilustración interactiva ni3D que justifique otro motor o WebGL.

Concepto vigente: `docs/design/premium-computerforms-concept.png`; el concepto anterior frambuesa se conserva solo como historial. Diferencias intencionales: se usa UUID real y alfanumérico, noCURP; no se implementan controles ficticios del concepto, números inventados ni cambio de cuenta propietaria; publicación sigue junto al contenido desktop y debajo en móvil para dar prioridad al tab seleccionado. La ilustración de documento del acceso es HTML/CSS decorativo aria-hidden, no un certificado ni una métrica real.

## Mantenimiento

Definir tokens en globals.css y reutilizar primitivas antes de crear variantes. Ninguna pantalla nueva debe introducir paleta, radios o duraciones independientes. Exigir labels, foco, reduced-motion, estados loading/empty/error y revisión móvil/tablet/desktop. Ejecutar regresiones existentes al cambiar estructura o confirmaciones. La UI no altera límites de CSV/ZIP, permisos, credenciales, correo ni almacenamiento.

Evidencia histórica: docs/design-audit/phase-2-images.md, bulk-alfanum.md y statistics.md. Auditoría del rediseño: premium-before.md, premium-round-1.md y latest.md.

## Visor de documentos

La imagen pública se dibuja en canvas dentro de un marco acotado. Toolbar con zoom1–5 y Ajustar, output de porcentaje, teclado/flechas, arrastre y pinch. El lector mantiene los campos de texto y descripción alternativa fuera del dibujo. Un área de ayuda identifica los gestos; los controles tienen nombres accesibles y44px. Loading/error/retry conservan un espacio de viewport y el foco visible; no hay animación automática del documento. Reducir movimiento no impide la interacción directa.

La entrega de píxeles pasa por POST con grant temporal y cookie HttpOnly vinculada; no hay img/src ni URL de descarga en el resultado. Es control de acceso y presentación, no protección total contra capturas o extracción de píxeles del navegador autorizado.

## Instalación de consultas públicas

Cada enlace tiene identidad/start_url/scope de manifest propios y conserva nombre/iconos corporativos. La instalación es una acción secundaria, con ayuda contextual para plataformas sin diálogo de instalación. El panel administrativo mantiene navegación web normal. Sin conexión se muestra una página simple de recuperación, sin resultados ni imágenes persistidos; la funcionalidad de consulta exige red. La PWA conserva las autorizaciones temporales del visor y no agrega permisos, push ni almacenamiento de documentos.

La consulta pública y su acceso protegido reutilizan la composición de autenticación de `/login`: cabecera compartida, panel ilustrado de Computer Forms en escritorio y formulario alineado en la columna derecha; en móvil el panel desaparece y queda el formulario a ancho completo. La búsqueda se identifica como **Código alfanumérico**; el folio es un dato de resultado, no el parámetro que acepta la consulta. La búsqueda conserva el POST actual y presenta primero los campos del resultado y luego el visor. La instalación PWA aparece después del contenido principal para no competir con la tarea.
