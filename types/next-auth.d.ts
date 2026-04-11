import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
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
    accessToken?: string;
    expiresAt?: number;
    error?: string;
    grantedScopes?: string[];
    refreshToken?: string;
  }
}
