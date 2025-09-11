import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { getAddress } from "viem"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "Ethereum",
      credentials: {
        address: { label: "Address", type: "text" },
        signature: { label: "Signature", type: "text" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.address || !credentials?.signature) {
            return null
          }

          // In a real implementation, you would verify the signature here
          // For this example, we'll just return the user

          return {
            id: getAddress(credentials.address),
            name: "Ethereum User",
            email: null,
            image: null,
          }
        } catch (error) {
          console.error("Auth error:", error)
          return null
        }
      }
    }),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // Add your own authentication logic here
        if (credentials?.email === "user@example.com" && credentials?.password === "password") {
          return { id: "1", name: "User", email: "user@example.com" }
        }
        return null
      }
    })
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        if (user.id.startsWith('0x')) {
          token.address = user.id
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token.address) {
        session.address = token.address
      }
      return session
    },
  },
})