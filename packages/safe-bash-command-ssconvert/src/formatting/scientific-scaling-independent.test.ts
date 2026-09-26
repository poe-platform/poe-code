import { expect, it, vi } from "vitest";
import { formatText } from "./number-format.js";
import type { CapabilityContext } from "../contracts.js";
const context: CapabilityContext = {
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 1000, sheets: 10, operations: 100, workbookWork: 100000 }, own() {}
};
const host = { context, book: {}, tick() { context.signal.throwIfAborted(); } };
it.each<[number, number, string]>([
  [2.5, 256, "3.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000E+00"],
  [1e-23, 17, "9.99999999999999960E-24"],
  [1e+23, 17, "9.99999999999999916E+22"],

  [1e-308, 101, "9.99999999999999909326625337248461995470488734032045693707225049331647881341002217023668530611028595158E-309"],
  [0.1, 101, "1.00000000000000005551115123125782702118158340454101562500000000000000000000000000000000000000000000000E-01"],
  [0.3, 101, "2.99999999999999988897769753748434595763683319091796875000000000000000000000000000000000000000000000000E-01"],
  [1.005, 128, "1.00499999999999989341858963598497211933135986328125000000000000000000000000000000000000000000000000000000000000000000000000000000E+00"],
  [99.95, 101, "9.99500000000000028421709430404007434844970703125000000000000000000000000000000000000000000000000000000E+01"],
  [5e-324, 101, "4.94065645841246544176568792868221372365059802614324764425585682500675507270208751865299836361635992380E-324"],
  [1e+308, 101, "1.00000000000000001097906362944045541740492309677311846336810682903157585404911491537163328978494688899E+308"],
  [-1e-309, 101, "-1.00000000000000188558920870223463870174566020691753515394643550663070558368373221972569761144603605636E-309"]
])("retains the original binary64 digits during scientific scaling (%s, %s)", (value, precision, expected) => {
  expect(formatText({ kind: "number", value }, "0." + "0".repeat(precision) + "E+00", host))
    .toEqual({ kind: "string", value: expected });
});

it("retains native unsigned-byte fixed precision independently of emitted width", () => {
  expect(formatText({ kind: "number", value: 2.5 }, "0." + "0".repeat(256), host))
    .toEqual({ kind: "string", value: "3." + "0".repeat(256) });
});

it("admits the scientific output at the exact byte limit and rejects one less", () => {
  const pattern = "0." + "0".repeat(101) + "E+00";
  const expected = "1.25" + "0".repeat(99) + "E+00";
  const limited = { ...host, context: { ...context, limits: { ...context.limits, outputBytes: expected.length } } };
  expect(formatText({ kind: "number", value: 1.25 }, pattern, limited)).toEqual({ kind: "string", value: expected });
  expect(() => formatText({ kind: "number", value: 1.25 }, pattern,
    { ...limited, context: { ...limited.context, limits: { ...limited.context.limits, outputBytes: expected.length - 1 } } }))
    .toThrow("ssconvert calculation text limit exceeded");
});

it("preserves cancellation identity during long precision scanning", () => {
  const controller = new AbortController(), reason = new Error("independent scan cancellation");
  let ticks = 0;
  const cancelled = { ...host, context: { ...context, signal: controller.signal }, tick() {
    if (++ticks === 20) controller.abort(reason);
    controller.signal.throwIfAborted();
  } };
  let failure: unknown;
  try { formatText({ kind: "number", value: 0.1 }, "0." + "0".repeat(101) + "E+00", cancelled); }
  catch (caught) { failure = caught; }
  expect(failure).toBe(reason);
  expect(ticks).toBe(20);
});

it("propagates host work exhaustion while scanning scientific precision", () => {
  const reason = new Error("independent workbook work budget");
  let ticks = 0, failure: unknown;
  try { formatText({ kind: "number", value: 0.1 }, "0." + "0".repeat(101) + "E+00", {
    ...host, tick() { if (++ticks === 30) throw reason; }
  }); } catch (caught) { failure = caught; }
  expect(failure).toBe(reason);
  expect(ticks).toBe(30);
});

it("does not delegate the reference precision to ambient Intl", () => {
  const ambient = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => { throw new Error("ambient Intl prohibited"); });
  try {
    expect(formatText({ kind: "number", value: 0.1 }, "0.000E+00", host))
      .toEqual({ kind: "string", value: "1.000E-01" });
    expect(ambient).not.toHaveBeenCalled();
  } finally { ambient.mockRestore(); }
});
