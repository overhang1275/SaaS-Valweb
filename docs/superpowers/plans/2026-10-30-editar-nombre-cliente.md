# Editar nombre de cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir a ADMIN cambiar el nombre de una cuenta desde Clientes sin modificar sus relaciones.

**Architecture:** Reutilizar el formulario de cuenta existente, precargado al elegir Editar en una fila. Una Server Action autoriza ADMIN, valida el ID y el nombre, y delega al servicio de identidad para actualizar y auditar.

**Tech Stack:** Next.js 16 Server Actions, React, Prisma, Zod.

**Spec:** `docs/superpowers/specs/2026-10-30-editar-nombre-cliente-design.md`

## Global Constraints

- Solo ADMIN puede editar cuentas.
- Nombre requerido, trim y máximo 120 caracteres.
- No cambiar ID, estado, usuarios ni validaciones.
- Usar el formulario y patrones de acciones ya existentes; sin dependencias nuevas.

## Review Focus

- ID de cuenta ausente o inválido: rechazar sin mutar.
- Nombre vacío o mayor de 120: rechazar antes de persistir.
- Llamada no ADMIN: rechazar en el servidor, aunque se invoque la acción directamente.
- Edición desde listado filtrado/paginado: conservar el destino correcto de la cuenta.
- Al guardar: conservar relaciones y refrescar la vista de administración.

## Files

- Modify `src/features/identity/service.ts`: update transaccional de nombre y evento de auditoría.
- Modify `src/app/actions.ts`: acción exclusiva ADMIN con validación de ID y respuesta de formulario.
- Modify `src/app/(panel)/admin/clientes/page.tsx`: enlace Editar y formulario precargado/guardado.
- Create `src/features/identity/tenant-name-form.tsx`: formulario de edición a ancho completo con acciones agrupadas y error asociado al campo.

## Tasks

### Task 1: Servicio y acción de actualización

- [x] Añadir `updateTenantName(actor: Actor, id: string, input: { name: string })`; validar UUID, validar nombre con `nameSchema`, confirmar ADMIN en transacción, actualizar solo `name` y registrar `TENANT_UPDATED`.
- [x] Añadir `updateTenantNameAction` usando `adminMutation`, leyendo `id` y `name` de FormData y mostrando mensaje de éxito adecuado.
- [x] Revisar el diff para confirmar que no se actualizan relaciones ni estado.

### Task 2: Flujo de edición

- [x] Hacer que cada fila enlace a `/admin/clientes?editar=<id>&tab=crear`, conservando filtros y paginación actuales.
- [x] Si el ID seleccionado está en los resultados actuales, mostrar el nombre precargado, acción de actualización y título/botón “Editar cuenta”/“Guardar cambios”; sin `editar`, conservar creación.
- [x] Asegurar ancho completo del campo, agrupar Guardar/Cancelar y asociar validación de nombre al input con `aria-invalid` y `aria-describedby`; Cancelar vuelve al listado conservando filtros/página.
- [x] Dar a cada enlace Editar un nombre accesible con el nombre de cuenta y un mensaje específico para nombres inválidos.
- [x] Ejecutar verificación estática y validar en Chromium el guardado, el mensaje de validación y la vista móvil (390 px) con `valweb_test`; no se añadió ni ejecutó una suite automatizada.
