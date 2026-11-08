-- Read-only administrator preview. No rows are changed.
with demo as (
 select u.id from auth.users u where u.raw_app_meta_data->>'telos_demo'='v1'
 or exists(select 1 from public.profiles p where p.id=u.id and p.is_demo)
)
select 'demo logins kept' as item,count(*) as rows from demo
union all select 'real logins removed',count(*) from auth.users u where not exists(select 1 from demo d where d.id=u.id)
union all select 'demo intents kept',count(*) from public.intents i where exists(select 1 from demo d where d.id=i.user_id)
union all select 'demo posts kept',count(*) from public.posts p where exists(select 1 from demo d where d.id=p.user_id)
union all select 'real profiles removed',count(*) from public.profiles p where not exists(select 1 from demo d where d.id=p.id);

-- These folders must be removed through the Storage dashboard/API, if listed.
with demo as (
 select u.id from auth.users u where u.raw_app_meta_data->>'telos_demo'='v1'
 or exists(select 1 from public.profiles p where p.id=u.id and p.is_demo)
)
select o.bucket_id,split_part(o.name,'/',1) as folder,count(*) as files
from storage.objects o
where not exists(select 1 from demo d where d.id::text=split_part(o.name,'/',1)
 or d.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner'))
and (o.bucket_id in ('profile-media','post-media') or exists(select 1 from auth.users u where u.id::text=coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')))
group by o.bucket_id,split_part(o.name,'/',1) order by o.bucket_id,folder;
