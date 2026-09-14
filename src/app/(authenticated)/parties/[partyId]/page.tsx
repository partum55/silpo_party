/* eslint-disable react-hooks/error-boundaries -- RuleViolation is raised while loading, before JSX is rendered. */
import Link from "next/link";

import { PartyLive } from "@/components/party-live";
import { requireUser } from "@/lib/auth";
import { getCart } from "@/lib/cart/service";
import { listMessages } from "@/lib/chat/service";
import { getParty, listMembers } from "@/lib/party/service";
import { RuleViolation } from "@/lib/party/rules";
import { errorMessage } from "@/lib/party/error-copy";
import { InlineAlert } from "@/components/ui/inline-alert";

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
      <>
        {error && (
          <div className="mx-auto w-full max-w-[26rem] px-4 pt-3 sm:max-w-[30rem] md:max-w-[34rem]">
            <InlineAlert tone="error">{errorMessage(error)}</InlineAlert>
          </div>
        )}
        <PartyLive
          partyId={partyId}
          partyName={party.name as string}
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
      </>
    );
  } catch (caught) {
    if (caught instanceof RuleViolation) {
      return (
        <main className="grid min-h-dvh place-items-center p-6 text-center">
          <div className="space-y-2">
            <p className="text-ink-soft">{errorMessage(caught.code)}</p>
            <Link href="/" className="text-sm underline underline-offset-2">
              ← Мої вечірки
            </Link>
          </div>
        </main>
      );
    }
    throw caught;
  }
}
