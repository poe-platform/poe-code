import { expect, it } from "vitest";
import { recalculateWorkbook } from "./evaluator.js";
import type { CapabilityContext } from "../contracts.js";

const context: CapabilityContext = { signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 2, operations: 100, workbookWork: 100000 }, own() {} };
it.each<[string, number | string]>([
  ['=BESSELJ(1,-1)', -.4400505857449335], ['=BESSELJ(1,-.5)', .4310988680183761],
  ['=BESSELY(1,-1)', .7812128213002887], ['=BESSELY(1,-.5)', .6713967071418031],
  ['=BESSELY(-1,1)', .7812128213002887], ['=BESSELY(-1,0)', .08825696421567698],
  ['=BESSELI(1,-1)', .565159103992485], ['=BESSELI(1,-.5)', 1.2312002145929675],
  ['=BESSELI(0,-1)', 0], ['=BESSELK(1,-1)', .6019072301972346],
  ['=BESSELK(1,-.5)', .4610685044478946], ['=BESSELI(710,0)', '#NUM!'],
  ['=BESSELK(710,0)', 0], ['=ERF(1,1.0000000000000002)', 6.517571512431702e-17],
  ['=BESSELJ(1000,0)', .024786686152420172], ['=BESSELJ(1e8,0)', 3.206029534041208e-5],
  ['=BESSELY(1000,0)', .0047159179776228135], ['=BESSELY(1e8,0)', 7.306391165521707e-5],
  ['=BESSELJ(12,0)', .047689310796833605], ['=BESSELJ(12.000000000000002,0)', .04768931079683398],
  ['=BESSELY(1,100)', -3.775287810110526e185], ['=BESSELK(1,100)', 5.900333183638617e185],
  ['=BESSELJ(10,100)', 6.597316064155384e-89],
  ['=BESSELY(10,2)', -.005868082442208625],
])("special numerical independent regression %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
  if (typeof expected === "string") expect(result).toEqual({ kind: "error", value: expected });
  else {
    expect(result.kind).toBe("number");
    if (result.kind === "number") {
      if (expected === 0) expect(result.value).toBe(0);
      else expect(Math.abs((result.value - expected) / expected)).toBeLessThan(2e-14);
    }
  }
});
it.each<[string, number]>([
  ['=BESSELJ(2,-.5)', -.23478571040624846],
  ['=BESSELJ(5,-.5)', .1012177091851084],
  ['=BESSELJ(10,-.5)', -.21170886633139815],
  ['=BESSELY(2,.5)', .23478571040624846],
  ['=BESSELY(5,.5)', -.1012177091851084],
  ['=BESSELY(10,.5)', .21170886633139815],
  ['=BESSELI(10,0)', 2815.7166284662553],
  ['=BESSELI(700,0)', 1.5295933476718735e302],
  ['=BESSELY(1000,0)', .0047159179776228135],
  ['=BESSELJ(10,0)', -.2459357644513484],
  ['=BESSELY(10,0)', .055671167283599304],
  ['=BESSELY(11.180339887498949,0)', -.19524864120782978],
  ['=BESSELJ(12,0)', .047689310796833605],
  ['=BESSELJ(12.000000000000002,0)', .04768931079683398],
  ['=BESSELK(.1,0)', 2.427069024702017],
  ['=BESSELK(1,.5)', .4610685044478946],
  ['=BESSELK(2,0)', .11389387274953346],
  ['=BESSELK(5,0)', .0036910983340425942],
  ['=BESSELK(10,0)', 1.7780062316167654e-5],
  ['=BESSELK(1,100)', 5.900333183638617e185],
  ['=BESSELK(2,100)', 4.61941597760128e155],
  ['=ERF(8,8.0001)', 1.8082597972131393e-32],
  ['=ERF(-8,-8.0001)', -1.8082597972131393e-32],
])("preserves released numeric recurrence and tail operations %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
  expect(result).toEqual({ kind: "number", value: expected });
});
it.each<[string, number]>([
  ['=BESSELJ(1,2)', .11490348493190049],
  ['=BESSELJ(1,5)', .0002497577302112345],
  ['=BESSELJ(1,100)', 8.431828789626699e-189],
  ['=BESSELJ(2,2)', .3528340286156376],
  ['=BESSELY(1,0)', .08825696421567698],
  ['=BESSELJ(1,-1)', -.4400505857449335],
  ['=BESSELJ(-1,1)', -.4400505857449335],
  ['=BESSELI(-1,0)', 1.2660658777520084],
  ['=BESSELI(1,100)', 8.47367400813808e-189],
  ['=BESSELY(1,-.5)', .6713967071418031],
  ['=BESSELI(1,-.5)', 1.2312002145929675],
])("preserves native quad series rounding %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
  expect(result).toEqual({ kind: "number", value: expected });
});
it.each<[string, number]>([
  ['=ERF(1.4999999999999998)', .9661051464753106],
  ['=ERFC(1.5)', .033894853524689274],
])("preserves captured scalar error-function arithmetic %s", (formula, expected) => {
  const result = recalculateWorkbook({ sheets: [{ id: "s", name: "Sheet", cells: [{ row: 0, column: 0, formula, formulaDirty: true, value: { kind: "number", value: 0 } }] }] }, context).sheets[0]!.cells[0]!.value;
  expect(result).toEqual({ kind: "number", value: expected });
});
