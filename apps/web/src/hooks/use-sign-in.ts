import { signIn } from 'next-auth/react'
import { useConnect, useSignMessage } from 'wagmi'
import { useSIWE } from 'wagmi/siwe'
import useAuthStore from '@/store/auth_store'
export const useSignIn = () => {
  const setConnected = useAuthStore((state) => state.setConnected)
  const { connectAsync } = useConnect()
  const { signMessageAsync } = useSignMessage()
  const { signIn: signInWithEthereum } = useSIWE()

  const handleWalletConnect = async (connector: any) => {
    try {
      const { accounts } = await connectAsync({ connector })
      if (accounts && accounts.length > 0) {
        setConnected(accounts[0])

        // Sign in with Ethereum after connecting wallet
        const isSuccess = await signInWithEthereum()

        if (isSuccess) {
          // If SIWE is successful, create a session with our backend
          await createBackendSession(accounts[0])
        }
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error)
    }
  }

  const createBackendSession = async (address: string) => {
    try {
      // Get a nonce from the server
      const nonceResponse = await fetch('/api/nonce')
      if (!nonceResponse.ok) throw new Error('Failed to get nonce')
      const nonce = await nonceResponse.text()

      // Create the message to sign
      const message = `Welcome to DEX!
Please sign this message to confirm your ownership of the address.
This request will not trigger a blockchain transaction or cost any gas fees.
Wallet address:${address}
Nonce:${nonce}`

      // Sign the message
      const signature = await signMessageAsync({ message })

      // Verify the signature with our backend
      const verifyResponse = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      })

      if (!verifyResponse.ok) throw new Error('Verification failed')

      // Create a NextAuth session
      await signIn('credentials', {
        address,
        signature,
        redirect: false,
      })

    } catch (error) {
      console.error('Failed to create backend session:', error)
    }
  }

  const signInWithGoogle = () => {
    signIn('google', { callbackUrl: '/' })
  }

  const signInWithEmail = (email: string, password: string) => {
    signIn('credentials', { email, password, callbackUrl: '/' })
  }

  return {
    handleWalletConnect,
    signInWithGoogle,
    signInWithEmail
  }
}