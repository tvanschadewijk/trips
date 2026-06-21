'use client';

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Accessibility,
  ArrowRight,
  BedDouble,
  CalendarDays,
  FileText,
  Gauge,
  IdCard,
  Map,
  PawPrint,
  Plane,
  Trash2,
  UploadCloud,
  Utensils,
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

function safeNextHref(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/trips/new';
  return value;
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
}: {
  profiles: TravelerProfile[];
  onAdd: () => void;
  onChange: <K extends keyof TravelerProfile>(index: number, key: K, value: TravelerProfile[K]) => void;
  onRemove: (index: number) => void;
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
                <label className="profile-field">
                  <span><CalendarDays size={14} aria-hidden="true" /> Date of birth</span>
                  <input
                    type="date"
                    value={profile.date_of_birth}
                    onChange={(event) => onChange(index, 'date_of_birth', event.target.value)}
                    autoComplete="bday"
                  />
                </label>
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
                <label className="profile-field">
                  <span><CalendarDays size={14} aria-hidden="true" /> Passport expiry</span>
                  <input
                    type="date"
                    value={profile.passport_expiry}
                    onChange={(event) => onChange(index, 'passport_expiry', event.target.value)}
                  />
                </label>
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
