-- Local and test data only (never run against the live project).
insert into public.invites (code, note, trusted, max_uses)
values ('BETATEST01', 'Local test invite', false, 20),
       ('FOUNDERS01', 'Local founding members', true, 10)
on conflict (code) do nothing;

-- A moderator for local testing: phone 15555550101, code 123456.
-- Written the way Supabase Auth writes users: Auth looks users up by the zero
-- instance_id, and can't load a user whose token columns are NULL.
insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, encrypted_password,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000101',
        'authenticated', 'authenticated', '15555550101', now(), '',
        '', '', '', '',
        now(), now(), '{"provider":"phone","providers":["phone"]}', '{}')
on conflict (id) do nothing;
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000101',
        '{"sub":"00000000-0000-4000-8000-000000000101","phone":"15555550101","email_verified":false,"phone_verified":true}',
        'phone', now(), now(), now())
on conflict (provider_id, provider) do nothing;
insert into public.profiles (id, handle, role, trusted, adult_confirmed_at, rules_version, health_data_consent_at)
values ('00000000-0000-4000-8000-000000000101', 'mod_maya', 'moderator', true, now(), '2026-10-21', now())
on conflict (id) do nothing;

-- The test project's real-question check (scripts/ask_smoke.py) asks ten questions in a row,
-- more than one visitor may send Miracle AI in ten minutes on the live site
update private.settings set value = '30' where key = 'ask_per_visitor_10min';
