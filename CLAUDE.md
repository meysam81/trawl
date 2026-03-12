# Trawl — Chrome Extension

## Stack

- TypeScript (strict, no `any`), Vite 7, @crxjs/vite-plugin, Zod 4, loglevel
- Chrome Extension Manifest V3
- bun as package manager

## Architecture

- `src/lib/schemas.ts` — single source of truth for all data shapes (Zod)
- `src/lib/storage.ts` — chrome.storage.local CRUD, validates on read/write
- `src/lib/extract.ts` — email extraction engine
- `src/lib/intelligence.ts` — MX validation, disposable detection, confidence scoring
- `src/lib/discovery.ts` — pattern guessing, role addresses, GitHub API
- `src/lib/export.ts` — CSV, JSON, vCard export
- `src/lib/logger.ts` — loglevel wrapper
- `src/popup/` — extension popup UI
- `src/dashboard/` — full-tab dashboard
- `src/background/service-worker.ts` — badge, context menu
- `src/content/extractor.ts` — content script for page extraction

## Commands

- `bun run build` — production build to dist/
- `bun run start` — dev server with HMR
- `bun run typecheck` — tsc --noEmit
- `bun run lint` — oxlint

## Validation Policy

- Validate on EVERY storage read/write
- Validate extracted emails before returning
- On failure: log.warn + skip, never crash
