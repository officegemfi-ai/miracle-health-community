-- Run once in EACH Supabase project (Database > SQL editor), after the first deploy.
-- It lets the database ask the review-content function to read new posts.
-- Replace both values; the second must equal the REVIEW_SECRET GitHub secret.
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('THE-SAME-VALUE-AS-REVIEW_SECRET', 'review_secret');
