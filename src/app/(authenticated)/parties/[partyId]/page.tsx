/* eslint-disable react-hooks/error-boundaries -- RuleViolation is raised while loading, before JSX is rendered. */
import Link from "next/link";

import { PartyLive } from "@/components/party-live";
import { requireUser } from "@/lib/auth";
import { getCart } from "@/lib/cart/service";
import { listMessages } from "@/lib/chat/service";
import { getParty, listMembers } from "@/lib/party/service";
import { RuleViolation } from "@/lib/party/rules";

export default async function PartyPage({
  params,
  searchParams,
}: {
  params: Promise<{ partyId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { partyId } = await params;
  const { error } = await searchParams;

  try {
    const [party, members, messages, cart] = await Promise.all([
      getParty(partyId, user.id),
      listMembers(partyId, user.id),
      listMessages(partyId, user.id),
      getCart(partyId, user.id),
    ]);
    const isCreator = party.role === "CREATOR";

    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <Link href="/" className="text-sm text-zinc-500 underline">
          ← Мої вечірки
        </Link>
        {error && <p role="alert" className="text-red-600">{error}</p>}

        <h1 className="text-2xl font-semibold">{party.name as string}</h1>

        <PartyLive
          partyId={partyId}
          currentUserId={user.id}
          isCreator={isCreator}
          initialParty={{
            status: party.status as "ACTIVE" | "COMPLETED",
            agent_status: party.agent_status as string,
            agent_error: (party.agent_error as string | null) ?? null,
            join_code: party.join_code as string,
            mode: party.mode as "SHOPPING" | "DINNER" | "EVENT",
            budget_uah: party.budget_uah == null ? null : Number(party.budget_uah),
          }}
          initialMembers={members as never[]}
          initialMessages={messages as never[]}
          initialCart={{
            status: cart.status as "DRAFT" | "FINALIZED",
            total_uah: (cart.total_uah as number | null) ?? null,
            checkout_url: (cart.checkout_url as string | null) ?? null,
            items: (cart.items ?? []) as never[],
            recipes: (cart.recipes ?? []) as never[],
            memberTotals: (cart.memberTotals ?? []) as never[],
          }}
        />
      </main>
    );
  } catch (caught) {
    if (caught instanceof RuleViolation) {
      return (
        <main className="grid min-h-screen place-items-center p-6 text-center">
          <div className="space-y-2">
            <p>Немає доступу до цієї вечірки ({caught.code}).</p>
            <Link href="/" className="underline">
              ← Мої вечірки
            </Link>
          </div>
        </main>
      );
    }
    throw caught;
  }
}
