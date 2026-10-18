import Link from "next/link";
import { signOut } from "@/app/actions";
import { SiteNav, PageTitle } from "./SiteNav";
import ThemeToggle from "./ThemeToggle";
export type SP = Promise<Record<string, string | undefined>>;
export default async function Shell({ org, sp, children }: { org: string; sp: SP; children: React.ReactNode }) {
  const { e, ok } = await sp;
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-3 text-lg font-light tracking-wide text-ink no-underline hover:no-underline">
            <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center border border-accent"><span className="h-2 w-2 bg-accent" /></span>
            Red de Inventario
          </Link>
          <SiteNav />
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-sm text-mute sm:inline">{org}</span>
            <ThemeToggle />
            <form action={signOut}><button>Salir</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-5 pb-20 pt-10">
        <PageTitle />
        {e && <p role="alert" className="msg bad">{e}</p>}
        {ok && <p role="status" className="msg good">{ok}</p>}
        {children}
      </main>
    </>
  );
}
