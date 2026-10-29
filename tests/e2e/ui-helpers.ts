import type { Page } from "playwright";

export async function confirmAction(page: Page, trigger: () => Promise<unknown>, accept = true) {
  await trigger();
  const dialog = page.getByRole("alertdialog", { name: "Confirmar acción" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: accept ? "Confirmar" : "Cancelar", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}
export async function selectTab(page: Page, name: "Resumen" | "Registros" | "Imágenes" | "Apariencia" | "Ajustes") {
  await page.getByRole("tab", { name, exact: true }).click();
  await page.getByRole("tabpanel", { name, exact: true }).waitFor();
}
