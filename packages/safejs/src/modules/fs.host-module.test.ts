import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { dump } from "../dump.js";
import { readHostOperationPolicy } from "../interp/host-bridge.js";
import { restore } from "../restore.js";
import { run } from "../run.js";
import {
  HostOperationResumePolicyError,
  resolvePendingHostCallResumePolicy
} from "../snapshot/policy.js";
import { makeFsModule, type FsImplementation } from "./fs.js";

// The fs module is a host module, so the bridge's journal, cancellation, and snapshot
// machinery govern it. These cases pin the edges that machinery is responsible for
// rather than fs semantics, which fs.conformance.test.ts already covers.
const VOLUME: Readonly<Record<string, string>> = {
  "/repo/alpha.txt": "alpha-body",
  "/repo/beta.txt": "beta-body",
  "/repo/gamma.txt": "gamma-body"
};

describe("fs host module bridge behavior", () => {
  it("resolves concurrent readFile calls to their own results", async () => {
    const source = [
      'import { readFile } from "fs";',
      "const values = await Promise.all([",
      '  readFile("/repo/alpha.txt", "utf8"),',
      '  readFile("/repo/beta.txt", "utf8"),',
      '  readFile("/repo/gamma.txt", "utf8")',
      "]);",
      "return JSON.stringify(values);"
    ].join("\n");

    await expect(run(source, { modules: { fs: createFsModule() } })).resolves.toMatchObject({
      ok: true,
      returnValue: JSON.stringify(["alpha-body", "beta-body", "gamma-body"])
    });
  });

  it("keeps sibling readFile results intact when one concurrent call rejects", async () => {
    const source = [
      'import { readFile } from "fs";',
      'const alpha = readFile("/repo/alpha.txt", "utf8");',
      'const missing = readFile("/repo/missing.txt", "utf8");',
      'const beta = readFile("/repo/beta.txt", "utf8");',
      "try {",
      "  await Promise.all([alpha, missing, beta]);",
      '  return "unexpected";',
      "} catch (error) {",
      "  return JSON.stringify({",
      "    code: error.code,",
      "    path: error.path,",
      "    alpha: await alpha,",
      "    beta: await beta",
      "  });",
      "}"
    ].join("\n");

    const finished = await run(source, { modules: { fs: createFsModule() } });

    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    expect(JSON.parse(finished.returnValue as string)).toEqual({
      code: "ENOENT",
      path: "/repo/missing.txt",
      alpha: "alpha-body",
      beta: "beta-body"
    });
  });

  it("reports each settled readFile outcome with its own path", async () => {
    const source = [
      'import { readFile } from "fs";',
      "const results = await Promise.allSettled([",
      '  readFile("/repo/alpha.txt", "utf8"),',
      '  readFile("/repo/nope-one.txt", "utf8"),',
      '  readFile("/repo/beta.txt", "utf8"),',
      '  readFile("/repo/nope-two.txt", "utf8")',
      "]);",
      "return JSON.stringify(",
      "  results.map((entry) =>",
      '    entry.status === "fulfilled"',
      '      ? { status: entry.status, value: entry.value }',
      "      : { status: entry.status, code: entry.reason.code, path: entry.reason.path }",
      "  )",
      ");"
    ].join("\n");

    const finished = await run(source, { modules: { fs: createFsModule() } });

    expect(finished.ok).toBe(true);
    if (!finished.ok) {
      return;
    }

    expect(JSON.parse(finished.returnValue as string)).toEqual([
      { status: "fulfilled", value: "alpha-body" },
      { status: "rejected", code: "ENOENT", path: "/repo/nope-one.txt" },
      { status: "fulfilled", value: "beta-body" },
      { status: "rejected", code: "ENOENT", path: "/repo/nope-two.txt" }
    ]);
  });

  // Concatenates rather than calling a host binding such as JSON.stringify, because an
  // armed signal refuses every host call once it has aborted.
  it("surfaces an abort during an in-flight readFile as an abort error, not an fs error", async () => {
    const controller = new AbortController();
    const started = createDeferred<void>();
    const source = [
      'import { readFile } from "fs";',
      "try {",
      '  await readFile("/repo/alpha.txt", "utf8");',
      '  return "not-aborted";',
      "} catch (error) {",
      '  return error.name + "|" + error.message + "|" + (error.code ?? "no-code") + "|" + (error.path ?? "no-path");',
      "}"
    ].join("\n");

    const result = run(source, {
      modules: {
        fs: createFsModule({
          readFile: async () => {
            started.resolve();
            return new Promise(() => undefined);
          }
        })
      },
      signal: controller.signal
    });

    await started.promise;
    controller.abort();

    await expect(result).resolves.toMatchObject({
      ok: true,
      returnValue: "AbortError|This operation was aborted|no-code|no-path"
    });
  });

  it("reports an uncaught abort during an in-flight readFile", async () => {
    const controller = new AbortController();
    const started = createDeferred<void>();
    const result = run('import { readFile } from "fs";\nreturn await readFile("/repo/alpha.txt", "utf8");', {
      modules: {
        fs: createFsModule({
          readFile: () => {
            started.resolve();
            return new Promise(() => undefined);
          }
        })
      },
      signal: controller.signal
    });

    await started.promise;
    controller.abort();

    await expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "This operation was aborted"
    });
  });

  it("re-runs a pending readFile after restore under the re-issue policy", async () => {
    const source = 'import { readFile } from "fs";\nreturn await readFile("/repo/alpha.txt", "utf8");';
    const hanging = createDeferred<string>();
    let firstReads = 0;
    const first = run(source, {
      modules: {
        fs: createFsModule({
          readFile: () => {
            firstReads += 1;
            return hanging.promise;
          }
        })
      }
    });
    const snapshotPromise = dump(first);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    expect(firstReads).toBe(1);

    const reference = createReference();
    let resumedReads = 0;

    await expect(
      run(source, {
        modules: {
          fs: makeFsModule({
            fs: Object.assign({}, reference, {
              readFile: (...args: Parameters<FsImplementation["readFile"]>) => {
                resumedReads += 1;
                return reference.readFile(...args);
              }
            })
          })
        },
        snapshot: restore(snapshot, { source })
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "alpha-body"
    });
    expect(resumedReads).toBe(1);

    hanging.resolve("alpha-body");
    await first;
  });

  it("does not re-apply a pending writeFile after restore under the read-side-effect policy", async () => {
    const source = [
      'import { writeFile } from "fs";',
      'await writeFile("/repo/out.txt", "written");',
      'return "done";'
    ].join("\n");
    const hanging = createDeferred<undefined>();
    const writes: string[] = [];
    const implementation = {
      writeFile: (path: unknown) => {
        writes.push(String(path));
        return hanging.promise;
      }
    };
    const first = run(source, { modules: { fs: createFsModule(implementation) } });
    const snapshotPromise = dump(first);

    await flushMicrotasks();
    const snapshot = JSON.parse(await snapshotPromise);
    expect(writes).toEqual(["/repo/out.txt"]);

    await expect(
      run(source, {
        modules: { fs: createFsModule(implementation) },
        snapshot: restore(snapshot, { source })
      })
    ).rejects.toMatchObject({
      action: "external-reconciliation",
      name: "HostCallResumabilityError"
    });
    expect(writes).toEqual(["/repo/out.txt"]);

    hanging.resolve(undefined);
    await expect(first).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });

  it("refuses to resume an fs operation that declares no resume policy", async () => {
    // A run registers the module's declared operations, leaving only an operation the
    // module never declared missing from the policy table.
    await run('import { readFile } from "fs";\nreturn await readFile("/repo/alpha.txt", "utf8");', {
      modules: { fs: createFsModule() }
    });

    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "fs-chown-1",
        moduleId: "fs",
        operation: "chown"
      })
    ).toThrow(HostOperationResumePolicyError);
    expect(() =>
      resolvePendingHostCallResumePolicy({
        id: "fs-chown-1",
        moduleId: "fs",
        operation: "chown"
      })
    ).toThrow(
      "Host operation fs.chown has no resume policy; declare 're-issue' (idempotent) or 'read-side-effect' (effectful)."
    );

    expect(
      resolvePendingHostCallResumePolicy({
        id: "fs-read-file-1",
        moduleId: "fs",
        operation: "readFile"
      })
    ).toEqual({ kind: "re-issue" });
  });

  it("declares a resume policy for every exported fs operation", () => {
    expect(readDeclaredPolicies(createFsModule())).toEqual({
      access: "re-issue",
      appendFile: "read-side-effect",
      chmod: "read-side-effect",
      copyFile: "read-side-effect",
      cp: "read-side-effect",
      link: "read-side-effect",
      lstat: "re-issue",
      mkdir: "read-side-effect",
      mkdtemp: "read-side-effect",
      readFile: "re-issue",
      readdir: "re-issue",
      readlink: "re-issue",
      realpath: "re-issue",
      rename: "read-side-effect",
      rm: "read-side-effect",
      rmdir: "read-side-effect",
      stat: "re-issue",
      symlink: "read-side-effect",
      truncate: "read-side-effect",
      utimes: "read-side-effect",
      writeFile: "read-side-effect"
    });
  });
});

function createReference(): FsImplementation {
  return createFsFromVolume(Volume.fromJSON(VOLUME, "/")).promises as unknown as FsImplementation;
}

function createFsModule(overrides: Partial<FsImplementation> = {}) {
  return makeFsModule({ fs: Object.assign({}, createReference(), overrides) });
}

// Reports a missing policy as "undeclared" rather than undefined, because toEqual drops
// undefined-valued keys and would let an undeclared operation pass unnoticed.
function readDeclaredPolicies(module: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(module)
      .filter(([, value]) => typeof value === "function")
      .map(([name, value]) => [
        name,
        readHostOperationPolicy(value as (...args: readonly unknown[]) => unknown) ?? "undeclared"
      ])
  );
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushMicrotasks(iterations = 20) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}
