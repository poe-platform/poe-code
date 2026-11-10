import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { mapfileExtension } from "../../src/shell/extensions/mapfile/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";

for (const extension of [false, true]) {
  for (const command of ["mapfile", "readarray"]) {
    test(`${command} rejects invalid destinations before pulling input, extension=${extension}`, async () => {
      const { shell } = setup({ extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])] });
      let pulls = 0;
      const stdin = { async *[Symbol.asyncIterator]() { pulls++; yield new TextEncoder().encode("one\ntwo\nthree\n"); } };
      try {
        const result = await shell.exec(`${command} bad-name`, { stdin });
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, `shell: line 1: ${command}: \`bad-name': not a valid identifier\n`);
        assert.equal(pulls, 0);
      } finally { await shell.dispose(); }
    });

    test(`${command} leaves redirected input unread after an invalid destination, extension=${extension}`, async () => {
      const { shell, fs } = setup({ extensions: [arraysExtension(), ...(extension ? [mapfileExtension()] : [])] });
      try {
        await fs.writeFile("/data", new TextEncoder().encode("one\ntwo\nthree\n"));
        const result = await shell.exec(`exec 3</data; ${command} bad-name <&3; code=$?; pass <&3; exit "$code"`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "one\ntwo\nthree\n");
        assert.equal(result.stderr, `shell: line 1: ${command}: \`bad-name': not a valid identifier\n`);
      } finally { await shell.dispose(); }
    });
  }
}
