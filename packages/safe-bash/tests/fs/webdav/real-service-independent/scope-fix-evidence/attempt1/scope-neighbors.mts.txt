import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FsError, WebDavFileSystem } from "virtual-bash";
import type { WebDavFetch } from "virtual-bash/fs/webdav";
import { createApplication, type LiteralConfiguration } from "./example.mjs";
import type { WireObservation } from "./https.mjs";

const config: LiteralConfiguration = JSON.parse(await readFile(process.argv[2]!, "utf8"));
const evidence = process.argv[3]!;
const provider = process.argv[4]!;
const events: WireObservation[] = [];
const app = await createApplication(config, events);
const sourceBytes = new Uint8Array([0, 255, 195, 169, 10]);
const targetBytes = new Uint8Array([79, 76, 68]);
const exclusive = /<(?:\w+:)?exclusive\s*\/>/;
type Vector = { name: string; code?: string; mutate: (body: string, targetUrl: string) => string };
const vectors: Vector[] = [
  { name: "alternate DAV prefix shared", code: "ENOTSUP", mutate: body => body.replace(exclusive, '$&<neighbor:shared xmlns:neighbor="DAV:"/>') },
  { name: "default DAV namespace shared", code: "ENOTSUP", mutate: body => body.replace(exclusive, '$&<shared xmlns="DAV:"/>') },
  { name: "foreign shared extension", mutate: body => body.replace(exclusive, '$&<shared xmlns="urn:independent:extension"/>') },
  { name: "nested DAV shared inside ignored extension", mutate: body => body.replace(exclusive, '$&<ext:wrapper xmlns:ext="urn:independent:extension"><shared xmlns="DAV:"/></ext:wrapper>') },
  { name: "unknown DAV scope extension", mutate: body => body.replace(exclusive, '$&<futureScope xmlns="DAV:"/>') },
  { name: "duplicate exclusive different prefix", code: "EIO", mutate: body => body.replace(exclusive, '$&<neighbor:exclusive xmlns:neighbor="DAV:"/>') },
  { name: "foreign exclusive cannot replace DAV exclusive", code: "ENOTSUP", mutate: body => body.replace(exclusive, '<exclusive xmlns="urn:independent:extension"/>') },
  { name: "matching modern root cannot rescue mixed scope", code: "ENOTSUP", mutate: (body, targetUrl) => body
    .replace(/<(?:\w+:)?lockroot>[\s\S]*?<\/(?:\w+:)?lockroot>/, "")
    .replace(exclusive, '$&<shared xmlns="DAV:"/>')
    .replace(/<\/(?:\w+:)?activelock>/, `<lockroot xmlns="DAV:"><href>${targetUrl}</href></lockroot>$&`) },
];
const rows: object[] = [];
let sequence = 0;
for (const vector of vectors) for (const method of ["copyFile", "rename"] as const) {
  const source = `/neighbor-${++sequence}-source`, target = `/neighbor-${sequence}-target`;
  const targetUrl = new URL(target.slice(1), config.baseUrl).href;
  await app.native.writeFile(source, sourceBytes);
  await app.native.writeFile(target, targetBytes);
  const stable = Date.now() - 10000;
  await app.native.utimes(source, stable, stable);
  await app.native.utimes(target, stable, stable);
  const start = events.length;
  let grant: { status: number; token: string | null; original: string; modified: string } | undefined;
  const fetch: WebDavFetch = async (url, init) => {
    const response = await app.fetch(url, init);
    if (init.method !== "LOCK") return response;
    const original = await response.text();
    const modified = vector.mutate(original, targetUrl);
    grant = { status: response.status, token: response.headers.get("Lock-Token"), original, modified };
    const headers = new Headers(response.headers);
    headers.set("Content-Length", String(Buffer.byteLength(modified)));
    const altered = new Response(modified, { status: response.status, headers });
    Object.defineProperty(altered, "url", { value: response.url });
    return altered;
  };
  const filesystem = new WebDavFileSystem({ baseUrl: config.baseUrl, fetch, headers: { Authorization: config.authorization }, timeoutMs: 2000 });
  let productError: unknown;
  let assertionError: unknown;
  try {
    try { await filesystem[method](source, target); } catch (error) { productError = error; }
    assert.ok(grant);
    assert.equal(grant.status, 200);
    assert.notEqual(grant.modified, grant.original, "mutation must reach a genuine successful grant");
    if (vector.code) {
      assert.ok(productError instanceof FsError);
      assert.equal(productError.code, provider === "apache" ? vector.code : "EIO");
      assert.deepEqual(await app.native.readFile(source), sourceBytes);
      assert.deepEqual(await app.native.readFile(target), targetBytes);
      assert.ok(!events.slice(start).some(event => event.method === "COPY" || event.method === "MOVE"));
      if (provider === "apache") assert.ok(events.slice(start).some(event => event.method === "UNLOCK" && event.status === 204));
    } else {
      assert.equal(productError, undefined);
      assert.deepEqual(await app.native.readFile(target), sourceBytes);
      if (method === "rename") await assert.rejects(app.native.stat(source), (error: unknown) => error instanceof FsError && error.code === "ENOENT");
      else assert.deepEqual(await app.native.readFile(source), sourceBytes);
    }
  } catch (error) { assertionError = error; }
  const witnesses: Record<string, unknown> = {};
  for (const path of [source, target]) {
    try { witnesses[path] = [...await readFile(`${config.serverRoot}${path}`)]; }
    catch (error) { witnesses[path] = { error: (error as NodeJS.ErrnoException).code }; }
  }
  const record = {
    name: `${method}: ${vector.name}`, kind: vector.code ? "guard" : "positive",
    result: assertionError ? "fail" : "pass", expectedCode: vector.code,
    parserCoverageMasked: provider !== "apache" && productError instanceof FsError && productError.code === "EIO",
    productError: productError instanceof FsError ? { code: productError.code, message: productError.message } : undefined,
    assertionError: assertionError instanceof Error ? { message: assertionError.message, stack: assertionError.stack } : undefined,
    grant, events: events.slice(start), witnesses,
  };
  rows.push(record);
  console.log(JSON.stringify({ name: record.name, result: record.result, parserCoverageMasked: record.parserCoverageMasked }));
  if (grant?.token) {
    const token = grant.token.startsWith("<") ? grant.token : `<${grant.token}>`;
    const cleanup = await app.fetch(targetUrl, { method: "UNLOCK", headers: { Authorization: config.authorization, "Lock-Token": token }, redirect: "manual" });
    await cleanup.body?.cancel();
    Object.assign(record, { manualCleanupOnly: { status: cleanup.status } });
  }
}
await writeFile(`${evidence}/scope-neighbors.json`, JSON.stringify({ provider, rows }, null, 2));
