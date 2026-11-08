import assert from "node:assert/strict";
import { test } from "node:test";
import { ByteInputBudget } from "./index.js";
import { toByteSource } from "safe-bash-contracts";
test("all source chunks share one admission budget", async () => { const budget = new ByteInputBudget(3); await assert.rejects(async () => { for await (const chunk of budget.read(toByteSource("four"), new AbortController().signal)) void chunk; }); });
