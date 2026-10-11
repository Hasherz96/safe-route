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
  /** When the crime itself happened (ISO), read from the article; falls back to pubDate. */
  incidentDate?: string;
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

  // 1F. Accidents, wildlife, disease and disasters: "killed in crash" or
  // "deadly dengue outbreak" is a tragedy, not a crime risk for visitors
  const deliberateHarmPattern =
    /\b(murder|murdered|stab|stabs|stabbed|stabbing|shot dead|gunmen|gunman|shooting|robbery|robbed|assault|assaulted|kidnap\w*|abduct\w*|rape|raped|sexual\w*|molest\w*|hacked|sword|grenade)\b/i;
  const accidentPattern =
    /\b(crash|crashes|crashed|accident|accidents|collision|collided|collides|run over|knocked down|overturned|toppled|derailed|drowned|drowning|lightning|landslide|electrocuted|tree fell|wall collapse)\b/i;
  const naturalCausePattern =
    /\b(elephant|wild animal|crocodile|leopard|snake ?bite|dog attack|dengue|outbreak|disease|virus|epidemic|flood|floods|cyclone|storm|tsunami|earthquake|fire broke out|blaze|wildfire|heatwave)\b/i;
  if (
    (accidentPattern.test(lower) || naturalCausePattern.test(lower)) &&
    !deliberateHarmPattern.test(lower)
  ) {
    return {
      isCrime: false,
      rejectionReason: 'Accident or natural incident (not a crime)',
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 0,
    };
  }

  // 1G. Allegations, denials and political/legal disputes ("MP refutes assault
  // allegations") are about claims, not an incident visitors could run into.
  // Keep them only when the headline also describes an actual incident.
  const disputePattern =
    /\b(refute[sd]?|refuting|den(?:y|ies|ied|ying)|rejects? (?:the )?(?:allegations?|claims?|charges?)|allegations?|defamation|lawsuit|sues|sued|hits? back|slams?|counter[- ]complaint|smear)\b/i;
  const incidentEvidencePattern =
    /\b(arrested|remanded|victims?|injured|hospitali[sz]ed|died|killed|dead|body|bodies|stabbed|stabbing|shot dead|gunfire|robbed|stolen|snatched|abducted|kidnapped|raped)\b/i;
  if (disputePattern.test(lower) && !incidentEvidencePattern.test(lower)) {
    return {
      isCrime: false,
      rejectionReason: 'Allegation, denial or dispute (no reported incident)',
      crime_type: 'Nuisance',
      severity_impact: 'Low',
      csw: 0,
    };
  }

  // 2. Classify Verified Criminal Incidents by CSW Category
  // Category A: Violent / High Severity (CSW = 10 to 12)
  const violentKeywords = [
    'shooting',
    'shot',
    'gunfire',
    'homicide',
    'murder',
    'kill',
    'stabbing',
    'stabbed',
    'stabs',
    'kidnap',
    'abduct',
    'armed robbery',
    'carjacking',
    'gunpoint',
    'gunman',
    'gunmen',
    'stray bullet',
    'mass shooting',
    // Sexual offences and child abuse
    'rape',
    'raped',
    'rapist',
    'sexual abuse',
    'sexually abused',
    'sexual assault',
    'sexually assaulted',
    'sexual harassment',
    'sexually harassed',
    'molest',
    'child abuse',
    'indecent assault',
    'grave sexual',
    ...(ENABLE_SRI_LANKA_PROTOTYPE ? SRI_LANKA_CRIME_KEYWORDS.violent : []),
  ];
  if (hasAnyKeyword(lower, violentKeywords)) {
    // Loss of life, sexual offences against a person, and abductions are the most severe
    const isExtreme = hasAnyKeyword(lower, [
      'homicide',
      'murder',
      'kill',
      'fatal',
      'mass shooting',
      'hacked to death',
      'grenade attack',
      'contract killing',
      'rape',
      'raped',
      'rapist',
      'sexual abuse',
      'sexually abused',
      'sexual assault',
      'sexually assaulted',
      'molest',
      'child abuse',
      'grave sexual',
      'kidnap',
      'abduct',
    ]);
    // A robbery at gunpoint threatens violence; a shooting or stabbing is violence done
    const isArmedThreatOnly =
      hasAnyKeyword(lower, ['armed robbery', 'gunpoint', 'carjacking']) &&
      !hasAnyKeyword(lower, [
        'shooting',
        'shot',
        'gunfire',
        'open fire',
        'opened fire',
        'stabbing',
        'stabbed',
        'stabs',
        'stray bullet',
        'hand grenade',
        'sword attack',
        'sharp weapon',
      ]);
    return {
      isCrime: true,
      crime_type: 'Violent',
      severity_impact: 'High',
      csw: isExtreme ? 12 : isArmedThreatOnly ? 8 : 10,
    };
  }

  // Category B: Property / Moderate Severity (CSW = 5 to 7). Each keyword maps
  // to the crime type it actually describes, so an assault isn't shown as a burglary.
  const moderateKeywordsByType: Record<'Violent' | 'Burglary' | 'Theft', string[]> = {
    Violent: ['assault', 'attacked', 'unprovoked attack'],
    Burglary: ['burglary', 'burglar', 'home invasion', 'house break', 'housebreak'],
    Theft: [
      'robber',
      'robbed',
      'robbing',
      'auto theft',
      'stolen car',
      'stolen vehicle',
      'smash-and-grab',
      'smash and grab',
      'looting',
      ...(ENABLE_SRI_LANKA_PROTOTYPE ? SRI_LANKA_CRIME_KEYWORDS.moderate : []),
    ],
  };
  for (const [crime_type, keywords] of Object.entries(moderateKeywordsByType)) {
    if (!hasAnyKeyword(lower, keywords)) continue;
    // Every word form of the same offence carries the same weight
    const isHigherMod = hasAnyKeyword(lower, [
      'assault',
      'attacked',
      'unprovoked attack',
      'robber',
      'robbed',
      'robbing',
      'home invasion',
      'smash-and-grab',
      'smash and grab',
    ]);
    return {
      isCrime: true,
      crime_type: crime_type as CrimeType,
      severity_impact: 'Medium',
      csw: isHigherMod ? 7 : 5,
    };
  }

  // Category C: Minor Crimes (CSW = 2 to 3)
  const minorKeywordsByType: Record<'Burglary' | 'Theft' | 'Nuisance', string[]> = {
    Burglary: ['break-in', 'car break-in', 'bipping', 'broke into', 'broken into'],
    Theft: [
      'theft',
      'shoplifting',
      'pickpocket',
      'stolen',
      'larceny',
      'package thief',
      'retail theft',
      'retail crime',
    ],
    Nuisance: [
      'vandalism',
      'vandalized',
      'vandalised',
      'graffiti',
      'damage to',
      'damaging property',
      'property damage',
    ],
  };
  for (const [crime_type, keywords] of Object.entries(minorKeywordsByType)) {
    if (!hasAnyKeyword(lower, keywords)) continue;
    return {
      isCrime: true,
      crime_type: crime_type as CrimeType,
      severity_impact: 'Low',
      csw: hasAnyKeyword(lower, ['break-in', 'broke into', 'broken into', 'bipping', 'retail'])
        ? 3
        : 2,
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
  const { recencyMultiplier } = computeRecencyFromDate(art.incidentDate || art.pubDate);
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
    matched_zone:
      item?.matched_zone || `Within 200m · ${describeMatchedPlace(description, displayLocation)}`,
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

const VISITOR_TIP_BY_CRIME: Record<CrimeType, string> = {
  Violent: 'Avoid walking alone here late at night.',
  Theft: 'Keep your phone and wallet out of sight, especially in crowds.',
  Burglary: 'Lock your vehicle and don’t leave bags visible inside.',
  Nuisance: 'Steer clear of rowdy groups, especially after dark.',
};

const GENERAL_VISITOR_TIPS = [
  'Stick to busy, well-lit main roads after dark.',
  'Share your live location with someone you trust.',
];

export const MAX_VISITOR_TIPS = 3;
export const MAX_VISITOR_TIP_LENGTH = 90;

/**
 * Short, plain-language visitor tips driven by which crime types were found,
 * most common first, topped up with general advice.
 */
export function buildVisitorTips(incidents: IncidentItem[]): string[] {
  if (incidents.length === 0) {
    return [
      'No recent crimes reported here. Normal caution is enough.',
      'Keep valuables secure in busy spots.',
      GENERAL_VISITOR_TIPS[0],
    ];
  }

  const counts = new Map<CrimeType, number>();
  for (const inc of incidents) {
    counts.set(inc.crime_type, (counts.get(inc.crime_type) || 0) + 1);
  }
  const crimeTips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([crimeType]) => VISITOR_TIP_BY_CRIME[crimeType])
    .filter(Boolean);

  return [...crimeTips, ...GENERAL_VISITOR_TIPS].slice(0, MAX_VISITOR_TIPS);
}

/** True when model-written tips are present and short enough to scan quickly. */
export function areVisitorTipsConcise(tips: unknown): tips is string[] {
  return (
    Array.isArray(tips) &&
    tips.length > 0 &&
    tips.every(
      (t) => typeof t === 'string' && t.trim().length > 0 && t.length <= MAX_VISITOR_TIP_LENGTH
    )
  );
}

// Words that name a kind of place, so "Pettah" + "Bus Stand" reads as one location
const PLACE_NOUN_REGEX =
  /^(bus|stand|station|terminal|railway|market|junction|road|rd|street|st|mawatha|lane|hospital|temple|kovil|mosque|church|park|bridge|fort|mall|bazaar|square|roundabout|harbour|port|school|college|grounds?)$/i;

const GENERIC_PLACE_TOKENS = ['sri', 'lanka', 'city', 'district', 'province', 'western', 'downtown'];

const normalizeWord = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');
const stripWordPunctuation = (word: string) => word.replace(/^[^\w]+|[^\w]+$/g, '');
const toTitleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Human-readable location for an incident: the place as named in the headline
 * (e.g. "Pettah Bus Stand"), falling back to the main word of the searched
 * place (e.g. "Pettah") rather than the full search text.
 */
export function describeMatchedPlace(headline: string, placeHint: string): string {
  const hintTokens = placeHint
    .split(/[\s,]+/)
    .map(normalizeWord)
    .filter((t) => t.length >= 4 && !GENERIC_PLACE_TOKENS.includes(t));
  const words = headline.split(/\s+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    if (!hintTokens.includes(normalizeWord(words[i]))) continue;

    let lastPlaceWord = i;
    for (let j = i + 1; j < words.length && j <= i + 4; j++) {
      // Phrase ends at punctuation like "Pettah," or "Stand -"
      if (/[,.:;!?]$/.test(words[j - 1])) break;
      const word = stripWordPunctuation(words[j]);
      if (!word) break;
      if (PLACE_NOUN_REGEX.test(word)) lastPlaceWord = j;
      else if (!/^[A-Z]/.test(word)) break;
    }

    return words
      .slice(i, lastPlaceWord + 1)
      .map((w) => toTitleCase(stripWordPunctuation(w)))
      .join(' ');
  }

  return hintTokens.length > 0
    ? toTitleCase(hintTokens[0])
    : placeHint.split(',')[0].trim();
}

const HEADLINE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'over', 'near', 'after', 'before',
  'at', 'to', 'in', 'on', 'of', 'by', 'an', 'is', 'are', 'was', 'were', 'has', 'have',
  'its', 'his', 'her', 'their', 'who', 'new', 'newly', 'video', 'news', 'report', 'reported',
]);

const stemWord = (word: string) =>
  word.replace(/(ing|ed|es|s)$/, '').replace(/e$/, '');

function headlineKeywords(headline: string, placeWords: Set<string>): Set<string> {
  const keywords = new Set<string>();
  for (const raw of headline.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || HEADLINE_STOPWORDS.has(raw) || placeWords.has(raw)) continue;
    keywords.add(stemWord(raw));
  }
  return keywords;
}

function placeWordsFor(incident: IncidentItem, placeHint: string): Set<string> {
  const zone = (incident.matched_zone || '').replace(/^Within 200\s?m\s*·\s*/i, '');
  return new Set(
    `${zone} ${placeHint}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

/** True when two reports' publish times are close enough to be the same event. */
function publishedAroundSameTime(a: IncidentItem, b: IncidentItem): boolean {
  const daysA = parseRecencyTextToDays(a.recency);
  const daysB = parseRecencyTextToDays(b.recency);
  if (daysA === null || daysB === null) return true;
  // Older reports only have month-level precision ("6 months ago"), so widen the window
  const window = Math.max(14, 0.15 * Math.max(daysA, daysB));
  return Math.abs(daysA - daysB) <= window;
}

/**
 * True when two incidents look like different outlets reporting the same event:
 * same crime type, similar timing, and most non-place headline keywords shared.
 */
export function isSameIncident(a: IncidentItem, b: IncidentItem, placeHint: string): boolean {
  if (a.crime_type !== b.crime_type) return false;
  if (!publishedAroundSameTime(a, b)) return false;

  const wordsA = headlineKeywords(a.description, placeWordsFor(a, placeHint));
  const wordsB = headlineKeywords(b.description, placeWordsFor(b, placeHint));
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared >= 3 && shared / Math.min(wordsA.size, wordsB.size) >= 0.6;
}

/**
 * Collapses multiple news reports of the same incident into one entry so it is
 * listed and scored once. The first report (feed articles come first) is kept.
 */
export function dedupeIncidents(incidents: IncidentItem[], placeHint: string): IncidentItem[] {
  const groups: IncidentItem[][] = [];
  for (const incident of incidents) {
    const group = groups.find((g) => g.some((member) => isSameIncident(member, incident, placeHint)));
    if (group) group.push(incident);
    else groups.push([incident]);
  }

  return groups.map((group) => {
    const reportCount = group.reduce((n, item) => n + (item.report_count ?? 1), 0);
    return reportCount > 1 ? { ...group[0], report_count: reportCount } : group[0];
  });
}
