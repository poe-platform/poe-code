import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, save } from '../execution-prep-v1/artifacts.mjs';
const root = '/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm';
const files = inventory(root);
for (const [name, entry] of Object.entries(files)) if (entry.link) assert.ok(realpathSync(join(root, name)).startsWith(root + '/'), 'tool link stays in authenticated npm');
save(fileURLToPath(new URL('./NPM-TOOLS.json', import.meta.url)), { role: 'trusted build/pack/install tool, not product import source', root, version: JSON.parse(readFileSync(join(root, 'package.json'))).version, files });
