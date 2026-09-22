import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "@poe-code/csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw Error("unexpected inference"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: true, stdoutIsTTY: true, stderrIsTTY: true, columns: 80, lines: 24 }
};

const usage = "usage: csvpy [-h] [-d DELIMITER] [-t] [-q QUOTECHAR] [-u {0,1,2,3,4,5}] [-b]\n             [-p ESCAPECHAR] [-z FIELD_SIZE_LIMIT] [-e ENCODING] [-L LOCALE]\n             [-S] [--blanks] [--null-value NULL_VALUES [NULL_VALUES ...]]\n             [--date-format DATE_FORMAT] [--datetime-format DATETIME_FORMAT]\n             [--no-leading-zeroes] [-H] [-K SKIP_LINES] [-v] [-V] [--dict]\n             [--agate] [--no-number-ellipsis] [-y SNIFF_LIMIT] [-I]\n             [FILE]\n";

test("csvpy stress omitted shared options stay rejected before interpreter or file acquisition", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({ ...options, interpreter: {
    modes: ["reader", "dict", "agate"],
    async load() { assert.fail("invalid argv must not acquire an interpreter"); }
  } }));
  try {
    for (const argument of ["--linenumbers", "--zero", "--names", "--add-bom", "--out-delimiter", "--out-quotechar", "--out-quoting", "--out-no-doublequote", "--out-escapechar", "--out-lineterminator"]) {
      const result = await shell.exec(`csvpy ${argument} /missing.csv`);
      assert.deepEqual({ status: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
        status: 2, stdout: "", stderr: usage + `csvpy: error: unrecognized arguments: ${argument}\n`
      });
    }
  } finally { await shell.dispose(); }
});
