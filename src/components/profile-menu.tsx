import type { User } from "@supabase/supabase-js";

export function ProfileMenu({ user, connected }: { user: User; connected: boolean }) {
  const avatar = user.user_metadata.avatar_url as string | undefined;
  const name = (user.user_metadata.full_name ?? user.user_metadata.name ?? "User") as string;
  return (
    <details className="fixed right-4 top-4 z-10">
      <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center overflow-hidden rounded-full border bg-white">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="h-full w-full object-cover" src={avatar} alt={`${name} avatar`} />
        ) : (
          <span aria-label="Profile">{name.charAt(0).toUpperCase()}</span>
        )}
      </summary>
      <div className="absolute right-0 mt-2 w-64 space-y-2 rounded border bg-white p-4 text-sm text-black shadow">
        <p className="font-medium">{name}</p>
        <p className="break-all text-zinc-600">{user.email}</p>
        <p>Silpo: {connected ? "Connected" : "Not connected"}</p>
        <form action="/auth/logout" method="post">
          <button className="underline" type="submit">Logout</button>
        </form>
      </div>
    </details>
  );
}
