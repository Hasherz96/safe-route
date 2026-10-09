export type RiskLevel = 'Safe' | 'Moderate Risk' | 'High Risk';

export type CrimeType = 'Theft' | 'Burglary' | 'Violent' | 'Nuisance';

export type SourceType = 'Local News' | 'Social Media';

export type SeverityImpact = 'High' | 'Medium' | 'Low';

export interface IncidentItem {
  crime_type: CrimeType;
  description: string;
  source_type: SourceType;
  source_name: string;
  recency: string;
  severity_impact: SeverityImpact;
  calculated_penalty: number;
  csw_weight?: number;
  source_multiplier?: number;
  recency_multiplier?: number;
  source_url?: string;
  matched_zone?: string;
  /** How many news reports describe this same incident (set when duplicates are merged). */
  report_count?: number;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface NearbyPlaceItem {
  name: string;
  address: string;
  distanceMeters: number;
  primaryType?: string;
  location: Coordinates;
}

export interface NearbyAreaContext {
  radiusMeters: number;
  surroundingStreets: string[];
  nearbyPlaces: NearbyPlaceItem[];
}

export interface RejectedArticleAudit {
  title: string;
  reason: string;
}

export interface PreprocessingAudit {
  raw_candidates_scanned: number;
  rejected_non_crime_count: number;
  rejected_outside_radius_count: number;
  rejected_too_old_count?: number;
  verified_crime_count: number;
  rejected_examples: RejectedArticleAudit[];
  scanned_streets_200m: string[];
  scanned_places_200m: string[];
}

export interface SafetyAnalysisResponse {
  location: string;
  safety_rating: number;
  risk_level: RiskLevel;
  summary: string;
  incident_breakdown: IncidentItem[];
  safety_recommendations: string[];
  total_penalty?: number;
  grounding_sources?: GroundingSource[];
  missing_news_notice?: string;
  preprocessing_audit?: PreprocessingAudit;
  analyzed_at?: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface PlaceSelection {
  name: string;
  address: string;
  location: Coordinates;
  placeId?: string;
}
