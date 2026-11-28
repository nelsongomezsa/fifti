import type { Locator, Page } from "@playwright/test";

/** La fila deslizable que contiene un texto, y su botón «⋯». */
export const swipeRow = (page: Page, text: string | RegExp) => page.locator("[data-swipe-row]").filter({ hasText: text }).first();
export const options = (page: Page, text: string | RegExp) => swipeRow(page, text).getByRole("button", { name: /^Opciones de / });

/** Gesto con el dedo de verdad (eventos táctiles del navegador). Solo en el proyecto móvil. */
export async function swipe(page: Page, target: Locator, dx: number, dy = 0) {
  // Al centro: abajo del todo la taparía la barra de navegación y el dedo caería en ella
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await target.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + (dx * i) / 10, y: from.y + (dy * i) / 10 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Pulsa una acción de la fila como lo haría cada cual: deslizando con el dedo o desde «⋯» con el ratón o el teclado. */
export async function rowAction(page: Page, isMobile: boolean, text: string | RegExp, action: string) {
  const row = swipeRow(page, text);
  // Una fila puede llevar otras dentro: la primera coincidencia es la suya
  if (isMobile) await swipe(page, row.locator("[data-swipe-content]").first(), action === "Borrar" ? -120 : 120);
  else await options(page, text).first().click();
  const button = row.getByRole("button", { name: action, exact: true }).or(row.getByRole("link", { name: action, exact: true }));
  await button.first().click();
}
