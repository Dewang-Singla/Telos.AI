-- Add optional profile fields. Existing city values and profile permissions are preserved.
begin;
alter table public.profiles
 add column if not exists state text not null default '' check(length(state)<=100),
 add column if not exists country text not null default '' check(length(country)<=100);
grant update(state,country) on public.profiles to authenticated;
notify pgrst, 'reload schema';
commit;
