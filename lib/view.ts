import type { Params } from "./url";
export type Badges = { alerts: number; requests: number; incoming: number; dispatch: number };
export type ViewCtx = { sb: any; org: { id: string; display_name: string }; role: string; P: Params; badges: Badges };
export type View = { title: string; intro?: string; main: React.ReactNode; aside?: React.ReactNode };
