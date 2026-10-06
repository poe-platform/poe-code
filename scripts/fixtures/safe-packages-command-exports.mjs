import * as commands from "@poe-platform/safe-bash";

const families = ["csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "ffmpeg", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
for (const name of families) {
  const title = name[0].toUpperCase() + name.slice(1);
  const command = commands[`create${title}Command`]();
  if (typeof command.execute !== "function") throw new Error(`${name}: missing execute`);
  const definitions = commands[`create${title}Commands`]();
  if (!definitions.some(value => value.name === command.name)) throw new Error(`${name}: primary command missing`);
  const registry = new commands.CommandRegistry();
  commands[`${name}Commands`]().setup({ commands: registry });
  if (JSON.stringify(registry.list().map(value => value.name)) !== JSON.stringify(definitions.map(value => value.name))) throw new Error(`${name}: plugin inventory differs`);
}
for (const name of ["createUnxzCommand", "createXzcatCommand", "createNcalCommand", "createFfprobeCommand", "createMagickCommand", "createConvertCommand", "createMogrifyCommand", "createCompositeCommand", "createMontageCommand", "createIdentifyCommand", "createCompareCommand", "createPdfuniteCommand", "createPdfseparateCommand", "createPdffontsCommand", "createPdfdetachCommand", "createPdftocairoCommand", "createLibreofficeCommand", "createFormatInspectionCommand"]) {
  if (typeof commands[name] !== "function") throw new Error(`${name}: missing factory`);
}

import * as sed from "@poe-platform/safe-bash/commands/sed";
import * as awk from "@poe-platform/safe-bash/commands/awk";
import * as diff from "@poe-platform/safe-bash/commands/diff";
import * as patch from "@poe-platform/safe-bash/commands/patch";
import * as tar from "@poe-platform/safe-bash/commands/tar";
import * as zip from "@poe-platform/safe-bash/commands/zip";
import * as unzip from "@poe-platform/safe-bash/commands/unzip";
import * as find from "@poe-platform/safe-bash/commands/find";
import * as curl from "@poe-platform/safe-bash/commands/curl";
import * as wget from "@poe-platform/safe-bash/commands/wget";
import * as gzip from "@poe-platform/safe-bash/commands/gzip";

for (const [name, api] of Object.entries({ sed, awk, diff, patch, tar, zip, unzip, find, curl, wget, gzip })) {
  const title = name[0].toUpperCase() + name.slice(1);
  const primary = api[`create${title}Command`]();
  const definitions = api[`create${title}Commands`]();
  if (primary.name !== name || !definitions.some(command => command.name === name)) throw new Error(`${name}: standalone command missing`);
  const registry = new commands.CommandRegistry();
  api[`${name}Commands`]().setup({ commands: registry });
  if (JSON.stringify(registry.list().map(command => command.name)) !== JSON.stringify(definitions.map(command => command.name))) throw new Error(`${name}: standalone plugin inventory differs`);
}

import * as media from "@poe-platform/safe-bash/commands/media";
import * as mcp from "@poe-platform/safe-bash/commands/mcp";
for (const [name, api] of Object.entries({ media, mcp })) {
  const title = name[0].toUpperCase() + name.slice(1);
  const primary = api[`create${title}Command`]();
  const definitions = api[`create${title}Commands`]();
  if (!definitions.some(command => command.name === primary.name)) throw new Error(`${name}: primary missing`);
  const registry = new commands.CommandRegistry();
  api[`${name}Commands`]().setup({ commands: registry });
  if (JSON.stringify(registry.list().map(command => command.name)) !== JSON.stringify(definitions.map(command => command.name))) throw new Error(`${name}: plugin inventory differs`);
}

// Exercise the extracted AWK implementation under both Node and portable exports.
const awkFs = commands.createMemoryFileSystem();
await awkFs.writeFile('/awk-input', new TextEncoder().encode('left 2\nright 3\n'));
await awkFs.writeFile('/awk-script', new TextEncoder().encode("awk '{ sum += $2 } END { print sum }' /awk-input | awk '{ print $1 * 2 }'"));
const awkShell = new commands.Shell({ fs: awkFs }).use(commands.agentCommands());
try {
  const result = await awkShell.exec('sh /awk-script');
  if (result.exitCode !== 0 || result.stdout !== '10\n') throw new Error('Portable AWK script/pipeline failed: ' + result.stderr);
} finally { await awkShell.dispose(); }

import "./safe-packages-exiftool-help.mjs";
