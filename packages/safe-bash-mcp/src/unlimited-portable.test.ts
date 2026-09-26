import { expect, it, vi } from "vitest";
import { remoteLimits } from "./remote.js";
import { commandLimit, positiveArgument, createRemoteMcpCommands } from "./commands.js";
import { compileToolArguments } from "./arguments.js";
import { generateRemoteMcpArtifact, parseRemoteMcpArtifact } from "./artifact.js";
import { initRemoteMcpConfiguration } from "./configuration.js";
import { credentialEnvironmentReader } from "./credential-environment.js";

const tool = { name: "echo", inputSchema: { type: "object" as const, properties: { value: { type: "string" } } } };
const server = { name: "example", url: "https://example.com/mcp", tools: [tool] };

it("defaults resource budgets to unlimited and accepts explicit Infinity", async () => {
  for (const options of [{}, { maxPages: Infinity, maxTools: Infinity, maxResponseBytes: Infinity }])
    expect(remoteLimits(options)).toMatchObject({ maxPages: Infinity, maxTools: Infinity, maxResponseBytes: Infinity });
  expect(commandLimit(Infinity, "maxInputBytes")).toBe(Infinity);
  expect(positiveArgument("Infinity", "--max-input-bytes")).toBe(Infinity);
  expect(() => positiveArgument("Infinity", "--timeout-ms", 2147483647)).toThrow();
  const configuration = initRemoteMcpConfiguration([server], { maxConfigurationBytes: Infinity, maxTools: Infinity });
  const generated = await generateRemoteMcpArtifact(configuration.configuration, { maxArtifactBytes: Infinity });
  expect(await parseRemoteMcpArtifact(generated.json, { maxArtifactBytes: Infinity })).toEqual(generated.artifact);
  await expect(createRemoteMcpCommands([server], { maxInputBytes: Infinity, maxOutputBytes: Infinity })).resolves.toHaveLength(1);
  expect(credentialEnvironmentReader({ env: { TOKEN: "secret" }, maxCredentialBytes: Infinity })({ env: "TOKEN" })).toBe("secret");
});

it("parses inputs larger than the former default without Buffer", async () => {
  vi.stubGlobal("Buffer", undefined);
  try {
    const value = "é".repeat(600_000);
    expect(compileToolArguments(tool).parse(["--value", value])).toEqual({ value });
    const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration);
    expect(await parseRemoteMcpArtifact(generated.json)).toEqual(generated.artifact);
  } finally { vi.unstubAllGlobals(); }
});

it("retains caller ceilings while Web Crypto digest verification is pending", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration);
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { await pending; return original(...args); });
  const options = { maxTools: 0 };
  try {
    const parsed = parseRemoteMcpArtifact(generated.artifact, options);
    options.maxTools = Infinity;
    release();
    await expect(parsed).rejects.toThrow("maxTools");
  } finally { digest.mockRestore(); }
});

it("stops artifact recreation before credential binding when aborted during hashing", async () => {
  const generated = await generateRemoteMcpArtifact(initRemoteMcpConfiguration([server]).configuration);
  const original = crypto.subtle.digest.bind(crypto.subtle);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { await pending; return original(...args); });
  const runtime = await import("./runtime-configuration.js");
  const bind = vi.spyOn(runtime, "bindRemoteMcpConfiguration");
  const controller = new AbortController(), reason = new Error("cancelled during hashing");
  try {
    const { remoteMcpArtifactPlugin } = await import("./artifact.js");
    const recreated = remoteMcpArtifactPlugin(generated.artifact, { binding: { env: {} }, commands: { signal: controller.signal } });
    controller.abort(reason);
    release();
    await expect(recreated).rejects.toBe(reason);
    expect(bind).not.toHaveBeenCalled();
  } finally { digest.mockRestore(); bind.mockRestore(); }
});
