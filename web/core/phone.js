// A phone number as typed, in the form sign-in needs: +1 before a ten-digit US number, or a full
// international number starting with +. Null when it can't be one. Pure.

export function e164(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) { const d = s.replace(/[^\d]/g, ''); return d.length >= 8 ? `+${d}` : null; }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
