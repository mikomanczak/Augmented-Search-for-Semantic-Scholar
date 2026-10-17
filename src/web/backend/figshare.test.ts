import assert from 'node:assert/strict';
import { test } from 'node:test';
import { figshareArticleId, figshareSources } from './figshare';
import { resolvePdf } from './resolve-pdf';
import { fetchResource, PdfError } from './pdf';

test('identifies Figshare articles only on Figshare hosts', () => {
  assert.equal(figshareArticleId('https://cispa.figshare.com/articles/conference_contribution/Title/24614718'), '24614718');
  assert.equal(figshareArticleId('https://figshare.com/articles/123/versions/2'), '123');
  for (const url of ['https://evilfigshare.com/articles/123', 'https://figshare.com.evil.example/articles/123', 'https://figshare.com/files/123']) assert.equal(figshareArticleId(url), undefined);
});

test('skips embargoed, unrelated, and non-PDF Figshare files', async () => {
  const files = [{name:'article.pdf',download_url:'https://ndownloader.figshare.com/files/1'},
    {name:'data.zip',download_url:'https://ndownloader.figshare.com/files/2'},
    {name:'link.pdf',is_link_only:true,download_url:'https://example.org/file.pdf'}];
  for (const [id, embargoed, expected] of [[123,false,1],[456,false,0],[123,true,0]] as const) {
    const load: typeof fetchResource = async url => ({url,bytes:Buffer.from(JSON.stringify({id,is_embargoed:embargoed,files}))});
    assert.equal((await figshareSources('123',new AbortController().signal,load)).length,expected);
  }
});

test('uses the public file API when the Figshare article page refuses access', async () => {
  const load: typeof fetchResource = async url => {
    if (url.includes('api.figshare.com')) return {url,bytes:Buffer.from(JSON.stringify({id:123,is_embargoed:false,files:[{name:'paper.pdf',download_url:'https://ndownloader.figshare.com/files/1'}]}))};
    if (url.includes('ndownloader')) return {url,bytes:Buffer.from('%PDF-1.4\nfixture')};
    throw new PdfError('Publisher returned HTTP 403.',422,403);
  };
  assert.equal((await resolvePdf('https://cispa.figshare.com/articles/conference_contribution/Paper/123',new AbortController().signal,{load})).url,'https://ndownloader.figshare.com/files/1');
});

test('Figshare API file URLs retain private-network protection', async () => {
  const load: typeof fetchResource = async (url,signal) => {
    if (url.includes('api.figshare.com')) return {url,bytes:Buffer.from(JSON.stringify({id:123,is_embargoed:false,files:[{name:'paper.pdf',download_url:'http://127.0.0.1/private.pdf'}]}))};
    if (url.includes('127.0.0.1')) return fetchResource(url,signal);
    throw new PdfError('Publisher returned HTTP 403.',422,403);
  };
  await assert.rejects(resolvePdf('https://figshare.com/articles/Paper/123',new AbortController().signal,{load}),/Private or reserved/);
});
