// Script Editor worker (docs/validation/ui-gaps/workspace.md, SCRIPTEDITOR):
// runs FlowJo scripts (JavaScript) off the UI thread, against the scripting
// API over a workspace snapshot (src/core/scriptApi.ts). The worker cannot
// reach the page or the app state; changes come back as operations. The
// console's variables live in this worker's global scope, so they persist
// between commands until the worker is stopped.
import { newCtx, runConsole, runScript, type ScriptCtx, type ScriptSnapshot } from '../core/scriptApi';

type Msg = { id: number; mode: 'run' | 'console'; code: string; writer: string; snapshot: ScriptSnapshot; cache: Record<string, number> };

const post = (self as unknown as Worker).postMessage.bind(self);
// One context object for the session: API objects kept in console variables
// point at it, so it is refilled rather than replaced.
const ctx = {} as ScriptCtx;

self.onmessage = (ev: MessageEvent<Msg>) => {
  const { id, mode, code, writer, snapshot, cache } = ev.data;
  Object.assign(ctx, newCtx(snapshot, cache, writer));
  if (mode === 'run') runScript(code, ctx);
  else runConsole(code, ctx, self as unknown as Record<string, unknown>);
  post({ id, out: ctx.out, ops: ctx.ops, effects: ctx.effects, missing: [...ctx.missing.values()] });
};
