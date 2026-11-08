// Comments: a post's thread, a member's comments, and writing, changing or deleting your own.
import { sb } from './client.js';

export const thread = (postId) => sb.from('thread_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
export const byAuthor = (authorId) => sb.from('thread_comments').select('*').eq('author_id', authorId).eq('status', 'visible')
  .order('created_at', { ascending: false }).limit(30);
export const add = (row) => sb.from('comments').insert(row).select('id,status,status_reason');
export const update = (id, body) => sb.from('comments').update({ body }).eq('id', id);
export const remove = (id) => sb.from('comments').delete().eq('id', id);
