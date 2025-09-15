'use client';

import { useState } from 'react';

import { walletConnect } from '@wagmi/connectors';
import { useSession, signIn, signOut } from 'next-auth/react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';

// Define types for API responses
interface NonceResponse {
  nonce: string;
}

interface VerifyResponse {
  userId: string;
}

export default function AuthAccount() {
  const { data: session, status } = useSession();
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const [signing, setSigning] = useState(false);

  const signInWithEthereum = async () => {
    if (!isConnected || !address) {
      try {
        // Create the connector instance and pass it to connect()
        const connector = walletConnect({
          projectId: process.env.WALLETCONNECT_PROJECT_ID!,
        });
        await connect({ connector });
      } catch (error) {
        console.error('Failed to connect wallet:', error);
        alert('Please connect your wallet first');
        return;
      }
    }

    setSigning(true);
    try {
      const resNonce = await fetch('/api/siwe/nonce');
      const nonceData: NonceResponse = await resNonce.json();
      const { nonce } = nonceData;

      const message = {
        domain: window.location.host,
        address,
        statement: 'Sign in with Ethereum to the app.',
        uri: window.location.origin,
        version: '1',
        chainId: 1,
        nonce,
      };

      const siweMessage = `${message.domain} wants you to sign in with your Ethereum account:\n${message.address}\n\n${message.statement}\n\nURI: ${message.uri}\nVersion: ${message.version}\nChain ID: ${message.chainId}\nNonce: ${message.nonce}\nIssued At: ${new Date().toISOString()}`;

      const signature = await signMessageAsync({ message: siweMessage });

      const resVerify = await fetch('/api/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: siweMessage, signature }),
      });

      if (resVerify.ok) {
        const verifyData: VerifyResponse = await resVerify.json();
        const { userId } = verifyData;
        await signIn('credentials', { redirect: false, userId });
        alert('Signed in with Ethereum!');
      } else {
        alert('Verification failed');
      }
    } catch (error) {
      console.error(error);
      alert('Error signing in with Ethereum');
    }
    setSigning(false);
  };

  if (status === 'loading') return <p>Loading...</p>;

  return (
    <div>
      {session ? (
        <>
          <p>Signed in as {session.user?.email ?? session.user?.ethereum_address}</p>
          <p>Ethereum Address: {session.user?.ethereum_address ?? 'Not generated'}</p>
          <button onClick={() => signOut()}>Sign out</button>
        </>
      ) : (
        <>
          <p>Not signed in</p>
          <button onClick={() => signIn('google')}>Sign in with Google</button>
          <button onClick={() => signIn('apple')}>Sign in with Apple</button>
          <button onClick={signInWithEthereum} disabled={signing}>
            {signing ? 'Signing...' : 'Sign in with Wallet'}
          </button>
        </>
      )}
    </div>
  );
}