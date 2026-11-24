import { PullToRefresh } from "@/components/pwa/PullToRefresh";

/** Transición corta y suave al entrar en cada pantalla (se desactiva con prefers-reduced-motion) y tirar para actualizar. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="anim-page">
      <PullToRefresh />
      {children}
    </div>
  );
}
