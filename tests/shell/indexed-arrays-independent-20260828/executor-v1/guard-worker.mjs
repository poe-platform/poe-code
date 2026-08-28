import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { guard, moduleURL } from './boundary.mjs';
const [packetPath] = process.argv.slice(2);
const packet = JSON.parse(readFileSync(packetPath));
try {
  if (packet.nullSource) registerHooks({ load(url, context, next) {
    const result = next(url, context);
    return url === moduleURL(packet.target) ? { ...result, source: null } : result;
  } });
  const loads = guard({ manifest: { packageRoot: packet.packageRoot, harnessRoot: packet.harnessRoot }, allowed: new Map(packet.allowed) }, entry => console.log(JSON.stringify(entry)));
  const imported = await import(moduleURL(packet.target));
  if (imported.synthetic !== 41 || !loads.has(packet.target)) throw new Error('synthetic loaded-body witness missing');
  console.log(JSON.stringify({ syntheticGuard: 'admitted literal fixture only', actualProduct: false }));
} catch (error) { console.log(JSON.stringify({ diagnostic: String(error), actualProduct: false })); process.exitCode = 78; }
