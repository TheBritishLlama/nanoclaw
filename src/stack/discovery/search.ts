export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>;

export class SearxngClient {
  constructor(private instance: string, private fetcher: Fetcher = (u) => fetch(u)) {}

  async search(query: string, max = 20): Promise<SearchResult[]> {
    const u = new URL('/search', this.instance);
    u.searchParams.set('q', query);
    u.searchParams.set('format', 'json');
    // SearXNG accepts + as space; keep the URL readable in logs.
    const url = u.toString().replace(/%20/g, '+');
    let res;
    try { res = await this.fetcher(url); } catch { return []; }
    if (!res.ok) return [];
    let body: any;
    try { body = await res.json(); } catch { return []; }
    const items = Array.isArray(body?.results) ? body.results : [];
    return items.slice(0, max).map((r: any) => ({
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      snippet: String(r.content ?? ''),
    })).filter((r: SearchResult) => r.url);
  }
}
