'use client';

import { ReactNode } from 'react';

import { headers } from 'next/headers';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { WagmiProvider, cookieToInitialState } from 'wagmi';

import { config } from '../../config/wagmi-config';

const queryClient = new QueryClient();

export async function AuthProvider({ children }: { children: ReactNode }) {
  const initialState = cookieToInitialState(config, (await headers()).get('cookie'));

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>{children}</SessionProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}