import { release } from "node:os";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface NativeExecutablePin {
  readonly tool: string;
  readonly version: string;
  readonly size: number;
  readonly sha256: string;
  readonly versionProbe?: Readonly<{ status: number; stdout: string; stderr: string }>;
}

export interface NativeGnuOptions {
  readonly platform?: string;
  readonly arch?: string;
  readonly release?: string;
  readonly build?: 1 | 2;
  readonly path?: string;
  readonly profiles?: readonly unknown[];
  readonly localProfile?: string | undefined;
  readonly fileSystem?: typeof fs;
  readonly run?: (executable: string, args: readonly string[], options: unknown) => {
    status: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    error?: Error;
  };
}

const nativeProvisioner: {
  selectNativeProfile(profiles: readonly unknown[], host: { platform: string; arch: string; distribution: string; version: string; release?: string }, localProfile?: string): { executables: NativeExecutablePin[]; apple?: (NativeExecutablePin & { path: string })[] };
  verifyNativeExecutable(pin: NativeExecutablePin, path: string, dependencies?: NativeGnuOptions): Omit<NativeExecutablePin, "tool"> & { path: string; bytes: Uint8Array };
} = await import(new URL("../scripts/provision-test-native-oracles.mjs", import.meta.url).href);

export const verifyNativeExecutable = nativeProvisioner.verifyNativeExecutable;

function executableProfile(options: NativeGnuOptions, localRecovery = false, localProfile?: string) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  let host;
  if (localProfile !== undefined) {
    host = { platform, arch, distribution: "macos", version: "26.4.1", release: options.release ?? release() };
  } else if (platform === "darwin") {
    const kernel = options.release ?? release();
    assert.equal(arch, "arm64", "Darwin native caller requires arm64");
    if (kernel === "25.4.0" && !localRecovery) return undefined;
    assert(kernel === "25.5.0" || (localRecovery && kernel === "25.4.0"), "Darwin native caller requires a qualified kernel");
    host = { platform, arch, distribution: "macos", version: kernel === "25.4.0" ? "26.4.1" : "26.5.2", release: kernel };
  } else {
    assert.equal(platform, "linux", "GNU native caller requires a qualified host profile");
    const fields = (options.fileSystem ?? fs).readFileSync("/etc/os-release", "utf8").split("\n");
    assert.deepEqual(fields.filter(field => field.startsWith("ID=")), ["ID=ubuntu"], "GNU native caller requires Ubuntu");
    assert.deepEqual(fields.filter(field => field.startsWith("VERSION_ID=")), ['VERSION_ID="24.04"'], "GNU native caller requires Ubuntu 24.04");
    host = { platform, arch, distribution: "ubuntu", version: "24.04" };
  }
  const manifest: { schema: number; profiles: readonly unknown[]; localGnuQualification?: unknown } = options.profiles === undefined
    ? JSON.parse(fs.readFileSync(new URL("./native-gnu-profiles.json", import.meta.url), "utf8"))
    : { schema: 1, profiles: options.profiles };
  assert.equal(manifest.schema, 1);
  const profiles = localProfile !== undefined && options.profiles === undefined ? [manifest.localGnuQualification] : manifest.profiles;
  return nativeProvisioner.selectNativeProfile(profiles, host, localProfile);
}

export function nativeGnuBinding(tool: "tar" | "diff" | "patch" | "expr" | "stat" | "touch" | "chmod" | "mktemp" | "nl" | "seq" | "unexpand" | "paste" | "comm" | "join" | "split" | "bash", options: NativeGnuOptions = {}): (NativeExecutablePin & { path: string }) | undefined {
  const localProfile = tool === "diff" || tool === "patch"
    ? options.localProfile ?? (options.platform === undefined ? process.env.SAFE_BASH_LOCAL_GNU_PROFILE : undefined)
    : undefined;
  const localRecovery = tool === "bash" || ((tool === "diff" || tool === "patch") && options.path === fileURLToPath(new URL(`../tmp/native-local-diff-patch/bin/${tool}`, import.meta.url)));
  if (tool === "bash" && (options.platform ?? process.platform) === "darwin" && (options.release ?? release()) === "25.4.0") assert(options.path === undefined || options.path === fileURLToPath(new URL("../tmp/native-gnu/bin/bash", import.meta.url)), "local Bash recovery requires its stable staged path");
  const profile = executableProfile(options, localRecovery, localProfile);
  if (!profile) return undefined;
  assert(options.build === undefined || options.build === 1 || (options.build === 2 && tool === "stat" && (options.platform ?? process.platform) === "darwin"), "only Darwin stat has a qualified independent second build");
  const pin = profile.executables.find(entry => entry.tool === tool);
  assert(pin, `qualified GNU profile does not provide ${tool}`);
  const localPath = localProfile !== undefined && (tool === "diff" || tool === "patch") && options.platform === undefined
    ? process.env[`DIFF_PATCH_NATIVE_${tool.toUpperCase()}`] : undefined;
  const path = options.path ?? localPath ?? fileURLToPath(new URL(`../tmp/native-gnu${options.build === 2 ? "-second" : ""}/bin/${tool}`, import.meta.url));
  assert(isAbsolute(path) && resolve(path) === path, "GNU native executable must be a nonempty absolute executable path, normalized; no fallback is permitted");
  if (localProfile !== undefined && (tool === "diff" || tool === "patch")) {
    assert.equal((options.fileSystem ?? fs).realpathSync(path), path, "GNU native executable must be a canonical absolute executable path; no fallback is permitted");
  }
  return { ...pin, path };
}

export function nativeAppleBinding(tool: "diff" | "patch" | "bsdtar" | "split", options: NativeGnuOptions = {}): (NativeExecutablePin & { path: string }) | undefined {
  assert.equal(options.platform ?? process.platform, "darwin", "Apple native caller requires Darwin");
  const profile = executableProfile(options);
  if (!profile) return undefined;
  const pin = profile.apple?.find(entry => entry.tool === tool);
  assert(pin, `qualified Apple profile does not provide ${tool}`);
  const path = options.path ?? pin.path;
  assert(isAbsolute(path) && resolve(path) === path, "Apple native executable must be a nonempty absolute executable path, normalized; no fallback is permitted");
  return { ...pin, path };
}

export interface NativeHost {
  readonly platform: string;
  readonly arch: string;
  readonly release: string;
}

export interface NativeProfile {
  readonly id: string;
  readonly evidence: string;
  readonly host: Readonly<{ platform: string; arch?: string; release?: string }>;
}

export interface UnavailableNativeProfile {
  readonly status: "UNAVAILABLE";
  readonly profileId: string;
  readonly evidence: string;
  readonly expected: NativeProfile["host"];
  readonly actual: NativeHost;
  readonly mismatches: readonly (keyof NativeHost)[];
  readonly reason: string;
}

function dataRecord(value: unknown, keys: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("profile fields must be plain records");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value as PropertyDescriptor;
    if (typeof key !== "string" || !keys.includes(key) || !("value" in descriptor)) throw new TypeError("profile fields must be recognized own data properties");
    snapshot[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(snapshot, key)) throw new TypeError(`missing profile field: ${key}`);
  return snapshot;
}

function nonempty(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) throw new TypeError("profile fields must be nonempty strings");
  return value;
}

export function currentNativeHost(): NativeHost {
  return Object.freeze({ platform: process.platform, arch: process.arch, release: release() });
}

export function matchNativeProfile(profile: NativeProfile, actual: NativeHost): UnavailableNativeProfile | Readonly<{ status: "MATCHING"; profileId: string }> {
  const snapshot = dataRecord(profile, ["id", "evidence", "host"], ["id", "evidence", "host"]);
  const profileId = nonempty(snapshot.id);
  const evidence = nonempty(snapshot.evidence);
  const dimensions = ["platform", "arch", "release"] as const;
  const expectedFields = dataRecord(snapshot.host, dimensions, ["platform"]);
  const actualFields = dataRecord(actual, dimensions, dimensions);
  const expected = Object.freeze({
    platform: nonempty(expectedFields.platform),
    ...(Object.hasOwn(expectedFields, "arch") ? { arch: nonempty(expectedFields.arch) } : {}),
    ...(Object.hasOwn(expectedFields, "release") ? { release: nonempty(expectedFields.release) } : {}),
  });
  const observed = Object.freeze({
    platform: nonempty(actualFields.platform),
    arch: nonempty(actualFields.arch),
    release: nonempty(actualFields.release),
  });
  const mismatches = dimensions.filter(dimension => Object.hasOwn(expected, dimension) && expected[dimension] !== observed[dimension]);
  if (mismatches.length === 0) return Object.freeze({ status: "MATCHING", profileId });
  return Object.freeze({
    status: "UNAVAILABLE",
    profileId,
    evidence,
    expected,
    actual: observed,
    mismatches: Object.freeze(mismatches),
    reason: `UNAVAILABLE ${profileId}: ${mismatches.map(dimension => `${dimension}=${observed[dimension]} (requires ${expected[dimension]})`).join(", ")}; evidence=${evidence}`,
  });
}

export async function qualifyNativeProfile<Identity extends object>(profile: NativeProfile, actual: NativeHost, admit: () => Promise<Identity> | Identity): Promise<UnavailableNativeProfile | Readonly<{ status: "ADMITTED"; profileId: string; identity: Identity }>> {
  if (typeof admit !== "function") throw new TypeError("strict admission callback required");
  const match = matchNativeProfile(profile, actual);
  if (match.status === "UNAVAILABLE") return match;
  const identity = await admit();
  if (typeof identity !== "object" || identity === null) throw new TypeError("strict admission must return an identity");
  return Object.freeze({ status: "ADMITTED", profileId: match.profileId, identity });
}
