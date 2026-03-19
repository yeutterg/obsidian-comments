import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  if (!req.auth && req.nextUrl.pathname.startsWith("/admin")) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
