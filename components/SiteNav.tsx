"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
// Navegación principal: siete secciones. «Red» muestra un globito con lo que espera una acción tuya.
const ITEMS = [["/inventory", "Inventario"], ["/commerce", "Compras y ventas"], ["/network", "Red"], ["/gs1", "GS1"], ["/reports", "Reportes"], ["/team", "Equipo"]] as const;
export function SiteNav({ redBadge }: { redBadge: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {ITEMS.map(([href, label]) => {
        const on = path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined}
            className={`relative border-b-2 py-1 text-sm tracking-wide no-underline hover:no-underline ${on ? "border-accent text-accent" : "border-transparent text-ink hover:text-accent"}`}>
            {label}
            {href === "/network" && redBadge > 0 && (
              <span className="absolute -end-5 -top-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-bg bg-red-600 px-1 text-xs font-bold text-white" aria-label={`${redBadge} pendientes`}>{redBadge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
