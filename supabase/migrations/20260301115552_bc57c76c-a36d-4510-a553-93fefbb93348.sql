
ALTER TABLE public.contacts DROP CONSTRAINT contacts_status_check;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_status_check CHECK (status = ANY (ARRAY['not_started', 'followed', 'dmed', 'initiated', 'engaged', 'calendly_sent', 'booked', 'flywheel']));
