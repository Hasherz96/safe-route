import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { ENABLE_SRI_LANKA_PROTOTYPE } from './src/sriLankaPrototype/sriLankaConfig';
import {
  buildSriLankaNationalNewsQueries,
  distinctivePlaceWords,
  extractSriLankaLocalityTokens,
  fetchArticlePublishDate,
  fetchDirectSriLankaRssFeeds,
  fuzzyLocalityMatch,
  getSriLankaGeminiPromptAppendix,
  hasDistinctivePlaceWord,
  matchSriLankaNationalOutlet,
} from './src/sriLankaPrototype/sriLankaNewsEngine';
import {
  fetchArticleDetails,
  findIncidentDateInText,
  isPlausibleIncidentDate,
} from './src/articleDates';
import { describeFetchError, logFetch } from './src/fetchLog';
import {
  areVisitorTipsConcise,
  MAX_VISITOR_TIPS,
  buildVisitorTips,
  computeRecencyFromDate,
  dedupeIncidents,
  describeMatchedPlace,
  findMatchingArticle,
  incidentFromArticle,
  MAX_ARTICLE_AGE_DAYS,
  mergeIncidents,
  preprocessAndClassifyHeadline,
  scoreIncidents,
  type RawFeedArticle,
  type RejectedArticle,
} from './src/safetyScoring';

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
   - Most severe (Murder, Homicide, Rape, Sexual Assault/Abuse, Molestation, Child Abuse, Kidnapping, Abduction): CSW = 12
   - Violent / High Severity (Shooting, Stabbing, Sword/Weapon Attack): CSW = 10
   - Armed threat without injury (Armed Robbery, Robbery at Gunpoint, Carjacking): CSW = 8
   - Property / Moderate Severity (Burglary, Auto Theft, Assault, Robbery): CSW = 5 to 7
   - Accidents, disease outbreaks, animal attacks and natural disasters are NOT crimes, even if "deadly" or "fatal"
   - Minor Crimes (Petty Theft, Shoplifting, Pickpocketing, Vandalism, Vehicle Break-in, Larceny): CSW = 2 to 3
   - Nuisance / Low Risk (Public Intoxication, Loitering, Noise, Trespassing, Disorderly Conduct): CSW = 1
3. Multipliers:
   - Source Multiplier: Credible Local/National News = 1.0 | Social Media (Reddit, X, Facebook) = 0.5
   - Recency Multiplier: < 7 days = 1.0 | 8–30 days = 0.7 | 31–90 days = 0.4 | 91–180 days = 0.1
   - EXCLUDE any incident older than 180 days entirely; do not list it in incident_breakdown.
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
    "Keep your phone and wallet out of sight, especially in crowds.",
    "Avoid walking alone here late at night.",
    "Stick to busy, well-lit main roads after dark."
  ]
}

### VISITOR TIPS (safety_recommendations):
- Exactly 3 tips for someone visiting this area, most important first.
- Each tip is ONE short sentence of at most 12 words, starting with an action verb.
- Base the tips on the crime types actually found (e.g. theft -> guard phone/wallet; violent -> avoid being alone at night).
- Use plain everyday language. No jargon (e.g. "200m perimeter", "corridors", "telemetry", "situational awareness"), no statistics, no counts, no scores.${ENABLE_SRI_LANKA_PROTOTYPE ? getSriLankaGeminiPromptAppendix() : ''}`;

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

  // Check direct target place name match or fuzzy locality match. A bare city
  // name ("Kandy") is too broad to place a story within 200m; a fuller phrase
  // ("Kandy City Centre") is fine.
  const targetIsSpecific =
    cleanTarget.split(/\s+/).length >= 2 || hasDistinctivePlaceWord(cleanTarget);
  if (cleanTarget && cleanTarget.length >= 3) {
    if (
      (targetIsSpecific && lowerTitle.includes(cleanTarget)) ||
      (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, cleanTarget))
    ) {
      return {
        matched: true,
        matchedZone: `Within 200m · ${describeMatchedPlace(title, locationName)}`,
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
        hasDistinctivePlaceWord(streetBase) &&
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
      (cleanPlace.length >= 4 &&
        (cleanPlace.split(/\s+/).length >= 2 || hasDistinctivePlaceWord(cleanPlace)) &&
        lowerTitle.includes(cleanPlace)) ||
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
    // Localities come from the address: words of a business name ("Perera & Sons")
    // aren't places
    const localities = address
      ? extractSriLankaLocalityTokens('', address)
      : extractSriLankaLocalityTokens(locationName);
    for (const locToken of localities) {
      if (!hasDistinctivePlaceWord(locToken)) continue;
      const lowerLoc = locToken.toLowerCase();
      if (
        (lowerLoc.length >= 4 && lowerTitle.includes(lowerLoc)) ||
        fuzzyLocalityMatch(title, locToken)
      ) {
        return {
          matched: true,
          matchedZone: `Within 200m · ${describeMatchedPlace(title, locToken)}`,
        };
      }
    }
  }

  // Also check individual significant tokens of the searched place name
  const targetTokens = distinctivePlaceWords(cleanTarget).filter(
    (t) => t !== 'downtown'
  );
  if (
    targetTokens.length > 0 &&
    targetTokens.every(
      (t) => lowerTitle.includes(t) || (ENABLE_SRI_LANKA_PROTOTYPE && fuzzyLocalityMatch(title, t))
    )
  ) {
    return {
      matched: true,
      matchedZone: `Within 200m · ${describeMatchedPlace(title, locationName)}`,
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
  rejectedTooOldCount: number;
  rejectedExamples: RejectedArticle[];
}> {
  const verifiedArticles: RawFeedArticle[] = [];
  const rejectedExamples: RejectedArticle[] = [];
  let rawCount = 0;
  let rejectedNonCrimeCount = 0;
  let rejectedOutsideRadiusCount = 0;
  let rejectedTooOldCount = 0;

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

        // Some outlet feeds (e.g. Ada Derana) omit <pubDate>; read it from the article page instead
        if (Number.isNaN(Date.parse(art.pubDate))) {
          art.pubDate = (await fetchArticlePublishDate(art.link)) || art.pubDate;
        }

        const { daysAgo, recencyText } = computeRecencyFromDate(art.pubDate);
        if (daysAgo > MAX_ARTICLE_AGE_DAYS) {
          rejectedTooOldCount++;
          if (rejectedExamples.length < 5) {
            rejectedExamples.push({
              title: art.title,
              reason: `Filtered: Older than ${MAX_ARTICLE_AGE_DAYS} days`,
            });
          }
          continue;
        }
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
    const startedAt = Date.now();
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

      if (!res.ok) {
        logFetch({
          source: 'google_news',
          ok: false,
          ms: Date.now() - startedAt,
          status: res.status,
          finalUrl: res.url.slice(0, 120),
          query: queryStr.slice(0, 80),
        });
      }

      if (res.ok) {
        const xml = await res.text();
        const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
        logFetch({
          source: 'google_news',
          ok: true,
          ms: Date.now() - startedAt,
          status: res.status,
          items: itemMatches.length,
          query: queryStr.slice(0, 80),
          // A consent or "unusual traffic" page comes back as 200 with no items
          ...(itemMatches.length === 0
            ? { finalUrl: res.url.slice(0, 120), bodyStart: xml.slice(0, 160) }
            : {}),
        });
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
          if (daysAgo > MAX_ARTICLE_AGE_DAYS) {
            rejectedTooOldCount++;
            if (rejectedExamples.length < 5) {
              rejectedExamples.push({
                title: cleanTitle,
                reason: `Filtered: Older than ${MAX_ARTICLE_AGE_DAYS} days`,
              });
            }
            continue;
          }
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
    } catch (err) {
      // A failed query shouldn't stop the others
      logFetch({
        source: 'google_news',
        ok: false,
        ms: Date.now() - startedAt,
        error: describeFetchError(err),
        query: queryStr.slice(0, 80),
      });
    }
  }

  // Also check Reddit community reports for the 200m zone
  const redditStartedAt = Date.now();
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
    logFetch({
      source: 'reddit',
      ok: res.ok,
      ms: Date.now() - redditStartedAt,
      status: res.status,
    });

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
        if (daysAgo > MAX_ARTICLE_AGE_DAYS) {
          rejectedTooOldCount++;
          if (rejectedExamples.length < 5) {
            rejectedExamples.push({
              title: cleanTitle,
              reason: `Filtered: Older than ${MAX_ARTICLE_AGE_DAYS} days`,
            });
          }
          continue;
        }

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
  } catch (err) {
    logFetch({
      source: 'reddit',
      ok: false,
      ms: Date.now() - redditStartedAt,
      error: describeFetchError(err),
    });
  }

  // Recency is about when the crime happened, not when it was reported
  const datedArticles = (await applyIncidentDates(verifiedArticles)).filter((art) => {
    if (art.daysAgo <= MAX_ARTICLE_AGE_DAYS) return true;
    rejectedTooOldCount++;
    if (rejectedExamples.length < 5) {
      rejectedExamples.push({
        title: art.title,
        reason: `Filtered: Crime happened over ${MAX_ARTICLE_AGE_DAYS} days ago`,
      });
    }
    return false;
  });

  datedArticles.sort((a, b) => a.daysAgo - b.daysAgo);
  return {
    verifiedArticles: datedArticles.slice(0, 8),
    rawCount,
    rejectedNonCrimeCount,
    rejectedOutsideRadiusCount,
    rejectedTooOldCount,
    rejectedExamples,
  };
}

const INCIDENT_DATE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Asks Gemini, in one batched call, when each article's crime actually
 * happened. Returns YYYY-MM-DD per article index; articles it can't date are
 * left out. An empty map means Gemini was unavailable.
 */
async function extractIncidentDatesWithGemini(
  items: { id: number; published: string; headline: string; text: string }[]
): Promise<Map<number, string>> {
  const dates = new Map<number, string>();
  if (items.length === 0) return dates;

  const prompt = `For each news article below, give the date the crime or incident itself happened.
- Use the article text, not the publish date. Resolve words like "yesterday", "last night" or "on Monday" relative to the article's publish date.
- If the article is about an arrest, court case or investigation, give the date of the original crime when the text states it.
- If the text does not say when the crime happened, use null. Do not guess.
Respond ONLY with JSON: {"dates":[{"id":0,"incident_date":"YYYY-MM-DD" or null}]}

Articles:
${JSON.stringify(
  items.map((item) => ({
    id: item.id,
    published: item.published.slice(0, 10),
    headline: item.headline,
    text: item.text.slice(0, 1500),
  }))
)}`;

  for (const model of ['gemini-3.1-flash-lite', 'gemini-flash-latest']) {
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: prompt,
          config: { temperature: 0, responseMimeType: 'application/json' },
        }),
        10000
      );
      const parsed = extractJsonObject(response.text || '');
      for (const entry of Array.isArray(parsed?.dates) ? parsed.dates : []) {
        const item = items.find((i) => i.id === entry?.id);
        const day = typeof entry?.incident_date === 'string' ? entry.incident_date : '';
        if (item && isPlausibleIncidentDate(day, item.published)) dates.set(item.id, day);
      }
      return dates;
    } catch (err: any) {
      // Try the next model; if none respond, callers use the rule-based fallback
      logFetch({
        source: 'gemini_dates',
        model,
        ok: false,
        ms: Date.now() - startedAt,
        status: err?.status,
        error: describeFetchError(err),
      });
    }
  }
  return dates;
}

/**
 * Reads each verified article to find when the crime actually happened, since
 * it is often days before publication. Gemini reads the text; if it can't, a
 * rule-based reader checks the opening sentences; otherwise the publish date
 * is kept. Social media posts are dated by when they were posted.
 */
async function applyIncidentDates(articles: RawFeedArticle[]): Promise<RawFeedArticle[]> {
  const dateAll = async (): Promise<RawFeedArticle[]> => {
    const published = articles.map((art) =>
      Number.isNaN(Date.parse(art.pubDate)) ? null : new Date(art.pubDate).toISOString()
    );
    const texts = await Promise.all(
      articles.map(async (art, i) =>
        art.sourceType === 'Social Media' || !published[i]
          ? ''
          : (await fetchArticleDetails(art.link)).text
      )
    );

    const geminiDates = await extractIncidentDatesWithGemini(
      articles
        .map((art, id) => ({ id, published: published[id] || '', headline: art.title, text: texts[id] }))
        .filter((item) => item.text && item.published)
    );

    return articles.map((art, i) => {
      const publishedIso = published[i];
      if (!publishedIso) return art;
      const incidentDay =
        geminiDates.get(i) ?? (texts[i] ? findIncidentDateInText(texts[i], publishedIso) : null);
      if (!incidentDay) return art;

      // Same day as publishing: keep the publish time so "3 hours ago" stays accurate
      const incidentDate =
        incidentDay === publishedIso.slice(0, 10) ? art.pubDate : `${incidentDay}T12:00:00Z`;
      const { daysAgo, recencyText } = computeRecencyFromDate(incidentDate);
      return { ...art, incidentDate, daysAgo, recencyText };
    });
  };

  try {
    return await withTimeout(dateAll(), INCIDENT_DATE_TIMEOUT_MS);
  } catch {
    return articles;
  }
}

function buildAnalysisFromVerifiedArticles(
  locationLabel: string,
  articles: RawFeedArticle[],
  preprocessingAudit: any
) {
  const incident_breakdown = dedupeIncidents(
    articles.map(incidentFromArticle),
    locationLabel
  );
  const { total_penalty, safety_rating, risk_level } =
    scoreIncidents(incident_breakdown);

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

  const safety_recommendations = buildVisitorTips(incident_breakdown);

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
  // Cloud Run and similar hosts choose the port through $PORT
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Browser config that a deployed container provides at runtime rather than
  // baking into the build. The Maps key is public by design; restrict it to the
  // app's domain in Google Cloud Console.
  app.get('/api/config', (_req, res) => {
    res.json({
      googleMapsApiKey:
        process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '',
    });
  });

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
    const preprocessStartedAt = Date.now();
    const preprocessed = await fetchAndPreprocess200mCrimeReports(
      locationName || address,
      address,
      surroundingStreets,
      nearbyPlaceNames
    );
    // One line per search summarising what each filter stage kept
    console.log(
      JSON.stringify({
        severity: 'INFO',
        event: 'crime_scan_summary',
        place: String(locationName || address).slice(0, 80),
        ms: Date.now() - preprocessStartedAt,
        streetsFromMaps: surroundingStreets.length,
        placesFromMaps: nearbyPlaceNames.length,
        scanned: preprocessed.rawCount,
        rejectedNonCrime: preprocessed.rejectedNonCrimeCount,
        rejectedOutsideRadius: preprocessed.rejectedOutsideRadiusCount,
        rejectedTooOld: preprocessed.rejectedTooOldCount,
        verified: preprocessed.verifiedArticles.length,
      })
    );

    const preprocessingAudit = {
      raw_candidates_scanned: preprocessed.rawCount,
      rejected_non_crime_count: preprocessed.rejectedNonCrimeCount,
      rejected_outside_radius_count: preprocessed.rejectedOutsideRadiusCount,
      rejected_too_old_count: preprocessed.rejectedTooOldCount,
      verified_crime_count: preprocessed.verifiedArticles.length,
      rejected_examples: preprocessed.rejectedExamples,
      scanned_streets_200m: surroundingStreets,
      scanned_places_200m: nearbyPlaceNames.slice(0, 10),
    };

    const coordContext =
      coordinates && typeof coordinates.lat === 'number'
        ? ` (Center Coordinates: ${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}, Radius: 200m)`
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

    const prompt = `Analyze the 200-meter radius crime intelligence around: "${targetLabel}"${coordContext}.${neighborhoodContext}${verifiedFeedContext}

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
      const startedAt = Date.now();
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

          // Incidents Gemini found on its own must pass the same 200m check as feed articles
          if (findMatchingArticle(item, preprocessed.verifiedArticles)) return true;
          const zone = verify200mZoneMatch(
            String(item?.description || ''),
            locationName || address,
            surroundingStreets,
            nearbyPlaceNames,
            address
          );
          if (!zone.matched) {
            preprocessingAudit.rejected_outside_radius_count++;
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

        // Otherwise score every verified 200m article from its own metadata, plus
        // any additional incidents Gemini found that aren't one of those articles
        const normalizedIncidents = dedupeIncidents(
          mergeIncidents(
            postFilteredIncidents,
            preprocessed.verifiedArticles,
            displayLocation
          ),
          displayLocation
        );

        preprocessingAudit.verified_crime_count = normalizedIncidents.length;

        const { total_penalty, safety_rating, risk_level } =
          scoreIncidents(normalizedIncidents);

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
          safety_recommendations: areVisitorTipsConcise(
            parsed?.safety_recommendations
          )
            ? parsed.safety_recommendations
                .slice(0, MAX_VISITOR_TIPS)
                .map((t: string) => t.trim())
            : buildVisitorTips(normalizedIncidents),
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
        logFetch({
          source: 'gemini_analysis',
          model: modelName,
          ok: false,
          ms: Date.now() - startedAt,
          status: err?.status,
          error: describeFetchError(err),
        });
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
