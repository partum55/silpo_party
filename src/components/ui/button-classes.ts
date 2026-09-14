export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "md" | "sm" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-tomato text-ink hover:brightness-105 active:brightness-95",
  secondary: "border border-stone bg-paper-raised text-ink hover:border-ink-soft",
  ghost: "text-ink-soft hover:text-ink",
  destructive: "border border-danger text-danger hover:bg-danger-soft",
};

const sizes: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-[0.95rem]",
  sm: "px-3 py-1.5 text-sm",
  icon: "h-10 w-10 p-0",
};

/** Plain string builder (no "use client") so Server Components can style a plain `<a>` as a button. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md") {
  return `inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]}`;
}
