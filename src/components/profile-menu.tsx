import type { User } from "@supabase/supabase-js";

import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button-classes";

export function ProfileMenu({ user, connected }: { user: User; connected: boolean }) {
  const avatar = user.user_metadata.avatar_url as string | undefined;
  const name = (user.user_metadata.full_name ?? user.user_metadata.name ?? "Ви") as string;
  return (
    <details className="fixed right-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-20">
      <summary className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-full border border-stone bg-paper-raised shadow-[0_1px_2px_rgba(42,36,32,.12)] [&::-webkit-details-marker]:hidden">
        <Avatar name={name} avatarUrl={avatar} size="sm" />
      </summary>
      <div className="absolute right-0 mt-2 w-64 space-y-3 rounded-[var(--radius-md)] border border-stone bg-paper-raised p-4 text-sm shadow-[0_4px_16px_rgba(42,36,32,.12)]">
        <div className="flex items-center gap-2.5">
          <Avatar name={name} avatarUrl={avatar} size="md" />
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="truncate text-xs text-ink-soft">{user.email}</p>
          </div>
        </div>
        <p className="text-xs text-ink-soft">
          Silpo: <span className={connected ? "text-basil" : "text-danger"}>{connected ? "підключено" : "не підключено"}</span>
        </p>
        <form action="/auth/logout" method="post" noValidate>
          <button className={`${buttonClasses("secondary", "sm")} w-full`} type="submit">
            Вийти
          </button>
        </form>
      </div>
    </details>
  );
}
