-- Run in the LIVE project's SQL editor to let the first person in.
-- 1. Before signing up: a founding-member invite (15 uses, skips first-week limits).
--    The code is random and appears in the result below; share it only with founding members.
insert into public.invites (note, trusted, max_uses)
values ('Founding members', true, 15)
returning code;

-- 2. After you've signed up in the app with that code, make yourself admin:
-- update public.profiles set role = 'admin' where handle = 'YOUR_HANDLE';
-- Moderators are made the same way, with role = 'moderator'.
