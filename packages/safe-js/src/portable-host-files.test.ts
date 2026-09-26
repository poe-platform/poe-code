import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runHarness } from "./runner/run-harness.js";
import { runCli } from "./cli-runtime.js";
import { runExampleFile } from "./example-runner.js";

it("runs a harness on a portable filesystem grant", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.writeFile("/value.ajs", new TextEncoder().encode("export default function () { return 42; }"));
  expect(await runHarness("/value.ajs", { adapter, modulesFor: () => ({}) })).toMatchObject({ok: true, returnValue: 42});
});

it("runs CLI files on a portable filesystem grant", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.writeFile("/value.ajs", new TextEncoder().encode("return 42;"));
  const output: string[] = [];
  const stream = {write: (value: string) => { output.push(value); }};
  expect(await runCli(["/value.ajs"], {adapter, cwd: "/", stdout: stream, stderr: stream}, "usage")).toBe(0);
  expect(output.join("")).toContain("42");
});

it("runs example files on a portable filesystem grant", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.writeFile("/value.md", new TextEncoder().encode("```js\nexport default function () { return 42; }\n```"));
  const output: string[] = [];
  const stream = {write: (value: string) => { output.push(value); }};
  expect(await runExampleFile("/value.md", {adapter, stdout: stream, stderr: stream})).toBe(0);
  expect(output.join("")).toContain("42");
});

it("publishes migrations exclusively through a portable filesystem", async () => {
  const {run} = await import("./run.js");
  const {dump} = await import("./dump.js");
  const {migrateSnapshotFile} = await import("./migration-file.js");
  const adapter = new MemoryFileSystem();
  const execution = run("return 1;");
  await execution;
  const encode = (value: string) => new TextEncoder().encode(value);
  await adapter.writeFile("/old.ajs", encode("return 1;"));
  await adapter.writeFile("/new.ajs", encode("return import.meta.migration.count;"));
  await adapter.writeFile("/old.json", encode(await dump(execution)));
  const options = {adapter, cwd: "/", snapshotPath: "old.json", sourcePath: "old.ajs"};
  const {inspection} = await migrateSnapshotFile({...options, inspect: true});
  await adapter.writeFile("/plan.json", encode(JSON.stringify({state: {count: 2}, reconciliation: {
    checkpointDigest: inspection.checkpointDigest, quiescent: true, calls: []
  }})));
  const publication = {...options, targetSourcePath: "new.ajs", planPath: "plan.json", outputPath: "next.json"};
  expect((await migrateSnapshotFile(publication)).outputPath).toBe("/next.json");
  const published = await adapter.readFile("/next.json");
  const snapshot = JSON.parse(new TextDecoder().decode(published));
  expect((await run("return import.meta.migration.count;", {snapshot})).returnValue).toBe(2);
  await expect(migrateSnapshotFile(publication)).rejects.toMatchObject({code: "EEXIST"});
  expect(await adapter.readFile("/next.json")).toEqual(published);
  expect((await adapter.readdir("/")).some(entry => entry.name.endsWith(".tmp"))).toBe(false);
});

it("writes signal snapshots through a portable filesystem", async () => {
  const {EventEmitter} = await import("node:events");
  const {attachSignalDumpHandler} = await import("./runner/signal-dump.js");
  const adapter = new MemoryFileSystem();
  const process = new EventEmitter();
  let complete!: () => void;
  const written = new Promise<void>(resolve => {complete = resolve;});
  const cleanup = attachSignalDumpHandler(new Promise(() => {}), {
    adapter, process, dumpPath: "/snapshots/value.json", dumpResult: async () => "checkpoint",
    stderr: {write() {}}, onSnapshot: complete, onError: error => {throw error;}
  });
  try {
    process.emit("SIGUSR1");
    await written;
    expect(new TextDecoder().decode(await adapter.readFile("/snapshots/value.json"))).toBe("checkpoint");
    expect((await adapter.readdir("/snapshots")).map(entry => entry.name)).toEqual(["value.json"]);
  } finally {cleanup();}
});

it("uses the CLI portable grant for rooted source imports", async () => {
  const adapter = new MemoryFileSystem();
  await adapter.mkdir("/source");
  await adapter.writeFile("/source/entry.ajs", new TextEncoder().encode('export {value} from "./value.ajs";'));
  await adapter.writeFile("/source/value.ajs", new TextEncoder().encode("export const value = 42;"));
  const output: string[] = [];
  const stream = {write: (value: string) => {output.push(value);}};
  expect(await runCli(["--source-type", "module", "--source-root", "/source", "/source/entry.ajs"],
    {adapter, cwd: "/", stdout: stream, stderr: stream}, "usage")).toBe(0);
  expect(output.join("")).toContain('"value":42');
});
