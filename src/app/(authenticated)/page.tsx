import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";
import { listMyParties } from "@/lib/party/service";

import { createPartyAction, joinPartyAction } from "./parties/actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (!(await isSilpoConnected(user.id))) redirect("/connect-silpo");
  const { error } = await searchParams;
  const parties = await listMyParties(user.id);

  return (
    <main className="mx-auto max-w-xl space-y-8 p-6">
      <h1 className="text-2xl font-semibold">Silpo Party</h1>
      {error && <p role="alert" className="text-red-600">{error}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">Створити вечірку</h2>
        <form action={createPartyAction} className="flex gap-2">
          <input
            name="name"
            placeholder="Назва вечірки"
            required
            className="flex-1 rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">
            Створити
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Приєднатись за кодом</h2>
        <form action={joinPartyAction} className="flex gap-2">
          <input
            name="joinCode"
            placeholder="Код"
            required
            className="flex-1 rounded border px-3 py-2 uppercase"
          />
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">
            Приєднатись
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Мої вечірки</h2>
        {parties.length === 0 && <p className="text-zinc-500">Ще немає вечірок.</p>}
        <ul className="space-y-2">
          {(parties as Array<Record<string, unknown>>).map((party) => (
            <li key={party.id as string}>
              <a href={`/parties/${party.id}`} className="block rounded border p-3 hover:bg-zinc-50">
                <span className="font-medium">{party.name as string}</span>{" "}
                <span className="text-sm text-zinc-500">
                  ({party.role === "CREATOR" ? "творець" : "учасник"}, {party.status as string})
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
