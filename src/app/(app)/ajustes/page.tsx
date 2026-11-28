import { getTx } from "@/i18n/tx";
import { displayName } from "@/lib/system-names";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, inputClass } from "@/components/ui/ActionForm";
import { PartnerInvite } from "@/components/home/PartnerInvite";
import { ClearSpace } from "@/components/settings/ClearSpace";
import { RowLink, RowSheet, SettingsGroup } from "@/components/settings/Rows";
import { loadLoans, loanTotals } from "@/server/loans";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { addFavoriteForm, deleteFavorite } from "@/server/actions/expenses";
import { setMirrorPref } from "@/server/actions/plan";
import { TimezoneField } from "@/components/ui/TimezoneField";
import { PasswordForm } from "@/components/ui/PasswordForm";
import { PushSettings } from "@/components/pwa/PushSettings";
import { vapidPublicKey } from "@/lib/vapid";
import { savePrefs } from "@/server/actions/push";
import { cookies, headers } from "next/headers";
import { ChangeCurrency } from "@/components/money/ChangeCurrency";
import { currencyForLanguages, currencyLabel } from "@/lib/fx";
import { getLocale, getTranslations } from "next-intl/server";
import { Turnstile } from "@/components/ui/Turnstile";
import { turnstileSiteKey } from "@/lib/turnstile-public";
import { LockSettings } from "@/components/lock/LockSettings";
import { deleteAccount, setLocale, setTheme, toggleAiPhrases, toggleDiscreet } from "@/server/actions/prefs";
import { requireUser, listMySpaces } from "@/server/spaces";
import { changePassword, signOut, upgradeGuest } from "@/server/actions/auth";


export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const [x, user, spaces, t, locale, jar, supabase] = await Promise.all([getTx(), requireUser(), listMySpaces(), getTranslations("more"), getLocale(), cookies(), createClient()]);
  const demo = user.app_metadata?.demo === true;
  const theme = jar.get("fifti_theme")?.value ?? "dark";
  const personalId = user.is_anonymous ? undefined : spaces.find((s) => s.kind === "personal")?.id;
  // Todas las consultas de la pantalla salen a la vez: una sola ida y vuelta al servidor
  const [{ data: pFunds }, { data: prefs }, { data: archived }, { data: prefRow }, { data: aiRow }, { data: favs }, { data: members }, { data: owned }, { data: invites }, loanRows] = await Promise.all([
    personalId ? supabase.from("funds").select("id, name, system_key").eq("space_id", personalId).order("position") : Promise.resolve({ data: [] as { id: string; name: string; system_key: string | null }[] }),
    supabase.from("mirror_prefs").select("space_id, enabled, fund_id"),
    supabase.from("spaces").select("id, name").eq("kind", "group").not("archived_at", "is", null).order("archived_at", { ascending: false }),
    user.is_anonymous ? Promise.resolve({ data: null }) : supabase.from("notification_prefs").select("*").maybeSingle(),
    user.is_anonymous ? Promise.resolve({ data: null }) : supabase.from("profiles").select("ai_phrases").maybeSingle(),
    supabase.from("favorites").select("id, label, amount_cents, space_id").order("label"),
    supabase.from("space_members").select("space_id, user_id, role"),
    supabase.from("spaces").select("id, created_by").eq("created_by", user.id),
    supabase.from("share_links").select("space_id").eq("kind", "invite").eq("revoked", false).gt("expires_at", new Date().toISOString()),
    user.is_anonymous ? Promise.resolve(null) : loadLoans(supabase, user.id),
  ]);
  const aiOn = !!aiRow?.ai_phrases;
  const pendingInvite = new Set((invites ?? []).map((i) => i.space_id));
  const createdByMe = new Set((owned ?? []).map((o) => o.id));
  const peopleOf = (id: string) => (members ?? []).filter((m) => m.space_id === id).length;
  const isOwner = (id: string) => (members ?? []).some((m) => m.space_id === id && m.user_id === user.id && m.role === "owner");
  const homeCurrency = spaces.find((s) => s.kind === "personal")?.currency ?? "EUR";
  const loans = loanRows ? await loanTotals(loanRows, homeCurrency) : null;
  const personalSpace = spaces.find((s) => s.kind === "personal");
  // Moneda que se propone según la región del navegador, si aún estás en euros
  const suggested = currencyForLanguages((await headers()).get("accept-language"));
  const name = (user.user_metadata?.display_name as string | undefined) ?? user.email ?? "";
  const initial = (name.trim()[0] ?? "A").toUpperCase();
  const themeLabel = theme === "light" ? t("themeLight") : theme === "system" ? t("themeSystem") : t("themeDark");
  const mirror = (prefs ?? []).length;
  void mirror;

  return (
    <section className="flex flex-col gap-6 pt-2">
      <div className="flex items-center gap-1">
        <Link href="/inicio" aria-label={x("Volver")} className="grid min-h-11 min-w-11 place-items-center text-xl text-ink-2">‹</Link>
        <h1 className="text-2xl font-bold">{x("Ajustes")}</h1>
      </div>

      {!user.is_anonymous && !demo ? (
        <RowSheet title={x("Tu cuenta y contraseña")} card={{ initial, name, hint: x("Tu cuenta y contraseña") }}>
          <div className="rounded-card border border-border bg-surface p-4">
            <PasswordForm action={changePassword} submit={x("Cambiar contraseña")} withCurrent clearOnSuccess captcha />
          </div>
          <div className="mt-4 flex flex-col gap-2 rounded-card border border-over p-4">
          <h2 className="font-semibold text-over-text">{t("danger")}</h2>
          <p className="text-sm text-ink-2">{t("deleteHelp")}</p>
          <ActionForm action={deleteAccount} submit={t("deleteAccount")} tone="plain">
            {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} appearance="interaction-only" />}
            <input name="password" type="password" autoComplete="current-password" required maxLength={128} aria-label={t("confirmPassword")} placeholder={t("confirmPassword")} className={inputClass} />
          </ActionForm>
        </div>
        </RowSheet>
      ) : (
      <div className="flex items-center gap-4 rounded-card border border-border bg-surface p-4">
        <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-lilac text-lg font-bold text-on-accent">{initial}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user.is_anonymous ? x("Sesión de invitado") : name}</p>
          <p className="truncate text-sm text-ink-3">{user.is_anonymous ? x("Sin cuenta") : user.email}</p>
        </div>
      </div>
      )}

      {user.is_anonymous && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <h2 className="font-semibold">{x("Crea tu cuenta y conserva tu historial")}</h2>
          <PasswordForm action={upgradeGuest} submit={x("Crear cuenta")} leading={[{ name: "email", label: x("Email"), type: "email", autoComplete: "email" }]} />
        </div>
      )}


      <SettingsGroup title={x("Espacios")}>
        {spaces.map((s) => {
          const people = peopleOf(s.id);
          const label = s.kind === "personal" ? x("Personal") : s.name;
          return (
            <RowSheet key={s.id} label={label} value={s.kind === "household" && people <= 1 && pendingInvite.has(s.id) ? x("Invitación pendiente") : s.kind === "personal" || people <= 1 ? x("Solo tú") : `${people} ${x("personas")}`} title={label}>
              <Link href={s.kind === "personal" ? "/plan" : `/espacio/${s.id}`} className="flex min-h-12 items-center justify-between rounded-card border border-border bg-surface px-4">{x("Abrir")} {label}<span aria-hidden className="text-ink-3">›</span></Link>
              {s.kind === "household" && people <= 1 && <PartnerInvite spaceId={s.id} dismissible={false} pending={pendingInvite.has(s.id)} />}
              {s.id === personalSpace?.id && s.currency === "EUR" && suggested !== "EUR" && <p className="text-sm text-ink-2">{x("Por la región de tu navegador, quizá prefieras")} {currencyLabel(suggested, x.locale)}.</p>}
              {!user.is_anonymous && <ChangeCurrency spaceId={s.id} current={s.currency} canChange={demo || isOwner(s.id)} demo={demo} />}
              <ClearSpace spaceId={s.id} name={label} canClear={demo || createdByMe.has(s.id)} shared={s.kind !== "personal" && people > 1} demo={demo} />
            </RowSheet>
          );
        })}
        {(archived ?? []).map((a) => <RowLink key={a.id} href={`/espacio/${a.id}/cerrar`} label={a.name} value={x("Archivado")} />)}
        {!user.is_anonymous && <RowLink href="/nueva" label={x("Crear o unirse a un espacio")} />}
        {!user.is_anonymous && spaces.some((s) => s.kind !== "personal") && (
          <RowSheet label={x("Tu parte de los espacios en tu plan")}>
      {!user.is_anonymous && spaces.some((s) => s.kind !== "personal") && (
        <>
          <p className="text-sm text-ink-3">{x("Tu parte de cada gasto de grupo entra sola en tu plan personal. Solo la ves tú.")} {x("Aquí eliges, para cada espacio, si su parte cuenta en tu plan y en qué partida.")}</p>
          {spaces.filter((s) => s.kind !== "personal").map((s) => {
            const pr = prefs?.find((p) => p.space_id === s.id);
            return (
              <ActionForm key={s.id} action={setMirrorPref} optimistic submit={x("Guardar")} tone="plain" className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
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
          </RowSheet>
        )}
      </SettingsGroup>

      <SettingsGroup title={x("Dinero")}>
        {!user.is_anonymous && <RowLink href="/cuentas" label={x("Mis cuentas")} />}
        <RowLink href="/prestamos" label={x("Préstamos")} value={loans && loans.owedToMe > 0 ? `${x("Te deben")} ${formatMoney(loans.owedToMe, homeCurrency, x.locale)}` : undefined} />
        <RowLink href="/balance" label={x("Balance y saldar deudas")} />
        <RowLink href="/csv" label={x("Importar del banco (CSV)")} />
      </SettingsGroup>

      <SettingsGroup title={x("Informes")}>
        <RowLink href="/tendencias" label={x("Tendencias")} />
        <RowLink href="/resumen-mensual" label={x("Resumen del mes")} value="PDF" />
        <RowLink href="/tu-ano" label={x("Tu año en Fifti")} />
      </SettingsGroup>

      <SettingsGroup title={x("Utilidades")}>
        <RowLink href="/compra" label={x("Lista de la compra")} />
        <RowLink href="/reglas" label={x("Reglas de categoría")} />
        <RowLink href="/atajo" label={x("Atajo de Siri")} />
        <RowSheet label={x("Favoritos")} value={String((favs ?? []).length)}>

      <p className="text-sm text-ink-3">{x("Pulsación larga en el botón + para usarlos.")}</p>
      <ul className="flex flex-col gap-2">
        {favs?.map((f) => (
          <li key={f.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-2 text-sm">
            <span>{f.label} <span className="money font-mono text-ink-3">{formatMoney(f.amount_cents, spaces.find((s) => s.id === f.space_id)?.currency ?? "EUR", x.locale)}</span></span>
            <form action={deleteFavorite}><input type="hidden" name="favoriteId" value={f.id} /><button aria-label={`Borrar ${f.label}`} className="min-h-11 min-w-11 text-over-text">✕</button></form>
          </li>
        ))}
      </ul>
      <ActionForm action={addFavoriteForm} optimistic submit={x("Añadir favorito")} tone="plain">
        <select name="spaceId" aria-label={x("Burbuja")} className={inputClass}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.kind === "personal" ? x("Personal") : s.name}</option>)}</select>
        <input name="label" required maxLength={30} placeholder={x("Café")} aria-label={x("Nombre")} className={inputClass} />
        <input name="amount" required inputMode="decimal" placeholder="2,50" aria-label={x("Importe")} className={`${inputClass} font-mono`} />
      </ActionForm>
        </RowSheet>
      </SettingsGroup>

      <SettingsGroup title={x("Preferencias")}>
        {!user.is_anonymous && (
          <div id="notificaciones">
            <RowSheet label={x("Notificaciones")}>
      {!user.is_anonymous && (
        <>
          <PushSettings publicKey={vapidPublicKey} />
          <ActionForm action={savePrefs} submit={x("Guardar preferencias")} tone="plain" className="flex flex-col gap-1 rounded-card border border-border bg-surface p-3">
            {([["new_expense", "Gasto nuevo"], ["fixed_tomorrow", "Aviso de gasto fijo"], ["fund_threshold", "Fondo al 80 % / 100 %"], ["goal_reached", "Meta alcanzada"], ["monthly_summary", "Resumen mensual"], ["contribution_pending", "Aportación pendiente"], ["payday_split", "Día de cobro: reparte tu nómina"], ["offset_proposal", "Propuesta de compensación"]] as const).map(([k, l]) => (
              <label key={k} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name={k} defaultChecked={(prefRow as Record<string, boolean> | null)?.[k] ?? true} /> {x(l)}</label>
            ))}
            <label className="flex items-center justify-between gap-3 text-sm text-ink-2">{x("Avisar de un gasto fijo con")}
              <select name="fixed_advance_days" defaultValue={String((prefRow as { fixed_advance_days?: number } | null)?.fixed_advance_days ?? 1)} aria-label={x("Antelación del aviso de gasto fijo")} className="min-h-11 rounded-card border border-border bg-surface px-3 text-ink">
                <option value="1">{x("1 día de antelación")}</option><option value="3">{x("3 días de antelación")}</option><option value="7">{x("7 días de antelación")}</option>
              </select>
            </label>
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="daily_reminder" defaultChecked={!!(prefRow as { daily_reminder?: boolean } | null)?.daily_reminder} /> {x("Recordarme apuntar gastos")}</label>
              <label className="flex items-center justify-between gap-3 text-sm text-ink-2">{x("Hora del recordatorio")}
                <select name="reminder_hour" defaultValue={String((prefRow as { reminder_hour?: number } | null)?.reminder_hour ?? 21)} aria-label={x("Hora del recordatorio")} className="min-h-11 rounded-card border border-border bg-surface px-3 font-mono text-ink">
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                </select>
              </label>
              <TimezoneField initial={(prefRow as { timezone?: string } | null)?.timezone ?? "Europe/Madrid"} />
              <p className="text-xs text-ink-3">{x("Solo si ese día aún no has apuntado nada. El aviso no lleva importes.")}</p>
            </div>
          </ActionForm>
        </>
      )}
            </RowSheet>
          </div>
        )}
        <RowSheet label={x("Apariencia")} value={themeLabel}>
          <form action={setTheme} className="flex gap-2">
          <select name="theme" defaultValue={theme} aria-label={t("theme")} className={inputClass}>
            <option value="system">{t("themeSystem")}</option><option value="dark">{t("themeDark")}</option><option value="light">{t("themeLight")}</option>
          </select>
          <button className="min-h-12 rounded-full border border-border px-4 font-semibold">{t("save")}</button>
        </form>
        </RowSheet>
        <RowSheet label={x("Idioma")} value={locale === "en" ? "English" : "Español"}>
          <form action={setLocale} className="flex gap-2">
          <select name="locale" defaultValue={locale} aria-label={t("language")} className={inputClass}><option value="es">{x("Español")}</option><option value="en">{x("English")}</option></select>
          <button className="min-h-12 rounded-full border border-border px-4 font-semibold">{t("save")}</button>
        </form>
        </RowSheet>
        <RowSheet label={x("Bloqueo")}>
      <LockSettings />
        </RowSheet>
        {!user.is_anonymous && (
          <RowSheet label={x("Modo discreto")}>
      {!user.is_anonymous && (
        <>
          <form action={toggleDiscreet} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm text-ink-2">
            <span>{t("discreetHelp")}</span><button className="min-h-11 rounded-full border border-border px-4 font-semibold text-ink">{t("discreet")}</button>
          </form>
        </>
      )}
          </RowSheet>
        )}
        {!user.is_anonymous && (
          <RowSheet label={x("Usar IA para entender frases")} value={aiOn ? x("Activada") : x("Desactivada")}>
      {!user.is_anonymous && (
        <>
          <form action={toggleAiPhrases} className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 text-sm text-ink-2">
            <span>{aiOn ? x("Activada. La frase se envía a Google para interpretarla (máx. 30 al día).") : x("Desactivada. Las frases se entienden en tu dispositivo, sin enviar nada.")}</span>
            <button aria-pressed={aiOn} className="min-h-11 shrink-0 rounded-full border border-border px-4 font-semibold text-ink">{aiOn ? x("Desactivar") : x("Activar")}</button>
          </form>
        </>
      )}
          </RowSheet>
        )}
      </SettingsGroup>

      {demo ? <a href="/demo/salir" className="flex min-h-12 items-center justify-center rounded-full border border-border font-semibold">{x("Salir de la demo")}</a> : <form action={signOut}>
        <button type="submit" className="min-h-12 w-full rounded-full border border-border font-semibold">{t("logout")}</button>
      </form>}
    </section>
  );
}
