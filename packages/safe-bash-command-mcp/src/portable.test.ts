import { execFileSync } from "node:child_process";
import ts from "typescript";
import { build } from "esbuild";
import { expect, it } from "vitest";

it.each(["workerd", "browser"])("bundles the %s MCP entry without desktop dependencies", async condition => {
  const result = await build({
    entryPoints: ["packages/safe-bash-command-mcp/src/index.browser.ts"], bundle: true,
    platform: "neutral", mainFields: ["module", "main"], format: "esm", conditions: [condition], write: false, metafile: true,
    external: ["node:*"],
    alias: { "tiny-mcp-client": "./packages/tiny-mcp-client/src/index.browser.ts", "mcp-oauth": "./packages/mcp-oauth/src/index.browser.ts", "tiny-stdio-mcp-server/protocol": "./packages/tiny-stdio-mcp-server/src/protocol.ts", "tiny-stdio-mcp-server/headers": "./packages/tiny-stdio-mcp-server/src/headers.ts", "toolcraft-schema": "./packages/toolcraft-schema/src/index.ts" }
  });
  const bundled = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const redirectUris = ["https://deployment.workers.dev/callback", "https://poe.example/callback"];
  let requestBody: unknown;
  const registration = await bundled.registerOAuthClient({
    registrationEndpoint: "https://issuer.example/register", redirectUris,
    fetch: async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return Response.json({ client_id: "synthetic", redirect_uris: redirectUris });
    }
  });
  expect(requestBody).toMatchObject({ redirect_uris: redirectUris });
  expect(registration.redirect_uris).toEqual(redirectUris);
  const source = ts.createSourceFile("bundle.js", result.outputFiles[0].text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const globals: string[] = [];
  function inspect(node: ts.Node): void {
    if (ts.isIdentifier(node) && ["Buffer", "process"].includes(node.text)) globals.push(node.text);
    ts.forEachChild(node, inspect);
  }
  inspect(source);
  expect(globals).toEqual([]);
  expect(result.outputFiles[0].text).toContain("beginRemoteMcpAuthorization");
  expect(result.outputFiles[0].text).toContain("completeRemoteMcpAuthorization");
  const imports = Object.values(result.metafile!.outputs).flatMap(output => output.imports.map(item => item.path));
  expect(imports.filter(path => path.startsWith("node:"))).toEqual([]);
  expect(Object.keys(result.metafile!.inputs).some(path => path.includes("auth-store/") || path.includes("loopback-authorization"))).toBe(false);
});

it.each(["workerd", "browser"])("resolves portable runtime entries with %s", condition => {
  for (const name of ["safe-bash-command-mcp", "safe-bash-command-mcp/remote", "tiny-mcp-client", "mcp-oauth"]) {
    const target = execFileSync(process.execPath, ["--conditions=" + condition, "--input-type=module", "-e",
      `console.log(import.meta.resolve(${JSON.stringify(name)}))`], { encoding: "utf8" }).trim();
    expect(target.endsWith("/dist/index.browser.js")).toBe(true);
  }
});

it("exports the standard management factories in the portable entry", async () => {
  const source = await import("./index.browser.js");
  expect("mcpCommands" in source).toBe(true);
  expect("createMcpCommand" in source).toBe(true);
  expect("createMcpCommands" in source).toBe(true);
});
