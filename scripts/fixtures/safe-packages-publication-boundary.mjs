import { verification as privateCommandVerification } from "./safe-packages-private-command.mjs";
import { verification as xzVerification } from "./safe-packages-xz.mjs";
import { verification as yqVerification } from "./safe-packages-yq-browser.mjs";
import { verifyFfmpeg } from "./safe-packages-ffmpeg.mjs";
import { Shell, commandRuntimeIdentity } from "@poe-platform/safe-bash";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";
import { createWkhtmltopdfCommand, wkhtmltopdfCommands } from "@poe-platform/safe-bash/commands/wkhtmltopdf";

async function verifyPublicationBoundary() {
  await privateCommandVerification;
  await xzVerification;
  await yqVerification;
  await verifyFfmpeg();
  if (createWkhtmltopdfCommand().runtimeIdentity !== commandRuntimeIdentity) {
    throw new Error("Packed renderer command has a foreign contract runtime");
  }
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(wkhtmltopdfCommands());
  try {
    const result = await shell.exec("wkhtmltopdf --help");
    const expected = "Usage: wkhtmltopdf [options] [page|cover input|toc]... output\nBuilt-in PDF AST static renderer; trusted overrides are optional. Input/output '-' use stdin/stdout.\n";
    if (result.exitCode !== 0 || result.stderr !== "" || result.stdout !== expected) {
      throw new Error("Packed renderer command failed canonical Shell invocation: " + JSON.stringify(result));
    }
  } finally { await shell.dispose(); }
}

export const verification = verifyPublicationBoundary();
