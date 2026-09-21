import assert from "node:assert/strict";
import { test } from "node:test";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../toolcraft-design/src/dashboard/layout.ts", import.meta.url);
const own = await import("../dist/index.js");
test("dashboard layout matches original across compact thresholds, clipping and numeric boundaries", () => {
  let seed = 271828;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let index = 0; index < 4096; index++) {
    const options = {
      totalWidth: (random() % 180) - 20.5,
      totalHeight: (random() % 60) - 5.5,
      rightPaneWidth: (random() % 50) - 4.5,
      footerHeight: (random() % 10) - 2.5,
      borderWidth: (random() % 8) - 1.5
    };
    assert.deepEqual(own.computeDashboardLayout(options), original.computeDashboardLayout(options));
  }
  for (const width of [
    0,
    1,
    2,
    20,
    40,
    65,
    66,
    67,
    68,
    80,
    120,
    -0,
    NaN,
    Infinity,
    -Infinity,
    2 ** 53
  ])
    for (const height of [0, 1, 2, 3, 4, 24, NaN, Infinity, -Infinity])
      assert.deepEqual(
        own.computeDashboardLayout({ totalWidth: width, totalHeight: height }),
        original.computeDashboardLayout({ totalWidth: width, totalHeight: height })
      );
});
test("layout host adapter preserves lazy property reads, coercion and original exceptions", () => {
  for (const api of [own, original]) {
    const effects = [];
    const input = Object.fromEntries(
      ["totalWidth", "totalHeight", "borderWidth", "footerHeight", "rightPaneWidth"].map(
        (key, index) => [
          key,
          {
            valueOf() {
              effects.push("coerce:" + key);
              return [80, 24, 1, 1, 25][index];
            }
          }
        ]
      )
    );
    const options = {};
    for (const key of Object.keys(input))
      Object.defineProperty(options, key, {
        get() {
          effects.push("read:" + key);
          return input[key];
        }
      });
    const result = api.computeDashboardLayout(options);
    assert.equal(result.leftPane.width, 52);
    assert.deepEqual(
      effects,
      Object.keys(input).flatMap((key) => ["read:" + key, "coerce:" + key])
    );
    const error = new Error("height read");
    assert.throws(
      () =>
        api.computeDashboardLayout({
          totalWidth: 80,
          get totalHeight() {
            throw error;
          }
        }),
      (thrown) => thrown === error
    );
    assert.throws(() => api.computeDashboardLayout({ totalWidth: 1n, totalHeight: 24 }), TypeError);
  }
  for (const value of [undefined, null, "12.5", true, false]) {
    const options = {
      totalWidth: 80,
      totalHeight: 24,
      borderWidth: value,
      footerHeight: value,
      rightPaneWidth: value
    };
    assert.deepEqual(own.computeDashboardLayout(options), original.computeDashboardLayout(options));
  }
});
