import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { ShellLimitError, type ByteSource } from "../../../src/index.js";
import {
  allFamiliesDispatched, change, fsError, original, payload, revised, snapshotTree, success,
  withFixture, writableAdapters,
} from "./fixtures.js";
import { withRmdirFixture } from "./profiles/rmdir-fixtures.js";

const digest = createHash("sha256").update(payload).digest("hex");
const options = { timeout: 20_000 };
const todoPipeline = "find src -type f -name '*.txt' | xargs rg --no-heading --no-filename '^TODO' | sed 's/^TODO //' | awk '{ print $1 \":\" $2 }' | jq -R '.' | jq -s '.'";

for (const backend of writableAdapters) {
  test(`${backend}: independent six-family named-file probes`, options, async context => {
    await withFixture(backend, async ({ exec, dispatched }) => {
      const failures: string[] = [];
      const probes = [
        ["find src -type f -name '*.txt'", "src/tasks.txt\n"],
        ["cat old.txt", original],
        ["rg --no-heading --no-filename '^TODO' src/tasks.txt", "TODO alpha 2\nTODO beta 3\n"],
        ["sed 's/beta/BETA/' old.txt", revised],
        ["awk '{ print $1 }' old.txt", original],
        ["jq -c '.names' config.json", '["alpha","beta"]\n'],
        ["sha256sum payload.bin", `${digest}  payload.bin\n`],
        ["set -o pipefail; gzip -c payload.bin | gzip -dc", payload],
        ["diff -q old.txt target.txt", ""],
        ["patch --dry-run -i change.diff", undefined],
      ] as const;
      for (const [source, expected] of probes) {
        try {
          const result = await exec(source);
          success(result, typeof expected === "string" ? expected : undefined);
          if (expected instanceof Uint8Array) assert.deepEqual(result.stdoutBytes, expected);
        } catch (error) {
          const message = `${source}: ${String(error)}`;
          context.diagnostic(message);
          failures.push(message);
        }
      }
      allFamiliesDispatched(dispatched);
      assert.deepEqual(failures, [], "every named-file probe must pass; no capability-based skips");
    });
  });

  test(`${backend}: aggregate six-family coding-agent flow`, options, async () => {
    await withFixture(backend, async fixture => {
      const { exec, fs, dispatched } = fixture;
      success(await exec(`set -o pipefail; ${todoPipeline} > report.json; status=$?; cat report.json; exit "$status"`));
      assert.deepEqual(JSON.parse(Buffer.from(await fs.readFile("/work/report.json")).toString()), ["alpha:2", "beta:3"]);
      success(await exec("jq -r '.[]' < report.json"), "alpha:2\nbeta:3\n");
      success(await exec("set -o pipefail; cat < payload.bin | gzip -c > payload.gz"), "");
      success(await exec("set -o pipefail; gzip -dc < payload.gz | sha256sum"), `${digest}  -\n`);
      const diff = await exec("diff -u --label target.txt --label target.txt old.txt new.txt > generated.diff");
      assert.equal(diff.exitCode, 1, diff.stderr);
      assert.equal(diff.stderr, "");
      assert.equal(Buffer.from(await fs.readFile("/work/generated.diff")).toString(), change);
      success(await exec("patch -i generated.diff > patch.log && diff -q target.txt new.txt && cat target.txt"), revised);
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

  test(`${backend === "webdav" ? "webdav configured atomic-empty" : backend}: create, copy, append, inspect and remove files`, options, async () => {
    await withRmdirFixture(backend, async ({ exec, fs }) => {
      success(await exec("mkdir -p scratch/nested && cp old.txt scratch/nested/copy.txt && printf 'gamma\\n' >> scratch/nested/copy.txt && cat scratch/nested/copy.txt"), `${original}gamma\n`);
      assert.equal(Buffer.from(await fs.readFile("/work/old.txt")).toString(), original);
      success(await exec("find scratch -type f | sort"), "scratch/nested/copy.txt\n");
      success(await exec("rm scratch/nested/copy.txt && rmdir scratch/nested && rmdir scratch && test ! -e scratch"), "");
    });
  });

  test(`${backend}: move retains bytes and removes source`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      success(await exec("cp payload.bin move-source.bin && mv move-source.bin moved.bin"), "");
      assert.deepEqual(await fs.readFile("/work/moved.bin"), payload);
      success(await exec("test ! -e move-source.bin"), "");
    });
  });

  test(`${backend}: touch creates an empty file successfully`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      const result = await exec("touch touched.txt");
      assert.deepEqual(await fs.readFile("/work/touched.txt"), new Uint8Array(), "inspect partial creation even when touch reports failure");
      success(result, "");
    });
  });

  test(`${backend}: in-place edit, diff-to-patch stdin and reverse`, options, async () => {
    await withFixture(backend, async ({ exec, fs }) => {
      success(await exec("sed -i 's/beta/BETA/' old.txt && diff -q old.txt new.txt"), "");
      success(await exec("cat change.diff | patch > patch.log && diff -q target.txt new.txt && patch -R -i change.diff > reverse.log && cat target.txt"), original);
      assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), original);
      const diff = await exec("diff -u --label target.txt --label target.txt target.txt new.txt | tee streamed.diff | patch > patch.log");
      success(diff, "");
      assert.equal(Buffer.from(await fs.readFile("/work/streamed.diff")).toString(), change);
      assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), revised);
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

test("mount: cross-backend pipeline and copy use real mount plus S3", options, async context => {
  await withFixture("mount", async ({ exec, fs, s3 }) => {
    const sources = [
      "set -o pipefail; cat payload.bin | gzip -c > /objects/archive.gz",
      "cp payload.bin /objects/copied.bin",
      "cp /objects/seed.bin returned.bin",
    ];
    const failures: string[] = [];
    for (const source of sources) {
      try { success(await exec(source), ""); }
      catch (error) {
        const message = `${source}: ${String(error)}`;
        context.diagnostic(message);
        failures.push(message);
      }
    }
    assert.deepEqual(failures, [], "pipeline and both cross-backend copy directions must succeed");
    success(await exec("set -o pipefail; gzip -dc /objects/archive.gz | sha256sum"), `${digest}  -\n`);
    assert.deepEqual(await fs.readFile("/work/returned.bin"), payload);
    assert.deepEqual(await fs.readFile("/objects/copied.bin"), payload);
    assert.ok(s3?.requests.some(request => request.operation === "putObject"));
    assert.ok(s3?.requests.some(request => request.operation === "getObject"));
  });
});

test("overlay: edit and remove lower files without changing S3 lower", options, async () => {
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
      } else {
        assert.match(result.stderr, /EROFS/, "actual readonly filesystem error, not an unrelated command failure");
      }
    });
  });
}
