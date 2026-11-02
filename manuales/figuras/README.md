# Figuras de Cómo usar

Las tres secciones del panel incluyen una figura Anatomy interactiva con datos ficticios. No hacen cargas, consultas API ni cambios en registros reales.

- **Registros CSV:** mesa de inspección; [fuentes y comprobación](./carga-csv/README.md).
- **Imágenes:** ampliadora fotográfica de 64 piezas; [concepto y piezas](./imagenes/CONCEPT.md). La foto avanza al revisar o publicar. Incluye reemplazo con confirmación, archivo erróneo, NFS no disponible y limpieza pendiente.
- **Consulta pública:** archivador de 56 piezas; [concepto y piezas](./consulta/CONCEPT.md). La ficha se entrega solo cuando disponibilidad, acceso y código lo permiten. Campos e imagen se eligen por separado; revocar no borra una entrega anterior.

Cada objeto comparte el sombreado del kit MIT ya incluido. El componente `HowToFigure` mueve referencias SVG con suavizado temporal, pausa fuera de pantalla o al ocultar la pestaña y respeta movimiento reducido. Los recorridos automáticos se detienen al intervenir en los controles. Con movimiento reducido, **Ver siguiente paso** recorre el ejemplo manualmente.

## Regenerar y comprobar

Desde la raíz del repositorio:

```sh
node manuales/figuras/carga-csv/build.mjs --audit
node manuales/figuras/build-sections.mjs --audit
node manuales/figuras/carga-csv/check-model.mjs
node manuales/figuras/imagenes/check-model.mjs
node manuales/figuras/consulta/check-model.mjs
```

`build-sections.mjs` genera los JSON que recibe React y doce HTML de inspección estáticos en `output/anatomy-sections/`: cada figura en tema claro y oscuro, con posiciones -100, 0 y 100. La auditoría comprueba 201 posiciones por figura, soportes y cajas conservadoras sin intersecciones ni ciclos de profundidad. No es una simulación mecánica de cargas. Las formas son prismas, sin tubos, cables ni sólidos de revolución.

Las comprobaciones Node usan `check-model.mjs` para no mezclarse con la recolección de Vitest. El recorrido `tests/e2e/how-to-smoke.ts` comprueba los tres casos integrados, autorización, teclado, movimiento reducido, reinicio de recorridos y móvil/tablet/escritorio, contra la base temporal de pruebas.

Las líneas SVG también se comprueban con `scripts/lines.mjs` de Anatomy sobre las doce vistas. Las capturas a 4× y de móvil se guardan en `output/playwright/anatomy-sections/`; las del panel, en `output/playwright/how-to/`. Ninguna se publica en la galería de Anatomy.
