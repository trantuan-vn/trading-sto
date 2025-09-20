import { walletConnect, injected } from '@wagmi/connectors';
import { createConfig, http, cookieStorage, createStorage } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

export const config = createConfig({
  chains: [mainnet, sepolia],
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
  connectors: [
    walletConnect({
      projectId: process.env.WALLETCONNECT_PROJECT_ID ?? '',
      metadata: {
        name: 'Your App Name',
        description: 'Your app description',
        url: 'https://your-app-url.com',
        icons: ['https://your-app-url.com/icon.png'],
      },
    }),
    injected({ target: 'metaMask' }),
  ],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});
