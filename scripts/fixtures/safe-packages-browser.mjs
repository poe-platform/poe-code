import { Shell, browserCommands, createBrowserCommands, createMemoryFileSystem, evaluateCommandSupport, FsError, createBoundedRegexProvider, portableSearchCommands } from "@poe-platform/safe-bash/browser";
import { FsError as CoreFsError } from "@poe-platform/safe-fs/core";
import { FsError as CompatibilityFsError } from "@poe-platform/safe-js/fs/core";

if (FsError !== CoreFsError) throw new Error("Browser filesystem identity diverged");
if (FsError !== CompatibilityFsError) throw new Error("Compatibility filesystem identity diverged");
const definitions = createBrowserCommands();
for (const definition of definitions) {
  if (!Object.hasOwn(definition, "filesystemRequirements")) throw new Error(`Missing browser filesystem requirements: ${definition.name}`);
}
for (const [name, expected] of [["printf", "supported"], ["mkdir", "unsupported"], ["tee", "partial"]]) {
  const definition = definitions.find(command => command.name === name);
  if (!definition || evaluateCommandSupport(definition, { readOnly: true }).status !== expected) {
    throw new Error(`Browser filesystem capability evaluation failed: ${name}`);
  }
}
const shell = new Shell({ fs: createMemoryFileSystem() }).use(browserCommands());
try {
  const result = await shell.exec("printf 'b\\na\\n' | sort");
  if (result.exitCode !== 0 || result.stdout !== "a\nb\n") throw new Error("Browser shell smoke failed");
  for (const [script, expected] of [
    ["printf 'a,b\\nc,d\\n' | cut -d , -f 2", "b\nd\n"],
    ["printf 'a\\tb\\tc\\n' | cut -f 1,3", "a\tc\n"],
    ["printf 'a,,c\\n,b,\\n' > /fields; cut -d , -f 2,3 /fields", ",c\nb,\n"],
  ]) {
    const output = await shell.exec(script);
    if (output.exitCode !== 0 || output.stderr !== "" || output.stdout !== expected) {
      throw new Error(`Browser cut smoke failed: ${script}: ${JSON.stringify(output)}`);
    }
  }
} finally { await shell.dispose(); }

const search = new Shell({ fs: createMemoryFileSystem() })
  .use(browserCommands())
  .use(portableSearchCommands({ provider: createBoundedRegexProvider() }));
try {
  const result = await search.exec("printf 'first\\nsecond\\n' | grep -E '^(first|second)$' | rg -F second | sed 's/second/done/'");
  if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== "done\n") {
    throw new Error(`Production portable search smoke failed: ${JSON.stringify(result)}`);
  }
} finally { await search.dispose(); }
