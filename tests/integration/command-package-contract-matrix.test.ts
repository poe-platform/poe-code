import { expect, test } from "vitest";
import { CommandRegistry, type CommandDefinition, type VirtualShellPlugin } from "safe-bash-contracts";
import * as csvkit from "safe-bash-command-csvkit";
import * as ssconvert from "safe-bash-command-ssconvert";
import * as op from "safe-bash-command-op";
import * as pandoc from "safe-bash-command-pandoc";
import * as xmllint from "safe-bash-command-xmllint";
import * as xz from "safe-bash-command-xz";
import * as fmt from "safe-bash-command-fmt";
import * as imagemagick from "safe-bash-command-imagemagick";
import * as csvcut from "safe-bash-command-csvcut";
import * as csvgrep from "safe-bash-command-csvgrep";
import * as diff3 from "safe-bash-command-diff3";
import * as exiftool from "safe-bash-command-exiftool";
import * as fold from "safe-bash-command-fold";
import * as htmlq from "safe-bash-command-htmlq";
import * as mmdc from "safe-bash-command-mmdc";
import * as pdfimages from "safe-bash-command-pdfimages";
import * as pdfinfo from "safe-bash-command-pdfinfo";
import * as pdftk from "safe-bash-command-pdftk";
import * as pdftoppm from "safe-bash-command-pdftoppm";
import * as pdftotext from "safe-bash-command-pdftotext";
import * as qpdf from "safe-bash-command-qpdf";
import * as sips from "safe-bash-command-sips";
import * as soffice from "safe-bash-command-soffice";
import * as unrtf from "safe-bash-command-unrtf";
import * as wkhtmltopdf from "safe-bash-command-wkhtmltopdf";

const families: Record<string, Record<string, unknown>> = { csvkit, ssconvert, op, pandoc, xmllint, xz, fmt, imagemagick, csvcut, csvgrep, diff3, exiftool, fold, htmlq, mmdc, pdfimages, pdfinfo, pdftk, pdftoppm, pdftotext, qpdf, sips, soffice, unrtf, wkhtmltopdf };

for (const [name, exports] of Object.entries(families)) {
  test(`${name} provides optional single, family, and plugin factories`, () => {
    const title = name[0]!.toUpperCase() + name.slice(1);
    const single = exports[`create${title}Command`] as () => CommandDefinition;
    const family = exports[`create${title}Commands`] as () => readonly CommandDefinition[];
    const plugin = exports[`${name}Commands`] as () => VirtualShellPlugin;
    expect(single).toBeTypeOf("function");
    expect(family).toBeTypeOf("function");
    expect(plugin).toBeTypeOf("function");
    const command = single();
    expect(command.name).toBeTypeOf("string");
    expect(command.execute).toBeTypeOf("function");
    const commands = family();
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some(member => member.name === command.name)).toBe(true);
    const registry = new CommandRegistry();
    const instance = plugin();
    instance.setup({ commands: registry } as Parameters<VirtualShellPlugin["setup"]>[0]);
    for (const member of commands) expect(registry.has(member.name)).toBe(true);
  });
}
