"use client";

import { useState } from "react";

import { joinPath } from "@/lib/party/join-code";
import { buttonClasses } from "./button-classes";

/** The default way to invite someone: a copyable link to /join/[code]. The raw code stays as a small fallback. */
export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const path = joinPath(code);
    const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the code below still works as a fallback.
    }
  }

  return (
    <div className="space-y-1.5 text-center">
      <button type="button" onClick={copyLink} className={`${buttonClasses("secondary", "sm")} w-full`}>
        {copied ? "Посилання скопійовано" : "Скопіювати запрошення"}
      </button>
      <p className="text-xs text-stone-600">
        або код: <span className="font-numeral font-semibold text-ink-soft">{code}</span>
      </p>
    </div>
  );
}
