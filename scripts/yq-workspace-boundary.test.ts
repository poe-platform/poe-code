import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";
import { build as bundle } from "esbuild";
import { runInNewContext } from "node:vm";
import path from "node:path";

it("owns both yq profiles in an admitted private workspace without a Safe Bash return edge", () => {
  const command = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-yq/package.json", import.meta.url), "utf8"));
  const parent = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
  expect(command.name).toBe("safe-bash-command-yq");
  expect(command.private).toBe(true);
  expect(command.exports["./mike"]).toEqual({ types: "./dist/mike.d.ts", import: "./dist/mike.js" });
  expect(command.peerDependencies).toEqual({ yaml: "2.9.0" });
  expect(command.peerDependenciesMeta.yaml.optional).toBe(true);
  expect(command.dependencies).toEqual({});
  expect(command.devDependencies).not.toHaveProperty("@poe-platform/safe-bash");
  expect(parent.poeCode.integration.privateWorkspaces[command.name]).toMatchObject({ version: command.version, dependencies: {} });
});

it("builds explicitly admitted optional peers and rejects peer profile drift", () => {
  const pkg = JSON.parse(readFileSync(new URL("../packages/safe-bash-command-yq/package.json", import.meta.url), "utf8"));
  const parent = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
  const profiles = parent.poeCode.integration.privateWorkspaces;
  const workspaces = [{ dir: pkg.name, pkg }];
  const build = resolvePrivateCommandBuild("/repo", profiles, workspaces, { alias: {}, external: [], portable: true });
  expect(build).toBeDefined();
  expect(build!.entryPoints).toHaveProperty("safe-bash-command-yq/dist/index");
  expect(build!.entryPoints).not.toHaveProperty("safe-bash-command-yq/dist/mike");
  pkg.peerDependencies.yaml = "unadmitted";
  expect(() => resolvePrivateCommandBuild("/repo", profiles, workspaces, { alias: {}, external: [], portable: true })).toThrow("profile mismatch");
});

it("executes the restricted private runtime without a host Buffer global", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const parent = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));
  const profiles = parent.poeCode.integration.privateWorkspaces;
  const workspaces = ["safe-bash-command-yq", "safe-bash-query-engine", "safe-bash-regex-engine"].map(dir => {
    profiles[dir].portable = true;
    return { dir, pkg: JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8")) };
  });
  const options = resolvePrivateCommandBuild(root, profiles, workspaces, { alias: {}, external: [], portable: true });
  const result = await bundle({ ...options, entryPoints: undefined, stdin: { contents: 'export { createYqCommand } from "./packages/safe-bash-command-yq/src/index.ts";', resolveDir: root }, external: [], platform: "browser", conditions: ["browser"], format: "cjs", splitting: false, sourcemap: false, write: false });
  const realm = { module: { exports: {} as { createYqCommand: () => { execute(context: unknown): Promise<{ exitCode: number }> } } }, Uint8Array, TextEncoder, TextDecoder, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, performance };
  runInNewContext(result.outputFiles[0]!.text, realm);
  const chunks: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const outcome = await realm.module.exports.createYqCommand().execute({
    command: "yq", args: ["-o", "json", "-c", ".value + 0.1"], cwd: "/", env: {}, fs: {}, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode("value: 2\n"); } },
    stdout: { async write(chunk: Uint8Array) { chunks.push(new Uint8Array(chunk)); } },
    stderr: { async write(chunk: Uint8Array) { errors.push(new Uint8Array(chunk)); } },
  });
  expect(outcome.exitCode).toBe(0);
  expect(chunks.map(chunk => new TextDecoder().decode(chunk)).join("")).toBe("2.1\n");
  expect(errors).toEqual([]);
});
