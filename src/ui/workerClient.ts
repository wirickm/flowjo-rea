import type { AnalysisService } from '../core/service';

type Fn = (...a: never[]) => unknown;
type Async<T> = { [K in keyof T]: T[K] extends Fn ? (...a: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> : never };

export class WorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createAnalysisClient(): Async<AnalysisService> {
  const worker = new Worker(new URL('../worker/analysis.worker.ts', import.meta.url), { type: 'module' });
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else p.reject(new WorkerError(error.code, error.message));
  };
  return new Proxy({} as Async<AnalysisService>, {
    get: (_t, op: string) => (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        const transfer = args.filter((a): a is Uint8Array => a instanceof Uint8Array).map((a) => a.buffer);
        worker.postMessage({ id, op, args }, transfer);
      }),
  });
}
