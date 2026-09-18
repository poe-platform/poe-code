import { createHash } from "node:crypto";
import { join } from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { readRegistry, runCommand, verifyPublication } from "./verify-safe-publication.mjs";

const version = "0.1.669";
const source = "e63cc14f91e17ffdfb004edd8e72d504a7e91353";
const registry = "https://registry.npmjs.org";
const repository = "https://github.com/poe-platform/poe-code";
const archive = Buffer.from("the exact published archive");
const digest = createHash("sha512").update(archive).digest();
const integrity = `sha512-${digest.toString("base64")}`;
const names = ["safe-fs", "safe-js", "safe-bash"].map(name => `@poe-platform/${name}`);

function fixture() {
  const files = createFsFromVolume(new Volume()).promises;
  const metadata = names.map(name => ({
    name, version,
    repository: { type: "git", url: `git+${repository}.git`, directory: `packages/${name.split("/")[1]}` },
    dist: {
      tarball: `${registry}/${name}/-/${name.split("/")[1]}-${version}.tgz`,
      integrity,
      attestations: { url: `${registry}/-/npm/v1/attestations/${encodeURIComponent(name)}@${version}` }
    }
  }));
  const statements = names.map(name => ({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:npm/${name.replace("@", "%40")}@${version}`, digest: { sha512: digest.toString("hex") } }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: { buildDefinition: {
      externalParameters: { workflow: { repository, path: ".github/workflows/release-safe.yml", ref: "refs/heads/main" } },
      resolvedDependencies: [{ uri: `git+${repository}@refs/heads/main`, digest: { gitCommit: source } }]
    } }
  }));
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => {
    const index = names.findIndex(name => url === `${registry}/${encodeURIComponent(name)}/${version}`);
    if (index !== -1) return Response.json(metadata[index]);
    const provenanceIndex = metadata.findIndex(item => url === item.dist.attestations.url);
    if (provenanceIndex !== -1) return Response.json({ attestations: [{
      predicateType: "https://slsa.dev/provenance/v1",
      bundle: { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: Buffer.from(JSON.stringify(statements[provenanceIndex])).toString("base64") } }
    }] });
    if (metadata.some(item => url === item.dist.tarball)) return new Response(archive);
    throw new Error(`Unexpected registry request: ${url}`);
  });
  const run = vi.fn(async (command: string, _args: string[], options: { cwd: string; env: Record<string, string>; timeout: number }) => {
    if (command !== "npm") return;
    const packages: Record<string, unknown> = { "": { dependencies: Object.fromEntries(names.map(name => [name, version])) } };
    for (const item of metadata) {
      const directory = join(options.cwd, "node_modules", item.name);
      await files.mkdir(directory, { recursive: true });
      await files.writeFile(join(directory, "package.json"), JSON.stringify({ name: item.name, version: item.version }));
      packages[`node_modules/${item.name}`] = { version: item.version, resolved: item.dist.tarball, integrity: item.dist.integrity };
    }
    await files.writeFile(join(options.cwd, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  });
  const sleep = vi.fn(async () => {});
  const log = vi.fn();
  return { metadata, statements, files, fetch, run, sleep, log,
    verify: (overrides = {}) => verifyPublication({ version, source, workDir: "/out", maxAttempts: 2, retryDelayMs: 1, ...overrides }, {
      files: files as unknown as typeof import("node:fs/promises"), fetch, run,
      sleep: sleep as unknown as typeof import("node:timers/promises").setTimeout, log
    }) };
}

describe("public safe-package verification", () => {
  it("downloads every exact archive, binds provenance, then installs exact registry specs and imports", async () => {
    const context = fixture();
    await context.verify();
    for (const metadata of context.metadata) expect(context.fetch).toHaveBeenCalledWith(metadata.dist.tarball, expect.objectContaining({ redirect: "error" }));
    const [command, args, options] = context.run.mock.calls[0];
    expect(command).toBe("npm");
    expect(args).toEqual(expect.arrayContaining(names.map(name => `${name}@${version}`)));
    expect(args).toEqual(expect.arrayContaining(["--prefer-online", "--offline=false", "--prefer-offline=false", "--ignore-scripts", "--workspaces=false", "--fetch-retries=0", `--registry=${registry}`]));
    expect(args.some(arg => arg.endsWith(".tgz"))).toBe(false);
    expect(options).toMatchObject({ env: { HOME: expect.stringContaining("/out/"), npm_config_userconfig: expect.stringContaining("/out/") }, timeout: 120_000 });
    expect(Object.keys(options.env).sort()).toEqual(["HOME", "PATH", "npm_config_globalconfig", "npm_config_userconfig"]);
    expect(context.run.mock.calls[1][0]).toBe(process.execPath);
    expect(context.run.mock.calls[1][1].join(" ")).toContain("@poe-platform/safe-bash/commands/");
    expect(await context.files.readdir("/out")).toEqual([]);
  });

  it("never succeeds on metadata 200 plus archive 404", async () => {
    const context = fixture();
    const request = context.fetch.getMockImplementation()!;
    context.fetch.mockImplementation(async url => url.endsWith(".tgz") ? new Response("not propagated", { status: 404 }) : request(url));
    await expect(context.verify()).rejects.toThrow("HTTP 404");
    expect(context.run).not.toHaveBeenCalled();
    expect(context.sleep).toHaveBeenCalledTimes(1);
    expect(context.fetch.mock.calls.filter(([url]) => url.endsWith(".tgz"))).toHaveLength(2);
  });

  it("retries archive propagation without changing version, source or identity", async () => {
    const context = fixture();
    const request = context.fetch.getMockImplementation()!;
    let missing = true;
    context.fetch.mockImplementation(async url => {
      if (missing && url.endsWith(".tgz")) { missing = false; return new Response(null, { status: 404 }); }
      return request(url);
    });
    await context.verify();
    expect(context.sleep).toHaveBeenCalledTimes(1);
    expect(context.run).toHaveBeenCalledTimes(2);
  });

  it("does not let two available packages hide the third archive's 404", async () => {
    const context = fixture();
    const request = context.fetch.getMockImplementation()!;
    context.fetch.mockImplementation(async url => url === context.metadata[2].dist.tarball ? new Response(null, { status: 404 }) : request(url));
    await expect(context.verify()).rejects.toThrow("HTTP 404");
    expect(context.run).not.toHaveBeenCalled();
    expect(context.log.mock.calls.flat().join(" ")).not.toContain("Verified");
  });

  it.each(["name", "version", "repository"])("rejects wrong metadata %s", async field => {
    const context = fixture();
    Object.assign(context.metadata[0], { [field]: "unrelated" });
    await expect(context.verify({ maxAttempts: 1 })).rejects.toThrow("incorrect metadata identity");
    expect(context.run).not.toHaveBeenCalled();
  });

  it.each(["sha1-AAAA", "sha512-AAAA", "sha512-", "", `sha512-${"!".repeat(88)}`])("rejects unsupported or malformed integrity %s", async value => {
    const context = fixture();
    context.metadata[0].dist.integrity = value;
    await expect(context.verify({ maxAttempts: 1 })).rejects.toThrow("integrity");
    expect(context.run).not.toHaveBeenCalled();
  });

  it("rejects archive bytes that do not match advertised integrity", async () => {
    const context = fixture();
    const request = context.fetch.getMockImplementation()!;
    context.fetch.mockImplementation(async url => url.endsWith(".tgz") ? new Response("corrupt") : request(url));
    await expect(context.verify()).rejects.toThrow("integrity");
    expect(context.run).not.toHaveBeenCalled();
  });

  it.each(["tarball", "integrity"])("pins advertised %s across retries", async field => {
    const context = fixture();
    context.run.mockRejectedValueOnce(new Error("ETARGET"));
    context.sleep.mockImplementationOnce(async () => {
      if (field === "tarball") context.metadata[0].dist.tarball += "?different-artifact";
      else context.metadata[0].dist.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
    });
    await expect(context.verify()).rejects.toThrow("identity changed");
    expect(context.run).toHaveBeenCalledTimes(1);
  });

  it.each(["source", "repository", "workflow", "subject", "digest"])("rejects provenance with a different %s", async field => {
    const context = fixture();
    const statement = context.statements[0];
    if (field === "source") statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "a".repeat(40);
    if (field === "repository") statement.predicate.buildDefinition.externalParameters.workflow.repository = "https://github.com/other/repo";
    if (field === "workflow") statement.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml";
    if (field === "subject") statement.subject[0].name = "pkg:npm/unrelated@1.0.0";
    if (field === "digest") statement.subject[0].digest.sha512 = "0".repeat(128);
    await expect(context.verify({ maxAttempts: 1 })).rejects.toThrow("provenance");
    expect(context.run).not.toHaveBeenCalled();
  });

  it("retries stale npm resolution with a fresh consumer and empty cache", async () => {
    const context = fixture();
    context.run.mockRejectedValueOnce(new Error("npm ETARGET"));
    await context.verify();
    const calls = context.run.mock.calls.filter(([command]) => command === "npm");
    expect(calls).toHaveLength(2);
    expect(calls[0][2].cwd).not.toBe(calls[1][2].cwd);
    expect(calls[0][1].find(arg => arg.startsWith("--cache="))).not.toBe(calls[1][1].find(arg => arg.startsWith("--cache=")));
    expect(await context.files.readdir("/out")).toEqual([]);
  });

  it("fails after bounded package-manager download failures without trying imports", async () => {
    const context = fixture();
    context.run.mockRejectedValue(new Error("npm E404: registry archive unavailable"));
    await expect(context.verify()).rejects.toThrow("npm E404");
    expect(context.run).toHaveBeenCalledTimes(2);
    expect(context.run.mock.calls.every(([command]) => command === "npm")).toBe(true);
    expect(await context.files.readdir("/out")).toEqual([]);
  });

  it("enforces the whole-run deadline during an in-flight request", async () => {
    const context = fixture();
    context.fetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    await expect(context.verify({ timeoutMs: 20 })).rejects.toThrow("Public verification failed");
    expect(context.fetch).toHaveBeenCalledTimes(1);
    expect(context.sleep).not.toHaveBeenCalled();
  });

  it.each(["resolved", "integrity", "version", "link", "manifest", "missing"])("rejects npm substitution via %s", async field => {
    const context = fixture();
    const install = context.run.getMockImplementation()!;
    context.run.mockImplementation(async (command, args, options) => {
      await install(command, args, options);
      const lockPath = join(options.cwd, "package-lock.json");
      const lock = JSON.parse(await context.files.readFile(lockPath, "utf8") as string);
      const key = `node_modules/${names[0]}`;
      if (field === "missing") delete lock.packages[key];
      else if (field === "manifest") await context.files.writeFile(join(options.cwd, key, "package.json"), JSON.stringify({ name: names[0], version: "0.0.1" }));
      else lock.packages[key][field] = field === "link" ? true : "substituted";
      await context.files.writeFile(lockPath, JSON.stringify(lock));
    });
    await expect(context.verify({ maxAttempts: 1 })).rejects.toThrow("installed identity");
    expect(context.run).toHaveBeenCalledTimes(1);
  });

  it("does not report success when import exits unsuccessfully", async () => {
    const context = fixture();
    const install = context.run.getMockImplementation()!;
    context.run.mockImplementation(async (command, args, options) => {
      if (command !== "npm") throw new Error("import failed");
      await install(command, args, options);
    });
    await expect(context.verify()).rejects.toThrow("import failed");
    expect(context.log.mock.calls.flat().join(" ")).not.toContain("Verified");
    expect(await context.files.readdir("/out")).toEqual([]);
  });

  it.each([{ version: "latest" }, { version: "^0.1.669" }, { source: "main" }, { maxAttempts: 0 }, { timeoutMs: Infinity }])("rejects unbounded or non-exact inputs %j", async overrides => {
    const context = fixture();
    await expect(context.verify(overrides)).rejects.toThrow();
    expect(context.fetch).not.toHaveBeenCalled();
  });
});

describe("bounded registry reads", () => {
  it.each(["http://registry.npmjs.org/archive", "https://example.com/archive", "https://user:pass@registry.npmjs.org/archive", "file:///archive"])("rejects non-public-registry URLs %s", async url => {
    const fetch = vi.fn();
    await expect(readRegistry(url, { maxBytes: 8 }, fetch)).rejects.toThrow("registry URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([301, 302, 404, 429, 500, 206])("rejects HTTP %s and cancels its body", async status => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status }));
    await expect(readRegistry(`${registry}/archive`, { maxBytes: 8 }, fetch)).rejects.toThrow(`HTTP ${status}`);
    expect(cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it("rejects oversized declared bodies before reading", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-length": "100" } }));
    await expect(readRegistry(`${registry}/archive`, { maxBytes: 8 }, fetch)).rejects.toThrow("exceeds");
    expect(cancel).toHaveBeenCalled();
  });

  it("bounds streamed bytes even when content-length lies", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.alloc(9)); }, cancel }), { headers: { "content-length": "1" } }));
    await expect(readRegistry(`${registry}/archive`, { maxBytes: 8 }, fetch)).rejects.toThrow("exceeds");
    expect(cancel).toHaveBeenCalled();
  });

  it("passes request and whole-run cancellation to fetch", async () => {
    const controller = new AbortController();
    controller.abort(new Error("deadline"));
    const fetch = vi.fn();
    await expect(readRegistry(`${registry}/archive`, { maxBytes: 8, signal: controller.signal }, fetch)).rejects.toThrow("deadline");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts a stalled response body rather than treating headers as completion", async () => {
    const signal = AbortSignal.timeout(20);
    const fetch = vi.fn(async (_url: string, options: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("partial"));
        options.signal!.addEventListener("abort", () => controller.error(options.signal!.reason), { once: true });
      }
    })));
    await expect(readRegistry(`${registry}/archive`, { maxBytes: 8, signal }, fetch)).rejects.toThrow();
    expect(signal.aborted).toBe(true);
  });
});

describe("bounded child execution", () => {
  it("preserves a real nonzero child exit", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.exit(7)"], { timeout: 1_000 })).rejects.toMatchObject({ code: 7 });
  });

  it("kills a stalled package manager or import", async () => {
    await expect(runCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 50 })).rejects.toMatchObject({ signal: "SIGKILL" });
  });

  it("bounds child output", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(2_000_000))"], { timeout: 1_000 })).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
  });

  it("the CLI exits nonzero for non-exact versions before touching disk", async () => {
    await expect(runCommand(process.execPath, ["scripts/verify-safe-publication.mjs", "--version", "latest", "--source", source], { timeout: 1_000 })).rejects.toMatchObject({ code: 1 });
  });
});
