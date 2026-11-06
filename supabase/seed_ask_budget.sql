-- Local and test data only (never run against the live project; the live project's own setting
-- is untouched). Sig's test set asks about 230 questions a run, so a day with a few runs needs more
-- than the live site's daily budget. A new file, because the CLI runs each seed file only once.
update private.settings set value = '3000' where key = 'ask_per_day';
