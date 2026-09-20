import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const registry = "https://registry.npmjs.org";
const repository = "https://github.com/poe-platform/poe-code";
const provenanceType = "https://slsa.dev/provenance/v1";
const packageNames = ["safe-fs", "safe-js", "safe-bash"].map(name => `@poe-platform/${name}`);

function registryUrl(value) {
  const url = new URL(value);
  if (url.origin !== registry || url.username || url.password || url.hash) throw new Error("Invalid public registry URL");
  return value;
}

export async function readRegistry(url, { maxBytes, signal = undefined, onChunk = undefined }, fetch = globalThis.fetch) {
  registryUrl(url);
  const requestSignal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  requestSignal.throwIfAborted();
  const response = await fetch(url, { redirect: "error", signal: requestSignal, headers: { "cache-control": "no-cache" } });
  try {
    if (response.status !== 200) throw new Error(`${url}: HTTP ${response.status}`);
    if (!response.body) throw new Error(`${url}: missing response body`);
    const length = response.headers.get("content-length");
    if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > maxBytes)) {
      throw new Error(`${url}: response exceeds ${maxBytes} bytes or has invalid length`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      requestSignal.throwIfAborted();
      size += chunk.byteLength;
      if (size > maxBytes) throw new Error(`${url}: response exceeds ${maxBytes} bytes`);
      if (onChunk) onChunk(chunk);
      else chunks.push(chunk);
    }
    requestSignal.throwIfAborted();
    return onChunk ? size : Buffer.concat(chunks);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

export function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, maxBuffer: 1_048_576, killSignal: "SIGKILL" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function metadataIdentity(metadata, name, version) {
  if (metadata.name !== name || metadata.version !== version || metadata.repository?.url !== `git+${repository}.git` || metadata.repository?.directory !== `packages/${name.split("/")[1]}`) {
    throw new Error(`${name}@${version}: incorrect metadata identity`);
  }
  const integrity = metadata.dist?.integrity;
  const encoded = typeof integrity === "string" && integrity.startsWith("sha512-") ? integrity.slice(7) : "";
  const digest = Buffer.from(encoded, "base64");
  if (digest.length !== 64 || digest.toString("base64") !== encoded) throw new Error(`${name}: invalid sha512 integrity`);
  return {
    name, version, integrity,
    tarball: registryUrl(metadata.dist.tarball),
    attestations: registryUrl(metadata.dist.attestations?.url)
  };
}

function verifySource(attestations, identity, source) {
  const envelope = attestations.attestations?.find(attestation => attestation.predicateType === provenanceType)?.bundle?.dsseEnvelope;
  if (envelope?.payloadType !== "application/vnd.in-toto+json" || typeof envelope.payload !== "string") throw new Error(`${identity.name}: missing provenance`);
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  const definition = statement.predicate?.buildDefinition;
  const workflow = definition?.externalParameters?.workflow;
  const subject = statement.subject;
  const digest = Buffer.from(identity.integrity.slice(7), "base64").toString("hex");
  if (statement.predicateType !== provenanceType ||
      subject?.length !== 1 || subject[0].name !== `pkg:npm/${identity.name.replace("@", "%40")}@${identity.version}` || subject[0].digest?.sha512 !== digest ||
      workflow?.repository !== repository || workflow.path !== ".github/workflows/release-safe.yml" || workflow.ref !== "refs/heads/main" ||
      !definition.resolvedDependencies?.some(dependency => dependency.uri === `git+${repository}@refs/heads/main` && dependency.digest?.gitCommit === source)) {
    throw new Error(`${identity.name}@${identity.version}: provenance does not match archive and source ${source}`);
  }
}

async function readInstalledJson(files, filename) {
  const stat = await files.stat(filename);
  if (!stat.isFile() || stat.size > 8_388_608) throw new Error(`${filename}: invalid installed identity file`);
  return JSON.parse(await files.readFile(filename, "utf8"));
}

export async function verifyCloudflareArtifacts(files, root) {
  const manifest = await readInstalledJson(files, path.join(root, "package.json"));
  const entry = manifest.exports?.["./playwright/cloudflare"];
  const provider = "@cloudflare/playwright";
  const providerVersion = manifest.peerDependencies?.[provider];
  if (!entry?.import || !entry?.types || !providerVersion ||
      manifest.peerDependenciesMeta?.[provider]?.optional !== true || manifest.dependencies?.[provider]) {
    throw new Error("Missing optional Cloudflare adapter export or provider contract");
  }
  async function text(relative) {
    if (typeof relative !== "string") throw new Error("Invalid Cloudflare asset path");
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(`${root}${path.sep}`)) throw new Error("Cloudflare asset escapes installed package");
    const stat = await files.lstat(filename);
    if (!stat.isFile() || stat.size > 8_388_608) throw new Error(`${filename}: invalid Cloudflare asset`);
    return files.readFile(filename, "utf8");
  }
  const directory = path.dirname(entry.import);
  const assets = [
    [entry.import, "createCloudflarePlaywrightAdapter"],
    [entry.types, "createCloudflarePlaywrightAdapter"],
    [path.join(directory, "browser-run-code-guest.generated.js"), "cloudflare:workers"],
    [path.join(directory, "browser-run-code-guest.generated.js"), "browser-user-code.js"],
    [path.join(directory, "browser-codegen.generated.js"), `${provider}@${providerVersion}`],
    ["third-party/safe-playwright-cloudflare/third-party/playwright/LICENSE", "Apache License"],
    ["third-party/safe-playwright-cloudflare/third-party/playwright/NOTICE", "Microsoft Corporation"],
  ];
  for (const [filename, marker] of assets) {
    if (!(await text(filename)).includes(marker)) throw new Error(`${filename}: missing Cloudflare asset contract ${marker}`);
  }
}

async function verifyInstalled(files, consumer, identities) {
  const lock = await readInstalledJson(files, path.join(consumer, "package-lock.json"));
  for (const identity of identities) {
    const packagePath = path.join(consumer, "node_modules", identity.name);
    const entry = lock.packages?.[`node_modules/${identity.name}`];
    const manifest = await readInstalledJson(files, path.join(packagePath, "package.json"));
    if (lock.packages?.[""]?.dependencies?.[identity.name] !== identity.version ||
        entry?.version !== identity.version || entry.resolved !== identity.tarball || entry.integrity !== identity.integrity || entry.link ||
        manifest.name !== identity.name || manifest.version !== identity.version ||
        await files.realpath(packagePath) !== packagePath) {
      throw new Error(`${identity.name}: installed identity differs from verified public archive`);
    }
  }
}

const importSmoke = `
import assert from "node:assert/strict";
import * as safeFs from "@poe-platform/safe-fs";
import * as safeJs from "@poe-platform/safe-js";
import * as safeBash from "@poe-platform/safe-bash";
import * as nodeBash from "@poe-platform/safe-bash/node";
import { createMetadataCommands } from "@poe-platform/safe-bash/commands/metadata";
assert.equal(typeof safeFs.createMemoryFileSystem, "function");
assert.equal(typeof safeJs.run, "function");
assert.equal(typeof safeBash.Shell, "function");
assert.equal(safeBash.Shell, nodeBash.Shell);
assert.equal(safeFs.FsError, safeBash.FsError);
assert.ok(createMetadataCommands().length > 0);
`;

export async function verifyPublication({ version, source, workDir, cloudflare = false, maxAttempts = 180, retryDelayMs = 10_000, timeoutMs = 2_400_000 }, {
  files = fs, fetch = globalThis.fetch, run = runCommand, sleep = delay, log = console.log
} = {}) {
  const versionParts = typeof version === "string" ? version.split(".") : [];
  if (versionParts.length !== 3 || versionParts.some(part => !Number.isSafeInteger(Number(part)) || Number(part) < 0 || String(Number(part)) !== part)) throw new Error("An exact stable version is required");
  if (typeof source !== "string" || source.length !== 40 || [...source].some(character => !"0123456789abcdef".includes(character))) throw new Error("An exact source commit is required");
  for (const [label, value, maximum] of [["maxAttempts", maxAttempts, 180], ["retryDelayMs", retryDelayMs, 10_000], ["timeoutMs", timeoutMs, 2_400_000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid bounded ${label}`);
  }
  const root = path.resolve(workDir);
  await files.mkdir(root, { recursive: true });
  const signal = AbortSignal.timeout(timeoutMs);
  const identities = new Map();
  let lastFailure;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let directory;
    try {
      signal.throwIfAborted();
      log(`Verifying ${version} from ${source}, attempt ${attempt}/${maxAttempts}`);
      for (const name of packageNames) {
        const metadata = JSON.parse((await readRegistry(`${registry}/${encodeURIComponent(name)}/${version}`, { maxBytes: 1_048_576, signal }, fetch)).toString("utf8"));
        const identity = metadataIdentity(metadata, name, version);
        if (identities.has(name) && JSON.stringify(identities.get(name)) !== JSON.stringify(identity)) throw new Error(`${name}: public archive identity changed during propagation`);
        identities.set(name, identity);
        const hash = createHash("sha512");
        const bytes = await readRegistry(identity.tarball, { maxBytes: 67_108_864, signal, onChunk: chunk => hash.update(chunk) }, fetch);
        if (`sha512-${hash.digest("base64")}` !== identity.integrity) throw new Error(`${name}: downloaded archive integrity mismatch`);
        const attestations = JSON.parse((await readRegistry(identity.attestations, { maxBytes: 4_194_304, signal }, fetch)).toString("utf8"));
        verifySource(attestations, identity, source);
        log(`Downloaded ${name}@${version}: ${bytes} bytes, ${identity.integrity}, source ${source}`);
      }
      signal.throwIfAborted();
      directory = await files.mkdtemp(path.join(root, "attempt-"));
      const consumer = path.join(directory, "consumer");
      const home = path.join(directory, "home");
      await files.mkdir(consumer);
      await files.mkdir(home);
      const userconfig = path.join(directory, "user.npmrc");
      const globalconfig = path.join(directory, "global.npmrc");
      await files.writeFile(userconfig, "");
      await files.writeFile(globalconfig, "");
      await files.writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "safe-publication-consumer", version: "0.0.0", private: true, type: "module" }));
      const env = { PATH: process.env.PATH, HOME: home, npm_config_userconfig: userconfig, npm_config_globalconfig: globalconfig };
      const args = ["install", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", "--package-lock=true",
        "--prefer-online", "--prefer-offline=false", "--offline=false", "--fetch-retries=0", "--fetch-timeout=30000",
        `--registry=${registry}`, `--cache=${path.join(directory, "cache")}`, ...packageNames.map(name => `${name}@${version}`)];
      log(`Fresh public resolution: npm ${args.join(" ")}`);
      await run("npm", args, { cwd: consumer, env, signal, timeout: 120_000 });
      await verifyInstalled(files, consumer, identities.values());
      if (cloudflare) await verifyCloudflareArtifacts(files, path.join(consumer, "node_modules", "@poe-platform/safe-bash"));
      await run(process.execPath, ["--input-type=module", "--eval", importSmoke], { cwd: consumer, env, signal, timeout: 30_000 });
      if (cloudflare) await run(process.execPath, ["--input-type=module", "--eval", `
import assert from "node:assert/strict";
import { encodeBrowserProfile, parseBrowserProfile, restoreBrowserProfile, checkpointBrowserProfile } from "@poe-platform/safe-bash/playwright";
const profile = { state: { cookies: [], origins: [] }, tabs: ["about:blank"], selected: 0 };
const limits = { maxBytes: 4096, maxTabs: 2 };
assert.deepEqual(parseBrowserProfile(encodeBrowserProfile(profile, limits), limits), profile);
assert.equal(typeof restoreBrowserProfile, "function");
assert.equal(typeof checkpointBrowserProfile, "function");
`], { cwd: consumer, env, signal, timeout: 30_000 });
      signal.throwIfAborted();
      log(`Verified ${version} from ${source}: public archives, integrity, provenance source, fresh npm install and Node imports`);
      return;
    } catch (error) {
      lastFailure = String(error.message ?? error).slice(0, 2_048);
      log(`Attempt ${attempt} failed: ${lastFailure}`);
    } finally {
      if (directory) await files.rm(directory, { recursive: true, force: true });
    }
    if (attempt === maxAttempts || signal.aborted) break;
    try { await sleep(retryDelayMs, undefined, { signal }); }
    catch (error) { lastFailure = `${lastFailure}; ${error.message}`; break; }
  }
  throw new Error(`Public verification failed for ${version} from ${source}: ${lastFailure}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: {
      version: { type: "string" }, source: { type: "string" }, "work-dir": { type: "string" },
      cloudflare: { type: "boolean", default: false },
      attempts: { type: "string", default: "180" }, "timeout-ms": { type: "string", default: "2400000" }
    } });
    await verifyPublication({ version: values.version, source: values.source, cloudflare: values.cloudflare, workDir: values["work-dir"] ?? "out/safe-publication",
      maxAttempts: Number(values.attempts), timeoutMs: Number(values["timeout-ms"]) });
  } catch (error) {
    console.error(String(error.message ?? error).slice(0, 4_096));
    process.exitCode = 1;
  }
}
