import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/callback", request.url).toString(),
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}
