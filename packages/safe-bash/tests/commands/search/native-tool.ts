import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentNativeHost, matchNativeProfile, type NativeHost } from "../../native-profile.js";

export interface RgProfile {
  readonly id: string;
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly executable: Readonly<{ size: number; sha256: string; mode: string }>;
  readonly qualification: Readonly<{ status: string; expectedVersionPrefix: string }>;
}

interface VersionOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly encoding: "utf8";
  readonly shell: false;
  readonly timeout: number;
  readonly killSignal: "SIGKILL";
  readonly maxBuffer: number;
}

interface AdmissionDependencies {
  readonly fileSystem: typeof fs;
  readonly host: () => NativeHost;
  readonly profiles: () => readonly RgProfile[];
  readonly scratchRoot?: () => string;
  readonly version: (path: string, options: VersionOptions) => {
    readonly status: number | null;
    readonly signal: string | null;
    readonly stdout: string;
    readonly error?: unknown;
  };
}

export interface RgIdentity {
  readonly status: "BINDING_ADMITTED_NOT_BEHAVIORALLY_QUALIFIED";
  readonly profileId: string;
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly mode: "0755";
  readonly observedVersion: string;
  readonly qualificationStatus: string;
}

function fingerprint(stat: fs.BigIntStats): string {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs ?? stat.mtimeMs, stat.ctimeNs ?? stat.ctimeMs].join(":");
}

function boundedRegularBytes(fileSystem: typeof fs, path: string, size: number): Buffer {
  assert(isAbsolute(path) && resolve(path) === path && !path.includes("\0"), "required rg path must be canonical and absolute");
  const before = fileSystem.lstatSync(path, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink(), "required rg input must be a regular file");
  assert.equal(fileSystem.realpathSync(path), path, "required rg input must not traverse symlinks");
  assert.equal(before.size, BigInt(size), "required rg input size mismatch");
  const descriptor = fileSystem.openSync(path, fileSystem.constants.O_RDONLY | fileSystem.constants.O_NOFOLLOW);
  try {
    assert.equal(fingerprint(fileSystem.fstatSync(descriptor, { bigint: true })), fingerprint(before), "required rg input changed during open");
    const bytes = Buffer.alloc(size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fileSystem.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    assert.equal(length, size, "required rg input changed during read");
    assert.equal(fingerprint(fileSystem.fstatSync(descriptor, { bigint: true })), fingerprint(before));
    assert.equal(fingerprint(fileSystem.lstatSync(path, { bigint: true })), fingerprint(before));
    return bytes.subarray(0, size);
  } finally { fileSystem.closeSync(descriptor); }
}

export function loadRgProfiles(): readonly RgProfile[] {
  return ["./native-tool-profile.json", "./native-tool-profile.darwin-arm64.json", "./native-tool-profile.darwin-arm64-codex-0.151.0.json"].map(name => {
    const path = fileURLToPath(new URL(name, import.meta.url));
    const size = Number(fs.lstatSync(path).size);
    assert(Number.isSafeInteger(size) && size > 0 && size <= 16384, "rg metadata exceeds bound");
    return JSON.parse(boundedRegularBytes(fs, path, size).toString("utf8")) as RgProfile;
  });
}

export function nativeRgEnvironment(root: string, path: string): NodeJS.ProcessEnv {
  assert(isAbsolute(root) && isAbsolute(path) && !root.includes("\0") && !path.includes("\0"));
  assert(!path.includes(":") && basename(path) === "rg", "rg PATH binding must have a literal rg basename and no PATH delimiter");
  return {
    PATH: `${dirname(path)}:/usr/bin:/bin`, HOME: root, TMPDIR: root,
    LC_ALL: "C", LANG: "C", TZ: "UTC", RIPGREP_CONFIG_PATH: "", NO_COLOR: "1",
    SAFE_BASH_TEST_RG: path,
  };
}

export function createRgAdmitter(dependencies: AdmissionDependencies): (path: string | undefined) => RgIdentity {
  let cached: { key: string; identity: RgIdentity } | undefined;
  return path => {
    const host = dependencies.host();
    const candidates = dependencies.profiles().filter(profile => profile.platform === host.platform && profile.arch === host.arch);
    assert(candidates.length > 0, `required rg profile missing for ${host.platform}/${host.arch}; generic comparisons cannot be skipped`);
    const profiles = candidates.map(selected => {
      assert(!Object.hasOwn(selected, "release") && !Object.hasOwn(selected, "host"), "new rg host constraints require explicit review");
      const profile = {
        id: selected.id, version: selected.version, platform: selected.platform, arch: selected.arch,
        size: selected.executable.size, sha256: selected.executable.sha256, mode: selected.executable.mode,
        qualificationStatus: selected.qualification.status, versionPrefix: selected.qualification.expectedVersionPrefix,
      };
      for (const value of [profile.id, profile.version, profile.qualificationStatus, profile.versionPrefix]) assert(typeof value === "string" && value.length > 0 && !value.includes("\0"));
      assert.equal(profile.version, "15.2.0");
      assert.equal(profile.versionPrefix, "ripgrep 15.2.0");
      assert.equal(profile.mode, "0755");
      assert(Number.isSafeInteger(profile.size) && profile.size > 0 && profile.size <= 16 * 1024 * 1024);
      assert.match(profile.sha256, /^[a-f0-9]{64}$/u);
      const matching = matchNativeProfile({ id: profile.id, evidence: "explicit authenticated test-only rg binding metadata", host: { platform: profile.platform, arch: profile.arch } }, host);
      assert.equal(matching.status, "MATCHING", "required generic rg host does not match; no unavailability waiver");
      return profile;
    });
    assert(typeof path === "string" && path.length > 0 && isAbsolute(path) && resolve(path) === path && !path.includes("\0"), "SAFE_BASH_TEST_RG must name a nonempty canonical absolute executable; no PATH fallback");
    const fileSystem = dependencies.fileSystem;
    assert(!path.includes(":") && basename(path) === "rg", "required rg path must preserve the literal rg basename without PATH delimiters");
    const directory = dirname(path);
    assert.equal(fileSystem.realpathSync(directory), directory, "rg PATH directory must be canonical");
    const directoryStat = fileSystem.lstatSync(directory, { bigint: true });
    assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink());
    assert.equal(directoryStat.mode & 0o022n, 0n, "rg PATH directory must not be group/world writable");
    assert.deepEqual(fileSystem.readdirSync(directory), ["rg"], "rg PATH directory may contain only the admitted rg executable");
    const before = fileSystem.lstatSync(path, { bigint: true });
    assert(before.isFile() && !before.isSymbolicLink());
    assert.equal(fileSystem.realpathSync(path), path);
    assert.equal(before.mode & 0o7777n, 0o755n, "required rg executable mode mismatch");
    const sized = profiles.filter(profile => before.size === BigInt(profile.size));
    assert(sized.length > 0, "required rg executable size mismatch");
    const bytes = boundedRegularBytes(fileSystem, path, sized[0]!.size);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const matchingProfiles = sized.filter(profile => profile.sha256 === sha256);
    assert(matchingProfiles.length > 0, "required rg executable SHA-256 mismatch");
    assert.equal(matchingProfiles.length, 1, "required rg executable profile identity is ambiguous");
    const profile = matchingProfiles[0]!;
    const key = JSON.stringify([profile, path, fingerprint(before)]);
    if (cached?.key === key) return cached.identity;
    const scratch = dependencies.scratchRoot?.() ?? directory;
    const result = dependencies.version(path, {
      cwd: scratch, env: nativeRgEnvironment(scratch, path), encoding: "utf8", shell: false,
      timeout: 3000, killSignal: "SIGKILL", maxBuffer: 65536,
    });
    const { error, signal, status, stdout } = result;
    assert(error === undefined || error === null, "required rg version subprocess failed");
    assert.equal(signal, null, "required rg version subprocess signalled");
    assert.equal(status, 0, "required rg version subprocess failed");
    assert(typeof stdout === "string" && Buffer.byteLength(stdout) <= 65536);
    const observedVersion = stdout.split("\n")[0]!;
    assert(observedVersion === profile.versionPrefix || observedVersion.startsWith(profile.versionPrefix + " "), "required rg version mismatch");
    assert.equal(fingerprint(fileSystem.lstatSync(path, { bigint: true })), fingerprint(before), "required rg changed during version admission");
    const identity: RgIdentity = Object.freeze({
      status: "BINDING_ADMITTED_NOT_BEHAVIORALLY_QUALIFIED", profileId: profile.id, path,
      sha256: profile.sha256, size: profile.size, mode: "0755", observedVersion,
      qualificationStatus: profile.qualificationStatus,
    });
    cached = { key, identity };
    return identity;
  };
}

const admit = createRgAdmitter({
  fileSystem: fs, host: currentNativeHost, profiles: loadRgProfiles,
  scratchRoot: () => fs.realpathSync(tmpdir()),
  version: (path, options) => spawnSync(path, ["--no-config", "--version"], options),
});

export function requireNativeRg(): RgIdentity {
  return admit(process.env.SAFE_BASH_TEST_RG);
}
