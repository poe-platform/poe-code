import * as commands from "@poe-platform/safe-bash";

// Public agent registration must expose effect-free discovery in every runtime.
const helpFs = new Proxy(commands.createMemoryFileSystem(), {
  get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return () => { throw new Error("ExifTool help accessed the VFS: " + String(key)); };
  },
});
const helpShell = new commands.Shell({ fs: helpFs }).use(commands.agentCommands());
try {
  for (const flag of ["--help", "-help", "-?"]) {
    const result = await helpShell.exec(`exiftool '${flag}'`);
    if (result.exitCode !== 0 || result.stderr || !result.stdout.includes("exiftool -j image.png") || !result.stdout.includes("maxOutputBytes")) {
      throw new Error("ExifTool discovery failed: " + JSON.stringify(result));
    }
  }
} finally { await helpShell.dispose(); }
