-- Local and test data only (never run against the live project).
insert into public.invites (code, note, trusted, max_uses)
values ('BETATEST01', 'Local test invite', false, 20),
       ('FOUNDERS01', 'Local founding members', true, 10)
on conflict (code) do nothing;

-- A moderator for local testing: phone 15555550101, code 123456
insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', '15555550101', now(), now(), now(), '{"provider":"phone"}', '{}')
on conflict (id) do nothing;
insert into public.profiles (id, handle, role, trusted, adult_confirmed_at, rules_version, health_data_consent_at)
values ('00000000-0000-4000-8000-000000000101', 'mod_maya', 'moderator', true, now(), '2026-10-21', now())
on conflict (id) do nothing;
