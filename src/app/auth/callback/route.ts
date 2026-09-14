import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { isSilpoConnected } from "@/lib/silpo/connection";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) redirect("/login?error=google");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) redirect("/login?error=google");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=google");
  redirect((await isSilpoConnected(data.user.id)) ? "/" : "/connect-silpo");
}
