# ReachMate — Supabase Migration Guide

## Step 1: Set up your new Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project (or use an existing one)
2. Note down:
   - **Project URL** — `Settings → API → Project URL`
   - **Anon public key** — `Settings → API → anon public`

## Step 2: Run the schema migration

1. In your new Supabase project, go to **SQL Editor → New query**
2. Paste the entire contents of `migration.sql` (in the project root)
3. Click **Run** — this creates all 4 tables, indexes, and RLS policies

## Step 3: Enable Email auth

1. Go to **Authentication → Providers → Email**
2. Make sure Email auth is **enabled** (it's on by default)
3. Sign up with the same email you used on the old project

## Step 4: Export data from old Supabase (optional)

If you have existing data you want to keep:

1. Go to your **old** Supabase project → **Table Editor**
2. For each table (`contacts`, `daily_queues`, `openers`, `follow_up_notes`):
   - Click the table → click **Export** (top right) → **CSV**
3. In your **new** project → **Table Editor** → same table → **Import data** → upload each CSV
4. **Important**: After importing, update the `user_id` column in all rows to match your new auth UID
   - Sign up in the new project first, then find your user ID in **Authentication → Users**
   - Run this SQL for each table (replace the IDs):
     ```sql
     UPDATE contacts SET user_id = 'YOUR_NEW_USER_ID' WHERE user_id = 'YOUR_OLD_USER_ID';
     UPDATE daily_queues SET user_id = 'YOUR_NEW_USER_ID' WHERE user_id = 'YOUR_OLD_USER_ID';
     UPDATE openers SET user_id = 'YOUR_NEW_USER_ID' WHERE user_id = 'YOUR_OLD_USER_ID';
     UPDATE follow_up_notes SET user_id = 'YOUR_NEW_USER_ID' WHERE user_id = 'YOUR_OLD_USER_ID';
     ```

## Step 5: Deploy the edge function

1. Install Supabase CLI: `npm i -g supabase`
2. Link your project: `supabase link --project-ref YOUR_PROJECT_REF`
3. Set the Groq API key secret:
   ```bash
   supabase secrets set GROQ_API_KEY=gsk_your_key_here
   ```
4. Deploy the function:
   ```bash
   supabase functions deploy generate-openers
   ```

## Step 6: Set environment variables

### Local development
Copy `.env.example` to `.env` and fill in your values:
```
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
```

### Vercel deployment
1. Go to your Vercel project → **Settings → Environment Variables**
2. Add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
3. Redeploy

## Step 7: Test

1. Run locally: `npm run dev`
2. Sign up with a fresh email
3. Import a CSV and verify contacts appear
4. Check that follow-ups, pipeline, and analytics all work

---

**That's it!** Your app is now running on your own Supabase project.
