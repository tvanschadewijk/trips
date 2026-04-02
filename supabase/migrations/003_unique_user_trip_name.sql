-- Migration 003: Deduplication safeguards
--
-- Problem: When the trips skill re-syncs a trip without a trip_id, the API creates
-- a new row instead of updating the existing one, producing duplicates.
--
-- Solution: Code-level upsert matches on (user_id, name, start_date).
-- No UNIQUE constraint on (user_id, name) because the same user may legitimately
-- have multiple trips with the same name but different dates (e.g. "Scotland" twice).
--
-- This migration only cleans up existing duplicates from the India re-sync issue.

-- Remove existing exact duplicates (same user_id + name), keeping the most recently updated
DELETE FROM public.trips
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id, name ORDER BY updated_at DESC) AS rn
    FROM public.trips
  ) ranked
  WHERE rn > 1
);
