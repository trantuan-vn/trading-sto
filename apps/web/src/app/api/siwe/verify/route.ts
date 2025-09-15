import { randomUUID } from 'crypto';

import { NextRequest, NextResponse } from 'next/server';

import CryptoJS from 'crypto-js';
import { SiweMessage } from 'siwe';
import { mnemonicToAccount, generateMnemonic, english } from 'viem/accounts';

import { auth } from '@/app/auth';

async function getNonce(session: any, env: Env): Promise<string | null> {
  if (session?.user) {
    const userResult = await env.unitoken_db
      .prepare('SELECT nonce, ethereum_address FROM users WHERE id = ?')
      .bind(session.user.id)
      .first();
    return userResult ? userResult.nonce !== null ? JSON.parse(userResult.nonce as string) : null : null;
  } else {
    const tempNonceResult = await env.unitoken_db
      .prepare('SELECT value FROM wagmi_storage WHERE key = ?')
      .bind('siwe_nonce')
      .first();
    return tempNonceResult?.value ? JSON.parse(tempNonceResult.value as string) : null;
  }
}

async function verifySiweMessage(message: string, signature: string, nonce: string) {
  const siweMessage = new SiweMessage(message);
  const { data: fields } = await siweMessage.verify({ signature });
  if (fields.nonce !== nonce) {
    throw new Error('Invalid nonce');
  }
  return fields;
}

async function findOrCreateUser(env: Env, address: string) {
  let userResult = await env.unitoken_db
    .prepare('SELECT id, ethereum_address FROM users WHERE ethereum_address = ?')
    .bind(address.toLowerCase())
    .first();

  if (!userResult) {
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

    const newUserId = randomUUID();

    await env.unitoken_db
      .prepare('INSERT INTO users (id, email, ethereum_address, ethereum_private_key, mnemonic_phrase) VALUES (?, ?, ?, ?, ?)')
      .bind(newUserId, `${address}@siwe.local`, address, encryptedPrivateKey, encryptedMnemonic)
      .run();

    userResult = { id: newUserId, ethereum_address: address };
  }

  return userResult;
}

async function cleanupNonce(env: Env, session: any) {
  if (session?.user) {
    await env.unitoken_db
      .prepare('UPDATE users SET nonce = NULL WHERE id = ?')
      .bind(session.user.id)
      .run();
  } else {
    await env.unitoken_db
      .prepare('DELETE FROM wagmi_storage WHERE key = ?')
      .bind('siwe_nonce')
      .run();
  }
}

export async function POST(request: NextRequest, env: Env) {
  try {
    const body = await request.json();
    const { message, signature } = body as { message: string; signature: string } ?? {};
    const session = await auth();

    // Get nonce
    const nonce = await getNonce(session, env);
    if (!nonce) {
      return NextResponse.json({ error: 'Nonce not found' }, { status: 400 });
    }

    // Verify SIWE message
    const fields = await verifySiweMessage(message, signature, nonce);

    // Find or create user
    const userResult = await findOrCreateUser(env, fields.address);

    // Cleanup nonce
    await cleanupNonce(env, session);

    return NextResponse.json({ success: true, userId: userResult.id });

  } catch (error) {
    console.error('SIWE verification error:', error);

    if (error instanceof Error) {
      if (error.message === 'Invalid nonce') {
        return NextResponse.json({ error: 'Invalid nonce' }, { status: 400 });
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}