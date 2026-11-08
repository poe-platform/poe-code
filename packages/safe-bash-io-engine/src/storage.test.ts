import {it} from "node:test";
import {strictEqual} from "node:assert";
import {PagedStorage, IntegerTable} from "./storage.js";
import {PagedStorage as CanonicalStorage, IntegerTable as CanonicalTable} from "@poe-code/safe-fs/storage";

it("shares the filesystem-owned storage implementation and state", () => {
  strictEqual(PagedStorage, CanonicalStorage);
  strictEqual(IntegerTable, CanonicalTable);
});
