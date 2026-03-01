
-- Add new columns to contacts table for pipeline rebuild
ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS current_follow_up text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_follow_up_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS initiated_at timestamp with time zone DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS negative_reply boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flywheel_reason text DEFAULT NULL;

-- Migrate existing not_interested status to flywheel
UPDATE public.contacts SET status = 'flywheel' WHERE status = 'not_interested';
