import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  distinctivePlaceWords,
  extractPublishDateFromHtml,
  fuzzyLocalityMatch,
  hasDistinctivePlaceWord,
  isBroadAreaName,
} from './sriLankaNewsEngine';

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

describe('fuzzyLocalityMatch', () => {
  const kalutaraHeadline = "More details emerge in Kalutara restaurant owner's murder";

  it('does not match on a generic word like "restaurant"', () => {
    assert.equal(fuzzyLocalityMatch(kalutaraHeadline, 'Devon Restaurant'), false);
  });

  it('does not match the search name on generic words like "city" or "centre"', () => {
    assert.equal(fuzzyLocalityMatch('Fire at Galle city centre shop', 'Kandy City Centre'), false);
  });

  it('still matches when the distinctive part of the name appears', () => {
    assert.equal(fuzzyLocalityMatch('Robbery at Devon restaurant in Kandy', 'Devon Restaurant'), true);
    assert.equal(fuzzyLocalityMatch('Pickpocket arrested at Pettah bus stand', 'Pettah'), true);
  });

  it('still tolerates small spelling differences', () => {
    assert.equal(fuzzyLocalityMatch('Theft reported on Olcot Mawatha', 'Olcott Mawatha'), true);
  });
});

describe('city-wide mentions are not a 200m match', () => {
  it('does not match a story that only names the city', () => {
    assert.equal(fuzzyLocalityMatch('Tractor driver killed, two injured in Kandy crash', 'Kandy City Centre'), false);
    assert.equal(fuzzyLocalityMatch('23-year-old woman found dead in Kandy', 'Kandy'), false);
    assert.equal(fuzzyLocalityMatch('Man stabbed near Kandy clock tower', 'Kandy City Centre'), false);
  });

  it('still matches the full place name as a phrase', () => {
    assert.equal(fuzzyLocalityMatch('Robbery reported at Kandy City Centre mall', 'Kandy City Centre'), true);
  });

  it('still matches neighbourhoods and streets', () => {
    assert.equal(fuzzyLocalityMatch('Pickpocket arrested at Pettah bus stand', 'Pettah'), true);
    assert.equal(fuzzyLocalityMatch('Chain snatched on Dalada Veediya', 'Sri Dalada Veediya'), true);
  });

  it('identifies broad area names', () => {
    assert.equal(isBroadAreaName('Kandy'), true);
    assert.equal(isBroadAreaName('Colombo'), true);
    assert.equal(isBroadAreaName('Pettah'), false);
    assert.deepEqual(distinctivePlaceWords('Kandy City Centre'), []);
    assert.deepEqual(distinctivePlaceWords('Devon Restaurant'), ['devon']);
  });
});

describe('surnames are not place names', () => {
  const headline = 'MP Sujith Sanjay Perera refutes assault allegations by MP Archchuna Ramanathan';

  it('does not match a person named in the headline to a business named after them', () => {
    assert.equal(fuzzyLocalityMatch(headline, 'P&S (Perera & Sons) - Ragama Town'), false);
    assert.equal(fuzzyLocalityMatch(headline, 'Perera'), false);
    assert.equal(hasDistinctivePlaceWord('Perera'), false);
  });

  it('still matches the real locality in the name', () => {
    assert.equal(fuzzyLocalityMatch('Shop robbed in Ragama town', 'Ragama'), true);
    assert.deepEqual(distinctivePlaceWords('P&S (Perera & Sons) - Ragama Town'), ['ragama']);
    assert.equal(fuzzyLocalityMatch('Father and two sons arrested over assault', 'Silva & Sons'), false);
  });

  it('still matches a street named after a person by its full name', () => {
    assert.equal(fuzzyLocalityMatch('Man stabbed on Perera Mawatha last night', 'Perera Mawatha'), true);
    assert.equal(fuzzyLocalityMatch(headline, 'Perera Mawatha'), false);
  });
});
