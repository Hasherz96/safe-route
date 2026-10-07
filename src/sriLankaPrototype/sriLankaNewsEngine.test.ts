import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPublishDateFromHtml } from './sriLankaNewsEngine';

describe('extractPublishDateFromHtml', () => {
  it('reads JSON-LD datePublished (Ada Derana article pages)', () => {
    const html =
      '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-07T16:02:39.617Z","dateModified":"2026-10-07T16:37:45.665Z"}</script>';
    assert.equal(extractPublishDateFromHtml(html), '2026-10-07T16:02:39.617Z');
  });

  it('reads the article:published_time meta tag in either attribute order', () => {
    assert.equal(
      extractPublishDateFromHtml('<meta property="article:published_time" content="2026-10-01T08:00:00+05:30">'),
      '2026-10-01T02:30:00.000Z'
    );
    assert.equal(
      extractPublishDateFromHtml('<meta content="2026-10-01T08:00:00+05:30" property="article:published_time" />'),
      '2026-10-01T02:30:00.000Z'
    );
  });

  it('falls back to a <time datetime> element', () => {
    assert.equal(
      extractPublishDateFromHtml('<time class="pub" datetime="2026-09-30T12:00:00Z">30 Sep</time>'),
      '2026-09-30T12:00:00.000Z'
    );
  });

  it('skips unparseable candidates and returns null when nothing is found', () => {
    assert.equal(
      extractPublishDateFromHtml('"datePublished":"not a date" <time datetime="2026-09-30T12:00:00Z">'),
      '2026-09-30T12:00:00.000Z'
    );
    assert.equal(extractPublishDateFromHtml('<html><body>No dates here</body></html>'), null);
  });
});
