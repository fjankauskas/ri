// Matriz de permisos (generada: es la misma que usa la base de datos en public.default_perm).
export const MODULES = [["inventory", "Inventario"], ["sales", "Ventas y clientes"], ["invoicing", "Facturación ARCA"], ["purchases", "Compras y proveedores"], ["network", "Red de empresas"], ["gs1", "GS1"], ["reports", "Reportes"], ["users", "Usuarios y permisos"]] as const;
export const ACTIONS = [["view", "Consultar"], ["create", "Crear"], ["edit", "Editar"], ["delete", "Eliminar"], ["approve", "Autorizar"]] as const;
export const ROLES = [["admin", "Administrador"], ["manager", "Encargado"], ["worker", "Trabajador"], ["auditor", "Auditor"]] as const;
export const ROLE_LABEL: Record<string, string> = { owner: "Dueño", admin: "Administrador", manager: "Encargado", worker: "Trabajador", auditor: "Auditor" };
export const ROLE_INFO: Record<string, string> = {
  owner: "Acceso total. Es quien creó la empresa y no se puede modificar ni quitar.",
  admin: "Gestiona todo, incluidos usuarios y permisos.",
  manager: "Opera el inventario, compras, ventas y red; autoriza compras y pedidos; no administra usuarios.",
  worker: "Trabajo diario: ingresa y mueve stock, registra ventas y recibe compras. No elimina ni autoriza.",
  auditor: "Solo consulta: ve todo, incluidos reportes y usuarios, y no puede modificar nada.",
};
export const DEFAULTS: Record<string, string[]> = {
 "admin": [
  "inventory:view",
  "inventory:create",
  "inventory:edit",
  "inventory:delete",
  "inventory:approve",
  "sales:view",
  "sales:create",
  "sales:edit",
  "sales:delete",
  "sales:approve",
  "invoicing:view",
  "invoicing:create",
  "invoicing:edit",
  "invoicing:delete",
  "invoicing:approve",
  "purchases:view",
  "purchases:create",
  "purchases:edit",
  "purchases:delete",
  "purchases:approve",
  "network:view",
  "network:create",
  "network:edit",
  "network:delete",
  "network:approve",
  "gs1:view",
  "gs1:create",
  "gs1:edit",
  "gs1:delete",
  "gs1:approve",
  "reports:view",
  "reports:create",
  "reports:edit",
  "reports:delete",
  "reports:approve",
  "users:view",
  "users:create",
  "users:edit",
  "users:delete",
  "users:approve"
 ],
 "manager": [
  "inventory:view",
  "inventory:create",
  "inventory:edit",
  "inventory:delete",
  "inventory:approve",
  "sales:view",
  "sales:create",
  "sales:edit",
  "invoicing:view",
  "invoicing:create",
  "purchases:view",
  "purchases:create",
  "purchases:edit",
  "purchases:approve",
  "network:view",
  "network:create",
  "network:edit",
  "network:approve",
  "gs1:view",
  "gs1:create",
  "gs1:edit",
  "reports:view"
 ],
 "worker": [
  "inventory:view",
  "inventory:create",
  "inventory:edit",
  "sales:view",
  "sales:create",
  "invoicing:view",
  "purchases:view",
  "purchases:create",
  "network:view",
  "gs1:view"
 ],
 "auditor": [
  "inventory:view",
  "sales:view",
  "invoicing:view",
  "purchases:view",
  "network:view",
  "gs1:view",
  "reports:view",
  "users:view"
 ]
};
export type PermOverride = { role_key: string; module: string; action: string; allowed: boolean };
/** Permisos efectivos de un rol: los valores por defecto con los cambios que hizo la empresa encima. */
export function effectivePerms(role: string, overrides: PermOverride[]): Set<string> {
  if (role === "owner") return new Set(MODULES.flatMap(([m]) => ACTIONS.map(([a]) => `${m}:${a}`)));
  const s = new Set(DEFAULTS[role] ?? []);
  for (const o of overrides) if (o.role_key === role) (o.allowed ? s.add(`${o.module}:${o.action}`) : s.delete(`${o.module}:${o.action}`));
  return s;
}
export const MODULE_TEXT: Record<string, string> = Object.fromEntries(MODULES.map(([k, v]) => [k, v]));
export const ACTION_TEXT: Record<string, string> = { view: "consultar", create: "crear", edit: "editar", delete: "eliminar", approve: "autorizar" };
