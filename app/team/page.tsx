import { ctx } from "@/lib/ctx";
import Workspace, { type MenuItem } from "@/components/Workspace";
import { getBadges } from "@/lib/badges";
import type { SP } from "@/components/Shell";
import type { View, ViewCtx } from "@/lib/view";
import Members from "./_views/Members";
import Roles from "./_views/Roles";

const VIEWS: Record<string, (c: ViewCtx) => Promise<View>> = { members: Members, roles: Roles };
// Equipo: usuarios de la empresa y permisos de cada rol.
export default async function TeamPage({ searchParams }: { searchParams: SP }) {
  const P = await searchParams;
  const c = await ctx();
  const badges = await getBadges(c.sb);
  const v = P.v && VIEWS[P.v] ? P.v : "members";
  const view = await VIEWS[v]({ ...c, P, badges });
  const items: MenuItem[] = [{ key: "members", label: "Usuarios", icon: "users" }, { key: "roles", label: "Roles y permisos", icon: "shield" }];
  return <Workspace base="/team" items={items} active={v} org={c.org.display_name} params={P} badges={badges} title={view.title} intro={view.intro} aside={view.aside}>{view.main}</Workspace>;
}
