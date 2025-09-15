// types/next-auth.d.ts
import NextAuth from "next-auth";

declare module "next-auth" {
  interface User {
    id: string;
    ethereum_address?: string;
  }

  interface Session {
    user: {
      id: string;
      email?: string | null;
      ethereum_address?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    ethereum_address?: string;
  }
}