// When to get help: Miracle AI never words warning signs itself. The guide picks signs from this
// table by id, and each one is shown under the level the table gives it. Drafted from public
// medical guidance (each sign's sources are in urgency_sources.md), always taking the more urgent
// level when sources differ or it's borderline. Not yet reviewed by a clinician: the card says so.
export type UrgencyLevel = 'now' | 'today' | 'week';
export type UrgencySign = { id: string; sign: string; level: UrgencyLevel };

export const URGENCY_LEVELS: Record<UrgencyLevel, string> = {
  now: 'Call 911 or go to the ER now',
  today: 'Same day: ER or urgent care',
  week: 'Book a visit this week',
};
export const URGENCY_NOTE = 'Levels from Miracle Health’s table, drafted from public medical guidance and not yet reviewed by a clinician. If you’re unsure, get help sooner.';

export const URGENCY: UrgencySign[] = [
  // Call 911 or go to the ER now
  { id: 'chest_pain', level: 'now', sign: 'Chest pain, pressure or tightness, or pain spreading to the arm, neck, jaw or back' },
  { id: 'breathing', level: 'now', sign: 'Trouble breathing, or sudden shortness of breath' },
  { id: 'allergic', level: 'now', sign: 'Swelling of the lips, tongue or throat, trouble swallowing, or hives with trouble breathing or feeling faint' },
  { id: 'stroke', level: 'now', sign: 'Sudden face drooping, numbness or weakness on one side, slurred speech, confusion, or trouble walking' },
  { id: 'worst_headache', level: 'now', sign: 'A sudden, severe headache, the worst you’ve had' },
  { id: 'seizure', level: 'now', sign: 'A seizure, or someone who passes out and can’t be woken up' },
  { id: 'heartbeat_red', level: 'now', sign: 'A racing, pounding or irregular heartbeat with chest pain, trouble breathing or feeling faint' },
  { id: 'low_sugar_severe', level: 'now', sign: 'Shaking, sweating or confusion that’s no better 15 minutes after something sugary, or too drowsy to eat' },
  { id: 'vomit_blood', level: 'now', sign: 'Vomiting or coughing up blood, or vomit that looks like coffee grounds' },
  { id: 'bowel_block', level: 'now', sign: 'Can’t pass stool or gas, with vomiting or a swollen, hard or very tender belly' },
  { id: 'bleeding', level: 'now', sign: 'Bleeding that won’t stop with firm pressure (even a nosebleed), or passing a lot of blood from your rectum' },
  { id: 'overdose', level: 'now', sign: 'Took too much of a medicine, peptide or supplement (if you feel fine, call Poison Control: 1-800-222-1222)' },
  { id: 'dehydration_severe', level: 'now', sign: 'After vomiting, diarrhea or not drinking: confusion, being very sleepy, fast breathing, or cold, blotchy skin' },
  { id: 'sepsis', level: 'now', sign: 'Very ill with an infection: confused or slurred speech, breathing very fast, or blotchy, pale or bluish skin' },
  { id: 'vision_loss', level: 'now', sign: 'Sudden loss of all or part of your vision, sudden severe eye pain, or a red eye with halos around lights' },
  { id: 'erection', level: 'now', sign: 'An erection that lasts more than 4 hours' },
  { id: 'faint', level: 'now', sign: 'Fainting (passing out), even if you come round quickly' },
  { id: 'belly_pain', level: 'now', sign: 'Severe belly pain that won’t go away or spreads to your back, or belly pain with fever or yellow eyes' },
  { id: 'fever', level: 'now', sign: 'Fever or shaking chills if you inject anything, or with a red, swollen or painful patch of skin' },
  { id: 'injury_swelling', level: 'now', sign: 'After an injury: a joint out of place or at an odd angle, can’t put weight on it, or numb, cold or blue skin' },
  { id: 'rash_severe', level: 'now', sign: 'A spreading rash that blisters or peels, or sores in the mouth or eyes, after starting something new' },
  // Same day: ER or urgent care
  { id: 'heartbeat', level: 'today', sign: 'A racing, pounding or irregular heartbeat that’s new, or that doesn’t settle when you rest' },
  { id: 'bp_high', level: 'today', sign: 'A home blood pressure reading of 180/120 or higher that’s still that high after resting a few minutes' },
  { id: 'black_stool', level: 'today', sign: 'Black, tarry or bloody stools' },
  { id: 'fluids', level: 'today', sign: 'Vomiting or diarrhea so you can’t keep fluids down, or very dark urine with dizziness' },
  { id: 'jaundice', level: 'today', sign: 'Yellow skin or yellow whites of the eyes, or dark urine with pale stools' },
  { id: 'muscle_urine', level: 'today', sign: 'Severe muscle pain or weakness with dark, cola-colored urine' },
  { id: 'calf', level: 'today', sign: 'Swelling or throbbing pain in one leg, often the calf or thigh, sometimes with warm, red or darker skin' },
  { id: 'injection_site', level: 'today', sign: 'Where you injected: redness, warmth or swelling that spreads, a painful lump, or pus' },
  { id: 'tendon_rupture', level: 'today', sign: 'After an injury: a pop or snap, fast swelling or heavy bruising, or sudden weakness pushing off or gripping' },
  { id: 'little_urine', level: 'today', sign: 'Peeing much less than usual, or not at all' },
  { id: 'eye', level: 'today', sign: 'New blurred vision, flashes of light, or an eye that’s red, sore or sensitive to light' },
  { id: 'hearing_loss', level: 'today', sign: 'Sudden hearing loss in one or both ears, sometimes with ringing, ear fullness or dizziness' },
  { id: 'low_sugar', level: 'today', sign: 'Episodes of shakiness, sweating or confusion that ease after eating' },
  { id: 'gallbladder', level: 'today', sign: 'Belly pain under the right ribs or in the upper middle that lasts more than 30 minutes' },
  // Book a visit this week
  { id: 'bruising', level: 'week', sign: 'Bruising more easily than usual, or nosebleeds or bleeding gums that keep happening' },
  { id: 'mood', level: 'week', sign: 'New or worsening low mood, anxiety or irritability' },
  { id: 'fatigue', level: 'week', sign: 'Tiredness that lasts more than two weeks' },
  { id: 'weight_change', level: 'week', sign: 'Weight loss or gain you can’t explain' },
  { id: 'lump', level: 'week', sign: 'A new lump or swelling anywhere that doesn’t go away or keeps growing' },
  { id: 'mole', level: 'week', sign: 'A mole that changes size, shape or color, itches or bleeds, or a new dark mark that doesn’t go away' },
  { id: 'neck', level: 'week', sign: 'A lump or swelling in your neck, a hoarse voice that won’t go away, or trouble swallowing' },
  { id: 'breast_testicle', level: 'week', sign: 'A painless lump or change in a breast or testicle, nipple discharge, or new breast growth in men' },
  { id: 'headaches', level: 'week', sign: 'New headaches that keep coming back' },
  { id: 'snoring', level: 'week', sign: 'Loud snoring with pauses in breathing, or falling asleep during the day' },
  { id: 'stomach', level: 'week', sign: 'Mild nausea, constipation or heartburn that keeps coming back or won’t go away' },
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
