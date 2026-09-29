import { createSsconvertCommand, createSsconvertCommands, ssconvertCommands } from "@poe-platform/safe-bash/ssconvert/commands";
import { csvFormat } from "@poe-platform/safe-bash/ssconvert/formats/csv";
import { createMemoryFileSystem } from "@poe-platform/safe-fs/core";
import { verifySelectedSpreadsheet } from "./safe-packages-ssconvert-verify.mjs";

export const verification = verifySelectedSpreadsheet({
  createSsconvertCommand, createSsconvertCommands, ssconvertCommands, csvFormat, createMemoryFileSystem,
});
