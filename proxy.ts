import { NextResponse, type NextRequest } from "next/server";
import {
  CANONICAL_PRODUCTION_HOST,
  normalizeRequestHost,
  shouldRedirectToCanonicalProductionHost,
} from "@/lib/vercel-canonical-host";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = normalizeRequestHost(forwardedHost ?? request.headers.get("host"));

  if (
    shouldRedirectToCanonicalProductionHost({
      host,
      vercelEnv: process.env.VERCEL_ENV,
    })
  ) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.hostname = CANONICAL_PRODUCTION_HOST;
    url.port = "";

    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
