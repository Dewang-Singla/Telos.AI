begin;

-- Follows are one-way subscriptions. They never grant private-profile, post or chat access.
create table public.follows (
 follower_id uuid not null references public.profiles on delete cascade,
 following_id uuid not null references public.profiles on delete cascade,
 created_at timestamptz not null default now(),
 primary key(follower_id,following_id), check(follower_id<>following_id)
);
create index follows_target on public.follows(following_id,created_at desc);
alter table public.follows enable row level security;
create policy follows_read on public.follows for select to authenticated using((follower_id=auth.uid() or following_id=auth.uid()) and not public.is_blocked(follower_id,following_id));
revoke all on public.follows from public,anon,authenticated;
grant select on public.follows to authenticated;

-- Changes notify only the affected accounts; no public relationship graph is broadcast.
create table public.relationship_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles on delete cascade,
 created_at timestamptz not null default now()
);
create index relationship_events_time on public.relationship_events(created_at);
alter table public.relationship_events enable row level security;
create policy relationship_events_read on public.relationship_events for select to authenticated using(user_id=auth.uid());
revoke all on public.relationship_events from public,anon,authenticated;
grant select on public.relationship_events to authenticated;
create function private.relationship_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid; b uuid;
begin
 if TG_TABLE_NAME='follows' then
  if TG_OP='DELETE' then a:=old.follower_id; b:=old.following_id; else a:=new.follower_id; b:=new.following_id; end if;
 else
  if TG_OP='DELETE' then a:=old.sender_id; b:=old.recipient_id; else a:=new.sender_id; b:=new.recipient_id; end if;
 end if;
 insert into public.relationship_events(user_id) select id from public.profiles where id in (a,b);
 delete from public.relationship_events where created_at<now()-interval '10 minutes';
 return null;
end;
$$;
create trigger follow_changed after insert or delete on public.follows for each row execute function private.relationship_changed();
create trigger connection_changed after insert or update on public.connection_requests for each row execute function private.relationship_changed();

create or replace function public.consume_rate_limit(action_name text,maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b bigint:=floor(extract(epoch from now())/3600); lim integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports','presence','posts','comments','follows') then raise exception 'Unknown rate limit action'; end if;
 lim:=case action_name when 'ai' then 20 when 'intents' then 20 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 when 'presence' then 600 when 'posts' then 30 when 'comments' then 120 when 'follows' then 120 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
end;
$$;
create function public.set_follow(target_id uuid,following boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or target_id=auth.uid() then raise exception 'Follow not available'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(auth.uid(),target_id)::text||greatest(auth.uid(),target_id)::text,0));
 if following then
  if not public.can_view_profile(target_id) then raise exception 'Profile not available'; end if;
  if exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=target_id) then return; end if;
  if not public.consume_rate_limit('follows') then raise exception 'Hourly limit reached'; end if;
  insert into public.follows(follower_id,following_id) values(auth.uid(),target_id) on conflict do nothing;
 else
  delete from public.follows where follower_id=auth.uid() and following_id=target_id;
 end if;
end;
$$;

alter table public.connection_requests drop constraint connection_requests_status_check;
alter table public.connection_requests add constraint connection_requests_status_check check(status in ('pending','accepted','declined','cancelled','removed'));
create function public.manage_connection(request_uuid uuid,action_name text) returns void language plpgsql security definer set search_path='' as $$
declare req public.connection_requests;
begin
 select * into req from public.connection_requests where id=request_uuid and auth.uid() in (sender_id,recipient_id);
 if req.id is null then raise exception 'Connection not available'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(req.sender_id,req.recipient_id)::text||greatest(req.sender_id,req.recipient_id)::text,0));
 select * into req from public.connection_requests where id=request_uuid for update;
 if action_name='cancel' and req.sender_id=auth.uid() and req.status='pending' then
  update public.connection_requests set status='cancelled' where id=req.id;
 elsif action_name='remove' and req.status='accepted' then
  update public.connection_requests set status='removed' where id=req.id;
 elsif (action_name='cancel' and req.sender_id=auth.uid() and req.status='cancelled') or (action_name='remove' and req.status='removed') then
  return;
 else raise exception 'Connection action not available'; end if;
end;
$$;

-- Members retain their past conversation after disconnecting, but cannot send new messages.
create function public.can_message(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_member(cid) and exists(select 1 from public.conversations c join public.connection_requests r on r.id=c.request_id where c.id=cid and r.status='accepted');
$$;
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.can_message(conversation_id));

-- Blocking also ends subscriptions and active connections. Unblocking does not restore them.
create function private.block_relationships() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(new.blocker_id,new.blocked_id)::text||greatest(new.blocker_id,new.blocked_id)::text,0));
 delete from public.follows where (follower_id=new.blocker_id and following_id=new.blocked_id) or (follower_id=new.blocked_id and following_id=new.blocker_id);
 update public.connection_requests set status=case when status='accepted' then 'removed' else 'cancelled' end where status in ('pending','accepted') and ((sender_id=new.blocker_id and recipient_id=new.blocked_id) or (sender_id=new.blocked_id and recipient_id=new.blocker_id));
 return new;
end;
$$;
create trigger block_relationships after insert on public.blocks for each row execute function private.block_relationships();
-- Apply the same rule to any blocks present before this upgrade.
delete from public.follows f where public.is_blocked(f.follower_id,f.following_id);
update public.connection_requests r set status=case when status='accepted' then 'removed' else 'cancelled' end where status in ('pending','accepted') and public.is_blocked(r.sender_id,r.recipient_id);

create function public.relationship_status(target_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare req public.connection_requests; cid uuid;
begin
 if not public.can_view_profile(target_id) then raise exception 'Profile not available'; end if;
 select * into req from public.connection_requests where status in ('pending','accepted') and ((sender_id=auth.uid() and recipient_id=target_id) or (sender_id=target_id and recipient_id=auth.uid()));
 if req.status='accepted' then select id into cid from public.conversations where request_id=req.id; end if;
 return jsonb_build_object(
  'following',exists(select 1 from public.follows where follower_id=auth.uid() and following_id=target_id),
  'follows_you',exists(select 1 from public.follows where follower_id=target_id and following_id=auth.uid()),
  'follower_count',(select count(*) from public.follows where following_id=target_id and not public.is_blocked(auth.uid(),follower_id)),
  'following_count',(select count(*) from public.follows where follower_id=target_id and not public.is_blocked(auth.uid(),following_id)),
  'connection_count',(select count(*) from public.connection_requests r where status='accepted' and target_id in (sender_id,recipient_id) and not public.is_blocked(auth.uid(),case when sender_id=target_id then recipient_id else sender_id end)),
  'connection',case when req.status='accepted' then 'connected' when req.status='pending' and req.sender_id=auth.uid() then 'sent' when req.status='pending' then 'received' else 'none' end,
  'request_id',req.id,'conversation_id',cid);
end;
$$;
create function public.follow_people(direction text,page_offset integer default 0) returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or direction not in ('followers','following') or page_offset not between 0 and 10000 then raise exception 'Invalid follow query'; end if;
 return query select to_jsonb(p) from public.follows f join public.profiles p on p.id=case when direction='followers' then f.follower_id else f.following_id end
 where (direction='followers' and f.following_id=auth.uid() or direction='following' and f.follower_id=auth.uid()) and public.can_view_profile(p.id)
 order by f.created_at desc,p.id asc limit 40 offset page_offset;
end;
$$;

-- Preserve chronological ordering while allowing explicit All / Following / Connections views.
drop function public.list_posts(uuid,text,boolean,integer,uuid);
create function public.list_posts(author_id uuid default null,search_text text default '',saved_only boolean default false,page_offset integer default 0,post_uuid uuid default null,feed_scope text default 'all') returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if feed_scope not in ('all','following','connections') or page_offset not between 0 and 10000 then raise exception 'Invalid feed query'; end if;
 return query select to_jsonb(p)||jsonb_build_object('profile',to_jsonb(person),'like_count',(select count(*) from public.post_likes l where l.post_id=p.id),'comment_count',(select count(*) from public.post_comments c where c.post_id=p.id and public.can_view_profile(c.user_id)),'liked',exists(select 1 from public.post_likes l where l.post_id=p.id and l.user_id=auth.uid()),'saved',exists(select 1 from public.post_saves s where s.post_id=p.id and s.user_id=auth.uid()))
 from public.posts p join public.profiles person on person.id=p.user_id
 where public.can_read_post(p.id) and (post_uuid is null or p.id=post_uuid) and (author_id is null or p.user_id=author_id)
 and (search_text='' or position(lower(left(search_text,200)) in lower(p.body))>0)
 and (not saved_only or exists(select 1 from public.post_saves s where s.post_id=p.id and s.user_id=auth.uid()))
 and (feed_scope='all' or feed_scope='following' and exists(select 1 from public.follows f where f.follower_id=auth.uid() and f.following_id=p.user_id) or feed_scope='connections' and public.are_connected(auth.uid(),p.user_id))
 order by p.created_at desc,p.id asc limit 20 offset page_offset;
end;
$$;

-- Relationship helpers may only answer questions involving the caller.
create or replace function public.is_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() in (a,b) and exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create or replace function public.are_connected(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() in (a,b) and not public.is_blocked(a,b) and exists(select 1 from public.connection_requests where status='accepted' and ((sender_id=a and recipient_id=b) or (sender_id=b and recipient_id=a)));
$$;

revoke all on function public.set_follow(uuid,boolean),public.manage_connection(uuid,text),public.can_message(uuid),public.relationship_status(uuid),public.follow_people(text,integer),public.list_posts(uuid,text,boolean,integer,uuid,text) from public,anon;
grant execute on function public.set_follow(uuid,boolean),public.manage_connection(uuid,text),public.can_message(uuid),public.relationship_status(uuid),public.follow_people(text,integer),public.list_posts(uuid,text,boolean,integer,uuid,text) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
alter publication supabase_realtime add table public.relationship_events;
commit;
