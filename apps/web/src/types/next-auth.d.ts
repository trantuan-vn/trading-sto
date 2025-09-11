import NextAuth from "next-auth"

declare module "next-auth" {
  interface Session {
    address?: string
  }

  interface User {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    address?: string
  }
}