import Alert from "@/components/Alert";
import { Card } from "@/components/ui";
import { saveRolePerms, resetRolePerms } from "@/app/team-actions";
import { myPerms } from "@/lib/perms-server";
import { ACTIONS, MODULES, ROLES, ROLE_INFO, ROLE_LABEL, effectivePerms, type PermOverride } from "@/lib/perms";
import type { View, ViewCtx } from "@/lib/view";

export default async function RolesView({ sb, org, role }: ViewCtx): Promise<View> {
  const perms = await myPerms(sb, org.id, role), canEdit = perms.can("users", "edit");
  const { data } = await sb.from("org_role_perms").select("role_key, module, action, allowed").eq("organization_id", org.id);
  const ov = (data as PermOverride[]) ?? [];
  const main = (
    <div className="grid gap-6">
      {!canEdit && <Alert tone="info" title="Solo lectura">Tu rol puede ver los permisos pero no cambiarlos.</Alert>}
      {ROLES.map(([key, label]) => {
        const eff = effectivePerms(key, ov);
        return (
          <Card key={key} title={label} sub={ROLE_INFO[key]}>
            <form action={saveRolePerms}>
              <input type="hidden" name="back" value="/team?v=roles" /><input type="hidden" name="role_key" value={key} />
              <fieldset disabled={!canEdit}>
                <div className="tw"><table>
                  <thead><tr><th>Módulo</th>{ACTIONS.map(([a, l]) => <th key={a} className="text-center">{l}</th>)}</tr></thead>
                  <tbody>{MODULES.map(([m, ml]) => <tr key={m}><td className="k">{ml}</td>{ACTIONS.map(([a, al]) => <td key={a} className="text-center"><input type="checkbox" name={`p:${m}:${a}`} defaultChecked={eff.has(`${m}:${a}`)} aria-label={`${label}: ${al} en ${ml}`} /></td>)}</tr>)}</tbody>
                </table></div>
                {canEdit && <div className="mt-4 flex flex-wrap gap-3"><button className="btn btn-green">Guardar permisos de {label.toLowerCase()}</button><button className="btn btn-gray" formAction={resetRolePerms}>Restablecer valores recomendados</button></div>}
              </fieldset>
            </form>
          </Card>
        );
      })}
      <Card title={ROLE_LABEL.owner} sub={ROLE_INFO.owner}><p className="text-sm text-mute">El dueño siempre tiene todos los permisos y no se puede modificar.</p></Card>
    </div>
  );
  const aside = (
    <>
      <Card title="Cómo funcionan los permisos"><ul className="grid gap-2 text-sm text-mute">
        <li><b>Consultar:</b> ver la información del módulo.</li><li><b>Crear / Editar / Eliminar:</b> cargar, modificar o dar de baja datos.</li>
        <li><b>Autorizar:</b> aprobar operaciones sensibles: órdenes de compra, pedidos de la red, anulación de facturas.</li>
        <li>Los cambios rigen de inmediato para todas las personas con ese rol.</li>
        <li>El rol <b>Auditor</b> es de solo lectura también en la base de datos: aunque se le marquen permisos de escritura, no puede modificar.</li>
      </ul></Card>
      <Card title="Atajo"><a href="/team?v=members" className="btn btn-gray no-underline">Ver usuarios</a></Card>
    </>
  );
  return { title: "Roles y permisos", intro: "Elegí, módulo por módulo, qué puede consultar, crear, editar, eliminar y autorizar cada rol.", main, aside };
}
