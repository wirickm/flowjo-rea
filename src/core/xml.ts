// Minimal namespace-tolerant XML helpers over @xmldom/xmldom (works in Node
// and in workers, where DOMParser is unavailable).
import { DOMParser } from '@xmldom/xmldom';
import { fail } from './errors';

export type El = Element;

export function parseXml(text: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: { warning: () => {}, error: (m) => errors.push(String(m)), fatalError: (m) => errors.push(String(m)) },
  }).parseFromString(text, 'text/xml');
  if (errors.length || !doc.documentElement) fail('XML_INVALID', `XML could not be parsed: ${errors[0] ?? 'no root element'}`);
  return doc;
}

export const local = (e: Node) => (e as Element).localName ?? (e.nodeName.split(':').pop() as string);

export function kids(e: El, name?: string): El[] {
  const out: El[] = [];
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || local(n) === name)) out.push(n as El);
  }
  return out;
}

export function kid(e: El, name: string): El | undefined {
  return kids(e, name)[0];
}

export function descendants(e: El, name: string): El[] {
  const out: El[] = [];
  const walk = (x: El) => {
    for (const k of kids(x)) {
      if (local(k) === name) out.push(k);
      walk(k);
    }
  };
  walk(e);
  return out;
}

// Attribute by local name, ignoring namespace prefix.
export function attr(e: El, name: string): string | undefined {
  for (let i = 0; i < e.attributes.length; i++) {
    const a = e.attributes[i];
    if ((a.localName ?? a.name.split(':').pop()) === name) return a.value;
  }
  return undefined;
}

export function numAttr(e: El, name: string): number | undefined {
  const v = attr(e, name);
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) fail('XML_INVALID', `Attribute ${name}="${v}" is not a number`);
  return n;
}

export function text(e: El): string {
  return (e.textContent ?? '').trim();
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
