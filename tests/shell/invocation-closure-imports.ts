import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { MessageChannel } from "node:worker_threads";

const { port1, port2 } = new MessageChannel();
register(`data:text/javascript,${encodeURIComponent(`
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
let port;
const files = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function initialize(data) {
  port = data.port;
  port.on('message', () => port.postMessage(files));
  port.unref();
}
export async function load(url, context, next) {
  if (!url.includes('/safe-bash/src/')) return next(url, context);
  if (!url.endsWith('.ts')) throw new Error('Non-TS product import: ' + url);
  const before = hash(await readFile(new URL(url)));
  const result = await next(url, context);
  if (before !== hash(await readFile(new URL(url)))) throw new Error('Import changed: ' + url);
  files[url] = before;
  return result;
}
`)}`, import.meta.url, { data: { port: port2 }, transferList: [port2] });

try {
  const { setup } = await import("./helpers.js");
  await import("./invocation-closure-native.js");
  const result = await setup().shell.exec(`sh -c 'VALUE=new :; read -rN2 text; command args "$VALUE" "$text"; pass'`, {
    stdin: Buffer.concat([Buffer.from("é😀"), Buffer.from([0, 255, 128])]), env: { LC_ALL: "en_US.UTF-8" },
  });
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from('["new","é😀"]'), Buffer.from([0, 255, 128])]));
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  const files = await new Promise<Record<string, string>>(resolve => { port1.once("message", resolve); port1.postMessage("snapshot"); });
  for (const [url, hash] of Object.entries(files)) assert.equal(createHash("sha256").update(await readFile(new URL(url))).digest("hex"), hash, url);
  assert.ok(Object.keys(files).some(url => url.endsWith("/src/shell/runtime.ts")));
  assert.ok(Object.keys(files).some(url => url.endsWith("/src/shell/display.ts")));
  console.log(JSON.stringify({ actualTsImports: files, smoke: "sh profile + command dispatch + Unicode read-N + exact binary cursor", passed: true }, null, 2));
} finally { port1.close(); }
