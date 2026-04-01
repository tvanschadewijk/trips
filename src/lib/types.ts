export interface TripData {
  trip: TripMeta;
  days: Day[];
}

export interface TripMeta {
  name: string;
  subtitle: string;
  dates: { start: string; end: string };
  travelers: string[];
  summary: string;
  hero_image: string;
  overview_image?: string;
  accent_color?: string;
  services?: Service[];
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
  hero_image?: string;
  stats?: Stat[];
  blocks: Block[];
  transport?: Transport[];
  accommodation?: Accommodation | null;
  meals?: Meal[];
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
}

export interface Transport {
  mode: string;
  label: string;
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  duration?: string;
  status?: string;
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
}

export interface Accommodation {
  name: string;
  price?: string;
  rating?: string;
  status?: string;
  nights?: number;
  note?: string;
  detail?: AccommodationDetail;
}

export interface AccommodationDetail {
  check_in?: string;
  check_out?: string;
  room_type?: string;
  address?: string;
  phone?: string;
  confirmation?: string;
  booking_platform?: string;
  cancellation_deadline?: string;
  wifi?: string;
  parking?: string;
  note?: string;
}

export interface Meal {
  type: string;
  name: string;
  note?: string;
  status?: string;
}

// Database types
export interface TripRecord {
  id: string;
  user_id: string;
  share_id: string;
  name: string;
  data: TripData;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}
