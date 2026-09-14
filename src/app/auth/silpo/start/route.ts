import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { requireUser } from "@/lib/auth";
import { startSilpoAuthorization } from "@/lib/silpo/connection";

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const callbackUrl = new URL("/auth/silpo/callback", request.url).toString();
  redirect((await startSilpoAuthorization(user.id, callbackUrl)).toString());
}
