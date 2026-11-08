-- Compatible broad offers and stable saves. Requires migration 009.
begin;

create table private.intent_request_keys (
 user_id uuid not null references auth.users on delete cascade,
 request_key text not null,
 intent_id uuid not null references public.intents on delete cascade,
 primary key(user_id,request_key)
);
alter table private.intent_request_keys enable row level security;
revoke all on private.intent_request_keys from public,anon,authenticated;

-- Keep the validated write implementation and wrap it with a stable input identity.
alter function public.save_intent(jsonb,uuid,double precision,double precision,double precision) set schema private;
alter function private.save_intent(jsonb,uuid,double precision,double precision,double precision) rename to write_intent;
create function public.save_intent(payload jsonb,intent_uuid uuid default null,lat double precision default null,lng double precision default null,radius double precision default 25) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; target uuid:=intent_uuid; input_key text:=payload->>'_request_key'; input jsonb:=coalesce(payload->'_input',payload); automatic boolean:=coalesce((payload->>'_automatic')::boolean,false);
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if input_key is not null and input_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request identity'; end if;
 if input_key is null then input_key:=md5((payload-'title'-'description'-'category')::text||lower(regexp_replace(btrim(payload->>'description'),'[[:space:]]+',' ','g'))||coalesce(lat::text,'')||coalesce(lng::text,'')||radius::text); end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':save-intent',0));
 if target is null then
  select i.id into target from public.intents i left join private.intent_context c on c.intent_id=i.id
  left join private.intent_request_keys k on k.user_id=auth.uid() and k.request_key=input_key and k.intent_id=i.id
  where i.user_id=auth.uid() and i.status<>'completed' and (not i.is_saved or i.status='active')
   and lower(regexp_replace(btrim(i.description),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(payload->>'description'),'[[:space:]]+',' ','g'))
   and (automatic and input->>'role'='open' or i.role=payload->>'role')
   and (automatic and input->>'mode'='hybrid' or i.mode=payload->>'mode')
   and lower(btrim(i.city))=lower(btrim(coalesce(payload->>'city','')))
   and (automatic and jsonb_array_length(input->'tags')=0 or i.tags=array(select jsonb_array_elements_text(payload->'tags')))
   and (automatic and jsonb_array_length(input->'skills')=0 or i.skills=array(select jsonb_array_elements_text(payload->'skills')))
   and i.starts_at is not distinct from (payload->>'starts_at')::timestamptz
   and i.ends_at is not distinct from (payload->>'ends_at')::timestamptz
   and i.participants=(payload->>'participants')::integer
   and i.show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false)
   and coalesce(c.radius_km,25)=radius
   and ((lat is null and c.location is null) or (lat is not null and c.location is not null and extensions.st_equals(c.location::extensions.geometry,extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326))))
  order by (k.intent_id is not null) desc,i.is_saved desc,i.created_at asc,i.id limit 1;
 end if;
 result:=private.write_intent(payload,target,lat,lng,radius);
 if intent_uuid is null then update public.intents set status='active' where id=result and user_id=auth.uid(); end if;
 insert into private.intent_request_keys values(auth.uid(),input_key,result)
 on conflict on constraint intent_request_keys_pkey do update set intent_id=excluded.intent_id;
 return result;
end;
$$;
revoke all on function public.save_intent(jsonb,uuid,double precision,double precision,double precision) from public,anon;
grant execute on function public.save_intent(jsonb,uuid,double precision,double precision,double precision) to authenticated;

create or replace function private.effective_intent_role(explicit_role text,content text) returns text language plpgsql immutable set search_path='' as $$
declare t text:=lower(content);
begin
 if explicit_role in ('open','hire','work','request','offer','organize','join') and t ~ '\mvolunteer(s|ing)?\M' then
  if t ~ '\m(need|seek|seeking|want|looking for|recruit|recruiting)[[:space:]]+((a|an|some|more|few|many)[[:space:]]+)?volunteers?\M|\m(organizing|organising|hosting)\M' then return 'organize'; end if;
  if t ~ '\m(willing|available|ready|want|wish|looking|seeking|join|volunteering)\M|\mi[[:space:]]+(can[[:space:]]+)?volunteer\M' then return 'join'; end if;
 end if;
 if explicit_role<>'open' then return explicit_role; end if;
 if t ~ '\m(hiring|recruiting|recruiter|vacancy|vacancies)\M|\mlooking to hire\M' then return 'hire'; end if;
 if t ~ '\m(looking|searching|seeking|need|want)\M.{0,55}\m(job|jobs|employment|internship|position|work|opportunities)\M|\m(open to work|job seeker|available for hire|available for work|seeking a role)\M' then return 'work'; end if;
 if t ~ '\m(looking|searching|need|seeking|want)\M.{0,50}\m(developer|designer|engineer|employee|candidate|freelancer|intern|staff)\M' then return 'hire'; end if;
 if t ~ '\mi (can |want to |would like to )?(teach|tutor|mentor)\M|\mi am teaching\M|\mi (give|provide|offer)\M.{0,35}\m(lessons|classes|tutoring|coaching)\M|\m(offering|offer)\M.{0,35}\m(lessons|tutoring|coaching|classes)\M|\m(tutor|teacher|trainer|mentor|coach|instructor)\M.{0,30}\m(available|offering)\M|\mi am (a |an )?([[:alpha:]]+ ){0,3}(tutor|teacher|trainer|mentor|coach|instructor)\M' then return 'teach'; end if;
 if t ~ '\m(learn|learning|learner|student|beginner|beginners|tutor|teacher|trainer|mentor|coach|instructor)\M|\m(need|looking|searching|seeking|want)\M.{0,80}\m(teach|lessons|coaching)\M' then return 'learn'; end if;
 if t ~ '\m(organizing|organising|hosting)\M' then return 'organize'; end if;
 if t ~ '\m(join|joining|attend|attending)\M' then return 'join'; end if;
 if t ~ '\m(i can help|i offer|offering|available for rent|available to help)\M' then return 'offer'; end if;
 if t ~ '\m(need|looking|seeking|want|searching)\M.{0,60}\m(help|repair|plumber|electrician|ride|service|borrow|assistance)\M|\m(borrow|borrowing)\M' then return 'request'; end if;
 if t ~ '\m(collaborate|collaboration|cofounder|team up|build together)\M' then return 'collaborate'; end if;
 if t ~ '\m(friends|friendship|hang out|meet people)\M' then return 'socialize'; end if;
 return 'open';
end;
$$;

alter function private.match_terms(text) rename to base_match_terms;
create function private.match_terms(content text) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(term),'{}'::text[]) from unnest(private.base_match_terms(content)) term where term<>all(array['will','willing','readi','ready']);
$$;
create function private.context_overlap(a text[],b text[],source_role text,candidate_role text) returns double precision language sql immutable set search_path='' as $$
 select greatest(private.topic_overlap(a,b),case when private.role_affinity(source_role,candidate_role)=3 and private.topic_overlap(b,a)>=.8 then .5 else 0 end);
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
 ), people as (
  select distinct on(user_id) * from qualified order by user_id,affinity desc,lexical desc,semantic desc nulls last,created_at desc,id asc
 )
 select to_jsonb(person),online,case when nearby_only and origin is not null and location is not null then round((extensions.st_distance(origin,location)/1000)::numeric,0)::double precision end,
 description
 from people order by online desc,affinity desc,created_at desc,id asc limit 60 offset page_offset;
end;
$$;



create or replace function public.matching_context(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .82,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.intents; result jsonb;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now());
 if source.id is null then raise exception 'Search expired. Search again.'; end if;
 select jsonb_build_object('source',source.description,'candidates',coalesce(jsonb_agg((to_jsonb(candidate_row)-'position')||jsonb_build_object(
  'lexical_confidence',private.context_overlap(private.match_terms(source.description),private.match_terms(candidate_row.matched_intent),private.effective_intent_role(source.role,source.description),private.effective_intent_role('open',candidate_row.matched_intent)),
  'reviewed',r.relevant is not null,'relevant',r.relevant) order by candidate_row.position),'[]'::jsonb)) into result
 from public.find_people(source_id,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset) with ordinality as candidate_row(profile,is_online,distance_km,matched_intent,position)
 left join private.match_reviews r on r.user_id=auth.uid() and r.source_hash=md5('v2:'||lower(source.description)||source.role) and r.candidate_id=(candidate_row.profile->>'id')::uuid and r.candidate_hash=md5(candidate_row.matched_intent) and r.expires_at>now();
 return result;
end;
$$;

create or replace function public.review_people(source_id uuid,decisions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare source public.intents; decision jsonb;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid();
 if source.id is null or jsonb_typeof(decisions)<>'array' or jsonb_array_length(decisions)>60 then raise exception 'Invalid matching review'; end if;
 delete from private.match_reviews r where r.user_id=auth.uid() and (expires_at<now() or (r.source_hash,r.candidate_id,r.candidate_hash) in(select a.source_hash,a.candidate_id,a.candidate_hash from private.match_reviews a where a.user_id=auth.uid() order by expires_at desc limit all offset 1199));
 for decision in select value from jsonb_array_elements(decisions) loop
  if not exists(select 1 from public.intents i where i.user_id=(decision->>'id')::uuid and i.user_id<>auth.uid() and i.description=decision->>'text' and i.status='active' and (i.search_expires_at is null or i.search_expires_at>now()) and public.can_view_profile(i.user_id)) then continue; end if;
  insert into private.match_reviews(user_id,source_hash,candidate_id,candidate_hash,relevant)
  values(auth.uid(),md5('v2:'||lower(source.description)||source.role),(decision->>'id')::uuid,md5(decision->>'text'),(decision->>'relevant')::boolean)
  on conflict(user_id,source_hash,candidate_id,candidate_hash) do update set relevant=excluded.relevant,expires_at=now()+interval '24 hours';
 end loop;
end;
$$;

revoke all on all functions in schema private from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
