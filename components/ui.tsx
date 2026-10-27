import Link from "next/link";
import Icon, { type IconName } from "./Icons";
import type { Params } from "@/lib/url";

export function Card({ title, sub, children }: { title?: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-5">
      {title && <h2 className="text-lg">{title}</h2>}
      {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </div>
  );
}

const TONES = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/60 dark:text-green-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
};
export type PillTone = keyof typeof TONES;
export function Pill({ tone = "gray", children }: { tone?: PillTone; children: React.ReactNode }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

/** Botón de acción del panel derecho: enlace con gradiente monocromático e ícono. */
export function ActionLink({ href, icon, tone = "green", children }: { href: string; icon: IconName; tone?: "green" | "teal" | "cyan" | "gray" | "red"; children: React.ReactNode }) {
  return <Link href={href} className={`btn btn-${tone} w-full justify-start`}><Icon name={icon} className="h-4 w-4" />{children}</Link>;
}

/** Menú desplegable de filtro («Filtrar por»), sin JavaScript: cada opción es un enlace. */
export function FilterMenu({ label, value, options }: { label: string; value: string; options: { key: string; label: string; href: string }[] }) {
  const cur = options.find((o) => o.key === value) ?? options[0];
  return (
    <details className="relative">
      <summary className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-fline bg-field px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-2">
        <Icon name="filter" className="h-4 w-4" />{label}: <span className="text-accent">{cur.label}</span><Icon name="chevron" className="h-4 w-4" />
      </summary>
      <ul className="absolute right-0 z-30 mt-2 w-52 rounded-lg border border-line bg-card p-1 shadow-xl">
        {options.map((o) => (
          <li key={o.key}><Link href={o.href} className={`block rounded-md px-3 py-2 text-sm no-underline hover:bg-surface-2 hover:no-underline ${o.key === cur.key ? "text-accent" : "text-ink"}`}>{o.label}</Link></li>
        ))}
      </ul>
    </details>
  );
}

/** Buscador (formulario GET). `keep` son los parámetros que se conservan al buscar. */
export function SearchBar({ action, keep, q, placeholder }: { action: string; keep: Params; q?: string; placeholder: string }) {
  return (
    <form action={action} method="get" className="flex min-w-0 flex-1 gap-2">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input name="q" defaultValue={q} placeholder={placeholder} aria-label="Buscar" />
      <button className="btn btn-green shrink-0">Buscar</button>
    </form>
  );
}

/** Pie de formulario de las ventanas modales: botón principal + Cancelar. */
export function FormFooter({ submit, closeHref }: { submit: string; closeHref: string }) {
  return (
    <div className="mt-6 flex gap-3 border-t border-line pt-5">
      <button className="btn btn-green">{submit}</button>
      <Link href={closeHref} className="btn btn-gray no-underline">Cancelar</Link>
    </div>
  );
}

export type Step = { title: string; detail?: string; state: "done" | "current" | "todo" | "fail" };
const DOT = {
  done: "bg-green-100 text-green-700 dark:bg-green-900/70 dark:text-green-300",
  current: "bg-blue-100 text-blue-700 dark:bg-blue-900/70 dark:text-blue-300",
  todo: "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/70 dark:text-red-300",
};
/** Línea de tiempo vertical con íconos (estilo «Timeline stepper»). */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((s, i) => (
        <li key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${DOT[s.state]}`}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {s.state === "done" ? <path d="m5 12 5 5L20 7" /> : s.state === "fail" ? <path d="m6 6 12 12M18 6 6 18" /> : s.state === "current" ? <circle cx="12" cy="12" r="4" fill="currentColor" /> : <circle cx="12" cy="12" r="3" />}
              </svg>
            </span>
            {i < steps.length - 1 && <span className="my-1 w-px flex-1 bg-line" />}
          </div>
          <div className={i < steps.length - 1 ? "pb-5" : ""}>
            <p className={`text-sm font-medium ${s.state === "todo" ? "text-mute" : "text-ink"}`}>{s.title}</p>
            {s.detail && <p className="text-sm text-mute">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Empty({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <tr><td colSpan={cols} className="text-mute">{children}</td></tr>;
}
