import NextAuth from "next-auth";
import { authOptions } from "@/auth";
import {
  authRateLimitResponse,
  checkNextAuthRateLimit,
} from "@/lib/auth-rate-limit";

const handler = NextAuth(authOptions);

type NextAuthRouteContext = {
  params: Promise<{
    nextauth?: string[];
  }>;
};

async function handleAuth(
  request: Request,
  context: NextAuthRouteContext,
) {
  const { nextauth = [] } = await context.params;
  const rateLimit = checkNextAuthRateLimit(request, nextauth);

  if (rateLimit && !rateLimit.allowed) {
    return authRateLimitResponse(rateLimit);
  }

  return handler(request, context);
}

export { handleAuth as GET, handleAuth as POST };
