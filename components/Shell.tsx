import Link from "next/link";
import { signOut } from "@/app/actions";
import { SiteNav } from "./SiteNav";
import ThemeToggle from "./ThemeToggle";
import Alert from "./Alert";
export type SP = Promise<Record<string, string | undefined>>;
// Encabezado fijo + avisos de resultado (e = error, ok = éxito). El contenido de cada pantalla lo arma Workspace.
export default function Shell({ org, e, ok, redBadge, children }: { org: string; e?: string; ok?: string; redBadge: number; children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-10 gap-y-3 px-5 py-4">
          <Link href="/inventory" className="flex items-center gap-3 text-lg font-light tracking-wide text-ink no-underline hover:no-underline">
            <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-accent"><span className="h-2 w-2 rounded-sm bg-accent" /></span>
            Red de Inventario
          </Link>
          <SiteNav redBadge={redBadge} />
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-sm text-mute sm:inline">{org}</span>
            <ThemeToggle />
            <form action={signOut}><button>Salir</button></form>
          </div>
        </div>
      </header>
      <main>
        {(e || ok) && (
          <div className="mx-auto max-w-[1440px] px-5 pt-6">
            {e && <Alert tone="danger" title="No se pudo completar la acción">{e}</Alert>}
            {ok && <Alert tone="success" title="Listo">{ok}</Alert>}
          </div>
        )}
        {children}
      </main>
    </>
  );
}
