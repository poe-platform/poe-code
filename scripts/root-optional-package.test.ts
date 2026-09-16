import { createFsFromVolume, Volume } from "memfs";
import { expect, it } from "vitest";
import { publishRootOptionalPackage } from "./bundle-safe-bash.mjs";

it("ships an explicit root optional entry with canonical self imports and lazy YAML", async () => {
  const source = 'export { Shell } from "@poe-platform/safe-bash"; export const yaml = () => import("yaml"); const label = "@poe-platform/safe-bash";';
  const volume = Volume.fromJSON({
    "/repo/packages/safe-bash/dist/opt-in/optional.js": source,
    "/repo/packages/safe-bash/dist/opt-in/optional.d.ts": 'export { Shell } from "@poe-platform/safe-bash"; export type F = import("@poe-platform/safe-fs").F;',
    "/repo/packages/safe-bash/dist/opt-in/fs/profile.json": '{"optional":true}',
    "/repo/dist/index.js": "export const core = true;",
  });
  await publishRootOptionalPackage("/repo", createFsFromVolume(volume).promises);
  expect(volume.readFileSync("/repo/dist/safe-bash-opt-in/optional.js", "utf8")).toBe('export { Shell } from "poe-code/safe-bash"; export const yaml = () => import("yaml"); const label = "@poe-platform/safe-bash";');
  expect(volume.readFileSync("/repo/dist/safe-bash-opt-in/optional.d.ts", "utf8")).toBe('export { Shell } from "poe-code/safe-bash"; export type F = import("poe-code/safe-fs").F;');
  expect(volume.readFileSync("/repo/dist/safe-bash-opt-in/fs/profile.json", "utf8")).toBe('{"optional":true}');
  expect(volume.readFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", "utf8")).toBe(source);
  expect(volume.readFileSync("/repo/dist/index.js", "utf8")).toBe("export const core = true;");
});
