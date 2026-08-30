import { Buffer } from "node:buffer";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINS } from "./pins.mjs";
import { exactRecord, fixtureFor, materializedFixture, sha256 } from "./protocol.mjs";

function physical(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename) || path.normalize(filename) !== filename || filename.includes("\0")) throw new Error("Canonical physical path required");
  let current = path.parse(filename).root;
  for (const component of filename.slice(current.length).split("/").filter(Boolean)) {
    current = path.join(current, component);
    const status = lstatSync(current);
    if (status.isSymbolicLink()) throw new Error("Symlink admission refused");
  }
  if (realpathSync(filename) !== filename) throw new Error("Physical path alias refused");
  return filename;
}

export function regularBytes(filename, maximum, expected) {
  physical(filename);
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size > maximum) throw new Error("Regular file size admission");
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.length !== before.size) throw new Error("Read identity changed");
    if (expected && ((before.mode & 0o777) !== expected.mode || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)) throw new Error("File identity mismatch");
    return bytes;
  } finally { closeSync(descriptor); }
}

function manifest(name, expectedHash) {
  const filename = fileURLToPath(new URL(name, import.meta.url));
  const bytes = regularBytes(filename, 1048576);
  if (sha256(bytes) !== expectedHash) throw new Error("Component manifest binding");
  return JSON.parse(bytes.toString("utf8"));
}

function directoriesFor(files) {
  const directories = new Set([""]);
  for (const entry of files) {
    let directory = path.posix.dirname(entry.path);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return [...directories].sort().map(relative => ({ path: relative, mode: 0o755 }));
}

function auditTree(root, files, directoryEntries, retain) {
  physical(root);
  const expectedFiles = new Map(files.map(entry => [entry.path, entry]));
  const expectedDirectories = new Map(directoryEntries.map(entry => [entry.path, entry.mode]));
  const observedFiles = new Set();
  const observedDirectories = new Set();
  let total = 0;
  const walk = relative => {
    const filename = relative ? `${root}/${relative}` : root;
    const status = lstatSync(filename);
    if (status.isSymbolicLink()) throw new Error("Tree symlink refused");
    if (status.isDirectory()) {
      if (!expectedDirectories.has(relative) || (status.mode & 0o777) !== expectedDirectories.get(relative)) throw new Error("Directory membership/mode mismatch");
      observedDirectories.add(relative);
      for (const name of readdirSync(filename).sort()) {
        if (name === "AGENTS.md") throw new Error("AGENTS tree refused");
        walk(relative ? `${relative}/${name}` : name);
      }
      return;
    }
    const expected = expectedFiles.get(relative);
    if (!status.isFile() || !expected) throw new Error("Unexpected tree entry");
    total += status.size;
    if (total > 201326592) throw new Error("Tree byte bound");
    const bytes = regularBytes(filename, 134217728, expected);
    observedFiles.add(relative);
    retain?.(relative, bytes);
  };
  walk("");
  if (observedFiles.size !== expectedFiles.size || observedDirectories.size !== expectedDirectories.size) throw new Error("Tree missing entries");
}

export function admitRequest(argv) {
  if (argv.length !== 4 || argv[0] !== "--request" || argv[2] !== "--sha256" || !/^[0-9a-f]{64}$/.test(argv[3])) throw new Error("Exact worker argv required");
  const caseRoot = physical(process.cwd());
  if ((lstatSync(caseRoot).mode & 0o777) !== 0o700 || argv[1] !== `${caseRoot}/type-api-request.json`) throw new Error("Request route refused");
  const requestBytes = regularBytes(argv[1], 16384);
  if (sha256(requestBytes) !== argv[3] || (lstatSync(argv[1]).mode & 0o777) !== 0o600) throw new Error("Request byte/mode binding");
  const request = exactRecord(JSON.parse(requestBytes.toString("utf8")), ["schema", "fixtureId", "layout", "caseRoot", "subjectRoot", "toolsRoot"]);
  if (request.schema !== "m1b-type-api-request-v2" || request.caseRoot !== caseRoot || !["S", "M"].includes(request.layout)) throw new Error("Request identity");
  fixtureFor(request.fixtureId);
  physical(request.subjectRoot);
  physical(request.toolsRoot);
  const roots = [caseRoot, request.subjectRoot, request.toolsRoot];
  for (const left of roots) for (const right of roots) if (left !== right && (left.startsWith(`${right}/`) || right.startsWith(`${left}/`))) throw new Error("Overlapping role roots");
  if (new Set(roots).size !== 3 || process.env.NODE_OPTIONS !== undefined || process.env.NODE_PATH !== undefined) throw new Error("Ambient/role admission refused");
  if (process.platform !== "darwin" || typeof process.getuid !== "function" || process.getuid() !== 501) throw new Error("Unqualified compiler host profile");
  const environment = {
    PATH: `${request.toolsRoot}/bin`, HOME: caseRoot, TMPDIR: caseRoot,
    TZ: "UTC", LANG: "C", LC_ALL: "C", UV_THREADPOOL_SIZE: "1",
    __CF_USER_TEXT_ENCODING: "0x1F5:0x0:0x0",
  };
  if (Object.keys(process.env).length !== Object.keys(environment).length || Object.entries(environment).some(([name, value]) => process.env[name] !== value)) throw new Error("Exact compiler environment required");
  const tools = manifest("TOOLS.json", PINS.toolsSha256);
  const subject = manifest("SUBJECT.json", PINS.subjectSha256);
  manifest("FIXTURES.json", PINS.fixturesSha256);
  const executable = `${request.toolsRoot}/bin/node`;
  if (process.execPath !== executable || process.version !== "v22.22.2") throw new Error("Copied Node entry required");
  const toolFiles = [...tools.files, tools.node];
  const toolDirectories = directoriesFor(toolFiles);
  for (const directory of tools.directories) {
    const existing = toolDirectories.find(entry => entry.path === directory.path);
    if (existing) existing.mode = directory.mode;
    else toolDirectories.push(directory);
  }
  const subjectDirectories = directoriesFor(subject.files);
  const snapshot = new Map();
  const toolTypes = new Set(tools.files.filter(entry => entry.path.endsWith(".d.ts") || entry.path.endsWith(".json")).map(entry => entry.path));
  let snapshotBytes = 0;
  const retain = (filename, bytes) => {
    snapshotBytes += bytes.length;
    if (snapshotBytes > 67108864) throw new Error("Compiler snapshot byte bound");
    snapshot.set(filename, Buffer.from(bytes));
  };
  let compilerBytes;
  auditTree(request.toolsRoot, toolFiles, toolDirectories, (relative, bytes) => {
    if (relative === "node_modules/typescript/lib/typescript.js") compilerBytes = Buffer.from(bytes);
    if (toolTypes.has(relative)) retain(`${request.toolsRoot}/${relative}`, bytes);
  });
  const readable = new Set(subject.compilerReadable);
  auditTree(request.subjectRoot, subject.files, subjectDirectories, (relative, bytes) => {
    if (readable.has(relative)) retain(`${request.subjectRoot}/${relative}`, bytes);
  });
  if (!compilerBytes || sha256(compilerBytes) !== PINS.compilerSha256) throw new Error("Compiler source binding");
  const fixturePath = `${caseRoot}/${request.fixtureId}.mts`;
  const fixtureBytes = materializedFixture(request.fixtureId, request.subjectRoot);
  const fixtureIdentity = { mode: 0o600, bytes: fixtureBytes.length, sha256: sha256(fixtureBytes) };
  regularBytes(fixturePath, 16384, fixtureIdentity);
  retain(fixturePath, fixtureBytes);
  const initialNames = ["type-api-request.json", `${request.fixtureId}.mts`].sort();
  const checkCaseInputs = () => {
    if (JSON.stringify(readdirSync(caseRoot).sort()) !== JSON.stringify(initialNames)) throw new Error("Unexpected case input membership");
    regularBytes(fixturePath, 16384, fixtureIdentity);
    regularBytes(argv[1], 16384, { mode: 0o600, bytes: requestBytes.length, sha256: argv[3] });
  };
  checkCaseInputs();
  return {
    request, snapshot, compilerBytes, fixturePath, fixtureBytes, compilerPath: `${request.toolsRoot}/node_modules/typescript/lib/typescript.js`,
    guardAfter() {
      auditTree(request.toolsRoot, toolFiles, toolDirectories);
      auditTree(request.subjectRoot, subject.files, subjectDirectories);
      checkCaseInputs();
    },
  };
}

export function publish(caseRoot, name, data) {
  if (!["type-api-raw.json", "type-api-result.json"].includes(name)) throw new Error("Publication route");
  const bytes = Buffer.from(JSON.stringify(data) + "\n");
  if (bytes.length > 524288) throw new Error("Publication capture bound");
  const filename = `${caseRoot}/${name}`;
  const descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const status = fstatSync(descriptor);
    if (!status.isFile() || (status.mode & 0o777) !== 0o600 || status.size !== bytes.length) throw new Error("Publication metadata mismatch");
  }
  finally { closeSync(descriptor); }
  return { path: filename, mode: 0o600, bytes: bytes.length, sha256: sha256(bytes) };
}
