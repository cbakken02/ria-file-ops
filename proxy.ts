import { NextResponse, type NextRequest } from "next/server";

const CANONICAL_PRODUCTION_HOST = "ria-file-ops.vercel.app";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost ?? request.headers.get("host") ?? "")
    .toLowerCase()
    .split(":")[0];

  if (
    process.env.NODE_ENV === "production" &&
    host.endsWith(".vercel.app") &&
    host !== CANONICAL_PRODUCTION_HOST
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
