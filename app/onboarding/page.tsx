import { createOrg } from "../actions";
import ThemeToggle from "@/components/ThemeToggle";
export default async function Onboarding({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { e, invite } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-24">
      <div className="fixed right-5 top-5"><ThemeToggle /></div>
      <h1 className="mb-4 text-5xl">Creá tu empresa</h1><p className="mu">El CUIT permite que otras empresas te encuentren para conectarse con vos. Se crea un depósito principal.</p>
      {e && <p role="alert" className="msg bad">{e}</p>}
      <section><form className="f" action={createOrg}><input type="hidden" name="invite" value={invite ?? ""} />
        <label>Nombre de la empresa<input name="name" required /></label>
        <label>CUIT (sin guiones)<input name="tax_id" inputMode="numeric" /></label>
        <button className="p">Crear empresa</button>
      </form></section>
    </main>
  );
}
