import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import type { PlaceSelection } from '../types/safety';
import {
  ENABLE_SRI_LANKA_PROTOTYPE,
  SRI_LANKA_INITIAL_SEARCH_QUERY,
  SRI_LANKA_QUICK_SEARCH_PRESETS,
} from '../sriLankaPrototype/sriLankaConfig';

interface FloatingSearchOverlayProps {
  destination: PlaceSelection | null;
  onSelectDestination: (place: PlaceSelection) => void;
  onQuotaExceeded: () => void;
}

interface SuggestionEntry {
  placeId: string;
  mainText: string;
  secondaryText: string;
  placePrediction: any;
}

const GLOBAL_QUICK_SEARCH_QUERIES = [
  { label: 'Union Square, SF', query: 'Union Square San Francisco CA' },
  { label: 'Times Square, NYC', query: 'Times Square New York NY' },
  { label: 'Millennium Park, Chicago', query: 'Millennium Park Chicago IL' },
  { label: 'Pike Place, Seattle', query: 'Pike Place Market Seattle WA' },
];

const QUICK_SEARCH_QUERIES = ENABLE_SRI_LANKA_PROTOTYPE
  ? SRI_LANKA_QUICK_SEARCH_PRESETS
  : GLOBAL_QUICK_SEARCH_QUERIES;

const PREDEFINED_LOCATIONS: {
  [key: string]: { lat: number; lng: number; name: string; address: string; types?: string[] };
} = {
  // Specific spots come first: the lookup takes the first key found in the query
  'central bus stand': { lat: 6.9338, lng: 79.8556, name: 'Central Bus Stand, Pettah', address: 'Central Bus Stand, Olcott Mawatha, Pettah, Colombo, Sri Lanka' },
  'galle face green': { lat: 6.9255, lng: 79.8452, name: 'Galle Face Green', address: 'Galle Face Green, Colombo 00300, Sri Lanka' },
  'zoological': { lat: 6.8566, lng: 79.8741, name: 'National Zoological Gardens', address: 'National Zoological Gardens, Dehiwala-Mount Lavinia, Sri Lanka' },
  'majestic city': { lat: 6.8936, lng: 79.8553, name: 'Majestic City', address: 'Majestic City, Galle Road, Bambalapitiya, Colombo, Sri Lanka' },
  'lighthouse': { lat: 6.0247, lng: 80.2194, name: 'Galle Fort Lighthouse', address: 'Galle Fort Lighthouse, Galle, Sri Lanka' },
  // Neighbourhoods and towns are too large to score
  'pettah': { lat: 6.9344, lng: 79.8528, name: 'Pettah, Colombo', address: 'Pettah, Colombo 01100, Sri Lanka', types: ['sublocality'] },
  'dehiwala': { lat: 6.8511, lng: 79.8660, name: 'Dehiwala, Colombo', address: 'Dehiwala-Mount Lavinia, Sri Lanka', types: ['locality'] },
  'bambalapitiya': { lat: 6.8920, lng: 79.8552, name: 'Bambalapitiya, Colombo', address: 'Bambalapitiya, Colombo 00400, Sri Lanka', types: ['sublocality'] },
  'fort': { lat: 6.9342, lng: 79.8503, name: 'Colombo Fort Railway Station', address: 'Colombo Fort Railway Station, Olcott Mawatha, Colombo, Sri Lanka' },
  'kandy': { lat: 7.2906, lng: 80.6337, name: 'Kandy City Centre', address: 'Kandy City Centre, Sri Dalada Veediya, Kandy, Sri Lanka' },
  'galle': { lat: 6.0268, lng: 80.2170, name: 'Galle Fort', address: 'Galle Fort, Galle, Sri Lanka' },
  'colombo': { lat: 6.9271, lng: 79.8612, name: 'Colombo', address: 'Colombo, Western Province, Sri Lanka', types: ['locality'] },
  'union square': { lat: 37.7879, lng: -122.4074, name: 'Union Square', address: 'Union Square, San Francisco, CA, USA' },
  'times square': { lat: 40.7580, lng: -73.9855, name: 'Times Square', address: 'Times Square, New York, NY, USA' },
  'millennium park': { lat: 41.8826, lng: -87.6226, name: 'Millennium Park', address: 'Millennium Park, Chicago, IL, USA' },
  'pike place': { lat: 47.6097, lng: -122.3422, name: 'Pike Place Market', address: 'Pike Place Market, Seattle, WA, USA' },
};

function lookupPredefinedLocation(queryText: string): PlaceSelection | null {
  const lower = queryText.toLowerCase().trim();
  for (const [key, val] of Object.entries(PREDEFINED_LOCATIONS)) {
    if (lower.includes(key)) {
      return {
        name: val.name,
        address: val.address,
        location: { lat: val.lat, lng: val.lng },
        placeId: `predef-${key}`,
        types: val.types,
      };
    }
  }

  // Fallback Sri Lanka center if prototype mode active
  if (ENABLE_SRI_LANKA_PROTOTYPE) {
    return {
      name: queryText.split(',')[0].trim(),
      address: `${queryText}, Sri Lanka`,
      location: { lat: 6.9344, lng: 79.8528 },
      placeId: `fallback-lk-${Date.now()}`,
    };
  }

  return {
    name: queryText.split(',')[0].trim(),
    address: queryText,
    location: { lat: 37.7879, lng: -122.4074 },
    placeId: `fallback-global-${Date.now()}`,
  };
}

export const FloatingSearchOverlay: React.FC<FloatingSearchOverlayProps> = ({
  destination,
  onSelectDestination,
  onQuotaExceeded,
}) => {
  const placesLib = useMapsLibrary('places');

  const [destQuery, setDestQuery] = useState(destination?.name || '');
  const [isEditing, setIsEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionEntry[]>([]);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

  const sessionTokenRef = useRef<any>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Sync external destination changes to the input field when not actively typing
  useEffect(() => {
    if (!isEditing && destination) {
      setDestQuery(destination.name);
    }
  }, [destination, isEditing]);

  const ensureSessionToken = useCallback(() => {
    if (!placesLib) return null;
    const TokenClass = (placesLib as any).AutocompleteSessionToken;
    if (!sessionTokenRef.current && TokenClass) {
      sessionTokenRef.current = new TokenClass();
    }
    return sessionTokenRef.current;
  }, [placesLib]);

  const fetchPredictions = useCallback(
    async (inputText: string) => {
      if (inputText.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      setIsFetchingSuggestions(true);
      try {
        const AutocompleteSuggestion = (placesLib as any)?.AutocompleteSuggestion;
        if (
          AutocompleteSuggestion &&
          typeof AutocompleteSuggestion.fetchAutocompleteSuggestions === 'function'
        ) {
          const sessionToken = ensureSessionToken();
          const request: any = {
            input: inputText.trim(),
            ...(ENABLE_SRI_LANKA_PROTOTYPE ? { region: 'lk' } : {}),
          };
          if (sessionToken) {
            request.sessionToken = sessionToken;
          }

          const response =
            await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
          const list = response?.suggestions || [];

          const mapped: SuggestionEntry[] = list
            .slice(0, 5)
            .map((item: any, idx: number) => {
              const pred = item.placePrediction;
              return {
                placeId: pred?.placeId || `pred-${idx}`,
                mainText:
                  pred?.mainText?.text ||
                  pred?.text?.text ||
                  inputText.trim(),
                secondaryText: pred?.secondaryText?.text || '',
                placePrediction: pred,
              };
            })
            .filter((item: SuggestionEntry) => Boolean(item.placePrediction));

          setSuggestions(mapped);
          return;
        }

        // Fallback: Legacy AutocompleteService
        if (window.google?.maps?.places?.AutocompleteService) {
          const service = new window.google.maps.places.AutocompleteService();
          service.getPlacePredictions(
            {
              input: inputText.trim(),
              ...(ENABLE_SRI_LANKA_PROTOTYPE ? { componentRestrictions: { country: 'lk' } } : {}),
            },
            (predictions, status) => {
              if (
                status === window.google.maps.places.PlacesServiceStatus.OK &&
                predictions
              ) {
                setSuggestions(
                  predictions.slice(0, 5).map((p) => ({
                    placeId: p.place_id,
                    mainText: p.structured_formatting?.main_text || p.description,
                    secondaryText: p.structured_formatting?.secondary_text || '',
                    placePrediction: null,
                  }))
                );
              } else {
                setSuggestions([]);
              }
            }
          );
        }
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('Quota')
        ) {
          onQuotaExceeded();
        }
        console.error('Autocomplete error:', err);
        setSuggestions([]);
      } finally {
        setIsFetchingSuggestions(false);
      }
    },
    [placesLib, ensureSessionToken, onQuotaExceeded]
  );

  const handleInputChange = (value: string) => {
    setDestQuery(value);
    setIsEditing(true);

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      fetchPredictions(value);
    }, 220);
  };

  const resolveQueryToPlace = useCallback(
    async (queryText: string): Promise<PlaceSelection> => {
      // 1. Try Google Maps Geocoder API
      if (window.google?.maps?.Geocoder) {
        try {
          const geocoder = new window.google.maps.Geocoder();
          const geocodeRes = await new Promise<any>((resolve) => {
            geocoder.geocode(
              {
                address: queryText,
                ...(ENABLE_SRI_LANKA_PROTOTYPE ? { componentRestrictions: { country: 'LK' } } : {}),
              },
              (results, status) => {
                if (status === 'OK' && results?.[0]?.geometry?.location) {
                  resolve(results[0]);
                } else {
                  resolve(null);
                }
              }
            );
          });

          if (geocodeRes) {
            const loc = geocodeRes.geometry.location;
            const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
            const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
            if (typeof lat === 'number' && typeof lng === 'number') {
              return {
                name: queryText.split(',')[0].trim(),
                address: geocodeRes.formatted_address || queryText,
                location: { lat, lng },
                placeId: geocodeRes.place_id,
                types: Array.isArray(geocodeRes.types) ? geocodeRes.types : undefined,
              };
            }
          }
        } catch {
          // Ignore geocoder error, fall through
        }
      }

      // 2. Predefined location lookup
      const predef = lookupPredefinedLocation(queryText);
      return predef;
    },
    []
  );

  const selectPlace = useCallback(
    (place: PlaceSelection) => {
      setDestQuery(place.name);
      onSelectDestination(place);
    },
    [onSelectDestination]
  );

  const resolvePlacePrediction = useCallback(
    async (entry: SuggestionEntry) => {
      try {
        if (entry.placePrediction) {
          const place = entry.placePrediction.toPlace();
          await place.fetchFields({
            fields: ['displayName', 'formattedAddress', 'location', 'viewport', 'types'],
          });

          sessionTokenRef.current = null;

          const loc = place.location;
          const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
          const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;

          if (typeof lat === 'number' && typeof lng === 'number') {
            selectPlace({
              name: place.displayName || entry.mainText,
              address: place.formattedAddress || entry.secondaryText || entry.mainText,
              location: { lat, lng },
              placeId: entry.placeId,
              types: Array.isArray(place.types) ? place.types : undefined,
            });
            return;
          }
        }

        // Fallback resolution by query string
        selectPlace(await resolveQueryToPlace(entry.mainText));
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        if (
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('Quota')
        ) {
          onQuotaExceeded();
        }
        console.error('Place fetchFields error:', err);
        // Fallback resolve
        selectPlace(await resolveQueryToPlace(entry.mainText));
      } finally {
        setSuggestions([]);
        setIsEditing(false);
      }
    },
    [selectPlace, onQuotaExceeded, resolveQueryToPlace]
  );

  const handleExecuteSearch = useCallback(
    async (queryText: string) => {
      if (!queryText.trim()) return;
      setIsFetchingSuggestions(true);
      try {
        // Try live Places Autocomplete prediction first if available
        const AutocompleteSuggestion = (placesLib as any)?.AutocompleteSuggestion;
        if (
          AutocompleteSuggestion &&
          typeof AutocompleteSuggestion.fetchAutocompleteSuggestions === 'function'
        ) {
          const sessionToken = ensureSessionToken();
          const res =
            await AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: queryText.trim(),
              ...(ENABLE_SRI_LANKA_PROTOTYPE ? { region: 'lk' } : {}),
              ...(sessionToken ? { sessionToken } : {}),
            });
          const first = res?.suggestions?.[0]?.placePrediction;
          if (first) {
            await resolvePlacePrediction({
              placeId: first.placeId || queryText,
              mainText: first.mainText?.text || queryText,
              secondaryText: first.secondaryText?.text || '',
              placePrediction: first,
            });
            return;
          }
        }

        // Direct geocode / predefined location resolution
        selectPlace(await resolveQueryToPlace(queryText));
      } catch (err: any) {
        console.error('Execute search error:', err);
        selectPlace(await resolveQueryToPlace(queryText));
      } finally {
        setIsFetchingSuggestions(false);
        setSuggestions([]);
        setIsEditing(false);
      }
    },
    [placesLib, ensureSessionToken, resolvePlacePrediction, resolveQueryToPlace, selectPlace]
  );

  // Trigger a live lookup for one of the quick search preset buttons
  const handleQuickQuery = useCallback(
    (queryText: string) => {
      setDestQuery(queryText);
      handleExecuteSearch(queryText);
    },
    [handleExecuteSearch]
  );

  // Auto-load initial destination upon load, once Places has loaded so the
  // search resolves through Google rather than the offline fallback list
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!destination && !didInitRef.current && placesLib) {
      didInitRef.current = true;
      handleQuickQuery(
        ENABLE_SRI_LANKA_PROTOTYPE
          ? SRI_LANKA_INITIAL_SEARCH_QUERY
          : 'Union Square San Francisco CA'
      );
    }
  }, [destination, handleQuickQuery, placesLib]);

  return (
    <div className="absolute top-3 left-3 right-3 z-30 flex flex-col gap-2 pointer-events-none">
      {/* Main Material Floating Search Card */}
      <div className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/90 shadow-2xl p-2.5 transition-all">
        {/* Destination Search Form Row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteSearch(destQuery);
          }}
          className="flex items-center gap-1.5"
        >
          <div className="relative flex-1 flex items-center bg-slate-50/90 border border-slate-200 rounded-xl px-3 min-h-[44px] focus-within:border-emerald-300 transition-colors">
            <button
              type="submit"
              title="Search location"
              className="text-slate-500 hover:text-emerald-600 shrink-0 mr-2.5 cursor-pointer"
            >
              <Search className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={destQuery}
              onFocus={() => setIsEditing(true)}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleExecuteSearch(destQuery);
                }
              }}
              placeholder={
                ENABLE_SRI_LANKA_PROTOTYPE
                  ? 'Search Sri Lanka place or street (200m scan)...'
                  : 'Search destination or neighborhood...'
              }
              className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 focus:outline-none truncate"
              aria-label="Search destination"
            />
            {isFetchingSuggestions && isEditing && (
              <Loader2 className="w-4 h-4 text-emerald-600 animate-spin shrink-0 ml-1.5" />
            )}
            {destQuery && (
              <button
                type="button"
                onClick={() => {
                  setDestQuery('');
                  setSuggestions([]);
                  setIsEditing(true);
                }}
                aria-label="Clear destination search"
                className="min-w-[36px] min-h-[36px] -mr-1 flex items-center justify-center text-slate-500 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>

        {/* Quick Destination Search Buttons */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto custom-scrollbar pt-0.5 pb-1.5">
          {QUICK_SEARCH_QUERIES.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleQuickQuery(preset.query)}
              className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-50/90 hover:bg-slate-100 border border-slate-200/90 text-[11px] font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Places Autocomplete Predictions Dropdown */}
      {isEditing && suggestions.length > 0 && (
        <div className="pointer-events-auto rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-2xl overflow-hidden divide-y divide-slate-200/70">
          {suggestions.map((item) => (
            <button
              key={item.placeId}
              type="button"
              onClick={() => resolvePlacePrediction(item)}
              className="w-full min-h-[52px] px-3.5 py-2.5 flex items-center gap-3 text-left hover:bg-slate-100/80 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">
                  {item.mainText}
                </div>
                {item.secondaryText && (
                  <div className="text-xs text-slate-500 truncate">
                    {item.secondaryText}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

