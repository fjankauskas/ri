"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/ctx";
import { ACTIONS, DEFAULTS, MODULES, ROLES } from "@/lib/perms";
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const PATH = { members: "/team?v=members", roles: "/team?v=roles" };
const back = (f: FormData, def: string) => (/^\/team(\?[\w=&%.|\-]*)?$/.test(s(f, "back")) ? s(f, "back") : def);
const withParam = (path: string, k: string, v: string) => `${path}${path.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
const clean = (e: any) => String(e?.message ?? "Error inesperado").replace(/^[A-Z_]+: /, "");
async function run(path: string, fn: () => Promise<string | void>, ok: string) {
  let err = "", out: string | void = undefined;
  try { out = await fn(); } catch (e: any) { err = clean(e); }
  revalidatePath("/", "layout");
  redirect(err ? withParam(path, "e", err) : withParam(path, "ok", out || ok));
}
const rpc = async (sb: any, fn: string, args: Record<string, unknown>) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };
const roleOk = (k: string) => ROLES.some(([r]) => r === k);

export async function inviteMember(f: FormData) {
  const { sb, org } = await ctx();
  await run(back(f, PATH.members), async () => {
    const r = await rpc(sb, "invite_member", { p_org: org.id, p_email: s(f, "email"), p_role_key: s(f, "role_key") });
    return r === "ADDED" ? "La persona ya tenía cuenta y se agregó a la empresa." : "Invitación creada. Cuando esa persona se registre o ingrese con ese email, se une sola a la empresa.";
  }, "Listo");
}
export async function changeRole(f: FormData) { const { sb, org } = await ctx(); await run(back(f, PATH.members), async () => { await rpc(sb, "set_member_role", { p_org: org.id, p_user: s(f, "user"), p_role_key: s(f, "role_key") }); }, "Rol actualizado"); }
export async function removeMember(f: FormData) { const { sb, org } = await ctx(); await run(back(f, PATH.members), async () => { await rpc(sb, "remove_member", { p_org: org.id, p_user: s(f, "user") }); }, "Usuario quitado de la empresa"); }
export async function cancelInvite(f: FormData) { const { sb, org } = await ctx(); await run(back(f, PATH.members), async () => { await rpc(sb, "cancel_invite", { p_org: org.id, p_id: s(f, "id") }); }, "Invitación cancelada"); }

const allCombos = () => MODULES.flatMap(([m]) => ACTIONS.map(([a]) => ({ module: m, action: a })));
/** Guarda los permisos de un rol: cada casilla marcada es «permitido», cada una sin marcar es «no permitido». */
export async function saveRolePerms(f: FormData) {
  const { sb, org } = await ctx(); const role = s(f, "role_key");
  await run(back(f, PATH.roles), async () => {
    if (!roleOk(role)) throw new Error("Elegí un rol (el del dueño no se modifica).");
    await rpc(sb, "set_role_perms", { p_org: org.id, p_role_key: role, p_perms: allCombos().map((c) => ({ ...c, allowed: !!f.get(`p:${c.module}:${c.action}`) })) });
  }, "Permisos guardados");
}
export async function resetRolePerms(f: FormData) {
  const { sb, org } = await ctx(); const role = s(f, "role_key");
  await run(back(f, PATH.roles), async () => {
    if (!roleOk(role)) throw new Error("Elegí un rol.");
    const def = new Set(DEFAULTS[role] ?? []);
    await rpc(sb, "set_role_perms", { p_org: org.id, p_role_key: role, p_perms: allCombos().map((c) => ({ ...c, allowed: def.has(`${c.module}:${c.action}`) })) });
  }, "Permisos restablecidos a los valores recomendados");
}
