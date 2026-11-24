"use client";

import dynamic from "next/dynamic";
import type { SpendPoint } from "./SpendChart";

/** La gráfica (recharts) se descarga después de pintar lo importante: no compite con la cifra principal por el ancho de banda. */
const SpendChart = dynamic(() => import("./SpendChart").then((m) => m.SpendChart), {
  ssr: false,
  loading: () => <div className="h-40 w-full animate-pulse rounded-card bg-track" aria-hidden />,
});

export function SpendChartLazy({ data, currency }: { data: SpendPoint[]; currency: string }) {
  return <SpendChart data={data} currency={currency} />;
}
