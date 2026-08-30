import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { WebDavFileSystem } from "../../../../src/fs/webdav/index.js";

const captured = JSON.parse(await readFile(new URL("./evidence/apache-final/raw.json", import.meta.url), "utf8")) as {
  events: { method: string; status: number; body: string; headers: Record<string, string> }[];
};
const grant = captured.events.find(event => event.method === "LOCK" && event.status === 200)!;
type Mutation = (body: string) => string;
const mixedAfter: Mutation = body => body.replace(/<(\w+:)?exclusive\s*\/>/, (match, prefix) => `${match}<${prefix ?? ""}shared/>`);
const mixedBefore: Mutation = body => body.replace(/<(\w+:)?exclusive\s*\/>/, (match, prefix) => `<${prefix ?? ""}shared/>${match}`);
const duplicate = (name: string): Mutation => body => body.replace(new RegExp(`(<D:${name}(?:>[\\s\\S]*?</D:${name}>|/>))`), "$1$1");
function fixture(mutate: Mutation) {
  const methods: string[] = [];
  const files = new Map([["/source", "SOURCE"], ["/target", "OLD"]]);
  const filesystem = new WebDavFileSystem({ baseUrl: "https://scope.example/dav/", fetch: async (url, init) => {
    const path = new URL(url).pathname.slice(4);
    const method = init.method!;
    methods.push(method);
    if (method === "PROPFIND") return new Response('<d:multistatus xmlns:d="DAV:"><d:response>'
      + `<d:href>/dav${path}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>${files.get(path)!.length}</d:getcontentlength>`
      + `<d:getetag>"${path.slice(1)}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`, { status: 207 });
    if (method === "LOCK") {
      const body = mutate(grant.body);
      const headers = new Headers(grant.headers);
      headers.set("Content-Length", String(Buffer.byteLength(body)));
      const response = new Response(body, { status: 200, headers });
      Object.defineProperty(response, "url", { value: url });
      return response;
    }
    if (method === "UNLOCK") {
      assert.equal(path, "/target"); assert.equal(new Headers(init.headers).get("Lock-Token"), grant.headers["lock-token"]);
      return new Response(null, { status: 204 });
    }
    assert.ok(method === "COPY" || method === "MOVE");
    files.set("/target", files.get("/source")!);
    if (method === "MOVE") files.delete("/source");
    return new Response(null, { status: 204 });
  } });
  return { filesystem, methods, files };
}
const rejectCode = (code: string) => (error: unknown) => { assert.ok(error instanceof FsError); assert.equal(error.code, code); return true; };
const invalid: [string, Mutation, "copyFile" | "rename", string][] = [
  ["contradictory shared and exclusive scope", mixedAfter, "copyFile", "ENOTSUP"],
  ["contradictory shared before exclusive scope", mixedBefore, "copyFile", "ENOTSUP"],
  ["contradictory scope on MOVE", mixedAfter, "rename", "ENOTSUP"],
  ["shared only", body => body.replace("<D:exclusive/>", "<D:shared/>"), "copyFile", "ENOTSUP"],
  ["duplicate exclusive", duplicate("exclusive"), "copyFile", "EIO"],
  ["duplicate active grants", duplicate("activelock"), "copyFile", "EIO"],
  ["duplicate lockdiscovery", duplicate("lockdiscovery"), "copyFile", "EIO"],
  ["duplicate scope", duplicate("lockscope"), "copyFile", "EIO"],
  ["duplicate type", duplicate("locktype"), "copyFile", "EIO"],
  ["duplicate write", duplicate("write"), "copyFile", "EIO"],
  ["unknown type without recognized write", body => body.replace("<D:write/>", "<D:read/>"), "copyFile", "ENOTSUP"],
  ["foreign write cannot replace recognized write", body => body.replace("<D:write/>", '<x:write xmlns:x="urn:extension"/>'), "copyFile", "ENOTSUP"],
  ["duplicate depth", duplicate("depth"), "copyFile", "EIO"],
  ["duplicate token", duplicate("locktoken"), "copyFile", "EIO"],
  ["duplicate token href", duplicate("href"), "copyFile", "EIO"],
  ["duplicate timeout", duplicate("timeout"), "copyFile", "EIO"],
];
for (const [name, mutate, operation, code] of invalid) {
  test(`real-grant reduction rejects ${name} and unlocks before publication`, async () => {
    assert.notEqual(mutate(grant.body), grant.body);
    const { filesystem, files, methods } = fixture(mutate);
    await assert.rejects(filesystem[operation]("/source", "/target"), rejectCode(code));
    assert.deepEqual([...files], [["/source", "SOURCE"], ["/target", "OLD"]]);
    assert.deepEqual(methods, ["PROPFIND", "PROPFIND", "LOCK", "UNLOCK"]);
  });
}
const valid: [string, Mutation][] = [
  ["unchanged legacy grant", body => body],
  ["unknown DAV read alongside write", body => body.replace("<D:write/>", "<D:write/><D:read/>")],
  ["unknown DAV scope child alongside exclusive", body => body.replace("<D:exclusive/>", "<D:future/><D:exclusive/>")],
  ["foreign shared alongside exclusive", body => body.replace("<D:exclusive/>", '<D:exclusive/><x:shared xmlns:x="urn:extension"/>')],
  ["unknown extension containing a shared descendant", body => body.replace("<D:exclusive/>", '<x:extension xmlns:x="urn:extension"><D:shared/></x:extension><D:exclusive/>')],
  ["foreign write alongside recognized write", body => body.replace("<D:write/>", '<D:write/><x:write xmlns:x="urn:extension"/>')],
];
for (const [name, mutate] of valid) for (const operation of ["copyFile", "rename"] as const) {
  test(`valid ${operation} tolerates ${name}`, async () => {
    const { filesystem, files, methods } = fixture(mutate);
    await filesystem[operation]("/source", "/target");
    assert.equal(files.get("/target"), "SOURCE"); assert.equal(files.has("/source"), operation === "copyFile");
    assert.equal(methods.filter(method => method === "UNLOCK").length, 1);
  });
}
