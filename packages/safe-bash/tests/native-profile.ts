import { release } from "node:os";

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
