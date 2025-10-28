import { XMLParser } from 'fast-xml-parser';

type Env = {
  DASHBOARD_CACHE: KVNamespace;
  RAW_CACHE: KVNamespace;
  STATE: KVNamespace;
  ADMIN_TOKEN?: string;
  USE_NEWS_API?: string;
  NEWSAPI_KEY?: string;
  BING_KEY?: string;
};

type Item = {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  category: string;
  description?: string;
};

type RawItem = Item & { score?: number };

const CATEGORIES = [
  "global",
  "norway",
  "reports",
  "social_cyberforsvaret",
  "milno_mentions",
  "media_cyberforsvaret",
  "mil_ops_analysis",
  "russian_threats"
] as const;

const RSS_SOURCES: Record<typeof CATEGORIES[number], string[]> = {
  global: [
    "https://www.cisa.gov/news.xml",
    "https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml",
    "https://www.enisa.europa.eu/news/enisa-news/RSS",
    "https://www.cert.europa.eu/rss.xml",
    "https://www.bleepingcomputer.com/feed/",
    "https://www.theregister.com/security/headlines.atom",
    "https://krebsonsecurity.com/feed/",
    "https://feeds.feedburner.com/TheHackersNews",
    "https://darkreading.com/rss.xml"
  ],
  norway: [
    "https://www.regjeringen.no/no/aktuelt/nyheter.rss",
    "https://www.politiet.no/aktuelt-tall-og-fakta/aktuelt/rss/",
    "https://www.digi.no/rss",
    "https://www.tu.no/rss",
    "https://www.nrk.no/toppsaker.rss",
    "https://nsm.no/rss/",
    "https://www.pst.no/alle-artikler/rss/"
  ],
  reports: [
    "https://www.enisa.europa.eu/publications/RSS",
    "https://www.mandiant.com/resources/blog/rss.xml",
    "https://www.microsoft.com/en-us/security/blog/feed/",
    "https://www.crowdstrike.com/blog/feed/",
    "https://www.verizon.com/business/resources/rss.xml",
    "https://blog.talosintelligence.com/feeds/posts/default?alt=rss",
    "https://www.recordedfuture.com/category/geopolitical/feed/"
  ],
  social_cyberforsvaret: [
    "https://www.forsvaret.no/aktuelt/_layouts/15/listfeed.aspx?List=%7BListId%7D"
  ],
  milno_mentions: [
    "https://news.google.com/rss/search?q=mil.no"
  ],
  media_cyberforsvaret: [
    "https://news.google.com/rss/search?q=Cyberforsvaret+OR+%22Norwegian%20Armed%20Forces%20Cyber%20Defence%22"
  ],
  mil_ops_analysis: [
    "https://ccdcoe.org/feed/",
    "https://www.rand.org/pubs/rss.xml",
    "https://rusi.org/explore-our-research/publications/feed",
    "https://www.csis.org/rss.xml",
    "https://www.atlanticcouncil.org/feed/",
    "https://carnegieendowment.org/rss/solr?keywords=cyber%20operations",
    "https://ccdcoe.org/feed/category/news/"
  ],
  russian_threats: [
    "https://securelist.com/rss-feeds/",
    "https://thehackernews.com/feeds/posts/default",
    "https://www.csis.org/rss.xml",
    "https://threatpost.com/feed/",
    "https://www.welivesecurity.com/feed/",
    "https://news.google.com/rss/search?q=%22russian+cyber%22+OR+%22russia+attributed%22+OR+APT28+OR+Sandworm+OR+%22Cozy+Bear%22+when%3A1d&hl=en-US&gl=US&ceid=US%3Aen"
  ]
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });

function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16);
}
function toISO(d: Date | string | number) { return new Date(d).toISOString(); }
function within24h(iso: string) { return (Date.now() - new Date(iso).getTime()) <= 24*3600*1000; }

async function fetchRSS(url: string): Promise<Item[]> {
  const resp = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  const txt = await resp.text();
  const obj = parser.parse(txt);
  const items: Item[] = [];
  const feedItems = obj?.rss?.channel?.item || obj?.feed?.entry || [];
  for (const it of (Array.isArray(feedItems) ? feedItems : [feedItems])) {
    const title = it.title?.["#text"] || it.title || "(uten tittel)";
    const link = it.link?.href || it.link || it.guid || it.id;
    const date = it.pubDate || it.updated || it.published || it["dc:date"] || new Date().toISOString();
    const description = it.description?.["#text"] || it.summary || it.content?.["#text"] || "";
    const urlStr = typeof link === "string" ? link : String(link);
    let hostname = "unknown";
    try { hostname = new URL(urlStr).hostname.replace(/^www\./,""); } catch {}
    items.push({
      id: hash(urlStr),
      title,
      url: urlStr,
      source: hostname,
      published_at: toISO(date),
      category: "global",
      description
    });
  }
  return items;
}

async function queryNews(env: Env, category: string, q: string): Promise<Item[]> {
  if (env.USE_NEWS_API !== "true") return [];
  const items: Item[] = [];
  if (env.NEWSAPI_KEY) {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&language=nb&apiKey=${env.NEWSAPI_KEY}`;
    const r = await fetch(url);
    const j = await r.json();
    for (const a of j.articles || []) {
      let hostname = "unknown";
      try { hostname = new URL(a.url).hostname.replace(/^www\./,""); } catch {}
      items.push({
        id: hash(a.url),
        title: a.title,
        url: a.url,
        source: hostname,
        published_at: toISO(a.publishedAt || Date.now()),
        category,
        description: a.description || ""
      });
    }
  }
  return items;
}

function norwegianRelevanceScore(item: RawItem): number {
  let score = 0;
  const text = (item.title + " " + (item.description || "")).toLowerCase();

  if (/russia|apt28|sandworm|cozy\s*bear|turla|fsb|gru/i.test(text)) score += 3;
  if (/norway|norge|nato|cyberforsvaret|baltic|arctic|nsm|ncsc|pst/i.test(text)) score += 4;
  if (/attack|breach|espionage|disrupt|ransomware|malware|exploit/i.test(text)) score += 2;
  if ((Date.now() - new Date(item.published_at).getTime()) <= 12*3600*1000) score += 1;

  return Math.min(score, 10);
}

async function harvest(env: Env) {
  const nowISO = new Date().toISOString();
  const today = nowISO.split('T')[0];

  for (const cat of CATEGORIES) {
    const urls = RSS_SOURCES[cat];
    let rawList: RawItem[] = [];

    for (const u of urls) {
      try {
        let items = await fetchRSS(u);
        items = items.map(x => ({ ...x, category: cat }));
        if (cat === "milno_mentions") {
          items = items.filter(x => /mil\.no/i.test(x.title) || /mil\.no/i.test(x.url));
        }
        rawList.push(...items);
      } catch { }
    }

    if (cat === "media_cyberforsvaret") {
      rawList.push(...await queryNews(env, cat, `Cyberforsvaret OR "Norwegian Armed Forces Cyber Defence"`));
    }
    if (cat === "norway") {
      rawList.push(...await queryNews(env, cat, `cyberangrep OR dataangrep site:no`));
    }

    const rawKey = `raw:${cat}:${today}`;
    await env.RAW_CACHE.put(rawKey, JSON.stringify(rawList), { expirationTtl: 7*86400 });

    const seen = new Set<string>();
    const processed = rawList
      .filter(x => x.url && x.title && within24h(x.published_at))
      .filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; })
      .map(x => ({ ...x, score: norwegianRelevanceScore(x) }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    const key = `cat:${cat}`;
    await env.DASHBOARD_CACHE.put(key, JSON.stringify({ items: processed, updated_at: nowISO }), { expirationTtl: 48*3600 });
  }

  await env.STATE.put("lastUpdate", nowISO);
}

async function getCategory(env: Env, cat: string) {
  if (!CATEGORIES.includes(cat as any)) return new Response("Unknown category", { status: 400 });
  const key = `cat:${cat}`;
  const raw = await env.DASHBOARD_CACHE.get(key);
  if (!raw) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" }});
  return new Response(raw, { headers: { "content-type": "application/json" }});
}

// NEW: Get aggregated raw items from last 7 days
async function getWeekly(env: Env, cat: string) {
  if (!CATEGORIES.includes(cat as any)) return new Response("Unknown category", { status: 400 });

  const now = new Date();
  const weekItems: RawItem[] = [];
  const seen = new Set<string>();

  for (let i = 6; i >= 0; i--) { // Last 7 days
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const rawKey = `raw:${cat}:${dateStr}`;
    const raw = await env.RAW_CACHE.get(rawKey);
    if (raw) {
      const items = JSON.parse(raw) as RawItem[];
      items.forEach(item => {
        if (!seen.has(item.url) && !within24h(item.published_at) === false) { // Include all, even older
          seen.add(item.url);
          weekItems.push({ ...item, score: norwegianRelevanceScore(item) });
        }
      });
    }
  }

  const sorted = weekItems
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 20); // Top 20 for weekly view

  return new Response(JSON.stringify({ items: sorted }), { headers: { "content-type": "application/json" }});
}

function summarizeBlock(title: string, items: Item[]) {
  if (items.length === 0) return `${title}: Intet spesielt å rapportere.`;
  const top = items.slice(0,3).map(x => `– ${x.title} (${x.source})`).join('\n');
  return `${title} (${items.length} funn siste 24t):\n${top}`;
}

async function generateReport(env: Env) {
  const data: Record<string, {items: Item[]}> = {};
  for (const c of CATEGORIES) {
    const raw = await env.DASHBOARD_CACHE.get(`cat:${c}`);
    data[c] = raw ? JSON.parse(raw) : { items: [] };
  }
  const sections = [
    summarizeBlock("Store globale cyberhendelser", data.global?.items || []),
    summarizeBlock("Cyberhendelser i Norge", data.norway?.items || []),
    summarizeBlock("Viktige rapporter", data.reports?.items || []),
    summarizeBlock("Sosiale medier – Cyberforsvaret", data.social_cyberforsvaret?.items || []),
    summarizeBlock("Trusselomtale av mil.no", data.milno_mentions?.items || []),
    summarizeBlock("Norske medier – Cyberforsvaret", data.media_cyberforsvaret?.items || []),
    summarizeBlock("Analyser av militære cyberoperasjoner", data.mil_ops_analysis?.items || []),
    summarizeBlock("Russiske cybertrusler og angrep", data.russian_threats?.items || [])
  ];
  const lastUpdate = (await env.STATE.get("lastUpdate")) || new Date().toISOString();
  const header = `Morgenrapport (${new Date(lastUpdate).toLocaleString('no-NO')}):`;
  return [header, "", ...sections].join('\n\n');
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
};
function withCors(resp: Response, extra: Record<string,string> = {}) {
  const headers = new Headers(resp.headers);
  for (const [k,v] of Object.entries({ ...CORS_HEADERS, ...extra })) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
}

const INDEX_HTML = `<!doctype html>
<html lang="no">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cyber Defenders Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100">
  <header class="sticky top-0 z-10 bg-slate-900/80 backdrop-blur border-b border-slate-800">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <h1 class="text-xl font-bold">Cyber Defenders Dashboard</h1>
      <div class="flex items-center gap-3">
        <span id="last-updated" class="text-sm text-slate-300">Laster…</span>
        <button id="refreshBtn" class="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500">Oppdater nå</button>
        <button id="reportBtn" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500">Generer rapport</button>
        <button id="speakBtn" class="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-500" disabled>Les opp</button>
      </div>
    </div>
  </header>
  <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">
    <section id="cards" class="grid md:grid-cols-2 xl:grid-cols-3 gap-4"></section>
    <template id="card-tpl">
      <article class="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-semibold"></h2>
          <span class="text-xs rounded-lg px
