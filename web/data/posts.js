// Posts: the feed, one post, writing and changing your own, votes, "same for me", stickers,
// a public page for a report, and reporting something to the moderators.
import { sb } from './client.js';

// The feed, 40 at a time, by sort (hot, new, top, reports). scope narrows it: { mySpaces: true }
// for Home, { space: { cid, only } } for a space ('own', 'stacks' or all), { parts: ids } for a stack.
export function feed(sort, scope = {}) {
  let q = sb.from('feed').select('*');
  if (sort === 'new') q = q.order('created_at', { ascending: false });
  else if (sort === 'top') q = q.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).order('score', { ascending: false }).order('created_at', { ascending: false });
  else if (sort === 'reports') q = q.eq('counts_for_signal', true).order('created_at', { ascending: false });
  else q = q.order('hot', { ascending: false });
  q = q.limit(40);
  if (scope.mySpaces) q = q.eq('in_my_spaces', true);
  if (scope.space) {
    const { cid, only } = scope.space;
    q = only === 'own' ? q.eq('compound_id', cid) : only === 'stacks' ? q.contains('part_ids', [cid]).neq('compound_id', cid) : q.contains('part_ids', [cid]);
  }
  if (scope.parts) q = q.contains('part_ids', scope.parts);
  return q;
}

export const byId = (id) => sb.from('feed').select('*').eq('id', id).limit(1);
export const byAuthor = (authorId) => sb.from('feed').select('*').eq('author_id', authorId).order('created_at', { ascending: false }).limit(30);
export const find = (like) => sb.from('feed').select('id,title,compound_name,status').ilike('title', like).eq('status', 'visible').limit(5);

export const create = (args) => sb.rpc('create_post', args);
export const update = (id, fields) => sb.from('posts').update(fields).eq('id', id);
export const remove = (id) => sb.from('posts').delete().eq('id', id);
export const setPublic = (id, on) => sb.rpc('set_post_public', { post_id: id, make_public: on });
export const publicSince = (id) => sb.from('posts').select('public_at').eq('id', id).limit(1);

// A vote on a post or a comment: the same value again takes it back
export function vote(kind, id, prev, value) {
  const table = kind === 'post' ? 'post_votes' : 'comment_votes';
  const key = kind === 'post' ? 'post_id' : 'comment_id';
  if (prev === value) return sb.from(table).delete().eq(key, id);
  if (prev === null) return sb.from(table).insert({ [key]: id, value });
  return sb.from(table).update({ value }).eq(key, id);
}
export const setSame = (id, on) => (on ? sb.from('same_for_me').insert({ post_id: id }) : sb.from('same_for_me').delete().eq('post_id', id));
export const setSticker = (id, sticker, on) => (on
  ? sb.from('post_reactions').insert({ post_id: id, sticker })
  : sb.from('post_reactions').delete().eq('post_id', id).eq('sticker', sticker));

export const report = (kind, id, reason, note) => sb.from('reports').insert({ target_kind: kind, target_id: id, reason, note });
