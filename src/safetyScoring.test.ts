import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  areVisitorTipsConcise,
  buildVisitorTips,
  dedupeIncidents,
  describeMatchedPlace,
  findMatchingArticle,
  MAX_ARTICLE_AGE_DAYS,
  mergeIncidents,
  parseRecencyTextToDays,
  preprocessAndClassifyHeadline,
  recencyMultiplierFromDays,
  recencyMultiplierFromText,
  scoreIncidents,
  type RawFeedArticle,
} from './safetyScoring';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toUTCString();

function article(overrides: Partial<RawFeedArticle>): RawFeedArticle {
  return {
    title: 'Man stabbed near Pettah bus stand',
    pubDate: daysAgo(1),
    sourceName: 'Ada Derana News',
    sourceType: 'Local News',
    link: 'https://www.adaderana.lk/news/1',
    daysAgo: 1,
    recencyText: '1 day ago',
    matchedZone: 'Within 200m · Pettah',
    ...overrides,
  };
}

describe('preprocessAndClassifyHeadline keyword matching', () => {
  it('does not treat "skilled" as "killed"', () => {
    const result = preprocessAndClassifyHeadline('Skilled workers stage protest in Pettah');
    assert.equal(result.isCrime, false);
    assert.equal(result.csw, 0);
  });

  it('does not treat "screenshot" as "shot"', () => {
    const result = preprocessAndClassifyHeadline('Minister shares screenshot of letter in Colombo');
    assert.equal(result.isCrime, false);
  });

  it('still matches inflected crime words', () => {
    const murdered = preprocessAndClassifyHeadline('Two murdered in Kotahena overnight');
    assert.equal(murdered.crime_type, 'Violent');
    assert.equal(murdered.csw, 12);

    const shots = preprocessAndClassifyHeadline('Shots fired near Borella junction, police investigating');
    assert.equal(shots.crime_type, 'Violent');
    assert.equal(shots.csw, 10);
  });

  it('classifies property and minor crimes', () => {
    assert.equal(preprocessAndClassifyHeadline('House burglary reported in Wellawatte').csw, 5);
    assert.equal(preprocessAndClassifyHeadline('Armed robbery at Maradana jewellery shop').crime_type, 'Violent');
    assert.equal(preprocessAndClassifyHeadline('Phone theft on Galle Road bus').crime_type, 'Theft');
  });
});

describe('recency text parsing', () => {
  it('does not read "11 days ago" or "21 days ago" as under a week', () => {
    assert.equal(parseRecencyTextToDays('11 days ago'), 11);
    assert.equal(recencyMultiplierFromText('11 days ago'), 0.7);
    assert.equal(recencyMultiplierFromText('21 days ago'), 0.7);
  });

  it('maps each age band to the documented multiplier', () => {
    assert.equal(recencyMultiplierFromText('2 hours ago'), 1.0);
    assert.equal(recencyMultiplierFromText('yesterday'), 1.0);
    assert.equal(recencyMultiplierFromText('3 days ago'), 1.0);
    assert.equal(recencyMultiplierFromText('a week ago'), 1.0);
    assert.equal(recencyMultiplierFromText('2 weeks ago'), 0.7);
    assert.equal(recencyMultiplierFromText('2 months ago'), 0.4);
    assert.equal(recencyMultiplierFromText('4 months ago'), 0.1);
    assert.equal(recencyMultiplierFromText('6 months ago'), 0.1);
  });

  it('puts the band edges at 7, 30, 90 and 180 days', () => {
    assert.equal(recencyMultiplierFromDays(7), 1.0);
    assert.equal(recencyMultiplierFromDays(8), 0.7);
    assert.equal(recencyMultiplierFromDays(30), 0.7);
    assert.equal(recencyMultiplierFromDays(31), 0.4);
    assert.equal(recencyMultiplierFromDays(90), 0.4);
    assert.equal(recencyMultiplierFromDays(91), 0.1);
    assert.equal(recencyMultiplierFromDays(MAX_ARTICLE_AGE_DAYS), 0.1);
  });

  it('drops Gemini-only incidents older than 180 days', () => {
    const incidents = mergeIncidents(
      [
        { description: 'Shop burglary on Main Street Pettah', recency: '6 months ago' },
        { description: 'Man murdered near Pettah market', recency: '7 months ago' },
        { description: 'Stabbing outside Pettah bus stand', recency: '1 year ago' },
      ],
      [],
      'Pettah'
    );
    assert.deepEqual(
      incidents.map((i) => i.description),
      ['Shop burglary on Main Street Pettah']
    );
  });

  it('defaults unparseable text to 0.7', () => {
    assert.equal(parseRecencyTextToDays('recently'), null);
    assert.equal(recencyMultiplierFromText('recently'), 0.7);
  });

  it('scores an 11-day-old murder from Gemini as Moderate Risk, not High Risk', () => {
    const incidents = mergeIncidents(
      [{ description: 'Man murdered near Pettah market', recency: '11 days ago', source_type: 'Local News' }],
      [],
      'Pettah'
    );
    assert.equal(incidents[0].calculated_penalty, 8.4);
    const score = scoreIncidents(incidents);
    assert.equal(score.safety_rating, 3.3);
    assert.equal(score.risk_level, 'Moderate Risk');
  });
});

describe('mergeIncidents', () => {
  const stabbings = [
    article({ title: 'Man stabbed near Pettah bus stand', link: 'https://a.lk/1' }),
    article({ title: 'Trader stabbed on Main Street Pettah', link: 'https://a.lk/2' }),
    article({ title: 'Youth stabbed outside Pettah market', link: 'https://a.lk/3' }),
  ];

  it('keeps every verified article when Gemini mentions only one of them', () => {
    const incidents = mergeIncidents(
      [{ description: 'A man was stabbed near the Pettah bus stand', recency: '1 day ago' }],
      stabbings,
      'Pettah'
    );
    assert.equal(incidents.length, 3);
    const score = scoreIncidents(incidents);
    assert.equal(score.total_penalty, 30);
    assert.equal(score.safety_rating, 1.0);
    assert.equal(score.risk_level, 'High Risk');
  });

  it('adds incidents Gemini found that are not among the verified articles', () => {
    const incidents = mergeIncidents(
      [{ description: 'Chain snatching reported at Fort railway station', recency: '2 days ago' }],
      stabbings,
      'Pettah'
    );
    assert.equal(incidents.length, 4);
  });

  it('takes source details from the matching article, not by array position', () => {
    const robbery = article({
      title: 'Robbery at Pettah jewellery shop',
      sourceName: 'Ada Derana News',
      link: 'https://www.adaderana.lk/news/robbery',
      matchedZone: 'Within 200m · Pettah',
    });
    const theft = article({
      title: 'Phone theft reported on Olcott Mawatha',
      sourceName: 'Daily Mirror',
      link: 'https://www.dailymirror.lk/news/theft',
      matchedZone: 'Within 200m · Olcott Mawatha',
    });

    // Gemini returned [film-shoot item, theft]; the film item is filtered out
    // before merging, so the theft incident ends up at index 0.
    const incidents = mergeIncidents(
      [{ description: 'Phone theft reported on Olcott Mawatha' }],
      [robbery, theft],
      'Pettah'
    );

    const theftIncident = incidents.find((i) => i.description.includes('Phone theft'));
    assert.ok(theftIncident);
    assert.equal(theftIncident.source_name, 'Daily Mirror');
    assert.equal(theftIncident.source_url, 'https://www.dailymirror.lk/news/theft');
    assert.equal(theftIncident.matched_zone, 'Within 200m · Olcott Mawatha');
    assert.equal(incidents.length, 2);
  });

  it('does not borrow article details for a Gemini-only incident', () => {
    const [, extra] = mergeIncidents(
      [{ description: 'Chain snatching reported at Fort railway station' }],
      [article({ sourceName: 'Ada Derana News', link: 'https://www.adaderana.lk/news/1' })],
      'Pettah'
    );
    assert.equal(extra.source_name, 'Local News');
    assert.equal(extra.source_url, undefined);
  });
});

describe('findMatchingArticle', () => {
  it('matches by source URL', () => {
    const art = article({ link: 'https://www.newswire.lk/x' });
    assert.equal(findMatchingArticle({ description: 'unrelated', source_url: 'https://www.newswire.lk/x' }, [art]), art);
  });

  it('does not match unrelated incidents', () => {
    const art = article({ title: 'Man stabbed near Pettah bus stand' });
    assert.equal(findMatchingArticle({ description: 'Burglary at Dehiwala house' }, [art]), undefined);
  });
});

describe('scoreIncidents', () => {
  it('returns 5.0 Safe with no incidents', () => {
    assert.deepEqual(scoreIncidents([]), { total_penalty: 0, safety_rating: 5.0, risk_level: 'Safe' });
  });
});

describe('visitor tips', () => {
  it('leads with advice for the most common crime type', () => {
    const incidents = [
      mergeIncidents([], [article({ title: 'Phone theft on Galle Road bus' })], 'Pettah')[0],
      mergeIncidents([], [article({ title: 'Pickpocket arrested at Pettah bus stand' })], 'Pettah')[0],
      mergeIncidents([], [article({ title: 'Man stabbed near Pettah bus stand' })], 'Pettah')[0],
    ];
    const tips = buildVisitorTips(incidents);
    assert.equal(tips.length, 3);
    assert.match(tips[0], /phone and wallet/);
    assert.match(tips[1], /alone/);
  });

  it('gives reassuring tips when no crimes were found', () => {
    assert.match(buildVisitorTips([])[0], /No recent crimes/);
  });

  it('keeps every built-in tip short', () => {
    assert.ok(areVisitorTipsConcise(buildVisitorTips([])));
  });

  it('rejects missing or wordy model tips', () => {
    assert.equal(areVisitorTipsConcise(undefined), false);
    assert.equal(areVisitorTipsConcise([]), false);
    assert.equal(
      areVisitorTipsConcise([
        'High-risk 200m zone: 1 verified violent incident(s) reported on adjacent corridors near Pettah, Colombo. Avoid unlit blocks late at night.',
      ]),
      false
    );
    assert.equal(areVisitorTipsConcise(['Avoid walking alone here late at night.']), true);
  });
});

describe('describeMatchedPlace', () => {
  const search = 'Pettah Colombo Sri Lanka';

  it('uses the place named in the headline', () => {
    assert.equal(
      describeMatchedPlace('Suspect arrested over damage to newly reopened Pettah Bus Stand - Daily Mirror', search),
      'Pettah Bus Stand'
    );
    assert.equal(
      describeMatchedPlace('Suspect arrested over damage to Pettah Central Bus Stand facilities', search),
      'Pettah Central Bus Stand'
    );
  });

  it('includes lowercase place words', () => {
    assert.equal(describeMatchedPlace('Man stabbed near Pettah bus stand', search), 'Pettah Bus Stand');
  });

  it('does not run on into the rest of a title-case headline', () => {
    assert.equal(describeMatchedPlace('Pettah Police Arrest Pickpocket', search), 'Pettah');
    assert.equal(describeMatchedPlace('Fire in Pettah, traders evacuated', search), 'Pettah');
  });

  it('falls back to the main word of the search, not the full search text', () => {
    assert.equal(describeMatchedPlace('Chain snatching reported nearby', search), 'Pettah');
  });
});

describe('dedupeIncidents', () => {
  const incidentFor = (title: string, recency = '6 months ago') => ({
    ...mergeIncidents([], [article({ title, recencyText: recency, matchedZone: 'Within 200m · Pettah Bus Stand' })], 'Pettah')[0],
    recency,
  });

  it('merges several outlets reporting the same incident', () => {
    const incidents = dedupeIncidents(
      [
        incidentFor('Suspect arrested over damage to newly reopened Pettah Bus Stand - Daily Mirror'),
        incidentFor('Suspect arrested over damage to Pettah Central Bus Stand facilities'),
        incidentFor('Suspect arrested for damaging property at renovated Pettah Central Bus Stand'),
      ],
      'Pettah, Colombo'
    );
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].report_count, 3);
  });

  it('keeps different crimes at the same place separate', () => {
    const incidents = dedupeIncidents(
      [incidentFor('Phone stolen at Pettah Bus Stand'), incidentFor('Bag stolen at Pettah Bus Stand')],
      'Pettah, Colombo'
    );
    assert.equal(incidents.length, 2);
  });

  it('keeps similar reports from different times separate', () => {
    const incidents = dedupeIncidents(
      [
        incidentFor('Suspect arrested over damage to Pettah Bus Stand', '2 weeks ago'),
        incidentFor('Suspect arrested over damage to Pettah Bus Stand', '6 months ago'),
      ],
      'Pettah, Colombo'
    );
    assert.equal(incidents.length, 2);
  });

  it('scores a merged incident once', () => {
    const one = incidentFor('Suspect arrested over damage to Pettah Bus Stand');
    const merged = dedupeIncidents([one, incidentFor('Suspect arrested over damage to Pettah Central Bus Stand facilities')], 'Pettah');
    assert.deepEqual(scoreIncidents(merged), scoreIncidents([one]));
  });
});

describe('crime type classification', () => {
  const classify = (title: string) => preprocessAndClassifyHeadline(title);

  it('does not count accidents as crimes', () => {
    assert.equal(classify('Tractor driver killed, two injured in Kandy crash').isCrime, false);
    assert.equal(classify('Two dead after bus collided with lorry near Kadawatha').isCrime, false);
  });

  it('still counts deliberate harm that mentions a crash', () => {
    assert.equal(classify('Driver stabbed after crash in Pettah').crime_type, 'Violent');
  });

  it('labels assaults as violent, not burglary', () => {
    assert.equal(
      classify('Student hospitalised after being assaulted by prefects of a leading Kandy school').crime_type,
      'Violent'
    );
  });

  it('labels robbery and extortion as theft, burglary as burglary', () => {
    assert.equal(classify('Shop robbed in Maradana').crime_type, 'Theft');
    assert.equal(classify("Police uncover real story behind viral 'extortion' video").crime_type, 'Theft');
    assert.equal(classify('House burglary reported in Wellawatte').crime_type, 'Burglary');
  });

  it('labels property damage as nuisance', () => {
    assert.equal(classify('Suspect arrested over damage to newly reopened Pettah Bus Stand').crime_type, 'Nuisance');
  });

  it('does not treat a vague arrest as a crime', () => {
    assert.equal(classify('Suspect arrested for obstructing police duties during Kandy Esala procession').isCrime, false);
  });
});
