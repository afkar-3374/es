import { useEffect, useState } from 'react';
import { ui, useUi } from '../world/interact';

/**
 * The book you took off the shelf, opened in the site's own book reader
 * (same page turns, contents and sound as the classic site).
 */
export function BookReader() {
  const { book, reading } = useUi();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!book) setLoaded(false);
    if (book && document.pointerLockElement) document.exitPointerLock();
  }, [book]);

  // Esc puts the book back (when the focus is out here, not inside the book)
  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.putBookBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reading]);

  if (!book || !reading) return null;
  return (
    <div className="reader" role="dialog" aria-label={`Reading ${book.title}`}>
      <div className="reader-frame">
        {!loaded && <p className="reader-loading">Opening “{book.title}”…</p>}
        <iframe title={book.title} src={book.url} onLoad={() => setLoaded(true)} style={{ opacity: loaded ? 1 : 0 }} allow="autoplay" />
      </div>
      <button type="button" className="reader-close" onClick={() => ui.putBookBack()}>
        ✕ Put the book back
      </button>
    </div>
  );
}
