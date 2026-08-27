import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";

interface Capture {
  method: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}
const captured: { events: Capture[] } = JSON.parse(await readFile(new URL("./evidence/apache-final/raw.json", import.meta.url), "utf8"));
const grant = captured.events.find(event => event.method === "LOCK" && event.status === 200)!;
const token = grant.headers["lock-token"]!;
const baseUrl = "https://legacy.example/dav/";
type Change = (response: Response) => Response | Promise<Response>;

function fixture(change: Change = response => response, status = 200) {
  const files = new Map([["/source", "SOURCE"], ["/target", "old"]]);
  const methods: string[] = [];
  const filesystem = new WebDavFileSystem({ baseUrl, fetch: async (url, init) => {
    const path = new URL(url).pathname.slice(4);
    const method = init.method!;
    const headers = new Headers(init.headers);
    methods.push(method);
    assert.equal(init.redirect, "manual"); assert.equal(init.credentials, "omit");
    if (method === "PROPFIND") return new Response('<d:multistatus xmlns:d="DAV:"><d:response>'
      + `<d:href>/dav${path}</d:href><d:propstat><d:prop><d:resourcetype/>`
      + `<d:getcontentlength>${files.get(path)!.length}</d:getcontentlength><d:getetag>"${path.slice(1)}"</d:getetag>`
      + '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>', { status: 207 });
    if (method === "LOCK") {
      assert.equal(path, "/target"); assert.equal(headers.get("if-match"), '"target"');
      assert.equal(headers.get("depth"), "infinity"); assert.match(String(init.body), /lockinfo/);
      return change(new Response(grant.body, { status, headers: { "Lock-Token": token } }));
    }
    if (method === "UNLOCK") {
      assert.equal(path, "/target"); assert.equal(headers.get("lock-token"), token);
      return new Response(null, { status: 204 });
    }
    assert.ok(method === "COPY" || method === "MOVE");
    assert.equal(headers.get("if"), `<${baseUrl}target> (${token})`);
    assert.equal(headers.get("if-match"), '"source"'); assert.equal(headers.get("overwrite"), "T");
    files.set("/target", files.get("/source")!);
    if (method === "MOVE") files.delete("/source");
    return new Response(null, { status: 204 });
  } });
  return { filesystem, files, methods };
}

for (const operation of ["copyFile", "rename"] as const) {
  test(`default ${operation} accepts the captured RFC2518 Apache grant without lockroot`, async () => {
    assert.doesNotMatch(grant.body, /lockroot/);
    const { filesystem, files, methods } = fixture();
    await filesystem[operation]("/source", "/target");
    assert.equal(files.get("/target"), "SOURCE");
    assert.equal(files.has("/source"), operation === "copyFile");
    assert.equal(methods.filter(method => method === "UNLOCK").length, 1);
  });
}

const root = (href: string) => grant.body.replace("</D:activelock>", `<D:lockroot><D:href>${href}</D:href></D:lockroot></D:activelock>`);
test("an explicit matching modern lockroot remains accepted", async () => {
  const { filesystem, files } = fixture(() => new Response(root(`${baseUrl}target`), { headers: { "Lock-Token": token } }));
  await filesystem.copyFile("/source", "/target"); assert.equal(files.get("/target"), "SOURCE");
});

const invalid: [string, string, Record<string, string>][] = [
  ["wrong same-origin root", root(`${baseUrl}source`), { "Lock-Token": token }],
  ["foreign root", root("https://other.example/dav/target"), { "Lock-Token": token }],
  ["out-of-scope root", root("https://legacy.example/else/target"), { "Lock-Token": token }],
  ["explicit empty root", grant.body.replace("</D:activelock>", "<D:lockroot/></D:activelock>"), { "Lock-Token": token }],
  ["root with foreign href", grant.body.replace("</D:activelock>", '<D:lockroot><x:href xmlns:x="urn:foreign">/dav/target</x:href></D:lockroot></D:activelock>'), { "Lock-Token": token }],
  ["duplicate root", root("/dav/target").replace("</D:activelock>", "<D:lockroot><D:href>/dav/target</D:href></D:lockroot></D:activelock>"), { "Lock-Token": token }],
  ["shared", grant.body.replace("<D:exclusive/>", "<D:shared/>"), { "Lock-Token": token }],
  ["wrong type", grant.body.replace("<D:write/>", "<D:read/>"), { "Lock-Token": token }],
  ["depth zero", grant.body.replace("<D:depth>infinity</D:depth>", "<D:depth>0</D:depth>"), { "Lock-Token": token }],
  ["infinite timeout", grant.body.replace(/Second-\d+/, "Infinite"), { "Lock-Token": token }],
  ["zero timeout", grant.body.replace(/Second-\d+/, "Second-0"), { "Lock-Token": token }],
  ["token mismatch", grant.body, { "Lock-Token": "<urn:uuid:other>" }],
  ["unbracketed token", grant.body, { "Lock-Token": token.slice(1, -1) }],
  ["missing token", grant.body, {}],
];
for (const [name, body, headers] of invalid) {
  test(`legacy compatibility rejects ${name} before effects`, async () => {
    const { filesystem, files, methods } = fixture(() => new Response(body, { headers }));
    await assert.rejects(filesystem.copyFile("/source", "/target"));
    assert.deepEqual([...files], [["/source", "SOURCE"], ["/target", "old"]]);
    assert.ok(!methods.includes("COPY") && !methods.includes("PUT"));
  });
}

for (const status of [201, 207, 302, 423]) {
  test(`legacy compatibility rejects HTTP ${status} without transfer`, async () => {
    const { filesystem, files, methods } = fixture(undefined, status);
    await assert.rejects(filesystem.rename("/source", "/target"));
    assert.deepEqual([...files], [["/source", "SOURCE"], ["/target", "old"]]);
    assert.ok(!methods.includes("MOVE"));
  });
}

test("legacy compatibility rejects a transport-changed response URL", async () => {
  const { filesystem, methods } = fixture(response => {
    Object.defineProperty(response, "url", { value: "https://other.example/dav/target" });
    return response;
  });
  await assert.rejects(filesystem.copyFile("/source", "/target"), { code: "EACCES" });
  assert.ok(!methods.includes("COPY"));
});

test("late cancelled legacy grant is unlocked without a transfer", async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const { filesystem, methods, files } = fixture(async response => { enter(); await gate; return response; });
  const checking = assert.rejects(filesystem.copyFile("/source", "/target", { signal: controller.signal }), { code: "ECANCELED" });
  await entered;
  controller.abort();
  try { await checking; }
  finally { release(); }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(methods.filter(method => method === "UNLOCK").length, 1);
  assert.ok(!methods.includes("COPY"));
  assert.deepEqual([...files], [["/source", "SOURCE"], ["/target", "old"]]);
});
