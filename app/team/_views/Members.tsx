import Alert from "@/components/Alert";
import { Card, Pill, Empty, type PillTone } from "@/components/ui";
import { inviteMember, changeRole, removeMember, cancelInvite } from "@/app/team-actions";
import { myPerms } from "@/lib/perms-server";
import { ROLES, ROLE_INFO, ROLE_LABEL } from "@/lib/perms";
import { day } from "@/lib/format";
import type { View, ViewCtx } from "@/lib/view";

const TONE: Record<string, PillTone> = { owner: "green", admin: "blue", manager: "amber", worker: "gray", auditor: "gray" };
export default async function MembersView({ sb, org, role }: ViewCtx): Promise<View> {
  const perms = await myPerms(sb, org.id, role), hidden = <input type="hidden" name="back" value="/team?v=members" />;
  const [{ data, error }, { data: inv }] = await Promise.all([sb.rpc("list_team", { p_org: org.id }), sb.from("member_invites").select("id, email, role_key, created_at").is("accepted_at", null).order("created_at", { ascending: false })]);
  const T = (data as { user_id: string; email: string; role_key: string; is_you: boolean }[]) ?? [], I = (inv as any[]) ?? [];
  const canEdit = perms.can("users", "edit"), canDel = perms.can("users", "delete"), canInvite = perms.can("users", "create");
  const main = (
    <div className="grid gap-6">
      {error && <Alert tone="danger" title="No se pudo leer el equipo">{error.message.replace(/^[A-Z_]+: /, "")}{/list_team/.test(error.message) ? " ¿Ejecutaste la migración 0009?" : ""}</Alert>}
      <div className="tw"><table>
        <thead><tr><th>Usuario</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          {T.map((u) => (
            <tr key={u.user_id}>
              <td className="k">{u.email}{u.is_you && <span className="ml-2 text-xs font-normal text-mute">(vos)</span>}</td>
              <td>{u.role_key === "owner" || u.is_you || !canEdit ? <Pill tone={TONE[u.role_key]}>{ROLE_LABEL[u.role_key]}</Pill> : (
                <form action={changeRole} className="flex items-center gap-2">{hidden}<input type="hidden" name="user" value={u.user_id} />
                  <select name="role_key" defaultValue={u.role_key} className="w-44!">{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><button className="btn btn-gray btn-sm">Cambiar</button></form>)}</td>
              <td className="n">{u.role_key !== "owner" && !u.is_you && canDel && <form action={removeMember}>{hidden}<input type="hidden" name="user" value={u.user_id} /><button className="btn btn-gray btn-sm">Quitar</button></form>}</td>
            </tr>
          ))}
          {!T.length && !error && <Empty cols={3}>No se pudo listar el equipo.</Empty>}
        </tbody>
      </table></div>
      {I.length > 0 && (
        <div><h2 className="mb-3">Invitaciones pendientes</h2><div className="tw"><table>
          <thead><tr><th>Email</th><th>Rol</th><th>Enviada</th><th></th></tr></thead>
          <tbody>{I.map((i) => <tr key={i.id}><td className="k">{i.email}</td><td><Pill tone={TONE[i.role_key]}>{ROLE_LABEL[i.role_key]}</Pill></td><td>{day(i.created_at)}</td><td className="n">{canDel && <form action={cancelInvite}>{hidden}<input type="hidden" name="id" value={i.id} /><button className="btn btn-gray btn-sm">Cancelar</button></form>}</td></tr>)}</tbody>
        </table></div><p className="mt-2 text-sm text-mute">Cuando esa persona se registre o ingrese con ese email, se une sola a la empresa con el rol elegido.</p></div>
      )}
    </div>
  );
  const aside = (
    <>
      {canInvite && (
        <Card title="Agregar usuario" sub="Por email: si ya tiene cuenta entra al instante; si no, queda invitada.">
          <form action={inviteMember} className="f">{hidden}
            <label>Email<input name="email" type="email" required /></label>
            <label>Rol<select name="role_key" defaultValue="worker">{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <button className="btn btn-green">Agregar</button>
          </form>
        </Card>
      )}
      <Card title="Qué puede hacer cada rol"><ul className="grid gap-3 text-sm">{["owner", ...ROLES.map(([k]) => k)].map((k) => <li key={k}><b>{ROLE_LABEL[k]}</b><span className="block text-mute">{ROLE_INFO[k]}</span></li>)}</ul><p className="mt-3 text-sm"><a href="/team?v=roles">Ajustar los permisos de cada rol →</a></p></Card>
    </>
  );
  return { title: "Usuarios", intro: "Quién tiene acceso a la empresa y con qué rol.", main, aside };
}
