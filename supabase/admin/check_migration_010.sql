-- Read-only: run in Supabase SQL Editor. No data or schema changes.
-- All results should be true when migration 010 is fully installed.
select
 to_regclass('private.intent_request_keys') is not null as tracking_table_exists,
 to_regprocedure('private.write_intent(jsonb,uuid,double precision,double precision,double precision)') is not null as original_writer_preserved,
 coalesce(position('private.write_intent' in pg_get_functiondef(to_regprocedure('public.save_intent(jsonb,uuid,double precision,double precision,double precision)')))>0,false) as save_wrapper_installed,
 to_regprocedure('private.base_match_terms(text)') is not null as original_terms_preserved,
 to_regprocedure('private.context_overlap(text[],text[],text,text)') is not null as contextual_overlap_installed,
 coalesce(position('volunteer' in pg_get_functiondef(to_regprocedure('private.effective_intent_role(text,text)')))>0,false) as volunteer_roles_installed,
 coalesce(position('private.context_overlap' in pg_get_functiondef(to_regprocedure('private.find_people_core(public.intents,private.intent_context,boolean,double precision,double precision,double precision,text,double precision,integer)')))>0,false) as contextual_retrieval_installed,
 coalesce(position('v2:' in pg_get_functiondef(to_regprocedure('public.matching_context(uuid,boolean,double precision,double precision,double precision,text,double precision,integer)')))>0,false) as review_cache_reader_updated,
 coalesce(position('v2:' in pg_get_functiondef(to_regprocedure('public.review_people(uuid,jsonb)')))>0,false) as review_cache_writer_updated;
