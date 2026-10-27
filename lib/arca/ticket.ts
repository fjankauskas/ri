import { login, type Env, type Ticket } from "./wsaa";
// El ticket de acceso dura ~12 h y ARCA rechaza pedir otro mientras el anterior esté vigente: se guarda y se reutiliza.
export type TicketStore = { load(): Promise<Ticket | null>; save(t: Ticket): Promise<void> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function getTicket(env: Env, certPem: string, keyPem: string, store: TicketStore, opts: { service?: string; now?: Date; retryMs?: number } = {}): Promise<Ticket> {
  const now = opts.now ?? new Date(), margin = 5 * 60 * 1000;
  const cached = await store.load();
  if (cached && cached.expiresAt.getTime() - now.getTime() > margin) return cached;
  try {
    const t = await login(env, certPem, keyPem, opts.service ?? "wsfe");
    await store.save(t);
    return t;
  } catch (e: any) {
    if (/ya posee un TA valido|alreadyAuthenticated/i.test(String(e?.message))) {
      for (let i = 0; i < 4; i++) { await sleep(opts.retryMs ?? 1500); const c = await store.load(); if (c && c.expiresAt.getTime() > Date.now() + 60_000) return c; }
      throw new Error("ARCA ya entregó un ticket de acceso a esta empresa hace instantes y no pudimos recuperarlo. Reintentá en unos minutos.");
    }
    throw e;
  }
}
