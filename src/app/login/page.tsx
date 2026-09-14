import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getUser();
  if (user) redirect((await isSilpoConnected(user.id)) ? "/" : "/connect-silpo");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Silpo Party</h1>
        {error && <p role="alert">Google sign-in failed. Please try again.</p>}
        <a className="inline-block rounded bg-black px-4 py-2 text-white" href="/auth/google">
          Continue with Google
        </a>
      </div>
    </main>
  );
}
