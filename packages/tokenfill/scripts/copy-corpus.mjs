import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const packageRootPath = join(scriptDirectoryPath, "..");
const sourceCorpusPath = join(packageRootPath, "src", "corpus");
const destinationCorpusPath = join(packageRootPath, "dist", "corpus");

cpSync(sourceCorpusPath, destinationCorpusPath, { force: true, recursive: true });
