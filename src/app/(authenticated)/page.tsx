import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";

export default async function Home() {
  const user = await requireUser();
  if (!(await isSilpoConnected(user.id))) redirect("/connect-silpo");
  return <main className="grid min-h-screen place-items-center text-xl">Connected</main>;
}
