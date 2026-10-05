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
 */
export function fuzzyLocalityMatch(headline: string, targetLocality: string): boolean {
  const lowerHeadline = headline.toLowerCase();
  const lowerTarget = targetLocality.toLowerCase().trim();
  if (!lowerTarget || lowerTarget.length < 3) return false;

  // 1. Direct substring match
  if (lowerHeadline.includes(lowerTarget)) return true;

  // 2. Transliteration mapping check
  const altNames = SRI_LANKA_LOCALITY_TRANSLITERATIONS[lowerTarget] || [];
  for (const alt of altNames) {
    if (lowerHeadline.includes(alt.toLowerCase())) return true;
  }

  // 3. Token-by-token comparison & fuzzy Levenshtein check
  const headlineWords = lowerHeadline
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  const targetWords = lowerTarget
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);

  for (const tw of targetWords) {
    for (const hw of headlineWords) {
      if (hw === tw) return true;
      if (tw.length >= 5 && hw.length >= 5) {
        if (levenshteinDistance(tw, hw) <= 2) return true;
      }
    }
  }

  return false;
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
    'stf raid',
    'special task force',
    'organized crime',
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
