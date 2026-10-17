import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleLinks } from './article-links';
import { resolvePdf } from './resolve-pdf';
import { fetchResource } from './pdf';

const page = 'https://journal.example/article/123';

test('finds nested repository download buttons and literal data URLs without a PDF extension', () => {
  assert.deepEqual(articleLinks(`
    <a href="/retrieve/123" aria-label="Download full text"><span>Download</span><b>PDF</b></a>
    <button data-download-url="/file/456" title="Open PDF"><span>Read</span></button>
    <a role="button" data-href="/file/789"><span>Download document</span></a>
    <a href="/file/100" download="manuscript.pdf">Download</a>
  `, page).urls, [
    'https://journal.example/file/100', 'https://journal.example/retrieve/123',
    'https://journal.example/file/456', 'https://journal.example/file/789',
  ]);
});

test('finds object, embed and labelled iframe PDFs even when their URLs lack file extensions', () => {
  assert.deepEqual(articleLinks(`
    <object type="application/pdf" data="/content/1"></object>
    <embed type="application/pdf; charset=binary" src="/content/2">
    <iframe title="Article PDF" src="/content/3"></iframe>
    <iframe title="PDF" data-src="/content/4"></iframe>
    <iframe title="Advertising" src="https://ads.example/embed"></iframe>
  `, page).urls, [1, 2, 3, 4].map(id => `https://journal.example/content/${id}`));
});

test('unwraps encoded PDF.js, nested and Google document viewer links', () => {
  const file = 'https://repository.example/download?id=42&format=pdf';
  const inner = `https://viewer.example/pdfjs/web/viewer.html?file=${encodeURIComponent(file)}`;
  for (const viewer of [inner, `https://docs.google.com/gview?url=${encodeURIComponent(file)}&embedded=true`,
    `https://viewer.example/viewer?url=${encodeURIComponent(inner)}`]) {
    assert.deepEqual(articleLinks(`<iframe src="${viewer.replace(/&/g, '&amp;')}"></iframe>`, page).urls, [file]);
  }
  assert.deepEqual(articleLinks('<iframe src="/pdfjs/web/viewer.html?file=..%2Farticle-data%3Fid%3D42"></iframe>', page).urls,
    ['https://journal.example/pdfjs/article-data?id=42']);
});

test('recognizes observed OJS, DSpace, Digital Commons and journal PDF download routes', () => {
  const routes = [
    '/index.php/journal/article/download/123/456', '/bitstreams/abc/download',
    '/server/api/core/bitstreams/abc/content', '/cgi/viewcontent.cgi?article=123&context=journal',
    '/ndownloader/files/123', '/doi/pdf/10.1234/test', '/doi/epdf/10.1234/test',
    '/science/article/pii/S12345/pdfft',
  ];
  for (const route of routes) {
    assert.deepEqual(articleLinks(`<a href="${route}">File</a>`, page).urls, [`https://journal.example${route}`]);
  }
  assert.deepEqual(articleLinks('<iframe src="/index.php/journal/article/view/123/456"></iframe>', page).urls,
    ['https://journal.example/index.php/journal/article/view/123/456']);
});

test('honors base URLs, decodes named HTML entities and preserves signed query parameters', () => {
  assert.deepEqual(articleLinks(`
    <base href="https://repository.example/files/">
    <a href="download?id=42&amp;token=a%2Bb%3D&amp;lang=fr" download="article.pdf">PDF</a>
    <button data-url="file&quest;id=99" aria-label="Download PDF"></button>
  `, page).urls, [
    'https://repository.example/files/download?id=42&token=a%2Bb%3D&lang=fr',
    'https://repository.example/files/file?id=99',
  ]);
});

test('ranks article metadata over generic downloads and excludes citations, data and supplements', () => {
  assert.deepEqual(articleLinks(`
    <a href="/export">Download citation PDF</a>
    <a href="/dataset">Download dataset</a>
    <a href="/all">Download all files</a>
    <a href="/files.zip">Download PDF</a>
    <div class="supplementary"><a href="/appendix.pdf">PDF</a></div>
    <a href="/generic-download">Download</a>
    <a href="/article.pdf">PDF</a>
    <a href="/content">Read full text</a>
    <meta name="citation_pdf_url" content="/main-pdf">
    <meta name="citation_pdf_url" content="/main-pdf#page=2">
    <a href="/other-download">Download</a>
  `, page).urls, [
    'https://journal.example/main-pdf', 'https://journal.example/article.pdf',
    'https://journal.example/generic-download', 'https://journal.example/content',
  ]);
});

test('supports explicit GET download forms and skips POST forms and arbitrary scripts', () => {
  assert.deepEqual(articleLinks(`
    <form action="/download?format=pdf" method="GET">
      <input type="hidden" name="article" value="42">
      <input type="hidden" name="token" value="a&amp;b">
      <input type="hidden" name="skip" value="yes" disabled>
      <button type="submit"><span>Download PDF</span></button>
    </form>
    <form action="/purchase" method="POST"><button>Download PDF</button></form>
    <script>const fake='<a href="/fake.pdf">PDF</a>';</script>
    <!-- <a href="/comment.pdf">PDF</a> -->
    <button onclick="location.href='/script.pdf'">Download PDF</button>
  `, page).urls, ['https://journal.example/download?format=pdf&article=42&token=a%26b']);
});

test('discards unsafe viewer schemes, credentials, fragments and oversized URLs', () => {
  assert.deepEqual(articleLinks(`
    <iframe src="/viewer.html?file=javascript%3Aalert(1)"></iframe>
    <object type="application/pdf" data="file:///etc/passwd"></object>
    <a href="https://user:password@repository.example/download">PDF</a>
    <a href="#pdf">Download PDF</a>
    <a href="data:application/pdf;base64,abc">PDF</a>
    <a href="/${'a'.repeat(4096)}">PDF</a>
  `, page).urls, []);
});

test('resolves article to journal viewer to actual PDF within the reserved publisher attempts', async () => {
  const calls: string[] = [];
  const load: typeof fetchResource = async url => {
    calls.push(url);
    const text = calls.length === 1 ? '<a href="/article/view/123/456"><span>PDF</span></a>'
      : calls.length === 2 ? '<iframe src="/pdfjs/viewer.html?file=%2Farticle%2Fdownload%2F123%2F456"></iframe>'
        : '%PDF-1.4\nfixture\n%%EOF';
    return { bytes: Buffer.from(text), url };
  };
  const result = await resolvePdf(page, new AbortController().signal, { load, externalIds: { ArXiv: '2403.13193' } });
  assert.equal(result.url, 'https://journal.example/article/download/123/456');
  assert.equal(calls.length, 3);
});

test('new embedded and download-button URLs retain private-network protections', async () => {
  const snippets = [
    '<iframe src="/viewer.html?file=http%3A%2F%2F127.0.0.1%2Fprivate"></iframe>',
    '<button data-url="http://169.254.169.254/latest/meta-data/">Download PDF</button>',
    '<base href="http://10.0.0.1/"><a href="private">PDF</a>',
  ];
  for (const html of snippets) {
    const load: typeof fetchResource = async (url, signal) => url === page
      ? { bytes: Buffer.from(html), url } : fetchResource(url, signal);
    await assert.rejects(resolvePdf(page, new AbortController().signal, { load }), /Private or reserved/);
  }
});
