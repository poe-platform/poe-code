import { describe, expect, it, vi } from "vitest";
import { inspectOpenApiSource } from "./inspect-source.js";

describe("OpenAPI source diagnostic redaction", () => {
  it.each([304, 404, 500])("redacts query credentials in source status %s errors", async (status) => {
    const source = "https://api.example.test/spec?api_key=source-query-secret&page=2";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(
      status === 304 ? null : JSON.stringify({ message: "failed" }),
      { status, headers: { "content-type": "application/json" } }
    ));
    const operation = inspectOpenApiSource(source, { fetch });

    await expect(operation).rejects.toThrow("api_key=****&page=2");
    await expect(operation).rejects.not.toThrow("source-query-secret");
    expect(fetch).toHaveBeenCalledWith(source);
  });

  it.each(["null", "[invalid"])("redacts URL objects in parse failures for %s", async (body) => {
    const source = new URL("https://api.example.test/spec?access_token=source-query-secret&page=2");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body));
    const operation = inspectOpenApiSource(source, { fetch });

    await expect(operation).rejects.toThrow("access_token=****&page=2");
    await expect(operation).rejects.not.toThrow("source-query-secret");
    expect(source.searchParams.get("access_token")).toBe("source-query-secret");
    expect(fetch).toHaveBeenCalledWith(source.toString());
  });

  it("redacts source labels when wrapping an unclassified fetch failure", async () => {
    const source = "https://api.example.test/spec?token=source-query-secret";
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
    const operation = inspectOpenApiSource(source, { fetch });

    await expect(operation).rejects.toThrow('Failed to read OpenAPI document "https://api.example.test/spec?token=****": offline');
    await expect(operation).rejects.not.toThrow("source-query-secret");
  });

  it.each(["application/json", "application/problem+json"])(
    "redacts structured %s error snippets before truncating them",
    async (contentType) => {
      const secret = "long-secret".repeat(100);
      const body = {
        password: secret,
        nested: [{ access_token: "nested-source-secret" }],
        message: "visible-error-context"
      };
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body), {
        status: 400,
        headers: { "content-type": contentType }
      }));
      const operation = inspectOpenApiSource("https://api.example.test/spec", { fetch });

      await expect(operation).rejects.toThrow('"password":"<redacted>"');
      await expect(operation).rejects.toThrow('"access_token":"<redacted>"');
      await expect(operation).rejects.toThrow("visible-error-context");
      await expect(operation).rejects.not.toThrow("long-secret");
      await expect(operation).rejects.not.toThrow("nested-source-secret");
      expect(body.password).toBe(secret);
    }
  );
});
