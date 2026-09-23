import { expect, it, vi } from "vitest";
import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { CommandRegistry } from "@poe-platform/safe-bash/contracts";
import { createRemoteMcpManagementCommand } from "./management.js";
import { accessRemoteMcpResources } from "./resources.js";
import { authenticateRemoteMcpServer } from "./authentication.js";
import { importRemoteMcpAuthentication } from "./credential-import.js";
import { resetRemoteMcpAuthentication } from "./credential-reset.js";
import { generateRemoteMcpArtifact } from "./artifact.js";

vi.mock("./resources.js", async original => ({ ...await original<object>(), accessRemoteMcpResources: vi.fn(async () => ({})) }));
vi.mock("./authentication.js", () => ({ authenticateRemoteMcpServer: vi.fn(async () => ({ name: "catalog", url: "https://catalog.example/mcp" })) }));
vi.mock("./credential-import.js", () => ({ importRemoteMcpAuthentication: vi.fn(async () => ({ name: "catalog", imported: true })) }));
vi.mock("./credential-reset.js", () => ({ resetRemoteMcpAuthentication: vi.fn(async () => ({ name: "catalog", reset: true })) }));
vi.mock("./artifact.js", () => ({ generateRemoteMcpArtifact: vi.fn(async () => ({ json: "{}" })) }));

it.each([" ", "="])("retains all management host ceilings with %j CLI values", async separator => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.json", new TextEncoder().encode("{}"));
  const shell = new Shell({ fs, commands: new CommandRegistry([createRemoteMcpManagementCommand([
    { name: "catalog", url: "https://catalog.example/mcp", tools: [] }
  ], {
    resources: { maxInputBytes: 200, requestTimeoutMs: 100, maxResponseBytes: 300 },
    authentication: { requestTimeoutMs: 100, maxResponseBytes: 300 },
    credentialImport: { requestTimeoutMs: 100, timeoutMs: 200, maxImportBytes: 300 },
    reset: { timeoutMs: 100 },
    generation: { maxTools: 5, maxConfigurationBytes: 1000, maxArtifactBytes: 2000,
      schema: { requestTimeoutMs: 100, maxPages: 2, maxTools: 3, maxResponseBytes: 300 } }
  })]) });
  const flag = (name: string) => `${name}${separator}10000`;
  try {
    expect((await shell.exec(`mcp resource catalog ${flag("--timeout-ms")} ${flag("--max-response-bytes")} ${flag("--max-input-bytes")}`)).exitCode).toBe(0);
    expect(accessRemoteMcpResources).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ requestTimeoutMs: 100, maxResponseBytes: 300, maxInputBytes: 200 }));
    expect((await shell.exec(`mcp auth catalog ${flag("--timeout-ms")} ${flag("--max-response-bytes")}`)).exitCode).toBe(0);
    expect(authenticateRemoteMcpServer).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ requestTimeoutMs: 100, maxResponseBytes: 300 }));
    const deadline = vi.spyOn(AbortSignal, "timeout");
    try {
      expect((await shell.exec(`mcp import catalog --file /input.json ${flag("--timeout-ms")} ${flag("--lock-timeout-ms")} ${flag("--max-import-bytes")}`)).exitCode).toBe(0);
      expect(deadline).toHaveBeenCalledWith(100);
      expect(importRemoteMcpAuthentication).toHaveBeenLastCalledWith(expect.anything(), "{}", expect.objectContaining({ requestTimeoutMs: 100, timeoutMs: 200, maxImportBytes: 300 }));
    } finally { deadline.mockRestore(); }
    expect((await shell.exec(`mcp reset catalog ${flag("--timeout-ms")}`)).exitCode).toBe(0);
    expect(resetRemoteMcpAuthentication).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ timeoutMs: 100 }));
    expect((await shell.exec(`mcp generate ${["--timeout-ms", "--max-pages", "--max-tools", "--max-response-bytes", "--max-configuration-bytes", "--max-artifact-bytes"].map(flag).join(" ")}`)).exitCode).toBe(0);
    expect(generateRemoteMcpArtifact).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ maxTools: 5, maxConfigurationBytes: 1000, maxArtifactBytes: 2000,
      schema: expect.objectContaining({ requestTimeoutMs: 100, maxPages: 2, maxTools: 3, maxResponseBytes: 300 }) }));
  } finally { await shell.dispose(); }
});
