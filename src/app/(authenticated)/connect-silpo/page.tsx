import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";
import { InlineAlert } from "@/components/ui/inline-alert";
import { buttonClasses } from "@/components/ui/button-classes";
import { BasketIcon } from "@/components/ui/icons";

export default async function ConnectSilpoPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  if (await isSilpoConnected(user.id)) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-xs space-y-5 text-center">
        <BasketIcon className="mx-auto h-9 w-9 text-tomato" />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Підключіть Silpo</h1>
          <p className="text-sm text-ink-soft">
            Це потрібно, щоб агент міг шукати товари й оформити спільний кошик на Silpo, коли вечірка буде готова.
          </p>
        </div>
        {error && <InlineAlert tone="error">Не вдалося підключити Silpo. Спробуйте ще раз.</InlineAlert>}
        <form action="/auth/silpo/start" method="post">
          <button className={`${buttonClasses("primary", "md")} w-full`} type="submit">
            Підключити Silpo
          </button>
        </form>
      </div>
    </main>
  );
}
