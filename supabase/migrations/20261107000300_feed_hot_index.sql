-- The feed's "hot" order reads an index instead of scoring every post on every load.
--
-- Popular, Home and each space sort the feed by hot: a post's votes and "same for me" taps
-- (log scale) plus its age, the same formula as before. The view worked it out for every post
-- on every load, with exact-decimal logarithms, then kept the top 40: with 50,000 posts that
-- was 0.74 seconds for Popular and 1.2 seconds for a member's Home, growing with every post.
-- A post's hot value depends only on its own score, taps and time, never on the clock, so it
-- can be indexed: private.hot() is the formula, posts_hot_idx holds it for every post, and the
-- view reads posts in that order and stops at 40 (5 ms and 80 ms with 50,000 posts). The values
-- are exactly the same, so the order is too.
--
-- private.hot() is marked immutable although extract() isn't in general: the seconds since 1970
-- don't depend on the time zone or any other setting, only some of extract's other fields do.
-- The cost moves to writes: a vote or a tap now also updates the posts' indexes (before, Postgres
-- could often skip them), a little more work per vote for much less per load.

create or replace function private.hot(p_score integer, p_same integer, p_created timestamptz) returns numeric
language sql immutable parallel safe set search_path = ''
as $$ select round((sign(p_score + p_same)::numeric * log(greatest(abs(p_score + p_same), 1)::numeric)
                    + extract(epoch from p_created) / 45000)::numeric, 6) $$;
create index posts_hot_idx on public.posts (private.hot(score, same_count, created_at) desc);
create or replace view public.feed with (security_invoker = true) as
select p.id, p.compound_id, c.name as compound_name, c.category as compound_category,
       p.kind, p.title, p.body, p.status, p.status_reason, p.score,
       p.created_at, p.edited_at, p.author_id, a.handle as author_handle,
       (p.author_id = (select auth.uid())) as is_mine,
       (select v.value from public.post_votes v
        where v.post_id = p.id and v.user_id = (select auth.uid())) as my_vote,
       (select count(*) from public.comments cm
        where cm.post_id = p.id and cm.status = 'visible') as comment_count,
       coalesce(r.counts, false) and p.status = 'visible' as counts_for_signal,
       r.outcome, r.duration, coalesce(r.side_effects, '{}') as side_effects,
       p.same_count,
       exists (select 1 from public.same_for_me s
               where s.post_id = p.id and s.user_id = (select auth.uid())) as i_same,
       (r.post_id is null and p.kind = 'experience' and p.status = 'visible'
        and p.created_at > now() - interval '10 minutes') as read_pending,
       p.reactions,
       coalesce((select array_agg(x.sticker order by x.sticker) from public.post_reactions x
                 where x.post_id = p.id and x.user_id = (select auth.uid())), '{}') as my_reactions,
       coalesce(ms.level, 1) as author_level,
       r.confirmed_at is not null as read_confirmed,
       coalesce(r.corrected, false) as read_corrected,
       private.hot(p.score, p.same_count, p.created_at) as hot,
       exists (select 1 from public.space_members m
               where m.user_id = (select auth.uid())
                 and (m.compound_id = p.compound_id or m.compound_id = any (p.part_ids))) as in_my_spaces,
       p.part_ids, c.kind as compound_kind,
       coalesce(r.uses, '[]'::jsonb) as read_uses,
       coalesce(r.serious, false) as read_serious,
       (select jsonb_build_object('week', k.week, 'outcome', k.outcome, 'still_taking', k.still_taking,
                                  'stop_reason', k.stop_reason, 'at', k.created_at)
        from public.report_checkins k where k.post_id = p.id order by k.week desc limit 1) as checkin,
       case when p.author_id = (select auth.uid()) and p.kind = 'experience'
                 and p.created_at <= now() - interval '2 weeks'
            then private.checkin_due(p.id) end as checkin_due
from public.posts p
join public.profiles a on a.id = p.author_id
join public.compounds c on c.id = p.compound_id
left join public.post_reads r on r.post_id = p.id
left join public.member_scores ms on ms.user_id = p.author_id;

