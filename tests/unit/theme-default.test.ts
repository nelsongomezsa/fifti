import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("tema por defecto", () => {
  it("sin preferencia guardada el HTML sale en oscuro, desde el servidor (sin parpadeo)", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/get\("fifti_theme"\)\?\.value \?\? "dark"/);
    expect(layout).toMatch(/data-theme=\{theme === "light" \|\| theme === "dark" \? theme : undefined\}/);
  });
  it("Ajustes muestra Oscuro como valor por defecto y mantiene Claro y Sistema", () => {
    const mas = read("src/app/(app)/ajustes/page.tsx");
    expect(mas).toMatch(/get\("fifti_theme"\)\?\.value \?\? "dark"/);
    expect(mas).toMatch(/themeSystem/);
    expect(mas).toMatch(/themeLight/);
  });
});
