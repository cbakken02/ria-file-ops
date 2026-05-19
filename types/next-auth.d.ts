import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    appSessionCreatedAt?: string;
    appSessionIdHash?: string;
    user: DefaultSession["user"] & {
      id?: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    appSessionCreatedAt?: number;
    appSessionId?: string;
  }
}
