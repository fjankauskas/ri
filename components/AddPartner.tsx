import Link from "next/link";
import ShareInvite from "./ShareInvite";
import { addFromNetwork, inviteCompany } from "@/app/commerce-actions";
import { COND_IVA } from "@/lib/billing";
export type Found = { org_id: string; name: string; tax_masked: string; relation: string | null };
export type Invited = { link: string; name: string; email: string; phone: string };
const REL: Record<string, string> = { ACTIVE: "Ya están conectados", PENDING: "Conexión pendiente" };
/** Alta de cliente o proveedor: primero se busca en la red (email, teléfono o CUIT); si no está, se la invita a usar la aplicación. */
export default function AddPartner({ kind, base, find, mode, results, searchError, invited, from, closeHref, hrefFor, manual }: {
  kind: "customer" | "supplier"; base: string; find: string; mode: string; results: Found[] | null; searchError?: string; invited?: Invited | null; from: string;
  closeHref: string; hrefFor: (patch: Record<string, string | null>) => string; manual: React.ReactNode;
}) {
  const noun = kind === "customer" ? "cliente" : "proveedor";
  const back = hrefFor({ modal: null, find: null, mode: null, n: null, em: null, ph: null, lk: null });
  const hidden = <><input type="hidden" name="back" value={back} /><input type="hidden" name="kind" value={kind} /></>;
  if (invited) return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-line bg-surface p-4"><p className="font-medium">✔ {invited.name} quedó cargado como {noun} y la invitación está lista.</p><p className="mt-1 text-sm text-mute">Mandale el enlace por el medio que prefieras. Cuando se registre con ese enlace, se conecta con vos y queda vinculado a este {noun} automáticamente.</p></div>
      <ShareInvite link={invited.link} from={from} kind={kind} email={invited.email || undefined} phone={invited.phone || undefined} />
      <Link href={back} className="btn btn-gray justify-self-start no-underline">Listo</Link>
    </div>
  );
  if (mode === "manual") return (
    <div className="grid gap-4">
      <p className="rounded-lg border border-line bg-surface p-3 text-sm text-mute">Se carga solo en tu lista, sin conectarlo con la red. Podés buscarlo o invitarlo más adelante.</p>
      {manual}
      <Link href={hrefFor({ mode: null })} className="text-sm">← Buscar en la red</Link>
    </div>
  );
  if (mode === "invite") return (
    <form className="f" action={inviteCompany}>
      {hidden}
      <p className="rounded-lg border border-line bg-surface p-3 text-sm text-mute">Lo cargamos en tu lista de {noun}s y te damos un enlace de invitación. Completá al menos un dato de contacto: email, teléfono o CUIT.</p>
      <div className="fgrid">
        <label className="full">Nombre o razón social<input name="name" required autoFocus /></label>
        <label>Email<input name="email" type="email" defaultValue={find.includes("@") ? find : ""} /></label>
        <label>Teléfono / WhatsApp<input name="phone" inputMode="tel" defaultValue={!find.includes("@") && find.replace(/\D/g, "").length < 11 ? find : ""} placeholder="Con característica: 261 555 1234" /></label>
        <label>CUIT<input name="cuit" inputMode="numeric" defaultValue={!find.includes("@") && find.replace(/\D/g, "").length === 11 ? find : ""} /></label>
        {kind === "customer" && <label>Condición frente al IVA<select name="iva" defaultValue="1">{Object.entries(COND_IVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
      </div>
      <div className="mt-2 flex gap-3 border-t border-line pt-5"><button className="btn btn-green">Crear invitación</button><Link href={hrefFor({ mode: null })} className="btn btn-gray no-underline">Volver</Link></div>
    </form>
  );
  return (
    <div className="grid gap-5">
      <form action={base} method="get" className="f">
        <input type="hidden" name="v" value={kind === "customer" ? "customers" : "suppliers"} /><input type="hidden" name="modal" value={kind} />
        <label>Buscá la empresa en la red por email, teléfono o CUIT<input name="find" defaultValue={find} autoFocus placeholder="empresa@correo.com · 261 555 1234 · 30-12345678-9" /></label>
        <div className="flex flex-wrap gap-3"><button className="btn btn-green">Buscar</button><Link href={hrefFor({ mode: "manual", find: null })} className="btn btn-gray no-underline">Cargar sin conectar</Link></div>
      </form>
      {searchError && <p role="alert" className="text-sm out">{searchError}</p>}
      {results && results.length > 0 && (
        <ul className="grid gap-3">
          {results.map((r) => (
            <li key={r.org_id} className="rounded-xl border border-line bg-card p-4">
              <div><p className="text-base font-medium">{r.name}</p><p className="text-sm text-mute">CUIT {r.tax_masked || "—"}{r.relation && ` · ${REL[r.relation] ?? r.relation}`}</p></div>
              <form action={addFromNetwork} className="f mt-3">
                {hidden}<input type="hidden" name="org" value={r.org_id} />
                {kind === "customer" && <label>Condición frente al IVA de este cliente<select name="iva" defaultValue="1">{Object.entries(COND_IVA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
                <button className="btn btn-green justify-self-start">{r.relation === "ACTIVE" ? `Agregar como ${noun}` : `Conectar y agregar como ${noun}`}</button>
                {r.relation !== "ACTIVE" && <p className="text-xs text-mute">Le enviamos una solicitud de conexión; cuando la acepte podrán operar entre sí. Ya lo ves en tu lista mientras tanto.</p>}
              </form>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && !searchError && (
        <div className="rounded-xl border border-line bg-card p-5">
          <p className="font-medium">No encontramos «{find}» en la red.</p>
          <p className="mt-1 text-sm text-mute">Puede que todavía no use la aplicación. Invitala y cuando se registre queda conectada con vos.</p>
          <div className="mt-3 flex flex-wrap gap-3"><Link href={hrefFor({ mode: "invite" })} className="btn btn-green no-underline">Invitar a usar la aplicación</Link><Link href={hrefFor({ mode: "manual", find: null })} className="btn btn-gray no-underline">Cargar sin conectar</Link></div>
        </div>
      )}
      {!find && <p className="text-sm text-mute">¿No sabés si ya usa la aplicación? Probá con su CUIT: si no está, te ofrecemos invitarla.</p>}
      <Link href={closeHref} className="text-sm">Cancelar</Link>
    </div>
  );
}
