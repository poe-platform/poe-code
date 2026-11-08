import * as wkhtmltopdfApi from "@poe-platform/safe-bash/commands/wkhtmltopdf";
import * as sofficeApi from "@poe-platform/safe-bash/commands/soffice";
import * as qpdfApi from "@poe-platform/safe-bash/commands/qpdf";
import * as pdftotextApi from "@poe-platform/safe-bash/commands/pdftotext";
import * as pdftoppmApi from "@poe-platform/safe-bash/commands/pdftoppm";
import * as pdftkApi from "@poe-platform/safe-bash/commands/pdftk";
import * as mmdcApi from "@poe-platform/safe-bash/commands/mmdc";
import * as htmlqApi from "@poe-platform/safe-bash/commands/htmlq";
import * as diff3Api from "@poe-platform/safe-bash/commands/diff3";
import * as csvgrepApi from "@poe-platform/safe-bash/commands/csvgrep";
import * as csvcutApi from "@poe-platform/safe-bash/commands/csvcut";
import * as ssconvertApi from "@poe-platform/safe-bash/commands/ssconvert";
import * as csvkitApi from "@poe-platform/safe-bash/commands/csvkit";

function assert(condition, message) { if (!condition) throw new Error(message); }

// Verify the standard factory surface on the packed public command entries.
for (const [name, createCommand, createCommands, plugin] of [
  ["csvkit", csvkitApi.createCsvkitCommand, csvkitApi.createCsvkitCommands, csvkitApi.csvkitCommands],
  ["ssconvert", ssconvertApi.createSsconvertCommand, ssconvertApi.createSsconvertCommands, ssconvertApi.ssconvertCommands],
  ["csvcut", csvcutApi.createCsvcutCommand, csvcutApi.createCsvcutCommands, csvcutApi.csvcutCommands],
  ["csvgrep", csvgrepApi.createCsvgrepCommand, csvgrepApi.createCsvgrepCommands, csvgrepApi.csvgrepCommands],
  ["diff3", diff3Api.createDiff3Command, diff3Api.createDiff3Commands, diff3Api.diff3Commands],
  ["htmlq", htmlqApi.createHtmlqCommand, htmlqApi.createHtmlqCommands, htmlqApi.htmlqCommands],
  ["mmdc", mmdcApi.createMmdcCommand, mmdcApi.createMmdcCommands, mmdcApi.mmdcCommands],
  ["pdftk", pdftkApi.createPdftkCommand, pdftkApi.createPdftkCommands, pdftkApi.pdftkCommands],
  ["pdftoppm", pdftoppmApi.createPdftoppmCommand, pdftoppmApi.createPdftoppmCommands, pdftoppmApi.pdftoppmCommands],
  ["pdftotext", pdftotextApi.createPdftotextCommand, pdftotextApi.createPdftotextCommands, pdftotextApi.pdftotextCommands],
  ["qpdf", qpdfApi.createQpdfCommand, qpdfApi.createQpdfCommands, qpdfApi.qpdfCommands],
  ["soffice", sofficeApi.createSofficeCommand, sofficeApi.createSofficeCommands, sofficeApi.sofficeCommands],
  ["wkhtmltopdf", wkhtmltopdfApi.createWkhtmltopdfCommand, wkhtmltopdfApi.createWkhtmltopdfCommands, wkhtmltopdfApi.wkhtmltopdfCommands],
 ]) {
  const definitions = createCommands();
  assert(definitions.length > 0 && definitions.every(command => typeof command.execute === "function"), `${name} packed command family missing`);
  assert(definitions.some(command => command.name === createCommand().name), `${name} packed single command missing`);
  const registered = [];
  await plugin().setup({ commands: { register: command => registered.push(command.name), has: () => false } });
  assert(JSON.stringify(registered) === JSON.stringify(definitions.map(command => command.name)), `${name} packed plugin registration differs`);
}
