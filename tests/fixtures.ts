import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FK = join(__dirname, '..', 'fixtures', 'flowkit', 'data');
export const haveFixtures = existsSync(FK);
if (!haveFixtures) console.warn('SKIPPED: reference fixtures missing; run scripts/fetch-fixtures.sh');
export const fk = (p: string) => join(FK, p);
export const readBytes = (p: string) => new Uint8Array(readFileSync(fk(p)));
export const readText = (p: string) => readFileSync(fk(p), 'utf8');
