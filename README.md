# TradingSTO

Web3 trading platform with TypeScript frontend (Next.js in apps/web) and Rust backend (Axum in apps/backend), managed by Turborepo with pnpm.

## Setup
1. Install dependencies:
   - Root: `pnpm install`
   - Backend: `cd apps/backend && cargo build`

## Run locally
- Run all apps (web + backend):  
  `pnpm run dev`

- Run only web (Next.js):  
  `pnpm turbo run dev --filter=web`

- Run only backend (Rust):  
  `pnpm turbo run dev --filter=backend`

## Access
- Web: http://localhost:3000
- Backend (Axum): http://localhost:3001 (if you set it to run on 3001)
