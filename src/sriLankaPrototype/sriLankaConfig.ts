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
}

/**
 * The 13 designated Sri Lankan National News Outlets for crime & safety grounding.
 */
export const SRI_LANKA_NATIONAL_OUTLETS: NationalNewsOutlet[] = [
  {
    id: 'ada_derana',
    displayName: 'Ada Derana News',
    domain: 'adaderana.lk',
    aliases: ['ada derana', 'adaderana', 'derana'],
  },
  {
    id: 'sirasa_newsfirst',
    displayName: 'Sirasa Newsfirst',
    domain: 'newsfirst.lk',
    aliases: ['newsfirst', 'news 1st', 'sirasa', 'newsfirst.lk'],
  },
  {
    id: 'daily_mirror',
    displayName: 'Daily Mirror',
    domain: 'dailymirror.lk',
    aliases: ['daily mirror', 'dailymirror'],
  },
  {
    id: 'newswire',
    displayName: 'NewsWire',
    domain: 'newswire.lk',
    aliases: ['newswire', 'newswire.lk'],
  },
  {
    id: 'sunday_times',
    displayName: 'Sunday Times',
    domain: 'sundaytimes.lk',
    aliases: ['sunday times', 'sundaytimes'],
  },
  {
    id: 'hiru_tv',
    displayName: 'Hiru TV News',
    domain: 'hirunews.lk',
    aliases: ['hiru', 'hiru tv', 'hiru news', 'hirunews'],
  },
  {
    id: 'siyatha_tv',
    displayName: 'Siyatha TV News',
    domain: 'siyathanews.lk',
    aliases: ['siyatha', 'siyatha tv', 'siyatha news', 'siyathanews'],
  },
  {
    id: 'daily_news',
    displayName: 'Daily News',
    domain: 'dailynews.lk',
    aliases: ['daily news', 'dailynews.lk', 'lake house'],
  },
  {
    id: 'rupavahini_news',
    displayName: 'Rupavahini News',
    domain: 'rupavahininews.lk',
    aliases: ['rupavahini', 'runews', 'rupavahininews'],
  },
  {
    id: 'swarnavahini_news',
    displayName: 'Swarnawahini News',
    domain: 'liveat8.lk',
    aliases: ['swarnawahini', 'swarnavahini', 'live at 8', 'liveat8'],
  },
  {
    id: 'island_lk',
    displayName: 'island.lk',
    domain: 'island.lk',
    aliases: ['island.lk', 'the island', 'island'],
  },
  {
    id: 'itn_news',
    displayName: 'ITN News',
    domain: 'itnnews.lk',
    aliases: ['itn', 'itn news', 'itnnews', 'independent television network'],
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
  },
];

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
