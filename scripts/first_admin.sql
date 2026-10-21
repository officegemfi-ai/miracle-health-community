-- Run in the LIVE project's SQL editor to let the first person in.
-- 1. Before signing up: a founding-member invite (15 uses, skips first-week limits)
insert into public.invites (code, note, trusted, max_uses)
values ('FOUNDERS', 'Founding members', true, 15);

-- 2. After you've signed up in the app with that code, make yourself admin:
-- update public.profiles set role = 'admin' where handle = 'YOUR_HANDLE';
-- Moderators are made the same way, with role = 'moderator'.
