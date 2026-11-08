import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const historicalSealCommit = "eb602376d11f9d19cd22864027fe51f564944381";
export const driverMigrationCommit = "4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9";
export const nativeCaptureSha256 = "0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3";
export const currentDriverBindings = [
  {
    path: "tests/shell-stress/differential.test.ts",
    historicalSha256: "985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118",
    currentSha256: "59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32",
  },
  {
    path: "tests/shell-stress/current-gaps/compatibility.test.ts",
    historicalSha256: "93f4d8dd5938ddba1464b126e5aec00c5304eacbd7470768e550301837dc4fa6",
    currentSha256: "ddf404839fae525ae5ebc6d4241c09be307b4ab9359c099d7f7dac67e2c975ca",
  },
] as const;

export const currentHelperBindings = [
  {
    path: "tests/shell-stress/helpers.ts",
    historicalSha256: "fac158c5440cca46fc6b35ab8e9598ce8b37b9cfaa0f19033c182e4a8ebe1ac6",
    currentSha256: "2ab3a309502a5666973f192927de5c59ac0ce11dd95709ea85b476a597e1415c",
  },
] as const;

export function validateSourceBindings(root: string, sources: Readonly<Record<string, string>>, binding: "historical" | "current"): void {
  for (const driver of currentDriverBindings) {
    assert.equal(sources[driver.path], driver.historicalSha256, `Historical driver crosswalk changed: ${driver.path}`);
  }
  for (const helper of currentHelperBindings) {
    assert.equal(sources[helper.path], helper.historicalSha256, `Historical helper crosswalk changed: ${helper.path}`);
  }
  for (const [path, historical] of Object.entries(sources)) {
    if (!path.startsWith("tests/")) continue;
    const driver = [...currentDriverBindings, ...currentHelperBindings].find(candidate => candidate.path === path);
    const expected = binding === "current" && driver ? driver.currentSha256 : historical;
    const actual = createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
    assert.equal(actual, expected, `${binding === "historical" ? "Frozen historical fixture/helper" : "Current fixture/helper binding"} changed: ${path}`);
  }
}
