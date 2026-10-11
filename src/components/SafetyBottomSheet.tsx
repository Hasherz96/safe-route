import React, { useEffect, useState } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import type {
  SafetyAnalysisResponse,
  PlaceSelection,
  CrimeType,
  IncidentItem,
} from '../types/safety';
import { parseRecencyTextToDays } from '../safetyScoring';

const CRIME_CATEGORIES: CrimeType[] = ['Violent', 'Burglary', 'Theft', 'Nuisance'];

const CRIME_CATEGORY_STYLES: Record<
  CrimeType,
  { text: string; dot: string; bg: string; border: string }
> = {
  Violent: {
    text: 'text-rose-600',
    dot: 'bg-rose-400',
    bg: 'bg-rose-50',
    border: 'border-rose-300',
  },
  Burglary: {
    text: 'text-orange-600',
    dot: 'bg-orange-400',
    bg: 'bg-orange-50',
    border: 'border-orange-300',
  },
  Theft: {
    text: 'text-amber-600',
    dot: 'bg-amber-400',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
  },
  Nuisance: {
    text: 'text-sky-600',
    dot: 'bg-sky-400',
    bg: 'bg-sky-50',
    border: 'border-sky-300',
  },
};

const CRIME_CATEGORY_PLURALS: Record<CrimeType, string> = {
  Violent: 'violent crimes',
  Burglary: 'burglaries',
  Theft: 'thefts',
  Nuisance: 'nuisance reports',
};

// Feed headlines often end with " - Daily Mirror"; drop that publisher suffix
function stripSourceSuffix(headline: string, sourceName: string): string {
  if (!sourceName) return headline;
  const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return headline.replace(new RegExp(`\\s+[-–—|]\\s*${escaped}\\s*$`, 'i'), '');
}

// "A, B and C" style list for readable sentences
function formatList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

interface AllCrimesSummaryProps {
  incidents: IncidentItem[];
  onSelectCategory: (category: CrimeType) => void;
}

// Glanceable overview shown on the "All" tab instead of the article list
const AllCrimesSummary: React.FC<AllCrimesSummaryProps> = ({
  incidents,
  onSelectCategory,
}) => {
  if (incidents.length === 0) {
    return (
      <div className="py-6 px-4 flex flex-col items-center gap-2 text-center border border-dashed border-slate-200 rounded-xl">
        <ShieldCheck className="w-6 h-6 text-emerald-600" />
        <p className="text-sm font-medium text-slate-900">
          No crimes reported nearby
        </p>
        <p className="text-xs text-slate-500">
          We found no verified crime reports in the last 6 months.
        </p>
      </div>
    );
  }

  const total = incidents.length;
  const withDays = incidents.map((inc) => ({
    inc,
    days: parseRecencyTextToDays(inc.recency),
  }));

  const categories = CRIME_CATEGORIES.map((category) => {
    const items = withDays.filter(({ inc }) => inc.crime_type === category);
    const latest = items
      .filter((item) => item.days !== null)
      .sort((a, b) => (a.days as number) - (b.days as number))[0];
    return {
      category,
      count: items.length,
      latestText: latest?.inc.recency ?? items[0]?.inc.recency,
    };
  })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const top = categories[0];
  const headline =
    categories.length === 1
      ? `All ${CRIME_CATEGORY_PLURALS[top.category]}`
      : top.count / total >= 0.5
        ? `Mostly ${CRIME_CATEGORY_PLURALS[top.category]}`
        : `A mix of ${formatList(
            categories.map((c) => CRIME_CATEGORY_PLURALS[c.category])
          )}`;

  return (
    <div className="p-4 rounded-2xl border border-slate-200 space-y-4">
      {/* Plain-language takeaway */}
      <p className="text-base font-semibold text-slate-900">{headline}</p>

      {/* Category mix bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 gap-0.5">
        {categories.map((c) => (
          <div
            key={c.category}
            className={CRIME_CATEGORY_STYLES[c.category].dot}
            style={{ width: `${(c.count / total) * 100}%` }}
          />
        ))}
      </div>

      {/* Per-category rows (tap to see those articles) */}
      <div className="divide-y divide-slate-200/80">
        {categories.map((c) => {
          const style = CRIME_CATEGORY_STYLES[c.category];
          return (
            <button
              key={c.category}
              type="button"
              onClick={() => onSelectCategory(c.category)}
              className="w-full min-h-[48px] py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-slate-900">
                  {c.category}
                </span>
                {c.latestText && (
                  <span className="block text-xs text-slate-400">
                    Latest {c.latestText}
                  </span>
                )}
              </span>
              <span
                className={`font-mono-tabular text-lg font-semibold ${style.text}`}
              >
                {c.count}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

interface SafetyBottomSheetProps {
  expanded: boolean;
  onToggleExpand: (nextState?: boolean) => void;
  destination: PlaceSelection | null;
  /** A neighbourhood, town or larger area, which isn't scored. */
  destinationTooLarge: boolean;
  safetyData: SafetyAnalysisResponse | null;
  isAnalyzing: boolean;
}

function getScoreTheme(score: number) {
  if (score >= 4.0) {
    return {
      text: 'text-emerald-600',
      stroke: '#10b981',
      border: 'border-emerald-300',
      subtleBg: 'bg-emerald-50',
      badgeLabel: 'Safe Area',
    };
  }
  if (score >= 3.0) {
    return {
      text: 'text-amber-600',
      stroke: '#f59e0b',
      border: 'border-amber-300',
      subtleBg: 'bg-amber-50',
      badgeLabel: 'Moderate Risk',
    };
  }
  return {
    text: 'text-rose-600',
    stroke: '#f43f5e',
    border: 'border-rose-300',
    subtleBg: 'bg-rose-50',
    badgeLabel: 'High Risk',
  };
}

export const SafetyBottomSheet: React.FC<SafetyBottomSheetProps> = ({
  expanded,
  onToggleExpand,
  destination,
  destinationTooLarge,
  safetyData,
  isAnalyzing,
}) => {
  const [selectedCrimeFilter, setSelectedCrimeFilter] = useState<
    'ALL' | CrimeType
  >('ALL');
  const [touchStartY, setTouchStartY] = useState<number | null>(null);

  // New results always open on the "All" summary
  useEffect(() => {
    setSelectedCrimeFilter('ALL');
  }, [safetyData]);

  const score = safetyData?.safety_rating ?? 5.0;
  const theme = getScoreTheme(score);

  const incidents = safetyData?.incident_breakdown || [];
  const filteredIncidents =
    selectedCrimeFilter === 'ALL'
      ? incidents
      : incidents.filter((i) => i.crime_type === selectedCrimeFilter);

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

  // Neighbourhoods, towns and larger areas: ask for a specific place instead of a score
  if (destinationTooLarge && destination) {
    return (
      <div
        role="status"
        className="absolute left-0 right-0 bottom-0 z-30 bg-white/95 backdrop-blur-xl border-t border-slate-200 rounded-t-3xl shadow-2xl px-4 pt-4 pb-5"
      >
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl border border-sky-300 bg-sky-50 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-sky-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Please be more specific
            </h2>
            <p className="text-sm text-slate-500 mt-0.5 leading-snug">
              {destination.name} is too large an area to rate. Search for a
              street, landmark or address in {destination.name} to see how safe
              it is.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`absolute left-0 right-0 bottom-0 z-30 bg-white/95 backdrop-blur-xl border-t border-slate-200 rounded-t-3xl shadow-2xl transition-transform duration-200 ease-out flex flex-col ${
        expanded
          ? 'h-[80%] translate-y-0'
          : 'h-auto max-h-[195px] translate-y-0'
      }`}
    >
      {/* Drag Handle & Header Bar */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="px-4 pt-2 pb-3 border-b border-slate-200/80 shrink-0"
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
          <div className="w-10 h-1.5 bg-slate-200 rounded-full my-1.5" />
        </button>

        {isAnalyzing ? (
          <div className="flex items-center justify-between gap-3 py-1 animate-pulse">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-12 h-12 rounded-2xl bg-slate-200 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            </div>
            <div className="w-24 h-10 bg-slate-200 rounded-xl shrink-0" />
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
                <span className="text-[10px] text-slate-500 font-mono-tabular mt-0.5">
                  / 5.0
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-base font-semibold text-slate-900 truncate">
                    {safetyData?.location ||
                      destination?.name ||
                      'Select a Destination'}
                  </h2>
                </div>

                {/* Clean unboxed metadata with typographic separators */}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5 truncate">
                  <span className={`font-medium ${theme.text}`}>
                    {safetyData?.risk_level || theme.badgeLabel}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">
                    {incidents.length} verified{' '}
                    {incidents.length === 1 ? 'crime' : 'crimes'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onToggleExpand(!expanded)}
                aria-label={expanded ? 'Collapse sheet' : 'Expand sheet'}
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 flex items-center justify-center transition-colors"
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
              <div className="h-28 rounded-2xl bg-slate-200/70" />
              <div className="space-y-2">
                <div className="h-4 bg-slate-200/70 rounded w-1/3" />
                <div className="h-16 bg-slate-200/70 rounded-xl" />
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-slate-200/70 rounded w-2/5" />
                <div className="h-20 bg-slate-200/70 rounded-xl" />
                <div className="h-20 bg-slate-200/70 rounded-xl" />
              </div>
            </div>
          ) : (
            <>
                  {/* Incident Breakdown Section */}
                  <div
                    className={`space-y-3 ${
                      selectedCrimeFilter !== 'ALL' ? 'p-4 pt-2 rounded-2xl border border-slate-200' : ''
                    }`}
                  >
                    {selectedCrimeFilter !== 'ALL' && (
                      <button
                        type="button"
                        onClick={() => setSelectedCrimeFilter('ALL')}
                        className="min-h-[36px] -ml-1 pr-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span>All crimes</span>
                        <span aria-hidden="true">·</span>
                        <span className={CRIME_CATEGORY_STYLES[selectedCrimeFilter].text}>
                          {selectedCrimeFilter}
                        </span>
                      </button>
                    )}

                    {selectedCrimeFilter === 'ALL' ? (
                      <AllCrimesSummary
                        incidents={incidents}
                        onSelectCategory={setSelectedCrimeFilter}
                      />
                    ) : filteredIncidents.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                        No verified criminal offenses inside the 200m radius
                        match this category filter.
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-200/80">
                        {filteredIncidents.map((inc, index) => {
                          const zoneLabel = inc.matched_zone
                            ?.replace(/^Within 200\s?m\s*·\s*/i, '')
                            .trim();

                          return (
                            <div
                              key={`${inc.crime_type}-${index}`}
                              className="py-3.5 space-y-1"
                            >
                              {/* Unboxed quiet metadata kicker */}
                              <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                                <span
                                  className={`font-semibold ${
                                    CRIME_CATEGORY_STYLES[inc.crime_type]?.text ??
                                    'text-slate-700'
                                  }`}
                                >
                                  {inc.crime_type}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{inc.recency}</span>
                                {zoneLabel && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>
                                      {zoneLabel}
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* Headline / Description */}
                              <p className="text-sm font-medium text-slate-900 leading-snug">
                                {stripSourceSuffix(inc.description, inc.source_name)}
                              </p>

                              {/* Source Attribution Line */}
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <span>{inc.source_type}</span>
                                {inc.source_url && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <a
                                      href={inc.source_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 hover:underline"
                                    >
                                      <span>Source</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  </>
                                )}
                                {(inc.report_count ?? 1) > 1 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{inc.report_count} reports</span>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Pedestrian & Visitor Safety Recommendations */}
                  <div className="p-4 rounded-2xl border border-slate-200 space-y-2.5">
                    <h3 className="text-sm font-semibold text-slate-900">
                      Visitor Recommendations
                    </h3>
                    <div className="divide-y divide-slate-200/60">
                      {(safetyData?.safety_recommendations || []).map(
                        (rec, idx) => (
                          <div
                            key={idx}
                            className="py-2.5 flex items-baseline gap-3 text-sm text-slate-800"
                          >
                            <span className="font-mono-tabular text-xs font-semibold text-emerald-600 shrink-0">
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
        </div>
      )}
    </div>
  );
};
