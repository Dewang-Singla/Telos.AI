begin;

-- A new profile must be readable by its owner during INSERT ... RETURNING/upsert.
-- The general visibility helper intentionally queries existing rows.
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or public.can_view_profile(id));

-- A saved search is private unless its owner explicitly displays it on their profile.
alter table public.intents add column show_on_profile boolean not null default false;
grant update(show_on_profile) on public.intents to authenticated;
drop policy intents_read on public.intents;
create policy intents_read on public.intents for select to authenticated using(user_id=auth.uid() or (show_on_profile and status='active' and public.can_view_profile(user_id)));
create index profile_current_intents on public.intents(user_id) where show_on_profile and status='active';
revoke all on public.saved_intents from public,anon,authenticated;

-- Remove every legacy RPC that returned another person's full intent.
drop function public.match_intents(uuid,double precision);
drop function public.discover_matches(uuid,boolean,double precision,double precision,double precision,text,double precision,integer);
drop function public.nearby_intents(double precision,double precision,double precision);
drop trigger intent_changed on public.intents;
delete from public.feed_events;

create table public.discovery_events(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now());
create index discovery_events_time on public.discovery_events(created_at);
alter table public.discovery_events enable row level security;
revoke all on public.discovery_events from public,anon,authenticated;
grant select on public.discovery_events to authenticated;
create policy discovery_events_read on public.discovery_events for select to authenticated using(auth.uid() is not null);
create function private.invalidate_discovery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.discovery_events default values;
 delete from public.discovery_events where created_at<now()-interval '10 minutes';
 return null;
end;
$$;
create trigger private_intent_changed after insert or update or delete on public.intents for each row execute function private.invalidate_discovery();

create or replace function public.save_intent(payload jsonb,intent_uuid uuid default null,lat double precision default null,lng double precision default null,radius double precision default 25) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Create your profile first'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 if intent_uuid is null then
  insert into public.intents(user_id,title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants,show_on_profile)
  values(auth.uid(),payload->>'title',payload->>'description',payload->>'category',payload->>'role',payload->>'mode',coalesce(payload->>'city',''),array(select jsonb_array_elements_text(payload->'tags')),array(select jsonb_array_elements_text(payload->'skills')),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'participants')::int,coalesce((payload->>'show_on_profile')::boolean,false)) returning id into result;
 else
  update public.intents set title=payload->>'title',description=payload->>'description',category=payload->>'category',role=payload->>'role',mode=payload->>'mode',city=payload->>'city',tags=array(select jsonb_array_elements_text(payload->'tags')),skills=array(select jsonb_array_elements_text(payload->'skills')),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,participants=(payload->>'participants')::int,show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false),indexed_at=null where id=intent_uuid and user_id=auth.uid() returning id into result;
  if result is null then raise exception 'Intention not found'; end if;
 end if;
 insert into private.intent_context(intent_id,location,radius_km) values(result,case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius)
 on conflict(intent_id) do update set location=excluded.location,radius_km=excluded.radius_km,embedding=null,embedding_model=null;
 return result;
end;
$$;

-- Ranking uses private candidate data. Only a readable profile and coarse distance leave this function.
create function public.find_people(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision) language plpgsql stable security definer set search_path='' as $$
declare source public.intents; ctx private.intent_context; terms text[]; origin extensions.geography;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active';
 if source.id is null then raise exception 'Intention not found'; end if;
 if page_offset<0 or page_offset>10000 or radius not between 1 and 500 then raise exception 'Invalid discovery parameters'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
 terms:=private.intent_terms(source.title||' '||source.description||' '||array_to_string(source.tags,' '));
 origin:=case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography when length(btrim(city_filter))>0 then null else ctx.location end;
 if nearby_only and origin is null and length(btrim(city_filter))=0 then raise exception 'Choose a location'; end if;
 return query with candidates as (
  select p as person,i.user_id,i.id,i.created_at,c.location,
   coalesce(pr.last_seen_at>now()-interval '90 seconds',false) as online,
   case when ctx.embedding is not null and c.embedding is not null and ctx.embedding_model=c.embedding_model then 1-(c.embedding operator(extensions.<=>) ctx.embedding) else null end as semantic,
   exists(select 1 from unnest(private.intent_terms(i.title||' '||i.description||' '||array_to_string(i.tags,' '))) word where word=any(terms)) as keyword
  from public.intents i join public.profiles p on p.id=i.user_id left join private.intent_context c on c.intent_id=i.id left join public.member_presence pr on pr.user_id=i.user_id
  where i.user_id<>auth.uid() and i.status='active' and (i.ends_at is null or i.ends_at>now()) and (source.ends_at is null or source.ends_at>now()) and public.can_view_profile(i.user_id)
  and (source.role='open' or i.role='open' or case source.role when 'learn' then i.role='teach' when 'teach' then i.role='learn' when 'hire' then i.role='work' when 'work' then i.role='hire' when 'request' then i.role='offer' when 'offer' then i.role='request' when 'organize' then i.role='join' when 'join' then i.role in ('organize','join') else i.role=source.role end)
  and not(source.mode='online' and i.mode='in-person' or source.mode='in-person' and i.mode='online')
  and (source.starts_at is null and source.ends_at is null or (i.starts_at is not null and i.ends_at is not null and coalesce(source.starts_at,'-infinity')<i.ends_at and coalesce(source.ends_at,'infinity')>i.starts_at))
  and (source.mode<>'in-person' and i.mode<>'in-person' or (ctx.location is not null and c.location is not null and extensions.st_dwithin(ctx.location,c.location,least(ctx.radius_km,c.radius_km)*1000)) or ((ctx.location is null or c.location is null) and source.city<>'' and lower(source.city)=lower(i.city)))
  and (source.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(source.skills) s where not exists(select 1 from unnest(i.skills) cs where lower(cs)=lower(s))))
  and (i.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(i.skills) s where not exists(select 1 from unnest(source.skills) ss where lower(ss)=lower(s))))
  and (not nearby_only or (origin is not null and c.location is not null and extensions.st_dwithin(origin,c.location,radius*1000)) or (origin is null and city_filter<>'' and position(lower(btrim(city_filter)) in lower(i.city))>0))
 ), qualified as (
  select * from candidates where semantic>=greatest(.1,least(.99,min_similarity)) or (keyword and (semantic is null or semantic>=greatest(.1,min_similarity-.15)))
 ), people as (
  select distinct on(user_id) * from qualified order by user_id,created_at desc,id asc
 )
 select to_jsonb(person),online,case when nearby_only and origin is not null and location is not null then round((extensions.st_distance(origin,location)/1000)::numeric,0)::double precision end
 from people order by online desc,created_at desc,id asc limit 30 offset page_offset;
end;
$$;

create function public.valid_profile_details(value jsonb) returns boolean language sql immutable strict set search_path='' as $$
 select case when jsonb_typeof(value)='array' then jsonb_array_length(value)<=10 and not exists(select 1 from jsonb_array_elements(value) item where jsonb_typeof(item)<>'object' or coalesce(jsonb_typeof(item->'label'),'')<>'string' or coalesce(jsonb_typeof(item->'value'),'')<>'string' or length(btrim(item->>'label')) not between 1 and 40 or length(item->>'value')>200) else false end;
$$;
alter table public.profiles add column details jsonb not null default '[]'::jsonb check(public.valid_profile_details(details));
grant update(details) on public.profiles to authenticated;

-- Social posts are independent of searches.
create function public.valid_post_media(paths text[],owner_id uuid) returns boolean language sql immutable strict set search_path='' as $$
 select cardinality(paths)<=4 and not exists(select 1 from unnest(paths) path where path is null or path !~ ('^'||owner_id::text||'/[a-f0-9-]{36}\.webp$')) and cardinality(paths)=(select count(distinct path) from unnest(paths) path);
$$;
create table public.posts(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles on delete cascade,
 body text not null default '' check(length(body)<=5000),media_paths text[] not null default '{}',
 visibility text not null default 'public' check(visibility in ('public','connections')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(length(btrim(body))>0 or cardinality(media_paths)>0),check(public.valid_post_media(media_paths,user_id))
);
create index posts_feed on public.posts(created_at desc,id);
create index posts_author on public.posts(user_id,created_at desc);
create index posts_media on public.posts using gin(media_paths);
create function public.can_read_post(post_uuid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.posts p where p.id=post_uuid and (p.user_id=auth.uid() or public.can_view_profile(p.user_id) and (p.visibility='public' or public.are_connected(auth.uid(),p.user_id))));
$$;
alter table public.posts enable row level security;
create policy posts_read on public.posts for select to authenticated using(user_id=auth.uid() or public.can_read_post(id));
create policy posts_insert on public.posts for insert to authenticated with check(user_id=auth.uid());
create policy posts_update on public.posts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy posts_delete on public.posts for delete to authenticated using(user_id=auth.uid());
revoke all on public.posts from public,anon,authenticated;
grant select,insert,delete on public.posts to authenticated;
grant update(body,media_paths,visibility) on public.posts to authenticated;

create table public.post_likes(post_id uuid references public.posts on delete cascade,user_id uuid references public.profiles on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_saves(post_id uuid references public.posts on delete cascade,user_id uuid references public.profiles on delete cascade,created_at timestamptz not null default now(),primary key(post_id,user_id));
create table public.post_comments(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.posts on delete cascade,user_id uuid not null references public.profiles on delete cascade,body text not null check(length(btrim(body)) between 1 and 1000),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index comments_post on public.post_comments(post_id,created_at,id);
alter table public.post_likes enable row level security;
alter table public.post_saves enable row level security;
alter table public.post_comments enable row level security;
create policy likes_read on public.post_likes for select to authenticated using(public.can_read_post(post_id));
create policy likes_insert on public.post_likes for insert to authenticated with check(user_id=auth.uid() and public.can_read_post(post_id));
create policy likes_delete on public.post_likes for delete to authenticated using(user_id=auth.uid());
create policy saves_read on public.post_saves for select to authenticated using(user_id=auth.uid() and public.can_read_post(post_id));
create policy saves_insert on public.post_saves for insert to authenticated with check(user_id=auth.uid() and public.can_read_post(post_id));
create policy saves_delete on public.post_saves for delete to authenticated using(user_id=auth.uid());
create policy comments_read on public.post_comments for select to authenticated using(public.can_read_post(post_id) and public.can_view_profile(user_id));
create policy comments_insert on public.post_comments for insert to authenticated with check(user_id=auth.uid() and public.can_read_post(post_id));
create policy comments_update on public.post_comments for update to authenticated using(user_id=auth.uid() and public.can_read_post(post_id)) with check(user_id=auth.uid() and public.can_read_post(post_id));
create policy comments_delete on public.post_comments for delete to authenticated using(user_id=auth.uid());
revoke all on public.post_likes,public.post_saves,public.post_comments from public,anon,authenticated;
grant select,insert,delete on public.post_likes,public.post_saves,public.post_comments to authenticated;
grant update(body) on public.post_comments to authenticated;

create or replace function public.consume_rate_limit(action_name text,maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b bigint:=floor(extract(epoch from now())/3600); lim integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports','presence','posts','comments') then raise exception 'Unknown rate limit action'; end if;
 lim:=case action_name when 'ai' then 20 when 'intents' then 20 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 when 'presence' then 600 when 'posts' then 30 when 'comments' then 120 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
end;
$$;
create function private.guard_social_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then
  if new.id<>old.id or new.user_id<>old.user_id or new.created_at<>old.created_at then raise exception 'Immutable identity'; end if;
  if TG_TABLE_NAME='post_comments' then if new.post_id<>old.post_id then raise exception 'Immutable post'; end if; end if;
 else
  if not public.consume_rate_limit(case when TG_TABLE_NAME='posts' then 'posts' else 'comments' end) then raise exception 'Hourly limit reached'; end if;
  new.created_at:=now();
 end if;
 new.updated_at:=now();
 return new;
end;
$$;
create trigger posts_guard before insert or update on public.posts for each row execute function private.guard_social_write();
create trigger comments_guard before insert or update on public.post_comments for each row execute function private.guard_social_write();
create trigger social_post_changed after insert or update or delete on public.posts for each row execute function private.emit_feed_event();
create function private.social_interaction_event() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; author uuid;
begin
 if TG_OP='DELETE' then pid:=old.post_id; else pid:=new.post_id; end if;
 select user_id into author from public.posts where id=pid;
 if author is not null then insert into public.feed_events(user_id) values(author); end if;
 return null;
end;
$$;
create trigger like_changed after insert or delete on public.post_likes for each row execute function private.social_interaction_event();
create trigger comment_changed after insert or update or delete on public.post_comments for each row execute function private.social_interaction_event();

create function public.list_posts(author_id uuid default null,search_text text default '',saved_only boolean default false,page_offset integer default 0,post_uuid uuid default null) returns setof jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object('profile',to_jsonb(person),'like_count',(select count(*) from public.post_likes l where l.post_id=p.id),'comment_count',(select count(*) from public.post_comments c where c.post_id=p.id and public.can_view_profile(c.user_id)),'liked',exists(select 1 from public.post_likes l where l.post_id=p.id and l.user_id=auth.uid()),'saved',exists(select 1 from public.post_saves s where s.post_id=p.id and s.user_id=auth.uid()))
 from public.posts p join public.profiles person on person.id=p.user_id
 where public.can_read_post(p.id) and (post_uuid is null or p.id=post_uuid) and (author_id is null or p.user_id=author_id) and (search_text='' or position(lower(left(search_text,200)) in lower(p.body))>0) and (not saved_only or exists(select 1 from public.post_saves s where s.post_id=p.id and s.user_id=auth.uid()))
 order by p.created_at desc,p.id asc limit 20 offset greatest(0,least(page_offset,10000));
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('post-media','post-media',false,5242880,array['image/webp']) on conflict(id) do update set public=false;
create policy post_media_insert on storage.objects for insert to authenticated with check(bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text and name ~ ('^'||auth.uid()::text||'/[a-f0-9-]{36}\.webp$'));
create policy post_media_read on storage.objects for select to authenticated using(bucket_id='post-media' and ((storage.foldername(name))[1]=auth.uid()::text or exists(select 1 from public.posts p where name=any(p.media_paths) and public.can_read_post(p.id))));
create policy post_media_delete on storage.objects for delete to authenticated using(bucket_id='post-media' and (storage.foldername(name))[1]=auth.uid()::text);

-- The recipient is never given a private search body or its identifier.
create table private.request_context(request_id uuid primary key references public.connection_requests on delete cascade,intent_id uuid not null references public.intents on delete cascade);
update public.connection_requests set intent_id=null where intent_id is not null;
drop policy requests_insert on public.connection_requests;
create policy requests_insert on public.connection_requests for insert to authenticated with check(sender_id=auth.uid() and status='pending' and public.can_view_profile(recipient_id) and (intent_id is null or exists(select 1 from public.intents where id=intent_id and user_id=recipient_id and show_on_profile and status='active')));
create function public.send_connection_request(recipient_uuid uuid,note_text text,source_uuid uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.connection_requests; cid uuid; rid uuid;
begin
 if auth.uid() is null or auth.uid()=recipient_uuid or not public.can_view_profile(recipient_uuid) then raise exception 'Connection not available'; end if;
 if source_uuid is not null and not exists(select 1 from public.intents where id=source_uuid and user_id=auth.uid()) then raise exception 'Intention not found'; end if;
 if length(btrim(note_text)) not between 5 and 500 then raise exception 'Invalid message'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(least(auth.uid(),recipient_uuid)::text||greatest(auth.uid(),recipient_uuid)::text,0));
 select * into req from public.connection_requests where status in ('pending','accepted') and ((sender_id=auth.uid() and recipient_id=recipient_uuid) or (sender_id=recipient_uuid and recipient_id=auth.uid()));
 if req.status='accepted' then select id into cid from public.conversations where request_id=req.id; return jsonb_build_object('ok',true,'conversation_id',cid); end if;
 if req.status='pending' then return jsonb_build_object('ok',true,'pending',true); end if;
 insert into public.connection_requests(sender_id,recipient_id,note) values(auth.uid(),recipient_uuid,note_text) returning id into rid;
 if source_uuid is not null then insert into private.request_context values(rid,source_uuid); end if;
 return jsonb_build_object('ok',true);
end;
$$;

alter table public.reports add column post_id uuid references public.posts on delete set null;
drop policy reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check(reporter_id=auth.uid() and reporter_id<>target_id and (post_id is null or exists(select 1 from public.posts where id=post_id and user_id=target_id and public.can_read_post(id))) and (intent_id is null or exists(select 1 from public.intents where id=intent_id and user_id=target_id and show_on_profile)));

revoke all on function public.find_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.valid_profile_details(jsonb),public.valid_post_media(text[],uuid),public.can_read_post(uuid),public.list_posts(uuid,text,boolean,integer,uuid),public.send_connection_request(uuid,text,uuid) from public,anon;
grant execute on function public.find_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.valid_profile_details(jsonb),public.valid_post_media(text[],uuid),public.can_read_post(uuid),public.list_posts(uuid,text,boolean,integer,uuid),public.send_connection_request(uuid,text,uuid) to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
alter publication supabase_realtime add table public.discovery_events;
commit;
