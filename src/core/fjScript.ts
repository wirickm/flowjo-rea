// FlowJo 10.6.2 scripts (docs/validation/ui-gaps/workspace.md, SCRIPTEDITOR):
// the script list kept in the workspace (ScriptEditorController, FJScript),
// its .wsp form (<Scripts><Script lang name>text</Script></Scripts>), .fjs
// files and the console's command history.
import { uniqueName } from './model';

// FJScript: name, language (FlowJo only runs "text/javascript") and text.
export interface FJScript {
  name: string;
  lang: string;
  script: string;
}

export const JAVASCRIPT = 'text/javascript';
// plat.scripteditor.NEW_SCRIPT_NAME is "New Script" plus trailing blanks in
// FlowJo's dictionary; this app trims them (imported names stay verbatim).
export const NEW_SCRIPT_NAME = 'New Script';
export const CONSOLE_NAME = 'FlowJo Scripting Console';
export const WELCOME_MSG = 'Welcome to the FlowJo core';
export const SCRIPT_EXT = '.fjs';
// ScriptConsoleThread keeps at most 150 commands; ScriptView's console keeps
// the last 2000 outputs (RollingBuffer).
export const MAX_HISTORY = 150;
export const MAX_CONSOLE = 2000;

// ScriptEditorController.newScript: NameUtil.uniqueName over the list.
export function newScript(existing: FJScript[]): FJScript {
  return { name: uniqueName(NEW_SCRIPT_NAME, existing.map((s) => s.name)), lang: JAVASCRIPT, script: '' };
}

// FJScript.getPresentationString: "name (N lines)", N = newline count + 1.
export function scriptLines(s: FJScript): number {
  return s.script ? s.script.split('\n').length : 0;
}
export function presentation(s: FJScript): string {
  return `${s.name.trim() || NEW_SCRIPT_NAME} (${scriptLines(s)} lines)`;
}

export const isEmptyScript = (s: FJScript) => !s.script.trim();

// ScriptEditorController.saveToFiles: FileUtil.removeUnsafeChars (/ and \
// become _) then FileUtil.ensureValidExtension(.fjs).
export function scriptFileName(name: string): string {
  const safe = (name.trim() || NEW_SCRIPT_NAME).replace(/[/\\]/g, '_');
  return safe.toLowerCase().endsWith(SCRIPT_EXT) ? safe : `${safe}${SCRIPT_EXT}`;
}

// loadScripts: the file text, named after the file without its extension.
export function scriptFromFile(fileName: string, text: string): FJScript {
  const dot = fileName.lastIndexOf('.');
  return { name: dot > 0 ? fileName.slice(0, dot) : fileName, lang: JAVASCRIPT, script: text.replace(/\r\n?/g, '\n') };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ScriptEditorController.getElement / FJScript.getElement.
export function scriptsXml(scripts: FJScript[] | undefined): string {
  if (!scripts?.length) return '';
  return `<Scripts>${scripts.map((s) => `<Script lang="${esc(s.lang || JAVASCRIPT)}" name="${esc(s.name)}"${s.script ? `>${esc(s.script)}</Script>` : ' />'}`).join('')}</Scripts>\n`;
}

// FJScript.setElement: lang defaults to text/javascript.
export function parseScriptElements(els: { lang?: string; name?: string; text: string }[]): FJScript[] {
  return els.map((e) => ({ name: e.name ?? '', lang: e.lang || JAVASCRIPT, script: e.text }));
}

// Console history (ScriptConsoleThread.addToQueue / consoleHistory): empty
// commands and a repeat of the last command are not added; at most 150 kept.
// Up / Down move through it, pinned at both ends.
export class ConsoleHistory {
  items: string[] = [];
  pos = 0;
  add(cmd: string) {
    if (cmd.trim() && this.items[this.items.length - 1] !== cmd) {
      this.items.push(cmd);
      if (this.items.length > MAX_HISTORY) this.items.shift();
    }
    this.pos = this.items.length;
  }
  move(delta: number): string {
    if (!this.items.length) return '';
    this.pos = Math.max(0, Math.min(this.items.length - 1, this.pos + delta));
    return this.items[this.pos];
  }
}
