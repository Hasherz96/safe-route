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
import { isTooLargeToScore } from './placeScope';
import type {
  PlaceSelection,
  SafetyAnalysisResponse,
  NearbyAreaContext,
} from './types/safety';

// Built into the bundle in local development; in a deployed container the
// server provides it at runtime from /api/config instead
const BUILD_TIME_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string | null>(
    BUILD_TIME_MAPS_API_KEY || null
  );

  useEffect(() => {
    if (mapsApiKey !== null) return;
    fetch('/api/config')
      .then((res): Promise<{ googleMapsApiKey?: string }> => (res.ok ? res.json() : Promise.resolve({})))
      .then((config) => setMapsApiKey(config.googleMapsApiKey || ''))
      .catch(() => setMapsApiKey(''));
  }, [mapsApiKey]);

  if (mapsApiKey === null) {
    return <div className="h-screen w-screen bg-slate-50" aria-busy="true" />;
  }
  return <SafeRouteApp mapsApiKey={mapsApiKey} />;
}

function SafeRouteApp({ mapsApiKey }: { mapsApiKey: string }) {
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [viewportMode, setViewportMode] = useState<'device' | 'fullscreen'>(
    'device'
  );
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);

  const [destination, setDestination] = useState<PlaceSelection | null>(null);
  const [nearbyArea, setNearbyArea] = useState<NearbyAreaContext | null>(null);
  const [safetyData, setSafetyData] =
    useState<SafetyAnalysisResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const handleQuotaExceeded = useCallback(() => setQuotaExceeded(true), []);

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
      areaContext?: NearbyAreaContext | null
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
            types: target.types,
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
    [nearbyArea]
  );

  // When user selects a destination, we set destination; SafetyMapCanvas then scans the 200m radius via Google Maps Place.searchNearby and calls handleNearbyAreaDiscovered.
  // Neighbourhoods, towns and larger areas aren't scored: the sheet asks for a more specific place.
  const handleSelectDestination = useCallback((place: PlaceSelection) => {
    const tooLarge = isTooLargeToScore(place.types);
    setDestination(place);
    setIsAnalyzing(!tooLarge);
    if (tooLarge) {
      setSafetyData(null);
      setSheetExpanded(false);
    }
  }, []);

  const destinationTooLarge = isTooLargeToScore(destination?.types);

  const handleNearbyAreaDiscovered = useCallback(
    (target: PlaceSelection, discoveredArea: NearbyAreaContext) => {
      setNearbyArea(discoveredArea);
      analyzeSafetyForPlace(target, discoveredArea);
    },
    [analyzeSafetyForPlace]
  );

  const handleAndroidBackPress = useCallback(() => {
    if (isSourceModalOpen) {
      setIsSourceModalOpen(false);
      return true;
    }
    if (sheetExpanded) {
      setSheetExpanded(false);
      return true;
    }
    return false;
  }, [isSourceModalOpen, sheetExpanded]);

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
      apiKey={mapsApiKey}
      libraries={['places', 'marker']}
    >
      <div className="h-screen w-screen overflow-hidden flex flex-col bg-slate-50 text-slate-900">
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
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200/80 bg-slate-50/95 shrink-0 z-40">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setSheetExpanded(false);
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap"
          >
            BeSafe Android
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
            <a
              href="#map"
              onClick={(e) => {
                e.preventDefault();
                setSheetExpanded(false);
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              200m Map
            </a>
            <a
              href="#intelligence"
              onClick={(e) => {
                e.preventDefault();
                setSheetExpanded(true);
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
            >
              Crime Sheet
            </a>
            <a
              href="#source"
              onClick={(e) => {
                e.preventDefault();
                setIsSourceModalOpen(true);
              }}
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap"
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
              className="hidden sm:inline-flex min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {viewportMode === 'device' ? (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Full Canvas</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Android Frame</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSourceModalOpen(true)}
              className="min-h-[38px] px-3.5 py-1.5 text-xs font-semibold text-slate-900 bg-emerald-600 hover:bg-emerald-700 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Native Code</span>
            </button>
          </div>
        </header>

        <main className="flex-1 relative flex items-center justify-center overflow-hidden bg-slate-50 p-0 sm:p-4">
          <div
            className={`relative flex flex-col bg-slate-50 overflow-hidden transition-all duration-200 ${
              viewportMode === 'device'
                ? 'w-full h-full sm:w-[420px] sm:h-[840px] sm:max-h-full sm:rounded-[38px] sm:border-[6px] sm:border-slate-200 sm:shadow-[0_25px_70px_rgba(15,23,42,0.18)]'
                : 'w-full h-full rounded-none sm:rounded-2xl sm:border sm:border-slate-200'
            }`}
          >
            {/* Translucent Android Status Bar */}
            <div className="h-7 px-5 bg-slate-50/90 backdrop-blur-md flex items-center justify-between text-[11px] font-mono-tabular text-slate-700 shrink-0 z-40 border-b border-slate-200">
              <span>09:41</span>
              <div className="w-16 h-3 rounded-full bg-black/80 border border-slate-200/80 hidden sm:block" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-600 font-sans font-medium">
                  5G
                </span>
                <Wifi className="w-3 h-3 text-slate-700" />
                <BatteryCharging className="w-3.5 h-3.5 text-emerald-600" />
              </div>
            </div>

            {/* Interactive Android Screen Viewport */}
            <div className="relative flex-1 w-full overflow-hidden">
              <FloatingSearchOverlay
                destination={destination}
                onSelectDestination={handleSelectDestination}
                onQuotaExceeded={handleQuotaExceeded}
              />

              <SafetyMapCanvas
                destination={destination}
                destinationTooLarge={destinationTooLarge}
                safetyData={safetyData}
                isAnalyzing={isAnalyzing}
                onNearbyAreaDiscovered={handleNearbyAreaDiscovered}
                onMarkerPress={() => setSheetExpanded(true)}
                onQuotaExceeded={handleQuotaExceeded}
              />

              <SafetyBottomSheet
                expanded={sheetExpanded}
                onToggleExpand={(next) =>
                  setSheetExpanded((prev) =>
                    typeof next === 'boolean' ? next : !prev
                  )
                }
                destination={destination}
                destinationTooLarge={destinationTooLarge}
                safetyData={safetyData}
                isAnalyzing={isAnalyzing}
              />
            </div>

            {/* Native Android System Navigation Bar */}
            <div className="h-10 bg-slate-50 border-t border-slate-200 px-12 flex items-center justify-between shrink-0 z-40">
              <button
                type="button"
                onClick={handleAndroidBackPress}
                title="Android Back Button"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-slate-900 active:scale-90 transition-all cursor-pointer"
                aria-label="Android Back Button"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setSheetExpanded(false)}
                title="Android Home Button"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-slate-900 active:scale-90 transition-all cursor-pointer"
                aria-label="Android Home Button"
              >
                <Circle className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsSourceModalOpen(true)}
                title="Android Recents / Expo Source Inspector"
                className="min-w-[44px] min-h-[36px] flex items-center justify-center text-slate-500 hover:text-slate-900 active:scale-90 transition-all cursor-pointer"
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
