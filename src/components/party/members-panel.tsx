import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { CheckIcon } from "@/components/ui/icons";

import type { Member } from "./types";

export function MembersPanel({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const forStack = members.map((member) => ({ id: member.user_id, name: member.user_id === currentUserId ? "Ви" : member.name, avatarUrl: member.avatarUrl }));
  const readyCount = members.filter((member) => member.ready).length;

  return (
    <details className="group rounded-[var(--radius-md)] border border-stone bg-paper-raised px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <AvatarStack members={forStack} />
          <span className="text-sm text-ink-soft">{members.length}/10 учасників</span>
          {readyCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-basil/10 px-2 py-0.5 text-xs font-medium text-basil">
              <CheckIcon className="h-3 w-3" />
              {readyCount}/{members.length} готові
            </span>
          )}
        </span>
        <span className="text-xs text-ink-soft transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ul className="mt-3 space-y-3 border-t border-stone pt-3">
        {members.map((member) => {
          const isSelf = member.user_id === currentUserId;
          return (
            <li key={member.user_id} className="flex items-start gap-2.5">
              <Avatar name={isSelf ? "Ви" : member.name} avatarUrl={member.avatarUrl} seed={member.user_id} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {isSelf ? "Ви" : member.name}
                  {member.role === "CREATOR" && <span className="text-xs font-normal text-ink-soft">організатор</span>}
                  {member.ready && (
                    <span className="flex items-center gap-0.5 text-xs font-normal text-basil" title="Готовий(-а)">
                      <CheckIcon className="h-3 w-3" />
                      готовий(-а)
                    </span>
                  )}
                </p>
                {member.wishes.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {member.wishes.map((wish) => (
                      <li key={wish.id} className="rounded-full bg-stone-soft px-2 py-0.5 text-xs text-ink-soft">
                        {wish.text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-xs text-stone-600">Ще нічого не просили</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
