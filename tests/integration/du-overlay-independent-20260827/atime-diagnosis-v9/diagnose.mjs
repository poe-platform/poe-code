import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  statfs,
  utimes,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { platform, release } from "node:os";

const ITERATIONS = 3;
const OLD_SECONDS = 946684800;
const FRACTIONAL_OLD_SECONDS = 946684800.123;
const PAYLOAD = new Uint8Array(1500).fill(0x61);
const EXPECTED_PAYLOAD_SHA256 = "b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809";

const scratchParent = resolve(process.argv[2] ?? "");
const outputPath = resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3]) {
  throw new Error("usage: node diagnose.mjs OWNED_SCRATCH_PARENT OUTPUT_JSON");
}

function rawStat(value) {
  return {
    dev: value.dev.toString(),
    ino: value.ino.toString(),
    mode: value.mode.toString(),
    nlink: value.nlink.toString(),
    uid: value.uid.toString(),
    gid: value.gid.toString(),
    size: value.size.toString(),
    blocks: value.blocks.toString(),
    atimeNs: value.atimeNs.toString(),
    mtimeNs: value.mtimeNs.toString(),
    ctimeNs: value.ctimeNs.toString(),
    birthtimeNs: value.birthtimeNs.toString(),
    type: value.isFile() ? "file" : value.isDirectory() ? "directory" : value.isSymbolicLink() ? "symlink" : "other"
  };
}

async function sample(path) {
  return rawStat(await lstat(path, { bigint: true }));
}

function atimeChanged(before, after) {
  return before.atimeNs !== after.atimeNs;
}

async function traced(trace, label, path, operation) {
  const before = await sample(path);
  const value = await operation();
  const after = await sample(path);
  trace.push({ label, pathRole: basename(path), before, after, atimeChanged: atimeChanged(before, after), value });
  return value;
}

async function forceOld(trace, label, path, seconds = OLD_SECONDS) {
  const current = await stat(path, { bigint: true });
  await utimes(path, seconds, Number(current.mtimeNs) / 1e9);
  const observed = await stat(path, { bigint: true });
  const record = {
    label,
    pathRole: basename(path),
    requestedAtimeNs: BigInt(Math.round(seconds * 1e9)).toString(),
    before: rawStat(current),
    observed: rawStat(observed),
    demonstrablyOld: observed.atimeNs < current.atimeNs && observed.atimeNs < observed.mtimeNs
  };
  trace.push(record);
  return record;
}

async function literalAdapterRootSteps(trace, root, file) {
  const canonical = await traced(trace, "root-realpath", root, async () => realpath(root));
  await traced(trace, "root-stat", root, async () => rawStat(await stat(canonical, { bigint: true })));
  await traced(trace, "root-revalidation-realpath", root, async () => realpath(canonical));
  await traced(trace, "root-revalidation-stat", root, async () => rawStat(await stat(canonical, { bigint: true })));
  await traced(trace, "walk-final-lstat", file, async () => rawStat(await lstat(file, { bigint: true })));
  await traced(trace, "operation-final-lstat", file, async () => rawStat(await lstat(file, { bigint: true })));
  return canonical;
}

async function makeFixture(parent, prefix) {
  const root = await mkdtemp(join(parent, prefix));
  const file = join(root, "file.bin");
  await writeFile(file, PAYLOAD);
  return { root, file };
}

async function probeIteration(parent, index) {
  const roots = [];
  const result = { index, probes: {} };
  try {
    {
      const fixture = await makeFixture(parent, `iteration-${index}-noaccess-`);
      roots.push(fixture.root);
      const trace = [];
      await forceOld(trace, "force-old", fixture.file);
      const immediate = await sample(fixture.file);
      await Promise.resolve();
      const microtask = await sample(fixture.file);
      await new Promise(resolvePromise => setImmediate(resolvePromise));
      const immediateTurn = await sample(fixture.file);
      await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
      const fiveMilliseconds = await sample(fixture.file);
      result.probes.noAccess = {
        trace,
        checkpoints: { immediate, microtask, immediateTurn, fiveMilliseconds },
        changedAfterSetup: [immediate, microtask, immediateTurn, fiveMilliseconds].some(value => value.atimeNs !== trace[0].observed.atimeNs)
      };
    }

    {
      const fixture = await makeFixture(parent, `iteration-${index}-v8mimic-`);
      roots.push(fixture.root);
      const trace = [];
      await literalAdapterRootSteps(trace, fixture.root, fixture.file);
      const inventory = await sample(fixture.file);
      await forceOld(trace, "force-old-after-inventory", fixture.file);
      const setupObserved = trace.at(-1).observed;
      const canonical = await literalAdapterRootSteps(trace, fixture.root, fixture.file);
      const final = await sample(fixture.file);
      result.probes.v8Mimic = {
        trace,
        inventory,
        configuredRoot: fixture.root,
        canonicalRoot: canonical,
        configuredFileIdentity: await sample(fixture.file),
        canonicalFileIdentity: await sample(join(canonical, "file.bin")),
        setupObserved,
        final,
        changedAcrossLstatOnlyGap: final.atimeNs !== setupObserved.atimeNs
      };
    }

    {
      const fixture = await makeFixture(parent, `iteration-${index}-priorread-`);
      roots.push(fixture.root);
      const trace = [];
      const priorBytes = await readFile(fixture.file);
      await forceOld(trace, "force-old-after-completed-read", fixture.file);
      const setupObserved = trace.at(-1).observed;
      await literalAdapterRootSteps(trace, fixture.root, fixture.file);
      const final = await sample(fixture.file);
      result.probes.completedPriorRead = {
        trace,
        priorBytesSha256: createHash("sha256").update(priorBytes).digest("hex"),
        setupObserved,
        final,
        changedAfterCompletedReadAndReset: final.atimeNs !== setupObserved.atimeNs
      };
    }

    {
      const fixture = await makeFixture(parent, `iteration-${index}-transitions-`);
      roots.push(fixture.root);
      const trace = [];
      await forceOld(trace, "force-old-directory", fixture.root);
      const directoryBefore = await sample(fixture.root);
      const names = await readdir(fixture.root);
      const directoryAfter = await sample(fixture.root);
      await forceOld(trace, "force-old-file", fixture.file);
      const fileBefore = await sample(fixture.file);
      const bytes = await readFile(fixture.file);
      const fileAfter = await sample(fixture.file);
      result.probes.transitions = {
        trace,
        directory: { before: directoryBefore, after: directoryAfter, names, atimeChanged: atimeChanged(directoryBefore, directoryAfter) },
        file: {
          before: fileBefore,
          after: fileAfter,
          bytesSha256: createHash("sha256").update(bytes).digest("hex"),
          atimeChanged: atimeChanged(fileBefore, fileAfter)
        }
      };
    }

    {
      const fixture = await makeFixture(parent, `iteration-${index}-precision-`);
      roots.push(fixture.root);
      const trace = [];
      const forced = await forceOld(trace, "force-fractional-old", fixture.file, FRACTIONAL_OLD_SECONDS);
      result.probes.precision = {
        trace,
        requestedAtimeNs: forced.requestedAtimeNs,
        observedAtimeNs: forced.observed.atimeNs,
        errorNs: (BigInt(forced.observed.atimeNs) - BigInt(forced.requestedAtimeNs)).toString()
      };
    }
  } finally {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  }
  return result;
}

const startedAt = new Date().toISOString();
const scratchRoot = await mkdtemp(join(scratchParent, "atime-diagnosis-v9-"));
let iterations = [];
let fatal;
try {
  for (let index = 1; index <= ITERATIONS; index++) {
    try {
      iterations.push(await probeIteration(scratchRoot, index));
    } catch (error) {
      iterations.push({ index, fatal: { name: error?.name, code: error?.code, message: error?.message, stack: error?.stack } });
    }
  }
} catch (error) {
  fatal = { name: error?.name, code: error?.code, message: error?.message, stack: error?.stack };
} finally {
  await rm(scratchRoot, { recursive: true, force: true });
}

let scratchPostRemoval;
try {
  await lstat(scratchRoot);
  scratchPostRemoval = { state: "present" };
} catch (error) {
  scratchPostRemoval = { state: "absent", code: error?.code, name: error?.name, message: error?.message };
}

const filesystem = await statfs(scratchParent, { bigint: true });
const output = {
  schemaVersion: 1,
  diagnosticKind: "neutral-node-host-filesystem",
  startedAt,
  finishedAt: new Date().toISOString(),
  fixedIterations: ITERATIONS,
  runtime: { node: process.version, platform: platform(), release: release(), arch: process.arch },
  filesystem: {
    type: filesystem.type.toString(),
    bsize: filesystem.bsize.toString(),
    blocks: filesystem.blocks.toString(),
    bfree: filesystem.bfree.toString(),
    bavail: filesystem.bavail.toString(),
    files: filesystem.files.toString(),
    ffree: filesystem.ffree.toString()
  },
  payload: { length: PAYLOAD.byteLength, sha256: createHash("sha256").update(PAYLOAD).digest("hex"), expectedSha256: EXPECTED_PAYLOAD_SHA256 },
  scratch: { basename: basename(scratchRoot), postRemoval: scratchPostRemoval },
  iterations,
  ...(fatal === undefined ? {} : { fatal })
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ outputPath, iterations: iterations.length, fatal: fatal ?? null, scratchPostRemoval })}\n`);
if (fatal || iterations.some(value => value.fatal)) process.exitCode = 1;
