<!-- SUMMONIQ-OSS-HEADER:START -->
<div align="center">

  <h1>Domain Jane</h1>
  <p>Desktop app for domain availability checks, favorites, RDAP lookups, and expiration tracking.</p>

  <p>
    <a href="https://github.com/SummonIQ/domain-jane"><img alt="Repository" src="https://img.shields.io/badge/github-SummonIQ%2Fdomain--jane-24292f?logo=github"></a>
    <a href="https://unlicense.org/"><img alt="License: Unlicense" src="https://img.shields.io/badge/license-Unlicense-blue.svg"></a>
  </p>

</div>

---
<!-- SUMMONIQ-OSS-HEADER:END -->

# Domain Jane

Domain Jane is a minimal Electron desktop app for:

- searching domain names across common TLDs
- saving domains to a local favorites list
- sorting favorites by expiration or estimated drop date so you can watch likely availability windows

## Run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm start
   ```

## How it works

- Search by keyword like `orbit` to check `orbit.com`, `orbit.net`, `orbit.org`, `orbit.io`, `orbit.co`, `orbit.ai`, `orbit.app`, and `orbit.dev`.
- Search by full domain like `orbit.com` to inspect only that exact name.
- Availability and expiration data are fetched from public RDAP endpoints via `https://rdap.org/domain/<domain>`.
- Favorites are stored locally in Electron's `userData` directory as `favorites.json`.

## Important limitation

The countdown is an estimate, not a guaranteed drop-catch timestamp. Many registries allow grace and redemption periods after expiration, and those policies vary. The app currently assumes a common 75-day post-expiration lifecycle when it can find an expiration date.
