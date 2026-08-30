import { posix } from "node:path";
import { decode, encode, environment, fixedTime, fixtureRoot, maximumBytes, projectBytes, relativePath, snapshot } from "./reuse/expanded-common.mjs";

export async function observeExpanded({ library, engine, specimen, baseUrl, profile, signal, mark }) {
  const guestEnvironment = profile === "aligned" ? { ...environment, TMPDIR: "/tmp" } : environment;
  let shell, execute;
  let dispose = async () => {};
  try {
  const fs = engine === "virtual-bash" ? library.createMemoryFileSystem() : new library.InMemoryFs();
  if (profile === "aligned") await fs.mkdir("/tmp", { recursive: true });
  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.chmod(fixtureRoot, 0o755);
  for (const path of specimen.directories) { const target = `${fixtureRoot}/${relativePath(path)}`; await fs.mkdir(target, { recursive: true }); await fs.chmod(target, 0o755); }
  for (const [path, bytes] of Object.entries(specimen.files)) {
    const target = `${fixtureRoot}/${relativePath(path)}`, parent = posix.dirname(target);
    await fs.mkdir(parent, { recursive: true });
    let directory = parent;
    while (directory !== fixtureRoot && directory !== "/") { await fs.chmod(directory, 0o755); directory = posix.dirname(directory); }
    await fs.writeFile(target, decode(bytes)); await fs.chmod(target, specimen.fileModes[path] ?? 0o644);
    const time = specimen.fileTimes?.[path] ?? fixedTime;
    await fs.utimes(target, engine === "virtual-bash" ? time : new Date(time), engine === "virtual-bash" ? time : new Date(time));
  }
  const events = [], registryEvents = [];
  if (engine === "virtual-bash") {
    const commands = new library.CommandRegistry();
    shell = new library.Shell({ fs, commands, cwd: fixtureRoot, env: guestEnvironment,
      limits: { maxOutputBytes: maximumBytes, maxCommands: 10000, maxLoopIterations: 10000, pipeHighWaterMark: 4096 } });
    dispose = () => shell.dispose();
    shell.use(library.agentCommands());
    if (specimen.network) shell.use(library.networkCommands({ authorize({ url }) { const parsed = new URL(url); return parsed.origin === baseUrl && parsed.hostname === "127.0.0.1"; } }));
    await mark("initialization-exec");
    await shell.exec("", { signal });
    execute = async () => {
      const result = await shell.exec(specimen.script.replaceAll("{{BASE}}", baseUrl ?? "network-unavailable"), { stdin: decode(specimen.stdin), signal });
      return { stdout: Buffer.from(result.stdoutBytes), stderr: Buffer.from(result.stderrBytes), exitCode: result.exitCode };
    };
    dispose = () => shell.dispose();
  } else {
    shell = new library.Bash({ fs, cwd: fixtureRoot, env: guestEnvironment,
      executionLimits: { maxOutputSize: maximumBytes, maxCommandCount: 10000, maxLoopIterations: 10000, maxExecutionTimeMs: 5000 },
      ...(specimen.network ? { network: { allowedUrlPrefixes: [baseUrl], allowedMethods: ["GET", "HEAD", "POST", "PUT"], denyPrivateRanges: false, maxResponseSize: maximumBytes, timeoutMs: 4000 } } : {}) });
    execute = async () => {
      const result = await shell.exec(specimen.script.replaceAll("{{BASE}}", baseUrl ?? "network-unavailable"), {
        stdin: decode(specimen.stdin).toString("latin1"), stdinKind: "bytes", rawScript: true,
        replaceEnv: true, env: guestEnvironment, signal,
      });
      return { stdout: Buffer.from(library.latin1FromBytes(library.stdoutAsBytes(result)), "latin1"), stderr: Buffer.from(result.stderr, "utf8"), exitCode: result.exitCode };
    };
    dispose = async () => {};
  }
    await mark("exec-start");
    const result = await execute();
    await mark("exec-settled");
    const replacements = baseUrl ? [[baseUrl, "{{BASE}}"]] : [];
    const entries = await snapshot(engine === "virtual-bash" ? {
      list: async path => (await fs.readdir(path)).map(entry => entry.name), stat: path => fs.lstat(path), read: path => fs.readFile(path, { signal, maxBytes: maximumBytes }), link: path => fs.readlink(path),
    } : { list: path => fs.readdir(path), read: path => fs.readFileBuffer(path), link: path => fs.readlink(path), stat: async path => {
      const info = await fs.lstat(path); return { type: info.isSymbolicLink ? "symlink" : info.isDirectory ? "directory" : info.isFile ? "file" : "other", mode: info.mode };
    } }, specimen, fixtureRoot, replacements);
    await mark("snapshot-complete");
    return { raw: { stdoutBase64: encode(result.stdout), stderrBase64: encode(result.stderr) }, stdout: encode(projectBytes(result.stdout, replacements)), stderr: encode(projectBytes(result.stderr, replacements)), exitCode: result.exitCode, entries,
      events, registryEvents, dispatchObservation: "not instrumented; no command replacement",
      capture: engine === "virtual-bash" ? "native Uint8Array stdout/stderr" : "public stdoutAsBytes/latin1FromBytes; stderr UTF8 public text" };
  } finally { await mark("dispose-start", { apiAvailable: engine === "virtual-bash" }); await dispose(); await mark("dispose-settled", { apiAvailable: engine === "virtual-bash" }); }
}
