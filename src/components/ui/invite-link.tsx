import { DEMO_ONLY } from "@/demo/copy";
import { buttonClasses } from "./button-classes";

/** The default way to invite someone: a copyable link to /join/[code]. The raw code stays as a small fallback. */
export function InviteLink({ code }: { code: string }) {
  return (
    <div className="space-y-1.5 text-center">
      <button type="button" disabled title={DEMO_ONLY} className={`${buttonClasses("secondary", "sm")} w-full`}>
        Скопіювати запрошення
      </button>
      <p className="text-xs text-stone-600">
        або код: <span className="font-numeral font-semibold text-ink-soft">{code}</span>
      </p>
    </div>
  );
}
