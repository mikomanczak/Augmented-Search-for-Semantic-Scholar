import { fetchResource } from './pdf';

export function figshareArticleId(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'figshare.com' || url.hostname.endsWith('.figshare.com'))) return;
    return /^\/articles\/(?:[^/]+\/)*?(\d+)(?:\/versions\/\d+)?\/?$/.exec(url.pathname)?.[1];
  } catch { return; }
}

export async function figshareSources(id: string, signal: AbortSignal, load = fetchResource): Promise<string[]> {
  const result = await load(`https://api.figshare.com/v2/articles/${id}`, signal, undefined, 'json');
  const article = JSON.parse(result.bytes.toString('utf8'));
  if (String(article?.id) !== id || article.is_embargoed !== false || !Array.isArray(article.files)) return [];
  return article.files.filter((file: any) => file && !file.is_link_only &&
    (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')) &&
    typeof file.download_url === 'string').map((file: any) => file.download_url);
}
