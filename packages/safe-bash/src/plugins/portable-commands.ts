import { CommandRegistry, type CommandDefinition } from "../contracts/index.js";
import { createOptionalCommands, createPandocCommand } from "../lazy-optional.js";
import { createMmdcCommands } from "../lazy-mmdc.js";
import { createYqCommands } from "../commands/yq/index.js";
import { createHtmlqCommands } from "../commands/htmlq/index.js";
import { createDiff3Commands } from "../commands/diff3/index.js";
import { createExiftoolCommands } from "../commands/exiftool/index.js";
import { createUnrtfCommands } from "../commands/unrtf/index.js";
import { createCsvcutCommands } from "../commands/csvcut/index.js";
import { createCsvgrepCommands } from "../commands/csvgrep/index.js";
import { createOpCommands } from "../commands/op/index.js";

export function createPortableAgentCommands(hasCommand?: (name: string) => boolean): readonly CommandDefinition[] {
  return new CommandRegistry([
    ...createYqCommands(),
    ...createHtmlqCommands(),
    ...createDiff3Commands(),
    ...createExiftoolCommands(),
    ...createUnrtfCommands(),
    ...createMmdcCommands(),
    ...createOpCommands(),
    createPandocCommand({}, hasCommand),
    ...createOptionalCommands({ families: [
      "ffmpeg", "soffice", "ssconvert", "pdfinfo", "pdftotext",
      "pdfimages", "pdftoppm", "pdftk", "qpdf", "sips", "imagemagick",
      "wkhtmltopdf", "csvkit",
    ] }),
    // Dedicated CSV implementations take precedence over CSVKit fallbacks.
    ...createCsvcutCommands(),
    ...createCsvgrepCommands(),
  ]).list();
}
