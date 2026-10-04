import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  Search,
  LocateFixed,
  Route,
  X,
  Footprints,
  Car,
  Bike,
  TrainFront,
  Loader2,
  MapPin,
  AlertCircle,
} from 'lucide-react';
import type { PlaceSelection, TravelModeOption } from '../types/safety';
import {
  ENABLE_SRI_LANKA_PROTOTYPE,
  SRI_LANKA_INITIAL_SEARCH_QUERY,
  SRI_LANKA_QUICK_SEARCH_PRESETS,
} from '../sriLankaPrototype/sriLankaConfig';

interface FloatingSearchOverlayProps {
  origin: PlaceSelection | null;
  destination: PlaceSelection | null;
  directionsEnabled: boolean;
  travelMode: TravelModeOption;
  gpsStatus: 'idle' | 'locating' | 'granted' | 'denied';
  gpsErrorMsg: string | null;
  onSelectDestination: (place: PlaceSelection) => void;
  onSelectOrigin: (place: PlaceSelection) => void;
  onRequestCurrentLocation: () => void;
  onToggleDirections: () => void;
  onChangeTravelMode: (mode: TravelModeOption) => void;
  onClearRoute: () => void;
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

export const FloatingSearchOverlay: React.FC<FloatingSearchOverlayProps> = ({
  origin,
  destination,
  directionsEnabled,
  travelMode,
  gpsStatus,
  gpsErrorMsg,
  onSelectDestination,
  onSelectOrigin,
  onRequestCurrentLocation,
  onToggleDirections,
  onChangeTravelMode,
  onClearRoute,
  onQuotaExceeded,
}) => {
  const placesLib = useMapsLibrary('places');

  const [destQuery, setDestQuery] = useState(destination?.name || '');
  const [originQuery, setOriginQuery] = useState(origin?.name || '');
  const [activeField, setActiveField] = useState<'destination' | 'origin' | null>(
    null
  );
  const [suggestions, setSuggestions] = useState<SuggestionEntry[]>([]);
  const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);

  const sessionTokenRef = useRef<any>(null);
  const debounceTimerRef = useRef<number | null>(null);

  // Sync external destination/origin changes to input fields when not actively typing
  useEffect(() => {
    if (activeField !== 'destination' && destination) {
      setDestQuery(destination.name);
    }
  }, [destination, activeField]);

  useEffect(() => {
    if (activeField !== 'origin' && origin) {
      setOriginQuery(origin.name);
    }
  }, [origin, activeField]);

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
      if (!placesLib || inputText.trim().length < 2) {
        setSuggestions([]);
        return;
      }

      const AutocompleteSuggestion = (placesLib as any).AutocompleteSuggestion;
      if (
        !AutocompleteSuggestion ||
        typeof AutocompleteSuggestion.fetchAutocompleteSuggestions !== 'function'
      ) {
        return;
      }

      setIsFetchingSuggestions(true);
      try {
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

  const handleInputChange = (
    value: string,
    field: 'destination' | 'origin'
  ) => {
    if (field === 'destination') {
      setDestQuery(value);
    } else {
      setOriginQuery(value);
    }
    setActiveField(field);

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      fetchPredictions(value);
    }, 220);
  };

  const resolvePlacePrediction = useCallback(
    async (
      entry: SuggestionEntry,
      targetField: 'destination' | 'origin'
    ) => {
      if (!entry.placePrediction) return;
      try {
        const place = entry.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
        });

        // Reset session token after completing a place selection session
        sessionTokenRef.current = null;

        const loc = place.location;
        const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
        const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;

        if (typeof lat === 'number' && typeof lng === 'number') {
          const resolved: PlaceSelection = {
            name: place.displayName || entry.mainText,
            address: place.formattedAddress || entry.secondaryText || entry.mainText,
            location: { lat, lng },
            placeId: entry.placeId,
          };

          if (targetField === 'destination') {
            setDestQuery(resolved.name);
            onSelectDestination(resolved);
          } else {
            setOriginQuery(resolved.name);
            onSelectOrigin(resolved);
          }
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
        console.error('Place fetchFields error:', err);
      } finally {
        setSuggestions([]);
        setActiveField(null);
      }
    },
    [onSelectDestination, onSelectOrigin, onQuotaExceeded]
  );

  // Trigger a live Places API lookup for one of the quick search buttons
  const handleQuickQuery = useCallback(
    async (queryText: string) => {
      if (!placesLib) return;
      setDestQuery(queryText);
      setIsFetchingSuggestions(true);
      try {
        const AutocompleteSuggestion = (placesLib as any).AutocompleteSuggestion;
        if (
          AutocompleteSuggestion &&
          typeof AutocompleteSuggestion.fetchAutocompleteSuggestions === 'function'
        ) {
          const sessionToken = ensureSessionToken();
          const res =
            await AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: queryText,
              ...(ENABLE_SRI_LANKA_PROTOTYPE ? { region: 'lk' } : {}),
              ...(sessionToken ? { sessionToken } : {}),
            });
          const first = res?.suggestions?.[0]?.placePrediction;
          if (first) {
            await resolvePlacePrediction(
              {
                placeId: first.placeId || queryText,
                mainText: first.mainText?.text || queryText,
                secondaryText: first.secondaryText?.text || '',
                placePrediction: first,
              },
              'destination'
            );
          }
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
        console.error('Quick query error:', err);
      } finally {
        setIsFetchingSuggestions(false);
      }
    },
    [placesLib, ensureSessionToken, resolvePlacePrediction, onQuotaExceeded]
  );

  // Auto-load initial destination via live Places API (New) once placesLib is ready
  const didInitRef = useRef(false);
  useEffect(() => {
    if (placesLib && !destination && !didInitRef.current) {
      didInitRef.current = true;
      handleQuickQuery(
        ENABLE_SRI_LANKA_PROTOTYPE
          ? SRI_LANKA_INITIAL_SEARCH_QUERY
          : 'Union Square San Francisco CA'
      );
    }
  }, [placesLib, destination, handleQuickQuery]);

  const travelModes: { id: TravelModeOption; label: string; icon: React.ReactNode }[] = [
    { id: 'WALKING', label: 'Walk', icon: <Footprints className="w-3.5 h-3.5" /> },
    { id: 'DRIVING', label: 'Drive', icon: <Car className="w-3.5 h-3.5" /> },
    { id: 'TRANSIT', label: 'Transit', icon: <TrainFront className="w-3.5 h-3.5" /> },
    { id: 'BICYCLING', label: 'Bike', icon: <Bike className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="absolute top-3 left-3 right-3 z-30 flex flex-col gap-2 pointer-events-none">
      {/* Main Material Floating Search Card */}
      <div className="pointer-events-auto rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-800/90 shadow-2xl p-2.5 transition-all">
        {/* Destination Search Row */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 flex items-center bg-slate-950/90 border border-slate-800 rounded-xl px-3 min-h-[44px] focus-within:border-emerald-500/70 transition-colors">
            <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2.5" />
            <input
              type="text"
              value={destQuery}
              onFocus={() => setActiveField('destination')}
              onChange={(e) => handleInputChange(e.target.value, 'destination')}
              placeholder={
                ENABLE_SRI_LANKA_PROTOTYPE
                  ? 'Search Sri Lanka place or street (200m scan)...'
                  : 'Search destination or neighborhood...'
              }
              className="w-full bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none truncate"
              aria-label="Search destination"
            />
            {isFetchingSuggestions && activeField === 'destination' && (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0 ml-1.5" />
            )}
            {destQuery && (
              <button
                type="button"
                onClick={() => {
                  setDestQuery('');
                  setSuggestions([]);
                  setActiveField('destination');
                }}
                aria-label="Clear destination search"
                className="min-w-[36px] min-h-[36px] -mr-1 flex items-center justify-center text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Current Location GPS Pickup Button */}
          <button
            type="button"
            onClick={onRequestCurrentLocation}
            title="Use Current Android GPS Location"
            className={`min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
              gpsStatus === 'granted'
                ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                : gpsStatus === 'denied'
                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-300'
                  : 'bg-slate-800/90 border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            {gpsStatus === 'locating' ? (
              <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            ) : (
              <LocateFixed className="w-4 h-4" />
            )}
          </button>

          {/* Get Directions Toggle Button */}
          <button
            type="button"
            onClick={onToggleDirections}
            title="Toggle Turn-by-Turn Directions"
            className={`min-h-[44px] px-3 rounded-xl border flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              directionsEnabled
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/20'
                : 'bg-slate-800/90 border-slate-700/80 text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Route className="w-4 h-4" />
            <span className="hidden sm:inline">Directions</span>
          </button>
        </div>

        {/* Expanded Origin & Travel Mode Drawer when Directions Enabled */}
        {directionsEnabled && (
          <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <div className="relative flex-1 flex items-center bg-slate-950/90 border border-slate-800 rounded-xl px-3 min-h-[44px] focus-within:border-sky-500/70 transition-colors">
                <LocateFixed className="w-3.5 h-3.5 text-sky-400 shrink-0 mr-2.5" />
                <input
                  type="text"
                  value={originQuery}
                  onFocus={() => setActiveField('origin')}
                  onChange={(e) => handleInputChange(e.target.value, 'origin')}
                  placeholder="Start location (or tap GPS icon)..."
                  className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none truncate"
                  aria-label="Starting location"
                />
                {originQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginQuery('');
                      setSuggestions([]);
                      setActiveField('origin');
                    }}
                    aria-label="Clear origin search"
                    className="min-w-[32px] min-h-[32px] -mr-1 flex items-center justify-center text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onClearRoute}
                className="min-h-[44px] px-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs text-slate-300 whitespace-nowrap"
              >
                Close
              </button>
            </div>

            {/* Segmented Travel Mode Selector (Interactive Filter Controls) */}
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-950/90 rounded-xl border border-slate-800/80">
              {travelModes.map((m) => {
                const active = travelMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChangeTravelMode(m.id)}
                    className={`min-h-[36px] rounded-lg flex items-center justify-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-800 text-emerald-300 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.icon}
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Destination Search Buttons */}
        {!directionsEnabled && (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
            {QUICK_SEARCH_QUERIES.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => handleQuickQuery(preset.query)}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-950/90 hover:bg-slate-800 border border-slate-800/90 text-[11px] font-medium text-slate-300 hover:text-white whitespace-nowrap shrink-0 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}

        {/* Android Geolocation Permission Denied / Notice Banner */}
        {gpsErrorMsg && (
          <div className="mt-2 px-3 py-2 rounded-xl bg-amber-950/70 border border-amber-500/40 flex items-start gap-2 text-xs text-amber-200">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 leading-snug">{gpsErrorMsg}</div>
          </div>
        )}
      </div>

      {/* Places Autocomplete Predictions Dropdown */}
      {activeField && suggestions.length > 0 && (
        <div className="pointer-events-auto rounded-2xl bg-slate-900/95 backdrop-blur-md border border-slate-800 shadow-2xl overflow-hidden divide-y divide-slate-800/70">
          {suggestions.map((item) => (
            <button
              key={item.placeId}
              type="button"
              onClick={() => resolvePlacePrediction(item, activeField)}
              className="w-full min-h-[52px] px-3.5 py-2.5 flex items-center gap-3 text-left hover:bg-slate-800/80 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-100 truncate">
                  {item.mainText}
                </div>
                {item.secondaryText && (
                  <div className="text-xs text-slate-400 truncate">
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
