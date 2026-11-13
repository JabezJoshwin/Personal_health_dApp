import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";

const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";

// NEXT_PUBLIC_SOLANA_RPC_URL overrides the cluster endpoint, e.g.
// http://127.0.0.1:8899 for a local solana-test-validator.
const endpoint =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  (network === "mainnet-beta" ? clusterApiUrl("mainnet-beta") : clusterApiUrl("devnet"));

export default function WalletProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
