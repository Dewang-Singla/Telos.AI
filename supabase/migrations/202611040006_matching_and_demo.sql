begin;

-- Existing searches keep their text hidden. New app searches explicitly opt in.
alter table public.intents add column show_in_matches boolean not null default false;
grant update(show_in_matches) on public.intents to authenticated;
alter table public.profiles add column is_demo boolean not null default false;

create function private.guard_demo_marker() returns trigger language plpgsql set search_path='' as $$
begin
 if (TG_OP='INSERT' and new.is_demo) or (TG_OP='UPDATE' and new.is_demo is distinct from old.is_demo) then
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Demo marker is managed by the administrator'; end if;
 end if;
 return new;
end;
$$;
create trigger guard_demo_marker before insert or update on public.profiles for each row execute function private.guard_demo_marker();
create function private.keep_demo_offline() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.profiles where id=new.user_id and is_demo) then new.last_seen_at:='-infinity'::timestamptz; end if;
 return new;
end;
$$;
create trigger keep_demo_offline before insert or update on public.member_presence for each row execute function private.keep_demo_offline();

-- An explicit Details role wins. English rule-based inference covers the keyword path.
create function private.effective_intent_role(explicit_role text,content text) returns text language plpgsql immutable set search_path='' as $$
declare t text:=lower(content);
begin
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
create function private.role_affinity(a text,b text) returns integer language sql immutable set search_path='' as $$
 select case
 when (a,b) in (('learn','teach'),('teach','learn'),('hire','work'),('work','hire'),('request','offer'),('offer','request'),('organize','join'),('join','organize')) then 3
 when a=b and a in ('learn','teach','join') then 1
 when a=b and a in ('socialize','collaborate','open') then 2
 when a='open' or b='open' then 1
 else 0 end;
$$;
create function private.match_terms(content text) returns text[] language sql immutable set search_path='' as $$
 select coalesce(array_agg(distinct case term when 'guitars' then 'guitar' when 'guitarist' then 'guitar' when 'developers' then 'developer' when 'development' then 'developer' when 'designers' then 'designer' else term end),'{}'::text[])
 from unnest(private.intent_terms(content)) term where term<>all(array['online','offline','remote','hybrid','near','nearby','local','available','availability','weekend','weekends','today','tomorrow','evening','evenings','morning','mornings','please','together','session','sessions','tutor','tutors','teacher','teachers','trainer','trainers','coach','coaches','coaching','instructor','instructors','mentor','mentors','teach','teaching','tutoring','learn','learning','learner','learners','student','students','beginner','beginners','lesson','lessons','class','classes','hire','hiring','recruiting','recruiter','job','jobs','work','working','employment','opportunity','opportunities','offer','offering','request','help','seeking','searching','interested','also','could','able','connect','connection','looking','person','skills','experience','experienced','project','projects','basic','basics','practise','practice','practical','small','short','conversation','discuss','schedule','schedules','started','happy','good','best','time']);
$$;

create or replace function public.save_intent(payload jsonb,intent_uuid uuid default null,lat double precision default null,lng double precision default null,radius double precision default 25) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Create your profile first'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 if intent_uuid is null then
  insert into public.intents(user_id,title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants,show_on_profile,show_in_matches)
  values(auth.uid(),payload->>'title',payload->>'description',payload->>'category',payload->>'role',payload->>'mode',coalesce(payload->>'city',''),array(select jsonb_array_elements_text(payload->'tags')),array(select jsonb_array_elements_text(payload->'skills')),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'participants')::int,coalesce((payload->>'show_on_profile')::boolean,false),coalesce((payload->>'show_in_matches')::boolean,false)) returning id into result;
 else
  update public.intents set title=payload->>'title',description=payload->>'description',category=payload->>'category',role=payload->>'role',mode=payload->>'mode',city=payload->>'city',tags=array(select jsonb_array_elements_text(payload->'tags')),skills=array(select jsonb_array_elements_text(payload->'skills')),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,participants=(payload->>'participants')::int,show_on_profile=coalesce((payload->>'show_on_profile')::boolean,false),show_in_matches=coalesce((payload->>'show_in_matches')::boolean,false),indexed_at=null where id=intent_uuid and user_id=auth.uid() returning id into result;
  if result is null then raise exception 'Intention not found'; end if;
 end if;
 insert into private.intent_context(intent_id,location,radius_km) values(result,case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius)
 on conflict(intent_id) do update set location=excluded.location,radius_km=excluded.radius_km,embedding=null,embedding_model=null;
 return result;
end;
$$;

drop function public.find_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer);
create function public.find_people(source_id uuid,nearby_only boolean default false,lat double precision default null,lng double precision default null,radius double precision default 25,city_filter text default '',min_similarity double precision default .55,page_offset integer default 0)
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
 case when show_in_matches then description else null end
 from people order by online desc,affinity desc,created_at desc,id asc limit 30 offset page_offset;
end;
$$;
revoke all on function public.find_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer) from public,anon;
grant execute on function public.find_people(uuid,boolean,double precision,double precision,double precision,text,double precision,integer) to authenticated;

-- Administrative demo provisioner. No passwords, email messages, or fake presence.
create function public.seed_demo_content(target_id uuid,content jsonb) returns void language plpgsql security definer set search_path='' as $$
declare item jsonb; previous_sub text; demo_profile jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Administrator required'; end if;
 if not exists(select 1 from auth.users where id=target_id and raw_app_meta_data->>'telos_demo'='v1') then raise exception 'Not a managed demo account'; end if;
 if exists(select 1 from public.profiles where id=target_id and not is_demo) then raise exception 'Refusing to replace a real profile'; end if;
 demo_profile:=content->'profile';
 if jsonb_array_length(content->'intents') not between 1 and 8 or jsonb_array_length(content->'posts') not between 1 and 8 then raise exception 'Invalid demo content'; end if;
 previous_sub:=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claim.sub',target_id::text,true);
 insert into public.profiles(id,username,name,bio,city,state,country,interests,skills,is_demo)
 values(target_id,demo_profile->>'username',demo_profile->>'name',demo_profile->>'bio',demo_profile->>'city',demo_profile->>'state',demo_profile->>'country',array(select jsonb_array_elements_text(demo_profile->'interests')),array(select jsonb_array_elements_text(demo_profile->'skills')),true)
 on conflict(id) do update set name=excluded.name,bio=excluded.bio,city=excluded.city,state=excluded.state,country=excluded.country,interests=excluded.interests,skills=excluded.skills;
 -- Re-running fills missing rows rather than duplicating posts/searches.
 for item in select value from jsonb_array_elements(content->'intents') loop
  if not exists(select 1 from public.intents where user_id=target_id and description=item->>'description') then
   perform public.save_intent(item,null,(item->>'latitude')::double precision,(item->>'longitude')::double precision,25);
  end if;
 end loop;
 for item in select value from jsonb_array_elements(content->'posts') loop
  if not exists(select 1 from public.posts where user_id=target_id and body=item->>'body') then
   insert into public.posts(user_id,body,visibility) values(target_id,item->>'body','public');
  end if;
 end loop;
 delete from private.presence_sessions where user_id=target_id;
 delete from public.member_presence where user_id=target_id;
 perform set_config('request.jwt.claim.sub',coalesce(previous_sub,''),true);
end;
$$;
revoke all on function public.seed_demo_content(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seed_demo_content(uuid,jsonb) to service_role;
revoke all on all functions in schema private from public,anon,authenticated;
notify pgrst, 'reload schema';
commit;
