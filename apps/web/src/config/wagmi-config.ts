import { getCloudflareContext } from "@opennextjs/cloudflare";
import { walletConnect, injected } from '@wagmi/connectors';
import { createConfig, http, createStorage } from 'wagmi';
import { mainnet, sepolia } from 'wagmi/chains';

import { D1Storage } from '../stores/wagmi/d1-storage';

const env=(await getCloudflareContext() as any).env;

const d1Storage = new D1Storage({
  database: env.unitoken_db,
});

export const config = createConfig({
  chains: [mainnet, sepolia],
  ssr: true,
  storage: createStorage({
    storage: d1Storage,
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
