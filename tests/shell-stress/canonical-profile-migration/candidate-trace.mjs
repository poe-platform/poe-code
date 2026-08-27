import childProcess from "node:child_process";
import { register, syncBuiltinESMExports } from "node:module";

const trace = process.env.CANONICAL_PROFILE_TRACE;
if (trace) {
  register(`data:text/javascript,${encodeURIComponent(String.raw`
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.mjs')) && !url.includes('/node_modules/')) {
    const path = fileURLToPath(url);
    appendFileSync(process.env.CANONICAL_PROFILE_TRACE, JSON.stringify({ pid: process.pid, path, hash: createHash('sha256').update(readFileSync(path)).digest('hex'), format: result.format }) + '\n');
  }
  return result;
}
`)}`);
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function spawn(command, args, options) {
    if (command === process.execPath && options?.env) {
      const importOption = `--import=${import.meta.url}`;
      const nodeOptions = options.env.NODE_OPTIONS ?? "";
      options = { ...options, env: { ...options.env, CANONICAL_PROFILE_TRACE: trace, NODE_OPTIONS: nodeOptions.includes(importOption) ? nodeOptions : `${nodeOptions} ${importOption}`.trim() } };
    }
    return originalSpawn(command, args, options);
  };
  syncBuiltinESMExports();
}
