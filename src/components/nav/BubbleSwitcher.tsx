import { selectBubble } from "@/server/actions/bubble";
import type { SpaceSummary } from "@/server/spaces";

const ACCENT: Record<SpaceSummary["kind"], string> = {
  personal: "var(--lilac)",
  household: "var(--lime)",
  group: "var(--tangerine)",
};

export function BubbleSwitcher({ spaces, activeId }: { spaces: SpaceSummary[]; activeId: string }) {
  return (
    <nav aria-label="Burbujas" className="flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
      {spaces.map((s) => {
        const active = s.id === activeId;
        return (
          <form action={selectBubble} key={s.id}>
            <input type="hidden" name="spaceId" value={s.id} />
            <button
              type="submit"
              aria-pressed={active}
              style={active ? { background: ACCENT[s.kind], color: "var(--on-accent)", borderColor: ACCENT[s.kind] } : undefined}
              className="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-border px-4 text-sm font-medium text-ink-2"
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: active ? "var(--on-accent)" : ACCENT[s.kind] }}
              />
              {s.kind === "personal" ? "Personal" : s.name}
            </button>
          </form>
        );
      })}
    </nav>
  );
}
