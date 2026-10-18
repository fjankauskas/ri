import { ctx } from "@/lib/ctx";
import Shell, { type SP } from "@/components/Shell";
import Scanner from "@/components/Scanner";
export default async function Scan({ searchParams }: { searchParams: SP }) {
  const { org } = await ctx();
  return <Shell org={org.display_name} sp={searchParams}><section><h2>Escanear lote</h2><Scanner /></section></Shell>;
}
