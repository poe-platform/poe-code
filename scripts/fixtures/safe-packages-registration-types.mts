import { Shell, createMemoryFileSystem } from "@poe-platform/safe-bash";
import { exiftoolCommands, type ExiftoolCommandOptions } from "@poe-platform/safe-bash/commands/exiftool";
import { wkhtmltopdfCommands, wkhtmltopdfLimits, type WkhtmltopdfCommandOptions } from "@poe-platform/safe-bash/commands/wkhtmltopdf";

const metadata: ExiftoolCommandOptions = { replace: true, limits: { maxInputBytes: 1024 } };
const renderer: WkhtmltopdfCommandOptions = { replace: true, limits: wkhtmltopdfLimits };
const shell = new Shell({ fs: createMemoryFileSystem() }).use(exiftoolCommands(metadata)).use(wkhtmltopdfCommands(renderer));
await shell.dispose();
