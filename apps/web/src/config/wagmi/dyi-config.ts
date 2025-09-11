// config/wagmi.ts
import { createConfig, http, cookieStorage, createStorage } from 'wagmi'
import { mainnet, polygon, arbitrum } from 'wagmi/chains'
import { metaMask, walletConnect, injected } from 'wagmi/connectors'

import { siweConfig } from '../siwe-config'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ''

export const config = createConfig({
  chains: [mainnet, polygon, arbitrum],
  connectors: [
    metaMask(),
    walletConnect({ projectId }),
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
  },
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof config,
    siweConfig: typeof siweConfig,
  }
}
