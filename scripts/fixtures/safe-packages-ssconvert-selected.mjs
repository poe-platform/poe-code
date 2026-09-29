import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands } from "poe-code/ssconvert/commands";
import { csvFormat } from "poe-code/ssconvert/formats/csv";
import { createMemoryFileSystem } from "poe-code/safe-fs/core";
import { verifySelectedSpreadsheet } from "./safe-packages-ssconvert-verify.mjs";

export const verification = verifySelectedSpreadsheet({
  createSsconvertCommand, createSsconvertCommands, ssconvertCommands, csvFormat, createMemoryFileSystem,
});
