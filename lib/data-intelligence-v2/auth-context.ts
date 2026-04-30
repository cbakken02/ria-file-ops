import type { DataIntelligenceV2Config } from "@/lib/data-intelligence-v2/config";
import type { DataIntelligenceV2AuthContext } from "@/lib/data-intelligence-v2/types";

type SupportedRole = NonNullable<DataIntelligenceV2AuthContext["role"]>;

const SUPPORTED_ROLES = new Set<SupportedRole>([
  "admin",
  "advisor",
  "csa",
  "ops",
  "readonly",
]);

export type V2SessionLike = {
  user?: {
    email?: string | null;
    id?: string | null;
    role?: string | null;
  } | null;
} | null;

export function buildDataIntelligenceV2AuthContext(args: {
  session: V2SessionLike;
  config: DataIntelligenceV2Config;
}): DataIntelligenceV2AuthContext | null {
  const userEmail = args.session?.user?.email?.trim();
  if (!userEmail) {
    return null;
  }

  const role = readSupportedRole(args.session?.user?.role) ?? "csa";

  // MVP authorization is scoped to the authenticated user's ownerEmail because
  // the existing Data Intelligence records are ownerEmail-scoped. Replace this
  // with firm/client permission checks before broad production rollout.
  return {
    userEmail,
    ownerEmail: userEmail,
    ...(args.session?.user?.id ? { userId: args.session.user.id } : {}),
    role,
    allowedOwnerEmails: [userEmail],
    allowSensitiveReveal: args.config.allowSensitiveRevealForAuthenticatedUsers,
  };
}

export function requireDataIntelligenceV2AuthContext(args: {
  session: V2SessionLike;
  config: DataIntelligenceV2Config;
}): DataIntelligenceV2AuthContext {
  const authContext = buildDataIntelligenceV2AuthContext(args);
  if (!authContext) {
    throw new Error("Authenticated Data Intelligence V2 session required.");
  }
  return authContext;
}

function readSupportedRole(value: string | null | undefined) {
  return value && SUPPORTED_ROLES.has(value as SupportedRole)
    ? (value as SupportedRole)
    : undefined;
}
