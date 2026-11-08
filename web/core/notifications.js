// What a moderator's action on your post or account says, in the notification you get. Pure.

export const MOD_TEXT = {
  remove: (d) => `A moderator removed your ${d.what}: ${d.reason}`,
  hold: (d) => `Your ${d.what} is waiting for a moderator${d.by === 'moderator' ? '' : ' (an automatic check)'}`,
  restore: (d) => `Your ${d.what} is back up`,
  warn: (d) => `A note from the moderators: ${d.note || d.reason}`,
  suspend: (d) => `Your account is paused${d.until ? ` until ${new Date(d.until).toLocaleDateString()}` : ''}: ${d.reason}`,
  unban: () => 'Your account is active again',
};
