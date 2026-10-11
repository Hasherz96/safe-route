/**
 * Safety scores describe the 200m around a specific spot. Searches for whole
 * neighbourhoods, towns, regions or countries are too large to score, so the
 * app asks the user for a more specific location instead.
 */

/** Google place types for areas rather than specific spots. */
const LARGE_AREA_PLACE_TYPES = new Set([
  'neighborhood',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'sublocality_level_3',
  'sublocality_level_4',
  'sublocality_level_5',
  'locality',
  'postal_town',
  'colloquial_area',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'administrative_area_level_4',
  'administrative_area_level_5',
  'administrative_area_level_6',
  'administrative_area_level_7',
  'country',
  'continent',
  'archipelago',
]);

/** True when a place's Google types describe a neighbourhood, town, region or country. */
export function isTooLargeToScore(types: readonly string[] | null | undefined): boolean {
  return Boolean(types?.some((t) => LARGE_AREA_PLACE_TYPES.has(t)));
}
