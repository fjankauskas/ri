import { signIn, signUp } from "../actions";
import ThemeToggle from "@/components/ThemeToggle";
import Alert from "@/components/Alert";
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { e, ok, invite } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-24">
      <div className="fixed right-5 top-5"><ThemeToggle /></div>
      <h1 className="mb-4 text-5xl">Red de Inventario</h1><p className="mu">Ingresá o creá tu cuenta para conectar tu inventario con proveedores y clientes.</p>
      <div className="mt-6 grid gap-3">{e && <Alert tone="danger" title="No se pudo ingresar">{e}</Alert>}{ok && <Alert tone="success" title="Listo">{ok}</Alert>}</div>
      <div className="mt-6 rounded-xl border border-line bg-card p-6"><form className="f"><input type="hidden" name="invite" value={invite ?? ""} />
        <label>Email<input name="email" type="email" required autoComplete="email" /></label>
        <label>Contraseña<input name="password" type="password" required minLength={8} autoComplete="current-password" /></label>
        <button className="p" formAction={signIn}>Ingresar</button><button formAction={signUp}>Crear cuenta</button>
      </form></div>
    </main>
  );
}
