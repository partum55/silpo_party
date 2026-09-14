const FALLBACK_BG = ["bg-tomato/15 text-tomato-ink", "bg-basil/15 text-basil", "bg-butter/25 text-butter-ink", "bg-plum/15 text-plum"];

function hashIndex(seed: string, length: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

const SIZES = { sm: "h-7 w-7 text-xs", md: "h-9 w-9 text-sm", lg: "h-12 w-12 text-base" } as const;

export function Avatar({
  name,
  avatarUrl,
  seed,
  size = "md",
  ring = false,
}: {
  name: string;
  avatarUrl?: string | null;
  seed?: string;
  size?: keyof typeof SIZES;
  ring?: boolean;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const fallback = FALLBACK_BG[hashIndex(seed ?? name, FALLBACK_BG.length)];
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${SIZES[size]} ${
        avatarUrl ? "bg-stone-soft" : fallback
      } ${ring ? "ring-2 ring-paper" : ""}`}
      title={name}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function AvatarStack({
  members,
  max = 5,
}: {
  members: Array<{ id: string; name: string; avatarUrl?: string | null }>;
  max?: number;
}) {
  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((member) => (
        <Avatar key={member.id} name={member.name} avatarUrl={member.avatarUrl} seed={member.id} size="sm" ring />
      ))}
      {overflow > 0 && (
        <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-stone-soft text-xs font-semibold text-ink-soft ring-2 ring-paper">
          +{overflow}
        </span>
      )}
    </div>
  );
}
