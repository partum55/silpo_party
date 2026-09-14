import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";

export default async function ConnectSilpoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (await isSilpoConnected(user.id)) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Connect Silpo</h1>
        <p>A Silpo connection is required to use this app.</p>
        {error && <p role="alert">Silpo connection failed. Please try again.</p>}
        <form action="/auth/silpo/start" method="post">
          <button className="rounded bg-black px-4 py-2 text-white" type="submit">
            Connect Silpo
          </button>
        </form>
      </div>
    </main>
  );
}
