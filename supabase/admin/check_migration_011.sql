-- Read-only installation check. Run after migration 011; every result should be true.
select
 to_regclass('private.discovery_feedback') is not null as feedback_table,
 to_regclass('private.connection_outcomes') is not null as outcomes_table,
 to_regclass('private.product_events') is not null as pilot_events_table,
 to_regprocedure('public.record_match_feedback(uuid,uuid,text,text,text)') is not null as feedback_function,
 to_regprocedure('public.record_connection_outcome(uuid,text)') is not null as outcome_function,
 to_regprocedure('public.my_progress()') is not null as progress_function,
 (select count(*)=2 from pg_trigger where not tgisinternal and tgname in ('pilot_connection_event','pilot_conversation_event')) as event_triggers,
 coalesce(position('private.discovery_feedback' in pg_get_functiondef(to_regprocedure('private.find_people_core(public.intents,private.intent_context,boolean,double precision,double precision,double precision,text,double precision,integer)')))>0,false) as private_feedback_applied;
