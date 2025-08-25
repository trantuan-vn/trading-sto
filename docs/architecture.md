# TradingSTO Architecture

Monorepo managed by Turborepo (pnpm) with TypeScript frontend (Next.js in apps/web) and Rust backend (Axum in apps/backend).
- Frontend: App Router, Web3 (Wagmi), i18n (next-intl).
- Backend: Rust APIs, smart sessions (ERC-4337).
- Deployment: Docker, K8s with auto-scaling.
