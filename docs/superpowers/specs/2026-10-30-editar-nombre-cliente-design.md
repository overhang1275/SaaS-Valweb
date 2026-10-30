# Diseño: editar el nombre de una cuenta de cliente

- **Intención:** permitir al administrador corregir el nombre visible de una cuenta existente desde Clientes.
- **Alcance:** añadir una acción Editar en cada fila. Abrirá la pestaña de cuenta existente con el nombre actual precargado y permitirá guardar el cambio.
- **Seguridad y datos:** la operación será exclusiva para ADMIN, validará un nombre no vacío de hasta 120 caracteres, conservará el ID, estado, usuarios y relaciones de la cuenta, y registrará auditoría siguiendo las mutaciones existentes.
- **Fuera de alcance:** cambiar estado, reasignar usuarios o validaciones, editar datos de usuarios y eliminar cuentas.
- **Enfoque elegido:** reutilizar la pestaña/formulario existente de cuenta en vez de convertir cada fila en edición en línea; reduce duplicación y mantiene legible la tabla.
- **Criterio de aceptación:** un administrador puede abrir una cuenta existente, ver su nombre actual, guardar otro nombre y ver el listado actualizado; usuarios sin rol ADMIN no pueden ejecutar la acción.
