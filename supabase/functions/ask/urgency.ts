// When to get help: Miracle AI never words warning signs itself. The guide picks signs from this
// table by id, and each one is shown under the level the table gives it. Drafted from public
// medical guidance, always taking the more urgent level when sources differ or it's borderline.
// Not yet reviewed by a clinician: the card says so.
export type UrgencyLevel = 'now' | 'today' | 'week';
export type UrgencySign = { id: string; sign: string; level: UrgencyLevel };

export const URGENCY_LEVELS: Record<UrgencyLevel, string> = {
  now: 'Call 911 now',
  today: 'Same day: ER or urgent care',
  week: 'Book a visit this week',
};
export const URGENCY_NOTE = 'Levels from Miracle Health’s table, drafted from public medical guidance and not yet reviewed by a clinician. If you’re unsure, get help sooner.';

export const URGENCY: UrgencySign[] = [
  // Call 911 now
  { id: 'chest_pain', level: 'now', sign: 'Chest pain, pressure or tightness, or pain spreading to the arm, neck, jaw or back' },
  { id: 'breathing', level: 'now', sign: 'Trouble breathing, or sudden shortness of breath' },
  { id: 'allergic', level: 'now', sign: 'Swelling of the lips, tongue or throat, or hives with trouble breathing or feeling faint' },
  { id: 'stroke', level: 'now', sign: 'Signs of a stroke: face drooping, arm or leg weakness, slurred speech or sudden confusion' },
  { id: 'worst_headache', level: 'now', sign: 'A sudden, severe headache, the worst you’ve had' },
  { id: 'seizure', level: 'now', sign: 'A seizure' },
  { id: 'faint_red', level: 'now', sign: 'Fainting with chest pain, a racing or pounding heartbeat, or trouble breathing' },
  { id: 'low_sugar_severe', level: 'now', sign: 'Shaking, sweating or confusion that doesn’t improve after eating or drinking something sugary' },
  { id: 'vomit_blood', level: 'now', sign: 'Vomiting blood, or what looks like coffee grounds' },
  { id: 'bleeding', level: 'now', sign: 'Bleeding that won’t stop with firm pressure' },
  { id: 'overdose', level: 'now', sign: 'Took far too much of something (Poison Control is also at 1-800-222-1222)' },
  { id: 'vision_loss', level: 'now', sign: 'Sudden loss of vision in one or both eyes' },
  { id: 'erection', level: 'now', sign: 'An erection that lasts more than 4 hours' },
  // Same day: ER or urgent care
  { id: 'faint', level: 'today', sign: 'Fainting or nearly fainting' },
  { id: 'heartbeat', level: 'today', sign: 'A racing, pounding or irregular heartbeat that doesn’t settle' },
  { id: 'black_stool', level: 'today', sign: 'Black, tarry or bloody stools' },
  { id: 'belly_pain', level: 'today', sign: 'Severe belly pain that doesn’t go away, with or without vomiting or pain going through to the back' },
  { id: 'fluids', level: 'today', sign: 'Vomiting or diarrhea so you can’t keep fluids down, or very dark urine with dizziness' },
  { id: 'jaundice', level: 'today', sign: 'Yellow skin or eyes, or dark urine with pale stools' },
  { id: 'muscle_urine', level: 'today', sign: 'Severe muscle pain or weakness with dark, cola-colored urine' },
  { id: 'calf', level: 'today', sign: 'One leg swollen, warm, red or painful, especially the calf' },
  { id: 'injection_site', level: 'today', sign: 'Where you injected: redness, warmth or swelling that spreads, a painful lump, or pus' },
  { id: 'fever', level: 'today', sign: 'Fever with chills or shaking' },
  { id: 'tendon_rupture', level: 'today', sign: 'A pop or snap, a gap you can feel, or suddenly being unable to push off, grip or bear weight' },
  { id: 'injury_swelling', level: 'today', sign: 'Fast swelling or heavy bruising after an injury, or a joint that looks out of place' },
  { id: 'rash_severe', level: 'today', sign: 'A rash that blisters or peels, or sores in the mouth or eyes' },
  { id: 'little_urine', level: 'today', sign: 'Peeing much less than usual, or not at all' },
  { id: 'eye', level: 'today', sign: 'New blurred vision, eye pain or seeing halos around lights' },
  { id: 'bruising', level: 'today', sign: 'New easy bruising, nosebleeds or bleeding gums' },
  { id: 'low_sugar', level: 'today', sign: 'Episodes of shakiness, sweating or confusion that ease after eating' },
  // Book a visit this week
  { id: 'mood', level: 'week', sign: 'New or worsening low mood, anxiety or irritability' },
  { id: 'fatigue', level: 'week', sign: 'Tiredness that lasts more than two weeks' },
  { id: 'weight_change', level: 'week', sign: 'Weight loss or gain you can’t explain' },
  { id: 'lump', level: 'week', sign: 'A new lump anywhere, or a mole that changes' },
  { id: 'breast_testicle', level: 'week', sign: 'Breast or testicle changes, or nipple discharge' },
  { id: 'headaches', level: 'week', sign: 'New headaches that keep coming back' },
  { id: 'snoring', level: 'week', sign: 'Loud snoring with pauses in breathing, or falling asleep during the day' },
  { id: 'stomach', level: 'week', sign: 'Ongoing nausea, constipation or heartburn' },
  { id: 'joint_pain', level: 'week', sign: 'Joint or tendon pain that isn’t getting better after two weeks' },
  { id: 'lasting', level: 'week', sign: 'Any symptom that lasts more than two weeks or keeps coming back' },
];

const BY_ID = new Map(URGENCY.map((u) => [u.id, u]));
const ORDER: UrgencyLevel[] = ['now', 'today', 'week'];

// The card: the signs the guide picked, known ids only, grouped by level, most urgent first
export function warningCard(ids: unknown): { type: 'warn'; groups: { level: UrgencyLevel; label: string; signs: string[] }[]; note: string } | null {
  const picked = [...new Set((Array.isArray(ids) ? ids : []).map(String))].map((id) => BY_ID.get(id)).filter((u): u is UrgencySign => !!u).slice(0, 6);
  if (!picked.length) return null;
  const groups = ORDER.map((level) => ({ level, label: URGENCY_LEVELS[level], signs: picked.filter((u) => u.level === level).map((u) => u.sign) }))
    .filter((g) => g.signs.length);
  return { type: 'warn', groups, note: URGENCY_NOTE };
}

// For someone who injects: the basics, once in a chat, with the signs from the table that matter
// most after an injection. No doses and nothing on how to inject.
export const INJECT_SIGNS = ['allergic', 'injection_site', 'fever'];
export const INJECT_CARD = {
  type: 'inject',
  title: 'If you inject: the safety basics',
  points: [
    'Use a new, sterile needle and syringe every time, and never share needles, syringes or vials.',
    'Keep the vial and its label, so a clinician can see exactly what you used.',
    'Tell any clinician who treats you what you inject.',
  ],
  groups: warningCard(INJECT_SIGNS)!.groups,
  note: 'Safety information only: Miracle Health doesn’t give doses or say how to inject.',
};
