-- Open sign-up: anyone 18 or older with a confirmed phone number can join, without
-- an invite. An invite still counts when one comes in (from an invite link): it must be
-- valid, it's used up as before, and a trusted invite skips the first-week limits.
-- Without one, a new member starts untrusted, so the first-week limits apply.
create or replace function private.complete_signup(
  p_handle text, p_invite_code text, p_confirm_adult boolean, p_rules_version text,
  p_health_data_consent boolean
) returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := nullif(upper(trim(coalesce(p_invite_code, ''))), '');
  v_invite public.invites;
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'You''re already signed up.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.phone_confirmed_at is not null) then
    raise exception 'Confirm your phone number first.' using errcode = 'P0001';
  end if;
  if p_confirm_adult is not true then
    raise exception 'Miracle Health is for adults 18 and over.' using errcode = 'P0001';
  end if;
  -- Health-privacy laws such as Washington's My Health My Data Act require consent
  -- before collecting health information; posts about what you take are that.
  if p_health_data_consent is not true then
    raise exception 'To join, agree to how what you post about your health is collected and shown.' using errcode = 'P0001';
  end if;
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Handles are 3 to 20 letters, numbers or underscores.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.profiles where lower(handle) = lower(p_handle)) then
    raise exception 'That handle is taken.' using errcode = 'P0001';
  end if;
  if p_rules_version is distinct from private.setting('rules_version') then
    raise exception 'The rules changed. Read them again, then sign up.' using errcode = 'P0001';
  end if;

  if v_code is not null then
    select * into v_invite from public.invites
    where code = v_code
    for update;
    if not found
       or (v_invite.expires_at is not null and v_invite.expires_at < now())
       or v_invite.uses >= v_invite.max_uses then
      raise exception 'That invite code isn''t valid.' using errcode = 'P0001';
    end if;
    update public.invites set uses = uses + 1 where code = v_invite.code;
  end if;

  insert into public.profiles (id, handle, trusted, adult_confirmed_at, rules_version, invite_code, health_data_consent_at)
  values (v_uid, p_handle, coalesce(v_invite.trusted, false), now(), p_rules_version, v_invite.code, now())
  returning * into v_profile;
  return v_profile;
end;
$$;
