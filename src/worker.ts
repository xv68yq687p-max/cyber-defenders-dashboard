import { XMLParser } from 'fast-xml-parser';

type Env = {
  DASHBOARD_CACHE: KVNamespace;
  RAW_CACHE: KVNamespace;          // <-- NEW BINDING
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
  description?: string;            // <-- NEW (optional snippet)
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
  "russian_threats"               // <-- NEW CATEGORY
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

/* ---------- RELEVANCE SCORING (cost-free) ---------- */
function norwegianRelevanceScore(item: RawItem): number {
  let score = 0;
  const text = (item.title + " " + (item.description || "")).toLowerCase();

  // Russian attribution
  if (/russia|apt28|sandworm|cozy\s*bear|turla|fsb|gru/i.test(text)) score += 3;

  // Norwegian / NATO impact
  if (/norway|norge|nato|cyberforsvaret|baltic|arctic|nsm|ncsc|pst/i.test(text)) score += 4;

  // Severity keywords
  if (/attack|breach|espionage|disrupt|ransomware|malware|exploit/i.test(text)) score += 2;

  // Very recent (<12h)
  if ((Date.now() - new Date(item.published_at).getTime()) <= 12*3600*1000) score += 1;

  return Math.min(score, 10);
}

/* ---------- HARVEST ---------- */
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
      } catch { /* ignore feed error */ }
    }

    // NewsAPI for media/norway
    if (cat === "media_cyberforsvaret") {
      rawList.push(...await queryNews(env, cat, `Cyberforsvaret OR "Norwegian Armed Forces Cyber Defence"`));
    }
    if (cat === "norway") {
      rawList.push(...await queryNews(env, cat, `cyberangrep OR dataangrep site:no`));
    }

    // Store **raw** data (unfiltered)
    const rawKey = `raw:${cat}:${today}`;
    await env.RAW_CACHE.put(rawKey, JSON.stringify(rawList), { expirationTtl: 7*86400 });

    // Process: filter, dedupe, score, limit to top 10
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

/* ---------- CATEGORY FETCH ---------- */
async function getCategory(env: Env, cat: string) {
  if (!CATEGORIES.includes(cat as any)) return new Response("Unknown category", { status: 400 });
  const key = `cat:${cat}`;
  const raw = await env.DASHBOARD_CACHE.get(key);
  if (!raw) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" }});
  return new Response(raw, { headers: { "content-type": "application/json" }});
}

/* ---------- REPORT ---------- */
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

/* ---------- CORS ---------- */
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

/* ---------- INLINE FRONTEND (unchanged except timeAgo fix) ---------- */
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
          <span class="text-xs rounded-lg px-2 py-1 bg-slate-800"></span>
        </div>
        <ul class="space-y-2"></ul>
        <div class="text-sm text-slate-400 mt-2 empty:hidden"></div>
      </article>
    </template>
    <section>
      <h2 class="text-lg font-semibold mb-2">Morgenrapport</h2>
      <textarea id="report" class="w-full h-48 p-3 rounded-xl bg-slate-900 border border-slate-800" placeholder="Klikk “Generer rapport”" readonly></textarea>
    </section>
  </main>
  <script>
    "use strict";
    var CATEGORIES = [
      {key:"global", name:"Store globale cyberhendelser"},
      {  {key:"norway", name:"Cyberhendelser i Norge"},
      {key:"reports", name:"Viktige rapporter"},
      {key:"social_cyberforsvaret", name:"Sosiale medier – Cyberforsvaret"},
      {key:"milno_mentions", name:"Trusselomtale av mil.no"},
      {key:"media_cyberforsvaret", name:"Norske medier – Cyberforsvaret"},
      {key:"mil_ops_analysis", name:"Analyser av militære cyberoperasjoner"},
      {key:"russian_threats", name:"Russiske cybertrusler og angrep"}
    ];
    function timeAgo(iso) {
      var d = new Date(iso), now = new Date();
      var timeDiffSec = Math.max(0, (now - d) / 1000);
      var h = Math.floor(timeDiffSec / 3600);
      if (h < 1) return String(Math.floor(timeDiffSec/60)) + " min siden";
      if (h < 24) return String(h) + " t siden";
      return d.toLocaleString('no-NO');
    }
    var cardsEl = document.getElementById('cards');
    var tpl = document.getElementById('card-tpl');
    function makeItemHtml(it) {
      return '<a class="hover:underline" href="' + it.url + '" target="_blank" rel="noopener">' + it.title + '</a>' +
             '<div class="text-xs text-slate-400">' + it.source + ' • ' + timeAgo(it.published_at) + '</div>';
    }
    async function load() {
      document.getElementById('last-updated').textContent = 'Laster…';
      cardsEl.innerHTML = '';
      for (var i=0; i<CATEGORIES.length; i++) {
        var cat = CATEGORIES[i];
        var res = await fetch('/api/items?category=' + encodeURIComponent(cat.key));
        var data = await res.json();
        var node = tpl.content.cloneNode(true);
        var art = node.querySelector('article');
        art.querySelector('h2').textContent = cat.name;
        art.querySelector('span').textContent = String((data.items && data.items.length) || 0) + ' funn';
        var ul = art.querySelector('ul');
        if (!data.items || data.items.length === 0) {
          art.querySelector('div').textContent = 'Intet spesielt å rapportere';
        } else {
          var upto = Math.min(5, data.items.length);
          for (var j=0; j<upto; j++) {
            var it = data.items[j];
            var li = document.createElement('li');
            li.innerHTML = makeItemHtml(it);
            ul.appendChild(li);
          }
          if (data.items.length > 5) {
            var more = document.createElement('button');
            more.className = 'mt-2 text-sm text-sky-400 hover:underline';
            more.textContent = 'Vis alle (' + data.items.length + ')';
            more.onclick = function() {
              ul.innerHTML = '';
              for (var k=0; k<data.items.length; k++) {
                var it2 = data.items[k];
                var li2 = document.createElement('li');
                li2.innerHTML = makeItemHtml(it2);
                ul.appendChild(li2);
              }
              more.remove();
            };
            art.appendChild(more);
          }
        }
        cardsEl.appendChild(node);
      }
      try {
        var health = await fetch('/api/health').then(function(r){return r.json()});
        document.getElementById('last-updated').textContent = health.lastUpdate ? ('Oppdatert ' + timeAgo(health.lastUpdate)) : 'Oppdatert nylig';
      } catch(e) {
        document.getElementById('last-updated').textContent = 'Oppdatert nylig';
      }
    }
    document.getElementById('refreshBtn').onclick = async function () {
      await fetch('/api/refresh', {method:'POST'});
      load();
    };
    document.getElementById('reportBtn').onclick = async function () {
      var res = await fetch('/api/report');
      var txt = await res.text();
      var ta = document.getElementById('report');
      ta.value = txt;
      document.getElementById('speakBtn').disabled = false;
    };
    document.getElementById('speakBtn').onclick = function () {
      var text = document.getElementById('report').value;
      if (!text) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'nb-NO';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };
    load();
  </script>
</body>
</html>`;

/* ---------- HANDLER ---------- */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await harvest(env);
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === "/api/health") {
      const lastUpdate = await env.STATE.get("lastUpdate");
      return withCors(new Response(JSON.stringify({ lastUpdate }), { headers: {"content-type":"application/json"}}));
    }
    if (url.pathname === "/api/items") {
      const cat = url.searchParams.get("category") || "";
      const resp = await getCategory(env, cat);
      return withCors(resp);
    }
    if (url.pathname === "/api/report") {
      const txt = await generateReport(env);
      return withCors(new Response(txt, { headers: { "content-type":"text/plain; charset=utf-8" }}));
    }
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      const token = req.headers.get("x-admin-token");
      if (env.ADMIN_TOKEN && token !== env.ADMIN_TOKEN) {
        return withCors(new Response("Unauthorized", { status: 401 }));
      }
      await harvest(env);
      return withCors(new Response("ok"));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" }});
    }
    return new Response("Not found", { status: 404 });
  }
};
