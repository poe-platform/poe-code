import { expect, it } from "vitest";
import { besselJ } from "./bessel.js";

// Reference values from the platform libm j0/j1 functions.
it.each([
  [0, 1e-10, 1.0],
  [0, 1, 0.7651976865579666],
  [0, 5, -0.1775967713143383],
  [0, 15.99, -0.17398608798538684],
  [0, 16, -0.1748990739836292],
  [0, 20, 0.16702466434058313],
  [0, 100, 0.019985850304223122],
  [0, 1000000.0, 0.00033104301373987376],
  [0, 1e+20, 6.698009040703426e-12],
  [0, 1e+300, -7.860673062724093e-151],
  [1, 1e-10, 5e-11],
  [1, 1, 0.4400505857449335],
  [1, 5, -0.32757913759146523],
  [1, 15.99, 0.09219869600660562],
  [1, 16, 0.09039717566130417],
  [1, 20, 0.06683312417585002],
  [1, 100, -0.07714535201411217],
  [1, 1000000.0, -0.000725968356813763],
  [1, 1e+20, -7.95068198242545e-11],
  [1, 1e+300, -1.3681360450342481e-151],
 ] as const)("matches libm for order %i at %s", (order, x, expected) => {
  expect(Math.abs((besselJ(order, x) - expected) / expected)).toBeLessThan(1e-8);
  expect(besselJ(order, -x)).toBe(order === 0 ? besselJ(order, x) : -besselJ(order, x));
});

it("handles zero and non-finite arguments", () => {
  expect(besselJ(0, 0)).toBe(1);
  expect(besselJ(1, 0)).toBe(0);
  for (const order of [0, 1] as const) {
    expect(besselJ(order, Infinity)).toBe(0);
    expect(besselJ(order, -Infinity)).toBe(0);
    expect(besselJ(order, NaN)).toBeNaN();
  }
});
