"use client";

import type { ReactNode } from "react";
import WalletProviders from "../components/WalletProviders";

export default function Providers({ children }: { children: ReactNode }) {
  return <WalletProviders>{children}</WalletProviders>;
}

