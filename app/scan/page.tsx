import { legacy } from "@/lib/legacy";
import type { SP } from "@/components/Shell";
export default function Old({ searchParams }: { searchParams: SP }) { return legacy("/inventory", { v: "trace", modal: "scan" }, searchParams); }
