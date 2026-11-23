"use client";

/** Teclado numérico propio: evita abrir el del móvil. Zonas táctiles de 56 px. */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === ",") {
      if (value.includes(",")) return;
      return onChange(value === "" ? "0," : value + ",");
    }
    const [whole = "", frac] = value.split(",");
    if (frac !== undefined) {
      if (frac.length >= 2) return;
    } else if (whole.length >= 9) return;
    onChange(value === "0" ? k : value + k);
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "⌫"];
  return (
    <div role="group" aria-label="Teclado numérico" className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          aria-label={k === "⌫" ? "Borrar" : k === "," ? "Coma decimal" : k}
          className="min-h-14 rounded-card bg-surface-2 font-mono text-2xl text-ink active:bg-track"
        >
          {k}
        </button>
      ))}
    </div>
  );
}
