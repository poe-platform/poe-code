import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    default: fs.promises
  };
});

const { runHarnessPair } = await import("./run.js");
const api = await import("../index.js");

describe("runHarnessPair", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is re-exported from the package entrypoint", () => {
    expect(api.runHarnessPair).toBe(runHarnessPair);
  });

  it("validates frontmatter, invokes the default export with the validated value, and returns its result", async () => {
    const mdPath = "/repo/harness/review.md";
    vol.fromJSON({
      [mdPath]: ["---", "kind: review", "version: 1", "title: Build", "---", "", "# Review"].join("\n"),
      "/repo/harness/review.ajs": [
        'import { check } from "test";',
        'import { S } from "schema";',
        "export const schema = S.Object({",
        "  kind: S.String(),",
        "  version: S.Number(),",
        "  title: S.String(),",
        "  retries: S.Optional(S.Number({ default: 2 }))",
        "});",
        "export default async (frontmatter) => check(frontmatter, import.meta);"
      ].join("\n")
    });

    const check = vi.fn((frontmatter, meta) => ({
      body: meta.body,
      dirname: meta.dirname,
      filename: meta.filename,
      frontmatter,
      kind: meta.kind,
      version: meta.version
    }));
    const modulesFor = vi.fn(() => ({
      test: {
        check
      }
    }));

    const result = await runHarnessPair(mdPath, { modulesFor });

    expect(modulesFor).toHaveBeenCalledWith(
      {
        kind: "review",
        retries: 2,
        title: "Build",
        version: 1
      },
      {
        body: "\n# Review",
        dirname: dirname(mdPath),
        filename: mdPath,
        kind: "review",
        version: 1
      }
    );
    expect(result).toMatchObject({
      ok: true,
      returnValue: {
        body: "\n# Review",
        dirname: dirname(mdPath),
        filename: mdPath,
        frontmatter: {
          kind: "review",
          retries: 2,
          title: "Build",
          version: 1
        },
        kind: "review",
        version: 1
      }
    });
  });

  it("passes raw frontmatter through when the script does not export a schema", async () => {
    const mdPath = "/repo/harness/raw.md";
    vol.fromJSON({
      [mdPath]: ["---", "kind: raw", "version: 1", "title: 123", "---", "", "# Raw"].join("\n"),
      "/repo/harness/raw.ajs": "export default (frontmatter) => frontmatter;"
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).resolves.toMatchObject({
      ok: true,
      returnValue: {
        kind: "raw",
        title: 123,
        version: 1
      }
    });
  });

  it("throws validation errors with the md path and field path, releases the lock, and leaves snapshots untouched", async () => {
    const mdPath = "/repo/harness/invalid.md";
    const snapshotPath = "/snapshots/invalid.json";
    vol.fromJSON({
      [mdPath]: ["---", "kind: review", "version: 1", "title: 123", "---", "", "# Invalid"].join("\n"),
      "/repo/harness/invalid.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({ title: S.String() });",
        "export default (frontmatter) => frontmatter;"
      ].join("\n")
    });

    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({}),
        snapshotPath
      })
    ).rejects.toThrow(`${mdPath}: title: Expected string at title`);

    expect(vol.existsSync(`${mdPath}.lock`)).toBe(false);
    expect(vol.existsSync(snapshotPath)).toBe(false);
  });

  it("throws a lint error when the .ajs is missing a default export", async () => {
    const mdPath = "/repo/harness/no-default.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: review\nversion: 1\n---\n",
      "/repo/harness/no-default.ajs": [
        'import { S } from "schema";',
        "export const schema = S.Object({ kind: S.String(), version: S.Number() });"
      ].join("\n")
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      name: "LintError",
      diagnostics: [expect.objectContaining({ code: "AS-EXPORT-DEFAULT-MISSING" })]
    });
  });

  it("allows a top-level return warning in .ajs and still succeeds", async () => {
    const mdPath = "/repo/harness/top-return.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: review\nversion: 1\n---\n",
      "/repo/harness/top-return.ajs": "export default () => 'ok';\nreturn 'ignored';"
    });

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).resolves.toMatchObject({
      ok: true,
      returnValue: "ok"
    });
  });

  it("resumes from an existing snapshotPath at the next host call", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00.000Z"));

    const mdPath = "/repo/harness/resume.md";
    const snapshotPath = "/snapshots/resume.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: resume\nversion: 1\n---\n",
      "/repo/harness/resume.ajs": [
        'import { step } from "host";',
        "export default async () => {",
        "  const first = await step('first');",
        "  const second = await step('second');",
        "  return first.concat('|').concat(second);",
        "};"
      ].join("\n")
    });

    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const firstController = new AbortController();
    const firstCalls: string[] = [];
    const firstRun = runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            firstCalls.push(name);
            return name === "first" ? first.promise : second.promise;
          }
        }
      }),
      signal: firstController.signal,
      snapshotPath
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(firstCalls).toEqual(["first"]);

    await vi.advanceTimersByTimeAsync(30_000);
    first.resolve("alpha");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);

    expect(firstCalls).toEqual(["first", "second"]);
    expect(vol.existsSync(snapshotPath)).toBe(true);

    firstController.abort();
    second.reject(new Error("aborted"));
    await expect(firstRun).rejects.toMatchObject({
      name: "SandboxError"
    });

    const secondCalls: string[] = [];
    const resumed = await runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async step(name: string) {
            secondCalls.push(name);
            return "beta";
          }
        }
      }),
      snapshotPath
    });

    expect(secondCalls).toEqual(["second"]);
    expect(resumed).toMatchObject({
      ok: true,
      returnValue: "alpha|beta"
    });
  });

  it("does not replay stale host calls after a successful run with the same snapshotPath", async () => {
    const mdPath = "/repo/harness/fresh.md";
    const snapshotPath = "/snapshots/fresh.json";
    vol.fromJSON({
      [mdPath]: "---\nkind: fresh\nversion: 1\n---\n",
      "/repo/harness/fresh.ajs": [
        'import { read } from "host";',
        "export default async () => read();"
      ].join("\n")
    });

    const firstRead = vi.fn(() => "first");
    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            read: firstRead
          }
        }),
        snapshotPath
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "first"
    });
    expect(firstRead).toHaveBeenCalledTimes(1);

    const secondRead = vi.fn(() => "second");
    await expect(
      runHarnessPair(mdPath, {
        modulesFor: () => ({
          host: {
            read: secondRead
          }
        }),
        snapshotPath
      })
    ).resolves.toMatchObject({
      ok: true,
      returnValue: "second"
    });
    expect(secondRead).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent run against the same .md while the first run holds the lock", async () => {
    const mdPath = "/repo/harness/concurrent.md";
    vol.fromJSON({
      [mdPath]: "---\nkind: concurrent\nversion: 1\n---\n",
      "/repo/harness/concurrent.ajs": [
        'import { wait } from "host";',
        "export default async () => {",
        "  await wait();",
        "  return 'done';",
        "};"
      ].join("\n")
    });

    const releaseFirst = createDeferred<void>();
    const firstRun = runHarnessPair(mdPath, {
      modulesFor: () => ({
        host: {
          async wait() {
            return releaseFirst.promise;
          }
        }
      })
    });
    await flushMicrotasks();
    await flushMicrotasks();

    await expect(runHarnessPair(mdPath, { modulesFor: () => ({}) })).rejects.toMatchObject({
      code: "EEXIST"
    });

    releaseFirst.resolve();
    await expect(firstRun).resolves.toMatchObject({
      ok: true,
      returnValue: "done"
    });
  });
});

function createDeferred<TValue>() {
  let resolve!: (value: TValue) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<TValue>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return {
    promise,
    reject,
    resolve
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
