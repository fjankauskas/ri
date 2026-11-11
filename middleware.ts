
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { CookieOptions } from "@supabase/ssr";

type CookieToSet = {
  name: string;
  value: string;
  options?: CookieOptions;
};

export async function middleware(req: NextRequest) {
  // Rutas públicas de GS1 Digital Link
  const path = req.nextUrl.pathname;

  if (
    path.startsWith("/id/") ||
    path === "/api/gs1/resolve"
  ) {
    return NextResponse.next();
  }

  let res = NextResponse.next({ request: req });

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),

        setAll: (list: CookieToSet[]) => {
          list.forEach(({ name, value }) => {
            req.cookies.set(name, value);
          });

          res = NextResponse.next({ request: req });

          list.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user && !req.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};