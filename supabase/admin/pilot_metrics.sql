-- Administrator-only, aggregate pilot report. No messages or intention text.
-- Demo accounts are excluded. Events begin at migration 011, with no backfill.
with members as(select id,created_at from public.profiles where not is_demo),
recent as(select e.* from private.product_events e join members m on m.id=e.user_id where e.created_at>=now()-interval '30 days')
select
 (select count(*) from members) as real_profiles,
 (select count(*) from members where created_at>=now()-interval '30 days') as new_profiles_30d,
 (select count(distinct user_id) from recent) as members_taking_connection_actions_30d,
 count(*) filter(where event_name='invitation_sent') as invitations_sent_30d,
 count(*) filter(where event_name='invitation_accepted') as invitations_accepted_30d,
 count(distinct entity_id) filter(where event_name='conversation_participated') as conversations_with_messages_30d,
 (select count(*) from (select entity_id from recent where event_name='conversation_participated' group by entity_id having count(distinct user_id)>=2) two_way) as two_way_conversations_30d,
 count(*) filter(where event_name='connection_useful') as first_useful_reports_30d,
 (select count(*) from private.connection_outcomes o join members m on m.id=o.user_id where o.outcome='useful') as current_useful_self_reports,
 min(created_at) as first_event_in_window
from recent;

-- Remove expired event history according to your chosen retention policy.
-- This report does not perform deletion. Exact active search text and chat content stay private.
