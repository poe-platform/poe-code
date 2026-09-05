import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../src/contracts/index.js";
import { settings } from "../../src/commands/table-text/internal.js";
import { fixture, runTable } from "./table-text/helpers.js";

for (const mode of ["explicit", "default", "auto", "header", "unpaired"] as const) {
  test(`join ${mode} admits rendering work before publishing a row`, async () => {
    const format = Array(32).fill("1.2").join(",");
    const wide = `a ${Array(32).fill("x").join(" ")}\n`;
    const args = mode === "default" ? [] : ["-o", mode === "auto" ? "auto" : format];
    if (mode === "header") args.push("--header");
    if (mode === "unpaired") args.push("-v1", "--nocheck-order");
    const specimen = fixture("join", [...args, "left", "right"], {
      left: mode === "default" || mode === "auto" ? wide : "a x\n",
      right: mode === "unpaired" ? "z y\n" : "a y\n",
    });
    const actual = await runTable(specimen, { limits: { maxSteps: 32 } });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stderr, "join: EFBIG: table-text step limit exceeded\n");
    assert.equal(actual.stdoutHex, "");
  });
}

test("join narrow formatting remains accepted under the same small step budget", async () => {
  const actual = await runTable(fixture("join", ["-o", "0,1.2,2.2", "left", "right"], {
    left: "a x\n", right: "a y\n",
  }), { limits: { maxSteps: 32 } });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdoutHex, Buffer.from("a x y\n").toString("hex"));
});

for (const reason of [null, false, 0, ""]) {
  test(`join wide rendering yields to cancellation with reason ${JSON.stringify(reason)}`, async () => {
    const controller = new AbortController();
    let writes = 0;
    const running = runTable(fixture("join", ["-o", Array(128).fill("1.2").join(","), "left", "right"], {
      left: "a x\n", right: "a y\n",
    }), {}, { signal: controller.signal, stdout: { async write() { writes++; } } });
    const rejected = assert.rejects(running, error => Object.is(error, reason));
    const scheduled = setImmediate(() => controller.abort(reason));
    try { await rejected; } finally { clearImmediate(scheduled); }
    assert.equal(writes, 0);
  });
}

for (const maxSteps of [25, 26]) {
  test(`join exact render boundary ${maxSteps} preserves complete accepted rows`, async () => {
    const actual = await runTable(fixture("join", ["-o", "1.2,2.2,1.2,2.2", "left", "right"], {
      left: "a x\nb p\n", right: "a y\nb q\n",
    }), { limits: { maxSteps } });
    assert.equal(actual.exitCode, maxSteps === 26 ? 0 : 1);
    assert.equal(actual.stderr, maxSteps === 26 ? "" : "join: EFBIG: table-text step limit exceeded\n");
    assert.equal(actual.stdoutHex, Buffer.from(maxSteps === 26 ? "x y x y\np q p q\n" : "x y x y\n").toString("hex"));
  });
}

for (const maxSteps of [25, 43]) {
  test(`join duplicate-key Cartesian rendering charges every row at ${maxSteps} steps`, async () => {
    const actual = await runTable(fixture("join", ["-o", "1.2,2.2,1.2,2.2", "left", "right"], {
      left: "a x\na p\n", right: "a y\na q\n",
    }), { limits: { maxSteps } });
    assert.equal(actual.exitCode, maxSteps === 43 ? 0 : 1);
    assert.equal(actual.stderr, maxSteps === 43 ? "" : "join: EFBIG: table-text step limit exceeded\n");
    const expected = "x y x y\nx q x q\n" + (maxSteps === 43 ? "p y p y\np q p q\n" : "");
    assert.equal(actual.stdoutHex, Buffer.from(expected).toString("hex"));
  });
}

test("join retains output and field caps independently of render steps", async () => {
  assert.equal(settings({}).maxFields, 65_536);
  assert.equal(settings({}).maxSteps, 2_000_000);
  const specimen = fixture("join", ["-o", "1.2,2.2,1.2,2.2", "left", "right"], {
    left: "a x\nb p\n", right: "a y\nb q\n",
  });
  const output = await runTable(specimen, { limits: { maxOutputBytes: 8, maxFields: 4 } });
  assert.equal(output.exitCode, 1);
  assert.equal(output.stderr, "join: EFBIG: table-text output limit exceeded\n");
  assert.equal(output.stdoutHex, Buffer.from("x y x y\n").toString("hex"));
  const fields = await runTable(specimen, { limits: { maxFields: 3 } });
  assert.equal(fields.exitCode, 1);
  assert.equal(fields.stderr, "join: EFBIG: table-text field limit exceeded\n");
  assert.equal(fields.stdoutHex, "");
});

test("join still accepts more than 1024 explicit fields under existing defaults", async () => {
  const actual = await runTable(fixture("join", ["-o", Array(1025).fill("1.2").join(","), "left", "right"], {
    left: "a x\n", right: "a y\n",
  }));
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdoutHex, Buffer.from(`${Array(1025).fill("x").join(" ")}\n`).toString("hex"));
});

test("join preserves invalid bytes, NUL rows, replacement and reused producer ownership", async () => {
  const fragment = Buffer.from([97, 58, 255, 58, 0]);
  let closed = false;
  const stdin = (async function* () {
    try { yield fragment; } finally { fragment.fill(88); closed = true; }
  })();
  const specimen = fixture("join", ["-z", "-t", ":", "-e", "M", "-o", "0,1.2,2.2,1.3,2.3", "-", "right"]);
  const actual = await runTable({ ...specimen, files: { right: "613a803a7100" } }, {}, { stdin });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(actual.stdoutHex, "613aff3a803a4d3a7100");
  assert.equal(closed, true);
  assert.deepEqual(fragment, Buffer.alloc(5, 88));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("join awaits a blocked sink without reading ahead or changing borrowed output bytes", async () => {
  const blocked = deferred(), release = deferred();
  let reads = 0, closed = false;
  const stdin = (async function* () {
    try {
      for (const text of ["a x\n", "b p\n", "c r\n"]) { reads++; yield Buffer.from(text); }
    } finally { closed = true; }
  })();
  const writes: Uint8Array[] = [];
  const running = runTable(fixture("join", ["-", "right"], { right: "a y\nb q\nc s\n" }), {}, {
    stdin, stdout: { async write(bytes) {
      writes.push(bytes);
      if (writes.length === 1) {
        blocked.resolve();
        await release.promise;
        assert.deepEqual(bytes, Buffer.from("a"));
      }
    } },
  });
  await blocked.promise;
  try {
    assert.equal(reads, 2);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reads, 2);
    assert.equal(writes.length, 1);
  } finally { release.resolve(); }
  const actual = await running;
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.equal(Buffer.concat(writes).toString(), "a x y\nb p q\nc r s\n");
  assert.equal(closed, true);
});

for (const reason of [null, false, 0, ""]) {
  test(`join blocked output preserves cancellation reason ${JSON.stringify(reason)} and cleanup`, async () => {
    const blocked = deferred(), controller = new AbortController();
    let closed = false;
    const stdin = (async function* () {
      try { yield Buffer.from("a x\nb p\n"); } finally { closed = true; }
    })();
    const running = runTable(fixture("join", ["-", "right"], { right: "a y\nb q\n" }), {}, {
      stdin, signal: controller.signal,
      stdout: { async write() { blocked.resolve(); await new Promise<void>(() => {}); } },
    });
    const rejected = assert.rejects(running, error => Object.is(error, reason));
    await blocked.promise;
    controller.abort(reason);
    await rejected;
    assert.equal(closed, true);
  });
}

test("join sink failure retains the accepted byte prefix and closes its producer", async () => {
  const controller = new AbortController();
  let closed = false, writes = 0;
  const accepted: Uint8Array[] = [];
  const stdin = (async function* () {
    try { yield Buffer.from("a x\nb p\n"); } finally { closed = true; }
  })();
  const actual = await runTable(fixture("join", ["-", "right"], { right: "a y\nb q\n" }), {}, {
    stdin, signal: controller.signal, stdout: { async write(bytes) {
      if (++writes === 2) throw new FsError("EPIPE", { message: "sink stopped" });
      accepted.push(bytes.slice());
    } },
  });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stderr, "join: EPIPE: sink stopped\n");
  assert.equal(Buffer.concat(accepted).toString(), "a");
  assert.equal(writes, 2);
  assert.equal(closed, true);
  assert.equal(controller.signal.aborted, false);
});
