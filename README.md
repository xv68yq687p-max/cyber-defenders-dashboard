# Cyber Defenders Dashboard (Cloudflare Worker)

En enkel løsning for et cybersikkerhets-dashboard som:
- Henter siste 24t fra utvalgte kilder (RSS + valgfri NewsAPI/Bing).
- Lagrer aggregerte funn i Cloudflare KV.
- Kjører hvert 15. min på cron.
- Eksponerer `/api/*` for frontend.
- Server **index.html** direkte fra Workeren på `/` (ingen Pages nødvendig).

## Mappestruktur

```
cyber-defenders-dashboard/
├─ wrangler.toml
├─ package.json
├─ tsconfig.json
├─ README.md
├─ public/
│  └─ index.html
└─ src/
   └─ worker.ts
```

> Merk: `worker.ts` inneholder en innebygd kopi av `public/index.html`, så du kan deploye kun Workeren.

## Kom i gang

1) Installer avhengigheter
```bash
npm install
```

2) Opprett KV namespaces (kopiér ID-ene inn i `wrangler.toml`)
```bash
npx wrangler kv namespace create DASHBOARD_CACHE
npx wrangler kv namespace create STATE
```

3) (Valgfritt) Legg inn hemmeligheter (for manuell refresh og/eller nyhetstjenester)
```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put NEWSAPI_KEY
npx wrangler secret put BING_KEY
```

4) Start lokalt
```bash
npm run dev
```

5) Deploy
```bash
npm run deploy
```

## Endepunkter

- `GET /` – Dashboard UI (serveres fra Workeren).
- `GET /api/health` – Siste oppdateringstidspunkt.
- `GET /api/items?category=<key>` – Data per kategori.
- `GET /api/report` – Generert kort morgenrapport.
- `POST /api/refresh` – Tving oppdatering (legg `x-admin-token: <ADMIN_TOKEN>` om satt).

## Konfigurasjon / kilder

Se `src/worker.ts` for RSS-lister. Bytt ut/utvid med korrekte RSS-adresser (NSM/NCSC, Forsvaret m.fl.).
Sett `USE_NEWS_API="true"` og legg inn `NEWSAPI_KEY` hvis du vil bruke NewsAPI for bredde-søk.

## Personvern og drift

- Vi lagrer tittel/URL/kilde/tid – ingen persondata.
- KV TTL ~48t. Cron hvert 15. min.
- Feil i enkelt-feeds påvirker ikke resten.

Lykke til!
