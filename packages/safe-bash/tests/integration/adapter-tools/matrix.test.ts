import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { ShellLimitError, type ByteSource, type ShellResult } from "../../../src/index.js";
import {
  allFamiliesDispatched, change, fsError, original, payload, revised, snapshotTree, success,
  withFixture, writableAdapters,
} from "./fixtures.js";
import { withRmdirFixture } from "./profiles/rmdir-fixtures.js";

const digest = createHash("sha256").update(payload).digest("hex");
const options = { timeout: 20_000 };
const todoPipeline = "find src -type f -name '*.txt' | xargs rg --no-heading --no-filename '^TODO' | sed 's/^TODO //' | awk '{ print $1 \":\" $2 }' | jq -R '.' | jq -s '.'";
// These are independently declared provider guarantees, not runtime capability
// probes that could silently turn a regression into a passing unsupported case.
const profiles = {
  memory: { retainedReads: true, patchPublication: true },
  real: { retainedReads: true, patchPublication: false },
  s3: { retainedReads: false, patchPublication: false },
  webdav: { retainedReads: false, patchPublication: false },
  mount: { retainedReads: true, patchPublication: false },
  overlay: { retainedReads: true, patchPublication: false },
};
const patchPublicationError = "patch: filesystem does not support race-safe patch publication\n";
const diffReadError = "diff: diff input requires identity-checked retained reads\n";

function refusal(result: ShellResult, stderr: string, exitCode = 2): void {
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.stdout, "");
  assert.deepEqual(result.stdoutBytes, new Uint8Array());
  assert.equal(result.stderr, stderr);
}

for (const backend of writableAdapters) {
  const profile = profiles[backend];
  test(`${backend}: independent six-family named-file probes enforce provider guarantees`, options, async context => {
    await withFixture(backend, async ({ exec, fs, dispatched }) => {
      const before = await snapshotTree(fs);
      const failures: string[] = [];
      const probes = [
        ["find src -type f -name '*.txt'", "src/tasks.txt\n"],
        ["cat old.txt", original],
        ["rg --no-heading --no-filename '^TODO' src/tasks.txt", "TODO alpha 2\nTODO beta 3\n"],
        ["sed 's/beta/BETA/' old.txt", revised],
        ["awk '{ print $1 }' old.txt", original],
        ["jq -c '.names' config.json", '["alpha","beta"]\n'],
        ["sha256sum payload.bin", `${digest}  payload.bin\n`],
        ["set -o pipefail; gzip -c payload.bin | gzip -dc", profile.retainedReads ? payload : "", profile.retainedReads ? 0 : 1,
          profile.retainedReads ? "" : "gzip: ENOTSUP: named input requires retained VFS reads with stable scoped identities '/work/payload.bin'\ngzip: unexpected end of file\n"],
        ["diff -q old.txt target.txt", "", profile.retainedReads ? 0 : 2,
          profile.retainedReads ? "" : diffReadError],
        ["patch --dry-run -i change.diff", undefined],
      ] as const;
      for (const [source, expected, status = 0, stderr = ""] of probes) {
        try {
          const before = status === 0 ? undefined : await snapshotTree(fs);
          const result = await exec(source);
          if (status === 0) {
            success(result, typeof expected === "string" ? expected : undefined);
            if (expected instanceof Uint8Array) assert.deepEqual(result.stdoutBytes, expected);
          } else {
            refusal(result, stderr, status);
            assert.deepEqual(await snapshotTree(fs), before);
          }
        } catch (error) {
          const message = `${source}: ${String(error)}`;
          context.diagnostic(message);
          failures.push(message);
        }
      }
      assert.deepEqual(await snapshotTree(fs), before, "all inspection and refusal probes preserve namespace and bytes");
      if (!profile.retainedReads) {
        const streamed = await exec("set -o pipefail; gzip -c < payload.bin | gzip -dc");
        success(streamed);
        assert.deepEqual(streamed.stdoutBytes, payload, "explicit stdin compression remains supported");
      }
      allFamiliesDispatched(dispatched);
      assert.deepEqual(failures, [], "every named-file probe must meet its declared success or refusal contract");
    });
  });

  test(`${backend}: aggregate six-family flow with ${profile.patchPublication ? "patch publication" : "explicit publication refusal"}`, options, async () => {
    await withFixture(backend, async fixture => {
      const { exec, fs, dispatched } = fixture;
      success(await exec(`set -o pipefail; ${todoPipeline} > report.json; status=$?; cat report.json; exit "$status"`));
      assert.deepEqual(JSON.parse(Buffer.from(await fs.readFile("/work/report.json")).toString()), ["alpha:2", "beta:3"]);
      success(await exec("jq -r '.[]' < report.json"), "alpha:2\nbeta:3\n");
      success(await exec("set -o pipefail; cat < payload.bin | gzip -c > payload.gz"), "");
      success(await exec("set -o pipefail; gzip -dc < payload.gz | sha256sum"), `${digest}  -\n`);
      const beforeDiff = await snapshotTree(fs);
      const diff = await exec("diff -u --label target.txt --label target.txt old.txt new.txt > generated.diff");
      if (profile.retainedReads) {
        assert.equal(diff.exitCode, 1, diff.stderr);
        assert.equal(diff.stderr, "");
      } else {
        refusal(diff, diffReadError);
        assert.deepEqual(await snapshotTree(fs), { ...beforeDiff, "/work/generated.diff": new Uint8Array() }, "only the explicit shell redirection creates an empty file");
        success(await exec("cat change.diff > generated.diff"), "");
      }
      assert.equal(Buffer.from(await fs.readFile("/work/generated.diff")).toString(), change);
      success(await exec("patch --dry-run -i generated.diff"), "checking file target.txt\n");
      const beforePatch = await snapshotTree(fs);
      const patched = await exec("patch -i generated.diff > patch.log && diff -q target.txt new.txt && cat target.txt");
      if (profile.patchPublication) success(patched, revised);
      else {
        refusal(patched, patchPublicationError);
        assert.deepEqual(await snapshotTree(fs), { ...beforePatch, "/work/patch.log": new Uint8Array() }, "unsupported patch publication leaves targets and namespace unchanged apart from shell redirection");
        success(await exec("cat target.txt"), original);
      }
      allFamiliesDispatched(dispatched);
      if (fixture.s3 && backend !== "mount") {
        assert.ok(fixture.s3.requests.some(request => request.operation === "getObject"));
        assert.ok(fixture.s3.requests.some(request => request.operation === "listObjectsV2"));
      }
      if (fixture.dav) for (const method of ["PROPFIND", "GET", "PUT"]) {
        assert.ok(fixture.dav.requests.some(request => request.init.method === method), `actual HTTP ${method}`);
      }
    });
  });

  test(`${backend}: binary stdin, compression, hashes and redirected bytes`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      success(await exec("set -o pipefail; cat | gzip -c | tee stream.gz | gzip -dc > roundtrip.bin", { stdin: payload }), "");
      assert.deepEqual(await fs.readFile("/work/roundtrip.bin"), payload);
      assert.deepEqual(new Uint8Array(gunzipSync(await fs.readFile("/work/stream.gz"))), payload);
      const collected: Uint8Array[] = [];
      const result = await exec("cat roundtrip.bin", { stdout: { async write(chunk) { collected.push(new Uint8Array(chunk)); } } });
      success(result);
      assert.deepEqual(result.stdoutBytes, payload);
      assert.deepEqual(new Uint8Array(Buffer.concat(collected)), payload);
      success(await exec("sha256sum roundtrip.bin > checksums && sha256sum -c checksums"), "roundtrip.bin: OK\n");
      assert.equal(Buffer.from(await fs.readFile("/work/checksums")).toString(), `${digest}  roundtrip.bin\n`);
      assert.deepEqual(await fs.readFile("/work/payload.bin"), payload);
    });
  });

  test(`${backend}: cwd, supplied stdin and explicitly empty stdin`, options, async () => {
    await withFixture(backend, async ({ exec }) => {
      success(await exec("set -o pipefail; cd src && pwd && cat tasks.txt | rg '^TODO' | sed 's/TODO/DONE/' | awk '{ print $2 }'"), "/work/src\nalpha\nbeta\n");
      success(await exec("set -o pipefail; rg '^TODO' | sed 's/^TODO //' | jq -R '.'", { stdin: "DONE ignored\nTODO supplied\n" }), '"supplied"\n');
      for (const result of [await exec("rg '^TODO' < empty.txt"), await exec("rg '^TODO'", { stdin: "" })]) {
        assert.equal(result.exitCode, 1, result.stderr);
        assert.equal(result.stdout, "", "explicit empty input must not trigger recursive cwd search");
        assert.equal(result.stderr, "");
      }
      success(await exec("cat tasks.txt", { cwd: "/work/src" }), "TODO alpha 2\nTODO beta 3\nDONE gamma 7\n");
    });
  });

  test(`${backend === "webdav" ? "webdav configured atomic-empty" : backend}: create, transfer, append, inspect and remove files with explicit copy admission`, options, async () => {
    await withRmdirFixture(backend, async ({ exec, fs }) => {
      const before = await snapshotTree(fs);
      const copied = await exec("mkdir -p scratch/nested && cp old.txt scratch/nested/copy.txt && printf 'gamma\\n' >> scratch/nested/copy.txt && cat scratch/nested/copy.txt");
      if (profile.retainedReads) success(copied, `${original}gamma\n`);
      else {
        refusal(copied, "cp: ENOTSUP: copy requires retained reads and streaming writes '/work/old.txt'\n", 1);
        assert.deepEqual(await snapshotTree(fs), { ...before, "/work/scratch": null, "/work/scratch/nested": null }, "refused copy publishes no file");
        await fs.copyFile("/work/old.txt", "/work/scratch/nested/copy.txt", { exclusive: true });
        success(await exec("printf 'gamma\\n' >> scratch/nested/copy.txt && cat scratch/nested/copy.txt"), `${original}gamma\n`);
      }
      assert.equal(Buffer.from(await fs.readFile("/work/old.txt")).toString(), original);
      success(await exec("find scratch -type f | sort"), "scratch/nested/copy.txt\n");
      success(await exec("rm scratch/nested/copy.txt && rmdir scratch/nested && rmdir scratch && test ! -e scratch"), "");
    });
  });

  test(`${backend}: copy admission and same-view move preserve bytes`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      const before = await snapshotTree(fs);
      const copied = await exec("cp payload.bin move-source.bin");
      if (profile.retainedReads) success(copied, "");
      else {
        refusal(copied, "cp: ENOTSUP: copy requires retained reads and streaming writes '/work/payload.bin'\n", 1);
        assert.deepEqual(await snapshotTree(fs), before, "refused setup copy preserves namespace and bytes");
        await fs.copyFile("/work/payload.bin", "/work/move-source.bin", { exclusive: true });
      }
      assert.deepEqual(await fs.readFile("/work/move-source.bin"), payload);
      success(await exec("mv move-source.bin moved.bin"), "");
      assert.deepEqual(await fs.readFile("/work/moved.bin"), payload);
      assert.deepEqual(await fs.readFile("/work/payload.bin"), payload);
      success(await exec("test ! -e move-source.bin"), "");
      assert.deepEqual(await snapshotTree(fs), { ...before, "/work/moved.bin": payload });
    });
  });

  test(`${backend}: touch creates an empty file successfully`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      const result = await exec("touch touched.txt");
      assert.deepEqual(await fs.readFile("/work/touched.txt"), new Uint8Array(), "inspect partial creation even when touch reports failure");
      success(result, "");
    });
  });

  test(`${backend}: in-place edit, diff-to-patch stdin and ${profile.patchPublication ? "reverse publication" : "mutation refusal"}`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      const before = await snapshotTree(fs);
      const edited = await exec("sed -i 's/beta/BETA/' old.txt && diff -q old.txt new.txt");
      if (profile.retainedReads) success(edited, "");
      else refusal(edited, diffReadError);
      assert.deepEqual(await snapshotTree(fs), { ...before, "/work/old.txt": new TextEncoder().encode(revised) }, "in-place sed changes only its target, even when named diff is unsupported");
      const beforePatch = await snapshotTree(fs);
      const patched = await exec("cat change.diff | patch > patch.log && diff -q target.txt new.txt && patch -R -i change.diff > reverse.log && cat target.txt");
      if (profile.patchPublication) success(patched, original);
      else {
        refusal(patched, patchPublicationError);
        assert.deepEqual(await snapshotTree(fs), { ...beforePatch, "/work/patch.log": new Uint8Array() });
        refusal(await exec("patch -R -i change.diff > reverse.log"), patchPublicationError);
        assert.deepEqual(await snapshotTree(fs), { ...beforePatch, "/work/patch.log": new Uint8Array(), "/work/reverse.log": new Uint8Array() });
        success(await exec("cat target.txt"), original);
      }
      assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), original);
      // A refused consumer need not drain its producer. Use supported dry-run
      // consumption to check complete streamed bytes; refusal effects are above.
      const source = profile.retainedReads
        ? "diff -u --label target.txt --label target.txt target.txt new.txt"
        : "cat change.diff";
      const diff = await exec(`${source} | tee streamed.diff | patch${profile.patchPublication ? "" : " --dry-run"} > patch.log`);
      success(diff, "");
      assert.equal(Buffer.from(await fs.readFile("/work/streamed.diff")).toString(), change);
      assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), profile.patchPublication ? revised : original);
      if (!profile.patchPublication) {
        assert.deepEqual(await snapshotTree(fs), {
          ...beforePatch, "/work/patch.log": new TextEncoder().encode("checking file target.txt\n"),
          "/work/reverse.log": new Uint8Array(), "/work/streamed.diff": new TextEncoder().encode(change),
        }, "dry-run consumes the complete stream without patch publication");
      }
    });
  });

  test(`${backend}: missing paths, stderr redirection and command errors`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      const missing = await exec("cat missing.txt 2> error.log");
      assert.equal(missing.exitCode, 1);
      assert.equal(missing.stderr, "");
      assert.equal(missing.stdout, "");
      assert.match(Buffer.from(await fs.readFile("/work/error.log")).toString(), /ENOENT.*missing\.txt/);
      const beforeRedirect = await snapshotTree(fs);
      const redirect = await exec("cat < missing.txt");
      assert.equal(redirect.exitCode, 1);
      assert.equal(redirect.stdout, "");
      assert.equal(redirect.stderr, "shell: line 1: missing.txt: No such file or directory\n");
      assert.deepEqual(await snapshotTree(fs), beforeRedirect, "missing input redirect preserves namespace and bytes");
      const missingPath = "/work/missing.txt";
      for (const operation of [
        () => fs.access(missingPath, 4),
        () => fs.readFile(missingPath),
        () => fs.stat(missingPath),
      ]) {
        await assert.rejects(operation, fsError("ENOENT", missingPath));
        assert.deepEqual(await snapshotTree(fs), beforeRedirect, "failed filesystem lookup preserves namespace and bytes");
      }
      const unknown = await exec("adapter_tools_nonexistent_command");
      assert.equal(unknown.exitCode, 127);
      assert.match(unknown.stderr, /not found/);
      const invalid = await exec("rg '[' src/tasks.txt");
      assert.equal(invalid.exitCode, 2);
      assert.notEqual(invalid.stderr, "");
    });
  });

  test(`${backend}: cancellation interrupts actual blocked command pipeline`, options, async context => {
    await withFixture(backend, async ({ exec, dispatched }) => {
      const controller = new AbortController();
      const reason = new Error("adapter-tools deterministic cancellation");
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      let returned = false;
      const stdin: ByteSource = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              entered();
              return new Promise<IteratorResult<Uint8Array>>((_resolve, reject) => {
                if (controller.signal.aborted) reject(controller.signal.reason);
                else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
              });
            },
            async return() { returned = true; return { done: true, value: undefined }; },
          };
        },
      };
      const timer = setTimeout(() => controller.abort(new Error("cancellation readiness deadline")), 3000);
      try {
        const task = exec("cat | gzip -c | sha256sum", { stdin, signal: controller.signal });
        const rejection = assert.rejects(task, error => error === reason);
        void rejection.catch(() => {});
        await Promise.race([started, task]);
        controller.abort(reason);
        await rejection;
        assert.equal(returned, true, "caller iterator released");
        assert.ok(dispatched.includes("cat"));
        assert.ok(dispatched.includes("gzip"));
        assert.ok(dispatched.includes("sha256sum"));
        const before = dispatched.length;
        await assert.rejects(exec("cat payload.bin", { signal: controller.signal }), error => error === reason);
        assert.equal(dispatched.length, before, "pre-aborted execution dispatches nothing");
      } finally {
        clearTimeout(timer);
        controller.abort(reason);
      }
      success(await exec("cat", { stdin: original }), original);
    });
    if (backend === "memory") {
      const reasons = [undefined, null, false, 0, -0, NaN, "", new Error("body failure"), new DOMException("cancelled", "AbortError")];
      for (const [index, reason] of reasons.entries()) {
        for (const failure of ["body", "cleanup", "both"] as const) {
          let disposals = 0;
          const cleanupReason = failure === "both" ? reasons[(index + 1) % reasons.length] : reason;
          await assert.rejects(withFixture("memory", async ({ shell }) => {
            const dispose = shell.dispose;
            context.mock.method(shell, "dispose", async () => {
              disposals++;
              await dispose.call(shell);
              if (failure !== "body") throw cleanupReason;
            });
            if (failure !== "cleanup") throw reason;
          }), error => {
            if (failure === "body") assert.equal(error, reason);
            else {
              assert.ok(error instanceof AggregateError);
              assert.equal(error.message, "fixture cleanup failed");
              assert.equal(error.errors.length, 1);
              assert.equal(error.errors[0], cleanupReason);
            }
            return true;
          });
          assert.equal(disposals, 1);
        }
      }

      let release!: () => void;
      let notify!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { notify = resolve; });
      let completed = false;
      let disposals = 0;
      let disposal: Promise<void> | undefined;
      const task = withFixture("memory", async ({ shell }) => {
        const dispose = shell.dispose;
        context.mock.method(shell, "dispose", () => {
          disposal = (async () => {
            disposals++;
            await dispose.call(shell);
            notify();
            await barrier;
            completed = true;
          })();
          return disposal;
        });
      }).then(() => ({ failed: false, completed }), reason => ({ failed: true, reason, completed }));
      try {
        await Promise.race([entered, task]);
        assert.equal(disposals, 1);
        assert.equal(completed, false);
      } finally {
        release();
        await Promise.allSettled([task, disposal]);
      }
      const outcome = await task;
      assert.equal(outcome.failed, false);
      assert.equal(outcome.completed, true, "fixture settlement must await deferred cleanup");
      assert.equal(disposals, 1);
      context.diagnostic("28 fixture cleanup controls: 27 falsey/primary/cleanup combinations and deferred disposal");
    }
    if (backend === "webdav") {
      for (const failBody of [false, true]) {
        const events: string[] = [];
        await assert.rejects(withFixture("webdav", async ({ shell, dav }) => {
          assert.ok(dav);
          const dispose = shell.dispose;
          context.mock.method(shell, "dispose", async () => {
            await dispose.call(shell);
            events.push("shell");
            throw undefined;
          });
          const clear = dav.files.clear;
          context.mock.method(dav.files, "clear", () => {
            clear.call(dav.files);
            dav.locks.clear();
            events.push("server");
            throw false;
          });
          if (failBody) throw new Error("body failure must not replace cleanup aggregation");
        }), error => {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.message, "fixture cleanup failed");
          assert.equal(error.errors.length, 2);
          assert.equal(error.errors[0], undefined);
          assert.equal(error.errors[1], false);
          return true;
        });
        assert.deepEqual(events, ["shell", "server"], "all registered cleanup runs once in reverse order");
      }
      context.diagnostic("2 fixture cleanup controls: multiple falsey cleanup failures with and without body failure");
    }
  });

  test(`${backend}: output limit terminates real binary reads`, options, async () => {
    await withFixture(backend, async ({ exec }) => {
      await assert.rejects(exec("cat payload.bin", { limits: { maxOutputBytes: 32 } }),
        error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      success(await exec("cat old.txt"), original);
    });
  });
}

test("mount: cross-backend pipelines, supported copy and explicit S3 source refusal", options, async context => {
  await withFixture("mount", async ({ exec, fs, s3 }) => {
    const sources = [
      "set -o pipefail; cat payload.bin | gzip -c > /objects/archive.gz",
      "cp payload.bin /objects/copied.bin",
      "cp /objects/seed.bin returned.bin",
    ];
    const failures: string[] = [];
    for (const source of sources) {
      try {
        const before = { ...await snapshotTree(fs), ...await snapshotTree(fs, "/objects") };
        const result = await exec(source);
        if (source === "cp /objects/seed.bin returned.bin") {
          refusal(result, "cp: ENOTSUP: copy requires retained reads and streaming writes '/objects/seed.bin'\n", 1);
          assert.deepEqual({ ...await snapshotTree(fs), ...await snapshotTree(fs, "/objects") }, before);
        } else success(result, "");
      }
      catch (error) {
        const message = `${source}: ${String(error)}`;
        context.diagnostic(message);
        failures.push(message);
      }
    }
    assert.deepEqual(failures, [], "each cross-backend operation must meet its explicit success or refusal contract");
    const before = await snapshotTree(fs);
    refusal(await exec("gzip -dc /objects/archive.gz"), "gzip: ENOTSUP: named input requires retained VFS reads with stable scoped identities '/objects/archive.gz'\n", 1);
    assert.deepEqual(await snapshotTree(fs), before);
    success(await exec("set -o pipefail; gzip -dc < /objects/archive.gz | sha256sum"), `${digest}  -\n`);
    await fs.copyFile("/objects/seed.bin", "/work/returned.bin", { exclusive: true });
    assert.deepEqual(await fs.readFile("/work/returned.bin"), payload);
    assert.deepEqual(await fs.readFile("/objects/copied.bin"), payload);
    assert.ok(s3?.requests.some(request => request.operation === "putObject"));
    assert.ok(s3?.requests.some(request => request.operation === "getObject"));
  });
});

test("overlay: edit and remove lower files without changing the lower layer", options, async () => {
  await withFixture("overlay", async ({ exec, fs, lower }) => {
    success(await exec("sed -i 's/beta/BETA/' target.txt && rm old.txt && diff -q target.txt new.txt && test ! -e old.txt"), "");
    assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), revised);
    assert.ok(lower);
    assert.equal(Buffer.from(await lower.readFile("/work/target.txt")).toString(), original);
    assert.equal(Buffer.from(await lower.readFile("/work/old.txt")).toString(), original);
  });
});

test("readonly: all six aggregate families can inspect without mutation", options, async () => {
  await withFixture("readonly", async ({ exec, fs, dispatched }) => {
    const before = await snapshotTree(fs);
    const report = await exec(`set -o pipefail; ${todoPipeline}`);
    success(report);
    assert.deepEqual(JSON.parse(report.stdout), ["alpha:2", "beta:3"]);
    success(await exec("set -o pipefail; cat payload.bin | gzip -c | gzip -dc | sha256sum"), `${digest}  -\n`);
    success(await exec("diff -q old.txt target.txt"), "");
    success(await exec("patch --dry-run -i change.diff"));
    assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), original);
    assert.deepEqual(await snapshotTree(fs), before);
    allFamiliesDispatched(dispatched);
  });
});

test("structured capability gap: raw slurped text can be split into lines", options, async () => {
  await withFixture("memory", async ({ exec }) => {
    const result = await exec("jq -R -s 'split(\"\\n\") | map(select(length > 0))'", { stdin: "alpha\nbeta\n" });
    success(result);
    assert.deepEqual(JSON.parse(result.stdout), ["alpha", "beta"]);
  });
});

for (const source of [
  "printf 'changed' > target.txt", "printf 'changed' >> target.txt",
  "mkdir denied", "cp old.txt denied.txt", "mv old.txt denied.txt", "rm old.txt",
  "sed -i 's/beta/BETA/' target.txt", "patch -i change.diff", "gzip payload.bin",
]) {
  test(`readonly: rejects mutation: ${source}`, options, async () => {
    await withFixture("readonly", async ({ exec, fs }) => {
      const before = await snapshotTree(fs);
      const result = await exec(source);
      assert.notEqual(result.exitCode, 0, "readonly mutation must fail");
      assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), original);
      assert.equal(Buffer.from(await fs.readFile("/work/old.txt")).toString(), original);
      assert.deepEqual(await fs.readFile("/work/payload.bin"), payload);
      success(await exec("test ! -e denied && test ! -e denied.txt && test ! -e payload.bin.gz"), "");
      assert.deepEqual(await snapshotTree(fs), before, "readonly preserves the entire namespace and bytes");
      if (source === "printf 'changed' > target.txt" || source === "printf 'changed' >> target.txt") {
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "shell: line 1: target.txt: Read-only file system\n");
        const path = "/work/target.txt";
        if (source === "printf 'changed' >> target.txt") {
          await assert.rejects(
            () => fs.writeFile(path, new Uint8Array(), { flag: "a" }),
            fsError("EROFS", path),
          );
          assert.deepEqual(await snapshotTree(fs), before, "readonly append-open rejection preserves namespace and bytes");
        }
        const mutation = source === "printf 'changed' > target.txt"
          ? () => fs.writeFile(path, Buffer.from("changed"), { flag: "w" })
          : () => fs.appendFile(path, Buffer.from("changed"));
        await assert.rejects(mutation, fsError("EROFS", path));
        assert.deepEqual(await snapshotTree(fs), before, "direct readonly rejection preserves namespace and bytes");
      } else if (source === "patch -i change.diff") {
        refusal(result, patchPublicationError);
        await assert.rejects(fs.writeFile("/work/target.txt", Buffer.from("changed")), fsError("EROFS", "/work/target.txt"));
        assert.deepEqual(await snapshotTree(fs), before);
      } else {
        assert.match(result.stderr, /EROFS/, "actual readonly filesystem error, not an unrelated command failure");
      }
    });
  });
}
