import { useEffect, useMemo, useState } from 'react';
import { game, sellPrice, useGame, useGameValue, type GameState } from './store';
import { ITEMS, MAX_LIFE, RECIPES, SHOPS, type Item } from './catalog';
import { specialItem } from './festival';
import { boardRows, useBoardVersion } from './board';
import { offer } from './trade';
import { useDiscovered } from './discover';
import { useNet, net } from '../net/net';
import { isTouch, typing } from '../player/input';
import { ui } from '../world/interact';

/** Points and life, for the top of the screen. */
export function GameBar() {
  const points = useGameValue((s) => s.points);
  const life = useGameValue((s) => s.life);
  const { names, total } = useDiscovered();
  const low = life < 35;
  return (
    <>
      <div className="pill explored" title="Places you’ve discovered by walking into them: each one gives points">
        <span aria-hidden="true">🧭</span>
        <b>
          {names.size}/{total}
        </b>
        <span>explored</span>
      </div>
      <div className="pill wallet" title="Points: earn them by selling at the Fruit & Flower Mart, spend them in the shops">
        <span aria-hidden="true">🪙</span>
        <b>{points}</b>
        <span>points</span>
      </div>
      <div className={`pill life${low ? ' low' : ''}`} title={`Life: ${Math.round(life)} of ${MAX_LIFE}. Accidents and the weather take it; it comes back when you’re safe.`}>
        <span aria-hidden="true">❤️</span>
        <span className="life-bar" role="meter" aria-valuemin={0} aria-valuemax={MAX_LIFE} aria-valuenow={Math.round(life)} aria-label="Life">
          <i style={{ width: `${Math.max(0, Math.min(100, (life / MAX_LIFE) * 100))}%` }} />
        </span>
        <b>{Math.round(life)}</b>
      </div>
    </>
  );
}

/** A red flash at the edges of the screen when something hurts you. */
export function HurtFlash() {
  const hurtAt = useGameValue((s) => s.hurtAt);
  if (!hurtAt) return null;
  return <div key={hurtAt} className="hurt" aria-hidden="true" />;
}

/** The shop you're at, your bag, or the town board. Esc closes; B opens the bag. */
export function GamePanels() {
  const shop = useGameValue((s) => s.shop);
  const bag = useGameValue((s) => s.bag);
  const board = useGameValue((s) => s.board);
  const g = useGame();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'Escape' && game.modalOpen()) {
        const st = game.get();
        if (st.shop) game.openShop(null);
        else if (st.bag) game.toggleBag();
        else game.toggleBoard();
      }
      if (e.code === 'KeyB' && !ui.get().card && !ui.get().book && !game.modalOpen()) game.toggleBag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (shop) {
    const s = SHOPS.find((x) => x.id === shop);
    if (!s) return null;
    return (
      <Panel emoji={s.emoji} title={s.name} onClose={() => game.openShop(null)}>
        <p className="gp-points">
          🪙 {g.points} points
        </p>
        <p className="gp-greet">“{s.greet}”</p>
        {s.mart ? <Mart g={g} /> : s.service ? <Clinic g={g} name={s.service.name} price={s.service.price} /> : <Counter g={g} ids={s.stock ?? []} />}
      </Panel>
    );
  }
  if (bag) {
    return (
      <Panel emoji="🎒" title="Your bag" onClose={() => game.toggleBag()}>
        <Bag g={g} />
      </Panel>
    );
  }
  if (board) {
    return (
      <Panel emoji="🏆" title="Town board" onClose={() => game.toggleBoard()}>
        <Board />
      </Panel>
    );
  }
  return null;
}

function Panel({ emoji, title, onClose, children }: { emoji: string; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="gp-wrap"
      onMouseDown={(e) => {
        // a tap on the dark backdrop (not the card) closes it
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="gp-card" role="dialog" aria-label={title}>
        <header className="gp-head">
          <span className="gp-emoji" aria-hidden="true">
            {emoji}
          </span>
          <h2>{title}</h2>
          <button type="button" className="gp-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="gp-body">{children}</div>
        {!isTouch && <p className="gp-keys">Esc or a click outside closes it</p>}
      </section>
    </div>
  );
}

/** Items a shop sells: each one is a row with a price and a button. */
function Counter({ g, ids }: { g: GameState; ids: string[] }) {
  return (
    <ul className="gp-rows">
      {ids.map((id) => {
        const it = ITEMS[id];
        const owned = it.kind === 'gear' && !!g.owned[id];
        const can = !owned && g.points >= (it.buy ?? 0);
        const have = g.inv[id] ?? 0;
        return (
          <li key={id} className="gp-row">
            <span className="gp-icon" aria-hidden="true">
              {it.emoji}
            </span>
            <span className="gp-text">
              <b>{it.name}</b>
              <small>
                {it.blurb}
                {it.kind === 'consumable' && have > 0 ? ` · you have ${have}` : ''}
              </small>
            </span>
            <button type="button" className="gp-buy" disabled={!can} onClick={() => game.buy(id)}>
              {owned ? 'Owned ✓' : `${it.buy} pts`}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The clinic: a check-up that puts you back to full life. */
function Clinic({ g, name, price }: { g: GameState; name: string; price: number }) {
  return (
    <ul className="gp-rows">
      <li className="gp-row">
        <span className="gp-icon" aria-hidden="true">
          🩺
        </span>
        <span className="gp-text">
          <b>{name}</b>
          <small>
            Life {Math.round(g.life)} of {MAX_LIFE}. Back to full life.
          </small>
        </span>
        <button type="button" className="gp-buy" disabled={g.life >= MAX_LIFE || g.points < price} onClick={() => game.treat()}>
          {price} pts
        </button>
      </li>
    </ul>
  );
}

/** The Mart: sell what you picked (today's special pays double), and make garlands. */
function Mart({ g }: { g: GameState }) {
  const sellable = Object.values(ITEMS).filter((i) => i.sell);
  const special = specialItem();
  const sp = ITEMS[special];
  return (
    <>
      <p className="gp-special">
        Today’s special: {sp.emoji} <b>{sp.name}</b> pays double!
      </p>
      <h3 className="gp-sub">Sell your harvest</h3>
      <ul className="gp-rows">
        {sellable.map((it: Item) => {
          const have = g.inv[it.id] ?? 0;
          const { price, special: isSpecial } = sellPrice(it.id);
          return (
            <li key={it.id} className="gp-row sell">
              <span className="gp-icon" aria-hidden="true">
                {it.emoji}
              </span>
              <span className="gp-text">
                <b>
                  {it.name} <em>×{have}</em>
                </b>
                <small>
                  {price} points each{isSpecial ? ' · special' : ''}
                  {g.owned.map && !isSpecial ? ' · with your map' : ''}
                </small>
              </span>
              <span className="gp-btns">
                <button type="button" disabled={have < 1} onClick={() => game.sell(it.id)}>
                  Sell 1
                </button>
                <button type="button" disabled={have < 1} onClick={() => game.sell(it.id, true)}>
                  All
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <h3 className="gp-sub">Make</h3>
      <ul className="gp-rows">
        {RECIPES.map((r) => {
          const out = ITEMS[r.makes];
          const need = Object.entries(r.needs);
          const can = need.every(([k, n]) => (g.inv[k] ?? 0) >= n);
          return (
            <li key={r.id} className="gp-row">
              <span className="gp-icon" aria-hidden="true">
                {out.emoji}
              </span>
              <span className="gp-text">
                <b>{out.name}</b>
                <small>
                  {need.map(([k, n]) => `${n} ${ITEMS[k].emoji} ${ITEMS[k].name.toLowerCase()}`).join(' + ')} → sells for {out.sell}
                </small>
              </span>
              <button type="button" className="gp-buy" disabled={!can} onClick={() => game.craft(r.id)}>
                Make
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Everything you're carrying, what you're wearing, trading and saving. */
function Bag({ g }: { g: GameState }) {
  const consumables = Object.values(ITEMS).filter((i) => i.kind === 'consumable' && (g.inv[i.id] ?? 0) > 0);
  const produce = Object.values(ITEMS).filter((i) => i.kind === 'produce' && (g.inv[i.id] ?? 0) > 0);
  const gear = Object.values(ITEMS).filter((i) => i.kind === 'gear' && g.owned[i.id]);
  const empty = !consumables.length && !produce.length && !gear.length;
  return (
    <>
      <p className="gp-points">
        🪙 {g.points} points · ❤️ {Math.round(g.life)} of {MAX_LIFE} life
      </p>
      {empty && <p className="gp-greet">Your bag is empty. Pick fruit and flowers from the trees and plants along the footpaths.</p>}
      {consumables.length > 0 && (
        <>
          <h3 className="gp-sub">To use</h3>
          <ul className="gp-rows">
            {consumables.map((it) => (
              <li key={it.id} className="gp-row">
                <span className="gp-icon" aria-hidden="true">
                  {it.emoji}
                </span>
                <span className="gp-text">
                  <b>
                    {it.name} <em>×{g.inv[it.id]}</em>
                  </b>
                  <small>+{it.heal} life</small>
                </span>
                <button type="button" className="gp-buy" onClick={() => game.use(it.id)}>
                  Use
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {produce.length > 0 && (
        <>
          <h3 className="gp-sub">Picked</h3>
          <p className="gp-chips">
            {produce.map((it) => (
              <span key={it.id} className="gp-chip">
                {it.emoji} {it.name} ×{g.inv[it.id]}
              </span>
            ))}
          </p>
          <p className="gp-tip">Sell them at the Fruit & Flower Mart 🧺 for points.</p>
        </>
      )}
      {gear.length > 0 && (
        <>
          <h3 className="gp-sub">Wearing</h3>
          <p className="gp-chips">
            {gear.map((it) => (
              <span key={it.id} className="gp-chip">
                {it.emoji} {it.name}
              </span>
            ))}
          </p>
        </>
      )}
      <TradeForm g={g} />
      <SaveCode />
    </>
  );
}

/** Offer some of what you carry to someone in town, for points. */
function TradeForm({ g }: { g: GameState }) {
  const { roster } = useNet();
  const items = Object.values(ITEMS).filter((i) => (g.inv[i.id] ?? 0) > 0);
  const [to, setTo] = useState('');
  const [item, setItem] = useState('');
  const [qty, setQty] = useState(1);
  const [pts, setPts] = useState(10);
  const [msg, setMsg] = useState('');
  const person = roster.find((p) => p.id === to);
  const chosen = item && items.some((i) => i.id === item) ? item : items[0]?.id ?? '';
  const maxQty = g.inv[chosen] ?? 0;

  return (
    <>
      <h3 className="gp-sub">Trade with someone in town</h3>
      {roster.length === 0 ? (
        <p className="gp-tip">Nobody else is in town right now. Trades go straight to the other person, so they need to be here.</p>
      ) : items.length === 0 ? (
        <p className="gp-tip">Pick or buy something first, then you can offer it.</p>
      ) : (
        <form
          className="gp-trade"
          onSubmit={(e) => {
            e.preventDefault();
            const r = offer(to, chosen, Math.min(Math.max(1, qty), maxQty), Math.max(0, Math.floor(pts)));
            setMsg(r);
          }}
        >
          <label>
            Who
            <select value={to} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Choose…</option>
              {roster.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Give
            <select value={chosen} onChange={(e) => setItem(e.target.value)}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.emoji} {i.name} (×{g.inv[i.id]})
                </option>
              ))}
            </select>
          </label>
          <label>
            How many
            <input type="number" min={1} max={maxQty} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
          </label>
          <label>
            For points
            <input type="number" min={0} value={pts} onChange={(e) => setPts(Number(e.target.value))} />
          </label>
          <button type="submit" className="gp-send" disabled={!to}>
            Send offer{person ? ` to ${person.name}` : ''}
          </button>
          {msg && <p className="gp-tip" role="status">{msg}</p>}
        </form>
      )}
    </>
  );
}

/** Move your progress to another browser: copy the code, or paste one in. */
function SaveCode() {
  const [code, setCode] = useState('');
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <>
      <h3 className="gp-sub">Save code</h3>
      <p className="gp-tip">Your points, life, bag and gear travel in this code. Copy it to play on another browser.</p>
      {code ? (
        <textarea className="gp-code" readOnly value={code} onFocus={(e) => e.currentTarget.select()} aria-label="Your save code" />
      ) : (
        <button type="button" className="gp-buy" onClick={() => setCode(game.saveCode())}>
          Show my save code
        </button>
      )}
      <textarea className="gp-code" placeholder="Paste a save code here" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Save code to load" />
      <button
        type="button"
        className="gp-buy"
        disabled={!paste.trim()}
        onClick={() => {
          const ok = game.loadCode(paste);
          setMsg(ok ? '' : 'That isn’t a save code.');
          if (ok) setPaste('');
        }}
      >
        Load it
      </button>
      {msg && <p className="gp-tip" role="status">{msg}</p>}
    </>
  );
}

/** Who's in town and their points. Live only: nothing is stored. */
function Board() {
  const version = useBoardVersion();
  const rows = useMemo(() => boardRows(net.me()), [version]);
  const me = net.me().id;
  return (
    <>
      <p className="gp-greet">The points of everyone in town right now. It’s live: when someone leaves, they drop off.</p>
      <ol className="gp-rows board">
        {rows.map((r, i) => (
          <li key={r.id} className={`gp-row${r.id === me ? ' me' : ''}`}>
            <span className="gp-icon" aria-hidden="true">
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
            </span>
            <span className="gp-text">
              <b>
                {r.name}
                {r.id === me ? ' (you)' : ''}
              </b>
            </span>
            <span className="gp-buy static">{r.points} pts</span>
          </li>
        ))}
      </ol>
      {rows.length === 1 && <p className="gp-tip">You’re the only one here right now. Say hi!</p>}
    </>
  );
}

