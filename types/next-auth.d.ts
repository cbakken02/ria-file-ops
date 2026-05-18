import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    appSessionCreatedAt?: string;
    appSessionIdHash?: string;
    accessToken?: string;
    authError?: string;
    driveConnected: boolean;
    driveWritable: boolean;
    grantedScopes: string[];
    user: DefaultSession["user"] & {
      id?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appSessionCreatedAt?: number;
    appSessionId?: string;
    accessToken?: string;
    expiresAt?: number;
    error?: string;
    grantedScopes?: string[];
    refreshToken?: string;
  }
}
