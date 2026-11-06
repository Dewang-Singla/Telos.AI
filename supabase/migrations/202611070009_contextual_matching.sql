-- Active searches are discoverable; saving only controls the owner's saved list.
begin;
alter table public.intents add column is_saved boolean not null default true;
alter table public.intents add column search_expires_at timestamptz;
create index active_search_expiry on public.intents(search_expires_at) where not is_saved;
grant update(is_saved) on public.intents to authenticated;
-- Only owner APIs list unsaved rows; normal profile display remains opt-in.

create function private.normal_city(value text) returns text language sql immutable set search_path='' as $$
 select case cleaned when 'bangalore' then 'bengaluru' when 'new delhi' then 'delhi' when 'sahibzada ajit singh nagar' then 'mohali' else cleaned end
 from (select btrim(regexp_replace(lower(split_part(coalesce(value,''),',',1)),'[^[:alnum:]]+',' ','g')) cleaned) c;
$$;
create or replace function private.match_terms(content text) returns text[] language sql immutable set search_path='' as $$
 with normalized as (
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(content),'\m(not|except|excluding|without)[[:space:]]+(interested in[[:space:]]+|looking for[[:space:]]+|learning[[:space:]]+|teaching[[:space:]]+)?[[:alnum:]_+#]+\M',' ','g'),
 '\m(graphic[ -]+design(er|ers|ing)?|graphics[ -]+design)\M',' graphic_design ','g'),
 '\m(video[ -]+edit(or|ors|ing)?|edit(ing)?[ -]+videos?)\M',' video_editing ','g'),
 '\m(websites?|front[ -]?end|full[ -]?stack|web[ -]+develop(ment|er|ers)?)\M',' webdev ','g'),
 '\m(six[ -]+string)\M',' guitar ','g') as text
 ), words as (
 select case term when 'guitars' then 'guitar' when 'guitarist' then 'guitar' when 'robots' then 'robotics' when 'robot' then 'robotics' when 'robotic' then 'robotics' when 'js' then 'javascript' when 'py' then 'python' when 'photographer' then 'photography' when 'photographers' then 'photography' when 'soccer' then 'football' when 'caterer' then 'catering' when 'chef' then 'catering' when 'mern' then 'react' else term end word
 from normalized,unnest(private.intent_terms(text)) term
 where term<>all(array['online','offline','remote','virtual','hybrid','near','nearby','local','available','availability','weekend','weekends','today','tomorrow','evening','evenings','morning','mornings','please','together','session','sessions','tutor','tutors','teacher','teachers','trainer','trainers','coach','coaches','coaching','instructor','instructors','mentor','mentors','teach','teaching','tutoring','learn','learning','learner','learners','student','students','beginner','beginners','lesson','lessons','class','classes','hire','hiring','recruiting','recruiter','job','jobs','work','working','employment','opportunity','opportunities','offer','offering','request','help','seeking','searching','interested','interest','also','could','able','connect','connection','looking','person','skills','experience','experienced','project','projects','basic','basics','practise','practice','practical','small','short','conversation','discuss','schedule','schedules','started','happy','good','best','time','someone','anybody','anywhere','everyone','anything','something','thing','things','really','much','more','new','great','love','love','looking','build','building','create','creating','make','making','developer','developers','development','programming','coding','programmer','programmers','professional','professionals','friendly','patient','relaxed','accessible','application','applications','service','services','partner','partners','need','needs','collaborate','collaboration','group','organizing','organising','join','joining','want','wants'])
 ) select coalesce(array_agg(distinct stem),'{}'::text[]) from words,lateral(select coalesce((pg_catalog.ts_lexize('pg_catalog.english_stem'::regdictionary,word))[1],word) stem) s where length(stem)>1;
$$;

create function private.topic_conflict(a text[],b text[]) returns boolean language sql immutable set search_path='' as $$
 with anchors as (select array['guitar','piano','violin','drum','python','java','javascript','typescript','csharp','react','vue','angular','video_edit','graphic_design','football','badminton','chess','cricket','basketbal','robot','robotics','calculus','english','french','german','plumb','cater','yoga','photographi','photography']::text[] words),
 aa as(select coalesce(array_agg(x),'{}'::text[]) words from unnest(a) x,anchors where x=any(anchors.words)),
 bb as(select coalesce(array_agg(x),'{}'::text[]) words from unnest(b) x,anchors where x=any(anchors.words))
 select cardinality(aa.words)>0 and cardinality(bb.words)>0 and not aa.words&&bb.words from aa,bb;
$$;
create function private.topic_overlap(a text[],b text[]) returns double precision language sql immutable set search_path='' as $$
 select case when cardinality(a)=0 then 0 else (select count(*)::double precision from unnest(a) x where x=any(b))/cardinality(a) end;
$$;

-- Cache only owner-scoped derived artifacts and text-pair decisions, never profile data.
create table private.intent_artifacts(user_id uuid not null references auth.users on delete cascade,request_key text not null,artifact jsonb not null check(octet_length(artifact::text)<=100000),expires_at timestamptz not null default now()+interval '24 hours',primary key(user_id,request_key));
alter table private.intent_artifacts enable row level security;
create table private.match_reviews(user_id uuid not null references auth.users on delete cascade,source_hash text not null,candidate_id uuid not null references public.profiles on delete cascade,candidate_hash text not null,relevant boolean not null,expires_at timestamptz not null default now()+interval '24 hours',primary key(user_id,source_hash,candidate_id,candidate_hash));
alter table private.match_reviews enable row level security;
revoke all on private.intent_artifacts,private.match_reviews from public,anon,authenticated;
create function public.get_intent_artifact(request_key text) returns jsonb language sql stable security definer set search_path='' as $$
 select artifact from private.intent_artifacts a where a.user_id=auth.uid() and a.request_key=get_intent_artifact.request_key and expires_at>now();
$$;
create function public.put_intent_artifact(request_key text,artifact jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or length(request_key)<>64 then raise exception 'Invalid cache key'; end if;
 delete from private.intent_artifacts a where a.user_id=auth.uid() and (expires_at<now() or a.request_key in(select b.request_key from private.intent_artifacts b where b.user_id=auth.uid() order by expires_at desc limit all offset 59));
 insert into private.intent_artifacts values(auth.uid(),request_key,artifact,now()+interval '24 hours') on conflict on constraint intent_artifacts_pkey do update set artifact=excluded.artifact,expires_at=excluded.expires_at;
end;
$$;
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
  if result is not null then update public.intents set is_saved=true,search_expires_at=null,title=payload->>'title' where id=result; return result; end if;
 end if;
 if intent_uuid is null then
  insert into public.intents(user_id,title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants,show_on_profile,show_in_matches)
  values(auth.uid(),payload->>'title',payload->>'description',payload->>'category',payload->>'role',payload->>'mode',coalesce(payload->>'city',''),array(select jsonb_array_elements_text(payload->'tags')),array(select jsonb_array_elements_text(payload->'skills')),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'participants')::int,coalesce((payload->>'show_on_profile')::boolean,false),true) returning id into result;
 else
  update public.intents set is_saved=true,search_expires_at=null,title=payload->>'title',description=payload->>'description',category=payload->>'category',role=payload->>'role',mode=payload->>'mode',city=payload->>'city',tags=array(select jsonb_array_elements_text(payload->'tags')),skills=array(select jsonb_array_elements_text(payload->'skills')),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,participants=(payload->>'participants')::int,show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false),show_in_matches=true,indexed_at=null where id=intent_uuid and user_id=auth.uid() returning id into result;
  if result is null then raise exception 'Intention not found'; end if;
 end if;
 insert into private.intent_context(intent_id,location,radius_km) values(result,case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius)
 on conflict(intent_id) do update set location=excluded.location,radius_km=excluded.radius_km,embedding=null,embedding_model=null;
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
 if cardinality(terms)=0 then return; end if;
 source_role:=private.effective_intent_role(source.role,source.description);
 origin:=case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography when length(btrim(city_filter))>0 then null else ctx.location end;
 if nearby_only and origin is null and length(btrim(city_filter))=0 then raise exception 'Choose a location'; end if;
 return query with candidates as (
  select p as person,i.user_id,i.id,i.created_at,c.location,i.description,i.show_in_matches,
   (not p.is_demo and coalesce(pr.last_seen_at>now()-interval '90 seconds',false)) as online,
   private.effective_intent_role(i.role,i.description) as candidate_role,
   private.role_affinity(source_role,private.effective_intent_role(i.role,i.description)) as affinity,
   case when ctx.embedding is not null and c.embedding is not null and ctx.embedding_model=c.embedding_model then 1-(c.embedding operator(extensions.<=>) ctx.embedding) else null end as semantic,
   private.topic_overlap(terms,private.match_terms(i.description)) as lexical,
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


create or replace function public.consume_rate_limit(action_name text,maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; b bigint:=floor(extract(epoch from now())/3600); lim integer;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports','presence','posts','comments','follows','searches','match_reviews') then raise exception 'Unknown rate limit action'; end if;
 lim:=case action_name when 'ai' then 20 when 'intents' then 120 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 when 'presence' then 600 when 'posts' then 30 when 'comments' then 120 when 'follows' then 120 when 'searches' then 120 when 'match_reviews' then 60 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
end;
$$;

create table private.search_generations(user_id uuid primary key references auth.users on delete cascade,generation bigint not null);
create table private.search_sessions(user_id uuid not null references auth.users on delete cascade,session_id uuid not null,version bigint not null,generation bigint not null,updated_at timestamptz not null default now(),primary key(user_id,session_id));
alter table private.search_generations enable row level security;
alter table private.search_sessions enable row level security;
revoke all on private.search_generations,private.search_sessions from public,anon,authenticated;
create function public.begin_people_search(session_uuid uuid,request_version bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare previous private.search_sessions; result bigint;
begin
 if auth.uid() is null or session_uuid is null or request_version not between 1 and 1000000000 then raise exception 'Invalid search request'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':save-intent',0));
 select * into previous from private.search_sessions where user_id=auth.uid() and session_id=session_uuid;
 if previous.version is not null and previous.version>=request_version then
  if previous.version=request_version and previous.generation=(select generation from private.search_generations where user_id=auth.uid()) then return previous.generation; end if;
  raise exception 'Search superseded.';
 end if;
 if not public.consume_rate_limit('searches') then raise exception 'Hourly search limit reached'; end if;
 insert into private.search_generations values(auth.uid(),1) on conflict(user_id) do update set generation=private.search_generations.generation+1 returning generation into result;
 delete from private.search_sessions where user_id=auth.uid() and updated_at<now()-interval '24 hours';
 insert into private.search_sessions values(auth.uid(),session_uuid,request_version,result,now()) on conflict(user_id,session_id) do update set version=excluded.version,generation=excluded.generation,updated_at=now();
 return result;
end;
$$;
drop function public.create_people_search(jsonb,double precision,double precision,double precision,jsonb,text);
create function public.create_people_search(payload jsonb,lat double precision default null,lng double precision default null,radius double precision default 25,values_json jsonb default null,model_name text default null,request_generation bigint default null) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; saved_ids uuid[]; source public.intents;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if request_generation is null and not public.consume_rate_limit('searches') then raise exception 'Hourly search limit reached'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':save-intent',0));
 if request_generation is not null and request_generation is distinct from (select generation from private.search_generations where user_id=auth.uid()) then raise exception 'Search superseded.'; end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into saved_ids from public.intents where user_id=auth.uid() and is_saved;
 update public.intents set status='paused' where user_id=auth.uid() and not is_saved and status='active';
 delete from public.intents where user_id=auth.uid() and not is_saved and search_expires_at<now();
 update public.intents set search_expires_at=now() where user_id=auth.uid() and not is_saved and id in(select id from public.intents where user_id=auth.uid() and not is_saved and search_expires_at>now() order by created_at desc,id limit all offset 19);
 -- save_intent validates fields, coordinates and ownership at the database boundary.
 result:=public.save_intent(payload,null,lat,lng,radius);
 update public.intents set is_saved=(result=any(saved_ids)),search_expires_at=case when result=any(saved_ids) then null else now()+interval '24 hours' end where id=result;
 if values_json is not null then perform public.set_intent_embedding(result,values_json,model_name); end if;
 return result;
end;
$$;
-- Saved searches and unsaved drafts use exactly the same qualification rules.
create or replace function public.find_people(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language plpgsql stable security definer set search_path='' as $$
declare source public.intents; ctx private.intent_context;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now());
 if source.id is null then raise exception 'Intention not found'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
 return query select * from private.find_people_core(source,ctx,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset);
end;
$$;

create or replace function public.search_people(search_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
returns table(profile jsonb,is_online boolean,distance_km double precision,matched_intent text) language sql stable security definer set search_path='' as $$
 select * from public.find_people(search_id,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset);
$$;

create function public.matching_context(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .82,page_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.intents; result jsonb;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active' and (search_expires_at is null or search_expires_at>now());
 if source.id is null then raise exception 'Search expired. Search again.'; end if;
 select jsonb_build_object('source',source.description,'candidates',coalesce(jsonb_agg((to_jsonb(candidate_row)-'position')||jsonb_build_object(
  'lexical_confidence',private.topic_overlap(private.match_terms(source.description),private.match_terms(candidate_row.matched_intent)),
  'reviewed',r.relevant is not null,'relevant',r.relevant) order by candidate_row.position),'[]'::jsonb)) into result
 from public.find_people(source_id,nearby_only,lat,lng,radius,city_filter,min_similarity,page_offset) with ordinality as candidate_row(profile,is_online,distance_km,matched_intent,position)
 left join private.match_reviews r on r.user_id=auth.uid() and r.source_hash=md5(lower(source.description)||source.role) and r.candidate_id=(candidate_row.profile->>'id')::uuid and r.candidate_hash=md5(candidate_row.matched_intent) and r.expires_at>now();
 return result;
end;
$$;
create function public.review_people(source_id uuid,decisions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare source public.intents; decision jsonb;
begin
 select * into source from public.intents where id=source_id and user_id=auth.uid();
 if source.id is null or jsonb_typeof(decisions)<>'array' or jsonb_array_length(decisions)>60 then raise exception 'Invalid matching review'; end if;
 delete from private.match_reviews r where r.user_id=auth.uid() and (expires_at<now() or (r.source_hash,r.candidate_id,r.candidate_hash) in(select a.source_hash,a.candidate_id,a.candidate_hash from private.match_reviews a where a.user_id=auth.uid() order by expires_at desc limit all offset 1199));
 for decision in select value from jsonb_array_elements(decisions) loop
  if not exists(select 1 from public.intents i where i.user_id=(decision->>'id')::uuid and i.user_id<>auth.uid() and i.description=decision->>'text' and i.status='active' and (i.search_expires_at is null or i.search_expires_at>now()) and public.can_view_profile(i.user_id)) then continue; end if;
  insert into private.match_reviews(user_id,source_hash,candidate_id,candidate_hash,relevant)
  values(auth.uid(),md5(lower(source.description)||source.role),(decision->>'id')::uuid,md5(decision->>'text'),(decision->>'relevant')::boolean)
  on conflict(user_id,source_hash,candidate_id,candidate_hash) do update set relevant=excluded.relevant,expires_at=now()+interval '24 hours';
 end loop;
end;
$$;
revoke all on function public.begin_people_search(uuid,bigint),public.create_people_search(jsonb,double precision,double precision,double precision,jsonb,text,bigint),public.matching_context(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.review_people(uuid,jsonb),public.get_intent_artifact(text),public.put_intent_artifact(text,jsonb) from public,anon;
grant execute on function public.begin_people_search(uuid,bigint),public.create_people_search(jsonb,double precision,double precision,double precision,jsonb,text,bigint),public.matching_context(uuid,boolean,double precision,double precision,double precision,text,double precision,integer),public.review_people(uuid,jsonb),public.get_intent_artifact(text),public.put_intent_artifact(text,jsonb) to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
