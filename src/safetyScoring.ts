/**
 * Deterministic crime classification, recency weighting and incident scoring
 * shared by the 200m safety analysis endpoint. Kept free of server/network
 * side effects so it can be unit tested directly.
 */

import { ENABLE_SRI_LANKA_PROTOTYPE } from './sriLankaPrototype/sriLankaConfig';
import { SRI_LANKA_CRIME_KEYWORDS } from './sriLankaPrototype/sriLankaNewsEngine';
import type { CrimeType, IncidentItem, RiskLevel, SeverityImpact, SourceType } from './types/safety';

export interface RawFeedArticle {
  title: string;
  pubDate: string;
  sourceName: string;
  sourceType: SourceType;
  link: string;
  daysAgo: number;
  recencyText: string;
  matchedZone: string;
}

export interface RejectedArticle {
  title: string;
  reason: string;
}

/** Articles and incidents older than this are discarded before scoring. */
export const MAX_ARTICLE_AGE_DAYS = 180;

/**
 * Recency multiplier: <= 7 days = 1.0 | <= 30 days = 0.7 | <= 90 days = 0.4 | <= 180 days = 0.1.
 * Anything older than MAX_ARTICLE_AGE_DAYS is excluded upstream and never scored.
 */
export function recencyMultiplierFromDays(daysAgo: number): number {
  return daysAgo <= 7 ? 1.0 : daysAgo <= 30 ? 0.7 : daysAgo <= 90 ? 0.4 : 0.1;
}

export function computeRecencyFromDate(dateStr: string): {
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

  return { daysAgo, recencyText, recencyMultiplier: recencyMultiplierFromDays(daysAgo) };
}

const UNIT_DAYS: Record<string, number> = {
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

/**
 * Parses free-text recency such as "11 days ago", "a week ago", "yesterday"
 * (as returned by Gemini) into an approximate age in days.
 * Returns null when the text cannot be interpreted.
 */
export function parseRecencyTextToDays(text: string): number | null {
  const lower = text.toLowerCase();
  if (/\b(just now|today|this morning|tonight|this evening)\b/.test(lower)) return 0;
  if (/\byesterday\b/.test(lower)) return 1;
  if (/\blast week\b/.test(lower)) return 7;
  if (/\blast month\b/.test(lower)) return 30;
  if (/\blast year\b/.test(lower)) return 365;

  const m = lower.match(/\b(\d+(?:\.\d+)?|an?|one)\s*(hour|day|week|month|year)s?\b/);
  if (!m) return null;
  const qty = /^\d/.test(m[1]) ? Number(m[1]) : 1;
  return qty * UNIT_DAYS[m[2]];
}

/** Recency multiplier for free-text recency; unparseable text defaults to 0.7. */
export function recencyMultiplierFromText(text: string): number {
  const days = parseRecencyTextToDays(text);
  return days === null ? 0.7 : recencyMultiplierFromDays(days);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keyword match anchored at a word start, so "killed" does not match "skilled"
 * and "shot" does not match "screenshot", while inflections such as
 * "murdered" or "shots" still match.
 */
export function hasKeyword(lowerText: string, keyword: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword.toLowerCase())}`).test(lowerText);
}

function hasAnyKeyword(lowerText: string, keywords: string[]): boolean {
  return keywords.some((kw) => hasKeyword(lowerText, kw));
}

export interface HeadlineClassification {
  isCrime: boolean;
  rejectionReason?: string;
  crime_type: CrimeType;
  severity_impact: SeverityImpact;
  csw: number;
}

/**
 * STAGE 1 PREPROCESSOR:
 * Distinguishes actual criminal incidents from film/movie shoots (e.g. "Spider-Man shooting location"),
 * photo shoots, sports metaphors, and non-crime news.
 */
export function preprocessAndClassifyHeadline(title: string): HeadlineClassification {
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
  if (hasAnyKeyword(lower, violentKeywords)) {
    const isExtreme = hasAnyKeyword(lower, [
      'homicide',
      'murder',
      'fatal',
      'killed',
      'mass shooting',
      'hacked to death',
      'grenade attack',
    ]);
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
  if (hasAnyKeyword(lower, moderateKeywords)) {
    const isHigherMod = hasAnyKeyword(lower, [
      'assault',
      'robbery',
      'home invasion',
      'smash-and-grab',
    ]);
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
  if (hasAnyKeyword(lower, minorKeywords)) {
    return {
      isCrime: true,
      crime_type: 'Theft',
      severity_impact: 'Low',
      csw: hasAnyKeyword(lower, ['break-in', 'retail']) ? 3 : 2,
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
  if (hasAnyKeyword(lower, nuisanceKeywords)) {
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

function significantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );
}

/**
 * Finds the verified feed article that a Gemini-returned incident refers to,
 * by exact source URL or by headline token overlap. Used instead of the
 * incident's array position, which shifts once incidents are filtered.
 */
export function findMatchingArticle(
  item: { description?: unknown; source_url?: unknown },
  articles: RawFeedArticle[]
): RawFeedArticle | undefined {
  const url = typeof item.source_url === 'string' ? item.source_url.trim() : '';
  if (url) {
    const byUrl = articles.find((a) => a.link && a.link === url);
    if (byUrl) return byUrl;
  }

  const descTokens = significantTokens(String(item.description || ''));
  if (descTokens.size === 0) return undefined;

  let best: RawFeedArticle | undefined;
  let bestScore = 0;
  for (const art of articles) {
    const titleTokens = significantTokens(art.title);
    if (titleTokens.size === 0) continue;
    let shared = 0;
    for (const t of titleTokens) if (descTokens.has(t)) shared++;
    // Overlap relative to the shorter text, so a paraphrase that quotes the headline still matches
    const score = shared / Math.min(titleTokens.size, descTokens.size);
    if (score > bestScore) {
      bestScore = score;
      best = art;
    }
  }
  return bestScore >= 0.6 ? best : undefined;
}

/** Scores a verified feed article using its own publication date and source. */
export function incidentFromArticle(art: RawFeedArticle): IncidentItem {
  const { crime_type, severity_impact, csw } = preprocessAndClassifyHeadline(art.title);
  const source_multiplier = art.sourceType === 'Social Media' ? 0.5 : 1.0;
  const { recencyMultiplier } = computeRecencyFromDate(art.pubDate);
  return {
    crime_type,
    description: art.title,
    source_type: art.sourceType,
    source_name: art.sourceName,
    recency: art.recencyText,
    severity_impact,
    calculated_penalty: Number((csw * source_multiplier * recencyMultiplier).toFixed(2)),
    csw_weight: csw,
    source_multiplier,
    recency_multiplier: recencyMultiplier,
    source_url: art.link,
    matched_zone: art.matchedZone,
  };
}

/** Scores a Gemini-only incident (one not backed by a verified feed article). */
export function incidentFromGeminiItem(item: any, displayLocation: string): IncidentItem {
  const description = String(item?.description || '');
  const check = preprocessAndClassifyHeadline(description);
  const csw =
    typeof item?.csw_weight === 'number' && item.csw_weight > 0 ? item.csw_weight : check.csw;
  const source_type: SourceType =
    item?.source_type === 'Social Media' ? 'Social Media' : 'Local News';
  const source_multiplier = source_type === 'Social Media' ? 0.5 : 1.0;
  const recency = String(item?.recency || '2 weeks ago');
  const recency_multiplier = recencyMultiplierFromText(recency);

  return {
    crime_type: check.crime_type,
    description,
    source_type,
    source_name: String(item?.source_name || 'Local News'),
    recency,
    severity_impact: check.severity_impact,
    calculated_penalty: Number((csw * source_multiplier * recency_multiplier).toFixed(2)),
    csw_weight: csw,
    source_multiplier,
    recency_multiplier,
    source_url: typeof item?.source_url === 'string' ? item.source_url : undefined,
    matched_zone: item?.matched_zone || `Within 200m · ${displayLocation}`,
  };
}

/**
 * Combines Gemini's (already crime-filtered) incidents with the verified feed
 * articles. Every verified article is always scored exactly once, from its own
 * metadata; Gemini incidents that refer to one of them are deduplicated, and
 * only incidents Gemini found on its own are added on top (unless their
 * recency is older than MAX_ARTICLE_AGE_DAYS).
 */
export function mergeIncidents(
  geminiItems: any[],
  verifiedArticles: RawFeedArticle[],
  displayLocation: string
): IncidentItem[] {
  const geminiOnly = geminiItems.filter((item) => {
    if (findMatchingArticle(item, verifiedArticles)) return false;
    const ageDays = parseRecencyTextToDays(String(item?.recency || ''));
    return ageDays === null || ageDays <= MAX_ARTICLE_AGE_DAYS;
  });
  return [
    ...verifiedArticles.map(incidentFromArticle),
    ...geminiOnly.map((item) => incidentFromGeminiItem(item, displayLocation)),
  ];
}

export function scoreIncidents(incidents: IncidentItem[]): {
  total_penalty: number;
  safety_rating: number;
  risk_level: RiskLevel;
} {
  const total_penalty = Number(
    incidents.reduce((sum, inc) => sum + inc.calculated_penalty, 0).toFixed(2)
  );
  const safety_rating =
    incidents.length === 0 ? 5.0 : Number(Math.max(1.0, 5.0 - total_penalty / 5).toFixed(1));
  const risk_level: RiskLevel =
    safety_rating >= 4.0 ? 'Safe' : safety_rating >= 3.0 ? 'Moderate Risk' : 'High Risk';
  return { total_penalty, safety_rating, risk_level };
}
