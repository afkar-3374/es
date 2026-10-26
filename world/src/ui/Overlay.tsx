import { useEffect } from 'react';
import { ui, useUi } from '../world/interact';
import { isTouch } from '../player/input';

/** Crosshair, "what you're looking at" hint, and the info card. */
export function Overlay() {
  const { hover, card } = useUi();

  // Close the card with Esc / E / Enter; free the mouse while it's open
  useEffect(() => {
    if (!card) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'KeyE', 'Enter', 'Space'].includes(e.code)) ui.showCard(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card]);

  return (
    <>
      {!isTouch && !card && <div className={`crosshair${hover ? ' on' : ''}`} />}
      {hover && !card && <p className="hover-hint">{isTouch ? 'Tap' : 'Click'} · {hover}</p>}
      {card && (
        <div className="card-wrap" onClick={() => ui.showCard(null)}>
          <div className="info-card" role="dialog" aria-label={card.title} onClick={(e) => e.stopPropagation()}>
            {card.emoji && <div className="info-emoji">{card.emoji}</div>}
            <h2>{card.title}</h2>
            <p>{card.text}</p>
            <button type="button" onClick={() => ui.showCard(null)}>
              Okay
            </button>
          </div>
        </div>
      )}
    </>
  );
}
