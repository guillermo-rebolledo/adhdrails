import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Geist } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";

import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Rails",
  description: "Calm focus for the work that matters now.",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={cn("font-sans", geist.variable)}
      suppressHydrationWarning
    >
      <body>
        <SerwistProvider
          cacheOnNavigation={false}
          reloadOnOnline={false}
          swUrl="/serwist/sw.js"
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            disableTransitionOnChange
            enableSystem
            nonce={nonce}
          >
            <AnalyticsProvider nonce={nonce}>
              <TooltipProvider delay={600} closeDelay={0} timeout={300}>
                {children}
              </TooltipProvider>
            </AnalyticsProvider>
          </ThemeProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
