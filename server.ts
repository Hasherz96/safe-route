import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { ENABLE_SRI_LANKA_PROTOTYPE } from './src/sriLankaPrototype/sriLankaConfig';
import {
  buildSriLankaNationalNewsQueries,
  extractSriLankaLocalityTokens,
  fetchDirectSriLankaRssFeeds,
  fuzzyLocalityMatch,
  getSriLankaGeminiPromptAppendix,
  matchSriLankaNationalOutlet,
  SRI_LANKA_CRIME_KEYWORDS,
} from './src/sriLankaPrototype/sriLankaNewsEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const SAFETY_SYSTEM_INSTRUCTION = `You are the SafeRoute Android Real-Time Crime Preprocessor & 200m Radius Safety Intelligence Engine.
Your task is to evaluate the real-time pedestrian and visitor safety within a strict 200-meter radius of a target location using Google Maps 200m neighborhood data and live news reports.

### CRITICAL PREPROCESSING & FILTERING RULES:
1. EXCLUDE NON-CRIME & ENTERTAINMENT / FILM SHOOTS:
   - Immediately REJECT any article where "shooting", "shot", "attack", "hit", or "steal" refers to:
     * Movie / TV / commercial / photography production (e.g., "Spider-Man shooting location", "film shoot", "photo shoot", "music video shoot", "filming on location").
     * Sports or games (e.g., basketball shooting, 3-point shot, penalty shot, golf, NFL/NBA/MLB game recaps).
     * Medical / figurative / financial phrases (e.g., vaccine shot, flu shot, heart attack, prices shot up).
2. 200-METER RADIUS PROXIMITY REQUIREMENT:
   - Only include actual criminal offenses (shootings, homicides, stabbings, armed robberies, burglaries, assaults, thefts, vehicle break-ins, public nuisance) that occurred at the target place or along the surrounding streets and landmarks within its 200-meter radius.

### STRICT SCORING ALGORITHM & METHODOLOGY:
1. Base Score: 5.0 (Extremely Safe)
2. Crime Severity Weights (CSW):
   - Violent / High Severity (Murder, Homicide, Shooting, Stabbing, Kidnapping, Armed Robbery, Carjacking): CSW = 10 to 12
   - Property / Moderate Severity (Burglary, Auto Theft, Aggravated Assault, Robbery): CSW = 5 to 7
   - Minor Crimes (Petty Theft, Shoplifting, Pickpocketing, Vandalism, Vehicle Break-in, Larceny): CSW = 2 to 3
   - Nuisance / Low Risk (Public Intoxication, Loitering, Noise, Trespassing, Disorderly Conduct): CSW = 1
3. Multipliers:
   - Source Multiplier: Credible Local/National News = 1.0 | Social Media (Reddit, X, Facebook) = 0.5
   - Recency Multiplier: < 7 days = 1.0 | 8–30 days = 0.7 | 31–90 days = 0.4 | > 90 days = 0.1
4. Score Formula:
   - Incident Penalty = CSW * Source Multiplier * Recency Multiplier
   - Total Penalty = Sum of all Incident Penalties
   - Final Score = Max(1.0, 5.0 - (Total Penalty / 5))
5. Risk Level thresholds:
   - 4.0 to 5.0 -> "Safe"
   - 3.0 to 3.9 -> "Moderate Risk"
   - 1.0 to 2.9 -> "High Risk"

### OUTPUT FORMAT:
Respond ONLY with a valid JSON object matching this exact schema:
{
  "location": "Target Location Name",
  "safety_rating": 3.2,
  "risk_level": "Safe | Moderate Risk | High Risk",
  "summary": "2-3 sentence overview of safety context within the 200m radius citing specific verified crime patterns.",
  "incident_breakdown": [
    {
      "crime_type": "Theft | Burglary | Violent | Nuisance",
      "description": "Brief headline or summary of verified criminal incident",
      "source_type": "Local News | Social Media",
      "source_name": "Publisher or Platform name",
      "recency": "e.g., 2 days ago",
      "severity_impact": "High | Medium | Low",
      "calculated_penalty": 4.2,
      "csw_weight": 10,
      "source_multiplier": 1.0,
      "recency_multiplier": 0.4,
      "source_url": "https://...",
      "matched_zone": "Within 200m · Street or Landmark Name"
    }
  ],
  "safety_recommendations": [
    "Practical safety advice 1",
    "Practical safety advice 2",
    "Practical safety advice 3"
  ]
}${ENABLE_SRI_LANKA_PROTOTYPE ? getSriLankaGeminiPromptAppendix() : ''}`;

interface RawFeedArticle {
  title: string;
  pubDate: string;
  sourceName: string;
  sourceType: 'Local News' | 'Social Media';
  link: string;
  daysAgo: number;
  recencyText: string;
  matchedZone: string;
}

interface RejectedArticle {
  title: string;
  reason: string;
}

function computeRecencyFromDate(dateStr: string): {
  daysAgo: number;
  recencyText: string;
  recencyMultiplier: number;
} {
  const parsed = Date.parse(dateStr);
  if (Number.isNaN(parsed)) {
    return { daysAgo: 14, recencyText: '2 weeks ago', recencyMultiplier: 0.7 };
  }
  const now = Date.now();
  const diffMs = Math.max(0, now - parsed);
  const daysAgo = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let recencyText = 'Recent';
  if (daysAgo === 0) {
    const hours = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60)));
    recencyText = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (daysAgo === 1) {
    recencyText = '1 day ago';
  } else if (daysAgo < 7) {
    recencyText = `${daysAgo} days ago`;
  } else if (daysAgo < 30) {
    const weeks = Math.max(1, Math.floor(daysAgo / 7));
    recencyText = `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  } else if (daysAgo < 365) {
    const months = Math.max(1, Math.floor(daysAgo / 30));
    recencyText = `${months} month${months === 1 ? '' : 's'} ago`;
  } else {
    const years = Math.max(1, Math.floor(daysAgo / 365));
    recencyText = `${years} year${years === 1 ? '' : 's'} ago`;
  }

  const recencyMultiplier =
    daysAgo <= 7 ? 1.0 : daysAgo <= 30 ? 0.7 : daysAgo <= 90 ? 0.4 : 0.1;

  return { daysAgo, recencyText, recencyMultiplier };
}

/**
 * STAGE 1 PREPROCESSOR:
 * Distinguishes actual criminal incidents from film/movie shoots (e.g. "Spider-Man shooting location"),
 * photo shoots, sports metaphors, and non-crime news.
 */
function preprocessAndClassifyHeadline(title: string): {
  isCrime: boolean;
  rejectionReason?: string;
  crime_type: 'Violent' | 'Burglary' | 'Theft' | 'Nuisance';
  severity_impact: 'High' | 'Medium' | 'Low';
  csw: number;
} {
  const lower = title.toLowerCase();

  // 1A. Multi-topic news roundups where unrelated stories are concatenated
  if (
    /^(in the news|morning briefing|evening briefing|daily digest|top stories|bay area news roundup|what to know today):/i.test(
      lower
    )
  ) {
    return {
      isCrime: false,
      rejectionReason: 'Multi-topic news roundup (crime not at target location)',
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 0,
    };
  }

  // 1B. Film, TV, Movie, Photography & Entertainment Shoot Filter
  const entertainmentShootPatterns: { pattern: RegExp; label: string }[] = [
    {
      pattern:
        /\b(spider-?man|batman|avengers|marvel|dc studios|star wars|matrix|venom|deadpool|bond|mission impossible|superman|transformers|fast and furious)\b/i,
      label: 'Film/franchise production reference (not a crime)',
    },
    {
      pattern:
        /\b(shooting location|filming location|location shoot|film shoot|movie shoot|commercial shoot|photo\s*shoot|music video shoot|fashion shoot|drone shoot|video shoot|scenes shot|shot scenes|shooting scenes)\b/i,
      label: 'Film/photography shoot location (not a crime)',
    },
    {
      pattern:
        /\b(filming|on set|movie set|film crew|casting call|box office|trailer|premiere|sequel|blockbuster|hollywood|netflix|hbo|disney|actor|actress|stunt double|cinematography|screenplay|tv series)\b/i,
      label: 'Entertainment/media production coverage',
    },
  ];

  for (const rule of entertainmentShootPatterns) {
    if (rule.pattern.test(lower)) {
      return {
        isCrime: false,
        rejectionReason: rule.label,
        crime_type: 'Nuisance',
        severity_impact: 'Low',
        csw: 0,
      };
    }
  }

  // 1C. Sports & Athletic Metaphor Filter ("shooting", "shot", "steal", "attack")
  const sportsPatterns =
    /\b(basketball|nba|wnba|mlb|nhl|mls|fifa|ufc|pga|golf|tennis|hockey|soccer|touchdown|quarterback|free throw|three-pointer|3-point|field goal|shooting guard|shooting percentage|penalty shot|slapshot|playoffs|championship|tournament|halftime|innings|box score)\b/i;
  const hasExplicitCrimeContext =
    /\b(police|sfpd|nypd|cpd|spd|lapd|arrested|suspect|charged|homicide|detective|felony|indicted|gunpoint|911|robbery|mugging|shooting near|shooting in|shooting at|shot in|shot near)\b/i.test(
      lower
    );

  if (sportsPatterns.test(lower) && !hasExplicitCrimeContext) {
    return {
      isCrime: false,
      rejectionReason: 'Sports/athletic coverage (non-criminal)',
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 0,
    };
  }

  // 1D. Medical, Beverage & Figurative Idiom Filter
  const figurativePatterns =
    /\b(flu shot|vaccine|booster shot|covid shot|immunization|espresso shot|tequila shot|shot of whiskey|heart attack|panic attack|asthma attack|anxiety attack|time capsule|murder mystery|podcast|book review|theater review|broadway|concert tour)\b/i;
  if (figurativePatterns.test(lower) && !hasExplicitCrimeContext) {
    return {
      isCrime: false,
      rejectionReason: 'Medical/figurative expression (non-criminal)',
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 0,
    };
  }

  // 1E. Ambiguous "shooting" / "shot" verification:
  // If the headline contains "shoot" or "shot", verify it has real criminal/violence or geographic shooting context
  if (/\b(shoot|shooting|shot)\b/i.test(lower)) {
    const criminalShootingContext =
      /\b(police|sfpd|nypd|cpd|spd|lapd|sheriff|trooper|officer|suspect|victim|hospital|critical|injured|wounded|killed|dead|fatal|homicide|murder|gun|firearm|stray bullet|drive-by|armed|robbery|carjacking|arrest|investigat|crime|scene|block of|alley|station|shooting near|shooting in|shooting at|shot near|shot in|shot at|gunfire)\b/i;
    if (!criminalShootingContext.test(lower)) {
      return {
        isCrime: false,
        rejectionReason:
          'Ambiguous use of "shoot/shot" without law-enforcement or crime corroboration',
        crime_type: 'Nuisance',
        severity_impact: 'Low',
        csw: 0,
      };
    }
  }

  // 2. Classify Verified Criminal Incidents by CSW Category
  // Category A: Violent / High Severity (CSW = 10 to 12)
  const violentKeywords = [
    'shooting',
    'shot',
    'gunfire',
    'homicide',
    'murder',
    'killed',
    'fatal',
    'stabbing',
    'stabbed',
    'kidnapping',
    'abduction',
    'armed robbery',
    'carjacking',
    'gunpoint',
    'gunman',
    'stray bullet',
    'mass shooting',
    'deadly',
    ...(ENABLE_SRI_LANKA_PROTOTYPE ? SRI_LANKA_CRIME_KEYWORDS.violent : []),
  ];
  if (violentKeywords.some((kw) => lower.includes(kw))) {
    const isExtreme =
      lower.includes('homicide') ||
      lower.includes('murder') ||
      lower.includes('fatal') ||
      lower.includes('killed') ||
      lower.includes('mass shooting') ||
      lower.includes('hacked to death') ||
      lower.includes('grenade attack');
    return {
      isCrime: true,
      crime_type: 'Violent',
      severity_impact: 'High',
      csw: isExtreme ? 12 : 10,
    };
  }

  // Category B: Property / Moderate Severity (CSW = 5 to 7)
  const moderateKeywords = [
    'burglary',
    'burglar',
    'robbery',
    'robbed',
    'assault',
    'attacked',
    'unprovoked attack',
    'auto theft',
    'stolen car',
    'stolen vehicle',
    'smash-and-grab',
    'smash and grab',
    'home invasion',
    'looting',
    'suspect arrested',
    'police chase',
    'felony',
    ...(ENABLE_SRI_LANKA_PROTOTYPE ? SRI_LANKA_CRIME_KEYWORDS.moderate : []),
  ];
  if (moderateKeywords.some((kw) => lower.includes(kw))) {
    const isHigherMod =
      lower.includes('assault') ||
      lower.includes('robbery') ||
      lower.includes('home invasion') ||
      lower.includes('smash-and-grab');
    return {
      isCrime: true,
      crime_type: 'Burglary',
      severity_impact: 'Medium',
      csw: isHigherMod ? 7 : 5,
    };
  }

  // Category C: Minor Crimes (CSW = 2 to 3)
  const minorKeywords = [
    'theft',
    'shoplifting',
    'pickpocket',
    'vandalism',
    'vandalized',
    'break-in',
    'bipping',
    'car break-in',
    'stolen',
    'larceny',
    'graffiti',
    'package thief',
    'retail theft',
    'retail crime',
  ];
  if (minorKeywords.some((kw) => lower.includes(kw))) {
    return {
      isCrime: true,
      crime_type: 'Theft',
      severity_impact: 'Low',
      csw: lower.includes('break-in') || lower.includes('retail') ? 3 : 2,
    };
  }

  // Category D: Nuisance / Low Risk (CSW = 1)
  const nuisanceKeywords = [
    'nuisance',
    'loitering',
    'trespassing',
    'public intoxication',
    'disorderly conduct',
    'disturbance',
    'illegal sideshow',
    'curfew violation',
  ];
  if (nuisanceKeywords.some((kw) => lower.includes(kw))) {
    return {
      isCrime: true,
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 1,
    };
  }

  return {
    isCrime: false,
    rejectionReason: 'General news article (no specific criminal offense)',
    crime_type: 'Nuisance',
    severity_impact: 'Low',
    csw: 0,
  };
}

/**
 * STAGE 2 PREPROCESSOR:
 * Verifies whether a candidate crime headline matches the searched place
 * or one of the Google Maps 200m radius neighboring streets / landmarks.
 */
function verify200mZoneMatch(
  title: string,
  locationName: string,
  surroundingStreets: string[],
  nearbyPlaceNames: string[],
  address?: string
): { matched: boolean; matchedZone: string } {
  const lowerTitle = title.toLowerCase();
  const cleanTarget = locationName
    .split(',')[0]
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .toLowerCase();

  // Check direct target place name match or fuzzy locality match
  if (cleanTarget && cleanTarget.length >= 3) {
    if (
      lowerTitle.includes(cleanTarget) ||
      (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, cleanTarget))
    ) {
      return {
        matched: true,
        matchedZone: `Within 200m · ${locationName.split(',')[0].trim()}`,
      };
    }
  }

  // Check any of the 200m surrounding streets discovered via Google Maps
  for (const street of surroundingStreets) {
    const cleanStreet = street.toLowerCase().trim();
    // Match either full street name or base street name (stripping Mawatha/Mw/Veediya/Road/St) if >= 4 chars
    const streetBase = cleanStreet
      .replace(
        /\b(mawatha|mw|veediya|st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|pl|place|ct|lane|ln)\b\.?/gi,
        ''
      )
      .trim();
    if (
      (cleanStreet.length >= 4 && lowerTitle.includes(cleanStreet)) ||
      (streetBase.length >= 4 &&
        new RegExp(`\\b${streetBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
          lowerTitle
        )) ||
      (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, street))
    ) {
      return {
        matched: true,
        matchedZone: `Within 200m · ${street}`,
      };
    }
  }

  // Check any of the 200m neighboring places/landmarks discovered via Google Maps
  for (const placeName of nearbyPlaceNames) {
    const cleanPlace = placeName.toLowerCase().trim();
    if (
      (cleanPlace.length >= 4 && lowerTitle.includes(cleanPlace)) ||
      (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, placeName))
    ) {
      return {
        matched: true,
        matchedZone: `Within 200m · Near ${placeName}`,
      };
    }
  }

  // When Sri Lanka prototype mode is active, match extracted Sri Lankan sub-localities/towns
  if (ENABLE_SRI_LANKA_PROTOTYPE) {
    const localities = extractSriLankaLocalityTokens(locationName, address);
    for (const locToken of localities) {
      const lowerLoc = locToken.toLowerCase();
      if (
        (lowerLoc.length >= 4 && lowerTitle.includes(lowerLoc)) ||
        fuzzyLocalityMatch(title, locToken)
      ) {
        return {
          matched: true,
          matchedZone: `Within 200m · ${locToken}`,
        };
      }
    }
  }

  // Also check individual significant tokens of the searched place name
  const targetTokens = cleanTarget
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 4 &&
        !['park', 'city', 'downtown', 'north', 'south', 'east', 'west', 'sri', 'lanka'].includes(t)
    );
  if (
    targetTokens.length > 0 &&
    targetTokens.every(
      (t) => lowerTitle.includes(t) || (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, t))
    )
  ) {
    return {
      matched: true,
      matchedZone: `Within 200m · ${locationName.split(',')[0].trim()}`,
    };
  }

  return { matched: false, matchedZone: '' };
}

/**
 * Fetches live news & community reports for the 200m radius zone and runs the
 * 2-stage deterministic preprocessor (Non-Crime Filter + 200m Proximity Check).
 */
async function fetchAndPreprocess200mCrimeReports(
  locationName: string,
  address?: string,
  surroundingStreets: string[] = [],
  nearbyPlaceNames: string[] = []
): Promise<{
  verifiedArticles: RawFeedArticle[];
  rawCount: number;
  rejectedNonCrimeCount: number;
  rejectedOutsideRadiusCount: number;
  rejectedExamples: RejectedArticle[];
}> {
  const verifiedArticles: RawFeedArticle[] = [];
  const rejectedExamples: RejectedArticle[] = [];
  let rawCount = 0;
  let rejectedNonCrimeCount = 0;
  let rejectedOutsideRadiusCount = 0;

  const primaryPlace = locationName.split(',')[0].trim();
  const addressParts = (address || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  // Extract city name from formatted address (typically 2nd or 3rd segment)
  const cityHint =
    addressParts.length >= 2
      ? addressParts[addressParts.length - 2] || addressParts[0]
      : '';

  const topStreets = surroundingStreets.slice(0, 4);
  const topLandmarks = nearbyPlaceNames
    .filter((n) => n.toLowerCase() !== primaryPlace.toLowerCase())
    .slice(0, 3);

  // Build targeted 200m micro-zone queries:
  // When ENABLE_SRI_LANKA_PROTOTYPE is true, delegate to our isolated Sri Lanka National News module
  const queries: string[] = ENABLE_SRI_LANKA_PROTOTYPE
    ? buildSriLankaNationalNewsQueries(
        primaryPlace,
        address || cityHint,
        topStreets,
        topLandmarks
      )
    : [
        `"${primaryPlace}" ${cityHint} (shooting OR robbery OR assault OR burglary OR stabbing OR homicide OR theft OR police)`,
        ...(topStreets.length > 0
          ? [
              `(${topStreets.map((s) => `"${s}"`).join(' OR ')}) "${cityHint || primaryPlace}" (shooting OR robbery OR assault OR burglary OR police OR crime)`,
            ]
          : []),
        ...(topLandmarks.length > 0
          ? [
              `(${topLandmarks.map((l) => `"${l}"`).join(' OR ')}) "${cityHint || primaryPlace}" (shooting OR robbery OR assault OR theft OR police)`,
            ]
          : []),
        `${primaryPlace} ${cityHint} (shooting OR robbed OR stabbed OR burglary OR carjacking OR break-in)`,
      ];

  const seenTitles = new Set<string>();

  // Direct RSS Feed Fetching for Sri Lanka National Outlets (solves Google News indexing gaps)
  if (ENABLE_SRI_LANKA_PROTOTYPE) {
    try {
      const directArticles = await fetchDirectSriLankaRssFeeds();
      for (const art of directArticles) {
        if (verifiedArticles.length >= 10) break;
        if (!art.title || seenTitles.has(art.title.toLowerCase())) continue;
        seenTitles.add(art.title.toLowerCase());
        rawCount++;

        const classification = preprocessAndClassifyHeadline(art.title);
        if (!classification.isCrime) {
          rejectedNonCrimeCount++;
          if (rejectedExamples.length < 5) {
            rejectedExamples.push({
              title: art.title,
              reason:
                classification.rejectionReason ||
                'Filtered: Non-criminal news article',
            });
          }
          continue;
        }

        const zoneCheck = verify200mZoneMatch(
          art.title,
          locationName,
          surroundingStreets,
          nearbyPlaceNames,
          address
        );

        if (!zoneCheck.matched) {
          rejectedOutsideRadiusCount++;
          if (rejectedExamples.length < 5) {
            rejectedExamples.push({
              title: art.title,
              reason: 'Filtered: Outside 200m neighboring street/landmark radius',
            });
          }
          continue;
        }

        const { daysAgo, recencyText } = computeRecencyFromDate(art.pubDate);
        verifiedArticles.push({
          title: art.title,
          pubDate: art.pubDate,
          sourceName: art.sourceName,
          sourceType: 'Local News',
          link: art.link,
          daysAgo,
          recencyText,
          matchedZone: zoneCheck.matchedZone,
        });
      }
    } catch {
      // Ignore direct RSS fetch errors
    }
  }

  for (const queryStr of queries) {
    if (verifiedArticles.length >= 10) break;
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
        queryStr
      )}&hl=en-US&gl=US&ceid=US:en`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4200);
      const res = await fetch(rssUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
        },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const xml = await res.text();
        const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
        for (const m of itemMatches) {
          const block = m[1];
          const rawTitle = (
            block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''
          )
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .trim();
          const pubDate =
            block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
          const rawSourceName = (
            block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ||
            'Local News'
          )
            .replace(/<!\[CDATA\[|\]\]>/g, '')
            .replace(/&amp;/g, '&')
            .trim();
          const link =
            block.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';

          const cleanTitle = rawTitle.replace(/\s+-\s+[^-]+$/, '').trim();
          if (!cleanTitle || seenTitles.has(cleanTitle.toLowerCase())) continue;
          seenTitles.add(cleanTitle.toLowerCase());
          rawCount++;

          // Optional Sri Lanka National News Outlet verification & canonicalization
          let resolvedSourceName = rawSourceName;
          if (ENABLE_SRI_LANKA_PROTOTYPE) {
            const matchedOutlet = matchSriLankaNationalOutlet(
              rawSourceName,
              link,
              rawTitle
            );
            if (!matchedOutlet) {
              rejectedOutsideRadiusCount++;
              if (rejectedExamples.length < 5) {
                rejectedExamples.push({
                  title: cleanTitle,
                  reason: `Filtered: Source (${rawSourceName}) is not one of the 13 designated Sri Lanka national news outlets`,
                });
              }
              continue;
            }
            resolvedSourceName = matchedOutlet.displayName;
          }

          // STAGE 1: Preprocessor check for actual crime vs film shoot / sports / non-crime
          const classification = preprocessAndClassifyHeadline(cleanTitle);
          if (!classification.isCrime) {
            rejectedNonCrimeCount++;
            if (rejectedExamples.length < 5) {
              rejectedExamples.push({
                title: cleanTitle,
                reason:
                  classification.rejectionReason ||
                  'Filtered: Non-criminal news article',
              });
            }
            continue;
          }

          // STAGE 2: 200m Radius Micro-Zone Match Check
          const zoneCheck = verify200mZoneMatch(
            cleanTitle,
            locationName,
            surroundingStreets,
            nearbyPlaceNames,
            address
          );

          if (!zoneCheck.matched) {
            rejectedOutsideRadiusCount++;
            if (rejectedExamples.length < 5) {
              rejectedExamples.push({
                title: cleanTitle,
                reason: 'Filtered: Outside 200m neighboring street/landmark radius',
              });
            }
            continue;
          }

          const { daysAgo, recencyText } = computeRecencyFromDate(pubDate);
          verifiedArticles.push({
            title: cleanTitle,
            pubDate,
            sourceName: resolvedSourceName,
            sourceType: 'Local News',
            link,
            daysAgo,
            recencyText,
            matchedZone: zoneCheck.matchedZone,
          });

          if (verifiedArticles.length >= 10) break;
        }
      }
    } catch {
      // Ignore individual RSS timeout
    }
  }

  // Also check Reddit community reports for the 200m zone
  try {
    const redditUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(
      `"${primaryPlace}" (shooting OR robbery OR mugging OR break in OR assault)`
    )}&sort=new&limit=6`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(redditUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SafeRouteAndroidPrototype/1.0',
      },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const children = data?.data?.children || [];
      for (const child of children) {
        const post = child?.data;
        if (!post?.title) continue;
        const cleanTitle = String(post.title).trim();
        if (seenTitles.has(cleanTitle.toLowerCase())) continue;
        seenTitles.add(cleanTitle.toLowerCase());
        rawCount++;

        const classification = preprocessAndClassifyHeadline(cleanTitle);
        if (!classification.isCrime) {
          rejectedNonCrimeCount++;
          if (rejectedExamples.length < 5) {
            rejectedExamples.push({
              title: cleanTitle,
              reason:
                classification.rejectionReason ||
                'Filtered: Non-criminal community post',
            });
          }
          continue;
        }

        const zoneCheck = verify200mZoneMatch(
          cleanTitle,
          locationName,
          surroundingStreets,
          nearbyPlaceNames,
          address
        );
        if (!zoneCheck.matched) {
          rejectedOutsideRadiusCount++;
          continue;
        }

        const createdUtcMs = (post.created_utc || 0) * 1000;
        const pubDate = createdUtcMs
          ? new Date(createdUtcMs).toUTCString()
          : '';
        const { daysAgo, recencyText } = computeRecencyFromDate(pubDate);

        verifiedArticles.push({
          title: cleanTitle,
          pubDate,
          sourceName: `Reddit r/${post.subreddit || 'local'}`,
          sourceType: 'Social Media',
          link: post.permalink
            ? `https://www.reddit.com${post.permalink}`
            : 'https://www.reddit.com',
          daysAgo,
          recencyText,
          matchedZone: zoneCheck.matchedZone,
        });
      }
    }
  } catch {
    // Ignore Reddit timeout
  }

  verifiedArticles.sort((a, b) => a.daysAgo - b.daysAgo);
  return {
    verifiedArticles: verifiedArticles.slice(0, 8),
    rawCount,
    rejectedNonCrimeCount,
    rejectedOutsideRadiusCount,
    rejectedExamples,
  };
}

function buildAnalysisFromVerifiedArticles(
  locationLabel: string,
  articles: RawFeedArticle[],
  preprocessingAudit: any
) {
  const incident_breakdown = articles.map((art) => {
    const { crime_type, severity_impact, csw } = preprocessAndClassifyHeadline(
      art.title
    );
    const source_multiplier = art.sourceType === 'Social Media' ? 0.5 : 1.0;
    const { recencyMultiplier } = computeRecencyFromDate(art.pubDate);
    const calculated_penalty = Number(
      (csw * source_multiplier * recencyMultiplier).toFixed(2)
    );

    return {
      crime_type,
      description: art.title,
      source_type: art.sourceType,
      source_name: art.sourceName,
      recency: art.recencyText,
      severity_impact,
      calculated_penalty,
      csw_weight: csw,
      source_multiplier,
      recency_multiplier: recencyMultiplier,
      source_url: art.link,
      matched_zone: art.matchedZone,
    };
  });

  const total_penalty = Number(
    incident_breakdown
      .reduce((sum, inc) => sum + inc.calculated_penalty, 0)
      .toFixed(2)
  );

  const safety_rating =
    incident_breakdown.length === 0
      ? 5.0
      : Number(Math.max(1.0, 5.0 - total_penalty / 5).toFixed(1));

  const risk_level: 'Safe' | 'Moderate Risk' | 'High Risk' =
    safety_rating >= 4.0
      ? 'Safe'
      : safety_rating >= 3.0
        ? 'Moderate Risk'
        : 'High Risk';

  const violentCount = incident_breakdown.filter(
    (i) => i.crime_type === 'Violent'
  ).length;
  const propertyCount = incident_breakdown.filter(
    (i) => i.crime_type === 'Burglary' || i.crime_type === 'Theft'
  ).length;

  const streetsCount = preprocessingAudit?.scanned_streets_200m?.length || 0;
  const placesCount = preprocessingAudit?.scanned_places_200m?.length || 0;

  let summary = '';
  if (incident_breakdown.length === 0) {
    summary = `Scanned ${placesCount} neighboring places and ${streetsCount} street corridors within a 200m radius of ${locationLabel}. After preprocessing ${preprocessingAudit.raw_candidates_scanned} articles (filtering out ${preprocessingAudit.rejected_non_crime_count} non-crime/film/sports mentions), 0 verified crimes were found inside the 200m zone.`;
  } else {
    summary = `200m radius scan around ${locationLabel} (${streetsCount} adjacent streets & ${placesCount} nearby landmarks) verified ${incident_breakdown.length} actual crime reports (${violentCount} violent, ${propertyCount} property/theft) after rejecting ${preprocessingAudit.rejected_non_crime_count + preprocessingAudit.rejected_outside_radius_count} non-crime or out-of-zone articles.`;
  }

  const safety_recommendations =
    safety_rating < 3.0
      ? [
          `High-risk 200m zone: ${violentCount} verified violent incident(s) reported on adjacent corridors near ${locationLabel}. Avoid unlit blocks late at night.`,
          'Use main transit entrances and well-patrolled commercial frontages within the 200m perimeter.',
          'Keep valuables concealed and share live route telemetry when walking.',
        ]
      : safety_rating < 4.0
        ? [
            `Moderate caution advised within the 200m radius of ${locationLabel} due to recent property and street-level offenses.`,
            'Do not leave bags or electronics visible in parked vehicles on surrounding side streets.',
            'Remain on active pedestrian blocks after dusk.',
          ]
        : [
            '200m perimeter shows low verified criminal activity; maintain standard urban situational awareness.',
            'Keep mobile devices secured near transit stops and intersections.',
            'Prefer well-lit sidewalks along primary streets after evening hours.',
          ];

  const grounding_sources = articles
    .filter((a) => Boolean(a.link))
    .map((a) => ({
      title: `${a.sourceName}: ${a.title}`,
      uri: a.link,
    }));

  return {
    location: locationLabel,
    safety_rating,
    risk_level,
    summary,
    incident_breakdown,
    safety_recommendations,
    total_penalty,
    grounding_sources,
    preprocessing_audit: preprocessingAudit,
    missing_news_notice:
      incident_breakdown.length === 0
        ? `No verified criminal offenses found within the 200m radius after preprocessing ${preprocessingAudit.raw_candidates_scanned} candidate articles. Defaulting to Base Score 5.0.`
        : undefined,
    analyzed_at: new Date().toISOString(),
  };
}

function extractJsonObject(rawText: string): any {
  const cleaned = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Could not parse JSON from Gemini response');
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.all('/api/test/grounding', async (req, res) => {
    const location =
      (req.query.q as string) ||
      (req.query.location as string) ||
      req.body?.location ||
      'Pettah Colombo Sri Lanka';
    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
    ];

    let lastError: any = null;
    for (const modelName of candidateModels) {
      try {
        const prompt = `Perform a safety and crime grounding test for location: "${location}". List recent verified police or news reports of crime within 200 meters. Return JSON with keys: location, summary, grounding_sources.`;
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction: SAFETY_SYSTEM_INSTRUCTION,
            tools: [{ googleSearch: {} }],
            temperature: 0.15,
          },
        });

        const groundingMetadata = response.candidates?.[0]?.groundingMetadata || {};
        const groundingChunks = groundingMetadata.groundingChunks || [];
        const webSearchQueries = groundingMetadata.webSearchQueries || [];

        const sources: { title: string; uri: string }[] = [];
        for (const chunk of groundingChunks) {
          if (chunk.web?.uri && chunk.web?.title) {
            if (!sources.some((s) => s.uri === chunk.web!.uri)) {
              sources.push({
                title: chunk.web.title,
                uri: chunk.web.uri,
              });
            }
          }
        }

        res.json({
          status: 'success',
          modelUsed: modelName,
          locationTested: location,
          hasGroundingMetadata: Boolean(groundingMetadata),
          webSearchQueries,
          groundingChunksCount: groundingChunks.length,
          groundingSources: sources,
          rawResponseText: response.text,
          testedAt: new Date().toISOString(),
        });
        return;
      } catch (err: any) {
        lastError = err;
      }
    }

    res.status(500).json({
      status: 'error',
      message: lastError?.message || 'Failed to call Gemini with Google Search grounding',
      testedAt: new Date().toISOString(),
    });
  });

  app.post('/api/safety/analyze', async (req, res) => {
    const {
      locationName,
      address,
      coordinates,
      originName,
      travelMode,
      nearbyArea,
    } = req.body || {};

    if (!locationName && !address) {
      res.status(400).json({ error: 'locationName or address is required.' });
      return;
    }

    const displayLocation = locationName || address;
    const targetLabel = [locationName, address].filter(Boolean).join(' — ');

    const surroundingStreets: string[] = Array.isArray(
      nearbyArea?.surroundingStreets
    )
      ? nearbyArea.surroundingStreets.map(String)
      : [];
    const nearbyPlaceNames: string[] = Array.isArray(nearbyArea?.nearbyPlaces)
      ? nearbyArea.nearbyPlaces.map((p: any) => String(p.name)).filter(Boolean)
      : [];

    // Step 1 & 2: Fetch candidate articles for the 200m neighborhood & run the Preprocessor
    const preprocessed = await fetchAndPreprocess200mCrimeReports(
      locationName || address,
      address,
      surroundingStreets,
      nearbyPlaceNames
    );

    const preprocessingAudit = {
      raw_candidates_scanned: preprocessed.rawCount,
      rejected_non_crime_count: preprocessed.rejectedNonCrimeCount,
      rejected_outside_radius_count: preprocessed.rejectedOutsideRadiusCount,
      verified_crime_count: preprocessed.verifiedArticles.length,
      rejected_examples: preprocessed.rejectedExamples,
      scanned_streets_200m: surroundingStreets,
      scanned_places_200m: nearbyPlaceNames.slice(0, 10),
    };

    const coordContext =
      coordinates && typeof coordinates.lat === 'number'
        ? ` (Center Coordinates: ${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}, Radius: 200m)`
        : '';
    const routeContext = originName
      ? ` The user is requesting a ${travelMode || 'WALKING'} route from "${originName}" to "${targetLabel}".`
      : '';

    const neighborhoodContext =
      surroundingStreets.length > 0 || nearbyPlaceNames.length > 0
        ? `\nGoogle Maps 200m Radius Neighborhood Scan:` +
          `\n- Adjacent Streets within 200m: ${surroundingStreets.join(', ') || 'N/A'}` +
          `\n- Neighboring Landmarks within 200m: ${nearbyPlaceNames.slice(0, 8).join(', ') || 'N/A'}`
        : '';

    const verifiedFeedContext =
      preprocessed.verifiedArticles.length > 0
        ? `\n\nPreprocessed & Verified Crime Reports within 200m Radius:\n` +
          preprocessed.verifiedArticles
            .map(
              (a, i) =>
                `${i + 1}. [${a.sourceType} - ${a.sourceName}] "${a.title}" (${a.recencyText}, Zone: ${a.matchedZone}, URL: ${a.link})`
            )
            .join('\n')
        : '\n\nNo verified crime articles matched after preprocessing out film shoots, sports metaphors, and out-of-radius stories.';

    const prompt = `Analyze the 200-meter radius crime intelligence around: "${targetLabel}"${coordContext}.${routeContext}${neighborhoodContext}${verifiedFeedContext}

Remember:
1. Reject any non-crime stories (e.g., movie/film shooting locations like Spider-Man, photo shoots, sports shooting, etc.).
2. Only score actual criminal offenses within the 200m neighboring area.
3. Compute each incident's penalty using CSW * Source Multiplier * Recency Multiplier and Final Score = Max(1.0, 5.0 - (Total Penalty / 5)).
Return the strict JSON object only.`;

    const candidateModels = [
      'gemini-3.8-flash',
      'gemini-flash-latest',
      'gemini-3.1-flash-lite',
    ];

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction: SAFETY_SYSTEM_INSTRUCTION,
            tools: [{ googleSearch: {} }],
            temperature: 0.15,
          },
        });

        const responseText = response.text || '';
        const parsed = extractJsonObject(responseText);

        // Post-verify every LLM-returned incident through our Stage 1 Preprocessor so no film shoot or sports metaphor ever slips through!
        const rawIncidents = Array.isArray(parsed?.incident_breakdown)
          ? parsed.incident_breakdown
          : [];

        const postFilteredIncidents = rawIncidents.filter((item: any) => {
          const check = preprocessAndClassifyHeadline(
            String(item?.description || '')
          );
          if (!check.isCrime) {
            preprocessingAudit.rejected_non_crime_count++;
            if (preprocessingAudit.rejected_examples.length < 5) {
              preprocessingAudit.rejected_examples.push({
                title: String(item?.description || 'Filtered item'),
                reason:
                  check.rejectionReason ||
                  'Rejected by post-LLM crime verification filter',
              });
            }
            return false;
          }
          return true;
        });

        // If preprocessed live articles exist and LLM returned none, use the verified 200m articles
        if (
          postFilteredIncidents.length === 0 &&
          preprocessed.verifiedArticles.length > 0
        ) {
          const fallback = buildAnalysisFromVerifiedArticles(
            displayLocation,
            preprocessed.verifiedArticles,
            preprocessingAudit
          );
          res.json(fallback);
          return;
        }

        // Otherwise normalize the verified incidents
        const normalizedIncidents = postFilteredIncidents.map(
          (item: any, idx: number) => {
            const desc = String(item?.description || '');
            const check = preprocessAndClassifyHeadline(desc);
            const crime_type = check.crime_type;
            const severity_impact = check.severity_impact;
            const csw =
              typeof item?.csw_weight === 'number' && item.csw_weight > 0
                ? item.csw_weight
                : check.csw;
            const source_type =
              item?.source_type === 'Social Media'
                ? 'Social Media'
                : 'Local News';
            const source_multiplier =
              source_type === 'Social Media' ? 0.5 : 1.0;

            const recencyStr = String(
              item?.recency ||
                preprocessed.verifiedArticles[idx]?.recencyText ||
                '2 weeks ago'
            );
            let recency_multiplier = 0.7;
            const lowerRec = recencyStr.toLowerCase();
            if (
              lowerRec.includes('hour') ||
              lowerRec.includes('today') ||
              lowerRec.includes('1 day') ||
              lowerRec.includes('2 day') ||
              lowerRec.includes('3 day') ||
              lowerRec.includes('4 day') ||
              lowerRec.includes('5 day') ||
              lowerRec.includes('6 day')
            ) {
              recency_multiplier = 1.0;
            } else if (lowerRec.includes('week')) {
              recency_multiplier = 0.7;
            } else if (lowerRec.includes('month')) {
              recency_multiplier = 0.4;
            } else if (lowerRec.includes('year')) {
              recency_multiplier = 0.1;
            }

            const calculated_penalty = Number(
              (csw * source_multiplier * recency_multiplier).toFixed(2)
            );

            return {
              crime_type,
              description: desc,
              source_type,
              source_name: String(
                item?.source_name ||
                  preprocessed.verifiedArticles[idx]?.sourceName ||
                  'Local News'
              ),
              recency: recencyStr,
              severity_impact,
              calculated_penalty,
              csw_weight: csw,
              source_multiplier,
              recency_multiplier,
              source_url:
                item?.source_url || preprocessed.verifiedArticles[idx]?.link,
              matched_zone:
                item?.matched_zone ||
                preprocessed.verifiedArticles[idx]?.matchedZone ||
                `Within 200m · ${displayLocation}`,
            };
          }
        );

        preprocessingAudit.verified_crime_count = normalizedIncidents.length;

        const total_penalty = Number(
          normalizedIncidents
            .reduce((acc: number, cur: any) => acc + cur.calculated_penalty, 0)
            .toFixed(2)
        );
        const safety_rating =
          normalizedIncidents.length === 0
            ? 5.0
            : Number(Math.max(1.0, 5.0 - total_penalty / 5).toFixed(1));
        const risk_level: 'Safe' | 'Moderate Risk' | 'High Risk' =
          safety_rating >= 4.0
            ? 'Safe'
            : safety_rating >= 3.0
              ? 'Moderate Risk'
              : 'High Risk';

        const groundingChunks =
          response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const groundingSources: { title: string; uri: string }[] = [];
        for (const chunk of groundingChunks) {
          if (chunk.web?.uri && chunk.web?.title) {
            if (!groundingSources.some((s) => s.uri === chunk.web!.uri)) {
              groundingSources.push({
                title: chunk.web.title,
                uri: chunk.web.uri,
              });
            }
          }
        }
        for (const art of preprocessed.verifiedArticles) {
          if (art.link && !groundingSources.some((s) => s.uri === art.link)) {
            groundingSources.push({
              title: `${art.sourceName}: ${art.title}`,
              uri: art.link,
            });
          }
        }

        res.json({
          location: displayLocation,
          safety_rating,
          risk_level,
          summary: String(
            parsed?.summary ||
              `200m radius analysis around ${displayLocation} completed across ${surroundingStreets.length} adjacent streets.`
          ),
          incident_breakdown: normalizedIncidents,
          safety_recommendations: Array.isArray(parsed?.safety_recommendations)
            ? parsed.safety_recommendations.map(String)
            : [
                'Stay on well-lit primary thoroughfares within the 200m zone after dusk.',
                'Keep valuables out of sight near transit entrances and intersections.',
              ],
          total_penalty,
          grounding_sources: groundingSources.slice(0, 8),
          preprocessing_audit: preprocessingAudit,
          missing_news_notice:
            normalizedIncidents.length === 0
              ? `No verified criminal offenses found within the 200m radius after preprocessing ${preprocessingAudit.raw_candidates_scanned} candidate articles.`
              : undefined,
          analyzed_at: new Date().toISOString(),
        });
        return;
      } catch (err: any) {
        console.warn(
          `Model ${modelName} attempt failed (${err?.status || err?.message || 'error'}), trying next...`
        );
      }
    }

    // Fallback to our deterministic 200m Preprocessed & Verified Engine if Gemini quota is temporarily exhausted
    const fallbackResult = buildAnalysisFromVerifiedArticles(
      displayLocation,
      preprocessed.verifiedArticles,
      preprocessingAudit
    );
    res.json(fallbackResult);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `SafeRoute Android server listening on http://localhost:${PORT}`
    );
  });
}

startServer();
