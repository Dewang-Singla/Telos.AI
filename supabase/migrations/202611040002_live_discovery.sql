begin;

alter table public.intents drop constraint intents_role_check;
alter table public.intents add constraint intents_role_check check(role in ('open','socialize','collaborate','learn','teach','hire','work','request','offer','organize','join'));
alter table public.intents drop constraint intent_city;
alter table public.intents add constraint intent_city check(length(city)<=100);
alter table public.intents add column indexed_at timestamptz;
alter table public.intents drop constraint intents_title_check;
alter table public.intents drop constraint intents_description_check;
alter table public.intents add constraint intents_title_check check(length(btrim(title)) between 3 and 120);
alter table public.intents add constraint intents_description_check check(length(btrim(description)) between 3 and 3000);
-- PostgREST upserts include the primary key in their UPDATE column list.
-- RLS and the immutable-identity trigger still prohibit changing it.
grant update(id) on public.profiles to authenticated;

create table private.presence_sessions (
 user_id uuid not null references public.profiles on delete cascade,
 session_id uuid not null,
 seen_at timestamptz not null default now(),
 primary key(user_id,session_id)
);
create table public.member_presence (
 user_id uuid primary key references public.profiles on delete cascade,
 last_seen_at timestamptz not null
);
alter table public.member_presence enable row level security;
create policy presence_read on public.member_presence for select to authenticated using(public.can_view_profile(user_id));
revoke all on public.member_presence from public,anon,authenticated;
grant select on public.member_presence to authenticated;

create or replace function public.consume_rate_limit(action_name text, maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b bigint := floor(extract(epoch from now())/3600); lim integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports','presence') then raise exception 'Unknown rate limit action'; end if;
 lim := case action_name when 'ai' then 20 when 'intents' then 20 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 when 'presence' then 600 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
end;
$$;
create function public.update_presence(session_uuid uuid,active boolean) returns void language plpgsql security definer set search_path='' as $$
declare latest timestamptz;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Profile required'; end if;
 if not public.consume_rate_limit('presence') then raise exception 'Presence limit reached'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text,0));
 delete from private.presence_sessions where user_id=auth.uid() and seen_at<now()-interval '90 seconds';
 if active then
   if (select count(*) from private.presence_sessions where user_id=auth.uid())>=16 and not exists(select 1 from private.presence_sessions where user_id=auth.uid() and session_id=session_uuid) then raise exception 'Too many sessions'; end if;
   insert into private.presence_sessions values(auth.uid(),session_uuid,now()) on conflict(user_id,session_id) do update set seen_at=now();
 else
   delete from private.presence_sessions where user_id=auth.uid() and session_id=session_uuid;
 end if;
 select max(seen_at) into latest from private.presence_sessions where user_id=auth.uid();
 insert into public.member_presence values(auth.uid(),coalesce(latest,'-infinity'::timestamptz)) on conflict(user_id) do update set last_seen_at=excluded.last_seen_at;
end;
$$;

-- RLS-filtered invalidations include deletes without publishing deleted private rows.
create table public.feed_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles on delete cascade,
 created_at timestamptz not null default now()
);
create index feed_events_time on public.feed_events(created_at);
alter table public.feed_events enable row level security;
create policy feed_events_read on public.feed_events for select to authenticated using(public.can_view_profile(user_id));
revoke all on public.feed_events from public,anon,authenticated;
grant select on public.feed_events to authenticated;
create function private.emit_feed_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if TG_OP='DELETE' then actor:=old.user_id; else actor:=new.user_id; end if;
 if not exists(select 1 from public.profiles where id=actor) then return null; end if;
 insert into public.feed_events(user_id) values(actor);
 delete from public.feed_events where created_at<now()-interval '10 minutes';
 return null;
end;
$$;
create trigger intent_changed after insert or update or delete on public.intents for each row execute function private.emit_feed_event();
create or replace function public.set_intent_embedding(intent_uuid uuid, values_json jsonb, model_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.intents where id=intent_uuid and user_id=auth.uid()) then raise exception 'Intention not found'; end if;
 update private.intent_context set embedding=values_json::text::extensions.vector,embedding_model=model_name where intent_id=intent_uuid;
 update public.intents set indexed_at=now() where id=intent_uuid;
end;
$$;

create function private.intent_terms(content text) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct term),'{}'::text[]) from (select ltrim(raw,'#') as term from regexp_split_to_table(lower(content),'[^[:alnum:]_+#]+') raw) tokens
 where (length(term)>1 or term in ('r','c')) and term<>all(array['the','and','for','with','that','this','want','looking','someone','anyone','would','like','have','from','into','some','need','find','can','are','our','your','you','who','just','get','people','really','will','about','how','what','let','its','does','any','something','am','is','to','of','do','it','at','as','me','an','on','in','be','my','we','or','if','by','up','no','so','us','he','she']);
$$;
create index intent_search on public.intents using gin(to_tsvector('simple',title||' '||description));

-- Both matching methods use the same privacy, location and scheduling constraints.
create function public.discover_matches(
 source_id uuid,
 nearby_only boolean default false,
 lat double precision default null,
 lng double precision default null,
 radius double precision default 25,
 city_filter text default '',
 min_similarity double precision default .55,
 page_offset integer default 0
) returns table(intent jsonb,similarity double precision,distance_km double precision,method text) language plpgsql stable security definer set search_path='' as $$
declare source public.intents; ctx private.intent_context; terms text[]; origin extensions.geography;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active';
 if source.id is null then raise exception 'Intention not found'; end if;
 if page_offset<0 or page_offset>10000 or radius not between 1 and 500 then raise exception 'Invalid discovery parameters'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
 terms := private.intent_terms(source.title||' '||source.description||' '||array_to_string(source.tags,' '));
 origin := case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography when length(btrim(city_filter))>0 then null else ctx.location end;
 if nearby_only and origin is null and length(btrim(city_filter))=0 then raise exception 'Choose a location'; end if;
 return query
 with candidates as (
 select i,p,c.location,c.radius_km,
   coalesce(pr.last_seen_at>now()-interval '90 seconds',false) as online,
   case when ctx.embedding is not null and c.embedding is not null and ctx.embedding_model=c.embedding_model then 1-(c.embedding operator(extensions.<=>) ctx.embedding) else null end as semantic,
   exists(select 1 from unnest(private.intent_terms(i.title||' '||i.description||' '||array_to_string(i.tags,' '))) word where word=any(terms)) as keyword
 from public.intents i join public.profiles p on p.id=i.user_id
 left join private.intent_context c on c.intent_id=i.id
 left join public.member_presence pr on pr.user_id=i.user_id
 where i.user_id<>auth.uid() and i.status='active' and (i.ends_at is null or i.ends_at>now()) and (source.ends_at is null or source.ends_at>now()) and public.can_view_profile(i.user_id)
 and (source.role='open' or i.role='open' or case source.role when 'learn' then i.role='teach' when 'teach' then i.role='learn' when 'hire' then i.role='work' when 'work' then i.role='hire' when 'request' then i.role='offer' when 'offer' then i.role='request' when 'organize' then i.role='join' when 'join' then i.role in ('organize','join') else i.role=source.role end)
 and not(source.mode='online' and i.mode='in-person' or source.mode='in-person' and i.mode='online')
 and (source.starts_at is null and source.ends_at is null or (i.starts_at is not null and i.ends_at is not null and coalesce(source.starts_at,'-infinity')<i.ends_at and coalesce(source.ends_at,'infinity')>i.starts_at))
 and (source.mode<>'in-person' and i.mode<>'in-person' or (ctx.location is not null and c.location is not null and extensions.st_dwithin(ctx.location,c.location,least(ctx.radius_km,c.radius_km)*1000)) or ((ctx.location is null or c.location is null) and source.city<>'' and lower(source.city)=lower(i.city)))
 and (source.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(source.skills) s where not exists(select 1 from unnest(i.skills) cs where lower(cs)=lower(s))))
 and (i.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(i.skills) s where not exists(select 1 from unnest(source.skills) ss where lower(ss)=lower(s))))
 and (not nearby_only or (origin is not null and c.location is not null and extensions.st_dwithin(origin,c.location,radius*1000)) or (origin is null and city_filter<>'' and position(lower(btrim(city_filter)) in lower(i.city))>0))
 )
 select to_jsonb(i)||jsonb_build_object('profile',to_jsonb(p),'is_online',online),
 coalesce(semantic,0),
 case when origin is not null and location is not null then round((extensions.st_distance(origin,location)/1000)::numeric,0)::double precision end,
 case when semantic>=min_similarity then 'semantic' else 'keyword' end
 from candidates where semantic>=greatest(.1,least(.99,min_similarity)) or (keyword and (semantic is null or semantic>=greatest(.1,min_similarity-.15)))
 order by online desc,(i).created_at desc,(i).id asc limit 30 offset page_offset;
end;
$$;

create or replace function public.nearby_intents(lat double precision,lng double precision,radius double precision default 25) returns table(intent jsonb,distance_km double precision) language sql stable security definer set search_path='' as $$
 select to_jsonb(i)||jsonb_build_object('profile',to_jsonb(p),'is_online',coalesce(pr.last_seen_at>now()-interval '90 seconds',false)),
 round((extensions.st_distance(c.location,extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography)/1000)::numeric,0)::double precision
 from public.intents i join public.profiles p on p.id=i.user_id join private.intent_context c on c.intent_id=i.id left join public.member_presence pr on pr.user_id=i.user_id
 where auth.uid() is not null and lat between -90 and 90 and lng between -180 and 180 and radius between 1 and 500 and i.status='active' and (i.ends_at is null or i.ends_at>now()) and public.can_view_profile(i.user_id)
 and extensions.st_dwithin(c.location,extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,radius*1000)
 order by coalesce(pr.last_seen_at>now()-interval '90 seconds',false) desc,i.created_at desc,i.id asc limit 100;
$$;

revoke all on function public.update_presence(uuid,boolean),public.discover_matches(uuid,boolean,double precision,double precision,double precision,text,double precision,integer) from public,anon;
grant execute on function public.update_presence(uuid,boolean),public.discover_matches(uuid,boolean,double precision,double precision,double precision,text,double precision,integer) to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
alter publication supabase_realtime add table public.feed_events,public.member_presence;
commit;
