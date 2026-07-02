import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { auth } from "@auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { KeyHealthBanner } from "@/components/layout/KeyHealthBanner";
import { RouteProgress } from "@/components/layout/RouteProgress";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const poppins = Poppins({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GenAI Scout — AI Writer Discovery",
  description: "Discover and profile writers, bloggers, and publishers who cover generative AI tools.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <html lang="en" className={poppins.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <SessionProvider session={session}>
            {session?.user && <RouteProgress />}
            <div className="min-h-screen flex bg-background text-foreground">
              {session?.user && <Sidebar />}
              <div className="flex-1 flex flex-col min-w-0">
                {session?.user && <TopNav />}
                {session?.user && <KeyHealthBanner />}
                <main className="flex-1">
                  <div className="container mx-auto p-6 max-w-7xl">
                    {children}
                  </div>
                </main>
              </div>
            </div>
            <Toaster position="bottom-right" />
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
