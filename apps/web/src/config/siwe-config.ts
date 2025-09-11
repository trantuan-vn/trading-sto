// config/siwe.ts
import { SiweMessage } from 'siwe'

export interface SIWESession {
  address: string
  chainId: number
}

export const siweConfig = {
  getNonce: async () => {
    const response = await fetch('/api/nonce')
    if (!response.ok) throw new Error('Failed to fetch nonce')
    return response.text()
  },

  createMessage: ({ nonce, address, chainId }: { nonce: string; address: string; chainId: number }) => {
    const msg = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Welcome to DEX! Please sign this message to confirm your ownership.',
      uri: window.location.origin,
      version: '1',
      chainId,
      nonce,
    })
    return msg.prepareMessage()
  },

  verifyMessage: async ({ message, signature }: { message: string; signature: string }) => {
    const response = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    })
    return response.ok
  },

  getSession: async (): Promise<SIWESession | null> => {
    const response = await fetch('/api/session')
    if (!response.ok) return null
    return response.json()
  },

  signOut: async () => {
    await fetch('/api/logout', { method: 'POST' })
  },
}
