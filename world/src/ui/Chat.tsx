import { useEffect, useRef, useState } from 'react';
import { MAX_CHAT, net, useNet } from '../net/net';
import { isTouch, typing } from '../player/input';
import { useUi } from '../world/interact';

const FADE_AFTER = 20000; // ms: old lines fade away while the chat is closed

/** Lock the mouse back to the world after typing (allowed right after a key press). */
function relock() {
  if (isTouch) return;
  try {
    const r = document.querySelector('canvas')?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    r?.catch?.(() => {});
  } catch {
    /* fine */
  }
}

/** Town chat: recent lines in the corner; Enter (or 💬) to say something to everyone. */
export function Chat() {
  const { chat, status } = useNet();
  const { book, card } = useUi();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [, tick] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Enter or T opens the chat box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || typing(e) || book || card) return;
      if (e.code === 'Enter' || e.code === 'KeyT' || e.code === 'Slash') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, book, card]);

  useEffect(() => {
    if (!open) return;
    if (document.pointerLockElement) document.exitPointerLock();
    field.current?.focus();
  }, [open]);

  // keep the newest line in view, and let old ones fade
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
    const t = window.setTimeout(() => tick((n) => n + 1), FADE_AFTER + 50);
    return () => clearTimeout(t);
  }, [chat, open]);

  const close = (lock: boolean) => {
    setOpen(false);
    setText('');
    field.current?.blur();
    if (lock) relock();
  };

  const now = Date.now();
  const shown = open ? chat : chat.filter((l) => now - l.at < FADE_AFTER).slice(-6);
  if (book) return null;

  return (
    <div className={`chat${open ? ' open' : ''}`}>
      {shown.length > 0 && (
        <div className="chat-lines" ref={list} aria-live="polite">
          {shown.map((l) => (
            <p key={l.id} className={l.from ? (l.mine ? 'mine' : '') : 'note'}>
              {l.from && <b>{l.name}</b>}
              {l.text}
            </p>
          ))}
        </div>
      )}
      {open ? (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) net.say(text);
            close(true);
          }}
        >
          <input
            ref={field}
            value={text}
            maxLength={MAX_CHAT}
            placeholder={status === 'online' ? 'Say something to everyone…' : 'Connecting to town…'}
            enterKeyHint="send"
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close(false);
            }}
          />
          <button type="submit">Send</button>
        </form>
      ) : (
        <button type="button" className="chat-open" onClick={() => setOpen(true)}>
          💬 {isTouch ? 'Chat' : 'Chat (Enter)'}
        </button>
      )}
    </div>
  );
}
