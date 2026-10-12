# Atelier AI — Website Studio

Independent **Next.js 15** MVP for premium AI-generated business sites and online storefront previews.

## Features
- Six premium-inspired original template directions.
- Multi-page site generation, business and storefront modes.
- Optional OpenAI text generation; keyless deterministic demo fallback.
- Optional niche research through allowlisted Apify Actor.
- Visual editor with desktop/mobile preview, section changes, local browser autosave and JSON export.
- Reference links to Behance, Awwwards, SiteInspire (inspiration only, no copying or resale).

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. You can use demo mode without credentials.

## Environment
- `OPENAI_API_KEY` — optional API key.
- `OPENAI_MODEL` — defaults to `gpt-4.1-mini`.
- `APIFY_TOKEN` — optional Apify personal token.
- `APIFY_ALLOWED_ACTORS` — allowlist, defaults to `apify~google-search-scraper`.

Store secrets only in Vercel Environment Variables or local `.env.local`; never commit them.

## Current limitations
This is a **personal/private-testing MVP** in terms of features, but the GitHub repository currently has **public visibility**. Do not expose confidential briefs. Authentication, production-grade per-user isolation, cloud project storage, site publishing, domain mapping, actual checkout/cart, managed inventory, and billing are not implemented. The Publish button is a placeholder. Product tiles are previews, not purchasable items. External photographs are illustrative.

Apify currently supports only a Google-search-actor-style response mapping. Production use requires per-niche adapters, queueing, budgets and data licensing review.

## Deploy
Import the GitHub repository into Vercel as a Next.js project. Root directory: `./`. Install: `npm install`. Build: `npm run build`. Add optional environment variables in Vercel Project Settings.

## Status
The files have been committed to GitHub. A production build has **not yet been verified**.
