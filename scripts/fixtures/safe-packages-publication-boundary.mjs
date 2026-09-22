import { verification as privateCommandVerification } from "./safe-packages-private-command.mjs";
import { Shell, commandRuntimeIdentity } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createWkhtmltopdfCommand, wkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";

async function verifyPublicationBoundary() {
  await privateCommandVerification;
  if (createWkhtmltopdfCommand().runtimeIdentity !== commandRuntimeIdentity) {
    throw new Error("Packed renderer command has a foreign contract runtime");
  }
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(wkhtmltopdfCommands());
  try {
    const result = await shell.exec("wkhtmltopdf --help");
    const expected = "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nStatic first-party renderer requires an explicit binding. Input/output '-' use stdin/stdout.\n";
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== expected) {
      throw new Error("Packed renderer command failed canonical Shell invocation: " + JSON.stringify(result));
    }
  } finally { await shell.dispose(); }
}

export const verification = verifyPublicationBoundary();
