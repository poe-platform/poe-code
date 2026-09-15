import { describe, expect, it, vi } from "vitest";
import { UserError } from "toolcraft";
import { inspectOpenApiSource } from "./inspect-source.js";
import { parseOpenApiDocument } from "./spec-source.js";

const invalidDocuments = [
  { name: "unclosed flow", source: "[invalid", reason: "Flow sequence must end with a ]", line: 1, column: 9 },
  { name: "indentation", source: "openapi: 3.0.3\ninfo:\n  title: Test\n    bad: nope\n", reason: "Nested mappings are not allowed in compact mappings", line: 3, column: 10 },
  { name: "duplicate key", source: "openapi: 3.0.3\ninfo: {}\ninfo: {}\n", reason: "Map keys must be unique", line: 3, column: 1 },
  { name: "missing colon", source: "openapi: 3.0.3\ninfo:\n  title: Test\n  version 1.0\n", reason: "Implicit map keys need to be followed by map values", line: 4, column: 3 },
  { name: "tab indentation", source: "openapi: 3.0.3\n\tinfo: {}\n", reason: "Tabs are not allowed as indentation", line: 2, column: 1 },
  { name: "multiple documents", source: "openapi: 3.0.3\n---\nopenapi: 3.1.0\n", reason: "Source contains multiple documents; please use YAML.parseAllDocuments()", line: 2, column: 1 }
];

describe.each(["parse", "inspect"] as const)("OpenAPI %s diagnostic presentation", (surface) => {
  describe.each(["\n", "\r\n"])("line separator %j", (separator) => {
    it.each(invalidDocuments)("renders one location and excerpt for $name", async ({ source, reason, line, column }) => {
      const input = "https://api.example.test/openapi.yaml";
      const text = source.replaceAll("\n", separator);
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(text));
      const operation = Promise.resolve().then(() => surface === "parse"
        ? parseOpenApiDocument(text, input)
        : inspectOpenApiSource(input, { fetch }));
      const error: unknown = await operation.catch((failure: unknown) => failure);

      expect(error).toBeInstanceOf(UserError);
      if (!(error instanceof Error)) throw new Error("Expected parse failure");
      const lines = error.message.split("\n");
      expect(lines[0]).toBe(`Failed to parse OpenAPI document "${input}": ${reason} (at line ${line} column ${column})`);
      expect(lines[1]).toBe(`--> ${input}:${line}:${column}`);
      expect(lines.filter((entry) => entry.includes("^"))).toHaveLength(1);
      expect(lines.filter((entry) => entry.includes("at line "))).toHaveLength(1);
      expect(lines).toContain(`${line} | ${source.split("\n")[line - 1]}`);
      if (surface === "inspect") expect(fetch).toHaveBeenCalledExactlyOnceWith(input);
      else expect(fetch).not.toHaveBeenCalled();
    });
  });

  it("keeps positionless conversion failures readable without inventing a snippet", async () => {
    const source = "openapi: 3.0.3\ninfo: *missing\n";
    const input = "https://api.example.test/openapi.yaml";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(source));
    const operation = Promise.resolve().then(() => surface === "parse"
      ? parseOpenApiDocument(source, input)
      : inspectOpenApiSource(input, { fetch }));

    await expect(operation).rejects.toThrow(`Failed to parse OpenAPI document "${input}": Unresolved alias (the anchor must be set before the alias): missing`);
    await expect(operation).rejects.not.toThrow("-->");
  });

  it.each(["null", "[]", "plain text"])("retains object-shape diagnostics for %s", async (source) => {
    const input = "https://api.example.test/openapi.yaml";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(source));
    const operation = Promise.resolve().then(() => surface === "parse"
      ? parseOpenApiDocument(source, input)
      : inspectOpenApiSource(input, { fetch }));

    await expect(operation).rejects.toThrow(`OpenAPI document "${input}" must parse to an object.`);
    await expect(operation).rejects.not.toThrow("-->");
  });

  it.each([
    JSON.stringify({ openapi: "3.0.3", info: { title: "Test", version: "1" }, paths: {} }),
    "openapi: 3.0.3\ninfo:\n  title: Test\n  version: '1'\npaths: {}\n"
  ])("retains valid document parsing for %s", async (source) => {
    const input = "https://api.example.test/openapi.yaml";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(source));

    if (surface === "parse") {
      expect(parseOpenApiDocument(source, input)).toMatchObject({ openapi: "3.0.3", info: { title: "Test" } });
    } else {
      await expect(inspectOpenApiSource(input, { fetch })).resolves.toBeDefined();
      expect(fetch).toHaveBeenCalledExactlyOnceWith(input);
    }
  });
});
