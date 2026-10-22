import type { ReactNode } from "react";

import { ProfileMenu } from "@/components/profile-menu";

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ProfileMenu name="Назар" email="demo@silpoparty.app" connected />
      {children}
    </>
  );
}
