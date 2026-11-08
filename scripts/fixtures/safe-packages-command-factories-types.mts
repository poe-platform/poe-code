import type { CommandDefinition } from "@poe-platform/safe-bash";
import * as csvkitApi from "@poe-platform/safe-bash/commands/csvkit";
const csvkitOptions: csvkitApi.CsvkitCommandsOptions = {};
const csvkitFamily: readonly CommandDefinition[] = csvkitApi.createCsvkitCommands(csvkitOptions);
const csvkitSingle: CommandDefinition = csvkitApi.createCsvkitCommand();
void csvkitFamily;
void csvkitSingle;
csvkitApi.csvkitCommands();

import * as ssconvertApi from "@poe-platform/safe-bash/commands/ssconvert";
const ssconvertOptions: ssconvertApi.SsconvertCommandsOptions = {};
const ssconvertFamily: readonly CommandDefinition[] = ssconvertApi.createSsconvertCommands(ssconvertOptions);
const ssconvertSingle: CommandDefinition = ssconvertApi.createSsconvertCommand();
void ssconvertFamily;
void ssconvertSingle;
ssconvertApi.ssconvertCommands();

import * as csvcutApi from "@poe-platform/safe-bash/commands/csvcut";
const csvcutOptions: csvcutApi.CsvcutCommandsOptions = {};
const csvcutFamily: readonly CommandDefinition[] = csvcutApi.createCsvcutCommands(csvcutOptions);
const csvcutSingle: CommandDefinition = csvcutApi.createCsvcutCommand();
void csvcutFamily;
void csvcutSingle;
csvcutApi.csvcutCommands();

import * as csvgrepApi from "@poe-platform/safe-bash/commands/csvgrep";
const csvgrepOptions: csvgrepApi.CsvgrepCommandsOptions = {};
const csvgrepFamily: readonly CommandDefinition[] = csvgrepApi.createCsvgrepCommands(csvgrepOptions);
const csvgrepSingle: CommandDefinition = csvgrepApi.createCsvgrepCommand();
void csvgrepFamily;
void csvgrepSingle;
csvgrepApi.csvgrepCommands();

import * as diff3Api from "@poe-platform/safe-bash/commands/diff3";
const diff3Options: diff3Api.Diff3CommandsOptions = {};
const diff3Family: readonly CommandDefinition[] = diff3Api.createDiff3Commands(diff3Options);
const diff3Single: CommandDefinition = diff3Api.createDiff3Command();
void diff3Family;
void diff3Single;
diff3Api.diff3Commands();

import * as htmlqApi from "@poe-platform/safe-bash/commands/htmlq";
const htmlqOptions: htmlqApi.HtmlqCommandsOptions = {};
const htmlqFamily: readonly CommandDefinition[] = htmlqApi.createHtmlqCommands(htmlqOptions);
const htmlqSingle: CommandDefinition = htmlqApi.createHtmlqCommand();
void htmlqFamily;
void htmlqSingle;
htmlqApi.htmlqCommands();

import * as mmdcApi from "@poe-platform/safe-bash/commands/mmdc";
const mmdcOptions: mmdcApi.MmdcCommandsOptions = {};
const mmdcFamily: readonly CommandDefinition[] = mmdcApi.createMmdcCommands(mmdcOptions);
const mmdcSingle: CommandDefinition = mmdcApi.createMmdcCommand();
void mmdcFamily;
void mmdcSingle;
mmdcApi.mmdcCommands();

import * as pdftkApi from "@poe-platform/safe-bash/commands/pdftk";
const pdftkOptions: pdftkApi.PdftkCommandsOptions = {};
const pdftkFamily: readonly CommandDefinition[] = pdftkApi.createPdftkCommands(pdftkOptions);
const pdftkSingle: CommandDefinition = pdftkApi.createPdftkCommand();
void pdftkFamily;
void pdftkSingle;
pdftkApi.pdftkCommands();

import * as pdftoppmApi from "@poe-platform/safe-bash/commands/pdftoppm";
const pdftoppmOptions: pdftoppmApi.PdftoppmCommandsOptions = {};
const pdftoppmFamily: readonly CommandDefinition[] = pdftoppmApi.createPdftoppmCommands(pdftoppmOptions);
const pdftoppmSingle: CommandDefinition = pdftoppmApi.createPdftoppmCommand();
void pdftoppmFamily;
void pdftoppmSingle;
pdftoppmApi.pdftoppmCommands();

import * as pdftotextApi from "@poe-platform/safe-bash/commands/pdftotext";
const pdftotextOptions: pdftotextApi.PdftotextCommandsOptions = {};
const pdftotextFamily: readonly CommandDefinition[] = pdftotextApi.createPdftotextCommands(pdftotextOptions);
const pdftotextSingle: CommandDefinition = pdftotextApi.createPdftotextCommand();
void pdftotextFamily;
void pdftotextSingle;
pdftotextApi.pdftotextCommands();

import * as qpdfApi from "@poe-platform/safe-bash/commands/qpdf";
const qpdfOptions: qpdfApi.QpdfCommandsOptions = {};
const qpdfFamily: readonly CommandDefinition[] = qpdfApi.createQpdfCommands(qpdfOptions);
const qpdfSingle: CommandDefinition = qpdfApi.createQpdfCommand();
void qpdfFamily;
void qpdfSingle;
qpdfApi.qpdfCommands();

import * as sofficeApi from "@poe-platform/safe-bash/commands/soffice";
const sofficeOptions: sofficeApi.SofficeCommandsOptions = {};
const sofficeFamily: readonly CommandDefinition[] = sofficeApi.createSofficeCommands(sofficeOptions);
const sofficeSingle: CommandDefinition = sofficeApi.createSofficeCommand();
void sofficeFamily;
void sofficeSingle;
sofficeApi.sofficeCommands();

import * as wkhtmltopdfApi from "@poe-platform/safe-bash/commands/wkhtmltopdf";
const wkhtmltopdfOptions: wkhtmltopdfApi.WkhtmltopdfCommandsOptions = {};
const wkhtmltopdfFamily: readonly CommandDefinition[] = wkhtmltopdfApi.createWkhtmltopdfCommands(wkhtmltopdfOptions);
const wkhtmltopdfSingle: CommandDefinition = wkhtmltopdfApi.createWkhtmltopdfCommand();
void wkhtmltopdfFamily;
void wkhtmltopdfSingle;
wkhtmltopdfApi.wkhtmltopdfCommands();
