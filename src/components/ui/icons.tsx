type IconProps = { className?: string };

const base = "1.75";

export function BasketIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 10h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8L4 10Z" />
      <path d="M8 10 9.5 4.5a2 2 0 0 1 2-1.5h1a2 2 0 0 1 2 1.5L16 10" />
      <path d="M9 14v3M15 14v3" />
    </svg>
  );
}

export function PotIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 11h16v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-4Z" />
      <path d="M2 11h20M8 11 7 7M16 11l1-4" />
      <path d="M12 3v3" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4Z" />
    </svg>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 5h16v11H9l-4 4V5Z" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M2.5 20a6 6 0 0 1 11 0" />
      <path d="M15.5 6.5a3 3 0 1 1 0 6" />
      <path d="M14.5 13.2A6 6 0 0 1 21.5 19" />
    </svg>
  );
}

export function WalletIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6a3 3 0 0 1 0-6h12" />
      <circle cx="16.5" cy="14" r="1.3" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={base} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
