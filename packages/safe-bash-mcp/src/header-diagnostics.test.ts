import { expect, it, vi } from "vitest";
import type { HttpTransportFetch } from "tiny-mcp-client";
import { accessRemoteMcpResources, createRemoteMcpCommands, fetchRemoteMcpSchema, resolveRemoteMcpSchemas } from "./index.js";

it.each(["schema", "registry", "commands", "resources"] as const)("withholds malformed private header values from %s SDK diagnostics", async route => {
  const failures: unknown[] = [];
  for (const value of ["private-api-key\nsecond", "private-api-key\0second"]) {
    const fetch = vi.fn<HttpTransportFetch>();
    const server = { name: "catalog", url: "https://catalog.example/mcp", headers: { "X-API-Key": value }, tools: [] };
    let failure: unknown;
    try {
      if (route === "schema") await fetchRemoteMcpSchema(server, { fetch });
      else if (route === "registry") await resolveRemoteMcpSchemas([server], { fetch });
      else if (route === "commands") await createRemoteMcpCommands([server], { fetch });
      else await accessRemoteMcpResources(server, { operation: "read", uri: "catalog://005930" }, { fetch });
    } catch (error) { failure = error; }
    failures.push(failure);
    expect(fetch).not.toHaveBeenCalled();
  }
  for (const failure of failures) {
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ message: "Invalid HTTP transport headers" });
    expect(String(failure)).not.toContain("private-api-key");
  }
});
