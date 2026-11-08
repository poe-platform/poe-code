import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { bytes, command, effects, invalidComparison, payload, previous, provider, unchanged, view } from "./helpers.js";

for (const name of ["cp", "mv"] as const) {
  for (const scoped of [false, "source", true] as const) for (const alias of [false, true]) {
    test(`${name}: scope=${scoped} ${alias ? "alias rejection" : "existing-target transfer admission"}`, async () => {
      const { base, fs, events } = await provider({ scoped, alias });
      const observed = view(fs, { publishStagedFile: async (...args) => {
        await base.publishStagedFile(...args);
        events.push("published");
      }, writeStream: async (target, source, controls) => {
        events.push("stream:start");
        await base.writeStream!(target, source, controls);
        events.push("published");
      } });
      const moved = name === "mv" && scoped === true && !alias;
      const allowed = (name === "cp" && scoped !== false || moved) && !alias;
      const result = await command(name, ["/source", "/target"], observed);
      assert.equal(result.exitCode, allowed ? 0 : 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, allowed ? "" : alias
        ? `${name}: EINVAL: source and destination are the same file '/source' -> '/target'\n`
        : name === "mv" ? scoped === false ? "mv: ENOTSUP: move source lacks authoritative snapshot '/source'\n"
          : "mv: EAGAIN: move destination changed during resolution capture '/target'\n"
        : "cp: ENOTSUP: copy reader is not bound to the inspected source identity '/source'\n");
      assert.equal(events.filter(event => event.startsWith("compare:")).length, scoped === true ? 0 : 1);
      assert.deepEqual(await bytes(base, "/target"), allowed || alias ? payload : previous);
      assert.deepEqual(await bytes(base, "/source"), moved ? null : payload);
      assert.deepEqual(effects(events), moved ? ["published", "remove:/source"] : allowed ? ["stream:start", "published"] : []);
      assert.deepEqual((await base.readdir("/")).map(entry => entry.name), moved ? ["target"] : ["source", "target"]);
    });
  }

  for (const scoped of [false, true]) test(`${name}: missing-target transfer ${scoped ? "uses scoped retained identity" : "refuses unscoped source identity"}`, async () => {
    const { base, fs, events } = await provider({ scoped, target: false });
    const observed = view(fs, {
      writeStream: async (target, source, controls) => {
        events.push("stream:start");
        assert.equal(controls?.flag, name === "mv" ? "wx" : "w");
        await base.writeStream!(target, source, controls);
        events.push("published");
      },
      removeEntryConditional: async (path, controls) => {
        events.push(`remove:${path}`);
        await base.removeEntryConditional!(path, controls);
      },
    });
    const result = await command(name, ["/source", "/target"], observed);
    assert.equal(result.exitCode, scoped ? 0 : 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, scoped ? "" : `${name}: ENOTSUP: copy reader is not bound to the inspected source identity '/source'\n`);
    assert.deepEqual(effects(events), !scoped ? [] : name === "mv"
      ? ["stream:start", "published", "remove:/source"] : ["stream:start", "published"]);
    assert.deepEqual(await bytes(base, "/source"), scoped && name === "mv" ? null : payload);
    assert.deepEqual(await bytes(base, "/target"), scoped ? payload : null);
    assert.deepEqual((await base.readdir("/")).map(entry => entry.name), !scoped ? ["source"] : name === "mv" ? ["target"] : ["source", "target"]);
  });

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
    if (comparison === "absent") assert.equal(fs.compareEntry, undefined);
    const result = await command("mv", ["/source", "/target"], view(fs, { writeStream: async () => { events.push("unsafe-noop"); } }));
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /ENOTSUP.*authoritative distinctness/u);
    assert.deepEqual(effects(events), []);
    await unchanged(base);
  });
  for (const scoped of [false, "source"] as const) test(`cp: ${comparison} optional authority ${scoped ? "allows a bound retained source" : "does not replace retained source identity"}`, async () => {
    const { base, fs, events } = await provider({ comparison, scoped });
    if (comparison === "absent") assert.equal(fs.compareEntry, undefined);
    const overrides: Partial<FileSystem> = { writeStream: async (target, source, controls) => {
      events.push("stream:start");
      await base.writeStream!(target, source, controls);
      events.push("published");
    } };
    const result = await command("cp", ["/source", "/target"], view(fs, overrides));
    assert.equal(result.exitCode, scoped ? 0 : 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, scoped ? "" : "cp: ENOTSUP: copy reader is not bound to the inspected source identity '/source'\n");
    assert.deepEqual(effects(events), scoped ? ["stream:start", "published"] : []);
    assert.deepEqual(await bytes(base, "/source"), payload);
    assert.deepEqual(await bytes(base, "/target"), scoped ? payload : previous);
    assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
  });
  test(`cp -f: ${comparison} authority cannot authorize unlink after EACCES`, async () => {
    const { base, fs, events } = await provider({ comparison, scoped: "source" });
    if (comparison === "absent") assert.equal(fs.compareEntry, undefined);
    const result = await command("cp", ["-f", "/source", "/target"], view(fs, {
      writeStream: async (_target, _source, controls) => {
        assert.equal(controls?.flag, "w");
        events.push("write:EACCES");
        throw new FsError("EACCES");
      },
    }));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "cp: ENOTSUP: forced copy unlink lacks authoritative distinctness '/source' -> '/target'\n");
    assert.deepEqual(effects(events), ["write:EACCES"]);
    assert.equal(events.filter(event => event.startsWith("compare:")).length, comparison === "absent" ? 0 : 2);
    await unchanged(base);
    assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
  });
}

test("cp -f: qualified distinct authority is rechecked before exclusive replacement", async () => {
  const { base, fs, events } = await provider({ scoped: "source" });
  let calls = 0, comparisons = 0;
  const observed = view(fs, {
    compareEntry: async () => { comparisons++; return "distinct"; },
    writeStream: async (target, source, controls) => {
      calls++;
      assert.equal(controls?.flag, calls === 1 ? "w" : "wx");
      if (calls === 1) throw new FsError("EACCES");
      await base.writeStream!(target, source, controls);
    },
  });
  const result = await command("cp", ["-f", "/source", "/target"], observed);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(comparisons, 2);
  assert.equal(calls, 2);
  assert.deepEqual(effects(events), ["remove:/target"]);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
  assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
});

test("cp -f: fresh alias observation defeats stale distinct authority", async () => {
  const { base, fs, events } = await provider({ scoped: "source" });
  let comparisons = 0, writes = 0;
  const observed = view(fs, {
    compareEntry: async () => ++comparisons === 1 ? "distinct" : "same",
    writeStream: async (_target, _source, controls) => {
      writes++;
      assert.equal(controls?.flag, "w");
      await base.rm("/target");
      await base.link("/source", "/target");
      throw new FsError("EACCES");
    },
  });
  const result = await command("cp", ["-f", "/source", "/target"], observed);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "cp: EINVAL: source and destination are the same file '/source' -> '/target'\n");
  assert.equal(comparisons, 2);
  assert.equal(writes, 1);
  assert.deepEqual(effects(events), []);
  assert.deepEqual(await bytes(base, "/source"), payload);
  assert.deepEqual(await bytes(base, "/target"), payload);
  assert.deepEqual((await base.readdir("/")).map(entry => entry.name), ["source", "target"]);
});
