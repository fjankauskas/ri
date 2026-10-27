import Link from "next/link";
import Shell from "./Shell";
import Icon, { type IconName } from "./Icons";
import type { Badges } from "@/lib/view";
import type { Params } from "@/lib/url";

export type MenuItem = { key: string; label: string; icon: IconName; badge?: number };
// Disposición de todas las pantallas: submenús a la izquierda · información en el medio · acciones a la derecha (solo si hay).
export default function Workspace({ base, items, active, org, params, badges, title, intro, aside, children }: {
  base: string; items: MenuItem[]; active: string; org: string; params: Params; badges: Badges; title: string; intro?: string; aside?: React.ReactNode; children: React.ReactNode;
}) {
  const redBadge = badges.requests + badges.incoming + badges.dispatch;
  return (
    <Shell org={org} e={params.e} ok={params.ok} redBadge={redBadge}>
      <div className={`mx-auto grid max-w-[1440px] gap-6 px-5 pb-20 pt-8 lg:grid-cols-[14rem_minmax(0,1fr)] ${aside ? "xl:grid-cols-[14rem_minmax(0,1fr)_22rem]" : ""}`}>
        <nav aria-label="Submenús" className={`flex gap-2 overflow-x-auto lg:flex-col lg:self-start lg:overflow-visible lg:sticky lg:top-24 ${aside ? "lg:row-span-2 xl:row-span-1" : ""}`}>
          {items.map((it) => {
            const on = it.key === active;
            return (
              <Link key={it.key} href={`${base}?v=${it.key}`} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-4 py-3 text-sm no-underline hover:no-underline ${on ? "bg-surface font-medium text-accent" : "text-ink hover:bg-card"}`}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
                {!!it.badge && <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white" aria-label={`${it.badge} pendientes`}>{it.badge}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">
          <header className="mb-6">
            <h1>{title}</h1>
            {intro && <p className="mt-2 max-w-2xl text-mute">{intro}</p>}
          </header>
          {children}
        </div>
        {aside && <aside aria-label="Acciones" className="grid content-start gap-4 lg:col-start-2 xl:col-start-3 xl:row-start-1 xl:sticky xl:top-24 xl:self-start">{aside}</aside>}
      </div>
    </Shell>
  );
}
