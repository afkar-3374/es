import { useEffect, useState } from 'react';
import { ui, useUi } from '../world/interact';
import { isTouch, typing } from '../player/input';
import { music } from '../audio/music';
import { standUp } from '../world/seats';
import { ride } from '../world/ride';

/** Crosshair, hints, the info card, what you're holding, sitting and riding controls. */
export function Overlay() {
  const { hover, card, book, seated, drink, carrying, toast, riding } = useUi();
  const [, redraw] = useState(0);
  const busy = !!card || !!book;

  // Close the card with Esc / Enter; free the mouse while it's open
  useEffect(() => {
    if (!card) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'Enter'].includes(e.code)) ui.showCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card]);

  // Keys: Q sip · R read the book you carry · E get off / stand up · H horn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ui.get().card || ui.get().book || typing(e)) return;
      if (e.code === 'KeyQ') ui.sip();
      if (e.code === 'KeyR' && ui.get().carrying) ui.readCarried();
      if (e.code === 'KeyE') {
        if (ui.get().riding) ride.dismount();
        else if (ui.get().seated) standUp();
      }
      if (e.code === 'KeyH' && ui.get().riding) ride.honk();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const k = (key: string) => (isTouch ? '' : ` (${key})`);

  return (
    <>
      {!isTouch && !busy && !seated && !riding && <div className={`crosshair${hover ? ' on' : ''}`} />}
      {hover && !busy && <p className="hover-hint">{isTouch ? 'Tap' : 'Click'} · {hover}</p>}

      {/* what's in your hands */}
      {!busy && (drink || carrying) && (
        <div className="hands">
          {drink && (
            <button type="button" onClick={() => ui.sip()}>
              {drink.emoji} Sip{k('Q')} <small>{'●'.repeat(drink.sipsLeft)}{'○'.repeat(Math.max(4 - drink.sipsLeft, 0))}</small>
            </button>
          )}
          {carrying && (
            <>
              <button type="button" onClick={() => ui.readCarried()}>
                📖 Read “{carrying.title}”{k('R')}
              </button>
              <button type="button" className="ghost" onClick={() => ui.returnBook()}>
                Return book
              </button>
            </>
          )}
        </div>
      )}

      {seated && !busy && !riding && (
        <div className="seated">
          <span>You’re sitting down. {isTouch ? 'Drag to look around.' : 'Look around with the mouse.'}</span>
          <button
            type="button"
            onClick={() => {
              if (music.playing) music.stop();
              else music.start();
              redraw((n) => n + 1);
            }}
          >
            {music.playing ? '🎵 Music off' : '🎵 Soft music'}
          </button>
          <button type="button" onClick={() => standUp()}>
            Stand up{k('E')}
          </button>
        </div>
      )}

      {riding && !busy && (
        <div className="seated riding">
          <span>
            {riding.emoji} {riding.name} · <b id="speedo">0 km/h</b> · {isTouch ? 'left thumb: drive & steer' : 'W/S: go & brake · A/D: steer'}
          </span>
          <button type="button" onClick={() => ride.honk()}>
            📯 Horn{k('H')}
          </button>
          <button type="button" onClick={() => ride.dismount()}>
            Get off{k('E')}
          </button>
        </div>
      )}

      {toast && !busy && <p className="toast">{toast}</p>}

      {card && (
        <div className="card-wrap" onClick={() => ui.showCard(null)}>
          <div className="info-card" role="dialog" aria-label={card.title} onClick={(e) => e.stopPropagation()}>
            {card.emoji && <div className="info-emoji">{card.emoji}</div>}
            <h2>{card.title}</h2>
            <p>{card.text}</p>
            {card.actions ? (
              <div className="card-actions">
                {card.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      ui.showCard(null);
                      a.run();
                    }}
                  >
                    {a.label}
                  </button>
                ))}
                <button type="button" className="ghost" onClick={() => ui.showCard(null)}>
                  Maybe later
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => ui.showCard(null)}>
                Okay
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
