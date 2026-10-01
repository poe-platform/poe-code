import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { fields } from "./display.js";
import { ColumnBudget } from "./internal.js";
import { settings } from "./options.js";

for (const first of ["a", "ä"]) {
  for (const separator of [new Set([":"]), undefined]) {
    const sep = separator ? ":" : " ";
    test(`column limit stops work at the remainder: ${first} ${sep}`, async () => {
      const budget = new ColumnBudget({ signal: new AbortController().signal, args: [] } as unknown as CommandContext, settings({ limits: { maxSteps: 3 } }));
      assert.deepEqual(await fields(`${first}${sep}b${sep}${"c".repeat(100)}`, separator, budget, 10, 2), [first, `b${sep}${"c".repeat(100)}`]);
    });
    for (const label of ["fields per row", "cells"]) {
      test(`${label} wins over work on long remainder: ${first} ${sep}`, async () => {
        const budget = new ColumnBudget({ signal: new AbortController().signal, args: [] } as unknown as CommandContext, settings({ limits: { maxSteps: 10, maxFields: label === "cells" ? 10 : 2 } }));
        await assert.rejects(async () => fields(`${first}${sep}b${sep}c${sep}${"d".repeat(100)}`, separator, budget, label === "cells" ? 2 : 10), { message: `EFBIG: column ${label} limit exceeded` });
      });
    }
  }
}
