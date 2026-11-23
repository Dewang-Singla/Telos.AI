-- Private feedback, connection outcomes and real-member pilot instrumentation.
-- Requires migrations 001-010. No existing content is removed.
begin;

create table private.discovery_feedback (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 source_id uuid not null references public.intents on delete cascade,
 source_hash text not null,
 candidate_id uuid not null references public.profiles on delete cascade,
 candidate_hash text not null,
 verdict text not null check(verdict in ('helpful','not_relevant')),
 reason text not null default '' check(reason in ('','different_goal','wrong_role','location','other')),
 updated_at timestamptz not null default now(),
 unique(user_id,source_hash,candidate_id,candidate_hash)
);
create table private.connection_outcomes (
 user_id uuid not null references auth.users on delete cascade,
 request_id uuid not null references public.connection_requests on delete cascade,
 outcome text not null check(outcome in ('useful','not_yet','not_a_fit')),
 updated_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
create table private.product_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users on delete cascade,
 event_name text not null check(event_name in ('invitation_sent','invitation_accepted','conversation_participated','connection_useful')),
 entity_id uuid not null,
 created_at timestamptz not null default now(),
 unique(user_id,event_name,entity_id)
);
create index product_events_time on private.product_events(created_at,event_name);
alter table private.discovery_feedback enable row level security;
alter table private.connection_outcomes enable row level security;
alter table private.product_events enable row level security;
revoke all on private.discovery_feedback,private.connection_outcomes,private.product_events from public,anon,authenticated;

create function private.product_limit(action_name text,maximum integer) returns void language plpgsql security definer set search_path='' as $$
declare n integer; b bigint:=floor(extract(epoch from now())/3600);
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into private.rate_limits values(auth.uid(),action_name,b,1)
 on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 if n>maximum then raise exception 'Hourly feedback limit reached'; end if;
end;
$$;

create function public.record_match_feedback(source_uuid uuid,candidate_uuid uuid,candidate_text text,verdict_text text,reason_text text default '') returns void language plpgsql security definer set search_path='' as $$
declare source public.intents;
begin
 select * into source from public.intents where id=source_uuid and user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now());
 if source.id is null or verdict_text is null or verdict_text not in ('helpful','not_relevant','clear') or reason_text is null or reason_text not in ('','different_goal','wrong_role','location','other') then raise exception 'Invalid match feedback'; end if;
 if candidate_uuid=auth.uid() or not public.can_view_profile(candidate_uuid) or not exists(
  select 1 from public.intents i where i.user_id=candidate_uuid and i.description=candidate_text and i.status='active' and (i.search_expires_at is null or i.search_expires_at>now())
 ) then raise exception 'Match no longer available'; end if;
 perform private.product_limit('discovery_feedback',120);
 if verdict_text='clear' then
  delete from private.discovery_feedback where user_id=auth.uid() and source_hash=md5(lower(source.description)||source.role) and candidate_id=candidate_uuid and candidate_hash=md5(candidate_text);
  return;
 end if;
 insert into private.discovery_feedback(user_id,source_id,source_hash,candidate_id,candidate_hash,verdict,reason)
 values(auth.uid(),source.id,md5(lower(source.description)||source.role),candidate_uuid,md5(candidate_text),verdict_text,case when verdict_text='helpful' then '' else reason_text end)
 on conflict(user_id,source_hash,candidate_id,candidate_hash) do update set source_id=excluded.source_id,verdict=excluded.verdict,reason=excluded.reason,updated_at=now();
end;
$$;

create function public.record_connection_outcome(request_uuid uuid,outcome_text text) returns void language plpgsql security definer set search_path='' as $$
declare req public.connection_requests; other_id uuid;
begin
 select * into req from public.connection_requests where id=request_uuid and status='accepted' and auth.uid() in (sender_id,recipient_id);
 other_id:=case when req.sender_id=auth.uid() then req.recipient_id else req.sender_id end;
 if req.id is null or not public.can_view_profile(other_id) or outcome_text is null or outcome_text not in ('useful','not_yet','not_a_fit') then raise exception 'Connection not available'; end if;
 perform private.product_limit('connection_outcome',120);
 insert into private.connection_outcomes values(auth.uid(),req.id,outcome_text,now())
 on conflict(user_id,request_id) do update set outcome=excluded.outcome,updated_at=now();
 if outcome_text='useful' and not exists(select 1 from public.profiles where id in (auth.uid(),other_id) and is_demo) then
  insert into private.product_events(user_id,event_name,entity_id) values(auth.uid(),'connection_useful',req.id) on conflict do nothing;
 end if;
end;
$$;

create function private.record_connection_event() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; target uuid; label text;
begin
 if TG_TABLE_NAME='messages' then
  actor:=new.sender_id;
  if exists(select 1 from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=new.conversation_id and p.is_demo) then return null; end if;
  insert into private.product_events(user_id,event_name,entity_id) values(actor,'conversation_participated',new.conversation_id) on conflict do nothing;
 else
  if TG_OP='INSERT' then actor:=new.sender_id;target:=new.recipient_id;label:='invitation_sent';
  elsif old.status<>'accepted' and new.status='accepted' then actor:=new.recipient_id;target:=new.sender_id;label:='invitation_accepted';
  else return null; end if;
  if exists(select 1 from public.profiles where id in (actor,target) and is_demo) then return null; end if;
  insert into private.product_events(user_id,event_name,entity_id) values(actor,label,new.id) on conflict do nothing;
 end if;
 return null;
end;
$$;
create trigger pilot_connection_event after insert or update on public.connection_requests for each row execute function private.record_connection_event();
create trigger pilot_conversation_event after insert on public.messages for each row execute function private.record_connection_event();

create function public.my_progress() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select jsonb_build_object(
  'active_intents',(select count(*) from public.intents where user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now())),
  'saved_intents',(select count(*) from public.intents where user_id=auth.uid() and is_saved),
  'sent_requests',(select count(*) from public.connection_requests r join public.profiles p on p.id=r.recipient_id where r.sender_id=auth.uid() and not p.is_demo),
  'accepted_requests',(select count(*) from public.connection_requests r join public.profiles p on p.id=case when r.sender_id=auth.uid() then r.recipient_id else r.sender_id end where auth.uid() in (r.sender_id,r.recipient_id) and r.status='accepted' and not p.is_demo),
  'conversations',(select count(distinct msg.conversation_id) from public.messages msg where msg.sender_id=auth.uid() and not exists(select 1 from public.conversation_members m join public.profiles p on p.id=m.user_id where m.conversation_id=msg.conversation_id and p.is_demo)),
  'helpful_matches',(select count(*) from private.discovery_feedback f join public.profiles p on p.id=f.candidate_id where f.user_id=auth.uid() and f.verdict='helpful' and not p.is_demo),
  'useful_connections',(select count(*) from private.connection_outcomes o join public.connection_requests r on r.id=o.request_id join public.profiles p on p.id=case when r.sender_id=auth.uid() then r.recipient_id else r.sender_id end where o.user_id=auth.uid() and o.outcome='useful' and not p.is_demo),
  'connections',coalesce((select jsonb_agg(row_to_json(item) order by item.connected_at desc) from (
   select r.id,p.name,p.username,p.is_demo,coalesce(c.created_at,r.created_at) as connected_at,o.outcome,c.id as conversation_id
   from public.connection_requests r join public.profiles p on p.id=case when r.sender_id=auth.uid() then r.recipient_id else r.sender_id end
   left join public.conversations c on c.request_id=r.id left join private.connection_outcomes o on o.request_id=r.id and o.user_id=auth.uid()
   where auth.uid() in (r.sender_id,r.recipient_id) and r.status='accepted' and not p.is_demo and public.can_view_profile(p.id)
   order by coalesce(c.created_at,r.created_at) desc,r.id limit 30
  ) item),'[]'::jsonb)
 ) into result;
 return result;
end;
$$;

create or replace function private.find_people_core(source public.intents,ctx private.intent_context,nearby_only boolean,lat double precision,lng double precision,radius double precision,city_filter text,min_similarity double precision,page_offset integer)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare terms text[]; origin extensions.geography; source_role text;
begin
 if auth.uid() is null or source.user_id is distinct from auth.uid() then raise exception 'Search not available'; end if;
 if page_offset<0 or page_offset>10000 or radius not between 1 and 500 then raise exception 'Invalid discovery parameters'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 terms:=array(select term from unnest(private.match_terms(source.description)) term where not term=any(private.match_terms(source.city)));
 source_role:=private.effective_intent_role(source.role,source.description);
 origin:=case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography when length(btrim(city_filter))>0 then null else ctx.location end;
 if nearby_only and origin is null and length(btrim(city_filter))=0 then raise exception 'Choose a location'; end if;
 return query with candidates as (
  select p as person,i.user_id,i.id,i.created_at,c.location,i.description,i.show_in_matches,
   (not p.is_demo and coalesce(pr.last_seen_at>now()-interval '90 seconds',false)) as online,
   private.effective_intent_role(i.role,i.description) as candidate_role,
   private.role_affinity(source_role,private.effective_intent_role(i.role,i.description)) as affinity,
   case when ctx.embedding is not null and c.embedding is not null and ctx.embedding_model=c.embedding_model then 1-(c.embedding operator(extensions.<=>) ctx.embedding) else null end as semantic,
   private.context_overlap(terms,private.match_terms(i.description),source_role,private.effective_intent_role(i.role,i.description)) as lexical,
   private.topic_conflict(terms,private.match_terms(i.description)) as conflict
  from public.intents i join public.profiles p on p.id=i.user_id left join private.intent_context c on c.intent_id=i.id left join public.member_presence pr on pr.user_id=i.user_id
  where i.user_id<>auth.uid() and i.status='active' and (i.search_expires_at is null or i.search_expires_at>now()) and (i.ends_at is null or i.ends_at>now()) and (source.ends_at is null or source.ends_at>now()) and public.can_view_profile(i.user_id)
  and not(source.mode='online' and i.mode='in-person' or source.mode='in-person' and i.mode='online')
  and coalesce(source.starts_at,'-infinity')<coalesce(i.ends_at,'infinity') and coalesce(source.ends_at,'infinity')>coalesce(i.starts_at,'-infinity')
  and (nearby_only or (source.mode<>'in-person' and i.mode<>'in-person') or (ctx.location is not null and c.location is not null and extensions.st_dwithin(ctx.location,c.location,least(ctx.radius_km,c.radius_km)*1000)) or ((ctx.location is null or c.location is null) and source.city<>'' and private.normal_city(source.city)=private.normal_city(i.city)))
  and (not nearby_only or (origin is not null and c.location is not null and extensions.st_dwithin(origin,c.location,radius*1000)) or (origin is null and city_filter<>'' and private.normal_city(city_filter)=private.normal_city(i.city)))
 ), qualified as (
  select * from candidates q where affinity>0 and not conflict
  -- Hard provider skill constraints apply to complementary providers, not fellow learners.
  and (affinity<>3 or source_role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(source.skills) s where not exists(select 1 from public.intents i,unnest(i.skills) cs where i.id=q.id and lower(cs)=lower(s))))
  and (affinity<>3 or candidate_role not in ('hire','learn','request','organize') or not exists(select 1 from public.intents i,unnest(i.skills) s where i.id=q.id and not exists(select 1 from unnest(source.skills) ss where lower(ss)=lower(s))))
  and (lexical>=.3 or semantic>=greatest(.82,least(.97,min_similarity)))
  and not exists(select 1 from private.discovery_feedback f where f.user_id=auth.uid() and f.source_hash=md5(lower(source.description)||source.role) and f.candidate_id=q.user_id and f.candidate_hash=md5(q.description) and f.verdict='not_relevant')
 ), people as (
  select distinct on(user_id) * from qualified order by user_id,affinity desc,lexical desc,semantic desc nulls last,created_at desc,id asc
 )
 select to_jsonb(person),online,case when nearby_only and origin is not null and location is not null then round((extensions.st_distance(origin,location)/1000)::numeric,0)::double precision end,
 description
 from people order by affinity desc,lexical desc,semantic desc nulls last,online desc,created_at desc,id asc limit 60 offset page_offset;
end;
$$;

create or replace function public.matching_context(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .82,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.intents; result jsonb;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now());
 if source.id is null then raise exception 'Search expired. Search again.'; end if;
 select jsonb_build_object('source',source.description,'candidates',coalesce(jsonb_agg((to_jsonb(candidate_row)-'position')||jsonb_build_object(
  'lexical_confidence',private.context_overlap(private.match_terms(source.description),private.match_terms(candidate_row.matched_intent),private.effective_intent_role(source.role,source.description),private.effective_intent_role('open',candidate_row.matched_intent)),
  'reviewed',r.relevant is not null,'relevant',r.relevant,'feedback',f.verdict) order by candidate_row.position),'[]'::jsonb)) into result
 from public.find_people(source_id,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset) with ordinality as candidate_row(profile,is_online,distance_km,matched_intent,position)
 left join private.match_reviews r on r.user_id=auth.uid() and r.source_hash=md5('v2:'||lower(source.description)||source.role) and r.candidate_id=(candidate_row.profile->>'id')::uuid and r.candidate_hash=md5(candidate_row.matched_intent) and r.expires_at>now()
 left join private.discovery_feedback f on f.user_id=auth.uid() and f.source_hash=md5(lower(source.description)||source.role) and f.candidate_id=(candidate_row.profile->>'id')::uuid and f.candidate_hash=md5(candidate_row.matched_intent);
 return result;
end;
$$;

revoke all on function public.record_match_feedback(uuid,uuid,text,text,text),public.record_connection_outcome(uuid,text),public.my_progress() from public,anon;
grant execute on function public.record_match_feedback(uuid,uuid,text,text,text),public.record_connection_outcome(uuid,text),public.my_progress() to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
