import type { ReactNode } from "react";

import { ProfileMenu } from "@/components/profile-menu";
import { requireUser } from "@/lib/auth";
import { isSilpoConnected } from "@/lib/silpo/connection";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const connected = await isSilpoConnected(user.id);
  return (
    <>
      <ProfileMenu user={user} connected={connected} />
      {children}
    </>
  );
}
