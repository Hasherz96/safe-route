import React, { useState, useEffect, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  Smartphone,
  Maximize2,
  Code2,
  Wifi,
  BatteryCharging,
  ChevronLeft,
  Circle,
  Square,
} from 'lucide-react';
import { SafetyMapCanvas } from './components/SafetyMapCanvas';
import { FloatingSearchOverlay } from './components/FloatingSearchOverlay';
import { SafetyBottomSheet } from './components/SafetyBottomSheet';
import { AndroidSourceModal } from './components/AndroidSourceModal';
import type {
  PlaceSelection,
  SafetyAnalysisResponse,
  TravelModeOption,
  ComputedRouteDetails,
  NearbyAreaContext,
} from './types/safety';

const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export default function App() {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [viewportMode, setViewportMode] = useState<'device' | 'fullscreen'>(
    'device'
  );
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);

  const [origin, setOrigin] = useState<PlaceSelection | null>(null);
  const [destination, setDestination] = useState<PlaceSelection | null>(null);
  const [nearbyArea, setNearbyArea] = useState<NearbyAreaContext | null>(null);
  const [directionsEnabled, setDirectionsEnabled] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelModeOption>('WALKING');
  const [routeDetails, setRouteDetails] =
    useState<ComputedRouteDetails | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [gpsStatus, setGpsStatus] = useState<
    'idle' | 'locating' | 'granted' | 'denied'
  >('idle');
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);

  const [safetyData, setSafetyData] =
    useState<SafetyAnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  useEffect(() => {
    const handleQuotaEvent = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuotaEvent);
    return () =>
      window.removeEventListener('gmp-quota-exceeded', handleQuotaEvent);
  }, []);

  // Trigger 200m Radius + Preprocessed Crime Safety Analysis
  const analyzeSafetyForPlace = useCallback(
    async (
      target: PlaceSelection,
      areaContext?: NearbyAreaContext | null,
      currentOrigin?: PlaceSelection | null,
      mode?: TravelModeOption
    ) => {
      setIsAnalyzing(true);
      try {
        const res = await fetch('/api/safety/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationName: target.name,
            address: target.address,
            coordinates: target.location,
            nearbyArea: areaContext || nearbyArea,
            originName: currentOrigin?.name,
            travelMode: mode || travelMode,
          }),
        });
        if (!res.ok) {
          throw new Error(`Status ${res.status}`);
        }
        const data: SafetyAnalysisResponse = await res.json();
        setSafetyData(data);
      } catch (err) {
        console.error('Safety analysis request failed:', err);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [nearbyArea, travelMode]
  );

  // When user selects a destination, we set destination; SafetyMapCanvas then scans the 200m radius via Google Maps Place.searchNearby and calls handleNearbyAreaDiscovered
  const handleSelectDestination = useCallback((place: PlaceSelection) => {
    setDestination(place);
    setIsAnalyzing(true);
  }, []);

  const handleNearbyAreaDiscovered = useCallback(
    (target: PlaceSelection, discoveredArea: NearbyAreaContext) => {
      setNearbyArea(discoveredArea);
      analyzeSafetyForPlace(target, discoveredArea, origin, travelMode);
    },
    [origin, travelMode, analyzeSafetyForPlace]
  );

  const handleSelectOrigin = useCallback(
    (place: PlaceSelection) => {
      setOrigin(place);
      setGpsErrorMsg(null);
      if (destination) {
        analyzeSafetyForPlace(destination, nearbyArea, place, travelMode);
      }
    },
    [destination, nearbyArea, travelMode, analyzeSafetyForPlace]
  );

  const handleRequestCurrentLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsStatus('denied');
      setGpsErrorMsg(
        'Android GPS hardware unavailable in this browser context. Using nearby starting point.'
      );
      if (destination) {
        setOrigin({
          name: 'Current Location (Simulated GPS)',
          address: 'Near active map sector',
          location: {
            lat: destination.location.lat - 0.012,
            lng: destination.location.lng - 0.014,
          },
        });
      }
      return;
    }

    setGpsStatus('locating');
    setGpsErrorMsg(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus('granted');
        setGpsErrorMsg(null);
        const gpsPlace: PlaceSelection = {
          name: 'Current GPS Location',
          address: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        };
        setOrigin(gpsPlace);
      },
      (_err) => {
        setGpsStatus('denied');
        setGpsErrorMsg(
          'ACCESS_FINE_LOCATION permission denied or unavailable. Assigned a nearby corridor origin so you can test turn-by-turn routing.'
        );
        if (destination) {
          setOrigin({
            name: 'Nearby Transit Hub (Fallback GPS)',
            address: '0.9 mi from destination',
            location: {
              lat: destination.location.lat - 0.011,
              lng: destination.location.lng - 0.012,
            },
          });
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    );
  }, [destination]);

  const handleToggleDirections = useCallback(() => {
    setDirectionsEnabled((prev) => {
      const next = !prev;
      if (next && !origin && destination) {
        setOrigin({
          name: 'Civic Center Station',
          address: 'Starting corridor point',
          location: {
            lat: destination.location.lat - 0.0095,
            lng: destination.location.lng - 0.0085,
          },
        });
      }
      if (!next) {
        setRouteDetails(null);
        setRouteError(null);
      }
      return next;
    });
  }, [origin, destination]);

  const handleStartDirectionsFromSheet = useCallback(() => {
    if (!directionsEnabled) {
      handleToggleDirections();
    }
  }, [directionsEnabled, handleToggleDirections]);

  const handleClearRoute = useCallback(() => {
    setDirectionsEnabled(false);
    setRouteDetails(null);
    setRouteError(null);
  }, []);

  const handleAndroidBackPress = useCallback(() => {
    if (isSourceModalOpen) {
      setIsSourceModalOpen(false);
      return true;
    }
    if (sheetExpanded) {
      setSheetExpanded(false);
      return true;
    }
    if (directionsEnabled) {
      handleClearRoute();
      return true;
    }
    return false;
  }, [isSourceModalOpen, sheetExpanded, directionsEnabled, handleClearRoute]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAndroidBackPress();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleAndroidBackPress]);

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      libraries={['places', 'routes', 'marker']}
    >
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-950 text-slate-100">
        {quotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner,
              visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        {/* Strict 3-Zone Top Bar Contract */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-800/80 bg-slate-950/95 shrink-0 z-40">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setSheetExpanded(false);
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap"
          >
            SafeRoute Android
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
            <a
              href="#map"
              onClick={(e) => {
                e.preventDefault();
                setSheetExpanded(false);
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              200m Map
            </a>
            <a
              href="#intelligence"
              onClick={(e) => {
                e.preventDefault();
                setSheetExpanded(true);
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Crime Sheet
            </a>
            <a
              href="#routing"
              onClick={(e) => {
                e.preventDefault();
                if (!directionsEnabled) handleToggleDirections();
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Safe Routing
            </a>
            <a
              href="#source"
              onClick={(e) => {
                e.preventDefault();
                setIsSourceModalOpen(true);
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Expo Manifest
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                setViewportMode((prev) =>
                  prev === 'device' ? 'fullscreen' : 'device'
                )
              }
              className="hidden sm:inline-flex min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {viewportMode === 'device' ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Full Canvas</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Android Frame</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSourceModalOpen(true)}
              className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Native Code</span>
            </button>
          </div>
        </header>

        <main className="flex-1 relative flex items-center justify-center overflow-hidden bg-slate-950 p-0 sm:p-4">
          <div
            className={`relative flex flex-col bg-slate-950 overflow-hidden transition-all duration-200 ${
              viewportMode === 'device'
                ? 'w-full h-full sm:w-[420px] sm:h-[840px] sm:max-h-full sm:rounded-[38px] sm:border-[6px] sm:border-slate-800 sm:shadow-[0_25px_70px_rgba(0,0,0,0.85)]'
                : 'w-full h-full rounded-none sm:rounded-2xl sm:border sm:border-slate-800'
            }`}
          >
            {/* Translucent Android Status Bar */}
            <div className="h-7 px-5 bg-slate-950/90 backdrop-blur-md flex items-center justify-between text-[11px] font-mono-tabular text-slate-300 shrink-0 z-40 border-b border-slate-900">
              <span>09:41</span>
              <div className="w-16 h-3 rounded-full bg-black/80 border border-slate-800/80 hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-400 font-sans font-medium">
                  5G
                </span>
                <Wifi className="w-3 h-3 text-slate-300" />
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-400" />
              </div>
            </div>

            {/* Interactive Android Screen Viewport */}
            <div className="relative flex-1 w-full overflow-hidden">
              <FloatingSearchOverlay
                origin={origin}
                destination={destination}
                directionsEnabled={directionsEnabled}
                travelMode={travelMode}
                gpsStatus={gpsStatus}
                gpsErrorMsg={gpsErrorMsg}
                onSelectDestination={handleSelectDestination}
                onSelectOrigin={handleSelectOrigin}
                onRequestCurrentLocation={handleRequestCurrentLocation}
                onToggleDirections={handleToggleDirections}
                onChangeTravelMode={setTravelMode}
                onClearRoute={handleClearRoute}
                onQuotaExceeded={() => setQuotaExceeded(true)}
              />

              <SafetyMapCanvas
                origin={origin}
                destination={destination}
                directionsEnabled={directionsEnabled}
                travelMode={travelMode}
                safetyData={safetyData}
                isAnalyzing={isAnalyzing}
                onNearbyAreaDiscovered={handleNearbyAreaDiscovered}
                onRouteComputed={setRouteDetails}
                onRouteError={setRouteError}
                onMarkerPress={() => setSheetExpanded(true)}
                onQuotaExceeded={() => setQuotaExceeded(true)}
              />

              <SafetyBottomSheet
                expanded={sheetExpanded}
                onToggleExpand={(next) =>
                  setSheetExpanded((prev) =>
                    typeof next === 'boolean' ? next : !prev
                  )
                }
                destination={destination}
                nearbyArea={nearbyArea}
                safetyData={safetyData}
                isAnalyzing={isAnalyzing}
                routeDetails={routeDetails}
                routeError={routeError}
                onRefreshAnalysis={() => {
                  if (destination) {
                    analyzeSafetyForPlace(
                      destination,
                      nearbyArea,
                      origin,
                      travelMode
                    );
                  }
                }}
                onStartDirections={handleStartDirectionsFromSheet}
              />
            </div>

            {/* Native Android System Navigation Bar */}
            <div className="h-10 bg-slate-950 border-t border-slate-900 px-12 flex items-center justify-between shrink-0 z-40">
              <button
                type="button"
                onClick={handleAndroidBackPress}
                title="Android Back Button"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all cursor-pointer"
                aria-label="Android Back Button"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetExpanded(false);
                  handleClearRoute();
                }}
                title="Android Home Button"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all cursor-pointer"
                aria-label="Android Home Button"
              >
                <Circle className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(true)}
                title="Android Recents / Expo Source Inspector"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all cursor-pointer"
                aria-label="Android Overview Button"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </main>

        <AndroidSourceModal
          isOpen={isSourceModalOpen}
          onClose={() => setIsSourceModalOpen(false)}
        />
      </div>
    </APIProvider>
  );
}
