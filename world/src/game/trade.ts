import { hooks, net, peers } from '../net/net';
import { ui } from '../world/interact';
import { ITEMS } from './catalog';
import { game } from './store';
import { sfx } from './sfx';

/*
 * Trading with someone in town. A short hand-shake, sent straight to them:
 *   offer  (you → them)  "2 mangoes for 30 points?"
 *   yes    (them → you)  they accept
 *   done   (you → them)  you've handed the items over, so they pay
 * Each side only changes its own bag, at the point the trade is agreed. Offers
 * expire after a minute and a half. There's no server to check it, so this trusts
 * both browsers to play fair.
 */

const TTL = 90_000;

interface Out {
  id: string;
  to: string;
  item: string;
  qty: number;
  pts: number;
  at: number;
}
interface In {
  id: string;
  from: string;
  item: string;
  qty: number;
  pts: number;
  at: number;
  name: string;
  accepted: boolean;
}
const outgoing = new Map<string, Out>();
const incoming = new Map<string, In>();

const newId = () => Math.random().toString(36).slice(2, 10);
const fresh = (at: number) => Date.now() - at < TTL;

/** Send an offer to someone in town. Returns a short message for the screen. */
export function offer(to: string, item: string, qty: number, pts: number): string {
  const it = ITEMS[item];
  if (!peers.has(to)) return 'They’ve left town. Pick someone who’s here.';
  if (!it || !Number.isInteger(qty) || qty < 1) return 'Choose what and how many to give.';
  if (!Number.isInteger(pts) || pts < 0) return 'Ask for a whole number of points.';
  if (!game.has(item, qty)) return `You don’t have ${qty} ${it.name.toLowerCase()}.`;
  const id = newId();
  const who = peers.get(to)?.name ?? 'them';
  if (!net.trade(to, { k: 'offer', id, n: net.me().name, item, qty, pts })) return 'You’re offline. Try again in a moment.';
  outgoing.set(id, { id, to, item, qty, pts, at: Date.now() });
  return `Offer sent to ${who}.`;
}

function accept(id: string) {
  const i = incoming.get(id);
  if (!i) return;
  if (!fresh(i.at)) {
    incoming.delete(id);
    return ui.toast('That offer has expired.');
  }
  if (!game.affords(i.pts)) {
    decline(id);
    return ui.toast(`You need ${i.pts} points for that.`);
  }
  i.accepted = true;
  net.trade(i.from, { k: 'yes', id });
  ui.toast(`Accepted. ${i.name} is handing it over…`);
}

function decline(id: string) {
  const i = incoming.get(id);
  if (!i) return;
  incoming.delete(id);
  net.trade(i.from, { k: 'no', id });
}

const label = (item: string, qty: number) => `${qty} × ${ITEMS[item]?.emoji ?? ''} ${ITEMS[item]?.name ?? item}`;

hooks.trade = (from, d) => {
  const id = typeof d.id === 'string' ? d.id : '';
  if (!id) return;
  if (d.k === 'offer') {
    const item = typeof d.item === 'string' ? d.item : '';
    const qty = Number(d.qty);
    const pts = Number(d.pts);
    if (!ITEMS[item] || !Number.isInteger(qty) || qty < 1 || !Number.isInteger(pts) || pts < 0) return;
    const name = typeof d.n === 'string' ? d.n.slice(0, 20) : 'Someone';
    incoming.set(id, { id, from, name, item, qty, pts, at: Date.now(), accepted: false });
    sfx.offer();
    ui.showCard({
      emoji: '🤝',
      title: `${name} offers a trade`,
      text: `They give you ${label(item, qty)} for ${pts} points. Points are taken only when you accept.`,
      actions: [
        { label: 'Accept', run: () => accept(id) },
        { label: 'No thanks', run: () => decline(id) },
      ],
    });
    // the offer lapses on its own, too
    setTimeout(() => {
      const still = incoming.get(id);
      if (still && !still.accepted) incoming.delete(id);
    }, TTL);
    return;
  }
  if (d.k === 'yes') {
    const o = outgoing.get(id);
    if (!o || o.to !== from) return;
    outgoing.delete(id);
    if (game.tradeOut(o.item, o.qty, o.pts)) {
      net.trade(from, { k: 'done', id });
      ui.toast(`Trade done! +${o.pts} points`);
    } else {
      net.trade(from, { k: 'no', id });
      ui.toast('You no longer have those, so the trade is off.');
    }
    return;
  }
  if (d.k === 'done') {
    const i = incoming.get(id);
    if (!i || !i.accepted || i.from !== from) return;
    incoming.delete(id);
    if (game.tradeIn(i.item, i.qty, i.pts)) ui.toast(`Got ${label(i.item, i.qty)}!`);
    else ui.toast('You no longer have the points for that.');
    return;
  }
  if (d.k === 'no') {
    const o = outgoing.get(id);
    if (o && o.to === from) {
      outgoing.delete(id);
      ui.toast(`${peers.get(from)?.name ?? 'They'} said no thanks.`);
    }
  }
};

