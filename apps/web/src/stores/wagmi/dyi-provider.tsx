'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionProvider } from "next-auth/react"
import { WagmiProvider } from 'wagmi'
import { SIWEProvider } from 'wagmi/siwe'

import { siweConfig } from '../../config/siwe-config'
import { config } from '../../config/wagmi/dyi-config'

const queryClient = new QueryClient()

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <SIWEProvider {...siweConfig}>
            {children}
          </SIWEProvider>
        </SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
