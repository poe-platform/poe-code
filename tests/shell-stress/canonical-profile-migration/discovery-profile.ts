import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { discoveryFixCases } from "../../shell/invocation-discovery-fixes-cases.js";

interface NativeRow {
  name: string;
  mode: "bash" | "sh";
  cwd: string;
  source: string;
  result: { stdoutHex: string; stderrHex: string; status: number };
}

interface NativeProfile {
  name: "GNU-5.3" | "historical-3.2";
  executableHash: string;
  observations: NativeRow[];
}

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bytes = readFileSync(new URL("../../shell/invocation-discovery-fixes-native.json", import.meta.url));
assert.equal(digest(bytes), "2ce958e4ac0b73a306bc61efbf0eb40f85902c1c2ea4ffbcd08f7928ec62e2bc");
const reference = JSON.parse(bytes.toString()) as { casesSha256: string; profiles: NativeProfile[] };
assert.equal(reference.casesSha256, digest(readFileSync(new URL("../../shell/invocation-discovery-fixes-cases.ts", import.meta.url))));
assert.deepEqual(reference.profiles.map(profile => profile.name), ["GNU-5.3", "historical-3.2"]);
assert.deepEqual(reference.profiles.map(profile => profile.executableHash), [
  "8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c",
  "35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3",
]);
for (const profile of reference.profiles) {
  assert.deepEqual(profile.observations.map(({ name, mode, source }) => ({ name, mode, source })),
    ["bash", "sh"].flatMap(mode => discoveryFixCases.map(({ name, source }) => ({ name, mode, source }))));
}

export function discoveryProfile(name: NativeProfile["name"]): NativeProfile {
  const profile = reference.profiles.find(candidate => candidate.name === name);
  assert.ok(profile);
  return structuredClone(profile);
}
