// Members and the game: the reference lists (levels, badges, point rules), member cards, the
// monthly board, quests, community goals, the pairs filled first, and your points ledger.
import { sb } from './client.js';

export const levels = () => sb.from('levels').select('*').order('n');
export const badges = () => sb.from('badges').select('*').order('sort');
export const pointRules = () => sb.from('point_rules').select('*');

export const card = (id) => sb.from('member_cards').select('*').eq('id', id).limit(1);
export const cardByHandle = (handle) => sb.from('member_cards').select('*').eq('handle', handle).limit(1);
export const find = (like) => sb.from('member_cards').select('handle,level').ilike('handle', like).limit(4);

export const builders = (n) => sb.from('signal_builders').select('*').order('rank').limit(n);
export const quests = () => sb.from('my_quests').select('*').order('sort');
export const claimQuest = (key) => sb.rpc('claim_quest', { quest: key });
export const goals = (n) => sb.from('community_goals').select('*').lt('pct', 100).order('pct', { ascending: false }).limit(n);
export const focus = () => sb.from('focus_progress').select('*').order('sort');
export const pointsLedger = () => sb.from('my_points').select('*').order('created_at', { ascending: false }).limit(60);
