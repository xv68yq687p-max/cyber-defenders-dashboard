// src/worker.ts - Cyber Defenders Dashboard with AI Filtering

interface Env {
  AI: any;
}

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Cyber Defenders Dashboard</title>
  <style>
    body { font-family: system-ui; margin: 2rem; background: #0d1117; color: #c9d1d9; }
    .hit { background: #161b22; margin: 1rem 0; padding: 1rem; border-radius: 8px; border-left: 4px solid #58a6ff; }
    .score { color: #56d364; font-size: 0.8em; }
    input { padding: 0.5rem; width: 100%; max-width: 500px; margin-bottom: 1rem; }
    button { padding: 0.5rem 1rem; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>🛡️ Cyber Defenders Dashboard</h1>
  <input type="text" id="search" placeholder="Search cyber threats (e.g., ransomware)..." value="attack" />
  <button onclick="search()">Search</button>
  <div id="results">Loading filtered results...</div>

  <script>
    async function search() {
      const q = encodeURIComponent(document.getElementById('search').value || 'cyber');
      try {
        const res = await fetch(\`/api/search?q=\${q}\`);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        const container = document.getElementById('results');
        if (data.hits && data.hits.length > 0) {
          container.innerHTML = data.hits.map(h => \`
            <div class="hit">
              <h3><a href="\${h.url}" target="_blank" rel="noopener">\${h.title}</a></h3>
              <p>\${h.snippet}</p>
              <span class="score">Relevance: \${(h.relevance || 0).toFixed(3)}</span>
            </div>
          \`).join('');
        } else {
          container.innerHTML = '<i>No relevant cyber threats found. Try "ransomware" or "APT".</i>';
        }
      } catch (err) {
        document.getElementById('results').innerHTML = '<i>Error loading results: ' + err.message + '</i>';
      }
    }
    // Auto-run on load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', search);
    } else {
      search();
    }
  </script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve dashboard at root
    if (pathname === '/' || pathname === '/index.html') {
      return new Response(INDEX_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // API endpoint for filtered search
    if (pathname === '/api/search' && request.method === 'GET') {
      const query = url.searchParams.get('q') || 'cyber';
      const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50);

      try {
        // Fetch raw content (mock; replace with real source like RSS/API)
        const rawHits = await fetchCyberContent(query, limit);

        // Apply AI filter
        const filteredHits = await filterWithAI(env.AI, rawHits, query);

        return new Response(JSON.stringify({
          query,
          total: filteredHits.length,
          hits: filteredHits
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, s-maxage=300'
          }
        });
      } catch (error: any) {
        console.error('API Error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 404 for unknown paths
    return new Response('Not Found', { status: 404 });
  }
} satisfies ExportedHandler<Env>;

// Mock content fetcher - REPLACE WITH REAL SOURCE (e.g., fetch('https://api.newsapi.org/...'))
async function fetchCyberContent(query: string, limit: number): Promise<any[]> {
  // Simulate diverse hits (some relevant, some not)
  const hits = [
    { title: 'Colonial Pipeline Ransomware Hits US Fuel Supply', snippet: 'DarkSide hackers demand $5M after encrypting systems in major cyber attack.', url: 'https://example.com/colonial' },
    { title: 'iPhone 17 Launch Rumors', snippet: 'Apple teases new colors and camera upgrades at fall event.', url: 'https://example.com/iphone' },
    { title: 'APT41 State-Sponsored Breach Targets Telecoms', snippet: 'Chinese group exploits zero-day in 5G infrastructure for espionage.', url: 'https://example.com/apt41' },
    { title: 'Viral Puppy Videos of 2025', snippet: 'Adorable golden retrievers steal hearts online with funny tricks.', url: 'https://example.com/puppies' },
    { title: 'DDoS Attack Cripples Gaming Network', snippet: 'Mirai botnet variant overwhelms servers during peak hours.', url: 'https://example.com/ddos' }
  ];
  // Filter roughly by query for demo
  return hits.filter(h => h.title.toLowerCase().includes(query.toLowerCase()) || h.snippet.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
}

// AI relevance filter using Workers AI
async function filterWithAI(ai: any, hits: any[], userQuery: string): Promise<any[]> {
  const cyberContext = `cyber operations attacks malware ransomware phishing DDoS zero-day APT supply chain intrusion exploit vulnerability CVE ethical hacking red team defense incident response threat intelligence ${userQuery}`;
  
  const inputs = hits.map(hit => ({
    query: cyberContext,
    input: `${hit.title} ${hit.snippet}`
  }));

  try {
    const results = await ai.run('@cf/baai/bge-reranker-base', { inputs });
    
    return hits
      .map((hit: any, i: number) => ({
        ...hit,
        relevance: results.scores ? results.scores[i] || 0 : 0
      }))
      .filter((hit: any) => hit.relevance > 0.45)  // Tune threshold: higher = stricter
      .sort((a: any, b: any) => b.relevance - a.relevance);
  } catch (error: any) {
    console.error('AI Filter Error:', error);
    // Fallback: Simple keyword filter
    return hits.filter((hit: any) => {
      const text = `${hit.title} ${hit.snippet}`.toLowerCase();
      const keywords = ['cyber', 'attack', 'malware', 'ransom', 'phish', 'ddos', 'exploit', 'vulnerability', 'cve', 'apt', 'breach', 'hack', 'zero-day'];
      return keywords.some(kw => text.includes(kw));
    }).map((hit: any) => ({ ...hit, relevance: 0.5 }));  // Default score for fallback
  }
}
