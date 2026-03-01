-- ══════════════════════════════════════════════════════════════════
--  ReachMate — Full Schema Migration
--  Run this ONCE in your new Supabase project → SQL Editor → New query
-- ══════════════════════════════════════════════════════════════════

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2) Contacts table (full funnel)
CREATE TABLE public.contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  full_name     TEXT NOT NULL DEFAULT '',
  username      TEXT DEFAULT '',
  profile_link  TEXT NOT NULL,
  followers     INTEGER DEFAULT 0,
  biography     TEXT DEFAULT '',
  category      TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'not_started'
                CHECK (status = ANY (ARRAY[
                  'not_started','followed','dmed','initiated',
                  'engaged','calendly_sent','booked','flywheel'
                ])),
  followed_at       TIMESTAMPTZ,
  dmed_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Funnel columns
  followed_back     BOOLEAN NOT NULL DEFAULT FALSE,
  followed_back_at  TIMESTAMPTZ,
  media_seen        BOOLEAN NOT NULL DEFAULT FALSE,
  media_seen_at     TIMESTAMPTZ,
  initiated_at      TIMESTAMPTZ,
  engaged_at        TIMESTAMPTZ,
  calendly_sent_at  TIMESTAMPTZ,
  booked_at         TIMESTAMPTZ,
  a2_notes          TEXT NOT NULL DEFAULT '',
  b_notes           TEXT NOT NULL DEFAULT '',
  requeue_after     DATE,
  -- Follow-up tracking
  current_follow_up TEXT DEFAULT NULL,
  last_follow_up_at TIMESTAMPTZ DEFAULT NULL,
  negative_reply    BOOLEAN NOT NULL DEFAULT FALSE,
  flywheel_reason   TEXT DEFAULT NULL
);

-- 3) Daily queues
CREATE TABLE public.daily_queues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  queue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  queue_type    TEXT NOT NULL CHECK (queue_type IN ('follow', 'dm')),
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Openers
CREATE TABLE public.openers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  opener_text   TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Follow-up notes
CREATE TABLE public.follow_up_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL,
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL CHECK (stage IN ('B', 'C')),
  note_number   INTEGER NOT NULL CHECK (note_number >= 1 AND note_number <= 8),
  note_text     TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (contact_id, stage, note_number)
);

-- ══════════════════════════════════════════════════════════════════
--  Indexes
-- ══════════════════════════════════════════════════════════════════
CREATE INDEX idx_contacts_user_status    ON public.contacts(user_id, status);
CREATE INDEX idx_contacts_profile_link   ON public.contacts(user_id, profile_link);
CREATE INDEX idx_daily_queues_user_date  ON public.daily_queues(user_id, queue_date, queue_type);
CREATE INDEX idx_daily_queues_contact    ON public.daily_queues(contact_id);
CREATE INDEX idx_openers_contact         ON public.openers(contact_id);

-- ══════════════════════════════════════════════════════════════════
--  Row Level Security
-- ══════════════════════════════════════════════════════════════════
ALTER TABLE public.contacts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_queues    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_notes ENABLE ROW LEVEL SECURITY;

-- Contacts policies
CREATE POLICY "Users can view own contacts"   ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- Daily queues policies
CREATE POLICY "Users can view own queues"   ON public.daily_queues FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own queues" ON public.daily_queues FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own queues" ON public.daily_queues FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own queues" ON public.daily_queues FOR DELETE USING (auth.uid() = user_id);

-- Openers policies
CREATE POLICY "Users can view own openers"   ON public.openers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own openers" ON public.openers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own openers" ON public.openers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own openers" ON public.openers FOR DELETE USING (auth.uid() = user_id);

-- Follow-up notes policies
CREATE POLICY "Users can view own follow_up_notes"   ON public.follow_up_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own follow_up_notes" ON public.follow_up_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own follow_up_notes" ON public.follow_up_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own follow_up_notes" ON public.follow_up_notes FOR DELETE USING (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════
--  Done! Now enable Email auth in Authentication → Providers
-- ══════════════════════════════════════════════════════════════════
