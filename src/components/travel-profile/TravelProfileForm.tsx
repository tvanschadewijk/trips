'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Accessibility,
  ArrowRight,
  BedDouble,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  Gauge,
  IdCard,
  Map,
  PawPrint,
  Plane,
  Trash2,
  UploadCloud,
  Utensils,
  X,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  buildTravelReferenceMarkdown,
  createBlankTravelerProfile,
  summarizeTravelerProfiles,
  type TravelerProfile,
  type TravelProfileSourceReference,
  type TravelProfilePreferences,
} from '@/lib/travel-profile';

type Props = {
  initialPreferences: TravelProfilePreferences;
  initialSources: TravelProfileSourceReference[];
  nextHref: string;
};

const lodgingOptions = ['Boutique hotels', 'Apartments', 'Design stays', 'Family rooms', 'Dog-friendly', 'Parking'];
const foodOptions = ['Local food', 'Reservations', 'Street food', 'Vegetarian', 'Fine dining', 'Markets'];
const interestOptions = ['Architecture', 'Nature', 'Museums', 'Beaches', 'Hiking', 'Shopping', 'Wine', 'History'];
const transportOptions = ['Train', 'Self-drive', 'Flights', 'Walkable bases', 'Public transit', 'Private transfers'];
const genderOptions: Array<{ value: TravelerProfile['gender']; label: string }> = [
  { value: '', label: 'Not specified' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'self_describe', label: 'Self describe' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const dateWeekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dateMonths = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type DateOrder = 'month-first' | 'day-first';

const usStateNames = [
  'alabama',
  'alaska',
  'arizona',
  'arkansas',
  'california',
  'colorado',
  'connecticut',
  'delaware',
  'florida',
  'georgia',
  'hawaii',
  'idaho',
  'illinois',
  'indiana',
  'iowa',
  'kansas',
  'kentucky',
  'louisiana',
  'maine',
  'maryland',
  'massachusetts',
  'michigan',
  'minnesota',
  'mississippi',
  'missouri',
  'montana',
  'nebraska',
  'nevada',
  'new hampshire',
  'new jersey',
  'new mexico',
  'new york',
  'north carolina',
  'north dakota',
  'ohio',
  'oklahoma',
  'oregon',
  'pennsylvania',
  'rhode island',
  'south carolina',
  'south dakota',
  'tennessee',
  'texas',
  'utah',
  'vermont',
  'virginia',
  'washington',
  'west virginia',
  'wisconsin',
  'wyoming',
];
const usStateCodes = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];
const usCityNames = [
  'atlanta',
  'austin',
  'boston',
  'charlotte',
  'chicago',
  'dallas',
  'denver',
  'houston',
  'las vegas',
  'los angeles',
  'miami',
  'minneapolis',
  'nashville',
  'new orleans',
  'new york',
  'orlando',
  'philadelphia',
  'phoenix',
  'portland',
  'san diego',
  'san francisco',
  'seattle',
  'tampa',
  'washington dc',
  'washington d.c.',
];

function safeNextHref(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/trips/new';
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function containsLocationWord(value: string, word: string): boolean {
  const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^a-z])${escapedWord}([^a-z]|$)`, 'iu').test(value);
}

function dateOrderForHomeBase(homeBase: string): DateOrder {
  const normalized = homeBase.trim().toLowerCase();
  if (!normalized) return 'day-first';

  if (/\b(u\.?s\.?a?|united states|america)\b/iu.test(normalized)) {
    return 'month-first';
  }

  if (usStateNames.some((state) => containsLocationWord(normalized, state))) {
    return 'month-first';
  }

  const stateCodePattern = new RegExp(`(^|[\\s,])(${usStateCodes.join('|')})([\\s,]|$)`, 'u');
  if (stateCodePattern.test(homeBase.toUpperCase())) {
    return 'month-first';
  }

  if (usCityNames.some((city) => containsLocationWord(normalized, city))) {
    return 'month-first';
  }

  return 'day-first';
}

function dateInputPlaceholder(dateOrder: DateOrder): string {
  return dateOrder === 'month-first' ? 'MM/DD/YYYY' : 'DD/MM/YYYY';
}

function formatDateForInput(value: string, dateOrder: DateOrder): string {
  if (!value) return '';

  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;

  return dateOrder === 'month-first'
    ? `${month}/${day}/${year}`
    : `${day}/${month}/${year}`;
}

function parseManualDate(value: string, dateOrder: DateOrder = 'day-first'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const yearFirst = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u);
  if (yearFirst) {
    return isoFromParts(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  const dayOrMonthFirst = trimmed.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})$/u);
  if (!dayOrMonthFirst) return null;

  const first = Number(dayOrMonthFirst[1]);
  const second = Number(dayOrMonthFirst[2]);
  const year = Number(dayOrMonthFirst[3]);
  const firstMustBeDay = first > 12 && second <= 12;
  const secondMustBeDay = second > 12 && first <= 12;
  const isMonthFirst = secondMustBeDay || dateOrder === 'month-first';
  const month = firstMustBeDay ? second : isMonthFirst ? first : second;
  const day = firstMustBeDay ? first : isMonthFirst ? second : first;

  return isoFromParts(year, month, day);
}

function dateFromIso(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthStartIso(value: string): string {
  const iso = parseManualDate(value);
  const fallback = iso || todayIso();
  return `${fallback.slice(0, 7)}-01`;
}

function addMonthsIso(value: string, months: number): string {
  const date = dateFromIso(value);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return formatIsoDate(date);
}

function compareIsoDates(a: string, b: string): number {
  return a.localeCompare(b);
}

function isWithinDateBounds(value: string, minDate?: string, maxDate?: string): boolean {
  if (minDate && compareIsoDates(value, minDate) < 0) return false;
  if (maxDate && compareIsoDates(value, maxDate) > 0) return false;
  return true;
}

function clampMonthToBounds(value: string, minDate?: string, maxDate?: string): string {
  const monthStart = monthStartIso(value);
  if (minDate && compareIsoDates(monthStart, monthStartIso(minDate)) < 0) {
    return monthStartIso(minDate);
  }
  if (maxDate && compareIsoDates(monthStart, monthStartIso(maxDate)) > 0) {
    return monthStartIso(maxDate);
  }
  return monthStart;
}

export default function TravelProfileForm({ initialPreferences, initialSources, nextHref }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preferences, setPreferences] = useState<TravelProfilePreferences>(initialPreferences);
  const [sources, setSources] = useState<TravelProfileSourceReference[]>(initialSources);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const referencePreview = useMemo(
    () => buildTravelReferenceMarkdown(preferences, sources),
    [preferences, sources]
  );

  function setField<K extends keyof TravelProfilePreferences>(
    key: K,
    value: TravelProfilePreferences[K]
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  function toggleList(key: 'lodging' | 'food' | 'interests' | 'transport', value: string) {
    setPreferences((current) => {
      const existing = current[key];
      return {
        ...current,
        [key]: existing.includes(value)
          ? existing.filter((item) => item !== value)
          : [...existing, value],
      };
    });
  }

  function setTravelerProfiles(travelerProfiles: TravelerProfile[]) {
    setPreferences((current) => ({
      ...current,
      traveler_profiles: travelerProfiles,
      travelers: summarizeTravelerProfiles(travelerProfiles),
    }));
  }

  function addTraveler() {
    setTravelerProfiles([...preferences.traveler_profiles, createBlankTravelerProfile()]);
  }

  function updateTraveler<K extends keyof TravelerProfile>(
    index: number,
    key: K,
    value: TravelerProfile[K]
  ) {
    const next = preferences.traveler_profiles.map((traveler, travelerIndex) => (
      travelerIndex === index ? { ...traveler, [key]: value } : traveler
    ));
    setTravelerProfiles(next);
  }

  function removeTraveler(index: number) {
    setTravelerProfiles(preferences.traveler_profiles.filter((_, travelerIndex) => travelerIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/travel-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences, complete: true }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(safeNextHref(nextHref));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save travel profile');
    } finally {
      setSaving(false);
    }
  }

  async function uploadPreviousTrip() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadMessage('Choose a file first.');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadMessage(null);

    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/travel-profile/sources', {
        method: 'POST',
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      setSources(body.sources ?? []);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadMessage(body.source?.status === 'ready' ? 'Reference updated.' : 'Stored for extraction.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload previous trip');
    } finally {
      setUploading(false);
    }
  }

  async function deleteSource(sourceId: string) {
    setDeletingSourceId(sourceId);
    setError(null);
    setUploadMessage(null);

    try {
      const res = await fetch(`/api/travel-profile/sources/${sourceId}`, {
        method: 'DELETE',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSources(body.sources ?? []);
      setUploadMessage('Reference updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove previous trip');
    } finally {
      setDeletingSourceId(null);
    }
  }

  const dateOrder = dateOrderForHomeBase(preferences.home_base);

  return (
    <form className="profile-form" onSubmit={submit}>
      <section className="profile-panel profile-panel-main">
        <div className="profile-section-heading">
          <Map size={18} aria-hidden="true" />
          <div>
            <h2>Travel profile</h2>
            <p>Preferences the trip creator should remember.</p>
          </div>
        </div>

        <TravelerProfilesEditor
          profiles={preferences.traveler_profiles}
          onAdd={addTraveler}
          onChange={updateTraveler}
          onRemove={removeTraveler}
          dateOrder={dateOrder}
        />

        <div className="profile-grid-two">
          <label className="profile-field">
            <span>Home base</span>
            <input
              value={preferences.home_base}
              onChange={(event) => setField('home_base', event.target.value)}
              placeholder="Amsterdam"
            />
          </label>
          <label className="profile-field">
            <span>Preferred airports or stations</span>
            <input
              value={preferences.preferred_airports}
              onChange={(event) => setField('preferred_airports', event.target.value)}
              placeholder="AMS, Rotterdam Centraal"
            />
          </label>
        </div>

        <div className="profile-grid-two">
          <label className="profile-field">
            <span><Gauge size={14} aria-hidden="true" /> Pace</span>
            <select
              value={preferences.pace}
              onChange={(event) => setField('pace', event.target.value as TravelProfilePreferences['pace'])}
            >
              <option value="relaxed">Relaxed</option>
              <option value="balanced">Balanced</option>
              <option value="full">Full</option>
              <option value="varies">Varies by day</option>
            </select>
          </label>
          <label className="profile-field">
            <span>Budget posture</span>
            <select
              value={preferences.budget}
              onChange={(event) => setField('budget', event.target.value as TravelProfilePreferences['budget'])}
            >
              <option value="value">Value</option>
              <option value="mid_range">Mid range</option>
              <option value="upscale">Upscale</option>
              <option value="luxury">Luxury</option>
              <option value="varies">Varies</option>
            </select>
          </label>
        </div>

        <PreferenceGroup
          icon={<BedDouble size={16} aria-hidden="true" />}
          title="Lodging"
          options={lodgingOptions}
          selected={preferences.lodging}
          onToggle={(value) => toggleList('lodging', value)}
        />
        <PreferenceGroup
          icon={<Utensils size={16} aria-hidden="true" />}
          title="Food"
          options={foodOptions}
          selected={preferences.food}
          onToggle={(value) => toggleList('food', value)}
        />
        <PreferenceGroup
          icon={<Map size={16} aria-hidden="true" />}
          title="Interests"
          options={interestOptions}
          selected={preferences.interests}
          onToggle={(value) => toggleList('interests', value)}
        />
        <PreferenceGroup
          icon={<Plane size={16} aria-hidden="true" />}
          title="Transport"
          options={transportOptions}
          selected={preferences.transport}
          onToggle={(value) => toggleList('transport', value)}
        />

        <div className="profile-grid-two">
          <label className="profile-field">
            <span><Accessibility size={14} aria-hidden="true" /> Accessibility or mobility</span>
            <textarea
              value={preferences.accessibility}
              onChange={(event) => setField('accessibility', event.target.value)}
              rows={3}
            />
          </label>
          <label className="profile-field">
            <span><PawPrint size={14} aria-hidden="true" /> Pets</span>
            <textarea
              value={preferences.pets}
              onChange={(event) => setField('pets', event.target.value)}
              rows={3}
            />
          </label>
        </div>

        <label className="profile-field">
          <span>Avoid</span>
          <textarea
            value={preferences.avoid}
            onChange={(event) => setField('avoid', event.target.value)}
            rows={3}
            placeholder="Early starts, long driving days, crowded viewpoints"
          />
        </label>

        <label className="profile-field">
          <span>Other notes</span>
          <textarea
            value={preferences.notes}
            onChange={(event) => setField('notes', event.target.value)}
            rows={4}
          />
        </label>

        {error && <p className="profile-error">{error}</p>}

        <div className="profile-actions">
          <button className="profile-primary" type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save profile'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>

      <aside className="profile-panel profile-reference">
        <div className="profile-section-heading">
          <Map size={18} aria-hidden="true" />
          <div>
            <h2>Reference</h2>
            <p>Loaded into new trip requests.</p>
          </div>
        </div>

        <div className="profile-upload">
          <label className="profile-upload-label" htmlFor="previous-trip-upload">
            <UploadCloud size={16} aria-hidden="true" />
            Previous trips
          </label>
          <input
            id="previous-trip-upload"
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.json,application/json,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          />
          <button
            className="profile-upload-button"
            type="button"
            disabled={uploading}
            onClick={uploadPreviousTrip}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
          {uploadMessage && <p className="profile-upload-message">{uploadMessage}</p>}
          {sources.length > 0 && (
            <div className="profile-source-list">
              {sources.map((source) => (
                <div className="profile-source-row" key={source.id ?? source.file_name ?? 'source'}>
                  <FileText size={15} aria-hidden="true" />
                  <span>{source.file_name || 'Previous trip'}</span>
                  <em>{source.status}</em>
                  {source.id && (
                    <button
                      type="button"
                      aria-label={`Remove ${source.file_name || 'previous trip'}`}
                      disabled={deletingSourceId === source.id}
                      onClick={() => deleteSource(source.id as string)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <pre>{referencePreview}</pre>
      </aside>
    </form>
  );
}

function TravelerProfilesEditor({
  profiles,
  onAdd,
  onChange,
  onRemove,
  dateOrder,
}: {
  profiles: TravelerProfile[];
  onAdd: () => void;
  onChange: <K extends keyof TravelerProfile>(index: number, key: K, value: TravelerProfile[K]) => void;
  onRemove: (index: number) => void;
  dateOrder: DateOrder;
}) {
  return (
    <section className="profile-travelers">
      <div className="profile-travelers-heading">
        <div>
          <span><Users size={15} aria-hidden="true" /> Travelers</span>
          <p>Booking details kept with your profile.</p>
        </div>
        <button type="button" onClick={onAdd}>
          <UserPlus size={15} aria-hidden="true" />
          Add traveler
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="profile-empty-travelers">
          <Users size={17} aria-hidden="true" />
          <span>No travelers added yet.</span>
        </div>
      ) : (
        <div className="profile-traveler-list">
          {profiles.map((profile, index) => (
            <article className="profile-traveler-card" key={profile.id || index}>
              <div className="profile-traveler-card-header">
                <strong>{profile.full_name.trim() || `Traveler ${index + 1}`}</strong>
                <button
                  type="button"
                  aria-label={`Remove ${profile.full_name || `traveler ${index + 1}`}`}
                  onClick={() => onRemove(index)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>

              <div className="profile-grid-two">
                <label className="profile-field">
                  <span>Full name</span>
                  <input
                    value={profile.full_name}
                    onChange={(event) => onChange(index, 'full_name', event.target.value)}
                    placeholder="Alex Morgan"
                    autoComplete="name"
                  />
                </label>
                <div className="profile-field">
                  <span><CalendarDays size={14} aria-hidden="true" /> Date of birth</span>
                  <ProfileDateInput
                    value={profile.date_of_birth}
                    onChange={(value) => onChange(index, 'date_of_birth', value)}
                    autoComplete="bday"
                    ariaLabel={`${profile.full_name || `Traveler ${index + 1}`} date of birth`}
                    defaultDisplayDate="1990-01-01"
                    dateOrder={dateOrder}
                    minDate="1900-01-01"
                    maxDate={todayIso()}
                  />
                </div>
              </div>

              <div className="profile-grid-two">
                <label className="profile-field">
                  <span>Gender</span>
                  <select
                    value={profile.gender}
                    onChange={(event) => onChange(index, 'gender', event.target.value as TravelerProfile['gender'])}
                  >
                    {genderOptions.map((option) => (
                      <option key={option.value || 'blank'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="profile-field">
                  <span>Self-described gender</span>
                  <input
                    value={profile.gender_self_description}
                    onChange={(event) => onChange(index, 'gender_self_description', event.target.value)}
                    disabled={profile.gender !== 'self_describe'}
                  />
                </label>
              </div>

              <div className="profile-grid-two">
                <label className="profile-field">
                  <span><IdCard size={14} aria-hidden="true" /> Passport number</span>
                  <input
                    value={profile.passport_number}
                    onChange={(event) => onChange(index, 'passport_number', event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label className="profile-field">
                  <span>Passport country</span>
                  <input
                    value={profile.passport_country}
                    onChange={(event) => onChange(index, 'passport_country', event.target.value)}
                    placeholder="Netherlands"
                    autoComplete="country-name"
                  />
                </label>
              </div>

              <div className="profile-grid-two">
                <div className="profile-field">
                  <span><CalendarDays size={14} aria-hidden="true" /> Passport expiry</span>
                  <ProfileDateInput
                    value={profile.passport_expiry}
                    onChange={(value) => onChange(index, 'passport_expiry', value)}
                    autoComplete="off"
                    ariaLabel={`${profile.full_name || `Traveler ${index + 1}`} passport expiry`}
                    defaultDisplayDate={todayIso()}
                    dateOrder={dateOrder}
                  />
                </div>
                <label className="profile-field">
                  <span>Traveler notes</span>
                  <input
                    value={profile.notes}
                    onChange={(event) => onChange(index, 'notes', event.target.value)}
                    placeholder="Seat, meal, mobility, visa notes"
                  />
                </label>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ProfileDateInput({
  value,
  onChange,
  ariaLabel,
  autoComplete,
  defaultDisplayDate,
  dateOrder,
  minDate,
  maxDate,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  autoComplete?: string;
  defaultDisplayDate: string;
  dateOrder: DateOrder;
  minDate?: string;
  maxDate?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(formatDateForInput(value, dateOrder));
  const [invalid, setInvalid] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(
    clampMonthToBounds(value || defaultDisplayDate, minDate, maxDate)
  );

  useEffect(() => {
    setInputValue(formatDateForInput(value, dateOrder));
    setInvalid(false);
    if (value) {
      setDisplayMonth(clampMonthToBounds(value, minDate, maxDate));
    }
  }, [dateOrder, defaultDisplayDate, maxDate, minDate, value]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const monthDate = dateFromIso(displayMonth);
  const selectedMonth = monthDate.getUTCMonth();
  const selectedYear = monthDate.getUTCFullYear();
  const today = todayIso();

  const yearOptions = useMemo(() => {
    const currentYear = dateFromIso(todayIso()).getUTCFullYear();
    const minYear = minDate ? dateFromIso(minDate).getUTCFullYear() : Math.min(selectedYear, currentYear - 20);
    const maxYear = maxDate ? dateFromIso(maxDate).getUTCFullYear() : Math.max(selectedYear, currentYear + 20);

    return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
  }, [maxDate, minDate, selectedYear]);

  const cells = useMemo(() => {
    const firstDay = new Date(Date.UTC(selectedYear, selectedMonth, 1, 12, 0, 0));
    const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
    const gridStart = new Date(firstDay);
    gridStart.setUTCDate(firstDay.getUTCDate() - mondayOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setUTCDate(gridStart.getUTCDate() + index);
      const iso = formatIsoDate(date);

      return {
        iso,
        day: date.getUTCDate(),
        disabled: !isWithinDateBounds(iso, minDate, maxDate),
        isCurrentMonth: date.getUTCMonth() === selectedMonth,
        isSelected: iso === value,
        isToday: iso === today,
      };
    });
  }, [maxDate, minDate, selectedMonth, selectedYear, today, value]);

  function commitInput(rawValue: string): boolean {
    const parsed = parseManualDate(rawValue, dateOrder);
    if (parsed === '') {
      setInputValue('');
      setInvalid(false);
      onChange('');
      return true;
    }

    if (parsed && isWithinDateBounds(parsed, minDate, maxDate)) {
      setInputValue(formatDateForInput(parsed, dateOrder));
      setInvalid(false);
      setDisplayMonth(clampMonthToBounds(parsed, minDate, maxDate));
      onChange(parsed);
      return true;
    }

    setInvalid(true);
    return false;
  }

  function updateCalendarMonth(nextMonth: number, nextYear: number) {
    const next = isoFromParts(nextYear, nextMonth + 1, 1);
    if (next) {
      setDisplayMonth(clampMonthToBounds(next, minDate, maxDate));
    }
  }

  function selectDate(iso: string, disabled: boolean) {
    if (disabled) return;
    setInputValue(formatDateForInput(iso, dateOrder));
    setInvalid(false);
    setDisplayMonth(clampMonthToBounds(iso, minDate, maxDate));
    onChange(iso);
    setOpen(false);
  }

  return (
    <div
      ref={containerRef}
      className={[
        'profile-date-input',
        open ? 'is-open' : '',
        invalid ? 'is-invalid' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="profile-date-input-row">
        <input
          type="text"
          inputMode="numeric"
          value={inputValue}
          placeholder={dateInputPlaceholder(dateOrder)}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          autoComplete={autoComplete}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const nextValue = event.target.value;
            setInputValue(nextValue);
            setInvalid(false);

            const trimmed = nextValue.trim();
            const parsed = parseManualDate(nextValue, dateOrder);
            if (parsed === '') {
              onChange('');
              return;
            }
            if (trimmed.length >= 10 && parsed && isWithinDateBounds(parsed, minDate, maxDate)) {
              onChange(parsed);
              setDisplayMonth(clampMonthToBounds(parsed, minDate, maxDate));
            }
          }}
          onBlur={(event) => commitInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (commitInput(event.currentTarget.value)) {
                setOpen(false);
              }
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        {value && (
          <button
            className="profile-date-clear"
            type="button"
            aria-label={`Clear ${ariaLabel}`}
            onClick={() => {
              setInputValue('');
              setInvalid(false);
              onChange('');
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        <button
          className="profile-date-toggle"
          type="button"
          aria-label={`Open ${ariaLabel} calendar`}
          aria-expanded={open}
          onClick={() => {
            setDisplayMonth(clampMonthToBounds(value || defaultDisplayDate, minDate, maxDate));
            setOpen((current) => !current);
          }}
        >
          <CalendarDays size={16} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div className="profile-date-popover">
          <div className="profile-date-popover-header">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setDisplayMonth((current) => clampMonthToBounds(addMonthsIso(current, -1), minDate, maxDate))}
              disabled={minDate ? compareIsoDates(addMonthsIso(displayMonth, -1), monthStartIso(minDate)) < 0 : false}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{dateMonths[selectedMonth]} {selectedYear}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setDisplayMonth((current) => clampMonthToBounds(addMonthsIso(current, 1), minDate, maxDate))}
              disabled={maxDate ? compareIsoDates(addMonthsIso(displayMonth, 1), monthStartIso(maxDate)) > 0 : false}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="profile-date-month-controls">
            <select
              aria-label="Month"
              value={selectedMonth}
              onChange={(event) => updateCalendarMonth(Number(event.target.value), selectedYear)}
            >
              {dateMonths.map((month, index) => (
                <option key={month} value={index}>{month}</option>
              ))}
            </select>
            <select
              aria-label="Year"
              value={selectedYear}
              onChange={(event) => updateCalendarMonth(selectedMonth, Number(event.target.value))}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div className="profile-date-weekdays">
            {dateWeekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="profile-date-grid">
            {cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                disabled={cell.disabled}
                className={[
                  cell.isCurrentMonth ? '' : 'is-muted',
                  cell.isSelected ? 'is-selected' : '',
                  cell.isToday ? 'is-today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => selectDate(cell.iso, cell.disabled)}
              >
                {cell.day}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PreferenceGroup({
  icon,
  title,
  options,
  selected,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="profile-options">
      <legend>{icon}{title}</legend>
      <div className="profile-option-grid">
        {options.map((option) => (
          <label key={option} className="profile-check">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => onToggle(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
