import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.each(["workerd", "browser"])("bundles the %s MCP entry without desktop dependencies", async condition => {
  const result = await build({
    entryPoints: ["packages/safe-bash-command-mcp/src/index.browser.ts"], bundle: true,
    platform: "neutral", mainFields: ["module", "main"], format: "esm", conditions: [condition], write: false, metafile: true,
    external: ["node:*", "safe-bash-contracts"],
    alias: { "tiny-mcp-client": "./packages/tiny-mcp-client/src/index.browser.ts", "mcp-oauth": "./packages/mcp-oauth/src/index.browser.ts", "node:child_process": "./packages/tiny-mcp-client/src/spawn.browser.ts", "tiny-stdio-mcp-server/protocol": "./packages/tiny-stdio-mcp-server/src/protocol.ts", "tiny-stdio-mcp-server/headers": "./packages/tiny-stdio-mcp-server/src/headers.ts", "toolcraft-schema": "./packages/toolcraft-schema/src/index.ts" }
  });
  expect(result.outputFiles[0].text).toContain("beginRemoteMcpAuthorization");
  expect(result.outputFiles[0].text).toContain("completeRemoteMcpAuthorization");
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  expect(imports.filter(path => path.startsWith("node:") && path !== "node:stream")).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).some(path => path.includes("auth-store/") || path.includes("loopback-authorization"))).toBe(false);
});

it.each(["workerd", "browser"])("resolves portable runtime entries with %s", condition => {
  for (const name of ["safe-bash-command-mcp/remote", "tiny-mcp-client", "mcp-oauth"]) {
    const target = execFileSync(process.execPath, ["--conditions=" + condition, "--input-type=module", "-e",
      `console.log(import.meta.resolve(${JSON.stringify(name)}))`], { encoding: "utf8" }).trim();
    expect(target.endsWith("/dist/index.browser.js")).toBe(true);
  }
});
