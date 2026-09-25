import { beforeEach, expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";

const fixture = vi.hoisted(() => ({ fs: undefined as unknown as ReturnType<typeof createFsFromVolume> }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const replacement = { ...actual };
  for (const name of ["readFileSync", "readdirSync", "lstatSync", "realpathSync", "existsSync"] as const) {
    replacement[name] = ((...args: unknown[]) => {
      const fs = String(args[0]).startsWith("/fixture") ? fixture.fs : actual;
      return (fs[name] as (...args: unknown[]) => unknown)(...args);
    }) as never;
  }
  return replacement;
});
import { assertBuiltConsumerResolution, createBuiltPackageBinding } from "../packages/safe-bash/scripts/typecheck-consumers.mjs";

beforeEach(() => {
  fixture.fs = createFsFromVolume(Volume.fromJSON({
    "/fixture/consumer/node_modules/@poe-platform/safe-bash/package.json": JSON.stringify({
      name: "@poe-platform/safe-bash", exports: { ".": { types: "./dist/index.d.ts" } }
    }),
    "/fixture/consumer/node_modules/@poe-platform/safe-bash/dist/index.d.ts": "export {};",
    "/fixture/consumer/node_modules/@poe-platform/safe-bash/dist/helper/index.d.ts": "export {};",
    "/fixture/workspace/helper/index.d.ts": "export {};"
  }));
});

it("rejects private helper declarations resolved from the workspace instead of the artifact", () => {
  const root = "/fixture/consumer/node_modules/@poe-platform/safe-bash";
  const binding = { ...createBuiltPackageBinding(root), privateAliases: ["safe-bash-command-helper"] };
  const trace = `======== Module name '@poe-platform/safe-bash' was successfully resolved to '${root}/dist/index.d.ts'\n` +
    "======== Module name 'safe-bash-command-helper' was successfully resolved to '/fixture/workspace/helper/index.d.ts'\n";
  expect(() => assertBuiltConsumerResolution(trace, "/fixture/consumer", root, binding)).toThrow("foreign candidate declaration/source fallback");
});

it("accepts private helper declarations authenticated inside the artifact", () => {
  const root = "/fixture/consumer/node_modules/@poe-platform/safe-bash";
  const binding = { ...createBuiltPackageBinding(root), privateAliases: ["safe-bash-command-helper"] };
  const trace = `======== Module name 'safe-bash-command-helper' was successfully resolved to '${root}/dist/helper/index.d.ts'\n`;
  expect(() => assertBuiltConsumerResolution(trace, "/fixture/consumer", root, binding)).not.toThrow();
});
