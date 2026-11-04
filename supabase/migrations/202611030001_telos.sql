-- Run once on a new Supabase project. Exact coordinates and vectors live in private schema.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists postgis with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function public.valid_labels(labels text[]) returns boolean language sql immutable strict set search_path='' as $$
 select cardinality(labels)<=12 and not exists(select 1 from unnest(labels) label where label is null or length(btrim(label)) not between 1 and 40);
$$;

create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
 name text not null check (length(name) between 2 and 70), bio text not null default '' check (length(bio)<=600),
 city text not null default '', interests text[] not null default '{}', skills text[] not null default '{}',
 avatar_url text, cover_url text, portfolio text not null default '', visibility text not null default 'public' check (visibility in ('public','connections')),
 created_at timestamptz not null default now()
);
create table public.intents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 title text not null check (length(title) between 5 and 120), description text not null check (length(description) between 10 and 3000),
 category text not null, role text not null check (role in ('socialize','collaborate','learn','teach','hire','work','request','offer','organize','join')),
 mode text not null check (mode in ('online','in-person','hybrid')), city text not null default '',
 tags text[] not null default '{}', skills text[] not null default '{}', starts_at timestamptz, ends_at timestamptz,
 participants integer not null default 2 check (participants between 1 and 1000),
 status text not null default 'active' check (status in ('active','paused','completed')), created_at timestamptz not null default now(),
 check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create table private.intent_context (
 intent_id uuid primary key references public.intents on delete cascade,
 location extensions.geography(point,4326), radius_km double precision not null default 25 check (radius_km between 1 and 500),
 embedding extensions.vector(768), embedding_model text
);
create index intent_geo on private.intent_context using gist(location);
create index intent_vectors on private.intent_context using hnsw (embedding extensions.vector_cosine_ops);
create index intent_feed on public.intents(status,created_at desc);
create index intent_owner on public.intents(user_id);
create table public.saved_intents (user_id uuid references public.profiles on delete cascade, intent_id uuid references public.intents on delete cascade, created_at timestamptz default now(), primary key(user_id,intent_id));
create table public.blocks (blocker_id uuid references public.profiles on delete cascade, blocked_id uuid references public.profiles on delete cascade, created_at timestamptz default now(), primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id));
create table public.connection_requests (
 id uuid primary key default gen_random_uuid(), sender_id uuid not null references public.profiles on delete cascade,
 recipient_id uuid not null references public.profiles on delete cascade, intent_id uuid references public.intents on delete set null,
 note text not null check(length(note) between 5 and 500), status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz default now(), check(sender_id<>recipient_id)
);
create unique index connection_unique_pending on public.connection_requests(least(sender_id,recipient_id),greatest(sender_id,recipient_id)) where status in ('pending','accepted');
create table public.conversations (id uuid primary key default gen_random_uuid(), request_id uuid unique not null references public.connection_requests on delete cascade, created_at timestamptz default now());
create table public.conversation_members (conversation_id uuid references public.conversations on delete cascade, user_id uuid references public.profiles on delete cascade, last_read_at timestamptz not null default now(), primary key(conversation_id,user_id));
create index members_user on public.conversation_members(user_id);
create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations on delete cascade, sender_id uuid not null references public.profiles on delete cascade, body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now());
create index messages_conversation on public.messages(conversation_id,created_at desc);
create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, title text not null, body text not null, href text not null default '/notifications', read_at timestamptz, created_at timestamptz not null default now());
create index notification_user on public.notifications(user_id,created_at desc);
create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles on delete cascade, target_id uuid not null references public.profiles on delete cascade, intent_id uuid references public.intents on delete set null, reason text not null check(length(reason) between 10 and 1000), created_at timestamptz default now());
create table private.rate_limits (user_id uuid not null references auth.users on delete cascade, action text not null, bucket bigint not null, count integer not null, primary key(user_id,action));

-- Apply validation at the database boundary as well as in the application.
alter table public.profiles add constraint profile_labels check(public.valid_labels(interests) and public.valid_labels(skills));
alter table public.profiles add constraint profile_lengths check(length(city)<=100 and length(portfolio)<=2048 and (portfolio='' or portfolio ~ '^https://'));
alter table public.profiles add constraint profile_media_urls check((avatar_url is null or length(avatar_url)<=2048 and avatar_url ~ '^https://') and (cover_url is null or length(cover_url)<=2048 and cover_url ~ '^https://'));
alter table public.intents add constraint intent_labels check(public.valid_labels(tags) and public.valid_labels(skills));
alter table public.intents add constraint intent_city check(length(city)<=100 and (mode='online' or length(btrim(city))>0));
alter table public.intents add constraint intent_category check(category in ('Social & fun','Learn & grow','Build & create','Sports & outdoors','Work & opportunities','Community'));

create function public.is_blocked(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a));
$$;
create function public.are_connected(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.connection_requests where status='accepted' and ((sender_id=a and recipient_id=b) or (sender_id=b and recipient_id=a)));
$$;
create function public.can_view_profile(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not public.is_blocked(auth.uid(),target) and exists(select 1 from public.profiles p where p.id=target and (p.visibility='public' or target=auth.uid() or public.are_connected(auth.uid(),target)));
$$;
create function public.is_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.conversation_members where conversation_id=cid and user_id=auth.uid()) and not exists(select 1 from public.conversation_members where conversation_id=cid and public.is_blocked(auth.uid(),user_id));
$$;
create function public.consume_rate_limit(action_name text, maximum integer default 20) returns boolean language plpgsql security definer set search_path='' as $$
 declare n integer; b bigint := floor(extract(epoch from now())/3600); lim integer;
 begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if action_name not in ('ai','intents','requests','messages','reports') then raise exception 'Unknown rate limit action'; end if;
 -- Limits are chosen here rather than trusting caller-provided maximum.
 lim := case action_name when 'ai' then 20 when 'intents' then 20 when 'requests' then 30 when 'messages' then 240 when 'reports' then 10 else 60 end;
 insert into private.rate_limits values(auth.uid(),action_name,b,1) on conflict(user_id,action) do update set bucket=b,count=case when private.rate_limits.bucket=b then private.rate_limits.count+1 else 1 end returning count into n;
 return n<=lim;
 end;
$$;

alter table public.profiles enable row level security;
alter table public.intents enable row level security;
alter table public.saved_intents enable row level security;
alter table public.blocks enable row level security;
alter table public.connection_requests enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(public.can_view_profile(id));
create policy profiles_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy intents_read on public.intents for select to authenticated using(public.can_view_profile(user_id) and (status='active' or user_id=auth.uid()));
create policy intents_insert on public.intents for insert to authenticated with check(user_id=auth.uid());
create policy intents_update on public.intents for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy intents_delete on public.intents for delete to authenticated using(user_id=auth.uid());
create policy saved_own on public.saved_intents for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and exists(select 1 from public.intents where id=intent_id));
create policy blocks_own on public.blocks for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid());
create policy requests_read on public.connection_requests for select to authenticated using((sender_id=auth.uid() or recipient_id=auth.uid()) and not public.is_blocked(sender_id,recipient_id));
create policy requests_insert on public.connection_requests for insert to authenticated with check(sender_id=auth.uid() and status='pending' and public.can_view_profile(recipient_id) and (intent_id is null or exists(select 1 from public.intents where id=intent_id and user_id=recipient_id and status='active')));
-- Request responses and conversation creation happen atomically through respond_request.
create policy conversations_read on public.conversations for select to authenticated using(public.is_member(id));
create policy members_read on public.conversation_members for select to authenticated using(public.is_member(conversation_id));
create policy messages_read on public.messages for select to authenticated using(public.is_member(conversation_id));
create policy messages_insert on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.is_member(conversation_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=auth.uid());
create policy notifications_update on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy reports_insert on public.reports for insert to authenticated with check(reporter_id=auth.uid() and reporter_id<>target_id);

-- Prevent identity changes, spoofed timestamps, and direct REST bypasses of spam controls.
create function private.guard_write() returns trigger language plpgsql security definer set search_path='' as $$
 declare action_name text;
 begin
 if TG_OP='UPDATE' then
  if new.id<>old.id or new.created_at<>old.created_at then raise exception 'Immutable identity'; end if;
  if TG_TABLE_NAME='intents' then
   if new.user_id<>old.user_id then raise exception 'Immutable owner'; end if;
  end if;
 else
  new.created_at := now();
  action_name := case TG_TABLE_NAME when 'intents' then 'intents' when 'connection_requests' then 'requests' when 'messages' then 'messages' when 'reports' then 'reports' else null end;
  if action_name is not null and not public.consume_rate_limit(action_name) then raise exception 'Hourly limit reached; try again later'; end if;
 end if;
 return new;
 end;
$$;
create trigger guard_intents before insert or update on public.intents for each row execute function private.guard_write();
create trigger guard_profiles before insert or update on public.profiles for each row execute function private.guard_write();
create trigger guard_requests before insert on public.connection_requests for each row execute function private.guard_write();
create trigger guard_messages before insert on public.messages for each row execute function private.guard_write();
create trigger guard_reports before insert on public.reports for each row execute function private.guard_write();

create function public.save_intent(payload jsonb, intent_uuid uuid default null, lat double precision default null, lng double precision default null, radius double precision default 25) returns uuid language plpgsql security definer set search_path='' as $$
 declare result uuid;
 begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'Create your profile first'; end if;
 if (lat is null)<>(lng is null) or lat not between -90 and 90 or lng not between -180 and 180 then raise exception 'Invalid coordinates'; end if;
 if intent_uuid is null then
 insert into public.intents(user_id,title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants)
 values(auth.uid(),payload->>'title',payload->>'description',payload->>'category',payload->>'role',payload->>'mode',coalesce(payload->>'city',''),array(select jsonb_array_elements_text(payload->'tags')),array(select jsonb_array_elements_text(payload->'skills')),(payload->>'starts_at')::timestamptz,(payload->>'ends_at')::timestamptz,(payload->>'participants')::int) returning id into result;
 else
 update public.intents set title=payload->>'title',description=payload->>'description',category=payload->>'category',role=payload->>'role',mode=payload->>'mode',city=payload->>'city',tags=array(select jsonb_array_elements_text(payload->'tags')),skills=array(select jsonb_array_elements_text(payload->'skills')),starts_at=(payload->>'starts_at')::timestamptz,ends_at=(payload->>'ends_at')::timestamptz,participants=(payload->>'participants')::int where id=intent_uuid and user_id=auth.uid() returning id into result;
 if result is null then raise exception 'Intention not found'; end if;
 end if;
 -- Quantize to roughly 1 km before storage; never retain precise GPS coordinates.
 insert into private.intent_context(intent_id,location,radius_km) values(result,case when lat is not null then extensions.st_setsrid(extensions.st_makepoint(round(lng::numeric,2)::double precision,round(lat::numeric,2)::double precision),4326)::extensions.geography end,radius)
 on conflict(intent_id) do update set location=excluded.location,radius_km=excluded.radius_km,embedding=null,embedding_model=null;
 return result;
 end;
$$;
create function public.get_intent_context(intent_uuid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
 declare result jsonb;
 begin
 if not exists(select 1 from public.intents where id=intent_uuid and user_id=auth.uid()) then raise exception 'Intention not found'; end if;
 select jsonb_build_object('latitude',extensions.st_y(location::extensions.geometry),'longitude',extensions.st_x(location::extensions.geometry),'radius_km',radius_km) into result from private.intent_context where intent_id=intent_uuid;
 return result;
 end;
$$;
create function public.set_intent_embedding(intent_uuid uuid, values_json jsonb, model_name text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not exists(select 1 from public.intents where id=intent_uuid and user_id=auth.uid()) then raise exception 'Intention not found'; end if;
 update private.intent_context set embedding=values_json::text::extensions.vector,embedding_model=model_name where intent_id=intent_uuid;
 end;
$$;
create function public.match_intents(source_id uuid, min_similarity double precision default .55) returns table(intent jsonb, similarity double precision, distance_km double precision) language plpgsql security definer set search_path='' as $$
 declare source public.intents; ctx private.intent_context;
 begin
 select * into source from public.intents where id=source_id and user_id=auth.uid() and status='active';
 if source.id is null then raise exception 'Intention not found'; end if;
 select * into ctx from private.intent_context where intent_id=source_id;
 if ctx.embedding is null then raise exception 'AI indexing is pending; retry indexing first'; end if;
 return query select to_jsonb(i)||jsonb_build_object('profile',to_jsonb(p)), 1-(c.embedding operator(extensions.<=>) ctx.embedding),
 case when c.location is not null and ctx.location is not null and i.mode<>'online' then round((extensions.st_distance(c.location,ctx.location)/1000)::numeric,0)::double precision end
 from public.intents i join public.profiles p on p.id=i.user_id join private.intent_context c on c.intent_id=i.id
 where i.user_id<>auth.uid() and i.status='active' and (i.ends_at is null or i.ends_at>now()) and (source.ends_at is null or source.ends_at>now()) and public.can_view_profile(i.user_id) and c.embedding is not null and c.embedding_model=ctx.embedding_model
 and 1-(c.embedding operator(extensions.<=>) ctx.embedding)>=greatest(.1,least(.99,min_similarity))
 -- Apply hard mode, time, and location constraints BEFORE the retrieval limit.
 and not(source.mode='online' and i.mode='in-person' or source.mode='in-person' and i.mode='online')
 and (source.starts_at is null and source.ends_at is null or (i.starts_at is not null and i.ends_at is not null and coalesce(source.starts_at,'-infinity')<i.ends_at and coalesce(source.ends_at,'infinity')>i.starts_at))
 and (source.mode<>'in-person' and i.mode<>'in-person' or (ctx.location is not null and c.location is not null and extensions.st_dwithin(ctx.location,c.location,least(ctx.radius_km,c.radius_km)*1000)) or ((ctx.location is null or c.location is null) and source.city<>'' and lower(source.city)=lower(i.city)))
 and case source.role when 'learn' then i.role='teach' when 'teach' then i.role='learn' when 'hire' then i.role='work' when 'work' then i.role='hire' when 'request' then i.role='offer' when 'offer' then i.role='request' when 'organize' then i.role='join' when 'join' then i.role in ('organize','join') else i.role=source.role end
 and (source.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(source.skills) s where not exists(select 1 from unnest(i.skills) cs where lower(cs)=lower(s))))
 and (i.role not in ('hire','learn','request','organize') or not exists(select 1 from unnest(i.skills) s where not exists(select 1 from unnest(source.skills) ss where lower(ss)=lower(s))))
 order by c.embedding operator(extensions.<=>) ctx.embedding limit 60;
 end;
$$;
create function public.nearby_intents(lat double precision,lng double precision,radius double precision default 25) returns table(intent jsonb,distance_km double precision) language sql stable security definer set search_path='' as $$
 select to_jsonb(i)||jsonb_build_object('profile',to_jsonb(p)), round((extensions.st_distance(c.location,extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography)/1000)::numeric,0)::double precision
 from public.intents i join public.profiles p on p.id=i.user_id join private.intent_context c on c.intent_id=i.id
 where auth.uid() is not null and lat between -90 and 90 and lng between -180 and 180 and radius between 1 and 500 and i.status='active' and i.mode<>'online' and public.can_view_profile(i.user_id)
 and extensions.st_dwithin(c.location,extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography,radius*1000)
 order by extensions.st_distance(c.location,extensions.st_setsrid(extensions.st_makepoint(lng,lat),4326)::extensions.geography) limit 100;
$$;

create function public.respond_request(request_uuid uuid,accept_request boolean) returns uuid language plpgsql security definer set search_path='' as $$
 declare req public.connection_requests; cid uuid;
 begin
 select * into req from public.connection_requests where id=request_uuid and recipient_id=auth.uid() and status='pending' for update;
 if req.id is null or public.is_blocked(req.sender_id,req.recipient_id) then raise exception 'Request not available'; end if;
 update public.connection_requests set status=case when accept_request then 'accepted' else 'declined' end where id=req.id;
 if accept_request then
 insert into public.conversations(request_id) values(req.id) returning id into cid;
 insert into public.conversation_members(conversation_id,user_id) values(cid,req.sender_id),(cid,req.recipient_id);
 insert into public.notifications(user_id,title,body,href) values(req.sender_id,'A new connection', 'Your connection request was accepted. Say hello!', '/messages');
 end if;
 return cid;
 end;
$$;
create function public.mark_conversation_read(cid uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.is_member(cid) then raise exception 'Conversation not found'; end if;
 update public.conversation_members set last_read_at=now() where conversation_id=cid and user_id=auth.uid();
 end;
$$;
create function private.notify() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if TG_TABLE_NAME='connection_requests' then
 insert into public.notifications(user_id,title,body,href) values(new.recipient_id,'Someone wants to connect',left(new.note,120),'/connections');
 else
 insert into public.notifications(user_id,title,body,href) select user_id,'New message','You have a new private message.','/messages' from public.conversation_members where conversation_id=new.conversation_id and user_id<>new.sender_id;
 end if;
 return new;
 end;
$$;
create trigger request_notification after insert on public.connection_requests for each row execute function private.notify();
create trigger message_notification after insert on public.messages for each row execute function private.notify();

-- Restrict RPC execution and writable columns; no service-role key is needed by the app.
revoke all on all functions in schema public from public,anon;
grant execute on all functions in schema public to authenticated;
revoke all on all tables in schema public from public,anon,authenticated;
grant select on all tables in schema public to authenticated;
grant insert on public.profiles,public.intents,public.saved_intents,public.blocks,public.connection_requests,public.messages,public.reports to authenticated;
grant update(name,username,bio,city,interests,skills,avatar_url,cover_url,portfolio,visibility) on public.profiles to authenticated;
grant update(title,description,category,role,mode,city,tags,skills,starts_at,ends_at,participants,status) on public.intents to authenticated;
grant update(read_at) on public.notifications to authenticated;
grant delete on public.intents,public.saved_intents,public.blocks to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('profile-media','profile-media',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict do nothing;
create policy media_insert on storage.objects for insert to authenticated with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy media_update on storage.objects for update to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy media_delete on storage.objects for delete to authenticated using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy media_read on storage.objects for select to authenticated using(bucket_id='profile-media');

alter publication supabase_realtime add table public.messages,public.notifications,public.connection_requests;
commit;
