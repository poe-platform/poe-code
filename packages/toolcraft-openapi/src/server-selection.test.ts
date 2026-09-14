import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSDK } from "toolcraft/sdk";
import { createMCPServer } from "toolcraft/mcp";
import { runCLI } from "toolcraft/cli";
import { commandsFromSpec, defineClientFromSpec, generate, inspectOpenApiDocument, type OpenApiDocument } from "./index.js";

const rootUrl = "https://root.example.test/v1";
const pathUrl = "https://path.example.test/v2";
const operationUrl = "https://operation.example.test/v3";
const overrideUrl = "https://override.example.test/v4";
const previousExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = previousExitCode; });

interface ServerScenario {
  name: string;
  pathServers?: Array<{ url: string }>;
  operationServers?: Array<{ url: string }>;
  baseUrl?: string;
  expected: string;
  generatedBaseUrl?: string;
}

const scenarios: ServerScenario[] = [
  { name: "root fallback", expected: rootUrl },
  { name: "path override", pathServers: [{ url: pathUrl }], expected: pathUrl, generatedBaseUrl: pathUrl },
  { name: "operation override", operationServers: [{ url: operationUrl }], expected: operationUrl, generatedBaseUrl: operationUrl },
  { name: "operation above path", pathServers: [{ url: pathUrl }], operationServers: [{ url: operationUrl }], expected: operationUrl, generatedBaseUrl: operationUrl },
  { name: "path above client fallback", pathServers: [{ url: pathUrl }], baseUrl: overrideUrl, expected: pathUrl, generatedBaseUrl: pathUrl },
  { name: "operation above client fallback", operationServers: [{ url: operationUrl }], baseUrl: overrideUrl, expected: operationUrl, generatedBaseUrl: operationUrl },
  { name: "explicit client fallback", baseUrl: overrideUrl, expected: overrideUrl }
];

function documentFor(scenario: ServerScenario, method: "get" | "post" = "get"): OpenApiDocument {
  const pathItem = {
    ...(scenario.pathServers === undefined ? {} : { servers: scenario.pathServers }),
    [method]: {
      operationId: method === "get" ? "listItems" : "createItem",
      tags: ["items"],
      ...(scenario.operationServers === undefined ? {} : { servers: scenario.operationServers }),
      responses: { "200": { description: "Items", content: { "application/json": { schema: { type: "object" } } } } }
    }
  };
  return {
    openapi: "3.0.3", info: { title: "Fixture", version: "1" },
    servers: [{ url: rootUrl }], paths: { "/items": pathItem }
  };
}

describe.each(["get", "post"] as const)("OpenAPI %s server selection", (method) => {
  describe.each(["sdk", "mcp", "cli"] as const)("%s", (surface) => {
    it.each(scenarios)("uses $name", async (scenario) => {
      const document = documentFor(scenario, method);
      const original = structuredClone(document);
      const client = await defineClientFromSpec(document, {
        name: "audit", auth: { commands: [], getToken: async () => "" },
        ...(scenario.baseUrl === undefined ? {} : { baseUrl: scenario.baseUrl })
      });
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response("{}", {
        headers: { "content-type": "application/json" }
      }));
      const verb = method === "get" ? "list" : "create-item";

      if (surface === "sdk") {
        const sdk = createSDK(client.root, { services: client.services, fetch, approvals: false }) as {
          items: Record<string, () => Promise<unknown>>;
        };
        await expect(sdk.items[method === "get" ? "list" : "createItem"]!()).resolves.toEqual({});
      } else if (surface === "mcp") {
        const session = createMCPServer(client.root, {
          name: "audit", version: "1", services: client.services, fetch, errorReports: false
        }).createMessageSession(() => {});
        try {
          await session.handleMessage("initialize", {
            protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" }
          });
          await session.handleMessage("notifications/initialized");
          const result = await session.handleMessage("tools/call", { name: `audit__items__${verb.replaceAll("-", "_")}`, arguments: {} });
          expect(result.error).toBeUndefined();
          expect(result.result).not.toHaveProperty("isError", true);
        } finally {
          await session.close();
        }
      } else {
        await runCLI(client.root, {
          argv: ["node", "audit", "items", verb, "--yes"], controls: { yes: true },
          services: client.services, fetch, approvals: false, errorReports: false, outputEmitter: () => {}
        });
        expect(process.exitCode).toBe(0);
      }

      expect(fetch).toHaveBeenCalledOnce();
      const [input, init] = fetch.mock.calls[0]!;
      const request = new Request(input, init);
      expect(request).toHaveProperty("url", `${scenario.expected}/items`);
      expect(request).toHaveProperty("method", method.toUpperCase());
      expect(document).toEqual(original);
    });
  });

  it.each(scenarios)("emits the same effective override for $name", (scenario) => {
    const document = documentFor(scenario, method);
    const original = structuredClone(document);
    const report = inspectOpenApiDocument(document);
    const files = generate(document, { specSha: "fixture" });
    const command = files.find((file) => file.path === `items/${method === "get" ? "list" : "create-item"}.ts`);

    expect(report.supportedCount).toBe(1);
    expect(command).toBeDefined();
    if (scenario.generatedBaseUrl === undefined) expect(command!.contents).toContain("      baseUrl,");
    else expect(command!.contents).toContain(`      baseUrl: ${JSON.stringify(scenario.generatedBaseUrl)},`);
    expect(document).toEqual(original);
  });
});

describe("inherited server compatibility", () => {
  describe.each([
    { name: "empty list", servers: [] },
    { name: "multiple servers", servers: [{ url: pathUrl }, { url: operationUrl }] },
    { name: "relative URL", servers: [{ url: "/v2" }] },
    { name: "templated URL", servers: [{ url: "https://path.example.test/{version}" }] },
    { name: "invalid URL", servers: [{ url: "not a URL" }] }
  ])("$name", ({ servers }) => {
    it("reports unsupported inherited servers instead of silently using the root", async () => {
      const document = documentFor({ name: "invalid", pathServers: servers, expected: rootUrl });
      const original = structuredClone(document);
      const report = inspectOpenApiDocument(document);

      expect(report.supportedCount).toBe(0);
      expect(report.unsupportedCount).toBe(1);
      expect(report.operations[0]?.reason).toContain('Operation "listItems"');
      expect(() => generate(document, { specSha: "fixture" })).toThrow('Operation "listItems"');
      await expect(commandsFromSpec(document)).rejects.toThrow('Operation "listItems"');
      expect(document).toEqual(original);
    });

    it("allows an operation override to replace an unsupported path server", async () => {
      const document = documentFor({ name: "overridden", pathServers: servers, operationServers: [{ url: operationUrl }], expected: operationUrl });

      expect(inspectOpenApiDocument(document).supportedCount).toBe(1);
      expect(generate(document, { specSha: "fixture" }).find((file) => file.path === "items/list.ts")?.contents)
        .toContain(`      baseUrl: ${JSON.stringify(operationUrl)},`);
      await expect(commandsFromSpec(document)).resolves.toHaveLength(1);
    });
  });

  it("does not reinterpret an explicit empty operation server array as inheritance", async () => {
    const document = documentFor({ name: "empty operation", pathServers: [{ url: pathUrl }], operationServers: [], expected: rootUrl });

    expect(inspectOpenApiDocument(document).unsupportedCount).toBe(1);
    await expect(commandsFromSpec(document)).rejects.toThrow("exactly one fixed per-operation server URL");
  });
});
