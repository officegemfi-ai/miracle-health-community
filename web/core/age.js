// The age question at sign-in (web/ui/pages/auth.js): whether a month and year of birth make
// someone 18 or older today. It counts from the last day of that month, so nobody is let in early.
// Nothing here keeps the date.
export function isAdult(month, year, now = new Date()) {
  if (!(Number.isInteger(month) && Number.isInteger(year))) return false;
  if (!(month >= 1 && month <= 12 && year >= 1900 && year <= now.getFullYear())) return false;
  const lastDay = new Date(year, month, 0).getDate();
  return now >= new Date(year + 18, month - 1, lastDay);
}
