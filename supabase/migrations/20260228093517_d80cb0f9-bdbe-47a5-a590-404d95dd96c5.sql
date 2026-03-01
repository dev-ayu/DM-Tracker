
-- Contacts table
CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  username TEXT DEFAULT '',
  profile_link TEXT NOT NULL,
  followers INTEGER DEFAULT 0,
  biography TEXT DEFAULT '',
  category TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'followed', 'dmed')),
  followed_at TIMESTAMP WITH TIME ZONE,
  dmed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Daily queues table
CREATE TABLE public.daily_queues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  queue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  queue_type TEXT NOT NULL CHECK (queue_type IN ('follow', 'dm')),
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Openers table
CREATE TABLE public.openers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  opener_text TEXT NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_contacts_user_status ON public.contacts(user_id, status);
CREATE INDEX idx_contacts_profile_link ON public.contacts(user_id, profile_link);
CREATE INDEX idx_daily_queues_user_date ON public.daily_queues(user_id, queue_date, queue_type);
CREATE INDEX idx_daily_queues_contact ON public.daily_queues(contact_id);
CREATE INDEX idx_openers_contact ON public.openers(contact_id);

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openers ENABLE ROW LEVEL SECURITY;

-- Contacts policies
CREATE POLICY "Users can view own contacts" ON public.contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own contacts" ON public.contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own contacts" ON public.contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own contacts" ON public.contacts FOR DELETE USING (auth.uid() = user_id);

-- Daily queues policies
CREATE POLICY "Users can view own queues" ON public.daily_queues FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own queues" ON public.daily_queues FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own queues" ON public.daily_queues FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own queues" ON public.daily_queues FOR DELETE USING (auth.uid() = user_id);

-- Openers policies
CREATE POLICY "Users can view own openers" ON public.openers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own openers" ON public.openers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own openers" ON public.openers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own openers" ON public.openers FOR DELETE USING (auth.uid() = user_id);
