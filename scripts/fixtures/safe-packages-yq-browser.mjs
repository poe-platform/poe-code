import { Shell, createMemoryFileSystem, standardCommands, commandRuntimeIdentity } from "@poe-platform/safe-bash";
import { createYqCommand, yqCommands } from "@poe-platform/safe-bash/commands/yq";

export const verification = (async () => {
  if (createYqCommand().runtimeIdentity !== commandRuntimeIdentity) throw new Error("yq runtime identity changed");
  const fs = createMemoryFileSystem();
  await fs.writeFile("/run.sh", new TextEncoder().encode("printf 'value: 2\\n' | yq -o json -c '.value + 0.1'"));
  const shell = new Shell({ fs }).use(standardCommands()).use(yqCommands());
  try {
    const result = await shell.exec("sh /run.sh");
    if (result.exitCode !== 0 || result.stdout !== "2.1\n" || result.stderr !== "") throw new Error("portable yq script failed: " + JSON.stringify(result));
  } finally { await shell.dispose(); }
})();
