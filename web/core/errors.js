// What a member reads when something goes wrong: the database's and the sign-in service's errors in
// plain words. Pure.

export function friendly(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (error.code === '23505') return 'Already done.';
  if (/row-level security/i.test(m)) return 'You can’t do that right now.';
  if (/permission denied/i.test(m)) return 'You can’t do that.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'You seem to be offline. Try again in a moment.';
  // The text provider's own errors can carry account details; members get a plain message
  if (/sending (confirmation |)OTP|sms provider|twilio|error sending/i.test(m)) {
    return 'We couldn’t text a code to that number right now. Check the number, or try again in a few minutes.';
  }
  if (/token has expired or is invalid/i.test(m)) return 'That code didn’t work. Check it, or go back and ask for a new one.';
  return m;
}
