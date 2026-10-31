/*
 * The Mart's daily special: one thing picked from the town's harvest pays double all day.
 * The choice comes from today's date in Kasaragod, so everyone in town sees the same one.
 */
const PICKS = ['coconut', 'mango', 'hibiscus', 'jasmine', 'marigold'];

/** Today's date in Kasaragod (YYYY-MM-DD). */
export function townDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The item on special today. */
export function specialItem(now = new Date()): string {
  const day = townDay(now);
  let h = 0;
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PICKS[h % PICKS.length];
}
