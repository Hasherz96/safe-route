/**
 * ============================================================================
 * SRI LANKA REGIONAL PROTOTYPE MODULE (ISOLATED & REMOVABLE)
 * ============================================================================
 * To disable this Sri Lanka regional optimization and revert the application
 * to the global baseline:
 *   1. Set `ENABLE_SRI_LANKA_PROTOTYPE = false` below, OR
 *   2. Delete the `src/sriLankaPrototype/` directory and remove its imports.
 * ============================================================================
 */

export const ENABLE_SRI_LANKA_PROTOTYPE = true;

export interface NationalNewsOutlet {
  id: string;
  displayName: string;
  domain: string;
  aliases: string[];
  rssUrl?: string;
}

/**
 * The 13 designated Sri Lankan National News Outlets for crime & safety grounding.
 * Includes direct RSS feed endpoints to overcome Google News indexing gaps for local news.
 */
export const SRI_LANKA_NATIONAL_OUTLETS: NationalNewsOutlet[] = [
  {
    id: 'ada_derana',
    displayName: 'Ada Derana News',
    domain: 'adaderana.lk',
    aliases: ['ada derana', 'adaderana', 'derana'],
    rssUrl: 'https://www.adaderana.lk/rss.php',
  },
  {
    id: 'sirasa_newsfirst',
    displayName: 'Sirasa Newsfirst',
    domain: 'newsfirst.lk',
    aliases: ['newsfirst', 'news 1st', 'sirasa', 'newsfirst.lk'],
    rssUrl: 'https://cdn.newsfirst.lk/english-rss.xml',
  },
  {
    id: 'daily_mirror',
    displayName: 'Daily Mirror',
    domain: 'dailymirror.lk',
    aliases: ['daily mirror', 'dailymirror'],
    rssUrl: 'https://www.dailymirror.lk/rss',
  },
  {
    id: 'newswire',
    displayName: 'NewsWire',
    domain: 'newswire.lk',
    aliases: ['newswire', 'newswire.lk'],
    rssUrl: 'https://www.newswire.lk/feed/',
  },
  {
    id: 'sunday_times',
    displayName: 'Sunday Times',
    domain: 'sundaytimes.lk',
    aliases: ['sunday times', 'sundaytimes'],
    rssUrl: 'https://www.sundaytimes.lk/rss/',
  },
  {
    id: 'hiru_tv',
    displayName: 'Hiru TV News',
    domain: 'hirunews.lk',
    aliases: ['hiru', 'hiru tv', 'hiru news', 'hirunews'],
    rssUrl: 'https://www.hirunews.lk/rss/english.xml',
  },
  {
    id: 'siyatha_tv',
    displayName: 'Siyatha TV News',
    domain: 'siyathanews.lk',
    aliases: ['siyatha', 'siyatha tv', 'siyatha news', 'siyathanews'],
    rssUrl: 'https://siyathanews.lk/feed/',
  },
  {
    id: 'daily_news',
    displayName: 'Daily News',
    domain: 'dailynews.lk',
    aliases: ['daily news', 'dailynews.lk', 'lake house'],
    rssUrl: 'https://www.dailynews.lk/feed/',
  },
  {
    id: 'rupavahini_news',
    displayName: 'Rupavahini News',
    domain: 'rupavahininews.lk',
    aliases: ['rupavahini', 'runews', 'rupavahininews'],
    rssUrl: 'http://www.rupavahini.lk/rss',
  },
  {
    id: 'swarnavahini_news',
    displayName: 'Swarnawahini News',
    domain: 'liveat8.lk',
    aliases: ['swarnawahini', 'swarnavahini', 'live at 8', 'liveat8'],
    rssUrl: 'https://liveat8.lk/feed/',
  },
  {
    id: 'island_lk',
    displayName: 'island.lk',
    domain: 'island.lk',
    aliases: ['island.lk', 'the island', 'island'],
    rssUrl: 'https://island.lk/feed/',
  },
  {
    id: 'itn_news',
    displayName: 'ITN News',
    domain: 'itnnews.lk',
    aliases: ['itn', 'itn news', 'itnnews', 'independent television network'],
    rssUrl: 'https://www.itnnews.lk/feed/',
  },
  {
    id: 'government_news_lk',
    displayName: 'government news.lk',
    domain: 'news.lk',
    aliases: [
      'news.lk',
      'government news',
      'department of government information',
      'dgi',
    ],
    rssUrl: 'https://news.lk/news?format=feed&type=rss',
  },
];

/**
 * Common Sri Lankan locality transliteration & alternate name mapping
 */
export const SRI_LANKA_LOCALITY_TRANSLITERATIONS: Record<string, string[]> = {
  dehiwala: ['dehiwela', 'dehiwala'],
  dehiwela: ['dehiwala', 'dehiwela'],
  pettah: ['pitakotuwa', 'pettah', 'pettai'],
  pitakotuwa: ['pettah', 'pitakotuwa'],
  fort: ['kotuwa', 'colombo fort'],
  kollupitiya: ['colpetty', 'kollupitiya'],
  colpetty: ['kollupitiya', 'colpetty'],
  'slave island': ['kompannavidiya', 'kompannaveediya', 'slave island'],
  kompannavidiya: ['slave island', 'kompannavidiya'],
  wellawatte: ['wellawatta', 'wellawatte'],
  wellawatta: ['wellawatte', 'wellawatta'],
  bambalapitiya: ['bamba', 'bambalapitiya'],
  kirulapone: ['kirulapana', 'kirulapone'],
  nugegoda: ['nugegode', 'nugegoda'],
  borella: ['borello', 'borella'],
  kotahena: ['kothena', 'kotahena'],
};

export const SRI_LANKA_DEFAULT_CENTER = {
  lat: 6.9344,
  lng: 79.8528, // Colombo / Pettah hub
};

export const SRI_LANKA_INITIAL_SEARCH_QUERY = 'Pettah Colombo Sri Lanka';

export const SRI_LANKA_QUICK_SEARCH_PRESETS = [
  { label: 'Pettah, Colombo', query: 'Pettah Colombo Sri Lanka' },
  { label: 'Dehiwala, Colombo', query: 'Dehiwala Sri Lanka' },
  { label: 'Bambalapitiya, Colombo', query: 'Bambalapitiya Colombo Sri Lanka' },
  { label: 'Fort Railway, Colombo', query: 'Colombo Fort Railway Station Sri Lanka' },
  { label: 'Kandy City Centre', query: 'Kandy City Centre Sri Lanka' },
  { label: 'Galle Fort', query: 'Galle Fort Sri Lanka' },
];

/**
 * Regex matching Sri Lankan & standard thoroughfare suffixes inside 200m Google Maps addresses
 * (e.g. "Olcott Mawatha", "Galle Rd", "1st Cross St", "Bauddhaloka Mw", "Dalada Veediya")
 */
export const SRI_LANKA_STREET_SUFFIX_REGEX =
  /\b(mawatha|mw|veediya|road|rd|street|st|lane|ln|place|pl|gardens|terrace|drive|dr|avenue|ave|cross st|galle face|highway|hwy)\b/i;
