/*
 * The shared world talks over Supabase Realtime (broadcast only: nothing is stored).
 * It borrows the Glazy project's Realtime on its own channel. The publishable key is
 * meant to be public; it can't read or change any of Glazy's data.
 */
export const REALTIME_URL = 'wss://ymumrxpdcikvynhljsyu.supabase.co/realtime/v1';
export const REALTIME_KEY = 'sb_publishable_PfGr2cdE5450n3domALrSA_A2as6Wdy';
// ?room=name (previews and tests) uses a separate channel so test visitors don't appear in town
const room = new URLSearchParams(location.search).get('room')?.replace(/[^a-z0-9-]/gi, '').slice(0, 24);
export const CHANNEL = room ? `es-world:test-${room}` : 'es-world:town';
