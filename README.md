# Trawl

Zero-cloud email intelligence for Chrome. Extract, validate, and discover email addresses from any web page — no accounts, no subscriptions, no Hunter/Apollo/Snov.io required.

## What It Does

- **Extract** emails from any page via popup, context menu, or keyboard shortcut
- **Validate** with MX record checks, disposable domain detection, and confidence scoring
- **Discover** contacts by guessing patterns, generating role addresses, or scraping GitHub commits
- **Export** to CSV, JSON, vCard, or clipboard — one-click from popup or dashboard
- **Auto-scan** pages as you browse with allowlist/blocklist filtering
- **Zero cloud** — all data stays in your browser's local storage, nothing leaves your machine

## Install

### Chrome Web Store

_Coming soon_

### Manual

```sh
git clone https://github.com/meysam81/trawl.git
cd trawl
bun install
bun run build
```

Then open `chrome://extensions`, enable Developer mode, and load the `dist/` directory.

## Privacy

No accounts. No telemetry. No cloud. All data is stored locally in `chrome.storage.local` and never transmitted anywhere except the domains you explicitly query (DNS over Cloudflare/Google for MX lookups, GitHub API for commit emails, RDAP for WHOIS). Licensed under MIT.

## Development

```sh
bun install         # install dependencies
bun run start       # dev server with HMR
bun run build       # production build to dist/
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint
bun run deadcode    # knip — unused exports/deps

# Use Google DNS primary instead of Cloudflare (default)
VITE_DNS_PRIMARY=google bun run build
```

## License

MIT
