import { notFound } from "next/navigation";

import { PartyLive } from "@/components/party-live";
import { findScenario, SCENARIOS } from "@/demo/scenarios";

export const generateStaticParams = () => SCENARIOS.map((scenario) => ({ partyId: scenario.id }));

export default async function PartyPage({ params }: { params: Promise<{ partyId: string }> }) {
  const scenario = findScenario((await params).partyId);
  if (!scenario) notFound();
  return <PartyLive scenario={scenario} />;
}
