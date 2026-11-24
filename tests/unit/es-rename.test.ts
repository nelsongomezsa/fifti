import { describe, expect, it } from "vitest";
import { renameEs } from "@/i18n/es-rename";

describe("nombres tras el rediseño: espacios y partidas (con concordancia)", () => {
  it.each([
    ["Nueva burbuja", "Nuevo espacio"],
    ["Burbujas", "Espacios"],
    ["No encontramos esa burbuja.", "No encontramos ese espacio."],
    ["No perteneces a esa burbuja.", "No perteneces a ese espacio."],
    ["El redondeo solo se aplica a gastos de tu burbuja personal.", "El redondeo solo se aplica a gastos de tu espacio personal."],
    ["Cambia de burbuja arriba.", "Cambia de espacio arriba."],
    ["Todavía no hay gastos este mes en esta burbuja.", "Todavía no hay gastos este mes en este espacio."],
    ["Tu burbuja más activa", "Tu espacio más activo"],
    ["Saldo actual de la burbuja.", "Saldo actual del espacio."],
    ["Moneda distinta de la burbuja", "Moneda distinta del espacio"],
    ["Elige a la persona de tus burbujas.", "Elige a la persona de tus espacios."],
    ["Solo puedes vincular a alguien con quien compartes una burbuja", "Solo puedes vincular a alguien con quien compartes un espacio"],
    ["Fondos", "Partidas"],
    ["Nuevo fondo", "Nueva partida"],
    ["Fondo creado.", "Partida creada."],
    ["Fondo no válido", "Partida no válida"],
    ["Te has pasado de este fondo.", "Te has pasado de esta partida."],
    ["Vas por el 80 % del fondo", "Vas por el 80 % de la partida"],
    ["Vas por el 80 % de este fondo.", "Vas por el 80 % de esta partida."],
    ["Los porcentajes de los fondos superan el 100 %", "Los porcentajes de las partidas superan el 100 %"],
    ["Decide qué pasa con el sobrante de cada fondo.", "Decide qué pasa con el sobrante de cada partida."],
    ["Plan mensual por fondos", "Plan mensual por partidas"],
    ["Lo que va al fondo de Ahorro entre tus ingresos", "Lo que va a la partida de Ahorro entre tus ingresos"],
    ["Fondos y categorías ›", "Partidas y categorías ›"],
    ["Sin fondo", "Sin partida"],
    ["12 meses por fondo", "12 meses por partida"],
  ])("%s", (es, nuevo) => expect(renameEs(es)).toBe(nuevo));
  it("no toca el resto del texto", () => {
    expect(renameEs("Apunta un gasto en segundos")).toBe("Apunta un gasto en segundos");
  });
});
