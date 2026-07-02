import { auth } from "@auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(req: NextRequest) {
  const { nextUrl } = req;
  const isApiAuth = nextUrl.pathname.startsWith("/api/auth");
  const isHealth = nextUrl.pathname === "/api/health";
  const isLoginPage = nextUrl.pathname === "/login";

  if (isApiAuth || isHealth) return NextResponse.next();

  const session = await auth();
  const isLoggedIn = !!session;

  if (isLoginPage && isLoggedIn) return NextResponse.redirect(new URL("/", req.url));
  if (!isLoggedIn && !isLoginPage) return NextResponse.redirect(new URL("/login", req.url));

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
