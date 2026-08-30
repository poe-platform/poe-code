import { readFileSync } from "node:fs";
import { Shell, MemoryFileSystem, agentCommands } from "virtual-bash";

const configuration = JSON.parse(readFileSync(process.argv[2], "utf8"));
const filesystem = new MemoryFileSystem();
for (const directory of configuration.directories) await filesystem.mkdir(`/fixture/${directory}`, { recursive: true });
await filesystem.writeFile("/fixture/file", new TextEncoder().encode("sentinel\n"));
await filesystem.symlink("a", "/fixture/link");
const shell = new Shell({ fs: filesystem, cwd: "/fixture", env: { PATH: "", LC_ALL: "C", LANG: "C", TZ: "UTC", ROOT: "/fixture", HOME: "/fixture/home", OLDPWD: "/fixture" },
  limits: { maxOutputBytes: 1024 * 1024, maxSourceBytes: 1024 * 1024, maxExpansionBytes: 1024 * 1024,
    maxExpansionFields: 1000, maxCommands: 1000, maxLoopIterations: 1000 } });
shell.use(agentCommands());
const result = { id: configuration.id, rootResolution: import.meta.resolve("virtual-bash"), disposed: false };
try {
  const observed = await shell.exec(configuration.source, { signal: AbortSignal.timeout(3000) });
  Object.assign(result, { exitCode: observed.exitCode, stdoutBase64: Buffer.from(observed.stdoutBytes).toString("base64"), stderrBase64: Buffer.from(observed.stderrBytes).toString("base64") });
} catch (error) {
  result.rejection = { name: error?.name, message: error?.message, code: error?.code };
} finally {
  await shell.dispose();
  result.disposed = true;
}
console.log(JSON.stringify(result));
