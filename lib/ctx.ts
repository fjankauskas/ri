import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
export async function ctx() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: m } = await sb.from("memberships").select("role, organizations(id, display_name)").limit(1).maybeSingle();
  const org = (m as any)?.organizations as { id: string; display_name: string } | undefined;
  if (!org) redirect("/onboarding");
  return { sb, user, org, role: (m as any).role as string };
}
