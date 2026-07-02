"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const email = params.get("email");

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-violet-600 mb-2">
            <Search className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">GenAI Scout</h1>
          <p className="text-sm text-muted-foreground">Writer discovery engine for generative AI outreach</p>
        </div>

        <Card>
          <CardHeader className="text-center pb-4">
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use your <strong className="text-violet-500">@imagine.art</strong> Google account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error === "domain" ? (
                  <>
                    Access restricted to <strong>@imagine.art</strong> accounts.
                    {email && <span className="block mt-1 text-xs opacity-75">{email} is not allowed.</span>}
                  </>
                ) : (
                  "Sign-in failed. Please try again."
                )}
              </div>
            )}

            <Button
              onClick={() => signIn("google", { callbackUrl: "/" })}
              className="w-full gap-2"
              size="lg"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" fillOpacity={0.6} d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" fillOpacity={0.8} d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" fillOpacity={0.9} d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Internal tool — imagine.art accounts only
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <LoginContent />
    </Suspense>
  );
}
