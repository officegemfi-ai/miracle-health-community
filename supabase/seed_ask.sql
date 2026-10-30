-- Local and test data only (never run against the live project).
-- The test project's real-question check (scripts/ask_smoke.py) asks ten questions in a row,
-- more than one visitor may send Miracle AI in ten minutes on the live site.
-- The Supabase CLI runs each seed file once per project: when a file it has already run
-- changes, it only records the new version. So a new test setting goes in a new file.
update private.settings set value = '30' where key = 'ask_per_visitor_10min';
