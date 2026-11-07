// A real, separate window for a graph window (FlowJo opens one OS window per
// graph, GWFrame; specs 23). The page renders into a blank child window
// through a React portal; the page's styles are copied in. Returns null when
// the browser blocks the window (the caller then shows it inside the page).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function Popout(p: { id: string; title: string; x: number; y: number; onClose: () => void; onFocus: () => void; onKey: (e: KeyboardEvent) => void; onBlocked: () => void; children: React.ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const winRef = useRef<Window | null>(null);
  const cb = useRef(p);
  cb.current = p;
  useEffect(() => {
    const w = window.open('', `gw-${p.id}`, `width=600,height=720,left=${Math.round(window.screenX + 420 + p.x)},top=${Math.round(window.screenY + 120 + p.y)}`);
    if (!w) { cb.current.onBlocked(); return; }
    winRef.current = w;
    w.document.title = p.title;
    for (const n of Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))) w.document.head.appendChild(n.cloneNode(true));
    w.document.body.className = 'gw-popout';
    const div = w.document.createElement('div');
    div.className = 'gw-popout-root';
    w.document.body.appendChild(div);
    const closed = () => cb.current.onClose();
    const focus = () => cb.current.onFocus();
    const key = (e: KeyboardEvent) => cb.current.onKey(e);
    w.addEventListener('beforeunload', closed);
    w.addEventListener('focus', focus);
    w.addEventListener('mousedown', focus);
    w.addEventListener('keydown', key);
    setHost(div);
    return () => {
      w.removeEventListener('beforeunload', closed);
      w.close();
    };
  }, [p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (winRef.current) winRef.current.document.title = p.title; }, [p.title]);
  return host ? createPortal(p.children, host) : null;
}
