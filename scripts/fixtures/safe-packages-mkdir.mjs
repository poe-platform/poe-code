import { Shell, agentCommands, createMemoryFileSystem } from "@poe-platform/safe-bash";

const backing = createMemoryFileSystem();
await backing.mkdir("/existing", { mode: 0o755 });
const calls = [];
const fs = new Proxy(backing, {
  get(target, property) {
    if (property === "capabilities") return { ...target.capabilities, implicitDirectories: true };
    if (property === "capabilitiesFor") return undefined;
    if (property === "mkdir") return async (path, options) => {
      calls.push({ path, options });
      await target.mkdir(path, options);
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const shell = new Shell({ fs }).use(agentCommands());
try {
  const result = await shell.exec("mkdir -pv -m700 /existing");
  if (result.exitCode !== 0 || result.stdout !== "" || result.stderr !== "") {
    throw new Error(`Existing implicit mkdir changed command output: ${JSON.stringify(result)}`);
  }
  if (calls.length !== 1 || calls[0].path !== "/existing" || calls[0].options.recursive !== true || calls[0].options.mode !== undefined) {
    throw new Error("Existing implicit mkdir did not delegate exactly once without changing the mode");
  }
  if (((await backing.stat("/existing")).mode & 0o777) !== 0o755) throw new Error("Existing mkdir changed permissions");
} finally { await shell.dispose(); }
