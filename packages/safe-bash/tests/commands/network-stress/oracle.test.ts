import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEvidence } from "./evidence.js";
import { createLab } from "./lab.js";
import { assertNative } from "./native.js";
import { binary, contractRows, rows } from "./rows.js";
import { loopbackTransport } from "./transport.js";

const evidence = await loadEvidence();

function assertPipeDiagnostic(code: number | null, stderr: string): void {
  if (code === 23) assert.match(stderr, /writ/i, "Native pipe write failure needs a write diagnostic");
  if (code === 28) assert.match(stderr, /timed? ?out|timeout/i, "Native stalled pipe needs a timeout diagnostic");
}

test("frozen provenance, denominator, byte vectors, and independent invariants", () => {
  assert.equal(evidence.handoffObserved, false);
  assert.equal(evidence.productRuns, 0);
  assert.equal(rows.length, 58);
  assert.equal(contractRows.length, 2);
  assert.equal(new Set(rows.map((row) => row.id)).size, 58);
  assert.deepEqual(evidence.observations.map((row) => row.id), rows.map((row) => row.id));
  assert.deepEqual(evidence.counts, { nativeRows: 58, nativeCurlTransfers: 58, nativeCurlVersionCalls: 1, nativeHeadCalls: 2, httpRequests: 68, virtualOnlyRows: 2, totalVirtualPending: 60 });
  const find = (id: string) => {
    const found = evidence.observations.find((row) => row.id === id);
    assert(found);
    return found;
  };
  for (const row of rows) {
    const observation = find(row.id);
    assertNative(row, observation);
    if (row.mode === "head") assertPipeDiagnostic(observation.code, observation.stderr);
  }
  for (const id of ["binary-file", "binary-stdin", "upload-file-put", "upload-stdin-put"]) assert.equal(find(id).traces[0]?.body, binary.toString("base64"));
  assert.equal(find("binary-download").stdout, binary.toString("base64"));
  assert.equal(find("binary-output-overwrite").files["result.bin"], binary.toString("base64"));
  for (const status of [301, 302, 303, 307, 308]) {
    const requests = find(`post-redirect-${status}`).traces;
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[1]?.method, status < 307 ? "GET" : "POST");
    assert.equal(requests[1]?.body, status < 307 ? "" : Buffer.from("payload").toString("base64"));
  }
  for (const id of ["cross-port-basic", "cross-host-basic", "cross-port-bearer", "cross-port-custom-auth"]) {
    const requests = find(id).traces;
    assert(requests[0]?.headers.some(([name]) => name === "authorization"));
    assert(!requests[1]?.headers.some(([name]) => name === "authorization"));
  }
  assert(find("same-origin-auth").traces[1]?.headers.some(([name]) => name === "authorization"));
  assert.equal(find("retry-post-effect").traces.length, 2);
  assert(find("retry-post-effect").traces.every((trace) => trace.body === Buffer.from("effect").toString("base64")));
  assert.equal(find("retry-get").stdout, Buffer.from("retry-body\nok\n").toString("base64"));
  assert.equal(find("retry-output-reset").files["result.bin"], Buffer.from("ok\n").toString("base64"));
  assert.equal(find("disconnect-output").files["result.bin"], Buffer.from("prefix\n").toString("base64"));
  assert.equal(find("timeout-partial").stdout, Buffer.from("prefix\n").toString("base64"));
  assert.equal(find("http404-fail").stdout, "");
  assert.equal(find("http404-fail-body").stdout, find("http404-default").stdout);
  assert(find("header-crlf-injection").traces[0]?.headers.some(([name]) => name === "x-injected"));
});

test("fixture authorization rejects external, userinfo, wrong ports and protocols", async () => {
  const lab = await createLab();
  try {
    for (const origin of Object.values(lab.origins)) assert(lab.allow(`${origin}/echo`));
    for (const url of ["https://example.com/", "http://127.0.0.1:1/", "file:///etc/passwd", "ftp://127.0.0.1/", lab.origins.A.replace("http://", "http://user:pass@"), "not-a-url"]) assert(!lab.allow(url));
  } finally { await lab.close(); }
});

test("injected loopback transport preserves binary uploads and downloads", { timeout: 3000 }, async () => {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  try {
    const response = await injected.transport({ url: `${lab.origins.A}/bytes`, method: "POST", headers: [["X-Probe", "first"], ["x-probe", "second"]], body: (async function* () { yield binary; })(), signal: AbortSignal.timeout(1500) });
    const chunks: Buffer[] = [];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), binary);
    assert.equal(lab.traces[0]?.body, binary.toString("base64"));
    assert.deepEqual(lab.traces[0]?.headers.filter(([name]) => name.toLowerCase() === "x-probe"), [["X-Probe", "first"], ["x-probe", "second"]]);
    await response.dispose();
    await lab.waitForIdle();
  } finally { await injected.close(); await lab.close(); }
});

test("injected transport observes active abort with no response headers", { timeout: 3000 }, async () => {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  const controller = new AbortController();
  try {
    const pending = injected.transport({ url: `${lab.origins.A}/hang`, method: "GET", headers: [], signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]) });
    const rejected = assert.rejects(pending, { name: "AbortError" });
    await Promise.race([lab.waitForRequest(), pending.then(() => { throw new Error("Unexpected response"); })]);
    controller.abort(new Error("fixture abort"));
    await rejected;
    await lab.waitForIdle();
  } finally { controller.abort(); await injected.close(); await lab.close(); }
});

test("injected transport disposes stalled response before server completion", { timeout: 3000 }, async () => {
  const lab = await createLab();
  const injected = loopbackTransport(lab);
  try {
    const response = await injected.transport({ url: `${lab.origins.A}/stall`, method: "GET", headers: [], signal: AbortSignal.timeout(1500) });
    const first = await response.body[Symbol.asyncIterator]().next();
    assert.equal(Buffer.from(first.value as Uint8Array).toString(), "prefix\n");
    await response.dispose();
    await lab.waitForIdle();
  } finally { await injected.close(); await lab.close(); }
});
