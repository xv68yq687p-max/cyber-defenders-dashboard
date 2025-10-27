import { XMLParser } from 'fast-xml-parser';

type Env = {
  DASHBOARD_CACHE: KVNamespace;
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
};

const CATEGORIES = [
  "global",
  "norway",
  "reports",
  "social_cyberforsvaret",
  "milno_mentions",
  "media_cyberforsvaret",
  "mil_ops_analysis",
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
  ],
  norway: [
    "https://www.regjeringen.no/no/aktuelt/nyheter.rss",
    "https://www.politiet.no/aktuelt-tall-og-fakta/aktuelt/rss/",
    "https://www.digi.no/rss",
    "https://www.tu.no/rss",
    "https://www.nrk.no/toppsaker.rss",
  ],
  reports: [
    "https://www.enisa.europa.eu/publications/RSS",
    "https://www.mandiant.com/resources/blog/rss.xml",
    "https://www.microsoft.com/en-us/security/blog/feed/",
    "https://www.crowdstrike.com/blog/feed/",
    "https://www.verizon.com/business/resources/rss.xml",
    "https://blog.talosintelligence.com/feeds/posts/default?alt=rss",
  ],
  social_cyberforsvaret: [
    "https://www.forsvaret.no/aktuelt/_layouts/15/listfeed.aspx?List=%7BListId%7D"
  ],
  milno_mentions: [
    "https://news.google.com/rss/search?q=mil.no",
  ],
  media_cyberforsvaret: [
    "https://news.google.com/rss/search?q=Cyberforsvaret+OR+%22Norwegian%20Armed%20Forces%20Cyber%20Defence%22",
  ],
  mil_ops_analysis: [
    "https://ccdcoe.org/feed/",
    "https://www.rand.org/pubs/rss.xml",
    "https://rusi.org/explore-our-research/publications/feed",
    "https://www.csis.org/rss.xml",
    "https://www.atlanticcouncil.org/feed/",
    "https://carnegieendowment.org/rss/solr?keywords=cyber%20operations",
  ],
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
  for (const it of Array.isArray(feedItems) ? feedItems : [feedItems]) {
    const title = it.title?.["#text"] || it.title || "(uten tittel)";
    const link  = it.link?.href || it.link || it.guid || it.id;
    const date  = it.pubDate || it.updated || it.published || it["dc:date"] || new Date().toISOString();
    const urlStr = typeof link === "string" ? link : String(link);
    let hostname = "unknown";
    try { hostname = new URL(urlStr).hostname.replace(/^www\./,""); } catch {}
    items.push({
      id: hash(urlStr),
      title,
      url: urlStr,
      source: hostname,
      published_at: toISO(date),
      category: "global"
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
        category
      });
    }
  }
  return items;
}

async function harvest(env: Env) {
  const nowISO = new Date().toISOString();
  for (const cat of CATEGORIES) {
    const urls = RSS_SOURCES[cat];
    let list: Item[] = [];
    for (const u of urls) {
      try {
        let items = await fetchRSS(u);
        items = items.map(x => ({ ...x, category: cat }));
        if (cat === "milno_mentions") {
          items = items.filter(x => /mil\.no/i.test(x.title) || /mil\.no/i.test(x.url));
        }
        list.push(...items);
      } catch (e) {
        // ignore one-off feed errors
      }
    }
    if (cat === "media_cyberforsvaret") {
      list.push(...await queryNews(env, cat, `Cyberforsvaret OR "Norwegian Armed Forces Cyber Defence"`));
    }
    if (cat === "norway") {
      list.push(...await queryNews(env, cat, `cyberangrep OR dataangrep site:no`));
    }

    const seen = new Set<string>();
    list = list
      .filter(x => x.url && x.title)
      .filter(x => within24h(x.published_at))
      .filter(x => { if (seen.has(x.url)) return false; seen.add(x.url); return true; })
      .sort((a,b) => +new Date(b.published_at) - +new Date(a.published_at));

    const key = `cat:${cat}`;
    await env.DASHBOARD_CACHE.put(key, JSON.stringify({ items: list, updated_at: nowISO }), { expirationTtl: 48*3600 });
  }
  await env.STATE.put("lastUpdate", nowISO);
}

async function getCategory(env: Env, cat: string) {
  if (!CATEGORIES.includes(cat as any)) return new Response("Unknown category", { status: 400 });
  const key = `cat:${cat}`;
  const raw = await env.DASHBOARD_CACHE.get(key);
  if (!raw) return new Response(JSON.stringify({ items: [] }), { headers: { "content-type":"application/json" }});
  return new Response(raw, { headers: { "content-type":"application/json" }});
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
  ];
  const lastUpdate = (await env.STATE.get("lastUpdate")) || new Date().toISOString();
  const header = `Morgenrapport (${new Date(lastUpdate).toLocaleString('no-NO')}):`;
  return [header, "", ...sections].join('\n\n');
}

// Inline copy of the index.html for convenience (served by the Worker on "/")
const INDEX_HTML = `
<!doctype html>
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
    const CATEGORIES = [
      {key:"global", name:"Store globale cyberhendelser"},
      {key:"norway", name:"Cyberhendelser i Norge"},
      {key:"reports", name:"Viktige rapporter"},
      {key:"social_cyberforsvaret", name:"Sosiale medier – Cyberforsvaret"},
      {key:"milno_mentions", name:"Trusselomtale av mil.no"},
      {key:"media_cyberforsvaret", name:"Norske medier – Cyberforsvaret"},
      {key:"mil_ops_analysis", name:"Analyser av militære cyberoperasjoner"}
    ];

    const cardsEl = document.getElementById('cards');
    const tpl = document.getElementById('card-tpl');



    async function load() {
      document.getElementById('last-updated').textContent = 'Laster…';
      cardsEl.innerHTML = '';
      for (const cat of CATEGORIES) {
        const res = await fetch(\`/api/items?category=${cat.key}\`);
        const data = await res.json();
        const node = tpl.content.cloneNode(true);
        const art = node.querySelector('article');
        art.querySelector('h2').textContent = cat.name;
        art.querySelector('span').textContent = (data.items?.length || 0) + ' funn';
        const ul = art.querySelector('ul');
        if (!data.items || data.items.length === 0) {
          art.querySelector('div').textContent = 'Intet spesielt å rapportere';
        } else {
          (data.items.slice(0,5)).forEach(it => {
            const li = document.createElement('li');
            li.innerHTML = \`<a class="hover:underline" href="${it.url}" target="_blank" rel="noopener">${it.title}</a>
                            <div class="text-xs text-slate-400">${it.source} • ${timeAgo(it.published_at)}</div>\`;
            ul.appendChild(li);
          });
          if (data.items.length > 5) {
            const more = document.createElement('button');
            more.className = 'mt-2 text-sm text-sky-400 hover:underline';
            more.textContent = \`Vis alle (${data.items.length})\`;
            more.onclick = () => {
              ul.innerHTML = '';
              data.items.forEach(it => {
                const li = document.createElement('li');
                li.innerHTML = \`<a class="hover:underline" href="${it.url}" target="_blank" rel="noopener">${it.title}</a>
                                <div class="text-xs text-slate-400">${it.source} • ${timeAgo(it.published_at)}</div>\`;
                ul.appendChild(li);
              });
              more.remove();
            };
            art.appendChild(more);
          }
        }
        cardsEl.appendChild(node);
      }
      const health = await fetch('/api/health').then(r=>r.json()).catch(()=>({}));
      document.getElementById('last-updated').textContent = health.lastUpdate ? ('Oppdatert ' + timeAgo(health.lastUpdate)) : 'Oppdatert nylig';
    }

    document.getElementById('refreshBtn').onclick = async () => {
      await fetch('/api/refresh', {method:'POST'});
      load();
    };

    document.getElementById('reportBtn').onclick = async () => {
      const res = await fetch('/api/report');
      const txt = await res.text();
      const ta = document.getElementById('report');
      ta.value = txt;
      document.getElementById('speakBtn').disabled = false;
    };

    document.getElementById('speakBtn').onclick = () => {
      const text = document.getElementById('report').value;
      if (!text) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'nb-NO';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };

    load();
  </script>
</body>
</html>

`;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await harvest(env);
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/health") {
      const lastUpdate = await env.STATE.get("lastUpdate");
      return new Response(JSON.stringify({ lastUpdate }), { headers: {"content-type":"application/json"}});
    }

    if (url.pathname === "/api/items") {
      const cat = url.searchParams.get("category") || "";
      return getCategory(env, cat);
    }

    if (url.pathname === "/api/report") {
      const txt = await generateReport(env);
      return new Response(txt, { headers: { "content-type":"text/plain; charset=utf-8" }});
    }

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      const token = req.headers.get("x-admin-token");
      if (env.ADMIN_TOKEN && token !== env.ADMIN_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
      await harvest(env);
      return new Response("ok");
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    return new Response("Not found", { status: 404 });
  }
};
