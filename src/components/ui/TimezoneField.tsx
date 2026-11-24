"use client";

import { useEffect, useState } from "react";

/** Campo oculto con la zona horaria del dispositivo (para que el recordatorio llegue a la hora local de cada persona). */
export function TimezoneField({ initial }: { initial: string }) {
  const [tz, setTz] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || initial); } catch { /* se queda la guardada */ } }, 0);
    return () => clearTimeout(t);
  }, [initial]);
  return <input type="hidden" name="timezone" value={tz} />;
}
