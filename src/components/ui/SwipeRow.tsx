"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useTx } from "@/i18n/tx-client";
import { CHANGES_SHEET_CONTEXT, DELETED_LABEL, type DeleteKind } from "@/lib/delete-kinds";
import { sheetContextChanged } from "@/lib/sheet-context";
import { clampOffset, fromEdge, release, REVEAL, swipeAxis } from "@/lib/swipe";
import { deleteItem } from "@/server/actions/delete";

const UNDO_MS = 5000;

/** La acción secundaria de una lista: ir a editar, abrir el desplegable de la fila o ejecutar algo (archivar, marcar pagado). */
export type SecondaryAction = { label: string } & ({ href: string } | { expand: true } | { run: () => Promise<{ ok: boolean; error?: string } | void> });

type Props = {
  id: string;
  /** Qué es, para la etiqueta accesible del botón «⋯» */
  name: string;
  /** Sin `kind` (o sin permiso) la fila no ofrece borrar */
  kind?: DeleteKind;
  /** Con confirmación cuando borra más de lo que se ve; sin ella, se borra y se puede deshacer 5 s */
  confirm?: { title: string; description: string };
  /** Borrado con diálogo propio (cuentas, categorías) */
  dialog?: (close: () => void) => React.ReactNode;
  secondary?: SecondaryAction;
  children: React.ReactNode;
};

// Solo una fila abierta a la vez en toda la pantalla
let closeOpenRow: (() => void) | null = null;

/**
 * Fila que se puede borrar. Con el dedo: a la izquierda «Borrar», a la derecha la acción secundaria; deslizando hasta el final se
 * ejecuta al soltar. Con ratón, teclado o lector de pantalla: botón «⋯» con las mismas opciones.
 *
 * Deshacer: no se envía nada al servidor hasta que pasan los 5 s (o se sale de la pantalla). Si se cierra la app antes, el borrado se cancela.
 */
export function SwipeRow({ id, name, kind, confirm, dialog, secondary, children }: Props) {
  const x = useTx();
  const router = useRouter();
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const [state, setState] = useState<"idle" | "removed" | "gone">("idle");
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; axis: "x" | "y" | null; width: number; offset: number } | null>(null);
  const swiped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef(false);

  const canDelete = !!kind || !!dialog;
  const close = useCallback(() => { setDx(0); setMenu(false); }, []);
  const claim = () => { if (closeOpenRow && closeOpenRow !== close) closeOpenRow(); closeOpenRow = close; };

  const fail = (message?: string) => { setState("idle"); setError(message ?? x("No se ha podido completar.")); setTimeout(() => setError(null), 4000); };

  const erase = async () => {
    if (!kind) return { ok: false as const };
    const r = await deleteItem({ kind, id }).catch(() => ({ ok: false, error: undefined }));
    if (r.ok) {
      if (CHANGES_SHEET_CONTEXT.has(kind)) sheetContextChanged();
      router.refresh();
    }
    return r;
  };

  const commit = async () => {
    if (!pending.current) return;
    pending.current = false;
    if (timer.current) clearTimeout(timer.current);
    setState("gone");
    const r = await erase();
    if (!r.ok) fail("error" in r ? r.error : undefined);
  };
  // Al salir de la pantalla con el aviso a la vista, el borrado se completa
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });
  useEffect(() => () => { void commitRef.current(); if (closeOpenRow === close) closeOpenRow = null; }, [close]);

  // Tocar fuera cierra la fila abierta
  const open = dx !== 0 || menu;
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => { if (!root.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key); };
  }, [open, close]);

  const remove = () => {
    close(); setError(null);
    if (dialog || confirm) { setAsking(true); return; }
    setState("removed"); pending.current = true;
    timer.current = setTimeout(() => void commitRef.current(), UNDO_MS);
  };
  const undo = () => { if (timer.current) clearTimeout(timer.current); pending.current = false; setState("idle"); };

  const runSecondary = async () => {
    close(); setError(null);
    if (!secondary) return;
    if ("href" in secondary) { router.push(secondary.href); return; }
    if ("expand" in secondary) {
      const details = root.current?.querySelector("details");
      if (details) { details.open = true; details.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button")?.focus(); }
      return;
    }
    const r = await Promise.resolve(secondary.run()).catch(() => ({ ok: false, error: undefined }));
    if (r && !r.ok) { fail(r.error); return; }
    sheetContextChanged();
    router.refresh();
  };

  const onDown = (e: React.PointerEvent) => {
    swiped.current = false;
    // El ratón no desliza (usa «⋯»); sobre un campo o un formulario abierto, tampoco
    if (e.pointerType === "mouse" || (e.target as Element).closest("input, select, textarea, form")) return;
    drag.current = { x: e.clientX, y: e.clientY, base: dx, axis: null, width: e.currentTarget.getBoundingClientRect().width, offset: dx };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = drag.current; if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (s.axis === null) {
      s.axis = swipeAxis(mx, my);
      if (s.axis === "x" && fromEdge(s.x, mx)) s.axis = "y";
      if (s.axis === "x") { claim(); setMenu(false); setDragging(true); e.currentTarget.setPointerCapture(e.pointerId); }
    }
    if (s.axis !== "x") return;
    swiped.current = true;
    s.offset = clampOffset(s.base + mx, s.width, canDelete, !!secondary);
    setDx(s.offset);
  };
  const onUp = (e: React.PointerEvent) => {
    const s = drag.current; drag.current = null; setDragging(false);
    if (!s || s.axis !== "x") return;
    const result = e.type === "pointercancel" ? "close" : release(s.offset, s.width);
    if (result === "run-delete") remove();
    else if (result === "run-secondary") void runSecondary();
    else setDx(result === "open-delete" ? -REVEAL : result === "open-secondary" ? REVEAL : 0);
  };
  // Tras deslizar, o con la fila abierta, el toque no navega
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swiped.current && dx === 0) return;
    e.preventDefault(); e.stopPropagation();
    if (!swiped.current) close();
    swiped.current = false;
  };

  if (state === "gone") return null;
  if (state === "removed" && kind) {
    return (
      <div role="status" className="anim-fade flex min-h-14 items-center justify-between gap-3 rounded-card border border-dashed border-border px-4 text-sm text-ink-2">
        <span>{x(DELETED_LABEL[kind])}</span>
        <button type="button" onClick={undo} className="min-h-11 px-3 font-semibold text-ink">{x("Deshacer")}</button>
      </div>
    );
  }
  if (!canDelete && !secondary) return <>{children}</>;

  const item = "flex min-h-11 w-full items-center rounded-card px-4 text-left text-sm font-semibold hover:bg-surface";
  const side = "absolute inset-y-0 flex items-center justify-center text-sm font-semibold";
  return (
    <div ref={root} data-swipe-row className="relative">
      <div className="flex items-stretch gap-1">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-card">
          {dx < 0 && <button type="button" onClick={remove} className={`${side} right-0 bg-over text-on-accent`} style={{ width: Math.max(REVEAL, -dx) }}>{x("Borrar")}</button>}
          {dx > 0 && secondary && <button type="button" onClick={() => void runSecondary()} className={`${side} left-0 bg-surface-2 text-ink`} style={{ width: Math.max(REVEAL, dx) }}>{secondary.label}</button>}
          <div data-swipe-content className={`relative touch-pan-y bg-bg ${dragging ? "" : "transition-transform duration-150 ease-out motion-reduce:transition-none"}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClickCapture={onClickCapture}>
            {children}
          </div>
        </div>
        <button type="button" aria-label={`${x("Opciones de")} ${name}`} aria-expanded={menu} onClick={() => { if (!menu) claim(); setDx(0); setMenu(!menu); }}
          className="grid min-h-11 w-9 shrink-0 place-items-center self-center rounded-full text-lg leading-none text-ink-3 hover:bg-surface-2">⋯</button>
      </div>
      {menu && (
        <ul className="anim-fade absolute right-10 top-1 z-30 w-48 rounded-card border border-border bg-surface-2 p-1 shadow-lg">
          {secondary && (
            <li>{"href" in secondary
              ? <Link href={secondary.href} onClick={close} className={item}>{secondary.label}</Link>
              : <button type="button" onClick={() => void runSecondary()} className={item}>{secondary.label}</button>}</li>
          )}
          {canDelete && <li><button type="button" onClick={remove} className={`${item} text-over-text`}>{x("Borrar")}</button></li>}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-center text-xs text-over-text">{error}</p>}
      {asking && dialog?.(() => setAsking(false))}
      {asking && !dialog && confirm && <ConfirmDialog title={confirm.title} description={confirm.description} onConfirm={erase} onClose={() => setAsking(false)} />}
    </div>
  );
}
