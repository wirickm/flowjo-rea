import AnalysisWorker from '../worker/analysis.worker.ts?worker&inline';
import type { AnalysisService } from '../core/service';

type Fn = (...a: never[]) => unknown;
type Async<T> = { [K in keyof T]: T[K] extends Fn ? (...a: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> : never };

export class WorkerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export function createAnalysisClient(): Async<AnalysisService> {
  // Inlined worker (blob URL) so the single-file build also runs from file://.
  const worker = new AnalysisWorker();
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  // A worker that fails to start or crashes must not leave requests hanging.
  worker.onerror = (ev) => {
    ev.preventDefault();
    const err = new WorkerError('WORKER_FAILED', `Analysis worker failed: ${ev.message || 'could not start (see browser console)'}`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker.onmessageerror = () => {
    for (const p of pending.values()) p.reject(new WorkerError('WORKER_FAILED', 'Analysis worker sent an unreadable message'));
    pending.clear();
  };
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
