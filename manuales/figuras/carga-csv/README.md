# Simulación de carga y publicación CSV

Abre [index.html](./index.html) directamente en un navegador, incluso sin conexión. No requiere arrancar Valweb. Si GitHub u otro visor muestra el código del HTML, descarga el archivo y ábrelo localmente. [oscuro.html](./oscuro.html) ofrece la misma figura en tema oscuro; [carga-csv.svg](./carga-csv.svg) es la versión estática del manual.

La mesa representa el recorrido de una base candidata: entrada, mapeo, procesamiento/revisión y publicación. Prueba el CSV sin errores y el CSV con `ABC102`/`abc102` duplicado. Asignar `folio` como columna de búsqueda bloquea el procesamiento hasta corregir el mapeo. Los números pertenecen exclusivamente a los tres registros ficticios.

El recorrido automático avanza cada cinco segundos de actividad visible. Se detiene al usar los controles y puede pausarse o reiniciarse con su botón. Con movimiento reducido, los pasos se hacen manualmente y la ficha cambia de posición sin animación. Los controles HTML admiten Tab, Enter, espacio y las teclas habituales de un selector. Al ocultar la pestaña o salir la figura de pantalla, se detiene la animación.

La publicación cambia únicamente la base del ejemplo y conserva el enlace como pendiente de activación. Volver a cargar o elegir otro CSV conserva la base ya publicada del ejemplo. Recargar la página reinicia la demostración. No hay cargas reales, llamadas API, métricas de producción ni persistencia.

## Regenerar y comprobar

Desde la raíz del repositorio, con Node.js 22:

```sh
node manuales/figuras/carga-csv/model.test.mjs
node manuales/figuras/carga-csv/build.mjs --audit
node manuales/figuras/carga-csv/build.mjs --dark
```

La auditoría local comprueba 65 piezas, intersecciones y orden de profundidad de sus volúmenes conservadores en 201 posiciones de la ficha, y conexión física de las piezas en reposo. No es un análisis mecánico de cargas. No hay tubos, cables ni sólidos de revolución que requieran los verificadores específicos de Anatomy.

El kit de proyección y sombreado de [Anatomy](https://github.com/wheresryan22/anatomy) se conserva en `vendor/iso-kit.mjs`, bajo [licencia MIT](./vendor/LICENSE). Solo se utiliza al generar los archivos; el HTML incluye todo lo necesario y la atribución. Para cambiar el comportamiento, editar `model.mjs`; para dibujo, `geometry.mjs`; controles y movimiento, `live.mjs`; presentación, `style.css`. Regenerar ambos HTML después de cambiar las fuentes.

La revisión de navegador se ejecuta con Playwright ya disponible en el entorno de pruebas del proyecto:

```sh
CHROME_PATH=/ruta/a/chromium node manuales/figuras/carga-csv/browser-check.mjs
```

Las capturas quedan en `output/playwright/anatomy-csv/`, excluido de Git. Esta comprobación no necesita base de datos ni servidor web.
