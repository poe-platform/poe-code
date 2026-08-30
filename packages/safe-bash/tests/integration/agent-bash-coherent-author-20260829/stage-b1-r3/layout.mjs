import fs from 'node:fs';
import path from 'node:path';

export function layoutPaths(consumer, layout) {
  if (!['source-built', 'installed', 'physically-moved'].includes(layout) || typeof consumer !== 'string' || !path.isAbsolute(consumer)) throw new Error('B1 layout identity refused');
  const harness = path.join(consumer, 'harness-' + layout);
  return Object.freeze({ harness, scripts: path.join(harness, 'node'), manifest: path.join(harness, 'load-manifest.json'), policy: path.join(harness, 'node-policy.json') });
}

export function createLayoutHarness(consumer, layout) {
  const selected = layoutPaths(consumer, layout);
  fs.mkdirSync(selected.harness);
  fs.mkdirSync(selected.scripts);
  return selected;
}
