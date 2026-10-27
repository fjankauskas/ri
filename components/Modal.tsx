"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
// Ventana modal (como «Create new product»): título, línea divisoria, contenido y cierre con ✕, clic afuera o Escape.
export default function Modal({ title, closeHref, children, wide }: { title: string; closeHref: string; children: React.ReactNode; wide?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.push(closeHref); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [closeHref, router]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <Link href={closeHref} aria-label="Cerrar" tabIndex={-1} className="fixed inset-0 cursor-default" />
      <div className={`relative z-10 my-8 w-full rounded-xl border border-line bg-card p-6 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="flex items-center justify-between border-b border-line pb-4">
          <h2 className="text-xl">{title}</h2>
          <Link href={closeHref} aria-label="Cerrar" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-mute no-underline hover:bg-surface-2 hover:no-underline">
            <svg className="h-4 w-4" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m1 1 12 12M13 1 1 13" /></svg>
          </Link>
        </div>
        <div className="pt-5">{children}</div>
      </div>
    </div>
  );
}
