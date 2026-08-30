import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const usage = "node capture-native.mjs --scratch /tmp/safe-bash-column-stress-prep-XXXXXX --native PROFILE=/absolute/native/column [--native PROFILE=/absolute/native/column]";
const args = process.argv.slice(2);
const profiles = [];
let scratch;
for (let index = 0; index < args.length; index += 2) {
  const option = args[index];
  const value = args[index + 1];
  assert.equal(typeof value, "string", usage);
  if (option === "--scratch") {
    assert.equal(scratch, undefined, "Duplicate scratch option");
    scratch = value;
  } else if (option === "--native") {
    const separator = value.indexOf("=");
    assert(separator > 0, usage);
    profiles.push({ name: value.slice(0, separator), executable: value.slice(separator + 1) });
  } else {
    throw new Error(usage);
  }
}
assert(scratch && /^\/(?:private\/)?tmp\/safe-bash-column-stress-prep-[A-Za-z0-9]+$/u.test(scratch), usage);
assert(profiles.length >= 1 && profiles.length <= 2, usage);
assert.equal(new Set(profiles.map((profile) => profile.name)).size, profiles.length);
const directory = fileURLToPath(new URL(".", import.meta.url));
const recipeBytes = await readFile(join(directory, "recipes.json"));
const corpus = JSON.parse(recipeBytes);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const totalVariants = corpus.nativeRecipes.reduce((total, recipe) => total + recipe.variants.length, 0);
assert(totalVariants <= corpus.limits.maxNativeInvocationsPerProfile);
const environment = {
  PATH: "/usr/bin:/bin",
  LC_ALL: "en_US.UTF-8",
  LANG: "en_US.UTF-8",
  COLUMNS: "80",
  TERM: "dumb",
  HOME: join(scratch, "native-home"),
  XDG_CONFIG_HOME: join(scratch, "native-home", "config"),
  NO_COLOR: "1",
};
await mkdir(environment.XDG_CONFIG_HOME, { recursive: true });

async function execute(executable, argv, stdin, cwd, deadlineMs = corpus.limits.nativeDeadlineMs) {
  const child = spawn(executable, argv, { cwd, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  const counts = { stdout: 0, stderr: 0 };
  let termination = null;
  let spawnError = null;
  let stdinError = null;
  function killGroup(reason) {
    termination ??= reason;
    if (!child.pid) return;
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const timer = setTimeout(() => killGroup("deadline"), deadlineMs);
  for (const [name, stream, fragments] of [["stdout", child.stdout, stdout], ["stderr", child.stderr, stderr]]) {
    stream.on("data", (chunk) => {
      const remaining = Math.max(0, corpus.limits.maxNativeOutputBytesPerStream - counts[name]);
      counts[name] += chunk.byteLength;
      fragments.push(Buffer.from(chunk.subarray(0, remaining)));
      if (counts[name] > corpus.limits.maxNativeOutputBytesPerStream) killGroup(`${name}-limit`);
    });
  }
  child.stdin.on("error", (error) => { stdinError = { code: error.code ?? null, message: error.message }; });
  const closed = new Promise((resolve) => {
    child.on("error", (error) => { spawnError = { code: error.code ?? null, message: error.message }; });
    child.on("close", (status, signal) => resolve({ status, signal }));
  });
  child.stdin.end(stdin);
  const result = await closed;
  clearTimeout(timer);
  if (child.pid) {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  return {
    argv, ...result, stdoutHex: Buffer.concat(stdout).toString("hex"), stderrHex: Buffer.concat(stderr).toString("hex"),
    observedBytes: counts, termination, spawnError, stdinError,
    deadlineMs, cleanup: "close-observed-process-group-retired",
  };
}

const nativeProfiles = [];
const observations = [];
for (const profile of profiles) {
  assert(/^[A-Za-z0-9.-]+$/u.test(profile.name));
  assert(isAbsolute(profile.executable));
  const resolvedPath = await realpath(profile.executable);
  const binary = await readFile(resolvedPath);
  const magic = binary.subarray(0, 4).toString("hex");
  assert(["7f454c46", "cffaedfe", "feedfacf", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(magic), "An actual ELF/Mach-O native executable is required, never a product JS wrapper");
  const identity = {
    ...profile, resolvedPath, sha256: hash(binary), bytes: binary.byteLength,
    versionProbe: await execute(resolvedPath, ["--version"], Buffer.alloc(0), scratch),
    shortVersionProbe: await execute(resolvedPath, ["-V"], Buffer.alloc(0), scratch),
    fileIdentity: await execute("/usr/bin/file", [resolvedPath], Buffer.alloc(0), scratch),
    linkedLibraries: await execute("/usr/bin/otool", ["-L", resolvedPath], Buffer.alloc(0), scratch),
  };
  nativeProfiles.push(identity);
  for (const recipe of corpus.nativeRecipes) {
    for (const variant of recipe.variants) {
      const input = Object.hasOwn(variant, "stdinHex") ? Buffer.from(variant.stdinHex, "hex") : Buffer.from(variant.stdinUtf8, "utf8");
      const files = Object.entries(variant.files ?? {});
      assert(input.byteLength + files.reduce((total, [, contents]) => total + Buffer.byteLength(contents), 0) <= corpus.limits.maxInputBytesPerInvocation);
      const cwd = await mkdtemp(join(scratch, `native-${profile.name}-${recipe.id}-`));
      const fileInputs = [];
      try {
        for (const [name, contents] of files) {
          assert(/^[-A-Za-z0-9_.]+$/u.test(name) && name !== "." && name !== "..");
          const bytes = Buffer.from(contents, "utf8");
          await writeFile(join(cwd, name), bytes, { flag: "wx" });
          fileInputs.push({ name, hex: bytes.toString("hex") });
        }
        const startedAt = new Date().toISOString();
        const result = await execute(resolvedPath, variant.argv, input, cwd);
        observations.push({
          profile: profile.name, recipe: recipe.id, variant: variant.name,
          oracleUse: recipe.oracleUse, startedAt, endedAt: new Date().toISOString(),
          cwd, stdinHex: input.toString("hex"), files: fileInputs, ...result,
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  }
  assert.equal(hash(await readFile(resolvedPath)), identity.sha256, "Native binary changed during capture");
}
const output = {
  schemaVersion: 1,
  classification: "raw-native-observations-not-product-results",
  createdAt: new Date().toISOString(),
  recipeSha256: hash(recipeBytes),
  captureScriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  environment,
  limits: corpus.limits,
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  host: {
    uname: await execute("/usr/bin/uname", ["-a"], Buffer.alloc(0), scratch),
    swVers: await execute("/usr/bin/sw_vers", [], Buffer.alloc(0), scratch),
  },
  profiles: nativeProfiles,
  counts: { recipes: corpus.nativeRecipes.length, variantsPerProfile: totalVariants, nativeInvocations: observations.length, identityInvocations: profiles.length * 4 + 2, safetyRecipesPreparedOnly: corpus.safetyRecipes.length, candidateInvocations: 0 },
  observations,
  cleanup: { invocationDirectoriesRemoved: true, ownedNativeProcessesRetired: true, persistentIsolatedHome: environment.HOME },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
