# Figura de carga y publicación CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Entregar la figura autónoma del caso 1 elegido por el usuario.

**Architecture:** HTML independiente generado con SVG de Anatomy, CSS y JavaScript incluidos. Un modelo puro de demostración controla estados, texto y posición; no importa servicios de Valweb ni accede a red.

**Tech Stack:** Node.js, SVG, HTML, CSS, node:test; Chromium para comprobación visual.

**Spec:** `docs/superpowers/specs/2026-10-30-anatomy-usos-design.md`, caso 1 y primera entrega propuesta.

## Global Constraints

- Una figura de 40–80 piezas, sin WebGL, nuevas dependencias o integración en el panel.
- Datos sintéticos; folio como texto y búsqueda por alfanumérico.
- Publicar requiere mapeo correcto, procesamiento sin errores y revisión; no activa el enlace.
- Teclado, foco visible, movimiento reducido y pausa fuera de pantalla; versión estática para el manual.
- Trabajar en archivos propios de capacitación y conservar los cambios existentes del usuario. No hacer commits ni despliegues.

## Review Focus

- Publicación antes de revisión o con errores: debe bloquearse en el modelo y en los controles.
- Cambio de ejemplo durante el recorrido: reiniciar la candidata sin modificar la base publicada del ejemplo.
- JavaScript deshabilitado o apertura por file://: explicación legible; HTML interactivo sin imports externos.
- Movimiento reducido y pestaña oculta: no mantener animación activa.
- Móvil y teclado: controles legibles, foco estable y sin desbordamiento.

### Task 1: Modelo de demostración y prueba

**Files:** `manuales/figuras/carga-csv/model.mjs`, `model.test.mjs`.
**Interfaces:** `initialState(example)`, `transition(state, action)`, `describe(state)`; acciones cargar/mapear/procesar/publicar y ejemplos válido/con errores. `describe` devuelve textos, posición y acciones disponibles para la vista.

- [x] Escribir pruebas: impedir saltos, bloquear duplicados, corregir mapeo, conservar folios y separar publicación/activación.
- [x] Ejecutar `node --test manuales/figuras/carga-csv/model.test.mjs` y observar el fallo inicial.
- [x] Implementar el modelo y obtener pruebas aprobadas.

### Task 2: Figura autónoma y manual

**Files:** `manuales/figuras/carga-csv/{build.mjs,geometry.mjs,live.mjs,style.css,index.html,carga-csv.svg,README.md,vendor/*}`, `manuales/panel-administracion-admin.md`, `.gitignore`.
**Interfaces:** builder importa el modelo y genera HTML con código incluido; geometría produce el SVG y el vector de desplazamiento. El manual enlaza el HTML y muestra el SVG.

- [x] Enumerar piezas, generar la mesa de inspección con profundidad y controles HTML; añadir explicación equivalente sin JavaScript.
- [x] Generar HTML y SVG claro, y variante oscura; mantener instrucciones de regeneración y licencia del kit copiado.
- [x] Verificar en navegador estados válido/con errores, reinicio, teclado, móvil, reduced-motion, ausencia de solicitudes externas y errores de consola.
- [x] Capturar y examinar figura completa, móvil, estados y detalle a 4×; comprobar extremos de líneas con Anatomy.
- [x] Enlazar en el manual y verificar pruebas, regeneración reproducible y enlaces locales.

## Ejecución

El usuario pidió implementar el caso 1. Ejecución directa en esta sesión para entregar los archivos revisables, sin un nuevo paso de aprobación de la propuesta ya seleccionada.

## Resultado de verificación

Seis pruebas del modelo aprobadas; ESLint de los módulos propios sin errores. Auditoría de 65 piezas y 201 posiciones aprobada. Recorrido Chromium aprobado en 1440, 768, 390 y 320 px, con teclado, foco, duplicados, mapeo, conservación de base publicada, movimiento reducido, pausa fuera de pantalla, temas y JavaScript deshabilitado. Extremos de líneas de Anatomy: cero fallos en ambos temas. HTML y SVG se regeneran sin diferencias; enlaces locales y git diff --check correctos. Revisión independiente sin hallazgos importantes.

Decisiones: ejecución local sin commits, conservando los cambios ajenos existentes; kit mínimo de proyección copiado con licencia MIT para regeneración portable. No se ejecutó la suite de la aplicación porque no se modifica su código. Safari, Firefox, lectores de pantalla y validación con administradores quedan sin comprobar.
