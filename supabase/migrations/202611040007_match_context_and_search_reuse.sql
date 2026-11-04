-- Matching searches include the exact qualifying intent text. Profile display is separate.
begin;
alter table public.intents alter column show_in_matches set default true;
-- Keep the old column for compatibility; it no longer gates matching text.
create or replace function public.save_intent(payload jsonb,intent_uuid uuid default null,lat double precision default null,lng double precision default null,radius double precision default 25) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Create your profile first'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 if intent_uuid is null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':save-intent',0));
  select i.id into result from public.intents i left join private.intent_context c on c.intent_id=i.id
  where i.user_id=auth.uid() and i.status='active'
   and lower(regexp_replace(btrim(i.description),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(payload->>'description'),'[[:space:]]+',' ','g'))
   and i.category=payload->>'category' and i.role=payload->>'role' and i.mode=payload->>'mode' and i.city=coalesce(payload->>'city','')
   and i.tags=array(select jsonb_array_elements_text(payload->'tags')) and i.skills=array(select jsonb_array_elements_text(payload->'skills'))
   and i.starts_at is not distinct from (payload->>'starts_at')::timestamptz
   and i.ends_at is not distinct from (payload->>'ends_at')::timestamptz
   and i.participants=(payload->>'participants')::integer
   and i.show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false)
   and coalesce(c.radius_km,25)=radius
   and ((lat is null and c.location is null) or (lat is not null and c.location is not null and extensions.st_equals(c.location::extensions.geometry,extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326))))
  order by i.created_at desc,i.id asc limit 1;
  if result is not null then return result; end if;
 end if;
 if intent_uuid is null then
  insert into public.intents(user_id,title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants,show_on_profile,show_in_matches)
  values(auth.uid(),payload->>'title',payload->>'description',payload->>'category',payload->>'role',payload->>'mode',coalesce(payload->>'city',''),array(select jsonb_array_elements_text(payload->'tags')),array(select jsonb_array_elements_text(payload->'skills')),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'participants')::int,coalesce((payload->>'show_on_profile')::boolean,false),true) returning id into result;
 else
  update public.intents set title=payload->>'title',description=payload->>'description',category=payload->>'category',role=payload->>'role',mode=payload->>'mode',city=payload->>'city',tags=array(select jsonb_array_elements_text(payload->'tags')),skills=array(select jsonb_array_elements_text(payload->'skills')),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,participants=(payload->>'participants')::int,show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false),show_in_matches=true,indexed_at=null where id=intent_uuid and user_id=auth.uid() returning id into result;
  if result is null then raise exception 'Intention not found'; end if;
 end if;
 insert into private.intent_context(intent_id,location,radius_km) values(result,case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius)
 on conflict(intent_id) do update set location=excluded.location,radius_km=excluded.radius_km,embedding=null,embedding_model=null;
 return result;
end;
$$;

create or replace function public.find_people(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare source public.intents; ctx private.intent_context; terms text[]; origin extensions.geography; source_role text;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active';
 if source.id is null then raise exception 'Intention not found'; end if;
 if page_offset<0 or page_offset>10000 or radius not between 1 and 500 then raise exception 'Invalid discovery parameters'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
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

notify pgrst, 'reload schema';
commit;
