/**
 * ============================================================================
 * SRI LANKA REGIONAL PROTOTYPE MODULE (ISOLATED & REMOVABLE)
 * ============================================================================
 * Encapsulates all Sri Lanka national news outlet crime querying, source
 * verification, and 200m neighborhood matching.
 *
 * To disable or remove this Sri Lanka optimization later:
 *   1. Set `ENABLE_SRI_LANKA_PROTOTYPE = false` in `sriLankaConfig.ts`, OR
 *   2. Delete the `src/sriLankaPrototype/` folder and its imports.
 * ============================================================================
 */

import {
  SRI_LANKA_NATIONAL_OUTLETS,
  SRI_LANKA_LOCALITY_TRANSLITERATIONS,
  type NationalNewsOutlet,
} from './sriLankaConfig';

/**
 * Matches an article's source name, URL, or headline suffix against the 13
 * designated Sri Lankan national news outlets:
 * Ada Derana News, Sirasa Newsfirst, Daily Mirror, NewsWire, Sunday Times,
 * Hiru TV, Siyatha TV, Daily News, Rupavahini News, Swarnawahini News,
 * island.lk, ITN News, government news.lk
 */
export function matchSriLankaNationalOutlet(
  sourceName: string,
  link: string = '',
  rawTitle: string = ''
): NationalNewsOutlet | null {
  const combined = `${sourceName} ${link} ${rawTitle}`.toLowerCase();

  for (const outlet of SRI_LANKA_NATIONAL_OUTLETS) {
    if (combined.includes(outlet.domain.toLowerCase())) {
      return outlet;
    }
    for (const alias of outlet.aliases) {
      if (combined.includes(alias.toLowerCase())) {
        return outlet;
      }
    }
  }
  return null;
}

/**
 * Fetches RSS items directly from designated Sri Lanka national news outlet RSS endpoints.
 * Solves the issue where Google News RSS search fails to index local neighborhood articles.
 */
export async function fetchDirectSriLankaRssFeeds(): Promise<
  { title: string; pubDate: string; sourceName: string; link: string }[]
> {
  const results: { title: string; pubDate: string; sourceName: string; link: string }[] = [];

  const fetchPromises = SRI_LANKA_NATIONAL_OUTLETS.filter((o) => Boolean(o.rssUrl)).map(
    async (outlet) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(outlet.rssUrl!, {
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 SafeRoute/1.0',
          },
        });
        clearTimeout(timeout);

        if (!res.ok) return;
        const xml = await res.text();
        const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

        for (const m of itemMatches.slice(0, 20)) {
          const block = m[1];
          const rawTitle = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '')
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .trim();
          const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
          const link = (block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '')
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .trim();

          const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
          if (cleanTitle) {
            results.push({
              title: cleanTitle,
              pubDate,
              sourceName: outlet.displayName,
              link: link || `https://${outlet.domain}`,
            });
          }
        }
      } catch {
        // Silently skip individual direct RSS feed errors/timeouts
      }
    }
  );

  await Promise.allSettled(fetchPromises);
  return results;
}

/**
 * Extracts an article's publish date from its HTML page, checking JSON-LD
 * `datePublished`, the `article:published_time` meta tag, then `<time datetime>`.
 * Returns an ISO date string, or null if none is found.
 */
export function extractPublishDateFromHtml(html: string): string | null {
  const candidates = [
    html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1],
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i)?.[1],
    html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1],
  ];
  for (const c of candidates) {
    if (c && !Number.isNaN(Date.parse(c))) return new Date(c).toISOString();
  }
  return null;
}

// Publish dates never change, so remember them per URL across requests
const publishDateCache = new Map<string, string | null>();
const PUBLISH_DATE_CACHE_LIMIT = 500;

/**
 * Fetches an article page to read its publish date, for outlet feeds whose
 * items have no <pubDate> (e.g. Ada Derana). Returns null on failure.
 */
export async function fetchArticlePublishDate(url: string): Promise<string | null> {
  if (!url) return null;
  if (publishDateCache.has(url)) return publishDateCache.get(url)!;

  let date: string | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 SafeRoute/1.0',
      },
    });
    clearTimeout(timeout);
    if (res.ok) date = extractPublishDateFromHtml(await res.text());
  } catch {
    // Timeouts and network errors leave the date unknown
    return null;
  }

  if (publishDateCache.size >= PUBLISH_DATE_CACHE_LIMIT) {
    publishDateCache.delete(publishDateCache.keys().next().value!);
  }
  publishDateCache.set(url, date);
  return date;
}

/**
 * Calculates Levenshtein Distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Performs fuzzy locality matching between a crime headline and a target locality token/name.
 * Accounts for Sinhala transliterations, sub-token overlap, and minor spelling differences.
 *
 * Only distinctive words count: generic place words ("Restaurant", "Centre") and
 * whole-city names ("Kandy", "Colombo") say nothing about whether a story happened
 * within 200m. A name made only of such words ("Kandy City Centre") must appear
 * as an exact phrase.
 */
export function fuzzyLocalityMatch(headline: string, targetLocality: string): boolean {
  const lowerHeadline = headline.toLowerCase();
  const lowerTarget = targetLocality.toLowerCase().trim();
  if (!lowerTarget || lowerTarget.length < 3) return false;

  const targetWords = distinctivePlaceWords(lowerTarget);
  if (targetWords.length === 0) {
    return lowerTarget.split(/\s+/).length >= 2 && lowerHeadline.includes(lowerTarget);
  }

  // 1. Direct substring match
  if (lowerHeadline.includes(lowerTarget)) return true;

  // 2. Transliteration mapping check
  const altNames = SRI_LANKA_LOCALITY_TRANSLITERATIONS[lowerTarget] || [];
  for (const alt of altNames) {
    if (lowerHeadline.includes(alt.toLowerCase())) return true;
  }

  // 3. Every distinctive word of the name (e.g. "Devon" in "Devon Restaurant")
  // must match a headline word, allowing small spelling differences
  const headlineWords = lowerHeadline
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  return targetWords.every((tw) =>
    headlineWords.some(
      (hw) =>
        hw === tw ||
        (tw.length >= 5 && hw.length >= 5 && levenshteinDistance(tw, hw) <= 2)
    )
  );
}

// Place-type words that appear in many unrelated place names and headlines
const GENERIC_PLACE_WORDS = new Set([
  'restaurant', 'hotel', 'cafe', 'bakery', 'shop', 'store', 'stores', 'super',
  'supermarket', 'market', 'bank', 'branch', 'station', 'railway', 'police',
  'hospital', 'school', 'college', 'temple', 'kovil', 'church', 'mosque',
  'road', 'street', 'mawatha', 'lane', 'avenue', 'place', 'junction', 'park',
  'building', 'tower', 'centre', 'center', 'city', 'mall', 'plaza', 'house',
  'office', 'limited', 'company', 'pharmacy', 'salon', 'hall', 'ground',
  'grounds', 'stand', 'terminal', 'cross', 'main', 'central', 'north', 'south',
  'east', 'west', 'town', 'district', 'lake', 'beach', 'bridge', 'national',
  'province', 'sri', 'lanka',
  // Business-name words
  'sons', 'brothers', 'bros', 'enterprises', 'traders', 'trading', 'holdings',
  'private', 'industries', 'agency', 'agencies', 'services', 'group',
]);

// Cities and districts: a story that only names one of these could have
// happened anywhere in that city, so it is not evidence of a 200m match
const BROAD_AREA_NAMES = new Set([
  'colombo', 'kandy', 'galle', 'jaffna', 'negombo', 'kurunegala', 'matara',
  'anuradhapura', 'polonnaruwa', 'ratnapura', 'badulla', 'batticaloa',
  'trincomalee', 'kalutara', 'gampaha', 'hambantota', 'nuwara', 'eliya',
  'kegalle', 'puttalam', 'chilaw', 'ampara', 'vavuniya', 'mannar',
  'kilinochchi', 'mullaitivu', 'monaragala', 'moneragala', 'matale',
  'moratuwa', 'panadura', 'kalmunai', 'dambulla', 'bandarawela', 'hatton',
]);

// Common surnames: in a headline they almost always name a person ("MP Sujith
// Perera"), even when a place is named after one ("Perera & Sons", "Perera Mawatha")
const COMMON_SURNAMES = new Set([
  'perera', 'silva', 'fernando', 'fernandopulle', 'dias', 'mendis', 'peiris', 'pieris',
  'jayasinghe', 'jayasuriya', 'jayawardena', 'jayawardene', 'wickramasinghe',
  'wickremesinghe', 'wickremasinghe', 'rajapaksa', 'rajapakse', 'bandara',
  'dissanayake', 'dissanayaka', 'gunawardena', 'gunawardana', 'gunasekara',
  'gunasekera', 'senanayake', 'ranasinghe', 'herath', 'kumara', 'rathnayake',
  'ratnayake', 'karunaratne', 'weerasinghe', 'wijesinghe', 'wijeratne',
  'samarasinghe', 'liyanage', 'amarasinghe', 'abeysekera', 'abeysekara', 'premadasa',
  'kumaratunga', 'bandaranaike', 'munasinghe', 'nanayakkara', 'rodrigo', 'cooray',
  'soysa', 'pathirana', 'seneviratne', 'ekanayake', 'gamage', 'hettiarachchi',
  'edirisinghe', 'sirisena', 'ramanathan', 'mohamed', 'mohammed', 'ahamed',
]);

/** True for a whole city or district name such as "Kandy" or "Colombo". */
export function isBroadAreaName(name: string): boolean {
  const words = name.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => BROAD_AREA_NAMES.has(w) || GENERIC_PLACE_WORDS.has(w));
}

/**
 * Words of a place name that actually identify it, e.g. "devon" in "Devon
 * Restaurant". Excludes generic place words, city names and surnames.
 */
export function distinctivePlaceWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !GENERIC_PLACE_WORDS.has(w) &&
        !BROAD_AREA_NAMES.has(w) &&
        !COMMON_SURNAMES.has(w)
    );
}

/** True when a name has at least one word that pins down a specific place. */
export function hasDistinctivePlaceWord(name: string): boolean {
  return distinctivePlaceWords(name).length > 0;
}

/**
 * Extracts key Sri Lankan town/suburb/locality tokens from a place name and address
 * (e.g., "Pettah", "Dehiwala", "Bambalapitiya", "Colombo Fort", "Kandy", "Galle",
 * "Kotahena", "Borella", "Mount Lavinia", "Wellawatte", "Nugegoda", "Maradana").
 * Includes transliteration expansions.
 */
export function extractSriLankaLocalityTokens(
  locationName: string,
  address?: string
): string[] {
  const stopWords = new Set([
    'sri',
    'lanka',
    'province',
    'western',
    'central',
    'southern',
    'northern',
    'eastern',
    'railway',
    'station',
    'bus',
    'stand',
    'market',
    'floating',
    'shopping',
    'centre',
    'center',
    'mall',
    'hospital',
    'hotel',
    'beach',
    'park',
    'junction',
    'road',
    'rd',
    'street',
    'st',
    'mawatha',
    'mw',
    'veediya',
    'lane',
  ]);

  const rawSegments = `${locationName}, ${address || ''}`
    .split(/[,|-]+/)
    .map((s) => s.replace(/\d+/g, '').trim())
    .filter(Boolean);

  const tokens: string[] = [];

  for (const seg of rawSegments) {
    const cleanSeg = seg.replace(/[^\w\s]/g, ' ').trim();
    if (!cleanSeg) continue;
    if (
      cleanSeg.length >= 4 &&
      cleanSeg.split(/\s+/).length <= 2 &&
      !['sri lanka', 'western province', 'central province', 'southern province'].includes(
        cleanSeg.toLowerCase()
      )
    ) {
      if (!tokens.some((t) => t.toLowerCase() === cleanSeg.toLowerCase())) {
        tokens.push(cleanSeg);
      }
    }

    for (const word of cleanSeg.split(/\s+/)) {
      if (word.length >= 4 && !stopWords.has(word.toLowerCase())) {
        if (!tokens.some((t) => t.toLowerCase() === word.toLowerCase())) {
          tokens.push(word);
        }
      }
    }
  }

  // Include transliterations for extracted tokens
  const expandedTokens: string[] = [...tokens];
  for (const tok of tokens) {
    const alts = SRI_LANKA_LOCALITY_TRANSLITERATIONS[tok.toLowerCase()];
    if (alts) {
      for (const alt of alts) {
        if (!expandedTokens.some((t) => t.toLowerCase() === alt.toLowerCase())) {
          expandedTokens.push(alt);
        }
      }
    }
  }

  return expandedTokens.slice(0, 8);
}

/**
 * Builds targeted Google News RSS queries tailored to the 13 Sri Lankan national
 * news outlets and the 200m Google Maps neighborhood around the searched location.
 * Keeps each query concise to stay well within Google News RSS boolean operator limits.
 */
export function buildSriLankaNationalNewsQueries(
  primaryPlace: string,
  address: string = '',
  surroundingStreets: string[] = [],
  nearbyPlaceNames: string[] = []
): string[] {
  const localities = extractSriLankaLocalityTokens(primaryPlace, address);
  const mainTerm = localities[0] || primaryPlace.replace(/\bSri Lanka\b/gi, '').trim();
  const secondaryTerm = localities[1] || '';

  const crimeGroupA =
    '(shooting OR shot OR gunmen OR murder OR robbery OR assault OR police OR arrested)';
  const crimeGroupB =
    '(shooting OR robbed OR burglary OR stabbing OR theft OR grenade OR underworld OR STF)';

  const outletsBatch1 =
    '("Ada Derana" OR "Daily Mirror" OR "NewsWire" OR "NewsFirst" OR "Hiru" OR "Sunday Times" OR "Island")';
  const outletsBatch2 =
    '("Daily News" OR "ITN" OR "Siyatha" OR "Rupavahini" OR "Swarnavahini" OR "news.lk" OR "Ada Derana" OR "Daily Mirror")';

  const queries: string[] = [
    // 1. Primary locality + Batch 1 of Sri Lanka National News Outlets
    `"${mainTerm}" ${crimeGroupA} ${outletsBatch1}`,
    // 2. Primary locality + Batch 2 of Sri Lanka National News Outlets
    `"${mainTerm}" ${crimeGroupB} ${outletsBatch2}`,
    // 3. Direct Sri Lanka national news crime search for the locality (filtered by matchSriLankaNationalOutlet)
    `"${mainTerm}" "Sri Lanka" ${crimeGroupA}`,
  ];

  // 4. 200m Surrounding Streets discovered via Google Maps Place.searchNearby
  const topStreets = surroundingStreets.slice(0, 3);
  if (topStreets.length > 0) {
    const streetClause = topStreets.map((s) => `"${s}"`).join(' OR ');
    queries.push(`(${streetClause}) "Sri Lanka" ${crimeGroupA}`);
  }

  // 5. 200m Neighboring Landmarks or secondary locality
  const topLandmarks = nearbyPlaceNames
    .filter((n) => n.toLowerCase() !== primaryPlace.toLowerCase())
    .slice(0, 2);
  if (topLandmarks.length > 0) {
    const landmarkClause = topLandmarks.map((l) => `"${l}"`).join(' OR ');
    queries.push(`(${landmarkClause}) "Sri Lanka" ${crimeGroupA}`);
  } else if (secondaryTerm && secondaryTerm.toLowerCase() !== mainTerm.toLowerCase()) {
    queries.push(`"${secondaryTerm}" "Sri Lanka" ${crimeGroupA} ${outletsBatch1}`);
  }

  return queries;
}

/**
 * Additional Sri Lanka-specific criminal keywords (e.g., T-56, STF, grenade,
 * underworld, motorcycle gunmen, snatch theft) for Stage 1 crime classification.
 */
export const SRI_LANKA_CRIME_KEYWORDS = {
  violent: [
    't-56',
    't56',
    'pistol',
    'revolver',
    'motorcycle gunmen',
    'unknown gunmen',
    'open fire',
    'opened fire',
    'hand grenade',
    'grenade attack',
    'sword attack',
    'sharp weapon',
    'hacked to death',
    'underworld',
    'contract killing',
  ],
  moderate: [
    'chain snatching',
    'snatch theft',
    'gold chain',
    'three-wheeler theft',
    'extortion',
    'kappam',
  ],
};

/**
 * Prompt instructions appended to Gemini when `ENABLE_SRI_LANKA_PROTOTYPE` is enabled.
 */
export function getSriLankaGeminiPromptAppendix(): string {
  const outletNames = SRI_LANKA_NATIONAL_OUTLETS.map(
    (o) => `${o.displayName} (${o.domain})`
  ).join(', ');

  return `
### SRI LANKA NATIONAL NEWS OUTLETS FOCUS (PROTOTYPE MODE):
Prioritize and ground your safety analysis in reports from Sri Lanka's 13 national news outlets:
${outletNames}.
Focus on verified Sri Lankan police reports (SL Police / STF), shootings, motorcycle gunmen, armed robberies, chain snatchings, burglaries, and assaults within the 200-meter radius of the searched Sri Lankan location.`;
}
