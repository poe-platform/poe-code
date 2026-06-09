import { describe, expect, it } from "vitest";
import type { Command } from "toolcraft";
import { commandsFromSpec, inspectOpenApiDocument } from "../index.js";
import { collectGeneratedCommands, type GeneratedParamDefinition } from "../generate.js";
import { createForgeyardSpec, mockFetch } from "../mock.js";

function sampleValue(definition: GeneratedParamDefinition): unknown {
  switch (definition.kind) {
    case "array":
      return [sampleValue(definition.itemDefinition)];
    case "boolean":
      return true;
    case "enum":
      return definition.enumValues[0];
    case "json":
      return { nested: { enabled: true }, values: [1, "two"] };
    case "number":
      return definition.jsonType === "integer" ? 1 : 1.5;
    case "string":
      return "sample";
  }
}

describe("createForgeyardSpec", () => {
  it("builds a massive fully-supported fake API and exercises every route without real network access", async () => {
    const spec = createForgeyardSpec();
    const report = inspectOpenApiDocument(spec);
    const generated = collectGeneratedCommands(spec);
    const runtimeGroups = await commandsFromSpec(spec);
    const mock = await mockFetch({
      spec,
      fixtures: {
        "export compatibility report": {
          headers: { "content-type": "text/plain" },
          body: "forgeyard report"
        },
        "download compatibility archive": {
          headers: { "content-type": "application/octet-stream" },
          body: "forgeyard archive"
        }
      }
    });
    const runtimeCommands = new Map<string, Command<any, any, any, any>>();

    for (const group of runtimeGroups) {
      if (group.kind !== "group") continue;
      for (const command of group.children) {
        if (command.kind === "command")
          runtimeCommands.set(`${group.name} ${command.name}`, command);
      }
    }

    expect(report).toMatchObject({ operationCount: 538, supportedCount: 538, unsupportedCount: 0 });
    expect(generated).toHaveLength(538);
    expect(runtimeCommands.size).toBe(538);
    expect(runtimeCommands.has("compatibility quotes")).toBe(true);
    expect(runtimeCommands.has("compatibility symbols")).toBe(true);
    expect(runtimeCommands.has("compatibility create-jobs")).toBe(true);
    expect(runtimeCommands.has("compatibility update-jobs-settings")).toBe(true);

    const isolatedFetch: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      expect(url.hostname).toBe("api.forgeyard.invalid");
      expect(url.hostname).not.toContain("github");
      return mock.fetch(input, init);
    };

    for (const generatedCommand of generated) {
      const command = runtimeCommands.get(`${generatedCommand.noun} ${generatedCommand.verb}`);
      if (command === undefined)
        throw new Error(
          `Missing runtime command ${generatedCommand.noun} ${generatedCommand.verb}`
        );
      const params = Object.fromEntries(
        generatedCommand.params
          .filter((param) => !param.optional)
          .map((param) => [param.paramName, sampleValue(param.definition)])
      );

      const expected =
        generatedCommand.operationId === "export compatibility report"
          ? "forgeyard report"
          : generatedCommand.operationId === "download compatibility archive"
            ? {
                contentType: "application/octet-stream",
                encoding: "base64",
                byteLength: 17,
                data: "Zm9yZ2V5YXJkIGFyY2hpdmU="
              }
            : { ok: true };
      await expect(
        command.handler({
          params,
          baseUrl: "https://api.forgeyard.invalid",
          tokenSource: { getToken: async () => "forgeyard-token" },
          fetch: isolatedFetch
        })
      ).resolves.toEqual(expected);
    }

    expect(mock.requests).toHaveLength(538);
    expect(new Set(mock.requests.map((request) => request.operationId))).toEqual(
      new Set(generated.map((command) => command.operationId))
    );
    expect(mock.requests.find((request) => request.operationId === "get compatibility representation")?.headers).toMatchObject({
      accept: "application/json",
      "x-forgeyard-tenant": "sample"
    });
    expect(mock.requests.find((request) => request.operationId === "POST /v1/compatibility/jobs")?.body).toEqual({
      configuration: { nested: { enabled: true }, values: [1, "two"] }
    });
    expect(mock.requests.find((request) => request.operationId === "create compatibility token")?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded"
    });
    expect(mock.requests.find((request) => request.operationId === "create compatibility token")?.body).toEqual({
      username: "sample"
    });
    expect(mock.requests.find((request) => request.operationId === "import compatibility manifest")?.headers).toMatchObject({
      "content-type": "text/xml"
    });
    expect(mock.requests.find((request) => request.operationId === "import compatibility manifest")?.body).toBe("sample");
    expect(mock.requests.find((request) => request.operationId === "upload compatibility bundle")?.headers).toMatchObject({
      "content-type": "application/zip"
    });
    expect(mock.requests.find((request) => request.operationId === "upload compatibility attachment")?.headers["content-type"]).toContain("multipart/form-data; boundary=");
    expect(mock.requests.find((request) => request.operationId === "create explicit authorization compatibility")?.headers).toMatchObject({ authorization: "sample" });
    expect(mock.requests.find((request) => request.operationId === "search compatibility with body")?.body).toEqual({ query: "sample" });
  });
});
