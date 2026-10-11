import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractArticleText, findIncidentDateInText, isPlausibleIncidentDate } from './articleDates';

// Thursday 9 April 2026
const PUBLISHED = '2026-04-09T08:30:00Z';

describe('extractArticleText', () => {
  it('keeps article paragraphs and drops scripts and boilerplate', () => {
    const html = `
      <script>var x = 1;</script>
      <p>Share</p>
      <p>Colombo, April 12 (Daily Mirror) - A suspect has been arrested in connection with damage at the Pettah Central Bus Stand.</p>
      <p>function toggle() { var dataurl = 'article_id=' + article_id; xhttp.send(dataurl); }</p>
      <p>Officers also recovered a portion of the stolen items from the suspect&rsquo;s possession.</p>`;
    const text = extractArticleText(html);
    assert.match(text, /A suspect has been arrested/);
    assert.match(text, /suspect’s possession/);
    assert.doesNotMatch(text, /function|Share/);
  });
});

describe('findIncidentDateInText', () => {
  it('reads relative days from the opening sentence', () => {
    assert.equal(findIncidentDateInText('A man was stabbed in Pettah yesterday.', PUBLISHED), '2026-04-08');
    assert.equal(findIncidentDateInText('Two houses were burgled last night in Wellawatte.', PUBLISHED), '2026-04-08');
    assert.equal(findIncidentDateInText('A shop was robbed this morning in Maradana.', PUBLISHED), '2026-04-09');
  });

  it('reads a weekday as the most recent one before publishing', () => {
    assert.equal(findIncidentDateInText('A woman was attacked on Monday near Fort station.', PUBLISHED), '2026-04-06');
  });

  it('reads the Sri Lankan "on Monday (6)" style', () => {
    assert.equal(findIncidentDateInText('A man was shot dead on Monday (6) in Kotahena.', PUBLISHED), '2026-04-06');
  });

  it('reads explicit dates, in either order', () => {
    assert.equal(findIncidentDateInText('The robbery took place on April 2 at a jewellery shop.', PUBLISHED), '2026-04-02');
    assert.equal(findIncidentDateInText('The robbery took place on the 2nd of April at a shop.', PUBLISHED), '2026-04-02');
  });

  it('puts a month after the publish month in the previous year', () => {
    assert.equal(findIncidentDateInText('The theft happened on December 20 at Pettah market.', PUBLISHED), '2025-12-20');
  });

  it('ignores the dateline, which is the publish date', () => {
    assert.equal(
      findIncidentDateInText('Colombo, April 9 (Daily Mirror) - A suspect was arrested over damage at the bus stand.', PUBLISHED),
      null
    );
  });

  it('takes the earliest date when the crime and the arrest are both mentioned', () => {
    assert.equal(
      findIncidentDateInText('A man stabbed on April 3 in Pettah was found, and the suspect was arrested on April 7.', PUBLISHED),
      '2026-04-03'
    );
  });

  it('only looks at the opening sentences', () => {
    assert.equal(
      findIncidentDateInText('A suspect was arrested over damage at the bus stand. Police said. The stand reopened on April 1.', PUBLISHED),
      null
    );
  });

  it('returns null when no time is stated', () => {
    assert.equal(findIncidentDateInText('Police are investigating a robbery in Borella.', PUBLISHED), null);
  });
});

describe('isPlausibleIncidentDate', () => {
  it('rejects dates after publishing or over a year before', () => {
    assert.equal(isPlausibleIncidentDate('2026-04-09', PUBLISHED), true);
    assert.equal(isPlausibleIncidentDate('2026-04-10', PUBLISHED), false);
    assert.equal(isPlausibleIncidentDate('2025-03-01', PUBLISHED), false);
    assert.equal(isPlausibleIncidentDate('not a date', PUBLISHED), false);
  });
});
