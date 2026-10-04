import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  Navigation,
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
  TravelModeOption,
  ComputedRouteDetails,
  RouteStepInfo,
  NearbyAreaContext,
  NearbyPlaceItem,
} from '../types/safety';
import {
  ENABLE_SRI_LANKA_PROTOTYPE,
  SRI_LANKA_DEFAULT_CENTER,
  SRI_LANKA_STREET_SUFFIX_REGEX,
} from '../sriLankaPrototype/sriLankaConfig';

interface SafetyMapCanvasProps {
  origin: PlaceSelection | null;
  destination: PlaceSelection | null;
  directionsEnabled: boolean;
  travelMode: TravelModeOption;
  safetyData: SafetyAnalysisResponse | null;
  isAnalyzing: boolean;
  onNearbyAreaDiscovered: (
    target: PlaceSelection,
    nearbyArea: NearbyAreaContext
  ) => void;
  onRouteComputed: (route: ComputedRouteDetails | null) => void;
  onRouteError: (err: string | null) => void;
  onMarkerPress: () => void;
  onQuotaExceeded: () => void;
}

function getSafetyAccent(score: number | undefined) {
  if (score === undefined) {
    return {
      bg: 'bg-slate-800',
      border: 'border-slate-600',
      text: 'text-slate-100',
      hex: '#38bdf8',
      label: 'Scanning 200m',
    };
  }
  if (score >= 4.0) {
    return {
      bg: 'bg-emerald-950/95',
      border: 'border-emerald-400',
      text: 'text-emerald-300',
      hex: '#10b981',
      label: 'Safe',
    };
  }
  if (score >= 3.0) {
    return {
      bg: 'bg-amber-950/95',
      border: 'border-amber-400',
      text: 'text-amber-300',
      hex: '#f59e0b',
      label: 'Moderate Risk',
    };
  }
  return {
    bg: 'bg-rose-950/95',
    border: 'border-rose-500',
    text: 'text-rose-300',
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
  origin,
  destination,
  directionsEnabled,
  travelMode,
  safetyData,
  isAnalyzing,
  onNearbyAreaDiscovered,
  onRouteComputed,
  onRouteError,
  onMarkerPress,
  onQuotaExceeded,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const polylinesRef = useRef<any[]>([]);
  const radiusCircleRef = useRef<any | null>(null);
  const lastScannedPlaceKeyRef = useRef<string>('');

  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [isComputingRoute, setIsComputingRoute] = useState(false);
  const [isScanning200m, setIsScanning200m] = useState(false);
  const [nearbyPlaces200m, setNearbyPlaces200m] = useState<NearbyPlaceItem[]>(
    []
  );

  const clearPolylines = useCallback(() => {
    polylinesRef.current.forEach((poly) => poly.setMap(null));
    polylinesRef.current = [];
  }, []);

  // Draw & update the 200-meter radius Circle overlay on Google Map
  useEffect(() => {
    if (!map || !mapsLib) return;

    if (radiusCircleRef.current) {
      radiusCircleRef.current.setMap(null);
      radiusCircleRef.current = null;
    }

    if (!destination) return;

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

    if (map && (!directionsEnabled || !origin)) {
      map.panTo(destination.location);
      map.setZoom(16); // Zoom 16 frames the 200m radius circle clearly
    }

    let isCancelled = false;
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
    };
  }, [
    destination,
    placesLib,
    map,
    directionsEnabled,
    origin,
    onNearbyAreaDiscovered,
    onQuotaExceeded,
  ]);

  // Compute route using modern Routes API (google.maps.routes.Route.computeRoutes)
  useEffect(() => {
    clearPolylines();

    if (
      !map ||
      !mapsLib ||
      !routesLib ||
      !directionsEnabled ||
      !origin ||
      !destination
    ) {
      onRouteComputed(null);
      onRouteError(null);
      return;
    }

    let isCancelled = false;
    setIsComputingRoute(true);
    onRouteError(null);

    const accent = getSafetyAccent(safetyData?.safety_rating);

    const runComputeRoute = async () => {
      try {
        const RouteClass = (routesLib as any).Route;
        if (!RouteClass || typeof RouteClass.computeRoutes !== 'function') {
          throw new Error('Google Maps Routes library not available.');
        }

        const request: any = {
          origin: origin.location,
          destination: destination.location,
          travelMode: travelMode,
          fields: [
            'path',
            'legs',
            'distanceMeters',
            'durationMillis',
            'localizedValues',
            'viewport',
          ],
        };

        const response = await RouteClass.computeRoutes(request);
        if (isCancelled) return;

        const computedRoute = response?.routes?.[0];
        if (!computedRoute) {
          onRouteError('No turn-by-turn route found between these points.');
          onRouteComputed(null);
          setIsComputingRoute(false);
          return;
        }

        // Extract path coordinates
        const rawPath: Coordinates[] = [];
        if (Array.isArray(computedRoute.path)) {
          for (const pt of computedRoute.path) {
            const lat = typeof pt.lat === 'function' ? pt.lat() : pt.lat;
            const lng = typeof pt.lng === 'function' ? pt.lng() : pt.lng;
            if (typeof lat === 'number' && typeof lng === 'number') {
              rawPath.push({ lat, lng });
            }
          }
        }

        // Draw outer casing polyline + inner safety-colored route polyline
        const PolylineClass = (mapsLib as any).Polyline;
        if (rawPath.length > 0 && PolylineClass) {
          const outerPoly = new PolylineClass({
            path: rawPath,
            geodesic: true,
            strokeColor: '#090d16',
            strokeOpacity: 0.85,
            strokeWeight: 9,
            map,
            zIndex: 10,
          });

          const innerPoly = new PolylineClass({
            path: rawPath,
            geodesic: true,
            strokeColor: accent.hex,
            strokeOpacity: 0.95,
            strokeWeight: 5,
            map,
            zIndex: 11,
          });

          polylinesRef.current = [outerPoly, innerPoly];
        } else if (typeof computedRoute.createPolylines === 'function') {
          const sdkPolylines: any[] = computedRoute.createPolylines();
          sdkPolylines.forEach((p) => {
            p.setOptions({
              strokeColor: accent.hex,
              strokeWeight: 5,
              map,
            });
          });
          polylinesRef.current = sdkPolylines;
        }

        // Fit map bounds to route viewport
        if (computedRoute.viewport) {
          map.fitBounds(computedRoute.viewport, {
            top: 140,
            bottom: 240,
            left: 48,
            right: 48,
          });
        }

        const leg = computedRoute.legs?.[0];
        const steps: RouteStepInfo[] = Array.isArray(leg?.steps)
          ? leg.steps.slice(0, 12).map((step: any, idx: number) => ({
              instruction:
                step?.instructions ||
                step?.navigationInstruction?.instructions ||
                `Segment ${idx + 1} toward destination`,
              distanceText:
                step?.localizedValues?.distance ||
                (step?.distanceMeters
                  ? `${Math.round(step.distanceMeters)} m`
                  : ''),
              durationText:
                step?.localizedValues?.staticDuration ||
                (step?.staticDurationMillis
                  ? `${Math.max(1, Math.round(step.staticDurationMillis / 60000))} min`
                  : ''),
            }))
          : [];

        const distanceMeters = computedRoute.distanceMeters || 0;
        const durationMillis = computedRoute.durationMillis || 0;

        const distanceText =
          computedRoute.localizedValues?.distance ||
          (distanceMeters >= 1000
            ? `${(distanceMeters / 1000).toFixed(1)} km`
            : `${Math.round(distanceMeters)} m`);

        const durationText =
          computedRoute.localizedValues?.duration ||
          `${Math.max(1, Math.round(durationMillis / 60000))} min`;

        onRouteComputed({
          distanceText,
          durationText,
          distanceMeters,
          durationMillis,
          path: rawPath,
          steps,
          travelMode,
        });
      } catch (err: any) {
        if (isCancelled) return;
        const msg = String(err?.message || err || '');
        if (
          msg.includes('429') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('Quota')
        ) {
          onQuotaExceeded();
        }
        console.error('Route computation error:', err);
        onRouteError(
          'Could not calculate turn-by-turn directions for the selected mode.'
        );
        onRouteComputed(null);
      } finally {
        if (!isCancelled) {
          setIsComputingRoute(false);
        }
      }
    };

    runComputeRoute();

    return () => {
      isCancelled = true;
    };
  }, [
    map,
    mapsLib,
    routesLib,
    directionsEnabled,
    origin,
    destination,
    travelMode,
    safetyData?.safety_rating,
    clearPolylines,
    onRouteComputed,
    onRouteError,
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
      map.setZoom(16);
    } else if (origin) {
      map.panTo(origin.location);
      map.setZoom(15);
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
        colorScheme="DARK"
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
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700/80 text-[10px] text-slate-300 shadow">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="max-w-[85px] truncate">{np.name}</span>
              <span className="text-slate-500 font-mono-tabular">
                {np.distanceMeters}m
              </span>
            </div>
          </AdvancedMarker>
        ))}

        {/* Origin / Current GPS Marker */}
        {origin && (
          <AdvancedMarker
            position={origin.location}
            title={`Origin: ${origin.name}`}
          >
            <div className="relative flex items-center justify-center">
              <span className="absolute w-8 h-8 rounded-full bg-sky-500/30 animate-ping" />
              <div className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/95 border border-sky-400/70 shadow-lg text-xs font-medium text-sky-200 whitespace-nowrap">
                <Navigation className="w-3.5 h-3.5 text-sky-400 fill-sky-400/30" />
                <span className="max-w-[110px] truncate">{origin.name}</span>
              </div>
            </div>
          </AdvancedMarker>
        )}

        {/* Destination Custom Safety Score Map Callout Pin */}
        {destination && (
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
                  <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                ) : safetyData && safetyData.safety_rating >= 4.0 ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : safetyData && safetyData.safety_rating >= 3.0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                )}

                <div className="flex flex-col items-start text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium text-slate-300 max-w-[125px] truncate leading-tight">
                      {destination.name}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-slate-400">
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
                    <span className="text-slate-500" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[11px] text-slate-300 whitespace-nowrap">
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
                className="w-3 h-3 rotate-45 -mt-1.5 border-r-2 border-b-2 bg-slate-950"
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
          className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800 flex items-center justify-center shadow-lg transition-colors"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleRecenter}
          title="Recenter map on 200m target zone"
          className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 text-slate-200 hover:text-white hover:bg-slate-800 flex items-center justify-center shadow-lg transition-colors"
        >
          <Compass className="w-4 h-4" />
        </button>
        <div className="flex flex-col rounded-xl bg-slate-900/90 backdrop-blur-md border border-slate-800 shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => handleZoom(1)}
            title="Zoom in"
            className="min-w-[44px] min-h-[44px] text-slate-200 hover:text-white hover:bg-slate-800 flex items-center justify-center border-b border-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleZoom(-1)}
            title="Zoom out"
            className="min-w-[44px] min-h-[44px] text-slate-200 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live 200m Scan / Route Status Indicator */}
      {(isScanning200m || isComputingRoute) && (
        <div className="absolute top-36 left-1/2 -translate-x-1/2 z-20 px-3.5 py-1.5 rounded-lg bg-slate-900/95 border border-slate-700 shadow-lg flex items-center gap-2 text-xs text-slate-200 whitespace-nowrap">
          <Radar className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
          <span>
            {isScanning200m
              ? 'Scanning 200m neighboring streets via Google Maps...'
              : 'Calculating turn-by-turn corridor...'}
          </span>
        </div>
      )}
    </div>
  );
};
