// Web Worker wrapper: keeps parsing and gating off the UI thread.
import { AppError } from '../core/errors';
import { AnalysisService } from '../core/service';

const svc = new AnalysisService();

type Msg = { id: number; op: string; args: unknown[] };

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const { id, op, args } = ev.data;
  try {
    const fn = (svc as unknown as Record<string, (...a: unknown[]) => unknown>)[op];
    if (typeof fn !== 'function') throw new Error(`Unknown operation ${op}`);
    const result = await fn.apply(svc, args);
    const transfer: Transferable[] = [];
    if (result instanceof Uint8Array) transfer.push(result.buffer);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    const err = e instanceof AppError ? { code: e.code, message: e.message } : { code: 'INTERNAL', message: String((e as Error)?.message ?? e) };
    (self as unknown as Worker).postMessage({ id, ok: false, error: err });
  }
};
