-- Migration 003: Add UNIQUE constraint on (user_id, name) to prevent duplicate trips
--
-- Problem: When the trips skill re-syncs a trip without a trip_id, the API creates
-- a new row instead of updating the existing one, producing duplicates.

-- Step 1: Remove existing duplicates, keeping the most recently updated row per (user_id, name)
DELETE FROM public.trips
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id, name ORDER BY updated_at DESC) AS rn
    FROM public.trips
  ) ranked
  WHERE rn > 1
);

-- Step 2: Add unique constraint so future duplicates are impossible
ALTER TABLE public.trips
  ADD CONSTRAINT trips_user_id_name_unique UNIQUE (user_id, name);
