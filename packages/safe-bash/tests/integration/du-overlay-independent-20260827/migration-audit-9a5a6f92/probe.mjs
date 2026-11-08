import { pathToFileURL } from "node:url";

const snapshot = process.argv[2];
if (!snapshot) throw new Error("snapshot path required");

const fromSnapshot = path => pathToFileURL(`${snapshot}/${path}`).href;
const { createMemoryFileSystem } = await import(fromSnapshot("src/fs/memory/index.ts"));
const { run, seed, shellRun, trace } = await import(fromSnapshot("tests/commands/du/helpers.ts"));

const resultOnly = result => ({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });

const environmentCases = [];
for (const [id, env] of [
  ["selected-BLOCK_SIZE-invalid", { BLOCK_SIZE: "bad", BLOCKSIZE: "1" }],
  ["selected-BLOCK_SIZE-empty", { BLOCK_SIZE: "", BLOCKSIZE: "1" }],
  ["selected-BLOCKSIZE-invalid", { BLOCKSIZE: "bad" }],
  ["selected-BLOCKSIZE-empty-posix", { BLOCKSIZE: "", POSIXLY_CORRECT: "" }],
]) {
  const filesystem = createMemoryFileSystem();
  await filesystem.writeFile("/file", new Uint8Array(1025));
  const checked = trace(filesystem);
  const result = await run(["--apparent-size", "file"], {}, { fs: checked.fs, env });
  environmentCases.push({ id, argv: ["--apparent-size", "file"], env, ...resultOnly(result),
    calls: checked.calls.map(call => ({ method: call.method, path: call.path })) });
}

const originalBehaviorInputs = [];
const canonicalBehaviorInputs = [];
for (const env of [{ DU_BLOCK_SIZE: "bad" }, { DU_BLOCK_SIZE: "", BLOCK_SIZE: "1" }]) {
  const originalFs = trace(createMemoryFileSystem());
  const originalResult = await run([], {}, { fs: originalFs.fs, env });
  originalBehaviorInputs.push({ argv: [], env, ...resultOnly(originalResult),
    calls: originalFs.calls.map(call => ({ method: call.method, path: call.path })) });

  const migratedFs = createMemoryFileSystem();
  await migratedFs.writeFile("/file", new Uint8Array(1025));
  const migratedTrace = trace(migratedFs);
  const migratedResult = await run(["--apparent-size", "file"], {}, { fs: migratedTrace.fs, env });
  canonicalBehaviorInputs.push({ argv: ["--apparent-size", "file"], fixture: { path: "/file", logicalBytes: 1025 },
    env, ...resultOnly(migratedResult), calls: migratedTrace.calls.map(call => ({ method: call.method, path: call.path })) });
}

const explicitFs = trace(createMemoryFileSystem());
const explicitInvalid = await run(["--apparent-size", "-B", "bad", "file"], {}, {
  fs: explicitFs.fs, env: { DU_BLOCK_SIZE: "1" },
});

const repeatedFs = createMemoryFileSystem();
await seed(repeatedFs);
const repeated = await shellRun(repeatedFs, ["-b", "tree", "tree"]);

const orderedFs = createMemoryFileSystem();
await orderedFs.writeFile("/z", new Uint8Array(1));
await orderedFs.writeFile("/a", new Uint8Array(1));
const ordered = await shellRun(orderedFs, ["-ba", "/"]);

process.stdout.write(JSON.stringify({ originalBehaviorInputs, canonicalBehaviorInputs, environmentCases,
  explicitInvalid: { argv: ["--apparent-size", "-B", "bad", "file"], env: { DU_BLOCK_SIZE: "1" },
    ...resultOnly(explicitInvalid), calls: explicitFs.calls.map(call => ({ method: call.method, path: call.path })) },
  repeated: { id: "O060", argv: ["-b", "tree", "tree"], ...resultOnly(repeated) },
  ordered: { argv: ["-ba", "/"], creationOrder: ["z", "a"], ...resultOnly(ordered) } }, null, 2) + "\n");
