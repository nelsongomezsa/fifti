import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { addFavoriteForm, deleteFavorite } from "@/server/actions/expenses";
import { setMirrorPref } from "@/server/actions/plan";
import { PasswordForm } from "@/components/ui/PasswordForm";
import { PushSettings } from "@/components/pwa/PushSettings";
import { vapidPublicKey } from "@/lib/vapid";
import { savePrefs } from "@/server/actions/push";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { LockSettings } from "@/components/lock/LockSettings";
import { deleteAccount, setLocale, setTheme, toggleAiPhrases, toggleDiscreet } from "@/server/actions/prefs";
import { requireUser, listMySpaces } from "@/server/spaces";
import { changePassword, signOut, upgradeGuest } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Más" };

export default async function MorePage() {
  const x = await getTx();
  const user = await requireUser();
  const spaces = await listMySpaces();
  const t = await getTranslations("more");
  const locale = await getLocale();
  const theme = (await cookies()).get("fifti_theme")?.value ?? "system";
  const supabase = await createClient();
  const { data: pf } = user.is_anonymous ? { data: [] } : await supabase.from("spaces").select("id").eq("kind", "personal").maybeSingle().then((r) => ({ data: r.data ? [r.data] : [] }));
  const { data: pFunds } = pf?.[0] ? await supabase.from("funds").select("id, name, system_key").eq("space_id", pf[0].id).order("position") : { data: [] };
  const { data: prefs } = await supabase.from("mirror_prefs").select("space_id, enabled, fund_id");
  const { data: archived } = await supabase.from("spaces").select("id, name").eq("kind", "group").not("archived_at", "is", null).order("archived_at", { ascending: false });
  const { data: prefRow } = user.is_anonymous ? { data: null } : await supabase.from("notification_prefs").select("*").maybeSingle();
  const { data: aiRow } = user.is_anonymous ? { data: null } : await supabase.from("profiles").select("ai_phrases").maybeSingle();
  const aiOn = !!aiRow?.ai_phrases;
  const { data: favs } = await supabase.from("favorites").select("id, label, amount_cents").order("label");
  return (
    <section className="flex flex-col gap-4 pt-2">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm text-ink-3">{user.is_anonymous ? x("Sesión de invitado") : x("Sesión iniciada como")}</p>
        <p className="mt-1 break-all">{user.is_anonymous ? x("Sin cuenta") : user.email}</p>
      </div>

      {user.is_anonymous && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">{x("Crea tu cuenta y conserva tu historial")}</h2>
          <PasswordForm action={upgradeGuest} submit={x("Crear cuenta")} leading={[{ name: "email", label: x("Email"), type: "email", autoComplete: "email" }]} />
        </div>
      )}

      {[["/calendario", "Calendario de pagos"], ["/resumen-mensual", "Resumen del mes"], ["/tu-ano", "Tu año en Fifti"], ["/csv", "Importar y exportar CSV"], ["/atajo", "Atajo de Siri"]].map(([href, label]) => (
        <Link key={href} href={href!} className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">{x(label!)}<span aria-hidden className="text-ink-3">›</span></Link>
      ))}
      <Link href="/balance" className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">{x("Balance y saldar deudas")}<span aria-hidden className="text-ink-3">›</span></Link>
      <h2 className="mt-2 text-lg font-semibold">{x("Burbujas")}</h2>
      <ul className="flex flex-col gap-2">
        {spaces.filter((s) => s.kind !== "personal").map((s) => (
          <li key={s.id}>
            <Link href={`/espacio/${s.id}`} className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">
              {s.name}<span aria-hidden className="text-ink-3">›</span>
            </Link>
          </li>
        ))}
      </ul>
      {(archived ?? []).length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{x("Planes archivados")}</h2>
          <ul className="flex flex-col gap-2">{archived!.map((a) => (
            <li key={a.id}><Link href={`/espacio/${a.id}/cerrar`} className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">{a.name}<span aria-hidden className="text-ink-3">›</span></Link></li>
          ))}</ul>
        </>
      )}
      {!user.is_anonymous && spaces.some((s) => s.kind !== "personal") && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{x("Reflejo en tu plan personal")}</h2>
          <p className="text-sm text-ink-3">{x("Tu parte de cada gasto de grupo entra sola en tu plan personal. Solo la ves tú.")}</p>
          {spaces.filter((s) => s.kind !== "personal").map((s) => {
            const pr = prefs?.find((p) => p.space_id === s.id);
            return (
              <ActionForm key={s.id} action={setMirrorPref} submit={x("Guardar")} tone="plain" className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
                <input type="hidden" name="spaceId" value={s.id} />
                <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="enabled" defaultChecked={pr?.enabled ?? true} /> {s.name}</label>
                <select name="fundId" defaultValue={pr?.fund_id ?? ""} aria-label={`Fondo para ${s.name}`} className={inputClass}>
                  <option value="">{x("Fondo automático")}</option>
                  {pFunds?.map((f) => <option key={f.id} value={f.id}>{displayName(x, f.name, f.system_key)}</option>)}
                </select>
              </ActionForm>
            );
          })}
        </>
      )}
      {!user.is_anonymous && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{x("Notificaciones")}</h2>
          <PushSettings publicKey={vapidPublicKey} />
          <ActionForm action={savePrefs} submit={x("Guardar preferencias")} tone="plain" className="flex flex-col gap-1 rounded-card border border-border bg-surface p-3">
            {([["new_expense", "Gasto nuevo"], ["fixed_tomorrow", "Gasto fijo mañana"], ["fund_threshold", "Fondo al 80 % / 100 %"], ["goal_reached", "Meta alcanzada"], ["monthly_summary", "Resumen mensual"], ["contribution_pending", "Aportación pendiente"], ["offset_proposal", "Propuesta de compensación"]] as const).map(([k, l]) => (
              <label key={k} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name={k} defaultChecked={(prefRow as Record<string, boolean> | null)?.[k] ?? true} /> {x(l)}</label>
            ))}
          </ActionForm>
        </>
      )}
      <h2 className="mt-2 text-lg font-semibold">{x("Favoritos")}</h2>
      <p className="text-sm text-ink-3">{x("Pulsación larga en el botón + para usarlos.")}</p>
      <ul className="flex flex-col gap-2">
        {favs?.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
            <span>{f.label} <span className="money font-mono text-ink-3">{formatMoney(f.amount_cents, "EUR", x.locale)}</span></span>
            <form action={deleteFavorite}><input type="hidden" name="favoriteId" value={f.id} /><button aria-label={`Borrar ${f.label}`} className="min-h-11 min-w-11 text-over-text">✕</button></form>
          </li>
        ))}
      </ul>
      <ActionForm action={addFavoriteForm} submit={x("Añadir favorito")} tone="plain">
        <select name="spaceId" aria-label={x("Burbuja")} className={inputClass}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.kind === "personal" ? x("Personal") : s.name}</option>)}</select>
        <input name="label" required maxLength={30} placeholder={x("Café")} aria-label={x("Nombre")} className={inputClass} />
        <input name="amount" required inputMode="decimal" placeholder="2,50" aria-label={x("Importe")} className={`${inputClass} font-mono`} />
      </ActionForm>
      <h2 className="mt-2 text-lg font-semibold">{t("language")} · {t("theme")}</h2>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
        <form action={setLocale} className="flex gap-2">
          <select name="locale" defaultValue={locale} aria-label={t("language")} className={inputClass}><option value="es">{x("Español")}</option><option value="en">{x("English")}</option></select>
          <button className="min-h-12 rounded-full border border-border px-4 font-semibold">{t("save")}</button>
        </form>
        <form action={setTheme} className="flex gap-2">
          <select name="theme" defaultValue={theme} aria-label={t("theme")} className={inputClass}>
            <option value="system">{t("themeSystem")}</option><option value="dark">{t("themeDark")}</option><option value="light">{t("themeLight")}</option>
          </select>
          <button className="min-h-12 rounded-full border border-border px-4 font-semibold">{t("save")}</button>
        </form>
      </div>
      {!user.is_anonymous && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{t("discreet")}</h2>
          <form action={toggleDiscreet} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm text-ink-2">
            <span>{t("discreetHelp")}</span><button className="min-h-11 rounded-full border border-border px-4 font-semibold text-ink">{t("discreet")}</button>
          </form>
        </>
      )}
      {!user.is_anonymous && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{x("Usar IA para entender frases")}</h2>
          <form action={toggleAiPhrases} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm text-ink-2">
            <span>{aiOn ? x("Activada. La frase se envía a Google para interpretarla (máx. 30 al día).") : x("Desactivada. Las frases se entienden en tu dispositivo, sin enviar nada.")}</span>
            <button aria-pressed={aiOn} className="min-h-11 shrink-0 rounded-full border border-border px-4 font-semibold text-ink">{aiOn ? x("Desactivar") : x("Activar")}</button>
          </form>
        </>
      )}
      {!user.is_anonymous && (
        <>
          <h2 className="mt-2 text-lg font-semibold">{x("Cambiar contraseña")}</h2>
          <div className="rounded-card border border-border bg-surface p-4">
            <PasswordForm action={changePassword} submit={x("Cambiar contraseña")} withCurrent clearOnSuccess />
          </div>
        </>
      )}
      <h2 className="mt-2 text-lg font-semibold">{t("lock")}</h2>
      <LockSettings />
      <form action={signOut}>
        <button type="submit" className="min-h-12 w-full rounded-full border border-border font-semibold">{t("logout")}</button>
      </form>
      {!user.is_anonymous && (
        <div className="mt-4 flex flex-col gap-2 rounded-card border border-over p-4">
          <h2 className="font-semibold text-over-text">{t("danger")}</h2>
          <p className="text-sm text-ink-2">{t("deleteHelp")}</p>
          <ActionForm action={deleteAccount} submit={t("deleteAccount")} tone="plain">
            <input name="password" type="password" autoComplete="current-password" required maxLength={128} aria-label={t("confirmPassword")} placeholder={t("confirmPassword")} className={inputClass} />
          </ActionForm>
        </div>
      )}
    </section>
  );
}
