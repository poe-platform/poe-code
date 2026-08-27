import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { nativeCases, type NativeCase } from "./native-cases.js";

export const directory = dirname(new URL(import.meta.url).pathname);
export const digest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const nativeEnvironment = (bin: string) => ({ PATH: `${bin}:/usr/bin:/bin`, LC_ALL: "C", LANG: "C", TZ: "UTC" });

export interface Observation { readonly code: number; readonly stdoutBase64: string; readonly stderrBase64: string }
export interface NativeProfile {
  readonly profile: string;
  readonly platform: string;
  readonly architecture: string;
  readonly corpusSha256: string;
  readonly environment: Record<string, string>;
  readonly identities: Record<string, { path: string; sha256: string; version: Observation }>;
  readonly observations: readonly { id: string; result: Observation }[];
  readonly cleanup: { childrenReaped: true; temporaryRemoved: true; timeouts: number; temporary: string };
}

export function invokeNative(executable: string, args: readonly string[], cwd: string, stdin: string, env: Record<string, string>): Observation {
  const result = spawnSync(executable, args, {
    cwd, input: Buffer.from(stdin), env, timeout: 3000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `native child signalled: ${executable}`);
  assert.notEqual(result.status, null, `native child did not exit: ${executable}`);
  return { code: result.status!, stdoutBase64: result.stdout.toString("base64"), stderrBase64: result.stderr.toString("base64") };
}

export async function nativeFixture(root: string, fixture: NativeCase) {
  const cwd = join(root, fixture.id);
  await mkdir(cwd);
  for (const [name, content] of Object.entries(fixture.files)) await writeFile(join(cwd, name), content);
  return cwd;
}

export async function captureProfile(profile: string, bin: string): Promise<NativeProfile> {
  const environment = nativeEnvironment(bin);
  const identities: NativeProfile["identities"] = {};
  for (const name of ["grep", "egrep", "fgrep"]) {
    const path = resolve(bin, name);
    identities[name] = { path, sha256: digest(await readFile(path)), version: invokeNative(path, ["--version"], directory, "", environment) };
  }
  const version = Buffer.from(identities.grep!.version.stdoutBase64, "base64").toString();
  assert.match(version, profile === "bsd" ? /BSD grep/ : /GNU grep/);
  const temporary = await mkdtemp(join(directory, ".native-"));
  const observations: { id: string; result: Observation }[] = [];
  try {
    for (const fixture of nativeCases) observations.push({
      id: fixture.id,
      result: invokeNative(identities[fixture.alias]!.path, fixture.args, await nativeFixture(temporary, fixture), fixture.stdin, environment),
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return {
    profile, platform: process.platform, architecture: process.arch,
    corpusSha256: digest(await readFile(new URL("./native-cases.ts", import.meta.url))),
    environment, identities, observations,
    cleanup: { childrenReaped: true, temporaryRemoved: true, timeouts: 0, temporary },
  };
}
