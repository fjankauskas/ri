import Alert from "@/components/Alert";
import { Card, Pill, Stepper, type Step } from "@/components/ui";
import { saveArcaProfile, saveArcaPv, generateCsr, uploadCert, importCreds, testArca } from "@/app/sales-actions";
import { hasServiceKey } from "@/lib/supabase/admin";
import { hasEncryptionKey } from "@/lib/arca/crypto";
import { EMISOR_LABEL } from "@/lib/billing";
import type { View, ViewCtx } from "@/lib/view";

const ENVS = [["homologacion", "Homologación (pruebas)"], ["produccion", "Producción"]] as const;
const when = (t: string) => new Date(t).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });

export default async function ArcaView({ sb, role }: ViewCtx): Promise<View> {
  const admin = ["OWNER", "ADMIN"].includes(role);
  const [{ data: profile }, { data: accs }] = await Promise.all([sb.from("arca_profile").select("*").maybeSingle(), sb.from("arca_accounts").select("*")]);
  const A = (accs as any[]) ?? [], acc = (env: string) => A.find((a) => a.environment === env);
  const active = profile?.active_env ?? "homologacion", cur = acc(active);
  const serverOk = hasServiceKey() && hasEncryptionKey();
  const done = [!!profile, !!cur?.punto_venta, !!(cur?.csr_pem || cur?.cert_pem), !!cur?.cert_pem, !!cur?.last_test_ok, !!profile?.enabled];
  const first = done.indexOf(false);
  const titles: [string, string][] = [
    ["Datos fiscales", "CUIT, razón social y condición frente al IVA de la empresa."],
    ["Punto de venta", "Un punto de venta habilitado en ARCA para «Factura Electrónica – Web Services»."],
    ["Clave y solicitud de certificado (CSR)", "La app genera la clave privada (queda cifrada en el servidor) y la solicitud que se sube a ARCA."],
    ["Certificado de ARCA", "El archivo .crt que ARCA emite a partir de la solicitud."],
    ["Probar la conexión", "Autentica con ARCA y consulta el último comprobante autorizado."],
    ["Activar la facturación", "Habilita el botón «Facturar» en las ventas."],
  ];
  const steps: Step[] = titles.map(([title, detail], i) => ({ title, detail, state: done[i] ? "done" : i === first ? "current" : "todo" }));
  const ro = !admin;

  const main = (
    <div className="grid gap-6">
      {!serverOk && (
        <Alert tone="danger" title="Falta configurar el servidor">
          Agregá en <code>.env.local</code> {!hasServiceKey() && <b>SUPABASE_SERVICE_ROLE_KEY</b>}{!hasServiceKey() && !hasEncryptionKey() && " y "}{!hasEncryptionKey() && <b>ARCA_ENCRYPTION_KEY</b>} y reiniciá <code>npm run dev</code>. Los pasos están en ARCA-SETUP.md.
        </Alert>
      )}
      {ro && <Alert tone="info" title="Solo lectura">Solo los dueños y administradores pueden cambiar la configuración fiscal.</Alert>}
      {active === "produccion" && <Alert tone="warning" title="Ambiente de producción activo">Las facturas que emitas tienen validez fiscal.</Alert>}
      <Card title="Estado de la facturación electrónica" sub={`Ambiente activo: ${active === "produccion" ? "producción" : "homologación (pruebas, sin validez fiscal)"}.`}><Stepper steps={steps} /></Card>

      <Card title="Datos fiscales" sub="Son los datos de la empresa que emite: cada empresa factura con su propio CUIT, punto de venta y certificado.">
        <form className="f" action={saveArcaProfile}>
          <input type="hidden" name="back" value="/sales?v=arca" />
          <fieldset disabled={ro} className="f">
            <div className="fgrid">
              <label>CUIT<input name="cuit" defaultValue={profile?.cuit ?? ""} required inputMode="numeric" placeholder="20-12345678-6" /></label>
              <label>Razón social<input name="legal_name" defaultValue={profile?.legal_name ?? ""} required /></label>
              <label>Condición frente al IVA<select name="iva_condition" defaultValue={profile?.iva_condition ?? "RI"}>{Object.entries(EMISOR_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>Inicio de actividades<input name="activity_start" type="date" defaultValue={profile?.activity_start ?? ""} /></label>
              <label className="full">Domicilio comercial<input name="address" defaultValue={profile?.address ?? ""} /></label>
              <label>Ingresos Brutos (N° de inscripción)<input name="gross_income" defaultValue={profile?.gross_income ?? ""} /></label>
              <label>Ambiente activo<select name="active_env" defaultValue={active}>{ENVS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            </div>
            <label className="flex items-center gap-2 font-normal"><input type="checkbox" name="enabled" defaultChecked={!!profile?.enabled} /> Facturación electrónica activada</label>
            <p className="text-sm text-mute">Responsable Inscripto emite Facturas A y B (discrimina IVA); Monotributista y Exento emiten Factura C. Si cambiás el CUIT hay que generar de nuevo los certificados.</p>
            <button className="btn btn-green justify-self-start">Guardar datos fiscales</button>
          </fieldset>
        </form>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {ENVS.map(([env, label]) => {
          const a = acc(env), isActive = env === active;
          const guide = env === "homologacion"
            ? "En ARCA, con tu clave fiscal, agregá el servicio «WSASS – Autogestión Certificados Homologación»: creá un certificado nuevo pegando la solicitud, descargá el .crt y asocialo al servicio de factura electrónica (wsfe)."
            : "En ARCA, entrá a «Administración de Certificados Digitales»: agregá un alias pegando la solicitud y descargá el .crt. Después, en «Administrador de Relaciones de Clave Fiscal», asociá ese certificado al servicio de factura electrónica (wsfe).";
          return (
            <Card key={env} title={label} sub={isActive ? "Ambiente activo" : "Ambiente inactivo"}>
              <div className="grid gap-5">
                <form className="flex items-end gap-2" action={saveArcaPv}>
                  <input type="hidden" name="back" value="/sales?v=arca" /><input type="hidden" name="env" value={env} />
                  <label className="flex-1">Punto de venta<input name="punto_venta" type="number" min="1" max="99998" defaultValue={a?.punto_venta ?? ""} required disabled={ro} /></label>
                  <button className="btn btn-gray" disabled={ro}>Guardar</button>
                </form>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {a?.cert_pem ? <Pill tone="green">Certificado cargado</Pill> : a?.csr_pem ? <Pill tone="amber">Esperando el certificado de ARCA</Pill> : <Pill tone="gray">Sin certificado</Pill>}
                  {a?.cert_valid_to && <span className="text-mute">vence el {when(a.cert_valid_to)}</span>}
                  {a?.cert_valid_to && new Date(a.cert_valid_to).getTime() - Date.now() < 30 * 864e5 && <Pill tone="red">Vence pronto</Pill>}
                </div>
                {!ro && (
                  <form action={generateCsr}>
                    <input type="hidden" name="back" value="/sales?v=arca" /><input type="hidden" name="env" value={env} />
                    <button className="btn btn-teal" disabled={!profile}>{a?.csr_pem || a?.cert_pem ? "Generar una clave y solicitud nuevas" : "1. Generar clave y solicitud (CSR)"}</button>
                    {(a?.csr_pem || a?.cert_pem) && <p className="mt-2 text-xs text-mute">Reemplaza la clave y el certificado de este ambiente: tendrás que pedir un certificado nuevo en ARCA.</p>}
                  </form>
                )}
                {a?.csr_pem && (
                  <div className="grid gap-2">
                    <label>Solicitud (CSR) para subir a ARCA<textarea readOnly rows={5} defaultValue={a.csr_pem} className="font-mono text-xs" /></label>
                    <a className="text-sm" download={`solicitud-${env}.csr`} href={`data:application/x-pem-file;charset=utf-8,${encodeURIComponent(a.csr_pem)}`}>Descargar el archivo .csr</a>
                    <p className="text-sm text-mute">{guide} Los nombres exactos de los servicios pueden variar en el sitio de ARCA.</p>
                  </div>
                )}
                {!ro && a?.csr_pem && !a?.cert_pem && (
                  <form className="f" action={uploadCert} encType="multipart/form-data">
                    <input type="hidden" name="back" value="/sales?v=arca" /><input type="hidden" name="env" value={env} />
                    <label>2. Certificado (.crt) que entregó ARCA<textarea name="cert" rows={4} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" /></label>
                    <label>…o elegí el archivo<input type="file" name="cert_file" accept=".crt,.pem,.cer" /></label>
                    <button className="btn btn-green justify-self-start">Guardar certificado</button>
                  </form>
                )}
                {!ro && (
                  <details className="rounded-lg border border-line p-3">
                    <summary className="text-sm">Ya tengo la clave privada y el certificado (importar)</summary>
                    <form className="f mt-3" action={importCreds} encType="multipart/form-data">
                      <input type="hidden" name="back" value="/sales?v=arca" /><input type="hidden" name="env" value={env} />
                      <label>Clave privada (.key, sin contraseña)<textarea name="key" rows={3} placeholder="-----BEGIN PRIVATE KEY-----" className="font-mono text-xs" /></label>
                      <label>…o archivo<input type="file" name="key_file" accept=".key,.pem" /></label>
                      <label>Certificado (.crt)<textarea name="cert" rows={3} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" /></label>
                      <label>…o archivo<input type="file" name="cert_file" accept=".crt,.pem,.cer" /></label>
                      <button className="btn btn-gray justify-self-start">Importar</button>
                    </form>
                  </details>
                )}
                {!ro && (
                  <form action={testArca} className="grid gap-2 border-t border-line pt-4">
                    <input type="hidden" name="back" value="/sales?v=arca" /><input type="hidden" name="env" value={env} />
                    <button className="btn btn-green justify-self-start" disabled={!a?.cert_pem || !a?.punto_venta}>3. Probar conexión con ARCA</button>
                    {a?.last_test_at && <p className={`text-sm ${a.last_test_ok ? "in" : "out"}`}>{a.last_test_ok ? "✔" : "✖"} {when(a.last_test_at)} — {a.last_test_message}</p>}
                  </form>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Cómo se protege">
        <ul className="grid gap-2 text-sm text-mute">
          <li>La clave privada de cada empresa se guarda <b>cifrada</b> (AES-256-GCM) con una clave que solo existe en el servidor. Ningún usuario de la app puede leerla.</li>
          <li>Cada empresa usa sus propias credenciales: no se comparten entre empresas ni entre ambientes.</li>
          <li>Solo dueños y administradores configuran ARCA; vendedores, dueños y administradores facturan.</li>
          <li>Cada intento de emisión queda registrado (sin datos de acceso).</li>
        </ul>
      </Card>
    </div>
  );
  return { title: "Facturación ARCA", intro: "Conectá la empresa con ARCA para emitir facturas electrónicas con CAE.", main };
}
