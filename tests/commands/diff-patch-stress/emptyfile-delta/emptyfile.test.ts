import assert from "node:assert/strict";
import test from "node:test";
import { contents, execute, observe, setup, snapshot, target } from "./helpers.js";
import { created, creation, deletion, formats, payload, vectors } from "./vectors.js";

for (const vector of vectors) test(`${vector.status === 0 ? "GNU default" : "atomic extension no-publication"}: ${vector.name}`, { timeout: 4000 }, async () => {
  const fs = await setup(vector);
  const before = await snapshot(fs);
  const observed = observe(fs);
  const result = await execute(observed.fs, [...(vector.status === 0 ? [] : ["--atomic"]), ...vector.args], vector.input);
  assert.equal(result.exitCode, vector.status, result.stderr);
  assert.equal(await contents(fs, target(vector)), vector.expected);
  const after = await snapshot(fs);
  delete before[target(vector)];
  delete after[target(vector)];
  const prunedParent = vector.expected === null && vector.status === 0 && !vector.args.includes("--dry-run") && target(vector) === "/authorized/target";
  if (prunedParent) {
    delete before["/authorized"];
    const root = before["/"];
    assert(typeof root === "object" && root !== null && "nlink" in root);
    assert.equal(root.nlink, 4);
    before["/"] = { ...root, nlink: 3 };
  }
  assert.deepEqual(after, before, "no decoys, reject files, backup files, or unrelated paths changed");
  if (vector.args.includes("--dry-run") || vector.status !== 0) assert.deepEqual(observed.mutations, []);
  else assert.deepEqual(observed.mutations.map(({ method, path }) => ({ method, path })),
    [{ method: vector.expected === null ? "rm" : "writeFile", path: target(vector) }, ...(prunedParent ? [{ method: "rmdir", path: "/authorized" }] : [])]);
});

for (const format of formats) for (const reverse of [false, true]) {
  test(`atomic extension mixed ${format}/unified delete-recreate ${reverse ? "reverse" : "forward"} commits final state once`, async () => {
    const fs = await setup();
    await fs.writeFile("/authorized/target", Buffer.from(reverse ? created : payload));
    const observed = observe(fs);
    const input = deletion(format, "old-label") + creation("unified", "new-label");
    const result = await execute(observed.fs, ["--atomic", reverse ? "-RE" : "-E", "/authorized/target"], input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "/authorized/target"), reverse ? payload : created);
    assert.deepEqual(observed.mutations.map(({ method, path }) => ({ method, path })), [{ method: "writeFile", path: "/authorized/target" }]);
  });
}

for (const conflict of ["hunk", "occupied-creation"]) test(`atomic extension later ${conflict} rejects staged removal without early writes`, async () => {
  const fs = await setup();
  await fs.writeFile("/work/first", Buffer.from(payload));
  await fs.writeFile("/work/second", Buffer.from("occupied\n"));
  const before = await snapshot(fs);
  const observed = observe(fs);
  const input = deletion("context", "first") + (conflict === "hunk"
    ? "--- second\n+++ second\n@@ -1 +1 @@\n-wrong\n+changed\n" : creation("unified", "second"));
  const result = await execute(observed.fs, ["--atomic", "-E"], input);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(observed.mutations, []);
  assert.deepEqual(await snapshot(fs), before);
});

for (const kind of ["symlink", "hardlink", "ancestor-symlink"] as const) for (const operation of ["create", "remove"] as const) {
  test(`${kind} ${operation} rejected without mutations`, async () => {
    const fs = await setup();
    await fs.writeFile("/authorized/original", Buffer.from(operation === "create" ? "" : payload));
    let path = "/authorized/target";
    if (kind === "symlink") await fs.symlink("original", path);
    else if (kind === "hardlink") await fs.link("/authorized/original", path);
    else { await fs.symlink("/authorized", "/work/alias"); path = "/work/alias/original"; }
    const before = await snapshot(fs);
    const observed = observe(fs);
    const result = await execute(observed.fs, ["-E", path], operation === "create" ? creation("context") : deletion("unified"));
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /symlink|hard.link/u);
    assert.deepEqual(observed.mutations, []);
    assert.deepEqual(await snapshot(fs), before);
  });
}

for (const operation of ["create", "remove"]) test(`pre-cancelled ${operation} performs no filesystem work`, async () => {
  const fs = await setup();
  await fs.writeFile("/work/target", Buffer.from(operation === "create" ? "" : payload));
  const before = await snapshot(fs);
  const observed = observe(fs);
  const controller = new AbortController();
  const reason = new Error("emptyfile pre-cancel");
  controller.abort(reason);
  await assert.rejects(execute(observed.fs, ["-E", "target"], operation === "create" ? creation("unified") : deletion("normal"), controller.signal), error => error === reason);
  assert.deepEqual(observed.calls, []);
  assert.deepEqual(await snapshot(fs), before);
});

for (const method of ["writeFile", "rm"] as const) for (const after of [false, true]) {
  test(`atomic extension ${method} failure ${after ? "after" : "before"} effect reports partial commit, not rollback`, async () => {
    const fs = await setup();
    for (const name of ["first", "second", "third"]) await fs.writeFile(`/work/${name}`, Buffer.from(method === "rm" ? payload : ""));
    const observed = observe(fs, { method, path: "/work/second", after });
    const controller = new AbortController();
    const input = ["first", "second", "third"].map(name => method === "rm" ? deletion("context", name) : creation("unified", name)).join("");
    const result = await execute(observed.fs, ["--atomic", "--remove-empty-files"], input, controller.signal);
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /commit stopped; 1\/3 files committed; failing operation may have side effects/u);
    assert.match(result.stderr, new RegExp(`injected-${after ? "after" : "before"}-effect`, "u"));
    assert.equal(result.stdout, "");
    const original = method === "rm" ? payload : "";
    const changed = method === "rm" ? null : created;
    assert.equal(await contents(fs, "/work/first"), changed);
    assert.equal(await contents(fs, "/work/second"), after ? changed : original);
    assert.equal(await contents(fs, "/work/third"), original);
    assert.deepEqual(observed.mutations.map(call => call.path), ["/work/first", "/work/second"]);
    for (const call of observed.mutations) {
      assert(call.signal instanceof AbortSignal);
      assert.equal(call.signal.aborted, false);
      assert.equal(call.signal, observed.mutations[0]!.signal);
    }
  });
}
