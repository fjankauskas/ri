"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const ITEMS = [["/", "Resumen"], ["/products", "Productos y stock"], ["/production", "Producción"], ["/orders", "Pedidos"], ["/trace", "Trazabilidad"], ["/scan", "Escáner"], ["/network", "Red"]] as const;
const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

// Navegación principal: en pantallas chicas se abre con el botón «Menú», como en el sitio de referencia.
export function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="md:hidden" aria-expanded={open} aria-controls="menu-principal" onClick={() => setOpen(!open)}>Menú</button>
      <nav id="menu-principal" aria-label="Principal" className={`order-last w-full flex-col gap-4 md:order-none md:flex md:w-auto md:flex-row md:gap-7 ${open ? "flex" : "hidden"}`}>
        {ITEMS.map(([href, label]) => (
          <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={isActive(path, href) ? "page" : undefined}
            className={`border-b py-1 text-sm tracking-wide no-underline hover:no-underline ${isActive(path, href) ? "border-accent text-accent" : "border-transparent text-ink hover:text-accent"}`}>{label}</Link>
        ))}
        <a href="/api/epcis" className="border-b border-transparent py-1 text-sm tracking-wide text-ink no-underline hover:text-accent hover:no-underline">EPCIS</a>
      </nav>
    </>
  );
}

// Título grande de la sección actual (peso liviano, como los títulos del sitio de referencia).
export function PageTitle() {
  const path = usePathname();
  const title = ITEMS.find(([href]) => isActive(path, href))?.[1];
  return title ? <h1 className="mb-10 text-4xl md:text-5xl">{title}</h1> : null;
}
