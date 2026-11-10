import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { mapfileExtension } from "../../src/shell/extensions/mapfile/index.js";

for (const extension of [false, true]) {
  for (const command of ["mapfile", "readarray"]) {
    for (const [redirect, descriptor, closed] of [
      ["exec 3>/dest", 3, false],
      ["exec 3>&1", 3, false],
      [":", 1, false],
      ["exec 3>/dest; exec 3>&-", 3, true],
      [":", 3, true],
    ] as const) {
      for (const preserve of [false, true]) test(`${command} distinguishes write-only and closed input: ${redirect}, fd=${descriptor}, preserve=${preserve}, extension=${extension}`, async () => {
        const { shell } = setup({ extensions: extension ? [mapfileExtension()] : [] });
        try {
          const result = await shell.exec(`${redirect}; A=(old); ${command} -t -u${descriptor} ${preserve ? "-O1" : ""} A; code=$?; read rest; args "$code" "\${A[@]}" "$rest"`, { stdin: "one\ntwo\nthree\n" });
          assert.equal(result.exitCode, 0);
          assert.equal(result.stdout, JSON.stringify([closed ? "1" : "0", ...(closed || preserve ? ["old"] : []), "one"]));
          if (closed) assert.ok(result.stderr.includes(`${descriptor}: invalid file descriptor: Bad file descriptor`));
          else assert.equal(result.stderr, "");
        } finally { await shell.dispose(); }
      });
    }
  }
}
