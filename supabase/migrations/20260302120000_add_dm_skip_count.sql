-- Add dm_skip_count to contacts for tracking skipped private/restricted accounts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS dm_skip_count INTEGER NOT NULL DEFAULT 0;
