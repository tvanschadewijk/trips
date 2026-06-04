export interface TripData {
  trip_schema_version?: number;
  trip: TripMeta;
  days: Day[];
  /**
   * Optional original markdown source the trip was built from. Stored
   * verbatim so the user can see content that didn't fit the structured
   * schema (long-form notes, tables, references). Source-of-truth when
   * present.
   */
  markdown_source?: string;
}

export interface TripMeta {
  name: string;
  subtitle: string;
  dates: { start: string; end: string };
  travelers: string[];
  summary: string;
  hero_image: string;
  overview_image?: string;
  image_assets?: TripImageAssets;
  route_points?: TripRoutePoint[];
  accent_color?: string;
  services?: Service[];
  notes?: TripNote[];
}

export type TripImageAssetSlot = 'cover_portrait' | 'cover_landscape' | 'social_og';

export interface TripImageAsset {
  url?: string;
  prompt?: string;
  aspect_ratio?: string;
  width?: number;
  height?: number;
  provider?: string;
  model?: string;
  source?: 'imagegen' | 'manual' | 'search';
  generated_at?: string;
}

export type TripImageAssets = Partial<Record<TripImageAssetSlot, TripImageAsset>>;

export type TripRoutePointRole =
  | 'home'
  | 'stop'
  | 'stay'
  | 'excursion'
  | 'trail'
  | 'return';

export interface TripRoutePoint {
  label: string;
  lat: number;
  lng: number;
  day?: number;
  mode?: string;
  role?: TripRoutePointRole;
}

export interface TripNote {
  title: string;
  icon?: string;
  content: string;
}

export interface Service {
  type: string;
  label: string;
  icon: string;
  provider: string;
  ref?: string;
  price?: string;
  status?: string;
  legs?: ServiceLeg[];
}

export interface ServiceLeg {
  date: string;
  route: string;
}

export interface Day {
  day_number: number;
  date: string;
  title: string;
  subtitle?: string;
  description_title?: string;
  description?: string;
  day_type?: 'arrival' | 'departure' | 'travel' | 'full' | 'rest' | string;
  pace?: 'light' | 'balanced' | 'full' | string;
  hero_image?: string;
  stats?: Stat[];
  blocks?: Block[];
  transport?: Transport[];
  accommodation?: Accommodation | null;
  meals?: Meal[];
  tips?: Tip[];
  alternatives?: ItineraryAlternative[];
}

export interface Tip {
  icon: string;
  title: string;
  content: string;
  priority?: 'high' | 'normal';
}

export interface Stat {
  icon: string;
  label: string;
  value: string;
}

export interface Block {
  time_label: string;
  content: string;
  type: string;
  starts_at?: string;
  ends_at?: string;
  time_precision?: TimePrecision;
  duration_minutes?: number;
  place?: ItineraryPlace;
  booking_status?: BookingStatus;
  reservation_required?: boolean;
  cost_hint?: string;
  pace?: 'light' | 'balanced' | 'full' | string;
  detail?: RichDetail;
  options?: Option[];
  alternatives?: ItineraryAlternative[];
}

export interface RichDetail {
  title?: string;
  body?: string;
  why?: string;
  vibe?: string;
  highlights?: string[];
  what_to_see?: string[];
  how_to_do_it?: string;
  practical?: string;
  booking_note?: string;
  what_to_order?: string;
  dog_note?: string;
  wallet_items?: TravelWalletItem[];
}

export type TimePrecision = 'fixed' | 'suggested' | 'window';

export type BookingStatus =
  | 'booked'
  | 'confirmed'
  | 'open'
  | 'pending'
  | 'optional'
  | 'not_required'
  | string;

export interface ItineraryPlace {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  google_maps_url?: string;
  place_id?: string;
  note?: string;
}

export interface ItineraryAlternative {
  label: string;
  description: string;
  trigger?: 'rainy' | 'tired' | 'kid_friendly' | 'cheaper' | 'lighter' | 'free_time' | string;
  duration?: string;
  cost_hint?: string;
}

export interface TravelWalletItem {
  title: string;
  type?: 'confirmation' | 'ticket' | 'voucher' | 'qr' | 'pdf' | 'note' | string;
  url?: string;
  file_url?: string;
  qr_code_url?: string;
  confirmation?: string;
  note?: string;
  is_private?: boolean;
}

export interface Option {
  label: string;
  description?: string;
  duration?: string;
  note?: string;
}

export interface Transport {
  mode: string;
  label: string;
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  duration?: string;
  distance?: string;
  status?: string;
  booking_status?: BookingStatus;
  reservation_required?: boolean;
  cost_hint?: string;
  detail?: TransportDetail;
}

export interface TransportDetail {
  class?: string;
  cabin?: string;
  seats?: string;
  seat?: string;
  booking_ref?: string;
  booking_platform?: string;
  cabin_bag?: string;
  hold_bag?: string;
  check_in?: string;
  platform?: string;
  flight?: string;
  terminal?: string;
  gate?: string;
  amenities?: string;
  cancellation_policy?: string;
  note?: string;
  route?: string;
  charging_stops?: ChargingStop[];
  border?: BorderCrossing;
  wallet_items?: TravelWalletItem[];
}

export interface ChargingStop {
  name: string;
  location?: string;
  network?: string;
  kw?: string;
  note?: string;
}

export interface BorderCrossing {
  name: string;
  note?: string;
  documents?: string;
}

export interface Accommodation {
  name: string;
  price?: string;
  rating?: string;
  status?: string;
  booking_status?: BookingStatus;
  reservation_required?: boolean;
  cost_hint?: string;
  nights?: number;
  note?: string;
  detail?: AccommodationDetail;
}

export interface AccommodationDetail extends RichDetail {
  check_in?: string;
  check_out?: string;
  room_type?: string;
  address?: string;
  phone?: string;
  direct_website_url?: string;
  direct_website_label?: string;
  confirmation?: string;
  booking_platform?: string;
  cancellation_deadline?: string;
  wifi?: string;
  parking?: string;
  policy_source_url?: string;
  policy_source_label?: string;
  policy_confidence?: 'high' | 'medium' | 'low';
  note?: string;
  wallet_items?: TravelWalletItem[];
}

export interface Meal {
  type: string;
  name: string;
  note?: string;
  status?: string;
  starts_at?: string;
  ends_at?: string;
  time_precision?: TimePrecision;
  booking_status?: BookingStatus;
  reservation_required?: boolean;
  cost_hint?: string;
  place?: ItineraryPlace;
  detail?: MealDetail;
}

export interface MealDetail extends RichDetail {
  address?: string;
  phone?: string;
  cuisine?: string;
  price_range?: string;
  reservation?: string;
  booking_platform?: string;
  hours?: string;
  note?: string;
  wallet_items?: TravelWalletItem[];
}

// Database types
export interface TripRecord {
  id: string;
  user_id: string;
  share_id: string;
  name: string;
  data: TripData;
  share_mode: 'private' | 'companion' | 'remix';
  created_at: string;
  updated_at: string;
}

export type AccommodationReviewLane =
  | 'proposed'
  | 'considering'
  | 'dismissed'
  | 'booked';

export interface AccommodationReview {
  tripTitle: string;
  tripSlug: string;
  generatedAt: string;
  updatedAt?: string;
  storageKey: string;
  summary?: string;
  destinations: AccommodationReviewDestination[];
  accommodations: AccommodationCandidate[];
  events?: AccommodationReviewEvent[];
  reviewerVersion?: number;
  layoutVersion?: 'kanban-v1';
}

export interface AccommodationReviewDestination {
  id: string;
  title: string;
  dates?: string;
  nights?: number;
  dayNumbers?: number[];
  startDate?: string;
  endDate?: string;
}

export interface AccommodationCandidate {
  id: string;
  destinationId: string;
  stop: string;
  dates?: string;
  nights?: number;
  lane: AccommodationReviewLane;
  status?: string;
  candidate: string;
  price?: string;
  dog?: string;
  parking?: string;
  terms?: string;
  why?: string;
  blockers?: string;
  action?: string;
  alternatives?: string;
  directWebsite?: AccommodationCandidateLink;
  links?: AccommodationCandidateLink[];
  ratings?: AccommodationCandidateRating[];
  rateCheck?: AccommodationCandidateRateCheck;
  feedbackLoop?: AccommodationCandidateFeedbackLoop;
  dayNumbers?: number[];
  checkInDate?: string;
  checkOutDate?: string;
  address?: string;
  roomType?: string;
  checkIn?: string;
  checkOut?: string;
  phone?: string;
  wifi?: string;
  policySource?: AccommodationCandidateLink;
  policyConfidence?: AccommodationDetail['policy_confidence'];
  hotelNote?: string;
  booking?: AccommodationCandidateBooking;
  createdBy?: 'agent' | 'user' | 'import' | 'system';
  updatedAt?: string;
}

export interface AccommodationCandidateLink {
  label: string;
  url: string;
}

export interface AccommodationCandidateRating {
  name?: string;
  checkedAt?: string;
  hotelsCom?: string;
  tripadvisor?: string;
  bookingCom?: string;
  google?: string;
  note?: string;
}

export interface AccommodationCandidateRateCheck {
  status?: string;
  checkedAt?: string;
  direct?: string;
  ota?: string;
  best?: string;
  note?: string;
  sources?: AccommodationCandidateLink[];
}

export interface AccommodationCandidateFeedbackLoop {
  userFeedback?: string;
  codexResponse?: string;
  nextStep?: string;
  updatedAt?: string;
}

export interface AccommodationCandidateBooking {
  bookedAt?: string;
  source?: string;
  confirmation?: string;
  price?: string;
  note?: string;
}

export interface AccommodationReviewEvent {
  id: string;
  type:
    | 'candidate_created'
    | 'candidate_moved'
    | 'candidate_updated'
    | 'candidate_booked'
    | 'candidate_promoted';
  candidateId?: string;
  destinationId?: string;
  actor: 'agent' | 'user' | 'system';
  fromLane?: AccommodationReviewLane;
  toLane?: AccommodationReviewLane;
  message?: string;
  createdAt: string;
}
