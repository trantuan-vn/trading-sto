import { D1Adapter } from '@auth/d1-adapter';
import { getCloudflareContext } from "@opennextjs/cloudflare";
import CryptoJS from 'crypto-js';
import NextAuth from "next-auth";
import AppleProvider from "next-auth/providers/apple";
import GoogleProvider from "next-auth/providers/google";
import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts';

const env=(await getCloudflareContext() as any).env;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: D1Adapter(env.unitoken_db),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
    AppleProvider({
      clientId: process.env.APPLE_CLIENT_ID ?? '',
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
    }),
    // Thêm provider credentials để hỗ trợ SIWE
    {
      id: 'credentials',
      name: 'Credentials',
      type: 'credentials',
      credentials: {
        userId: { label: 'User ID', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.userId) return null;
        const user = await env.unitoken_db
          .prepare('SELECT id, email, ethereum_address FROM users WHERE id = ?')
          .bind(credentials.userId)
          .first();
        if (!user) return null;
        return { id: user.id, email: user.email, ethereum_address: user.ethereum_address };
      },
    },
  ],
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: 'database',
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'credentials' && user && !user.ethereum_address) {
        // Tạo mnemonic và account từ đó
        const mnemonic = generateMnemonic(english, 256); // 24 words is the default length for a mnemonic phrase
        const account = mnemonicToAccount(mnemonic);
        const address = account.address;

        // Mã hóa cả private key và mnemonic (nếu muốn)
        const encryptedPrivateKey = CryptoJS.AES.encrypt(
          account.getHdKey().privateExtendedKey,
          process.env.ENCRYPT_SECRET ?? 'fallback-secret'
        ).toString();

        const encryptedMnemonic = CryptoJS.AES.encrypt(
          mnemonic,
          process.env.ENCRYPT_SECRET ?? 'fallback-secret'
        ).toString();

        await env.unitoken_db
          .prepare("UPDATE users SET ethereum_address = ?, ethereum_private_key = ?, mnemonic_phrase = ? WHERE id = ?")
          .bind(address, encryptedPrivateKey, encryptedMnemonic, user.id)
          .run();
        user.ethereum_address = address;
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.ethereum_address = user.ethereum_address;
      }
      return session;
    },
  },
});