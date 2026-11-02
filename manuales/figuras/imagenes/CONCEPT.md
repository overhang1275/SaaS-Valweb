# Imágenes · estación de revelado

Tamaño: Figure. Una ampliadora fotográfica de sobremesa, con columna, cabezal y portafotos deslizante entre la bandeja de originales y el archivo de copias. La foto avanza de x = −100 (original en espera) a x = 0 (revisión o error) y x = 100 (publicación).

## Verdad del mecanismo

La transferencia FTP deja archivos en la carpeta de entrada; no inicia el proceso. El usuario selecciona Local o NFS y pulsa Procesar. La indisponibilidad del destino bloquea el proceso y no cambia NFS por Local. Un lote nuevo correcto se publica al procesar; un reemplazo espera confirmación; cualquier error impide publicar. Los originales se retiran automáticamente después de publicar; si esa limpieza falla, quedan pendientes. El escenario de limpieza pendiente permite reintentar solo esa retirada. La pieza encendida es la fotografía, no la infraestructura. Esta figura simula un solo lote y no toca archivos ni red.

## Piezas, antes de geometría

- Bancada: placa gruesa y cuatro apoyos (5, explícitos); borde grabado y tornillos de esquina.
- Guía: dos raíles continuos, cuatro topes, dos regletas laterales y dos tapas de extremo (10).
- Ampliadora: zócalo de columna, columna inferior, collar intermedio, columna superior, cabezal de columna, brazo, placa de cabezal, cuerpo de cabezal, cubierta, marco de visor, cristal, dos soportes del enfoque, barra del enfoque y cuatro aletas de ventilación (18).
- Bandeja de originales: suelo, pared izquierda, pared derecha, pared trasera, dos hojas apiladas, dos presillas y asa frontal (9).
- Archivo de copias: suelo, pared izquierda, pared derecha, pared trasera, dos hojas, dos separadores y asa (9).
- Portafotos móvil: patín, placa, papel fotográfico, imagen iluminada, dos presillas y dos tiradores (8).
- Mandos: dos bases de pulsador, dos teclas y una placa de estado con tres renglones impresos (5).

Total construido: 64 sólidos contando los cinco de la bancada. Todos los módulos reposan sobre la bancada o sobre piezas de su propio módulo; el carro reposa sobre los raíles durante los 201 puntos de recorrido. Piezas rectangulares con biseles pequeños, tornillos en esquinas, juntas cerradas y renglones marcados como texto impreso. Sin tubos, cables ni cuerpos de revolución.

## Encuadre y movimiento

Cámara elevada a 35° para ver el papel, bandejas y rail, con acimut 46°. La columna queda detrás del recorrido y el cabezal alto deja aire sobre la foto. Los dos raíles cruzan toda la carrera; ningún elemento fijo cruza el volumen móvil. La interacción del panel mantiene el movimiento suavizado, teclado, foco visible y preferencia de movimiento reducido mediante el controlador común.

## Referencias funcionales

`src/features/imports/runner.ts`, `processImages`: los errores impiden publicación; las sustituciones de carpeta quedan en REVIEW; los nuevos se publican automáticamente. `src/features/imports/directory.ts`, `captureDirectoryImport` y `cleanupPublishedDirectoryOriginals`: carpeta explícita según almacenamiento, captura de archivos y retirada posterior a publicación. Los valores de la figura salen de `model.mjs`.
