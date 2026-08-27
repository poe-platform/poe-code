import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = await realpath(process.argv[2]);
if (await realpath(process.cwd()) !== root) throw new Error("Run from the named frozen root");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const paths = (await readdir(join(root, "src/commands/archive"))).filter(name => name.endsWith(".ts")).map(name => `src/commands/archive/${name}`);
paths.push("src/fs/memory/index.ts", "tests/commands/archive-stress/pax-independent/fixtures.ts");
const hashes = async () => Promise.all(paths.map(async path => ({ path, sha256: hash(await readFile(join(root, path))) })));
const before = await hashes();
const { createMemoryFileSystem } = await import(pathToFileURL(join(root, "src/fs/memory/index.ts")).href);
const { createTarCommand } = await import(pathToFileURL(join(root, "src/commands/archive/index.ts")).href);
const { archive, checksum, fileData, member, record } = await import(pathToFileURL(join(root, "tests/commands/archive-stress/pax-independent/fixtures.ts")).href);
const extension = records => member("metadata", Buffer.concat(records), "x");
const negative = member("safe", fileData);
negative.fill(255, 136, 148);
checksum(negative);
const malformed = member("safe", fileData);
malformed.fill(57, 136, 148);
checksum(malformed);
const cases = [
  ["D04 original FF unmasked", archive(negative)],
  ["D04 ASCII9 unmasked", archive(malformed)],
  ["D04 ASCII9 with valid PAX override", archive(extension([record("mtime", "1700200000.125")]), malformed)],
  ["D07 shadowed numeric then deletion", archive(extension([record("mtime", "1e3"), record("mtime", "")]), member("safe", fileData))],
  ["D07 effective invalid numeric", archive(extension([record("mtime", "1e3")]), member("safe", fileData))],
];
const observations = [];
for (const [name, bytes] of cases) {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/out");
  const write = fs.writeStream.bind(fs);
  const times = fs.utimes.bind(fs);
  let publications = 0;
  const restorations = [];
  fs.writeStream = async (path, source, options) => {
    publications++;
    await write(path, source, options);
    await times(path, 1555000000123, 1555000000456, options);
  };
  fs.utimes = async (path, atime, mtime, options) => {
    restorations.push({ path, atime, mtime });
    await times(path, atime, mtime, options);
  };
  const stdout = [];
  const stderr = [];
  let outputBytes = 0;
  const sink = destination => ({ async write(chunk) {
    outputBytes += chunk.length;
    if (outputBytes > 8192) throw new Error("diagnostic output bound");
    destination.push(Buffer.from(chunk));
  } });
  const result = await createTarCommand().execute({ command: "tar", args: ["-xf", "-", "-C", "/out"], fs, cwd: "/", env: {}, signal: AbortSignal.timeout(2000), stdin: { async *[Symbol.asyncIterator]() { yield bytes; } }, stdout: sink(stdout), stderr: sink(stderr) });
  let timesObserved;
  try { const stat = await fs.stat("/out/safe"); timesObserved = { mtime: stat.mtimeMs, atime: stat.atimeMs }; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  observations.push({ name, archiveSha256: hash(bytes), archiveBase64: bytes.toString("base64"), exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), publications, restorations, timesObserved });
}
const after = await hashes();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("diagnostic source drift");
console.log(JSON.stringify({ root, classification: "five exact VFS diagnostic controls, not added to main test counts; no native extraction", sourceBefore: before, sourceAfter: after, unchanged: true, observations }));
