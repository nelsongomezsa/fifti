"use client";


import { useTx } from "@/i18n/tx-client";
import { useState } from "react";

export function CopyButton({ text, label, shareTitle }: { text: string; label?: string; shareTitle?: string }) {
  const x = useTx();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="min-h-11 rounded-full border border-border px-4 text-sm font-medium"
      onClick={async () => {
        try {
          if (shareTitle && typeof navigator.share === "function") await navigator.share({ title: shareTitle, text });
          else await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch { /* cancelado por el usuario */ }
      }}
    >
      {done ? x("Copiado") : (label ?? x("Copiar"))}
    </button>
  );
}
