import type { RawItem } from '../types.js';

type Fetcher = typeof fetch;

const QUERY = `
query DevPosts {
  posts(first: 20, topic: "developer-tools") {
    edges { node { name tagline website url } }
  }
}`;

export async function scrapeProductHunt(
  token: string,
  fetcher: Fetcher = fetch,
): Promise<RawItem[]> {
  const r = await fetcher('https://api.producthunt.com/v2/api/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!r.ok) return [];
  const j = await r.json() as {
    data: {
      posts: {
        edges: { node: { name: string; tagline?: string; website?: string; url?: string } }[];
      };
    };
  };
  const now = new Date().toISOString();
  return j.data.posts.edges
    .map(e => ({
      source: 'producthunt' as const,
      title: `${e.node.name}${e.node.tagline ? ' — ' + e.node.tagline : ''}`,
      url: e.node.website ?? e.node.url ?? '',
      fetchedAt: now,
    }))
    .filter(i => i.url);
}
