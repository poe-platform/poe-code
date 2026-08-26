import assert from "node:assert/strict";
import test from "node:test";
import type { ByteSource, FsOptions, ReadStreamOptions } from "../../../../src/contracts/index.js";
import { change, create, fixtures, remove, twoHunks } from "./fixtures.js";
import { contents, cwd, execute, filesystem, instrument, requireAtomic, root, shell, snapshot } from "./support.js";

for (const name of [
  "unified/first-hunk-success-later-reject", "unified/later-file-reject-continue-third",
  "unified/later-missing-file-continue-third", "sequential/same-target-later-reject",
]) test(`atomic preflight: ${name}`, async () => {
  const fixture = fixtures.find(item => item.name === name)!;
  const fs = await filesystem(fixture.files, fixture.directories);
  const before = await snapshot(fs);
  const result = await execute(shell(fs), { ...fixture.steps[0]!, args: ["--atomic", ...fixture.steps[0]!.args] });
  requireAtomic(result.stderr);
  assert.equal(result.exitCode, 1, result.stderr);
  assert.deepEqual(await snapshot(fs), before, "recoverable conflict must not publish target, reject, backup, or directory writes");
});

test("atomic preflight: successful sequential edits publish final content", async () => {
  const fs = await filesystem({ target: "old\n" });
  const result = await execute(shell(fs), { args: ["--atomic"], input: change("unified", "target", "old", "middle") + change("unified", "target", "middle", "new") });
  requireAtomic(result.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "new\n");
});

test("atomic preflight: dry-run successful create and deletion leave namespace unchanged", async () => {
  const fs = await filesystem({ "old/target": "old\n" });
  const before = await snapshot(fs);
  const result = await execute(shell(fs), { args: ["--atomic", "--dry-run", "-p0"], input: create("new/deep/target") + remove("old/target") });
  requireAtomic(result.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await snapshot(fs), before);
});

for (const atomic of [false, true]) {
  const mode = atomic ? "atomic" : "default";
  const args = atomic ? ["--atomic"] : [];
  for (const attack of ["reject-symlink", "reject-hardlink", "reject-ancestor-symlink", "target-hardlink-alias", "target-ancestor-alias", "reject-collides-later-target"] as const) {
    test(`product safety/${mode}: ${attack}`, async () => {
      const fs = await filesystem({ target: "old\nkeep-a\nkeep-b\nkeep-c\nwrong\n", protected: "PROTECTED\n" });
      let input = twoHunks("unified");
      if (attack === "reject-symlink") await fs.symlink("protected", `${cwd}/target.rej`);
      if (attack === "reject-hardlink") await fs.link(`${cwd}/protected`, `${cwd}/target.rej`);
      if (attack === "reject-ancestor-symlink") {
        await fs.mkdir(`${root}/protected-dir`);
        await fs.writeFile(`${root}/protected-dir/target`, Buffer.from("old\nkeep-a\nkeep-b\nkeep-c\nwrong\n"));
        await fs.writeFile(`${root}/protected-dir/target.rej`, Buffer.from("PROTECTED REJECT\n"));
        await fs.symlink(`${root}/protected-dir`, `${cwd}/alias`);
        input = input.replaceAll("target", "alias/target");
      }
      if (attack === "target-hardlink-alias") {
        await fs.link(`${cwd}/target`, `${cwd}/alias`);
        input = change("unified") + change("unified", "alias", "new", "last");
      }
      if (attack === "target-ancestor-alias") {
        await fs.symlink(cwd, `${cwd}/alias`);
        input = change("unified") + change("unified", "alias/target", "new", "last");
      }
      if (attack === "reject-collides-later-target") {
        await fs.writeFile(`${cwd}/target.rej`, Buffer.from("old\n"));
        input += change("unified", "target.rej");
      }
      const before = await snapshot(fs);
      const result = await execute(shell(fs), { args: [...args, "-p0"], input });
      if (atomic) requireAtomic(result.stderr);
      assert.notEqual(result.exitCode, 0, "unsafe alias must not be accepted as a successful patch");
      assert.equal(await contents(fs, "protected"), "PROTECTED\n");
      const after = await snapshot(fs);
      if (atomic || attack !== "target-ancestor-alias") assert.deepEqual(after, before, "unsafe target/reject aliases require preflight before writes");
      else {
        for (const [path, entry] of Object.entries(before)) if (path !== "work/target") assert.deepEqual(after[path], entry, `unauthorized alias write: ${path}`);
        assert(["old\nkeep-a\nkeep-b\nkeep-c\nwrong\n", "new\nkeep-a\nkeep-b\nkeep-c\nwrong\n"].includes(await contents(fs, "target")), "only the authorized first section may be published");
      }
    });
  }

  test(`resource/${mode}: input budget prevents all initial writes`, async () => {
    const fs = await filesystem({ target: "old\n" });
    const before = await snapshot(fs);
    const result = await execute(shell(fs, { maxInputBytes: 8 }), { args, input: change("unified") });
    if (atomic) requireAtomic(result.stderr);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /limit|exceed|byte/iu);
    assert.deepEqual(await snapshot(fs), before);
  });

  test(`resource/${mode}: later target byte budget preserves mode publication semantics`, async () => {
    const input = change("unified", "first") + change("unified", "second");
    const fs = await filesystem({ first: "old\n", second: `old\n${"padding\n".repeat(64)}` });
    const before = await snapshot(fs);
    const result = await execute(shell(fs, { maxInputBytes: Buffer.byteLength(input) + 64 }), { args, input });
    if (atomic) requireAtomic(result.stderr);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /limit|exceed|byte/iu);
    if (atomic) assert.deepEqual(await snapshot(fs), before);
    else assert.equal(await contents(fs, "first"), "new\n", "default publishes a completed earlier file before later target read budget failure");
    assert.equal(await contents(fs, "second"), `old\n${"padding\n".repeat(64)}`);
  });

  test(`resource/${mode}: cancellation while awaiting stdin leaves namespace unchanged`, { timeout: 4000 }, async () => {
    const fs = await filesystem({ target: "old\n" });
    const before = await snapshot(fs);
    const controller = new AbortController();
    let started = false;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      next() { started = true; controller.abort(new Error("cancel waiting input")); return new Promise<IteratorResult<Uint8Array>>(() => {}); },
    }; } };
    const outcome = await execute(shell(fs), { args, input: "" }, controller.signal, stdin).then(result => result, error => error as unknown);
    if (outcome && typeof outcome === "object" && "stderr" in outcome) {
      requireAtomic(String(outcome.stderr));
      assert.notEqual(Reflect.get(outcome, "exitCode"), 0);
    }
    assert(started, "stdin must be consumed; missing --atomic must not masquerade as cancellation");
    assert(controller.signal.aborted);
    assert.deepEqual(await snapshot(fs), before);
  });

  test(`resource/${mode}: composed signal cancels stalled later read without rollback requirement`, { timeout: 4000 }, async () => {
    const fs = await filesystem({ first: "old\n", second: "old\n" });
    const before = await snapshot(fs);
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    let started = false;
    const wrapped = instrument(fs, (method, parameters) => {
      if ((method !== "readStream" && method !== "readFile") || parameters[0] !== `${cwd}/second`) return undefined;
      observed = (parameters[1] as ReadStreamOptions | FsOptions | undefined)?.signal;
      assert(observed instanceof AbortSignal, "host reads must receive Shell's composed signal");
      const stalled = () => { started = true; controller.abort(new Error("cancel later target read")); return new Promise<IteratorResult<Uint8Array>>(() => {}); };
      if (method === "readStream") return { [Symbol.asyncIterator]() { return { next: stalled }; } } satisfies ByteSource;
      started = true;
      controller.abort(new Error("cancel later target read"));
      return new Promise<Uint8Array>(() => {});
    });
    const outcome = await execute(shell(wrapped), { args, input: change("unified", "first") + change("unified", "second") }, controller.signal).then(result => result, error => error as unknown);
    if (outcome && typeof outcome === "object" && "stderr" in outcome) {
      if (atomic) requireAtomic(String(outcome.stderr));
      assert.notEqual(Reflect.get(outcome, "exitCode"), 0);
    }
    assert(started, "later target read was never reached");
    assert(observed?.aborted, "composed signal must reflect caller cancellation; signal identity is not required");
    if (atomic) assert.deepEqual(await snapshot(fs), before);
    else assert.equal(await contents(fs, "first"), "new\n", "default cancellation does not undo already completed earlier file publication");
    assert.equal(await contents(fs, "second"), "old\n");
  });
}
