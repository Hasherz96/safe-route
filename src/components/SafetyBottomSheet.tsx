import React, { useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Navigation,
  Calculator,
  Filter,
  Radar,
} from 'lucide-react';
import type {
  SafetyAnalysisResponse,
  ComputedRouteDetails,
  PlaceSelection,
  CrimeType,
  NearbyAreaContext,
} from '../types/safety';
import {
  ENABLE_SRI_LANKA_PROTOTYPE,
  SRI_LANKA_NATIONAL_OUTLETS,
} from '../sriLankaPrototype/sriLankaConfig';

interface SafetyBottomSheetProps {
  expanded: boolean;
  onToggleExpand: (nextState?: boolean) => void;
  destination: PlaceSelection | null;
  nearbyArea: NearbyAreaContext | null;
  safetyData: SafetyAnalysisResponse | null;
  isAnalyzing: boolean;
  routeDetails: ComputedRouteDetails | null;
  routeError: string | null;
  onRefreshAnalysis: () => void;
  onStartDirections: () => void;
}

function getScoreTheme(score: number) {
  if (score >= 4.0) {
    return {
      text: 'text-emerald-400',
      stroke: '#10b981',
      border: 'border-emerald-500/30',
      subtleBg: 'bg-emerald-950/30',
      badgeLabel: 'Safe Area',
    };
  }
  if (score >= 3.0) {
    return {
      text: 'text-amber-400',
      stroke: '#f59e0b',
      border: 'border-amber-500/30',
      subtleBg: 'bg-amber-950/30',
      badgeLabel: 'Moderate Risk',
    };
  }
  return {
    text: 'text-rose-400',
    stroke: '#f43f5e',
    border: 'border-rose-500/30',
    subtleBg: 'bg-rose-950/30',
    badgeLabel: 'High Risk',
  };
}

export const SafetyBottomSheet: React.FC<SafetyBottomSheetProps> = ({
  expanded,
  onToggleExpand,
  destination,
  nearbyArea,
  safetyData,
  isAnalyzing,
  routeDetails,
  routeError,
  onRefreshAnalysis,
  onStartDirections,
}) => {
  const [selectedCrimeFilter, setSelectedCrimeFilter] = useState<
    'ALL' | CrimeType
  >('ALL');
  const [activeTab, setActiveTab] = useState<
    'intelligence' | 'preprocessor' | 'directions' | 'formula'
  >('intelligence');
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  const score = safetyData?.safety_rating ?? 5.0;
  const theme = getScoreTheme(score);

  const incidents = safetyData?.incident_breakdown || [];
  const filteredIncidents =
    selectedCrimeFilter === 'ALL'
      ? incidents
      : incidents.filter((i) => i.crime_type === selectedCrimeFilter);

  const totalPenalty =
    safetyData?.total_penalty ??
    Number(
      incidents
        .reduce((acc, item) => acc + (item.calculated_penalty || 0), 0)
        .toFixed(2)
    );

  const audit = safetyData?.preprocessing_audit;
  const streets200m =
    nearbyArea?.surroundingStreets?.length
      ? nearbyArea.surroundingStreets
      : audit?.scanned_streets_200m || [];
  const places200m =
    nearbyArea?.nearbyPlaces?.length
      ? nearbyArea.nearbyPlaces.map((p) => `${p.name} (${p.distanceMeters}m)`)
      : audit?.scanned_places_200m || [];

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartY(e.touches[0].clientY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY === null) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    if (deltaY < -40 && !expanded) {
      onToggleExpand(true);
    } else if (deltaY > 40 && expanded) {
      onToggleExpand(false);
    }
    setTouchStartY(null);
  };

  const radius = 38;
  const circumference = Math.PI * radius;
  const progressFraction = Math.max(0, Math.min(1, score / 5.0));
  const strokeDashoffset = circumference * (1 - progressFraction);

  return (
    <div
      className={`absolute left-0 right-0 bottom-0 z-30 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 rounded-t-3xl shadow-2xl transition-transform duration-200 ease-out flex flex-col ${
        expanded
          ? 'h-[80%] translate-y-0'
          : 'h-auto max-h-[195px] translate-y-0'
      }`}
    >
      {/* Drag Handle & Header Bar */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="px-4 pt-2 pb-3 border-b border-slate-800/80 shrink-0"
      >
        <button
          type="button"
          onClick={() => onToggleExpand(!expanded)}
          className="w-full flex flex-col items-center focus:outline-none cursor-pointer"
          aria-label={
            expanded
              ? 'Collapse safety intelligence sheet'
              : 'Expand safety intelligence sheet'
          }
        >
          <div className="w-10 h-1.5 bg-slate-700 rounded-full my-1.5" />
        </button>

        {isAnalyzing ? (
          <div className="flex items-center justify-between gap-3 py-1 animate-pulse">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-800 rounded w-3/4" />
                <div className="h-3 bg-slate-800 rounded w-1/2" />
              </div>
            </div>
            <div className="w-24 h-10 bg-slate-800 rounded-xl shrink-0" />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div
              onClick={() => onToggleExpand(!expanded)}
              className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
            >
              <div
                className={`w-12 h-12 rounded-2xl border ${theme.border} ${theme.subtleBg} flex flex-col items-center justify-center shrink-0`}
              >
                <span
                  className={`font-mono-tabular text-base font-semibold leading-none ${theme.text}`}
                >
                  {score.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400 font-mono-tabular mt-0.5">
                  / 5.0
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-semibold text-slate-100 truncate">
                    {safetyData?.location ||
                      destination?.name ||
                      'Select a Destination'}
                  </h2>
                </div>

                {/* Clean unboxed metadata with typographic separators */}
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 truncate">
                  <span className={`font-medium ${theme.text}`}>
                    {safetyData?.risk_level || theme.badgeLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>200m Radius</span>
                  <span aria-hidden="true">·</span>
                  {routeDetails ? (
                    <>
                      <span className="font-mono-tabular text-slate-200 font-medium">
                        {routeDetails.durationText}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular text-slate-300">
                        {routeDetails.distanceText}
                      </span>
                    </>
                  ) : (
                    <span className="font-mono-tabular">
                      {incidents.length} verified{' '}
                      {incidents.length === 1 ? 'crime' : 'crimes'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!routeDetails && destination && (
                <button
                  type="button"
                  onClick={onStartDirections}
                  className="min-h-[44px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Route</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onToggleExpand(!expanded)}
                aria-label={expanded ? 'Collapse sheet' : 'Expand sheet'}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 flex items-center justify-center transition-colors"
              >
                {expanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expanded Scrollable Body */}
      {expanded && (
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 space-y-6">
          {isAnalyzing ? (
            <div className="space-y-5 animate-pulse">
              <div className="h-28 rounded-2xl bg-slate-800/70" />
              <div className="space-y-2">
                <div className="h-4 bg-slate-800/80 rounded w-1/3" />
                <div className="h-16 bg-slate-800/60 rounded-xl" />
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-slate-800/80 rounded w-2/5" />
                <div className="h-20 bg-slate-800/60 rounded-xl" />
                <div className="h-20 bg-slate-800/60 rounded-xl" />
              </div>
            </div>
          ) : (
            <>
              {/* Section Switcher Tabs */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/90 flex-1 overflow-x-auto custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => setActiveTab('intelligence')}
                    className={`flex-1 min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'intelligence'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    200m Crimes ({incidents.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preprocessor')}
                    className={`flex-1 min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'preprocessor'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    200m Filter Audit
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('directions')}
                    className={`flex-1 min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'directions'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Route {routeDetails ? `(${routeDetails.durationText})` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('formula')}
                    className={`flex-1 min-h-[38px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      activeTab === 'formula'
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Math
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onRefreshAnalysis}
                  title="Re-run 200m neighborhood scan and crime preprocessor"
                  className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {activeTab === 'intelligence' && (
                <>
                  {/* Safety Gauge & Executive Overview */}
                  <div className="p-4 rounded-2xl bg-slate-950/90 border border-slate-800/90 flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="relative w-24 h-16 flex flex-col items-center justify-end">
                        <svg
                          viewBox="0 0 100 58"
                          className="w-24 h-14 overflow-visible"
                        >
                          <path
                            d="M 12 48 A 38 38 0 0 1 88 48"
                            fill="none"
                            stroke="#1e293b"
                            strokeWidth="8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M 12 48 A 38 38 0 0 1 88 48"
                            fill="none"
                            stroke={theme.stroke}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className="transition-all duration-300"
                          />
                        </svg>
                        <div className="absolute bottom-0 flex items-baseline gap-0.5">
                          <span
                            className={`font-mono-tabular text-xl font-bold ${theme.text}`}
                          >
                            {score.toFixed(1)}
                          </span>
                          <span className="font-mono-tabular text-[11px] text-slate-500">
                            /5.0
                          </span>
                        </div>
                      </div>

                      <div className="sm:hidden">
                        <div className={`text-sm font-semibold ${theme.text}`}>
                          {safetyData?.risk_level || theme.badgeLabel}
                        </div>
                        <div className="text-xs text-slate-400 font-mono-tabular mt-0.5">
                          Total Penalty: -{totalPenalty.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
                        <span className={`font-semibold ${theme.text}`}>
                          {safetyData?.risk_level || theme.badgeLabel}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          Base 5.0 − ({totalPenalty.toFixed(2)} / 5) ={' '}
                          {score.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-sm text-slate-200 leading-relaxed">
                        {safetyData?.summary ||
                          'Select any destination to map its 200m surrounding streets and evaluate verified crime incidents.'}
                      </p>
                    </div>
                  </div>

                  {/* Compact 200m Neighboring Streets Bar */}
                  {streets200m.length > 0 && (
                    <div className="py-2.5 px-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-300 flex items-center gap-2 flex-wrap">
                      <Radar className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-slate-400">
                        200m Corridors Scanned:
                      </span>
                      <span className="text-slate-200 font-medium">
                        {streets200m.join(' · ')}
                      </span>
                    </div>
                  )}

                  {/* Missing News Data Notice */}
                  {safetyData?.missing_news_notice && (
                    <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-start gap-2.5 text-xs text-emerald-200">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div className="leading-relaxed">
                        {safetyData.missing_news_notice}
                      </div>
                    </div>
                  )}

                  {/* Incident Breakdown Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-slate-100">
                        01. Verified 200m Crime Breakdown
                      </h3>
                      <span className="text-xs text-slate-400 font-mono-tabular">
                        {filteredIncidents.length} of {incidents.length} shown
                      </span>
                    </div>

                    {incidents.length > 0 && (
                      <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800/80 overflow-x-auto custom-scrollbar">
                        {(
                          [
                            'ALL',
                            'Violent',
                            'Burglary',
                            'Theft',
                            'Nuisance',
                          ] as const
                        ).map((filterKey) => {
                          const active = selectedCrimeFilter === filterKey;
                          return (
                            <button
                              key={filterKey}
                              type="button"
                              onClick={() => setSelectedCrimeFilter(filterKey)}
                              className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-slate-800 text-white shadow-sm'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {filterKey === 'ALL'
                                ? 'All Categories'
                                : filterKey}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {filteredIncidents.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-800 rounded-xl">
                        No verified criminal offenses inside the 200m radius
                        match this category filter.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80">
                        {filteredIncidents.map((inc, index) => {
                          const severityColor =
                            inc.severity_impact === 'High'
                              ? 'text-rose-400'
                              : inc.severity_impact === 'Medium'
                                ? 'text-amber-400'
                                : 'text-sky-400';

                          return (
                            <div
                              key={`${inc.crime_type}-${index}`}
                              className="py-3.5 flex items-start justify-between gap-4"
                            >
                              <div className="space-y-1 min-w-0 flex-1">
                                {/* Unboxed quiet metadata kicker */}
                                <div className="flex items-center gap-1.5 text-xs text-slate-400 flex-wrap">
                                  <span
                                    className={`font-semibold ${severityColor}`}
                                  >
                                    {inc.crime_type}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{inc.severity_impact} Impact</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{inc.recency}</span>
                                  {inc.matched_zone && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="text-emerald-300/90">
                                        {inc.matched_zone}
                                      </span>
                                    </>
                                  )}
                                </div>

                                {/* Headline / Description */}
                                <p className="text-sm font-medium text-slate-100 leading-snug">
                                  {inc.description}
                                </p>

                                {/* Source Attribution Line */}
                                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                  <span>{inc.source_type}</span>
                                  <span aria-hidden="true">/</span>
                                  <span className="text-slate-300">
                                    {inc.source_name}
                                  </span>
                                  {inc.source_url && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <a
                                        href={inc.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                                      >
                                        <span>Source</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Right-aligned Tabular Penalty Readout */}
                              <div className="text-right shrink-0">
                                <div className="font-mono-tabular text-sm font-semibold text-rose-400">
                                  -{Number(inc.calculated_penalty).toFixed(2)}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono-tabular">
                                  {inc.csw_weight
                                    ? `${inc.csw_weight}×${inc.source_multiplier ?? 1}×${inc.recency_multiplier ?? 0.7}`
                                    : 'penalty'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Pedestrian & Visitor Safety Recommendations */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold text-slate-100">
                      02. Pedestrian & Visitor Recommendations
                    </h3>
                    <div className="divide-y divide-slate-800/60 border-t border-b border-slate-800/60">
                      {(safetyData?.safety_recommendations || []).map(
                        (rec, idx) => (
                          <div
                            key={idx}
                            className="py-2.5 flex items-baseline gap-3 text-sm text-slate-200"
                          >
                            <span className="font-mono-tabular text-xs font-semibold text-emerald-400 shrink-0">
                              0{idx + 1}
                            </span>
                            <span className="leading-relaxed">{rec}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'preprocessor' && (
                <div className="space-y-5">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-sm font-semibold text-slate-100">
                        01. 200m Google Maps Neighborhood Discovery
                      </h3>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Before querying crime feeds, Google Maps{' '}
                      <span className="font-mono-tabular text-slate-300">
                        Place.searchNearby
                      </span>{' '}
                      maps all streets and landmarks within a 200-meter radius of
                      your searched destination:
                    </p>
                  </div>

                  <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80 text-xs">
                    <div className="py-2.5 flex flex-col gap-1">
                      <span className="text-slate-400">
                        Adjacent Streets in 200m Radius
                      </span>
                      <span className="text-slate-200 font-medium">
                        {streets200m.length > 0
                          ? streets200m.join(' · ')
                          : 'Primary destination street block'}
                      </span>
                    </div>
                    <div className="py-2.5 flex flex-col gap-1">
                      <span className="text-slate-400">
                        Neighboring Landmarks in 200m Radius ({places200m.length}
                        )
                      </span>
                      <span className="text-slate-200">
                        {places200m.length > 0
                          ? places200m.slice(0, 8).join(' · ')
                          : 'Scanning nearby establishments...'}
                      </span>
                    </div>
                    {ENABLE_SRI_LANKA_PROTOTYPE && (
                      <div className="py-2.5 flex flex-col gap-1">
                        <span className="text-emerald-400 font-medium">
                          Sri Lanka National News Outlets Scope (13 Outlets)
                        </span>
                        <span className="text-slate-200 leading-relaxed">
                          {SRI_LANKA_NATIONAL_OUTLETS.map(
                            (o) => o.displayName
                          ).join(' · ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Preprocessor Filtering Statistics */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold text-slate-100">
                      02. News Preprocessor & False-Positive Rejection Log
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Candidate news headlines are filtered to reject movie/film
                      shoots (e.g., Spider-Man filming locations), photo shoots,
                      sports shooting stats, and incidents outside the 200m
                      perimeter:
                    </p>

                    <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80 text-xs">
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-300">
                          Raw News & Community Articles Scanned
                        </span>
                        <span className="font-mono-tabular font-semibold text-slate-100">
                          {audit?.raw_candidates_scanned ?? 0}
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-300">
                          Rejected Non-Crime (Film Shoots, Sports, Metaphors)
                        </span>
                        <span className="font-mono-tabular font-semibold text-amber-400">
                          {audit?.rejected_non_crime_count ?? 0}
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-300">
                          Rejected Outside 200m Neighboring Perimeter
                        </span>
                        <span className="font-mono-tabular font-semibold text-slate-400">
                          {audit?.rejected_outside_radius_count ?? 0}
                        </span>
                      </div>
                      <div className="py-2 flex justify-between">
                        <span className="text-slate-300">
                          Verified 200m Criminal Incidents Scored
                        </span>
                        <span className="font-mono-tabular font-semibold text-emerald-400">
                          {audit?.verified_crime_count ?? incidents.length}
                        </span>
                      </div>
                    </div>

                    {audit?.rejected_examples &&
                      audit.rejected_examples.length > 0 && (
                        <div className="space-y-2 pt-2">
                          <div className="text-xs font-semibold text-slate-300">
                            Sample Rejected Headlines (Excluded from Score):
                          </div>
                          <div className="divide-y divide-slate-800/60 border-t border-b border-slate-800/60">
                            {audit.rejected_examples.map((ex, i) => (
                              <div key={i} className="py-2 space-y-0.5 text-xs">
                                <div className="text-slate-300 line-through decoration-slate-600">
                                  {ex.title}
                                </div>
                                <div className="text-amber-400/90">
                                  Reason: {ex.reason}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              )}

              {activeTab === 'directions' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-100">
                      Turn-by-Turn Route Corridor
                    </h3>
                    {routeDetails && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-300 font-mono-tabular">
                        <span>{routeDetails.durationText}</span>
                        <span aria-hidden="true">·</span>
                        <span>{routeDetails.distanceText}</span>
                      </div>
                    )}
                  </div>

                  {routeError && (
                    <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200">
                      {routeError}
                    </div>
                  )}

                  {!routeDetails ? (
                    <div className="py-8 text-center space-y-3 border border-dashed border-slate-800 rounded-2xl p-4">
                      <p className="text-xs text-slate-400">
                        Enable Turn-by-Turn Directions to compute the optimal
                        route from your origin or current Android GPS
                        coordinates.
                      </p>
                      <button
                        type="button"
                        onClick={onStartDirections}
                        className="min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-2 transition-colors"
                      >
                        <Navigation className="w-4 h-4" />
                        <span>Calculate Route Now</span>
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80">
                      {routeDetails.steps.map((step, idx) => (
                        <div
                          key={idx}
                          className="py-3 flex items-start justify-between gap-3"
                        >
                          <div className="flex items-baseline gap-3 min-w-0">
                            <span className="font-mono-tabular text-xs font-semibold text-emerald-400 shrink-0">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span
                              className="text-sm text-slate-200 leading-snug"
                              dangerouslySetInnerHTML={{
                                __html: step.instruction,
                              }}
                            />
                          </div>
                          <div className="text-right font-mono-tabular text-xs text-slate-400 shrink-0 whitespace-nowrap">
                            {step.distanceText}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'formula' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-semibold text-slate-100">
                      SafeRoute Scoring Methodology
                    </h3>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    Every 200m zone begins at a Base Score of{' '}
                    <span className="font-mono-tabular font-semibold text-white">
                      5.0
                    </span>
                    . Verified criminal incidents within the 200m perimeter are
                    weighted by severity, source credibility, and recency:
                  </p>

                  <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80 text-xs">
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-slate-300">
                        Violent / High Severity (Homicide, Shooting, Armed
                        Robbery)
                      </span>
                      <span className="font-mono-tabular text-rose-400 font-semibold shrink-0">
                        CSW 10–12
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-slate-300">
                        Property / Moderate (Burglary, Auto Theft, Assault)
                      </span>
                      <span className="font-mono-tabular text-amber-400 font-semibold shrink-0">
                        CSW 5–7
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-slate-300">
                        Minor Crimes (Petty Theft, Pickpocketing, Break-in)
                      </span>
                      <span className="font-mono-tabular text-sky-400 font-semibold shrink-0">
                        CSW 2–3
                      </span>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <span className="text-slate-300">
                        Nuisance / Low Risk (Loitering, Noise, Intoxication)
                      </span>
                      <span className="font-mono-tabular text-slate-400 font-semibold shrink-0">
                        CSW 1
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400">
                        Source Multipliers:
                      </span>{' '}
                      <span className="font-mono-tabular">
                        Local/National News = 1.0 · Social Media = 0.5
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">
                        Recency Multipliers:
                      </span>{' '}
                      <span className="font-mono-tabular">
                        &lt;7d = 1.0 · 8–30d = 0.7 · 31–90d = 0.4 · &gt;90d =
                        0.1
                      </span>
                    </div>
                    <div className="pt-2 font-mono-tabular text-emerald-300">
                      Final Score = Max(1.0, 5.0 − (Total Penalty / 5)) ={' '}
                      {score.toFixed(1)}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
