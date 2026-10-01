import {expect, it} from "vitest";
import {createDefaultSqliteDatabaseProvider} from "./default-sqlite.js";

it("bounds SQLite VM work and closes failed sessions", async () => {
  const provider = createDefaultSqliteDatabaseProvider({now: () => 0}, {maxWork: 100});
  const signal = new AbortController().signal;
  const session = await provider.connect("sqlite://", {}, signal);
  try {
    await expect((async () => {
      const result = await session.query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT sum(x) FROM n", [], {}, signal);
      try {for await (const row of result.rows) void row;} finally {await result.close();}
    })()).rejects.toThrow("SQLite VM work budget exceeded");
  } finally {await session.close(); await session.close();}
});
it("does not acquire ambient database files and respects pre-acquisition cancellation", async () => {
  const provider = createDefaultSqliteDatabaseProvider({now: () => 0});
  await expect(provider.connect("sqlite:////private.db", {}, new AbortController().signal)).rejects.toThrow("SQLite file VFS is not bound");
  const reason = new Error("cancelled before acquisition");
  await expect(provider.connect("sqlite://", {}, AbortSignal.abort(reason))).rejects.toBe(reason);
});
