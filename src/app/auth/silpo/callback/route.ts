import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { finishSilpoAuthorization } from "@/lib/silpo/connection";

export async function GET(request: NextRequest) {
  const user = await requireUser();
  const code = request.nextUrl.searchParams.get("code");
  let failed = !code || Boolean(request.nextUrl.searchParams.get("error"));
  if (!failed) {
    try {
      await finishSilpoAuthorization(
        user.id,
        code!,
        request.nextUrl.searchParams.get("state"),
      );
    } catch (error) {
      console.error("Silpo OAuth callback failed", error);
      failed = true;
    }
  }
  redirect(failed ? "/connect-silpo?error=silpo" : "/");
}
