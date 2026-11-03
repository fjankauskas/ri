import { ctx } from "@/lib/ctx";
import { ACTION_TEXT, MODULE_TEXT, effectivePerms, type PermOverride } from "@/lib/perms";
/** Verifica en la base que el rol del usuario permita la acción. Si la migración 0009 todavía no se aplicó, no bloquea. */
export async function mustCan(module: string, action: string): Promise<void> {
  const { sb, org } = await ctx();
  const { data, error } = await sb.rpc("has_perm", { p_org: org.id, p_module: module, p_action: action });
  if (error) { if (error.code === "PGRST202" || /has_perm/.test(error.message)) return; throw new Error(error.message); }
  if (!data) throw new Error(`Tu rol no permite ${ACTION_TEXT[action] ?? action} en «${MODULE_TEXT[module] ?? module}».`);
}
/** Permisos del usuario actual (para mostrar u ocultar botones). Sin la migración 0009 se comporta como antes: todo permitido salvo el rol VIEWER. */
export async function myPerms(sb: any, orgId: string, legacyRole: string): Promise<{ role: string; can: (m: string, a: string) => boolean }> {
  const [{ data: rk, error }, { data: ov }] = await Promise.all([sb.rpc("role_key_of", { p_org: orgId }), sb.from("org_role_perms").select("role_key, module, action, allowed").eq("organization_id", orgId)]);
  if (error || !rk) { const ro = legacyRole === "VIEWER"; return { role: ro ? "auditor" : "worker", can: (_m, a) => (ro ? a === "view" : true) }; }
  const set = effectivePerms(rk as string, (ov as PermOverride[]) ?? []);
  return { role: rk as string, can: (m, a) => set.has(`${m}:${a}`) };
}
