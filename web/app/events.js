// Live news inside the app. The database's changes (data/live.js) are announced here by topic:
// 'signal' (a new Signal version), 'notification' (one of yours), 'post' (a new post). Screens that
// care listen; on() returns the way to stop.
const listeners = { signal: new Set(), notification: new Set(), post: new Set() };
export function on(topic, fn) { listeners[topic].add(fn); return () => listeners[topic].delete(fn); }
export const emit = (topic, payload) => listeners[topic].forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
