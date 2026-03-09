-- Add opener_templates JSONB column to user_settings
-- Each element: { "text": string, "condition": string, "order": number }
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS opener_templates jsonb DEFAULT NULL;

-- Auto-migrate existing users: convert their opener_option_a into template #1,
-- and add the standard "business owner" template as #2.
UPDATE public.user_settings
SET opener_templates = jsonb_build_array(
  jsonb_build_object(
    'text', '[GREETING] [NAME], do you accept new clients for Botox right now?',
    'condition', 'A person''s name is present',
    'order', 0
  ),
  jsonb_build_object(
    'text', '[GREETING], do you accept new clients for Botox right now?',
    'condition', 'No clear person name is present',
    'order', 1
  )
)
WHERE opener_templates IS NULL
  AND opener_option_a IS NOT NULL;
