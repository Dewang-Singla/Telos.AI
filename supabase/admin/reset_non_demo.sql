-- One-time administrator operation. Never put this file in migrations.
-- Keeps the application schema, Auth configuration, demo accounts and their posts/intents.
-- DELETES real-user logins and app data; demo accounts/content are kept.
-- Run as postgres in Supabase SQL Editor after removing non-demo uploads via Storage.
begin;
set local lock_timeout = '5s';
lock table public.profiles, public.intents, public.posts in share row exclusive mode;

create temporary table reset_options(delete_real_logins boolean not null) on commit drop;
insert into reset_options values(true);

create temporary table preserved_demo_users(id uuid primary key) on commit drop;
insert into preserved_demo_users
select u.id from auth.users u
where u.raw_app_meta_data->>'telos_demo'='v1'
   or exists(select 1 from public.profiles p where p.id=u.id and p.is_demo);

create temporary table preserved_demo_counts on commit drop as
select
 (select count(*) from auth.users u join preserved_demo_users d on d.id=u.id) as accounts,
 (select count(*) from public.profiles p join preserved_demo_users d on d.id=p.id) as profiles,
 (select count(*) from public.intents i join preserved_demo_users d on d.id=i.user_id) as intents,
 (select count(*) from public.posts p join preserved_demo_users d on d.id=p.user_id) as posts;

do $preflight$
begin
 if not exists(select 1 from preserved_demo_users) then
  raise exception 'Reset stopped: no marked demo accounts found. No data was changed.';
 end if;
 -- Storage files must be removed through Storage, never by deleting SQL metadata.
 if exists(
  select 1 from storage.objects o
  where o.bucket_id in ('profile-media','post-media')
   and not exists(select 1 from preserved_demo_users d where d.id::text=split_part(o.name,'/',1)
    or d.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner'))
 ) then
  raise exception 'Reset stopped: remove non-demo uploads from profile-media and post-media using the Storage dashboard/API first. Demo folders must be kept.';
 end if;
 if (select delete_real_logins from reset_options) and exists(
  select 1 from storage.objects o join auth.users u
   on u.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')
  where not exists(select 1 from preserved_demo_users d where d.id=u.id)
 ) then
  raise exception 'Reset stopped: a real user still owns Storage files. Remove those through Storage before deleting their login.';
 end if;
end;
$preflight$;

-- Clear test activity, including interactions involving demo accounts.
delete from public.reports;
delete from public.connection_requests; -- Cascades to conversations, members and messages.
delete from public.saved_intents;
delete from public.blocks;
delete from public.follows;
delete from public.post_comments;
delete from public.post_likes;
delete from public.post_saves;
delete from public.notifications;

-- Owned content and exact-coordinate/vector records follow the profile's FK cascades.
delete from public.profiles p where not exists(select 1 from preserved_demo_users d where d.id=p.id);

-- Optional tables depend on which successful migrations are installed (006 onward).
do $cleanup$
declare relation text;
begin
 foreach relation in array array[
  'private.presence_sessions','public.member_presence','private.rate_limits',
  'private.people_searches','private.intent_artifacts','private.match_reviews',
  'private.search_sessions','private.search_generations','private.intent_request_keys',
  'public.feed_events','public.relationship_events','public.discovery_events'
 ] loop
  if to_regclass(relation) is not null then execute format('delete from %s',to_regclass(relation)); end if;
 end loop;
 if (select delete_real_logins from reset_options) then
  delete from auth.users u where not exists(select 1 from preserved_demo_users d where d.id=u.id);
 end if;
end;
$cleanup$;

do $verify$
declare before_counts preserved_demo_counts;
begin
 select * into before_counts from preserved_demo_counts;
 if before_counts.accounts<>(select count(*) from auth.users u join preserved_demo_users d on d.id=u.id)
  or before_counts.profiles<>(select count(*) from public.profiles p join preserved_demo_users d on d.id=p.id)
  or before_counts.intents<>(select count(*) from public.intents i join preserved_demo_users d on d.id=i.user_id)
  or before_counts.posts<>(select count(*) from public.posts p join preserved_demo_users d on d.id=p.user_id)
 then raise exception 'Demo preservation check failed. Reset rolled back.'; end if;
 if exists(select 1 from public.profiles p where not exists(select 1 from preserved_demo_users d where d.id=p.id))
 then raise exception 'Real profile cleanup failed. Reset rolled back.'; end if;
end;
$verify$;

select (select delete_real_logins from reset_options) as deleting_real_logins,
 (select count(*) from auth.users) as logins_remaining,
 (select count(*) from public.profiles) as demo_profiles_remaining,
 (select count(*) from public.intents) as demo_intents_remaining,
 (select count(*) from public.posts) as demo_posts_remaining;

commit;
