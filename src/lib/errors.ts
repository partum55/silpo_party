/** Turns thrown values (including Supabase/PostgREST plain objects) into useful UI-safe text. */
export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const details = ["message", "details", "hint", "code"]
      .map((key) => [key, record[key]] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
      .map(([key, value]) => key === "message" ? value : `${key}: ${value}`);
    if (details.length) return details.join(" | ");

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Fall through to the generic message for circular or otherwise unserializable values.
    }
  }

  return "An unknown error occurred.";
}
