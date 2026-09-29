import {
  createLazyCommandLoader,
  createLazyCommands,
  lazyCommandPlugin
} from "./plugins/lazy-command.js";
import { CommandRegistry, type CommandDefinition } from "./contracts/command.js";
import type { VirtualShellPlugin } from "./contracts/plugin.js";

// Static metadata keeps registration and discovery independent of engine evaluation.

type ffmpegModule = typeof import("./commands/ffmpeg/index.js");
const loadffmpeg = createLazyCommandLoader(() => import("./commands/ffmpeg/index.js"));
const ffmpegMetadata = [
  {
    name: "ffmpeg",
    description: "Multimedia converter, merger, and stream processor powered by pluggable ASTs"
  },
  {
    name: "ffprobe",
    description: "Multimedia stream analyzer powered by pluggable ASTs"
  }
] as const;
export const createFfmpegCommand: ffmpegModule["createFfmpegCommand"] = (...args) => {
  const metadata = ffmpegMetadata.find((item) => item.name === "ffmpeg");
  if (!metadata) throw new TypeError("Unknown ffmpeg command");
  return createLazyCommands([metadata], async () => {
    const module = await loadffmpeg();
    return () => [module.createFfmpegCommand(...args)];
  })[0]!;
};
export const createFfprobeCommand: ffmpegModule["createFfprobeCommand"] = (...args) => {
  const metadata = ffmpegMetadata.find((item) => item.name === "ffprobe");
  if (!metadata) throw new TypeError("Unknown ffmpeg command");
  return createLazyCommands([metadata], async () => {
    const module = await loadffmpeg();
    return () => [module.createFfprobeCommand(...args)];
  })[0]!;
};
export const createFfmpegCommands: ffmpegModule["createFfmpegCommands"] = (...args) => {
  const definitions = createLazyCommands(ffmpegMetadata, async () => {
    const module = await loadffmpeg();
    return () => module.createFfmpegCommands(...args);
  });
  return Object.freeze(
    Object.assign([definitions[0]!, definitions[1]!] as const, {
      ffmpeg: definitions[0]!,
      ffprobe: definitions[1]!
    })
  );
};
export const ffmpegCommands: ffmpegModule["ffmpegCommands"] = (options = {}) =>
  lazyCommandPlugin("ffmpeg-commands", createFfmpegCommands(options), options.replace ?? false);
export type { FfmpegCommandsOptions } from "./commands/ffmpeg/index.js";
export type { FfmpegCommandPair } from "./commands/ffmpeg/index.js";

type gitModule = typeof import("./commands/git/index.js");
const loadgit = createLazyCommandLoader(() => import("./commands/git/index.js"));
const gitMetadata = [
  {
    name: "git",
    description: "Git repositories in the virtual filesystem"
  }
] as const;
export const gitCommands: gitModule["gitCommands"] = (options = {}) =>
  lazyCommandPlugin("git-commands", createGitCommands(options), options.replace ?? false);
export const createGitCommands: gitModule["createGitCommands"] = (...args) => {
  const definitions = createLazyCommands(gitMetadata, async () => {
    const module = await loadgit();
    return () => module.createGitCommands(...args);
  });
  return definitions;
};
export const createGitCommand: gitModule["createGitCommand"] = (...args) => {
  const metadata = gitMetadata.find((item) => item.name === "git");
  if (!metadata) throw new TypeError("Unknown git command");
  return createLazyCommands([metadata], async () => {
    const module = await loadgit();
    return () => [module.createGitCommand(...args)];
  })[0]!;
};
export type { GitCommandsOptions } from "./commands/git/index.js";

type sofficeModule = typeof import("./commands/soffice/index.js");
const loadsoffice = createLazyCommandLoader(() => import("./commands/soffice/index.js"));
const sofficeMetadata = [
  {
    name: "soffice",
    description:
      "Headless document/spreadsheet/presentation to PDF and CSV converter via @poe-code/pdf-ast"
  },
  {
    name: "libreoffice",
    description:
      "Headless LibreOffice document/spreadsheet/presentation to PDF converter via @poe-code/pdf-ast"
  }
] as const;
export const createSofficeCommand: sofficeModule["createSofficeCommand"] = (...args) => {
  const metadata = sofficeMetadata.find((item) => item.name === "soffice");
  if (!metadata) throw new TypeError("Unknown soffice command");
  return createLazyCommands([metadata], async () => {
    const module = await loadsoffice();
    return () => [module.createSofficeCommand(...args)];
  })[0]!;
};
export const sofficeCommands: sofficeModule["sofficeCommands"] = (options = {}) =>
  lazyCommandPlugin("soffice", createSofficeCommands(options), options.replace ?? false);
export type { SofficeCommandOptions } from "./commands/soffice/index.js";
export const createSofficeCommands: sofficeModule["createSofficeCommands"] = (...args) => {
  const definitions = createLazyCommands(sofficeMetadata, async () => {
    const module = await loadsoffice();
    return () => module.createSofficeCommands(...args);
  });
  return definitions;
};
export type { SofficeCommandsOptions } from "./commands/soffice/index.js";

type pandocModule = typeof import("./commands/pandoc/implementation.js");
const loadpandoc = createLazyCommandLoader(() => import("./commands/pandoc/implementation.js"));
const pandocMetadata = [
  {
    name: "pandoc",
    description: "Convert documents with the original bounded TypeScript SDK"
  }
] as const;
export const pandocCommands: pandocModule["pandocCommands"] = (options = {}) => {
  let hasCommand: ((name: string) => boolean) | undefined;
  const command = createPandocCommand(options, (name) => hasCommand?.(name) ?? false);
  return {
    name: "pandoc",
    setup(host) {
      hasCommand = (name) => host.commands.has(name);
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
};
export const createPandocCommands: pandocModule["createPandocCommands"] = (...args) => {
  const definitions = createLazyCommands(pandocMetadata, async () => {
    const module = await loadpandoc();
    return () => module.createPandocCommands(...args);
  });
  return definitions;
};
export const createPandocCommand: pandocModule["createPandocCommand"] = (...args) => {
  const metadata = pandocMetadata.find((item) => item.name === "pandoc");
  if (!metadata) throw new TypeError("Unknown pandoc command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpandoc();
    return () => [module.createPandocCommand(...args)];
  })[0]!;
};
export type { PandocCommandsOptions } from "./commands/pandoc/implementation.js";
export type { PandocLimits } from "./commands/pandoc/implementation.js";

type ssconvertModule = typeof import("./commands/ssconvert/index.js");
const loadssconvert = createLazyCommandLoader(() => import("safe-bash-command-ssconvert"));
const loadSelectedSsconvert = createLazyCommandLoader(
  () => import("safe-bash-command-ssconvert/commands")
);
const ssconvertMetadata = [
  {
    name: "ssconvert",
    description: "Explicitly bound TypeScript spreadsheet conversion engine"
  }
] as const;
export const createSsconvertCommand: ssconvertModule["createSsconvertCommand"] = (...args) => {
  const metadata = ssconvertMetadata.find((item) => item.name === "ssconvert");
  if (!metadata) throw new TypeError("Unknown ssconvert command");
  return createLazyCommands([metadata], async () => {
    const module = await (args[0]?.formats === undefined
      ? loadssconvert()
      : loadSelectedSsconvert());
    return () => [module.createSsconvertCommand(...args)];
  })[0]!;
};
export const ssconvertCommands: ssconvertModule["ssconvertCommands"] = (options = {}) =>
  lazyCommandPlugin(
    "ssconvert-commands",
    createSsconvertCommands(options),
    options.replace ?? false
  );
export type { SsconvertCommandsOptions } from "./commands/ssconvert/index.js";
export type { SsconvertLimits } from "./commands/ssconvert/index.js";
export const createSsconvertCommands: ssconvertModule["createSsconvertCommands"] = (...args) => {
  const definitions = createLazyCommands(ssconvertMetadata, async () => {
    const module = await (args[0]?.formats === undefined
      ? loadssconvert()
      : loadSelectedSsconvert());
    return () => module.createSsconvertCommands(...args);
  });
  return definitions;
};

type pdfinfoModule = typeof import("./commands/pdfinfo/index.js");
const loadpdfinfo = createLazyCommandLoader(() => import("./commands/pdfinfo/index.js"));
const pdfinfoMetadata = [
  {
    name: "pdfinfo",
    description: "Extract PDF metadata, page boxes, encryption, and structure via @poe-code/pdf-ast"
  },
  {
    name: "pdfunite",
    description: "Merge multiple PDF documents into a single PDF via @poe-code/pdf-ast"
  },
  {
    name: "pdfseparate",
    description: "Split PDF pages into individual PDF files via @poe-code/pdf-ast"
  },
  {
    name: "pdffonts",
    description: "List fonts used in a PDF document via @poe-code/pdf-ast"
  },
  {
    name: "pdfdetach",
    description:
      "List and extract embedded file attachments from PDF documents via @poe-code/pdf-ast"
  }
] as const;
export const createPdfinfoCommand: pdfinfoModule["createPdfinfoCommand"] = (...args) => {
  const metadata = pdfinfoMetadata.find((item) => item.name === "pdfinfo");
  if (!metadata) throw new TypeError("Unknown pdfinfo command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpdfinfo();
    return () => [module.createPdfinfoCommand(...args)];
  })[0]!;
};
export const pdfinfoCommands: pdfinfoModule["pdfinfoCommands"] = (options = {}) =>
  lazyCommandPlugin("pdfinfo", createPdfinfoCommands(options), options.replace ?? false);
export type { PdfinfoCommandOptions } from "./commands/pdfinfo/index.js";
export const createPdfinfoCommands: pdfinfoModule["createPdfinfoCommands"] = (...args) => {
  const definitions = createLazyCommands(pdfinfoMetadata, async () => {
    const module = await loadpdfinfo();
    return () => module.createPdfinfoCommands(...args);
  });
  return definitions;
};
export type { PdfinfoCommandsOptions } from "./commands/pdfinfo/index.js";

type pdftotextModule = typeof import("./commands/pdftotext/index.js");
const loadpdftotext = createLazyCommandLoader(() => import("./commands/pdftotext/index.js"));
const pdftotextMetadata = [
  {
    name: "pdftotext",
    description: "Extract PDF text, layout, XHTML bounding boxes, and TSV via @poe-code/pdf-ast"
  },
  {
    name: "pdftohtml",
    description: "Convert PDF pages into HTML or XML layout documents via @poe-code/pdf-ast"
  }
] as const;
export const createPdftotextCommand: pdftotextModule["createPdftotextCommand"] = (...args) => {
  const metadata = pdftotextMetadata.find((item) => item.name === "pdftotext");
  if (!metadata) throw new TypeError("Unknown pdftotext command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpdftotext();
    return () => [module.createPdftotextCommand(...args)];
  })[0]!;
};
export const pdftotextCommands: pdftotextModule["pdftotextCommands"] = (options = {}) =>
  lazyCommandPlugin(
    "pdftotext",
    createPdftotextCommands(options),
    options.replace ?? false
  );
export type { PdftotextCommandOptions } from "./commands/pdftotext/index.js";
export const createPdftotextCommands: pdftotextModule["createPdftotextCommands"] = (...args) => {
  const definitions = createLazyCommands(pdftotextMetadata, async () => {
    const module = await loadpdftotext();
    return () => module.createPdftotextCommands(...args);
  });
  return definitions;
};
export type { PdftotextCommandsOptions } from "./commands/pdftotext/index.js";

type pdfimagesModule = typeof import("./commands/pdfimages/index.js");
const loadpdfimages = createLazyCommandLoader(() => import("./commands/pdfimages/index.js"));
const pdfimagesMetadata = [
  {
    name: "pdfimages",
    description: "List and extract embedded images from PDF pages via @poe-code/pdf-ast"
  }
] as const;
export const createPdfimagesCommand: pdfimagesModule["createPdfimagesCommand"] = (...args) => {
  const metadata = pdfimagesMetadata.find((item) => item.name === "pdfimages");
  if (!metadata) throw new TypeError("Unknown pdfimages command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpdfimages();
    return () => [module.createPdfimagesCommand(...args)];
  })[0]!;
};
export const pdfimagesCommands: pdfimagesModule["pdfimagesCommands"] = (options = {}) =>
  lazyCommandPlugin(
    "pdfimages",
    createPdfimagesCommands(options),
    options.replace ?? false
  );
export type { PdfimagesCommandOptions } from "./commands/pdfimages/index.js";
export const createPdfimagesCommands: pdfimagesModule["createPdfimagesCommands"] = (...args) => {
  const definitions = createLazyCommands(pdfimagesMetadata, async () => {
    const module = await loadpdfimages();
    return () => module.createPdfimagesCommands(...args);
  });
  return definitions;
};
export type { PdfimagesCommandsOptions } from "./commands/pdfimages/index.js";

type pdftoppmModule = typeof import("./commands/pdftoppm/index.js");
const loadpdftoppm = createLazyCommandLoader(() => import("./commands/pdftoppm/index.js"));
const pdftoppmMetadata = [
  {
    name: "pdftoppm",
    description: "Render PDF pages to PNG, PPM, PGM, PBM, or SVG via @poe-code/pdf-ast"
  },
  {
    name: "pdftocairo",
    description: "Render PDF pages to PNG, JPEG, TIFF, PDF, PS, EPS, or SVG via @poe-code/pdf-ast"
  }
] as const;
export const createPdftoppmCommand: pdftoppmModule["createPdftoppmCommand"] = (...args) => {
  const metadata = pdftoppmMetadata.find((item) => item.name === "pdftoppm");
  if (!metadata) throw new TypeError("Unknown pdftoppm command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpdftoppm();
    return () => [module.createPdftoppmCommand(...args)];
  })[0]!;
};
export const pdftoppmCommands: pdftoppmModule["pdftoppmCommands"] = (options = {}) =>
  lazyCommandPlugin("pdftoppm", createPdftoppmCommands(options), options.replace ?? false);
export type { PdftoppmCommandOptions } from "./commands/pdftoppm/index.js";
export const createPdftoppmCommands: pdftoppmModule["createPdftoppmCommands"] = (...args) => {
  const definitions = createLazyCommands(pdftoppmMetadata, async () => {
    const module = await loadpdftoppm();
    return () => module.createPdftoppmCommands(...args);
  });
  return definitions;
};
export type { PdftoppmCommandsOptions } from "./commands/pdftoppm/index.js";

type pdftkModule = typeof import("./commands/pdftk/index.js");
const loadpdftk = createLazyCommandLoader(() => import("./commands/pdftk/index.js"));
const pdftkMetadata = [
  {
    name: "pdftk",
    description:
      "Manipulate PDF documents, fill/flatten AcroForms, and assemble pages via @poe-code/pdf-ast"
  }
] as const;
export const createPdftkCommand: pdftkModule["createPdftkCommand"] = (...args) => {
  const metadata = pdftkMetadata.find((item) => item.name === "pdftk");
  if (!metadata) throw new TypeError("Unknown pdftk command");
  return createLazyCommands([metadata], async () => {
    const module = await loadpdftk();
    return () => [module.createPdftkCommand(...args)];
  })[0]!;
};
export const pdftkCommands: pdftkModule["pdftkCommands"] = (options = {}) =>
  lazyCommandPlugin("pdftk", createPdftkCommands(options), options.replace ?? false);
export type { PdftkCommandOptions } from "./commands/pdftk/index.js";
export const createPdftkCommands: pdftkModule["createPdftkCommands"] = (...args) => {
  const definitions = createLazyCommands(pdftkMetadata, async () => {
    const module = await loadpdftk();
    return () => module.createPdftkCommands(...args);
  });
  return definitions;
};
export type { PdftkCommandsOptions } from "./commands/pdftk/index.js";

type qpdfModule = typeof import("./commands/qpdf/index.js");
const loadqpdf = createLazyCommandLoader(() => import("./commands/qpdf/index.js"));
const qpdfMetadata = [
  {
    name: "qpdf",
    description:
      "Structural PDF inspection, encryption, page selection, and transformation via @poe-code/pdf-ast"
  }
] as const;
export const createQpdfCommand: qpdfModule["createQpdfCommand"] = (...args) => {
  const metadata = qpdfMetadata.find((item) => item.name === "qpdf");
  if (!metadata) throw new TypeError("Unknown qpdf command");
  return createLazyCommands([metadata], async () => {
    const module = await loadqpdf();
    return () => [module.createQpdfCommand(...args)];
  })[0]!;
};
export const qpdfCommands: qpdfModule["qpdfCommands"] = (options = {}) =>
  lazyCommandPlugin("qpdf", createQpdfCommands(options), options.replace ?? false);
export type { QpdfCommandOptions } from "./commands/qpdf/index.js";
export const createQpdfCommands: qpdfModule["createQpdfCommands"] = (...args) => {
  const definitions = createLazyCommands(qpdfMetadata, async () => {
    const module = await loadqpdf();
    return () => module.createQpdfCommands(...args);
  });
  return definitions;
};
export type { QpdfCommandsOptions } from "./commands/qpdf/index.js";

type sipsModule = typeof import("./commands/sips/index.js");
const loadsips = createLazyCommandLoader(() => import("./commands/sips/index.js"));
const sipsMetadata = [
  {
    name: "sips",
    description: "Scriptable image processing system powered by @poe-code/image-ast"
  }
] as const;
export const createSipsCommand: sipsModule["createSipsCommand"] = (...args) => {
  const metadata = sipsMetadata.find((item) => item.name === "sips");
  if (!metadata) throw new TypeError("Unknown sips command");
  return createLazyCommands([metadata], async () => {
    const module = await loadsips();
    return () => [module.createSipsCommand(...args)];
  })[0]!;
};
export const sipsCommands: sipsModule["sipsCommands"] = (options = {}) =>
  lazyCommandPlugin("sips", createSipsCommands(options), options.replace ?? false);
export type { SipsCommandOptions } from "./commands/sips/index.js";
export const createSipsCommands: sipsModule["createSipsCommands"] = (...args) => {
  const definitions = createLazyCommands(sipsMetadata, async () => {
    const module = await loadsips();
    return () => module.createSipsCommands(...args);
  });
  return definitions;
};
export type { SipsCommandsOptions } from "./commands/sips/index.js";

type imagemagickModule = typeof import("./commands/imagemagick/index.js");
const loadimagemagick = createLazyCommandLoader(() => import("./commands/imagemagick/index.js"));
const imagemagickMetadata = [
  {
    name: "magick",
    description: "ImageMagick v7 image processor powered by @poe-code/image-ast"
  },
  {
    name: "convert",
    description: "ImageMagick convert pipeline powered by @poe-code/image-ast"
  },
  {
    name: "mogrify",
    description: "ImageMagick in-place batch image processor powered by @poe-code/image-ast"
  },
  {
    name: "composite",
    description: "ImageMagick overlay composition tool powered by @poe-code/image-ast"
  },
  {
    name: "montage",
    description: "ImageMagick contact-sheet grid generator powered by @poe-code/image-ast"
  },
  {
    name: "identify",
    description: "ImageMagick image metadata inspector powered by @poe-code/image-ast"
  },
  {
    name: "compare",
    description: "ImageMagick image comparison and diff generator powered by @poe-code/image-ast"
  }
] as const;
export const createMagickCommand: imagemagickModule["createMagickCommand"] = (...args) => {
  const metadata = imagemagickMetadata.find((item) => item.name === "magick");
  if (!metadata) throw new TypeError("Unknown imagemagick command");
  return createLazyCommands([metadata], async () => {
    const module = await loadimagemagick();
    return () => [module.createMagickCommand(...args)];
  })[0]!;
};
export const imagemagickCommands: imagemagickModule["imagemagickCommands"] = (options = {}) =>
  lazyCommandPlugin(
    "imagemagick",
    createImagemagickCommands(options),
    options.replace ?? false
  );
export type { ImageMagickCommandOptions } from "./commands/imagemagick/index.js";
export const createImagemagickCommands: imagemagickModule["createImagemagickCommands"] = (
  ...args
) => {
  const definitions = createLazyCommands(imagemagickMetadata, async () => {
    const module = await loadimagemagick();
    return () => module.createImagemagickCommands(...args);
  });
  return definitions;
};
export const createImagemagickCommand: imagemagickModule["createImagemagickCommand"] = (
  ...args
) => {
  const metadata = imagemagickMetadata.find((item) => item.name === "magick");
  if (!metadata) throw new TypeError("Unknown imagemagick command");
  return createLazyCommands([metadata], async () => {
    const module = await loadimagemagick();
    return () => [module.createImagemagickCommand(...args)];
  })[0]!;
};
export type { ImagemagickCommandsOptions } from "./commands/imagemagick/index.js";

type wkhtmltopdfModule = typeof import("./commands/wkhtmltopdf/index.js");
const loadwkhtmltopdf = createLazyCommandLoader(() => import("./commands/wkhtmltopdf/index.js"));
const wkhtmltopdfMetadata = [
  {
    name: "wkhtmltopdf",
    description: "Bounded static HTML-to-PDF adapter with a built-in PDF AST renderer"
  }
] as const;
export const createWkhtmltopdfCommand: wkhtmltopdfModule["createWkhtmltopdfCommand"] = (
  ...args
) => {
  const metadata = wkhtmltopdfMetadata.find((item) => item.name === "wkhtmltopdf");
  if (!metadata) throw new TypeError("Unknown wkhtmltopdf command");
  return createLazyCommands([metadata], async () => {
    const module = await loadwkhtmltopdf();
    return () => [module.createWkhtmltopdfCommand(...args)];
  })[0]!;
};
export const wkhtmltopdfCommands: wkhtmltopdfModule["wkhtmltopdfCommands"] = (options = {}) =>
  lazyCommandPlugin(
    "wkhtmltopdf",
    createWkhtmltopdfCommands(options),
    options.replace ?? false
  );
export type { WkhtmltopdfCommandOptions } from "./commands/wkhtmltopdf/index.js";
export const createWkhtmltopdfCommands: wkhtmltopdfModule["createWkhtmltopdfCommands"] = (
  ...args
) => {
  const definitions = createLazyCommands(wkhtmltopdfMetadata, async () => {
    const module = await loadwkhtmltopdf();
    return () => module.createWkhtmltopdfCommands(...args);
  });
  return definitions;
};
export type { WkhtmltopdfCommandsOptions } from "./commands/wkhtmltopdf/index.js";

type csvkitModule = typeof import("./commands/csvkit/index.js");
const loadcsvkit = createLazyCommandLoader(() => import("./commands/csvkit/index.js"));
const csvkitMetadata = [
  {
    name: "csvclean",
    description: "csvkit 2.2.0 csvclean; compatibility gaps return status 78"
  },
  {
    name: "csvcut",
    description: "csvkit 2.2.0 csvcut; compatibility gaps return status 78",
    fallback: true
  },
  {
    name: "csvformat",
    description: "csvkit 2.2.0 csvformat; compatibility gaps return status 78"
  },
  {
    name: "csvgrep",
    description: "csvkit 2.2.0 csvgrep; compatibility gaps return status 78",
    fallback: true
  },
  {
    name: "csvjoin",
    description: "csvkit 2.2.0 csvjoin; compatibility gaps return status 78"
  },
  {
    name: "csvjson",
    description: "csvkit 2.2.0 csvjson; compatibility gaps return status 78"
  },
  {
    name: "csvlook",
    description: "csvkit 2.2.0 csvlook; compatibility gaps return status 78"
  },
  {
    name: "csvpy",
    description: "csvkit 2.2.0 csvpy; compatibility gaps return status 78"
  },
  {
    name: "csvsort",
    description: "csvkit 2.2.0 csvsort; compatibility gaps return status 78"
  },
  {
    name: "csvsql",
    description: "csvkit 2.2.0 csvsql; compatibility gaps return status 78"
  },
  {
    name: "csvstack",
    description: "csvkit 2.2.0 csvstack; compatibility gaps return status 78"
  },
  {
    name: "csvstat",
    description: "csvkit 2.2.0 csvstat; compatibility gaps return status 78"
  },
  {
    name: "in2csv",
    description: "csvkit 2.2.0 in2csv; compatibility gaps return status 78"
  },
  {
    name: "sql2csv",
    description: "csvkit 2.2.0 sql2csv; compatibility gaps return status 78"
  }
] as const;
export const csvkitCommands: csvkitModule["csvkitCommands"] = (options = {}) =>
  lazyCommandPlugin("csvkit-commands", createCsvkitCommands(options), options.replace ?? false);
export const createCsvkitCommands: csvkitModule["createCsvkitCommands"] = (...args) => {
  const definitions = createLazyCommands(csvkitMetadata, async () => {
    const module = await loadcsvkit();
    return () => module.createCsvkitCommands(...args);
  });
  return definitions;
};
export const createCsvkitCommand: csvkitModule["createCsvkitCommand"] = (...args) => {
  const metadata = csvkitMetadata.find((item) => item.name === (args[0]?.name ?? "csvclean"));
  if (!metadata) throw new TypeError("Unknown csvkit command");
  return createLazyCommands([metadata], async () => {
    const module = await loadcsvkit();
    return () => [module.createCsvkitCommand(...args)];
  })[0]!;
};
export type { CsvkitCommandsOptions } from "./commands/csvkit/index.js";

type ghModule = typeof import("./commands/gh/index.js");
const loadgh = createLazyCommandLoader(() => import("./commands/gh/index.js"));
const ghMetadata = [
  { name: "gh", description: "Work seamlessly with GitHub from the command line" }
] as const;
export const createGhCommand: ghModule["createGhCommand"] = (...args) =>
  createLazyCommands(ghMetadata, async () => {
    const module = await loadgh();
    return () => [module.createGhCommand(...args)];
  })[0]!;
export const createGhCommands: ghModule["createGhCommands"] = (...args) =>
  createLazyCommands(ghMetadata, async () => {
    const module = await loadgh();
    return () => module.createGhCommands(...args);
  });
export const ghCommands: ghModule["ghCommands"] = (options = {}) =>
  lazyCommandPlugin("gh-commands", createGhCommands(options), options.replace ?? false);
export type { GhCommandOptions, GhCommandsOptions, GhLimits } from "./commands/gh/index.js";

/** Extension contract for trusted, statically bundled command code. */
export {
  createLazyCommandLoader,
  createLazyCommands,
  lazyCommandPlugin
} from "./plugins/lazy-command.js";
export type { LazyCommandMetadata, LazyCommandFactory } from "./plugins/lazy-command.js";

export interface OptionalCommandConfiguration {
  readonly gh?: Parameters<ghModule["createGhCommands"]>[0];
  readonly ffmpeg?: Parameters<ffmpegModule["createFfmpegCommands"]>[0];
  readonly git?: Parameters<gitModule["createGitCommands"]>[0];
  readonly soffice?: Parameters<sofficeModule["createSofficeCommands"]>[0];
  readonly pandoc?: Parameters<pandocModule["createPandocCommands"]>[0];
  readonly ssconvert?: Parameters<ssconvertModule["createSsconvertCommands"]>[0];
  readonly pdfinfo?: Parameters<pdfinfoModule["createPdfinfoCommands"]>[0];
  readonly pdftotext?: Parameters<pdftotextModule["createPdftotextCommands"]>[0];
  readonly pdfimages?: Parameters<pdfimagesModule["createPdfimagesCommands"]>[0];
  readonly pdftoppm?: Parameters<pdftoppmModule["createPdftoppmCommands"]>[0];
  readonly pdftk?: Parameters<pdftkModule["createPdftkCommands"]>[0];
  readonly qpdf?: Parameters<qpdfModule["createQpdfCommands"]>[0];
  readonly sips?: Parameters<sipsModule["createSipsCommands"]>[0];
  readonly imagemagick?: Parameters<imagemagickModule["createImagemagickCommands"]>[0];
  readonly wkhtmltopdf?: Parameters<wkhtmltopdfModule["createWkhtmltopdfCommands"]>[0];
  readonly csvkit?: Parameters<csvkitModule["createCsvkitCommands"]>[0];
}

export interface OptionalCommandsOptions {
  readonly profile?: "full";
  readonly families?: readonly OptionalCommandFamily[];
  readonly commands?: readonly string[];
  readonly configuration?: OptionalCommandConfiguration;
  readonly replace?: boolean;
}

const optionalFamilies = {
  ffmpeg: {
    metadata: ffmpegMetadata,
    create: (options: OptionalCommandConfiguration) => createFfmpegCommands(options.ffmpeg)
  },
  git: {
    metadata: gitMetadata,
    create: (options: OptionalCommandConfiguration) => createGitCommands(options.git)
  },
  soffice: {
    metadata: sofficeMetadata,
    create: (options: OptionalCommandConfiguration) => createSofficeCommands(options.soffice)
  },
  pandoc: {
    metadata: pandocMetadata,
    create: (options: OptionalCommandConfiguration) => createPandocCommands(options.pandoc)
  },
  ssconvert: {
    metadata: ssconvertMetadata,
    create: (options: OptionalCommandConfiguration) => createSsconvertCommands(options.ssconvert)
  },
  pdfinfo: {
    metadata: pdfinfoMetadata,
    create: (options: OptionalCommandConfiguration) => createPdfinfoCommands(options.pdfinfo)
  },
  pdftotext: {
    metadata: pdftotextMetadata,
    create: (options: OptionalCommandConfiguration) => createPdftotextCommands(options.pdftotext)
  },
  pdfimages: {
    metadata: pdfimagesMetadata,
    create: (options: OptionalCommandConfiguration) => createPdfimagesCommands(options.pdfimages)
  },
  pdftoppm: {
    metadata: pdftoppmMetadata,
    create: (options: OptionalCommandConfiguration) => createPdftoppmCommands(options.pdftoppm)
  },
  pdftk: {
    metadata: pdftkMetadata,
    create: (options: OptionalCommandConfiguration) => createPdftkCommands(options.pdftk)
  },
  qpdf: {
    metadata: qpdfMetadata,
    create: (options: OptionalCommandConfiguration) => createQpdfCommands(options.qpdf)
  },
  sips: {
    metadata: sipsMetadata,
    create: (options: OptionalCommandConfiguration) => createSipsCommands(options.sips)
  },
  imagemagick: {
    metadata: imagemagickMetadata,
    create: (options: OptionalCommandConfiguration) =>
      createImagemagickCommands(options.imagemagick)
  },
  wkhtmltopdf: {
    metadata: wkhtmltopdfMetadata,
    create: (options: OptionalCommandConfiguration) =>
      createWkhtmltopdfCommands(options.wkhtmltopdf)
  },
  csvkit: {
    metadata: csvkitMetadata,
    create: (options: OptionalCommandConfiguration) => createCsvkitCommands(options.csvkit)
  },
  gh: {
    metadata: ghMetadata,
    create: (options: OptionalCommandConfiguration) => createGhCommands(options.gh)
  }
} as const;
export type OptionalCommandFamily = keyof typeof optionalFamilies;

export const optionalCommandCatalog = Object.freeze(
  Object.entries(optionalFamilies).flatMap(([family, entry]) =>
    entry.metadata.map((metadata) =>
      Object.freeze({ family: family as OptionalCommandFamily, ...metadata })
    )
  )
);

export function createOptionalCommands(
  options: OptionalCommandsOptions = {}
): readonly CommandDefinition[] {
  const names = new Set(options.commands ?? []);
  for (const name of names)
    if (!optionalCommandCatalog.some((metadata) => metadata.name === name)) {
      throw new TypeError(`Unknown optional command: ${name}`);
    }
  const families = new Set(options.families ?? []);
  for (const family of families)
    if (!Object.hasOwn(optionalFamilies, family)) {
      throw new TypeError(`Unknown optional command family: ${family}`);
    }
  const definitions: CommandDefinition[] = [];
  for (const [family, entry] of Object.entries(optionalFamilies)) {
    const fullFamily = options.profile === "full" || families.has(family as OptionalCommandFamily);
    if (!fullFamily && !entry.metadata.some((metadata) => names.has(metadata.name))) continue;
    definitions.push(
      ...entry
        .create(options.configuration ?? {})
        .filter((command) => fullFamily || names.has(command.name))
    );
  }
  return new CommandRegistry(definitions).list();
}

export function optionalCommands(options: OptionalCommandsOptions = {}): VirtualShellPlugin {
  return lazyCommandPlugin(
    "optional-commands",
    createOptionalCommands(options),
    options.replace ?? false
  );
}
