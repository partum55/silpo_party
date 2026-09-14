import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";
import { extractJoinCode, PENDING_JOIN_COOKIE } from "@/lib/party/join-code";
import { joinPartyByCode } from "@/lib/party/service";
import { RuleViolation } from "@/lib/party/rules";

/**
 * What an invite link resolves to. A visitor who isn't signed in yet (or hasn't connected Silpo) can't join
 * immediately — the code is parked in a cookie rather than lost, and picked up again from "/" once they've
 * finished login/Silpo-connect (see the home page), so clicking the link "just works" either way. Cookies can
 * only be written from a Server Action or Route Handler (not a page's render), hence this is a route, not a page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const joinCode = extractJoinCode(code);
  const user = await getUser();

  if (!user || !(await isSilpoConnected(user.id))) {
    (await cookies()).set(PENDING_JOIN_COOKIE, joinCode, { httpOnly: true, sameSite: "lax", maxAge: 3600, path: "/" });
    redirect(user ? "/connect-silpo" : "/login");
  }

  (await cookies()).delete(PENDING_JOIN_COOKIE);
  let partyId: string;
  try {
    partyId = (await joinPartyByCode(joinCode, user.id)).id;
  } catch (error) {
    if (error instanceof RuleViolation) redirect(`/?error=${error.code}`);
    throw error;
  }
  redirect(`/parties/${partyId}`);
}
