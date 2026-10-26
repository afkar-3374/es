import { useEffect } from 'react';
import { ui, useUi } from '../world/interact';
import { isTouch } from '../player/input';
import { world } from '../world/state';
import { music } from '../audio/music';
import { useState } from 'react';

/** Crosshair, "what you're looking at" hint, and the info card. */
export function Overlay() {
  const { hover, card, book, seated } = useUi();
  const [, redraw] = useState(0);

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
      {!isTouch && !card && !book && !seated && <div className={`crosshair${hover ? ' on' : ''}`} />}
      {hover && !card && !book && <p className="hover-hint">{isTouch ? 'Tap' : 'Click'} · {hover}</p>}
      {seated && !card && !book && (
        <div className="seated">
          <span>You’re sitting by the window. {isTouch ? 'Drag to look around.' : 'Look around with the mouse.'}</span>
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
          <button
            type="button"
            onClick={() => {
              const s = world.seat;
              if (s) world.seat = { ...s, eye: s.eye }; // the player stands up on the next step
              import('../player/input').then(({ input }) => {
                input.joystick.y = 1;
                setTimeout(() => (input.joystick.y = 0), 120);
              });
            }}
          >
            Stand up
          </button>
        </div>
      )}
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
