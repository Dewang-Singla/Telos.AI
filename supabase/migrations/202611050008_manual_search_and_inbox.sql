-- Searches remain private drafts until explicitly saved.
begin;

create function private.find_people_core(source public.intents,ctx private.intent_context,nearby_only boolean,lat double precision,lng double precision,radius double precision,city_filter text,min_similarity double precision,page_offset integer)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare terms text[]; origin extensions.geography; source_role text;
begin
 if auth.uid() is null or source.user_id is distinct from auth.uid() then raise exception 'Search not available'; end if;
 if page_offset<0 or page_offset>10000 or radius not between 1 and 500 then raise exception 'Invalid discovery parameters'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 terms:=private.match_terms(source.description||' '||array_to_string(source.tags,' '));
 source_role:=private.effective_intent_role(source.role,source.description);
 origin:=case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography when length(btrim(city_filter))>0 then null else ctx.location end;
 if nearby_only and origin is null and length(btrim(city_filter))=0 then raise exception 'Choose a location'; end if;
 return query with candidates as (
  select p as person,i.user_id,i.id,i.created_at,c.location,i.description,i.show_in_matches,
   (not p.is_demo and coalesce(pr.last_seen_at>now()-interval '90 seconds',false)) as online,
   private.effective_intent_role(i.role,i.description) as candidate_role,
   private.role_affinity(source_role,private.effective_intent_role(i.role,i.description)) as affinity,
   case when ctx.embedding is not null and c.embedding is not null and ctx.embedding_model=c.embedding_model then 1-(c.embedding operator(extensions.<=>) ctx.embedding) else null end as semantic,
   exists(select 1 from unnest(private.match_terms(i.description||' '||array_to_string(i.tags,' '))) word where word=any(terms)) as keyword
  from public.intents i join public.profiles p on p.id=i.user_id left join private.intent_context c on c.intent_id=i.id left join public.member_presence pr on pr.user_id=i.user_id
  where i.user_id<>auth.uid() and i.status='active' and (i.ends_at is null or i.ends_at>now()) and (source.ends_at is null or source.ends_at>now()) and public.can_view_profile(i.user_id)
  and not(source.mode='online' and i.mode='in-person' or source.mode='in-person' and i.mode='online')
  and (source.starts_at is null and source.ends_at is null or (i.starts_at is not null and i.ends_at is not null and coalesce(source.starts_at,'-infinity')<i.ends_at and coalesce(source.ends_at,'infinity')>i.starts_at))
  and (source.mode<>'in-person' and i.mode<>'in-person' or (ctx.location is not null and c.location is not null and extensions.st_dwithin(ctx.location,c.location,least(ctx.radius_km,c.radius_km)*1000)) or ((ctx.location is null or c.location is null) and source.city<>'' and lower(source.city)=lower(i.city)))
  and (not nearby_only or (origin is not null and c.location is not null and extensions.st_dwithin(origin,c.location,radius*1000)) or (origin is null and city_filter<>'' and position(lower(btrim(city_filter)) in lower(i.city))>0))
 ), qualified as (
  select * from candidates q where affinity>0
  -- Hard provider skill constraints apply to complementary providers, not fellow learners.
  and (affinity<>3 or source_role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(source.skills) s where not exists(select 1 from public.intents i,unnest(i.skills) cs where i.id=q.id and lower(cs)=lower(s))))
  and (affinity<>3 or candidate_role not in ('hire','learn','request','organize') or not exists(select 1 from public.intents i,unnest(i.skills) s where i.id=q.id and not exists(select 1 from unnest(source.skills) ss where lower(ss)=lower(s))))
  and (semantic>=greatest(.1,least(.99,min_similarity)) or (keyword and (semantic is null or semantic>=greatest(.1,min_similarity-.15))))
 ), people as (
  select distinct on(user_id) * from qualified order by user_id,affinity desc,created_at desc,id asc
 )
 select to_jsonb(person),online,case when nearby_only and origin is not null and location is not null then round((extensions.st_distance(origin,location)/1000)::numeric,0)::double precision end,
 description
 from people order by online desc,affinity desc,created_at desc,id asc limit 30 offset page_offset;
end;
$$;

create table private.people_searches (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 payload jsonb not null,
 location extensions.geography(point,4326),
 radius_km double precision not null check(radius_km between 1 and 500),
 embedding extensions.vector(768), embedding_model text,
 expires_at timestamptz not null default now()+interval '24 hours'
);
create index people_search_owner on private.people_searches(user_id,expires_at);
alter table private.people_searches enable row level security;
revoke all on private.people_searches from public,anon,authenticated;

create or replace function public.consume_rate_limit(action_name text,maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b bigint:=floor(extract(epoch from now())/3600); lim integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports','presence','posts','comments','follows','searches') then raise exception 'Unknown rate limit action'; end if;
 lim:=case action_name when 'ai' then 20 when 'intents' then 20 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 when 'presence' then 600 when 'posts' then 30 when 'comments' then 120 when 'follows' then 120 when 'searches' then 120 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
end;
$$;

create function public.create_people_search(payload jsonb,lat double precision default null,lng double precision default null,radius double precision default 25,values_json jsonb default null,model_name text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare source public.intents; result uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Create your profile first'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 or radius is null or radius not between 1 and 500 then raise exception 'Invalid coordinates'; end if;
 source:=jsonb_populate_record(null::public.intents,payload||jsonb_build_object('user_id',auth.uid(),'status','active'));
 if (length(btrim(source.description)) between 3 and 3000 and length(source.title) between 3 and 120
  and source.role in ('open','socialize','collaborate','learn','teach','hire','work','request','offer','organize','join')
  and source.mode in ('online','in-person','hybrid') and length(source.city)<=100
  and public.valid_labels(source.tags) and public.valid_labels(source.skills)
  and source.participants between 1 and 1000
  and (source.starts_at is null or source.ends_at is null or source.ends_at>source.starts_at)
  and (source.mode='online' or length(btrim(source.city))>0 or lat is not null)) is not true then raise exception 'Invalid search'; end if;
 if not public.consume_rate_limit('searches') then raise exception 'Hourly search limit reached'; end if;
 -- This lock bounds retained drafts even when several tabs submit together.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':draft-search',0));
 delete from private.people_searches where user_id=auth.uid() and (expires_at<now() or id in (select id from private.people_searches where user_id=auth.uid() order by expires_at desc,id limit all offset 19));
 insert into private.people_searches(user_id,payload,location,radius_km,embedding,embedding_model)
 values(auth.uid(),to_jsonb(source),case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius,values_json::text::extensions.vector,left(model_name,100)) returning id into result;
 return result;
end;
$$;

create function public.search_people(search_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare draft private.people_searches; source public.intents; ctx private.intent_context;
begin
 select * into draft from private.people_searches where id=search_id and user_id=auth.uid() and expires_at>now();
 if draft.id is null then raise exception 'Search expired. Search again.'; end if;
 source:=jsonb_populate_record(null::public.intents,draft.payload);
 ctx.location:=draft.location; ctx.radius_km:=draft.radius_km; ctx.embedding:=draft.embedding; ctx.embedding_model:=draft.embedding_model;
 return query select * from private.find_people_core(source,ctx,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset);
end;
$$;

-- Saved searches and unsaved drafts use exactly the same qualification rules.
create or replace function public.find_people(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare source public.intents; ctx private.intent_context;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active';
 if source.id is null then raise exception 'Intention not found'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
 return query select * from private.find_people_core(source,ctx,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset);
end;
$$;

-- Chat alerts belong to the inbox. Keep connection notifications unchanged.
drop trigger message_notification on public.messages;
delete from public.notifications where href='/messages' and title='New message';
alter table public.conversation_members add column last_read_message_id uuid;
create index messages_unread on public.messages(conversation_id,created_at,id) include(sender_id);

create function public.mark_messages_read(cid uuid,last_message_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare cursor_message public.messages;
begin
 if not public.is_member(cid) then raise exception 'Conversation not found'; end if;
 select * into cursor_message from public.messages where id=last_message_id and conversation_id=cid;
 if cursor_message.id is null then raise exception 'Message not found'; end if;
 -- Acknowledge only the displayed cursor, never messages arriving after it.
 update public.conversation_members set last_read_at=cursor_message.created_at,last_read_message_id=cursor_message.id
 where conversation_id=cid and user_id=auth.uid()
 and (last_read_at,coalesce(last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid))<(cursor_message.created_at,cursor_message.id);
end;
$$;
revoke execute on function public.mark_conversation_read(uuid) from authenticated;

create function public.inbox() returns setof jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object(
 'conversation_members',(select jsonb_agg(jsonb_build_object('user_id',m.user_id,'last_read_at',m.last_read_at,'profile',case when public.can_view_profile(m.user_id) then (select to_jsonb(p) from public.profiles p where p.id=m.user_id) else null end)) from public.conversation_members m where m.conversation_id=c.id),
 'unread',(select count(*) from public.messages msg where msg.conversation_id=c.id and msg.sender_id<>auth.uid() and (msg.created_at,msg.id)>(own.last_read_at,coalesce(own.last_read_message_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))),
 'last_message',latest.body,'last_message_at',coalesce(latest.created_at,c.created_at),
 'can_message',public.can_message(c.id))
 from public.conversations c join public.conversation_members own on own.conversation_id=c.id and own.user_id=auth.uid()
 left join lateral(select msg.body,msg.created_at from public.messages msg where msg.conversation_id=c.id order by msg.created_at desc,msg.id desc limit 1) latest on true
 where public.is_member(c.id) order by coalesce(latest.created_at,c.created_at) desc,c.id;
$$;
-- Read-cursor changes propagate across a user's tabs/devices.
alter publication supabase_realtime add table public.conversation_members;
revoke all on function public.create_people_search(jsonb,double precision,double precision,double precision,jsonb,text),public.search_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.mark_messages_read(uuid,uuid),public.inbox() from public,anon;
grant execute on function public.create_people_search(jsonb,double precision,double precision,double precision,jsonb,text),public.search_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.mark_messages_read(uuid,uuid),public.inbox() to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;

