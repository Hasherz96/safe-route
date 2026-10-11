import React, { useEffect, useRef, useState } from 'react';
import {
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  Compass,
  Plus,
  Minus,
  Layers,
  Radar,
} from 'lucide-react';
import type {
  Coordinates,
  PlaceSelection,
  SafetyAnalysisResponse,
  NearbyAreaContext,
  NearbyPlaceItem,
} from '../types/safety';
import {
  ENABLE_SRI_LANKA_PROTOTYPE,
  SRI_LANKA_DEFAULT_CENTER,
  SRI_LANKA_STREET_SUFFIX_REGEX,
} from '../sriLankaPrototype/sriLankaConfig';

interface SafetyMapCanvasProps {
  destination: PlaceSelection | null;
  /** A neighbourhood, town or larger area: shown on the map but not scanned or scored. */
  destinationTooLarge: boolean;
  safetyData: SafetyAnalysisResponse | null;
  isAnalyzing: boolean;
  onNearbyAreaDiscovered: (
    target: PlaceSelection,
    nearbyArea: NearbyAreaContext
  ) => void;
  onMarkerPress: () => void;
  onQuotaExceeded: () => void;
}

/** Map zoom that fits a large area: a country, a province/district, or a town. */
function zoomForLargeArea(types: string[] | undefined): number {
  if (types?.some((t) => t === 'country' || t === 'continent' || t === 'archipelago')) return 7;
  if (types?.some((t) => t === 'administrative_area_level_1' || t === 'administrative_area_level_2')) return 9;
  if (types?.some((t) => t === 'locality' || t === 'postal_town')) return 12;
  return 14;
}

function getSafetyAccent(score: number | undefined) {
  if (score === undefined) {
    return {
      bg: 'bg-slate-100',
      border: 'border-slate-300',
      text: 'text-slate-900',
      hex: '#38bdf8',
      label: 'Scanning 200m',
    };
  }
  if (score >= 4.0) {
    return {
      bg: 'bg-emerald-50',
      border: 'border-emerald-400',
      text: 'text-emerald-700',
      hex: '#10b981',
      label: 'Safe',
    };
  }
  if (score >= 3.0) {
    return {
      bg: 'bg-amber-50',
      border: 'border-amber-400',
      text: 'text-amber-700',
      hex: '#f59e0b',
      label: 'Moderate Risk',
    };
  }
  return {
    bg: 'bg-rose-50',
    border: 'border-rose-500',
    text: 'text-rose-700',
    hex: '#f43f5e',
    label: 'High Risk',
  };
}

function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

function extractStreetNameFromAddress(address: string): string | null {
  if (!address) return null;
  const firstSegment = address.split(',')[0]?.trim() || '';
  // Strip leading street numbers like "250 Post St" -> "Post St" or "120 Olcott Mawatha" -> "Olcott Mawatha"
  const withoutNumbers = firstSegment
    .replace(/^\d+[\w/-]*\s+/, '')
    .replace(/\s+#.*$/, '')
    .trim();
  const suffixRegex = ENABLE_SRI_LANKA_PROTOTYPE
    ? SRI_LANKA_STREET_SUFFIX_REGEX
    : /\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|pl|place|ct|court|ln|lane|alley|pkwy|square|market|broadway)\b/i;

  if (withoutNumbers.length >= 4 && suffixRegex.test(withoutNumbers)) {
    return withoutNumbers;
  }
  return null;
}

export const SafetyMapCanvas: React.FC<SafetyMapCanvasProps> = ({
  destination,
  destinationTooLarge,
  safetyData,
  isAnalyzing,
  onNearbyAreaDiscovered,
  onMarkerPress,
  onQuotaExceeded,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const placesLib = useMapsLibrary('places');

  const radiusCircleRef = useRef<any | null>(null);
  const lastScannedPlaceKeyRef = useRef<string>('');

  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [isScanning200m, setIsScanning200m] = useState(false);
  const [nearbyPlaces200m, setNearbyPlaces200m] = useState<NearbyPlaceItem[]>(
    []
  );

  // Draw & update the 200-meter radius Circle overlay on Google Map
  useEffect(() => {
    if (!map || !mapsLib) return;

    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null);
      radiusCircleRef.current = null;
    }

    if (!destination || destinationTooLarge) return;

    const accent = getSafetyAccent(safetyData?.safety_rating);
    const CircleClass = (mapsLib as any).Circle;
    if (CircleClass) {
      radiusCircleRef.current = new CircleClass({
        center: destination.location,
        radius: 200, // 200m radius perimeter
        strokeColor: accent.hex,
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: accent.hex,
        fillOpacity: 0.14,
        map,
        clickable: false,
        zIndex: 5,
      });
    }

    return () => {
      if (radiusCircleRef.current) {
        radiusCircleRef.current.setMap(null);
        radiusCircleRef.current = null;
      }
    };
  }, [map, mapsLib, destination, safetyData?.safety_rating]);

  // Step 1 on Destination Selection: Use Google Maps Places API (New) `Place.searchNearby`
  // to identify the neighboring area up to a 200m radius, then trigger crime risk analysis!
  useEffect(() => {
    if (!destination || !placesLib) return;

    const placeKey = `${destination.name}-${destination.location.lat.toFixed(5)},${destination.location.lng.toFixed(5)}`;
    if (lastScannedPlaceKeyRef.current === placeKey) return;
    lastScannedPlaceKeyRef.current = placeKey;

    if (destinationTooLarge) {
      // Too large to score: just show where it is
      if (map) {
        map.panTo(destination.location);
        map.setZoom(zoomForLargeArea(destination.types));
      }
      setNearbyPlaces200m([]);
      setIsScanning200m(false);
      return;
    }

    if (map) {
      map.panTo(destination.location);
      map.setZoom(16); // Zoom 16 frames the 200m radius circle clearly
    }

    let isCancelled = false;
    let isCompleted = false;
    setIsScanning200m(true);

    const discover200mNeighborhood = async () => {
      const discoveredPlaces: NearbyPlaceItem[] = [];
      const streetSet = new Set<string>();

      const destStreet = extractStreetNameFromAddress(destination.address);
      if (destStreet) streetSet.add(destStreet);

      try {
        const PlaceClass = (placesLib as any).Place;
        if (PlaceClass && typeof PlaceClass.searchNearby === 'function') {
          const response = await PlaceClass.searchNearby({
            fields: [
              'displayName',
              'formattedAddress',
              'location',
              'primaryType',
            ],
            locationRestriction: {
              center: destination.location,
              radius: 200, // 200m radius
            },
            maxResultCount: 16,
          });

          const places = response?.places || [];
          for (const p of places) {
            const loc = p.location;
            const lat = typeof loc?.lat === 'function' ? loc.lat() : loc?.lat;
            const lng = typeof loc?.lng === 'function' ? loc.lng() : loc?.lng;
            if (typeof lat !== 'number' || typeof lng !== 'number') continue;

            const dist = haversineDistanceMeters(destination.location, {
              lat,
              lng,
            });
            if (dist <= 220) {
              const name = String(p.displayName || '').trim();
              const addr = String(p.formattedAddress || '').trim();
              const street = extractStreetNameFromAddress(addr);
              if (street) streetSet.add(street);

              if (name && name.toLowerCase() !== destination.name.toLowerCase()) {
                discoveredPlaces.push({
                  name,
                  address: addr,
                  distanceMeters: dist,
                  primaryType: p.primaryType || undefined,
                  location: { lat, lng },
                });
              }
            }
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
        console.warn('200m Place.searchNearby notice:', err);
      }

      if (isCancelled) return;
      isCompleted = true;

      discoveredPlaces.sort((a, b) => a.distanceMeters - b.distanceMeters);
      setNearbyPlaces200m(discoveredPlaces);
      setIsScanning200m(false);

      onNearbyAreaDiscovered(destination, {
        radiusMeters: 200,
        surroundingStreets: Array.from(streetSet),
        nearbyPlaces: discoveredPlaces,
      });
    };

    discover200mNeighborhood();

    return () => {
      isCancelled = true;
      // An interrupted scan (e.g. StrictMode's double effect run) never reported
      // its results, so forget the key to let the next run scan this place again
      if (!isCompleted && lastScannedPlaceKeyRef.current === placeKey) {
        lastScannedPlaceKeyRef.current = '';
      }
    };
  }, [
    destination,
    destinationTooLarge,
    placesLib,
    map,
    onNearbyAreaDiscovered,
    onQuotaExceeded,
  ]);

  const accent = getSafetyAccent(safetyData?.safety_rating);

  const handleZoom = (delta: number) => {
    if (!map) return;
    const currentZoom = map.getZoom() ?? 15;
    map.setZoom(currentZoom + delta);
  };

  const handleRecenter = () => {
    if (!map) return;
    if (destination) {
      map.panTo(destination.location);
      map.setZoom(destinationTooLarge ? zoomForLargeArea(destination.types) : 16);
    }
  };

  return (
    <div className="relative w-full h-full">
      <Map
        mapId="DEMO_MAP_ID"
        defaultCenter={
          ENABLE_SRI_LANKA_PROTOTYPE
            ? SRI_LANKA_DEFAULT_CENTER
            : { lat: 37.7879, lng: -122.4075 }
        }
        defaultZoom={16}
        gestureHandling="greedy"
        disableDefaultUI={true}
        mapTypeId={mapTypeId}
        colorScheme="LIGHT"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className="w-full h-full"
      >
        {/* Discovered Neighboring Places within 200m Radius */}
        {nearbyPlaces200m.slice(0, 8).map((np, i) => (
          <AdvancedMarker
            key={`${np.name}-${i}`}
            position={np.location}
            title={`${np.name} (${np.distanceMeters}m from target)`}
          >
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/95 border border-slate-300 text-[10px] text-slate-700 shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="max-w-[85px] truncate">{np.name}</span>
              <span className="text-slate-400 font-mono-tabular">
                {np.distanceMeters}m
              </span>
            </div>
          </AdvancedMarker>
        ))}

        {/* Large areas get a plain name pin: there's no score to show */}
        {destination && destinationTooLarge && (
          <AdvancedMarker position={destination.location} title={destination.name}>
            <div className="px-3 py-1.5 rounded-xl bg-white/95 border border-slate-300 shadow-xl text-xs font-medium text-slate-800 whitespace-nowrap">
              {destination.name}
            </div>
          </AdvancedMarker>
        )}

        {/* Destination Custom Safety Score Map Callout Pin */}
        {destination && !destinationTooLarge && (
          <AdvancedMarker
            position={destination.location}
            title={destination.name}
            onClick={onMarkerPress}
          >
            <button
              type="button"
              onClick={onMarkerPress}
              className="group relative flex flex-col items-center focus:outline-none cursor-pointer"
              aria-label={`Inspect 200m safety score for ${destination.name}`}
            >
              <div
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 ${accent.bg} ${accent.border} shadow-2xl transition-transform duration-150 group-hover:scale-105`}
              >
                {isAnalyzing || isScanning200m ? (
                  <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
                ) : safetyData && safetyData.safety_rating >= 4.0 ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : safetyData && safetyData.safety_rating >= 3.0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                )}

                <div className="flex flex-col items-start text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-700 max-w-[125px] truncate leading-tight">
                      {destination.name}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-slate-500">
                      · 200m
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs leading-tight mt-0.5">
                    <span
                      className={`font-mono-tabular font-semibold ${accent.text}`}
                    >
                      {isScanning200m
                        ? 'Mapping 200m...'
                        : isAnalyzing
                          ? 'Preprocessing...'
                          : safetyData
                            ? `${safetyData.safety_rating.toFixed(1)} / 5.0`
                            : '5.0 / 5.0'}
                    </span>
                    <span className="text-slate-400" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[11px] text-slate-700 whitespace-nowrap">
                      {isScanning200m
                        ? 'Nearby Scan'
                        : isAnalyzing
                          ? 'Crime Filter'
                          : safetyData?.risk_level || 'Safe'}
                    </span>
                  </div>
                </div>
              </div>
              {/* Callout stem pointer */}
              <div
                className={`w-3 h-3 rotate-45 -mt-1.5 border-r-2 border-b-2 ${accent.bg}`}
                style={{ borderColor: accent.hex }}
              />
            </button>
          </AdvancedMarker>
        )}
      </Map>

      {/* Right-side floating Android map hardware controls */}
      <div className="absolute right-3.5 bottom-52 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={() =>
            setMapTypeId((prev) => (prev === 'roadmap' ? 'hybrid' : 'roadmap'))
          }
          title="Toggle satellite hybrid map"
          className="min-w-[44px] min-h-[44px] rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 text-slate-800 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center shadow-lg transition-colors"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleRecenter}
          title="Recenter map on 200m target zone"
          className="min-w-[44px] min-h-[44px] rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 text-slate-800 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center shadow-lg transition-colors"
        >
          <Compass className="w-4 h-4" />
        </button>
        <div className="flex flex-col rounded-xl bg-white/90 backdrop-blur-md border border-slate-200 shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => handleZoom(1)}
            title="Zoom in"
            className="min-w-[44px] min-h-[44px] text-slate-800 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center border-b border-slate-200 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-1)}
            title="Zoom out"
            className="min-w-[44px] min-h-[44px] text-slate-800 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live 200m Scan Status Indicator */}
      {isScanning200m && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-lg bg-white/95 border border-slate-300 shadow-lg flex items-center gap-2 text-xs text-slate-800 whitespace-nowrap">
          <Radar className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
          <span>Scanning 200m neighboring streets via Google Maps...</span>
        </div>
      )}
    </div>
  );
};
