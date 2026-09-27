import * as commands from "@poe-platform/safe-bash";

const families = ["csvcut", "csvgrep", "csvkit", "diff3", "exiftool", "ffmpeg", "fmt", "fold", "htmlq", "imagemagick", "mmdc", "op", "pandoc", "pdfimages", "pdfinfo", "pdftk", "pdftoppm", "pdftotext", "qpdf", "sips", "soffice", "ssconvert", "unrtf", "wkhtmltopdf", "xmllint", "xz"];
for (const name of families) {
  const title = name[0].toUpperCase() + name.slice(1);
  const command = commands[`create${title}Command`]();
  if (typeof command.execute !== "function") throw new Error(`${name}: missing execute`);
  const definitions = commands[`create${title}Commands`]();
  if (!definitions.some(value => value.name === command.name)) throw new Error(`${name}: primary command missing`);
  const registered = [];
  commands[`${name}Commands`]().setup({ commands: { has: () => false, register: value => registered.push(value.name) } });
  if (JSON.stringify(registered) !== JSON.stringify(definitions.map(value => value.name))) throw new Error(`${name}: plugin inventory differs`);
}
for (const name of ["createNcalCommand", "createFfprobeCommand", "createMagickCommand", "createConvertCommand", "createMogrifyCommand", "createCompositeCommand", "createMontageCommand", "createIdentifyCommand", "createCompareCommand", "createPdfuniteCommand", "createPdfseparateCommand", "createPdffontsCommand", "createPdfdetachCommand", "createPdftocairoCommand", "createLibreofficeCommand", "createFormatInspectionCommand"]) {
  if (typeof commands[name] !== "function") throw new Error(`${name}: missing factory`);
}
