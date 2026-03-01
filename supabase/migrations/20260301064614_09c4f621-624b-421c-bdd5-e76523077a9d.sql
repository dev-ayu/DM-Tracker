
-- Add new columns to contacts table for the full funnel
ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS followed_back BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS followed_back_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS media_seen BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS media_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engaged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calendly_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS a2_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS b_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requeue_after DATE;

-- Create follow_up_notes table
CREATE TABLE IF NOT EXISTS public.follow_up_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('B', 'C')),
  note_number INTEGER NOT NULL CHECK (note_number >= 1 AND note_number <= 8),
  note_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contact_id, stage, note_number)
);

-- Enable RLS on follow_up_notes
ALTER TABLE public.follow_up_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own follow_up_notes"
  ON public.follow_up_notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own follow_up_notes"
  ON public.follow_up_notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own follow_up_notes"
  ON public.follow_up_notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own follow_up_notes"
  ON public.follow_up_notes FOR DELETE
  USING (auth.uid() = user_id);
