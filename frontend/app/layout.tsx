import type { ReactNode } from "react";
import "@solana/wallet-adapter-react-ui/styles.css";
import "../styles/globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Personal Health Record (demo)",
  description: "Solana + IPFS health record demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

