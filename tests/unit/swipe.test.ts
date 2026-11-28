import { describe, expect, it } from "vitest";
import { clampOffset, fromEdge, fullSwipe, release, swipeAxis } from "@/lib/swipe";

describe("gesto de deslizar", () => {
  it("el scroll vertical y las diagonales no son un deslizamiento", () => {
    expect(swipeAxis(4, 6)).toBeNull();
    expect(swipeAxis(2, 80)).toBe("y");
    expect(swipeAxis(40, 40)).toBe("y");
    expect(swipeAxis(-60, 30)).toBe("x");
  });
  it("desde el borde izquierdo y hacia la derecha es el «atrás» del sistema", () => {
    expect(fromEdge(8, 50)).toBe(true);
    expect(fromEdge(8, -50)).toBe(false);
    expect(fromEdge(200, 50)).toBe(false);
  });
  it("soltar: cierra, descubre el botón o, si se llega lejos, actúa", () => {
    expect(release(-20, 360)).toBe("close");
    expect(release(-90, 360)).toBe("open-delete");
    expect(release(90, 360)).toBe("open-secondary");
    expect(release(-fullSwipe(360), 360)).toBe("run-delete");
    expect(release(fullSwipe(360), 360)).toBe("run-secondary");
  });
  it("sin acción a un lado no se puede deslizar hacia él", () => {
    expect(clampOffset(80, 360, true, false)).toBe(0);
    expect(clampOffset(-80, 360, false, true)).toBe(0);
    expect(clampOffset(-999, 360, true, true)).toBe(-360);
  });
});
