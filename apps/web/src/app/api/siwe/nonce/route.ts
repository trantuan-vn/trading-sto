import { randomBytes } from 'crypto';

import { NextResponse } from 'next/server';

import { auth } from '@/app/auth';

export async function GET(env: Env) {
  const session = await auth();
  const nonce = randomBytes(32).toString('hex');

  if (session?.user) {
    await env.unitoken_db
      .prepare('UPDATE users SET nonce = ? WHERE id = ?')
      .bind(nonce, session.user.id)
      .run();
  } else {
    await env.unitoken_db
      .prepare('INSERT OR REPLACE INTO wagmi_storage (key, value) VALUES (?, ?)')
      .bind('siwe_nonce', nonce)
      .run();
  }

  return NextResponse.json({ nonce });
}