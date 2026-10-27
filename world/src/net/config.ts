/*
 * The shared world talks over Supabase Realtime (broadcast only: nothing is stored).
 * It borrows the Glazy project's Realtime on its own channel. The publishable key is
 * meant to be public; it can't read or change any of Glazy's data.
 */
export const REALTIME_URL = 'wss://ymumrxpdcikvynhljsyu.supabase.co/realtime/v1';
export const REALTIME_KEY = 'sb_publishable_PfGr2cdE5450n3domALrSA_A2as6Wdy';
export const CHANNEL = 'es-world:town';
