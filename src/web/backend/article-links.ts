import { load } from 'cheerio';

const NON_ARTICLE = /\b(?:citations?|bibtex|ris|supplement(?:ary|al)?|datasets?|source code|thumbnail|cover image|download all)\b/i;
const NON_PDF_FILE = /\.(?:zip|gz|tgz|csv|tsv|xlsx?|docx?|pptx?|bib|ris|xml|json|jpe?g|png|svg|mp4|css|js)(?:$|[?#])/i;
const PDF_LABEL = /\bpdf\b/i;
const DOWNLOAD_LABEL = /\bdownload\b|\b(?:view|open|read)\s+(?:(?:the|a)\s+)?(?:full[\s-]*text|article|document|file)\b/i;

function httpUrl(value: string | undefined, base: string): URL | undefined {
  if (!value?.trim() || value.trim().startsWith('#') || value.length > 4096) return;
  try {
    const url = new URL(value.trim(), base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) return;
    url.hash = '';
    return url;
  } catch { return; }
}

function downloadRoute(url: URL): boolean {
  return /\/article\/download\/[^/]+\/[^/]+/i.test(url.pathname) // OJS
    || /\/(?:api\/core\/)?bitstreams?\/[^/]+\/(?:content|download)\/?$/i.test(url.pathname) // DSpace
    || /\/cgi\/viewcontent\.cgi$/i.test(url.pathname) // Digital Commons
    || /\/ndownloader\/files\/\d+\/?$/i.test(url.pathname) // Figshare
    || /\/doi\/(?:e?pdf)\/10\./i.test(url.pathname)
    || /\/science\/article\/pii\/[^/]+\/pdfft\/?$/i.test(url.pathname);
}

// Discover links without executing scripts, submitting POSTs, or making requests.
// All returned URLs still pass through fetchResource's per-hop network checks.
export function articleLinks(html: string, pageUrl: string): { urls: string[] } {
  const $ = load(html);
  $('script, style, template').remove();
  const base = httpUrl($('base[href]').first().attr('href'), pageUrl)?.href ?? pageUrl;
  const candidates = new Map<string, number>();

  function add(rawUrl: string | undefined, score: number, relativeTo = base, depth = 0) {
    const url = httpUrl(rawUrl, relativeTo);
    if (!url || NON_PDF_FILE.test(url.href)) return;
    // PDF.js and similar viewers expose the actual PDF as an encoded URL.
    if (depth < 2 && /(?:viewer|pdfjs|pdf\.js|gview|viewpdf)/i.test(url.pathname)) {
      const file = url.searchParams.get('file') ?? url.searchParams.get('pdf')
        ?? url.searchParams.get('pdfUrl') ?? url.searchParams.get('url');
      if (file) { add(file, score, url.href, depth + 1); return; }
    }
    candidates.set(url.href, Math.max(candidates.get(url.href) ?? 0, score));
  }

  $('meta, link, a, button, iframe, embed, object, form').each((_index, element) => {
    const node = $(element);
    const tag = element.tagName;
    if (node.closest('[id*="supplement"], [class*="supplement"], [class~="references"], [class~="related-articles"]').length) return;
    const type = node.attr('type')?.split(';')[0].trim().toLowerCase();
    if (tag === 'meta') {
      const name = (node.attr('name') ?? node.attr('property') ?? '').toLowerCase();
      if (['citation_pdf_url', 'bepress_citation_pdf_url', 'eprints.document_url', 'wkhealth_pdf_url'].includes(name)) {
        add(node.attr('content'), 100);
      }
      return;
    }
    const text = node.clone().find('*').append(' ').end().text();
    const label = [text, node.attr('aria-label'), node.attr('title'), node.attr('download')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (NON_ARTICLE.test(label)) return;
    const dataUrl = node.attr('data-href') ?? node.attr('data-url') ?? node.attr('data-download-url');
    const href = httpUrl(node.attr('href'), base) ? node.attr('href') : dataUrl;
    const resolved = httpUrl(href, base);
    const isPdf = type === 'application/pdf' || PDF_LABEL.test(label);

    if (tag === 'a' || tag === 'link') {
      if (!resolved) return;
      if (type === 'application/pdf' || /\.pdf(?:$|[?#])/i.test(href ?? '') || /\.pdf$/i.test(node.attr('download') ?? '')) {
        add(href, 90);
      } else if (isPdf) add(href, 85);
      else if (downloadRoute(resolved)) add(href, 80);
      else if (DOWNLOAD_LABEL.test(label) || node.attr('download') !== undefined) add(href, 60);
      return;
    }
    if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
      const src = node.attr(tag === 'object' ? 'data' : 'src') ?? node.attr('data-src');
      const url = httpUrl(src, base);
      if (url && (isPdf || /\.pdf(?:$|[?#])/i.test(src ?? '') || downloadRoute(url)
        || /(?:viewer|pdfjs|pdf\.js|gview|viewpdf)/i.test(url.pathname)
        || /\/article\/view\/[^/]+\/[^/]+/i.test(url.pathname))) add(src, 90);
      return;
    }
    if (tag === 'button' && (isPdf || DOWNLOAD_LABEL.test(label))) {
      // Only literal data URLs; onclick handlers are never evaluated.
      add(dataUrl, isPdf ? 85 : 60);
      return;
    }
    if (tag === 'form') {
      const buttons = node.find('button, input[type="submit"]');
      const buttonText = buttons.clone().find('*').append(' ').end().text();
      const buttonLabel = [buttonText, ...buttons.toArray().map(button => $(button).attr('value'))].join(' ');
      if (!PDF_LABEL.test(buttonLabel) && !DOWNLOAD_LABEL.test(buttonLabel)) return;
      if (NON_ARTICLE.test(buttonLabel) || (node.attr('method') ?? 'get').toLowerCase() !== 'get') return;
      const action = httpUrl(node.attr('action'), base);
      if (!action) return;
      node.find('input[type="hidden"][name]').each((_i, input) => {
        if ($(input).attr('disabled') === undefined) action.searchParams.append($(input).attr('name')!, $(input).attr('value') ?? '');
      });
      add(action.href, 70);
    }
  });
  return { urls: [...candidates].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([url]) => url) };
}
