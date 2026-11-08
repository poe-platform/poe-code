import { register } from 'node:module';
register(`data:text/javascript,${encodeURIComponent(`
import { readFileSync } from 'node:fs';
export async function load(url, context, nextLoad) {
  if (url === 'file:///Users/kjopek/Workspace/safe-bash/src/shell/runtime.ts') return { format: 'module', source: readFileSync('/tmp/safe-bash-env-output-baseline-runtime.mjs', 'utf8'), shortCircuit: true };
  return nextLoad(url, context);
}
`)}`);
