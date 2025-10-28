// src/worker.ts
interface Env {
  AI: any;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Serve index.html
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(INDEX_HTML, {
        headers: { "Content-Type": "text/html" }
      });
    }

    // REST API
    if (pathname === "/api/search" && request.method === "GET") {
      const query = url.searchParams.get("q") || "cyber";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

      try {
        const rawHits = await fetchCyberContent(query, limit);
        const filteredHits = await filterWithAI(env.AI, rawHits);

        return new Response(JSON.stringify({
          query,
          total: filteredHits.length,
          hits: filteredHits
        }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "s-maxage=300"
          }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

// Mock data source — replace with real API
async function fetchCyberContent(query: string, limit: number) {
  const mock = [
    { title: "Colonial Pipeline Ransomware Attack", snippet: "DarkSide group demands $5M in Bitcoin...", url: "https://example.com/1" },
    { title: "iOS 18 Released", snippet: "New features include AI emojis and better battery...", url: "https://example.com/2" },
    { title: "APT29 Uses GitHub Actions in Supply Chain Attack", snippet: "Russian actors target CI/CD pipelines...", url: "https://example.com/3" },
    { title: "Cat Video Goes Viral", snippet: "Kittens vs cucumbers - 10M views...", url: "https://example.com/4" }
  ];
  return mock.slice(0, limit);
}

// AI Filter
async function filterWithAI(ai: any, hits: any[]) {
  const CYBER_CONTEXT = "cyber attack malware ransomware phishing ddos exploit vulnerability cve apt intrusion breach zero-day hacking defense incident response threat intelligence";

  const inputs = hits.map(hit => ({
    query: CYBER_CONTEXT,
    input: `${hit.title} ${hit.snippet}`
  }));

  try {
    const results = await ai.run("@cf/baai/bge-reranker-base", { inputs });
    return hits
      .map((hit, i) => ({ ...hit, relevance: results.scores[i] || 0 }))
      .filter(hit => hit.relevance > 0.45)
      .sort((a, b) => b.relevance - a.relevance);
  } catch (err) {
    console.error("AI failed:", err);
    return hits.filter(hit => /cyber|attack|malware|phish|ransom|ddos|exploit|cve|apt|breach/i.test(hit.title + hit.snippet));
  }
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
    button { padding: 0.5rem 1rem; }
  </style>
</head>
<body>
  <h1>Cyber Defenders Dashboard</h1>
  <input type="text" id="search" placeholder="Search cyber threats..." value="attack" />
  <button onclick="search()">Search</button>
  <div id="results">Loading...</div>

  <script>
    async function search() {
      const q = encodeURIComponent(document.getElementById('search').value);
      const res = await fetch(\`/api/search?q=\${q}\`);
      const data = await res.json();
      const html = data.hits && data.hits.length > 0
        ? data.hits.map(h => \`
            <div class="hit">
              <h3><a href="\${h.url}" target="_blank">\${h.title}</a></h3>
              <p>\${h.snippet}</p>
              <span class="score">Relevance: \${(h.relevance||0).toFixed(3)}</span>
            </div>
          \`).join('')
        : '<i>No relevant cyber threats found.</i>';
      document.getElementById('results').innerHTML = html;
    }
    search();
  </script>
</body>
</html>`;
