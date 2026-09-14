import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { authDestination } from "@/lib/auth-policy";
import { env } from "@/lib/env";
import { isSilpoConnected } from "@/lib/silpo/connection";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let pendingCookies: Parameters<typeof response.cookies.set>[] = [];
  const supabase = createServerClient(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          pendingCookies = values.map(({ name, value, options }) => [
            name,
            value,
            options,
          ]);
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          pendingCookies.forEach((cookie) => response.cookies.set(...cookie));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const destination = authDestination(
    request.nextUrl.pathname,
    Boolean(userId),
    userId ? await isSilpoConnected(userId) : false,
  );
  if (!destination) return response;

  const redirect = NextResponse.redirect(new URL(destination, request.url));
  pendingCookies.forEach((cookie) => redirect.cookies.set(...cookie));
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
