/**
 * Finds when a reported crime actually happened, which is often days before the
 * article was published ("...was stabbed on Monday" in a Thursday article).
 *
 * Pure helpers (text extraction, date-phrase parsing) are exported for tests;
 * the network helpers resolve Google News links to the outlet's article and
 * fetch its text.
 */

import { describeFetchError, logFetch } from './fetchLog';

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

const DAY_MS = 24 * 60 * 60 * 1000;

/** An incident can't be after its report, and anything over a year earlier is a parsing mistake. */
const MAX_INCIDENT_LEAD_DAYS = 365;

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_PATTERN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const monthIndex = (name: string) =>
  MONTHS.findIndex((m) => m.startsWith(name.toLowerCase().slice(0, 3)));

const toIsoDay = (date: Date) => date.toISOString().slice(0, 10);

/** Calendar day (UTC) of an ISO timestamp or date string. */
function dayOf(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * True when `incidentDay` (YYYY-MM-DD) is on or before the publish day and
 * not implausibly far before it.
 */
export function isPlausibleIncidentDate(incidentDay: string, publishedIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDay)) return false;
  const incident = Date.parse(`${incidentDay}T00:00:00Z`);
  const published = dayOf(publishedIso).getTime();
  if (Number.isNaN(incident) || Number.isNaN(published)) return false;
  return incident <= published && published - incident <= MAX_INCIDENT_LEAD_DAYS * DAY_MS;
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&rsquo;': '’', '&lsquo;': '‘', '&rdquo;': '”', '&ldquo;': '“',
  '&ndash;': '–', '&mdash;': '—', '&hellip;': '…',
};

/**
 * Article body text from a news page: the paragraphs, without scripts, styles
 * or short navigation/boilerplate snippets.
 */
export function extractArticleText(html: string, maxChars = 3000): string {
  // Many outlets publish the full body in their structured data
  const articleBody = html.match(/"articleBody"\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
  if (articleBody) {
    try {
      // Some outlets leave raw line breaks inside the string, which strict JSON rejects
      const text = cleanText(JSON.parse(articleBody.replace(/[\u0000-\u001f]+/g, ' ')));
      if (text.length >= 80) return text.slice(0, maxChars);
    } catch {
      // Malformed structured data: fall back to the page paragraphs
    }
  }

  const withoutCode = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  // `<p\b` so icon `<path>` tags don't match
  const paragraphs = [...withoutCode.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    // Related-story cards are clamped to a few lines
    .filter((m) => !/line-clamp|truncate/.test(m[1]))
    .map((m) => cleanText(m[2]))
    // Inline scripts some outlets wrap in <p> tags contain braces or function definitions
    .filter((p) => p.length >= 40 && !/[{}]|\bfunction\s*\w*\s*\(/.test(p));

  return paragraphs.join('\n').slice(0, maxChars);
}

function cleanText(htmlFragment: string): string {
  return htmlFragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => HTML_ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drops a leading dateline such as "Colombo, April 12 (Daily Mirror) - ". */
function stripDateline(text: string): string {
  return text.replace(/^[A-Z][\w .]{1,40},\s*[A-Za-z]+\.?\s+\d{1,2}(?:,\s*\d{4})?\s*(?:\([^)]*\))?\s*[-–—:]\s*/, '');
}

/** The opening sentence(s) of the article, where outlets state when the crime happened. */
function ledeOf(text: string): string {
  const body = stripDateline(text.trim());
  const sentences = body.match(/[^.!?]+[.!?]+/g) || [body];
  return sentences.slice(0, 2).join(' ');
}

/** Most recent `weekday` on or before `day`. */
function previousWeekday(day: Date, weekday: number): Date {
  const diff = (day.getUTCDay() - weekday + 7) % 7;
  return new Date(day.getTime() - diff * DAY_MS);
}

/** The latest date on or before `day` that falls on `dayOfMonth` (this month or last). */
function mostRecentDayOfMonth(day: Date, dayOfMonth: number): Date | null {
  for (let monthsBack = 0; monthsBack <= 1; monthsBack++) {
    const candidate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - monthsBack, dayOfMonth));
    if (candidate.getUTCDate() === dayOfMonth && candidate <= day) return candidate;
  }
  return null;
}

/** Builds a date in `published`'s year, or the year before if that would be after publishing. */
function dateBefore(published: Date, month: number, dayOfMonth: number, year?: number): Date | null {
  if (dayOfMonth < 1 || dayOfMonth > 31 || month < 0) return null;
  let candidate = new Date(Date.UTC(year ?? published.getUTCFullYear(), month, dayOfMonth));
  if (year === undefined && candidate > published) {
    candidate = new Date(Date.UTC(published.getUTCFullYear() - 1, month, dayOfMonth));
  }
  return candidate.getUTCDate() === dayOfMonth ? candidate : null;
}

/**
 * Rule-based fallback for when the article text can't be read by Gemini: looks
 * only at the opening sentences for an explicit incident time ("yesterday",
 * "last night", "on Monday (6)", "on April 8"). Returns YYYY-MM-DD or null.
 */
export function findIncidentDateInText(text: string, publishedIso: string): string | null {
  const published = dayOf(publishedIso);
  if (Number.isNaN(published.getTime())) return null;
  const lede = ledeOf(text).toLowerCase();

  const candidates: Date[] = [];

  // "on April 8", "on April 8th, 2026"
  for (const m of lede.matchAll(
    new RegExp(`\\b(?:on|since)\\s+${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, 'g')
  )) {
    const d = dateBefore(published, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
    if (d) candidates.push(d);
  }

  // "on 8 April", "on the 8th of April 2026"
  for (const m of lede.matchAll(
    new RegExp(`\\b(?:on|since)\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_PATTERN}\\.?(?:,?\\s+(\\d{4}))?`, 'g')
  )) {
    const d = dateBefore(published, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
    if (d) candidates.push(d);
  }

  // "on Monday", "on Monday (6)", "on Monday night"
  for (const m of lede.matchAll(
    new RegExp(`\\bon\\s+(${WEEKDAYS.join('|')})(?:\\s*\\((\\d{1,2})(?:st|nd|rd|th)?\\))?`, 'g')
  )) {
    const weekday = WEEKDAYS.indexOf(m[1]);
    const byWeekday = previousWeekday(published, weekday);
    // Sri Lankan outlets write the day of month in brackets: "on Monday (6)".
    // Trust it only when it agrees with the weekday.
    const byNumber = m[2] ? mostRecentDayOfMonth(published, Number(m[2])) : null;
    candidates.push(byNumber && byNumber.getUTCDay() === weekday ? byNumber : byWeekday);
  }

  if (/\b(yesterday|last night|the previous night|late on yesterday)\b/.test(lede)) {
    candidates.push(new Date(published.getTime() - DAY_MS));
  }
  if (/\b(today|this morning|this afternoon|this evening|earlier today|tonight)\b/.test(lede)) {
    candidates.push(published);
  }

  // The earliest stated time is when the crime itself happened; later ones are usually the arrest
  const plausible = candidates
    .map(toIsoDay)
    .filter((day) => isPlausibleIncidentDate(day, publishedIso))
    .sort();
  return plausible[0] ?? null;
}

// --- Network helpers ---------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 4000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': BROWSER_USER_AGENT, ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(timeout);
  }
}

const GOOGLE_NEWS_ARTICLE_REGEX = /^https:\/\/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/;

/**
 * Google News RSS links point at a Google page, not the article. The real URL
 * has to be exchanged using the signature and timestamp embedded in that page.
 * Returns null if Google's page or endpoint changes.
 */
async function decodeGoogleNewsUrl(link: string): Promise<string | null> {
  const id = link.match(GOOGLE_NEWS_ARTICLE_REGEX)?.[1];
  if (!id) return null;

  const page = await (await fetchWithTimeout(`https://news.google.com/rss/articles/${id}`)).text();
  const signature = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return null;

  const request = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id,
    Number(timestamp),
    signature,
  ]);
  const body = new URLSearchParams({
    'f.req': JSON.stringify([[['Fbv4je', request, null, 'generic']]]),
  });
  const res = await fetchWithTimeout('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  const text = await res.text();
  return text.match(/\[\\"garturlres\\",\\"(https?:[^\\"]+)\\"/)?.[1] ?? null;
}

export interface ArticleDetails {
  /** The outlet's own URL (Google News links resolved). */
  url: string;
  /** Article body text, or '' when the page couldn't be read. */
  text: string;
}

// Article pages don't change, so remember them per link across requests
const articleCache = new Map<string, ArticleDetails>();
const ARTICLE_CACHE_LIMIT = 300;

/** Resolves a feed link to the outlet's page and reads its article text. */
export async function fetchArticleDetails(link: string): Promise<ArticleDetails> {
  const cached = articleCache.get(link);
  if (cached) return cached;

  let details: ArticleDetails = { url: link, text: '' };
  const startedAt = Date.now();
  const isGoogleNews = GOOGLE_NEWS_ARTICLE_REGEX.test(link);
  try {
    const url = isGoogleNews ? await decodeGoogleNewsUrl(link) : link;
    if (url) {
      const res = await fetchWithTimeout(url);
      details = { url, text: res.ok ? extractArticleText(await res.text()) : '' };
      logFetch({
        source: 'article_page',
        ok: res.ok && details.text.length > 0,
        ms: Date.now() - startedAt,
        status: res.status,
        host: new URL(url).host,
        textChars: details.text.length,
      });
    } else {
      logFetch({ source: 'article_page', ok: false, ms: Date.now() - startedAt, error: 'google_news_decode_failed' });
    }
  } catch (err) {
    // Timeouts and blocked pages leave the text empty; callers fall back to the publish date
    logFetch({
      source: 'article_page',
      ok: false,
      ms: Date.now() - startedAt,
      error: describeFetchError(err),
      googleNews: isGoogleNews,
    });
    return details;
  }

  if (articleCache.size >= ARTICLE_CACHE_LIMIT) {
    articleCache.delete(articleCache.keys().next().value!);
  }
  articleCache.set(link, details);
  return details;
}
