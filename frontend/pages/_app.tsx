import type { AppProps } from "next/app";
import dynamic from "next/dynamic";
import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";

const WalletProviders = dynamic(
  () => import("../components/WalletProviders"),
  { ssr: false }
);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProviders>
      <Component {...pageProps} />
    </WalletProviders>
  );
}
