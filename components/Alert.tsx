"use client";
import { useState } from "react";
import Link from "next/link";
// Avisos tipo Flowbite: fondo teñido, ícono, título, mensaje, botón de acción opcional y cierre.
const V = {
  info: { box: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300", btn: "bg-blue-700 text-white hover:bg-blue-800" },
  danger: { box: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300", btn: "bg-red-700 text-white hover:bg-red-800" },
  success: { box: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300", btn: "bg-green-700 text-white hover:bg-green-800" },
  warning: { box: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300", btn: "bg-orange-600 text-white hover:bg-orange-700" },
};
export type Tone = keyof typeof V;
export default function Alert({ tone, title, children, href, action }: { tone: Tone; title: string; children?: React.ReactNode; href?: string; action?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-lg border p-4 ${V[tone].box}`}>
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM9.5 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM12 15H8a1 1 0 0 1 0-2h1v-3H8a1 1 0 0 1 0-2h2a1 1 0 0 1 1 1v4h1a1 1 0 0 1 0 2Z" /></svg>
        <h3 className="text-base font-medium">{title}</h3>
        <button type="button" aria-label="Cerrar aviso" onClick={() => setOpen(false)} className="ml-auto inline-flex h-7 w-7 items-center justify-center border-0 bg-transparent p-0 text-current hover:bg-transparent hover:opacity-70">
          <svg className="h-3 w-3" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m1 1 12 12M13 1 1 13" /></svg>
        </button>
      </div>
      {children && <div className="mt-2 text-sm">{children}</div>}
      {href && action && <Link href={href} className={`mt-3 inline-flex rounded-lg px-4 py-2 text-sm font-medium no-underline hover:no-underline ${V[tone].btn}`}>{action}</Link>}
    </div>
  );
}
