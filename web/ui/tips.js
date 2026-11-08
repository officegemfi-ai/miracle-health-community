// Sig's tip for the page you're on, when you tap Sig
import { h } from './dom.js';
import { signalOf, spaceOf } from '../app/store.js';
import { current } from './current.js';

export function tipFor() {
  const x = current.cid ? signalOf(current.cid) : null;
  switch (current.name) {
    case 'signal': return 'These numbers move live. Every first-hand report and every “same for me” recalculates one.';
    case 'space': return x ? [`${spaceOf(current.cid)?.name}’s Signal is `, h('b', {}, String(x.score)), `. Members here make up ${x.internal_share}% of it. At 50%, it’s run by this community.`] : 'Three first-hand reports unlock this space’s Signal.';
    case 'post': return 'If this matches your experience, tap “Same for me”. It adds your voice to the Signal.';
    case 'builders': return 'Points go to taking part, never to results. A report that says it didn’t work earns the same.';
    case 'quests': return 'Finish a quest, then claim it for the points.';
    case 'new': return 'Say how it compares to before you started, and for how long. I’ll read it into the Signal.';
    default: {
      const tips = [
        'Tap “Same for me” when a report matches yours. It adds your voice to the Signal.',
        'Your first contribution each day earns 5 points and keeps your streak going.',
        'Questions don’t count toward the Signal. Reports of what happened to you do.',
        'Join a few spaces and your Home feed fills up with them.',
      ];
      return tips[Math.floor(Math.random() * tips.length)];
    }
  }
}
