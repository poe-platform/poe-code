import assert from "node:assert/strict";
import test from "node:test";
import { SqliteDatabase } from "./engine.js";

test("upserts fire UPDATE triggers around each conflicting row with OLD and NEW values", () => {
  const db = new SqliteDatabase();
  db.exec(`
    CREATE TABLE stock (sku TEXT PRIMARY KEY, qty INTEGER);
    CREATE TABLE log (phase TEXT, sku TEXT, old_qty INTEGER, new_qty INTEGER, stored_qty INTEGER);
    CREATE TRIGGER before_update BEFORE UPDATE ON stock BEGIN
      INSERT INTO log SELECT 'before', OLD.sku, OLD.qty, NEW.qty, qty FROM stock WHERE sku = OLD.sku;
    END;
    CREATE TRIGGER after_update AFTER UPDATE ON stock BEGIN
      INSERT INTO log SELECT 'after', NEW.sku, OLD.qty, NEW.qty, qty FROM stock WHERE sku = NEW.sku;
    END;
    INSERT INTO stock VALUES ('A', 5);
    INSERT INTO stock VALUES ('A', 3), ('B', 4), ('A', 2)
      ON CONFLICT(sku) DO UPDATE SET qty = stock.qty + excluded.qty;
  `);
  assert.deepEqual(db.exec("SELECT * FROM log")[0]!.rows, [
    ["before", "A", 5, 8, 5],
    ["after", "A", 5, 8, 8],
    ["before", "A", 8, 10, 8],
    ["after", "A", 8, 10, 10]
  ]);
  assert.deepEqual(db.exec("SELECT * FROM stock ORDER BY sku")[0]!.rows, [["A", 10], ["B", 4]]);
  db.exec(`INSERT INTO stock VALUES ('A', 99) ON CONFLICT(sku) DO NOTHING;
    INSERT INTO stock VALUES ('A', 99) ON CONFLICT(sku) DO UPDATE SET qty = excluded.qty WHERE 0;`);
  assert.deepEqual(db.exec("SELECT COUNT(*) FROM log")[0]!.rows, [[4]]);
});


test("upsert triggers see the complete affinity-converted update", () => {
  const db = new SqliteDatabase();
  db.exec(`
    CREATE TABLE pairs (id INTEGER PRIMARY KEY, a INTEGER, b INTEGER);
    CREATE TABLE log (phase TEXT, old_a INTEGER, old_b INTEGER, new_a INTEGER, new_b INTEGER, kind TEXT);
    CREATE TRIGGER before_update BEFORE UPDATE ON pairs BEGIN
      INSERT INTO log VALUES ('before', OLD.a, OLD.b, NEW.a, NEW.b, typeof(NEW.a));
    END;
    CREATE TRIGGER after_update AFTER UPDATE ON pairs BEGIN
      INSERT INTO log VALUES ('after', OLD.a, OLD.b, NEW.a, NEW.b, typeof(NEW.a));
    END;
    INSERT INTO pairs VALUES (1, 2, 3);
    INSERT INTO pairs VALUES (1, 0, 0)
      ON CONFLICT(id) DO UPDATE SET a = '7', b = pairs.a;
  `);
  assert.deepEqual(db.exec("SELECT * FROM log")[0]!.rows, [
    ["before", 2, 3, 7, 2, "integer"],
    ["after", 2, 3, 7, 2, "integer"]
  ]);
  assert.deepEqual(db.exec("SELECT * FROM pairs")[0]!.rows, [[1, 7, 2]]);
});
