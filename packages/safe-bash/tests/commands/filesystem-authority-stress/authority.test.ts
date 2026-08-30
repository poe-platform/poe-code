import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { bytes, command, effects, invalidComparison, payload, provider, unchanged, view } from "./helpers.js";

for (const name of ["cp", "mv"] as const) {
  for (const scoped of [false, true]) for (const alias of [false, true]) {
    test(`${name}: ${scoped ? "complete identity" : "actual authority"} ${alias ? "alias" : "distinct"}`, async () => {
      const { base, fs, events } = await provider({ scoped, alias });
      const result = await command(name, ["/source", "/target"], fs);
      assert.equal(result.exitCode, alias ? 1 : 0, result.stderr);
      assert.equal(events.filter(event => event.startsWith("compare:")).length, scoped ? 0 : 1);
      assert.deepEqual(await bytes(base, "/target"), payload);
      assert.deepEqual(await bytes(base, "/source"), name === "mv" && !alias ? null : payload);
      if (alias) assert.deepEqual(effects(events), []);
      else if (name === "mv") assert.deepEqual(effects(events), ["copy:replace", "published", "remove:/source"]);
    });
  }

  for (const value of [null, undefined, {}, true, 1, "DISTINCT"]) {
    test(`${name}: malformed comparison ${JSON.stringify(value)} fails EIO before effects`, async () => {
      const { base, fs, events } = await provider();
      const result = await command(name, ["/source", "/target"], view(fs, { compareEntry: invalidComparison(value) }));
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /EIO.*invalid entry comparison/u);
      assert.deepEqual(effects(events), []);
      await unchanged(base);
    });
  }

  for (const code of ["EIO", "ENOENT", "EACCES", "ENOTSUP"] as const) {
    test(`${name}: authority ${code} is not downgraded to unknown`, async () => {
      const { base, fs, events } = await provider();
      const failure = new FsError(code, { syscall: "compareEntry", path: "/source" });
      const result = await command(name, ["/source", "/target"], view(fs, { compareEntry: async () => { throw failure; } }));
      assert.equal(result.exitCode, 1);
      assert.equal(result.stderr, `${name}: ${failure.message}\n`);
      assert.deepEqual(effects(events), []);
      await unchanged(base);
    });
  }

  for (const rejects of [false, true]) {
    test(`${name}: authority cancellation preserves original reason, rejects=${rejects}`, async () => {
      const { base, fs, events } = await provider();
      const controller = new AbortController(), reason = new FsError("ENOENT", { message: "authority interrupted" });
      const observed = view(fs, { compareEntry: async (_path, _peer, _peerPath, controls) => {
        assert.equal(controls?.signal, controller.signal);
        controller.abort(reason);
        if (rejects) throw new FsError("EIO");
        return "distinct";
      } });
      await assert.rejects(command(name, ["/source", "/target"], observed, controller.signal), error => error === reason);
      assert.deepEqual(effects(events), []);
      await unchanged(base);
    });
  }
}

for (const comparison of ["absent", "unknown"] as const) {
  test(`mv: ${comparison} existing identity refuses copy/no-op and deletion`, async () => {
    const { base, fs, events } = await provider({ comparison });
    const result = await command("mv", ["/source", "/target"], view(fs, { copyFile: async () => { events.push("unsafe-noop"); } }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP.*authoritative distinctness/u);
    assert.deepEqual(effects(events), []);
    await unchanged(base);
  });
  test(`cp: ${comparison} optional authority retains guarded native backend copy`, async () => {
    const { base, fs, events } = await provider({ comparison });
    const result = await command("cp", ["/source", "/target"], fs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(effects(events), ["copy:replace", "published"]);
    assert.deepEqual(await bytes(base, "/source"), payload);
    assert.deepEqual(await bytes(base, "/target"), payload);
  });
  test(`cp -f: ${comparison} authority cannot authorize unlink after EACCES`, async () => {
    const { base, fs, events } = await provider({ comparison });
    const result = await command("cp", ["-f", "/source", "/target"], view(fs, { copyFile: async () => { throw new FsError("EACCES"); } }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP.*authoritative distinctness/u);
    assert.deepEqual(effects(events), []);
    await unchanged(base);
  });
}

test("cp -f: qualified distinct authority is rechecked before exclusive replacement", async () => {
  const { base, fs, events } = await provider();
  let calls = 0, comparisons = 0;
  const observed = view(fs, {
    compareEntry: async () => { comparisons++; return "distinct"; },
    copyFile: async (source, target, controls) => {
      if (++calls === 1) throw new FsError("EACCES");
      assert.equal(controls?.exclusive, true);
      await base.copyFile(source, target, controls);
    },
  });
  assert.equal((await command("cp", ["-f", "/source", "/target"], observed)).exitCode, 0);
  assert.equal(comparisons, 2);
  assert.equal(calls, 2);
  assert.deepEqual(effects(events), ["remove:/target"]);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
});

test("cp -f: fresh alias observation defeats stale distinct authority", async () => {
  const { base, fs, events } = await provider();
  let comparisons = 0;
  const observed = view(fs, {
    compareEntry: async () => ++comparisons === 1 ? "distinct" : "same",
    copyFile: async () => { await base.rm("/target"); await base.link("/source", "/target"); throw new FsError("EACCES"); },
  });
  const result = await command("cp", ["-f", "/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /same file/u);
  assert.equal(comparisons, 2);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
});
