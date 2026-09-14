import { redirect } from "next/navigation";

import { getUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";
import { InlineAlert } from "@/components/ui/inline-alert";
import { buttonClasses } from "@/components/ui/button-classes";
import { BasketIcon, PotIcon, SparkleIcon } from "@/components/ui/icons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getUser();
  if (user) redirect((await isSilpoConnected(user.id)) ? "/" : "/connect-silpo");
  const { error } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div className="flex justify-center gap-2 text-tomato">
          <BasketIcon className="h-8 w-8" />
          <PotIcon className="h-8 w-8 text-butter-ink" />
          <SparkleIcon className="h-8 w-8 text-plum" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Silpo Party</h1>
          <p className="text-sm text-ink-soft">
            Плануйте закупки, вечері та події разом із друзями — агент домовляється, а ви лише пишете, чого хочете.
          </p>
        </div>
        {error && <InlineAlert tone="error">Не вдалося увійти через Google. Спробуйте ще раз.</InlineAlert>}
        <a className={`${buttonClasses("primary", "md")} w-full`} href="/auth/google">
          Увійти через Google
        </a>
      </div>
    </main>
  );
}
