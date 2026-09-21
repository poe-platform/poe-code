import { fusedMultiplyAdd } from "./numeric-arithmetic.js";
import { fakeFloor } from "./floating-point.js";
import { FinancialGoalSeek } from "./financial-goal-seek.js";
import type { CellValue } from "../../workbook.js";
import { error, numeric, numericResult } from "../values.js";
import { collect, numberArg, textArg } from "./common.js";
import { dateSerial, dayCount, gregorian, leapYear, serialDate, shiftMonths, yearFraction } from "./dates.js";
import type { FunctionHost, FunctionImplementation, SpecialForm, Value } from "./types.js";

function growth(rate: number, periods: number): number { return (rate + 1) - 1 === rate || Math.abs(rate) > .5 || Number.isNaN(rate) || Number.isNaN(periods) ? Math.pow(1 + rate, periods) : Math.exp(periods * Math.log1p(rate)); }
function growthDelta(rate: number, periods: number): number { return rate <= -1 ? Math.pow(1 + rate, periods) - 1 : Math.expm1(periods * Math.log1p(rate)); }
function annuity(rate: number, periods: number): number { return rate === 0 ? periods : growthDelta(rate, periods) / rate; }
function payment(rate: number, periods: number, pv: number, fv: number, type: number): number { return (-pv * growth(rate, periods) - fv) / ((1 + rate * type) * annuity(rate, periods)); }
function interest(rate: number, period: number, periods: number, pv: number, fv: number, type: number): number {
  const pmt = payment(rate, periods, pv, fv, 0);
  return -(pv * growth(rate, period - 1) * rate + pmt * growthDelta(rate, period - 1)) / (type === 0 ? 1 : 1 + rate);
}
function flows(value: Value, host: FunctionHost, ignoreBooleans = false): number[] | CellValue {
  const values: number[] = [];
  for (const cell of collect(value, host)) {
    if (cell.kind === "error") return cell;
    if (cell.kind === "blank" || cell.kind === "string" || ignoreBooleans && cell.kind === "boolean") continue;
    if (cell.kind === "boolean") return error("#VALUE!");
    const n = numeric(cell); if (n === undefined) return error("#VALUE!"); values.push(n);
  }
  return values;
}
/** Released bounded yield/odd-first-yield search policy. */
function financialRoot(f: (x: number) => number, guess: number, host: FunctionHost): number {
  const solve = new FinancialGoalSeek(f, host, 0, 1000);
  if (solve.newton(guess)) return solve.root;
  for (let point = 1e-10; point < 1000; point *= 2) solve.point(point);
  return solve.bisect() ? solve.root : NaN;
}
function basisArg(a: readonly (Value | undefined)[], index: number, h: FunctionHost): number {
  const value = numberArg(a, index, h);
  return value >= 0 && value < 6 ? Math.trunc(value) : -1;
}
/** This older financial helper deliberately differs from the coupon/date basis algorithms. */
function monthlyDays(from: Date, to: Date, basis: number, host: FunctionHost): number {
  if (basis >= 1 && basis <= 3) return dateSerial(to, host) - dateSerial(from, host);
  if (basis !== 0 && basis !== 4) return -1;
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
  const days = to.getUTCDate() - from.getUTCDate();
  const adjust = basis === 0 && from.getUTCMonth() === 1 && to.getUTCMonth() !== 1 && from.getUTCFullYear() === to.getUTCFullYear() ? leapYear(from.getUTCFullYear()) ? 1 : 2 : 0;
  return months * 30 + days - adjust;
}
function couponCount(settle: Date, mature: Date, frequency: number, eom: boolean): number {
  let months = (mature.getUTCFullYear() - settle.getUTCFullYear()) * 12 + mature.getUTCMonth() - settle.getUTCMonth();
  const date = shiftMonths(mature, -months, eom && mature.getUTCDate() === gregorian(mature.getUTCFullYear(), mature.getUTCMonth() + 2, 0).getUTCDate());
  if (settle.getUTCDate() >= date.getUTCDate()) months--;
  return 1 + Math.trunc(months / (12 / frequency));
}
interface Coupon { previous: Date; next: Date; count: number; elapsed: number; remaining: number; days: number }
function coupon(settlement: Date, maturity: Date, frequency: number, basis: number, eom: boolean, host: FunctionHost): Coupon {
  const end = eom && maturity.getUTCDate() === gregorian(maturity.getUTCFullYear(), maturity.getUTCMonth() + 2, 0).getUTCDate();
  const months = (maturity.getUTCFullYear() - settlement.getUTCFullYear()) * 12 + maturity.getUTCMonth() - settlement.getUTCMonth();
  let periods = Math.max(1, Math.floor(months / (12 / frequency)));
  let previous = shiftMonths(maturity, -periods * 12 / frequency, end);
  while (previous > settlement) { host.tick(); previous = shiftMonths(maturity, -++periods * 12 / frequency, end); }
  const next = shiftMonths(maturity, -(periods - 1) * 12 / frequency, end);
  return { previous, next, count: periods, elapsed: dayCount(previous, settlement, basis), remaining: dayCount(settlement, next, basis), days: basis === 1 ? dayCount(previous, next, 1) : (basis === 3 ? 365 : 360) / frequency };
}
function bondPrice(c: Coupon, rate: number, yieldRate: number, redemption: number, frequency: number, host: FunctionHost): number {
  const den = 100 * rate / frequency, base = yieldRate / frequency, exponent = c.remaining / c.days;
  if (c.count === 1) return (redemption + den) / (1 + exponent * base) - c.elapsed / c.days * den;
  host.tick();
  const sum = den * growth(base, 1 - c.count - exponent) * growthDelta(base, c.count) / base;
  return redemption / growth(base, c.count - 1 + exponent) + sum - c.elapsed / c.days * den;
}
const euroRates: Readonly<Record<string, number>> = { ATS: 13.7603, BEF: 40.3399, CYP: .585274, DEM: 1.95583, EEK: 15.6466, ESP: 166.386, EUR: 1, FIM: 5.94573, FRF: 6.55957, GRD: 340.75, IEP: .787564, ITL: 1936.27, LUF: 40.3399, MTL: .4293, NLG: 2.20371, PTE: 200.482, SIT: 239.64, SKK: 30.126 };
export const financialSpecialForms: Readonly<Record<string, SpecialForm>> = {
  NPV: (nodes, h) => {
    const values: number[] = [];
    for (const node of nodes) { const collected = flows(h.evaluate(node, true), h, true); if (!Array.isArray(collected)) return collected; values.push(...collected); }
    if (!values.length || values[0] === -1) return error("#DIV/0!");
    let result = 0, discount = 1; const factor = 1 / (1 + values[0]!);
    for (let i = 1; i < values.length; i++) { h.tick(); discount *= factor; result += values[i]! * discount; }
    return numericResult(result);
  }
};
function dateRatio(from: Date, to: Date, anchor: Date, frequency: number, basis: number, host: FunctionHost): number {
  const c = coupon(from, anchor, frequency, basis, true, host);
  if (c.next >= to) return dayCount(from, to, basis) / c.days;
  let result = dayCount(from, c.next, basis) / c.days, previous = c.next;
  for (;;) {
    host.tick(); const next = shiftMonths(previous, 12 / frequency);
    const days = basis === 1 ? dayCount(previous, next, 1) : (basis === 3 ? 365 : 360) / frequency;
    if (next >= to) return result + dayCount(previous, to, basis) / days;
    result++; previous = next;
  }
}
function oddFirstPrice(settle: Date, mature: Date, issue: Date, first: Date, rate: number, yieldRate: number, redemption: number, frequency: number, basis: number, host: FunctionHost): number {
  let a = dayCount(issue, settle, basis), ds = dayCount(settle, first, basis), df = dayCount(issue, first, basis);
  const c = coupon(settle, mature, frequency, basis, true, host), e = c.days; let n = c.count;
  if (ds > e) {
    if (basis === 0 || basis === 4) n = 1 + Math.ceil(dayCount(first, mature, basis) / e);
    else {
      let d = first; n = 0;
      for (;;) {
        host.tick(); const next = shiftMonths(d, 12 / frequency);
        if (next >= mature) { n += Math.ceil(dayCount(d, mature, basis) / (basis === 1 ? dayCount(d, next, 1) : (basis === 3 ? 365 : 360) / frequency)) + 1; break; }
        n++; d = next;
      }
      a = e * dateRatio(issue, settle, first, frequency, basis, host);
      ds = e * dateRatio(settle, first, first, frequency, basis, host);
      df = e * dateRatio(issue, first, first, frequency, basis, host);
    }
  }
  const scale = 100 * rate / frequency, f = 1 + yieldRate / frequency;
  const term1 = redemption / Math.pow(f, n - 1 + ds / e), term2 = (df / e) / Math.pow(f, ds / e);
  const sum = Math.pow(f, -ds / e) * (Math.pow(f, -n) - 1 / f) / (1 / f - 1);
  return term1 + scale * (term2 + sum - a / e);
}
function roundEven(n: number): number { const floor = Math.floor(n), fraction = n - floor; return fraction === .5 ? floor + Math.abs(floor % 2) : Math.round(n); }
function vdbDeclining(cost: number, salvage: number, life: number, period: number, factor: number): number {
  let fraction = factor / life, previous: number;
  if (fraction >= 1) { fraction = 1; previous = period === 1 ? cost : 0; }
  else previous = cost * growth(-fraction, period - 1);
  const next = cost * growth(-fraction, period);
  return Math.max(0, previous - (next < salvage ? salvage : next));
}
function vdbIntegral(cost: number, salvage: number, life: number, remainingLife: number, period: number, factor: number, host: FunctionHost): number {
  const end = Math.ceil(period); let remaining = cost - salvage, straight = 0, switched = false, result = 0;
  for (let i = 1; i <= end; i++) {
    host.tick(); let amount: number;
    if (!switched) {
      const declining = vdbDeclining(cost, salvage, life, i, factor); straight = remaining / (remainingLife - i + 1);
      if (straight > declining) { amount = straight; switched = true; }
      else { amount = declining; remaining -= declining; }
    } else amount = straight;
    if (i === end) amount *= period + 1 - end;
    result += amount;
  }
  return result;
}
export const financialFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ...Object.fromEntries(["PV", "FV", "PMT", "NPER"].map(name => [name, ((a, h) => {
    const r = numberArg(a, 0, h), n = numberArg(a, 1, h), p = numberArg(a, 2, h), f = numberArg(a, 3, h), t = numberArg(a, 4, h) === 0 ? 0 : 1;
    if (name === "NPER" && r === 0) return n === 0 ? error("#DIV/0!") : numericResult(-(f + p) / n);
    if (name === "PMT") return numericResult(payment(r, n, p, f, t));
    if (name === "FV") return numericResult(-f * growth(r, n) - (1 + r * t) * p * annuity(r, n));
    if (name === "PV") { const factor = growth(r, n); return factor === 0 ? error("#DIV/0!") : numericResult((-f - p * (1 + r * t) * annuity(r, n)) / factor); }
    if (r <= -1) return error("#NUM!");
    const tmp = (n * (1 + r * t) - f * r) / (p * r + n * (1 + r * t));
    return tmp <= 0 ? error("#VALUE!") : numericResult(Math.log(tmp) / Math.log1p(r));
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["IPMT", "PPMT"].map(name => [name, ((a, h) => {
    const r = numberArg(a, 0, h), per = numberArg(a, 1, h), n = numberArg(a, 2, h), pv = numberArg(a, 3, h), fv = numberArg(a, 4, h), t = numberArg(a, 5, h) === 0 ? 0 : 1;
    if (per < 1 || per >= n + 1) return error("#NUM!");
    const ipmt = interest(r, per, n, pv, fv, t); return numericResult(name === "IPMT" ? ipmt : payment(r, n, pv, fv, t) - ipmt);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["CUMIPMT", "CUMPRINC"].map(name => [name, ((a, h) => {
    const r = numberArg(a, 0, h), n = Math.trunc(numberArg(a, 1, h)), pv = numberArg(a, 2, h), start = Math.trunc(numberArg(a, 3, h)), end = Math.trunc(numberArg(a, 4, h)), t = numberArg(a, 5, h) === 0 ? 0 : 1;
    if (r <= 0 || n <= 0 || pv <= 0 || start < 1 || end < start || end > n) return error("#NUM!");
    let total = 0; const pmt = payment(r, n, pv, 0, t);
    for (let per = start; per <= end; per++) { h.tick(); const ipmt = t && per === 1 ? 0 : interest(r, per, n, pv, 0, t); total += name === "CUMIPMT" ? ipmt : pmt - ipmt; }
    return numericResult(total);
  }) satisfies FunctionImplementation])),
  ISPMT: (a, h) => { const r = numberArg(a, 0, h), per = Math.trunc(numberArg(a, 1, h)), n = Math.trunc(numberArg(a, 2, h)), pv = numberArg(a, 3, h); return per < 1 || per >= n + 1 ? error("#NUM!") : numericResult(-pv * r * (1 - per / n)); },
  RATE: (a, h) => {
    const n = Math.trunc(numberArg(a, 0, h)), pmt = numberArg(a, 1, h), pv = numberArg(a, 2, h), fv = numberArg(a, 3, h), t = numberArg(a, 4, h) === 0 ? 0 : 1;
    if (n <= 0) return error("#NUM!");
    const limit = Math.min(1e10, Math.pow(Number.MAX_VALUE / 1e10, 1 / n) - 1), guess = numberArg(a, 5, h, .1);
    const solve = new FinancialGoalSeek(r => r > -1 && r !== 0 ? pv * growth(r, n) + pmt * (1 + r * t) * annuity(r, n) + fv : NaN, h, -limit, limit,
      r => r > -1 && r !== 0 ? -pmt * annuity(r, n) / r + growth(r, n - 1) * n * (pv + pmt * (t + 1 / r)) : NaN);
    if (solve.newton(guess)) return numericResult(solve.root);
    for (let factor = 2; !solve.bracketed && factor < 100; factor *= 2) { solve.point(guess * factor); solve.point(guess / factor); }
    return numericResult(solve.bisect() ? solve.root : NaN);
  },
  IRR: (a, h) => {
    const xs = flows(a[0]!, h); if (!Array.isArray(xs)) return xs;
    const guess = numberArg(a, 1, h, .1), limit = Math.min(1e10, Math.pow(Number.MAX_VALUE / 1e10, 1 / xs.length) - 1);
    // The captured aarch64 plugin contracts both IRR accumulations to FMADD.
    const solve = new FinancialGoalSeek(r => { let total = 0, factor = 1; for (const x of xs) { h.tick(); total = fusedMultiplyAdd(x, factor, total); factor *= 1 / (1 + r); } return Number.isFinite(total) ? total : NaN; }, h, -1, limit,
      r => { let total = 0, factor = 1; for (let i = 1; i < xs.length; i++) { h.tick(); total = fusedMultiplyAdd(xs[i]! * -i, factor, total); factor *= 1 / (1 + r); } return total; });
    if (solve.newton(guess)) return numericResult(solve.root);
    for (let i = 0, scale = 2; !solve.bracketed && i < 10; i++, scale *= 2) { solve.point(guess * scale); solve.point(guess / scale); }
    if (!solve.bracketed) solve.newton(-.99);
    if (!solve.bracketed) solve.point(1 - Number.EPSILON);
    return numericResult(solve.bisect() ? solve.root : NaN);
  },
  MIRR: (a, h) => {
    const xs = flows(a[0]!, h); if (!Array.isArray(xs)) return xs; const finance = numberArg(a, 1, h), reinvest = numberArg(a, 2, h);
    let positive = 0, negative = 0;
    for (let i = 0; i < xs.length; i++) { h.tick(); const x = xs[i]!; if (x >= 0) positive += x / growth(reinvest, i); else negative += x / growth(finance, i); }
    return positive === 0 || negative === 0 || reinvest <= -1 ? error("#DIV/0!") : numericResult(Math.pow(-positive * growth(reinvest, xs.length) / (negative * (1 + reinvest)), 1 / (xs.length - 1)) - 1);
  },
  ...Object.fromEntries(["XNPV", "XIRR"].map(name => [name, ((a, h) => {
    const rawValues = collect(a[name === "XNPV" ? 1 : 0]!, h), rawDates = collect(a[name === "XNPV" ? 2 : 1]!, h);
    if (rawValues.length !== rawDates.length) return error(name === "XIRR" ? "#VALUE!" : "#NUM!");
    const xs: number[] = [], dates: number[] = [];
    for (let i = 0; i < rawValues.length; i++) {
      const value = rawValues[i]!, date = rawDates[i]!;
      if (value.kind === "error") return value; if (date.kind === "error") return date;
      if (value.kind === "boolean" || date.kind === "boolean") return error("#VALUE!");
      if (value.kind === "blank" || date.kind === "blank") continue;
      const x = numeric(value), d = numeric(date); if (x === undefined || d === undefined) return error("#VALUE!");
      xs.push(x); dates.push(d);
    }
    if (!xs.length) return error(name === "XIRR" ? "#VALUE!" : "#NUM!");
    const f = (r: number) => { let total = 0; for (let i = 0; i < xs.length; i++) { h.tick(); const d = dates[i]! - dates[0]!; if (name === "XIRR" && d < 0) return NaN; total += xs[i]! / growth(r, d / 365); } return total; };
    let result: number;
    if (name === "XNPV") result = f(numberArg(a, 0, h));
    else {
      const solve = new FinancialGoalSeek(f, h, -1, 1000);
      if (!solve.newton(numberArg(a, 2, h, .1))) {
        solve.point(-1);
        for (let i = 1; i <= 1024; i *= 2) { solve.point(-1 + 10 / (i + 9)); solve.point(i); if (solve.bisect()) break; }
      }
      result = solve.root;
    }
    return name === "XIRR" && !Number.isFinite(result) ? error("#VALUE!") : numericResult(result);
  }) satisfies FunctionImplementation])),
  FVSCHEDULE: (a, h) => { let value = numberArg(a, 0, h); for (const cell of collect(a[1]!, h)) { if (cell.kind === "error") return cell; if (cell.kind === "blank") continue; if (cell.kind === "string" || cell.kind === "boolean") return error("#VALUE!"); value *= 1 + numeric(cell)!; } return numericResult(value); },
  RRI: (a, h) => { const n = numberArg(a, 0, h), pv = numberArg(a, 1, h), fv = numberArg(a, 2, h); return n < 0 ? error("#NUM!") : n === 0 || pv === 0 ? error("#DIV/0!") : numericResult(Math.pow(fv / pv, 1 / n) - 1); },
  G_DURATION: (a, h) => { const r = numberArg(a, 0, h), pv = numberArg(a, 1, h), fv = numberArg(a, 2, h); return r <= 0 || fv === 0 || pv === 0 ? error("#DIV/0!") : fv / pv < 0 ? error("#VALUE!") : numericResult(Math.log(fv / pv) / Math.log1p(r)); },
  ...Object.fromEntries(["EFFECT", "NOMINAL"].map(name => [name, ((a, h) => {
    const r = numberArg(a, 0, h), n = Math.floor(numberArg(a, 1, h)); return r <= 0 || n < 1 ? error("#NUM!") : numericResult(name === "EFFECT" ? growthDelta(r / n, n) : growthDelta(r, 1 / n) * n);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["DOLLARDE", "DOLLARFR"].map(name => [name, ((a, h) => {
    const x = numberArg(a, 0, h), denominator = Math.floor(numberArg(a, 1, h)); if (denominator < 0) return error("#NUM!"); if (denominator === 0) return error("#DIV/0!");
    const digits = 1 + Math.floor(Math.log10(denominator - .5)), whole = Math.floor(Math.abs(x)), fraction = Math.abs(x) - whole;
    return numericResult(Math.sign(x) * (whole + fraction * (name === "DOLLARDE" ? 10 ** digits / denominator : denominator / 10 ** digits)));
  }) satisfies FunctionImplementation])),
  EURO: (a, h) => { const r = euroRates[textArg(a, 0, h)]; return r === undefined ? error("#NUM!") : numericResult(r); },
  EUROCONVERT: (a, h) => {
    const source = euroRates[textArg(a, 1, h)], targetName = textArg(a, 2, h), target = euroRates[targetName]; if (source === undefined || target === undefined) return error("#VALUE!");
    let intermediate = numberArg(a, 0, h) / source;
    if (a[3] !== undefined && a[4] !== undefined) { const decimals = Math.trunc(numberArg(a, 4, h)); if (decimals < 3 || decimals > 100) return error("#VALUE!"); const scaled = intermediate * 10 ** decimals; intermediate = Math.sign(scaled) * fakeFloor(Math.abs(scaled) + .5) / 10 ** decimals; }
    intermediate *= target;
    if (a[3] !== undefined && !numberArg(a, 3, h)) { const scale = ["BEF", "ESP", "GRD", "ITL", "LUF", "PTE"].includes(targetName) ? 1 : 100; const scaled = intermediate * scale; intermediate = Math.sign(scaled) * fakeFloor(Math.abs(scaled) + .5) / scale; }
    return numericResult(intermediate);
  },
  ...Object.fromEntries(["COUPDAYBS", "COUPDAYS", "COUPDAYSNC", "COUPNCD", "COUPNUM", "COUPPCD"].map(name => [name, ((a, h) => {
    const settle = serialDate(numberArg(a, 0, h), h), mature = serialDate(numberArg(a, 1, h), h), freq = Math.trunc(numberArg(a, 2, h)), basis = basisArg(a, 3, h), eom = numberArg(a, 4, h, 1) !== 0;
    if (!settle || !mature) return error("#VALUE!"); if (settle >= mature || ![1, 2, 4].includes(freq) || basis < 0 || basis > 5) return error("#NUM!");
    const c = coupon(settle, mature, freq, basis, eom, h);
    return numericResult(name === "COUPDAYBS" ? c.elapsed : name === "COUPDAYS" ? c.days : name === "COUPDAYSNC" ? c.remaining : name === "COUPNCD" ? dateSerial(c.next, h) : name === "COUPPCD" ? dateSerial(c.previous, h) : c.count);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["PRICE", "YIELD", "DURATION", "MDURATION"].map(name => [name, ((a, h) => {
    const settle = serialDate(numberArg(a, 0, h), h), mature = serialDate(numberArg(a, 1, h), h), rate = numberArg(a, 2, h), y = numberArg(a, 3, h), duration = name.endsWith("DURATION"), redemption = duration ? 100 : numberArg(a, 4, h), freq = Math.trunc(numberArg(a, duration ? 4 : 5, h)), basis = basisArg(a, duration ? 5 : 6, h);
    if (!settle || !mature) return error(name === "YIELD" || duration ? "#NUM!" : "#VALUE!");
    if ((!duration && (settle > mature || rate < 0 || redemption <= 0)) || ![1, 2, 4].includes(freq) || basis < 0 || basis > 5) return error("#NUM!");
    const c = duration ? undefined : coupon(settle, mature, freq, basis, true, h);
    if (name === "PRICE" && y < 0) return error("#NUM!");
    if (name === "PRICE") return numericResult(bondPrice(c!, rate, y, redemption, freq, h));
    if (name === "YIELD") {
      if (y < 0) return error("#NUM!");
      if (c!.count <= 1) { const den = y / 100 + c!.elapsed / c!.days * rate / freq; return numericResult(((redemption / 100 + rate / freq) - den) / den * freq * c!.days / c!.remaining); }
      return numericResult(financialRoot(r => bondPrice(c!, rate, r, redemption, freq, h) - y, .1, h));
    }
    let weighted = 0, total = 0; const count = couponCount(settle, mature, freq, name === "DURATION");
    for (let t = 1; t < count; t++) { h.tick(); const pv = 100 * rate / freq / Math.pow(1 + y / freq, t); total += pv; weighted += pv * t; }
    const last = (100 * rate / freq + 100) / Math.pow(1 + y / freq, count); total += last; weighted += last * count;
    return numericResult(weighted / total / freq / (name === "MDURATION" ? 1 + y / freq : 1));
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["ACCRINTM", "INTRATE", "RECEIVED", "PRICEDISC", "DISC", "YIELDDISC"].map(name => [name, ((a, h) => {
    const from = serialDate(numberArg(a, 0, h), h), to = serialDate(numberArg(a, 1, h), h), x = numberArg(a, 2, h), y = numberArg(a, 3, h, name === "ACCRINTM" ? 1000 : 0), basis = basisArg(a, 4, h);
    if (!from || !to || basis < 0 || basis > 5) return error("#NUM!");
    if (name === "YIELDDISC") return x <= 0 || y <= 0 || from >= to ? error("#NUM!") : numericResult((y / x - 1) / yearFraction(from, to, basis));
    const days = monthlyDays(from, to, basis, h), year = basis === 1 ? leapYear(from.getUTCFullYear()) ? 366 : 365 : basis === 3 ? 365 : 360;
    if (days < 0 || days === 0 && name !== "ACCRINTM") return error("#NUM!");
    if (name === "ACCRINTM") return x <= 0 || y <= 0 ? error("#NUM!") : numericResult(x * y * days / year);
    if (name === "INTRATE") return x === 0 ? error("#NUM!") : numericResult((y - x) / x * year / days);
    if (name === "RECEIVED") return 1 - y * days / year === 0 ? error("#NUM!") : numericResult(x / (1 - y * days / year));
    if (name === "PRICEDISC") return numericResult(y * (1 - x * days / year));
    return (name === "DISC" ? y : x) === 0 ? error("#NUM!") : numericResult((y - x) / (name === "DISC" ? y : x) * year / days);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["TBILLEQ", "TBILLPRICE", "TBILLYIELD"].map(name => [name, ((a, h) => {
    const days = Math.floor(numberArg(a, 1, h)) - Math.floor(numberArg(a, 0, h)), x = numberArg(a, 2, h);
    if (days < 0 || days > 365 || x < 0 || name === "TBILLYIELD" && (days === 0 || x === 0)) return error("#NUM!");
    if (name === "TBILLPRICE") return numericResult(100 * (1 - x * days / 360));
    if (name === "TBILLYIELD") return numericResult((100 - x) / x * 360 / days);
    return 360 - x * days === 0 ? error("#DIV/0!") : numericResult(365 * x / (360 - x * days));
  }) satisfies FunctionImplementation])),
  ACCRINT: (a, h) => {
    const issue = serialDate(numberArg(a, 0, h), h), first = serialDate(numberArg(a, 1, h), h), settle = serialDate(numberArg(a, 2, h), h);
    if (!issue || !first || !settle) return error("#VALUE!");
    const rate = numberArg(a, 3, h), par = numberArg(a, 4, h, 1000), freq = Math.trunc(numberArg(a, 5, h)), basis = basisArg(a, 6, h);
    if (a[5] === undefined || rate <= 0 || par <= 0 || ![1, 2, 4].includes(freq) || basis < 0 || basis > 5 || issue >= settle) return error("#NUM!");
    const start = first >= settle || numberArg(a, 6, h, 1) !== 0 ? issue : first;
    const days = monthlyDays(start, settle, basis, h), denominator = basis === 1 ? leapYear(settle.getUTCFullYear()) ? 366 : 365 : basis === 3 ? 365 : 360;
    return days < 0 ? error("#NUM!") : numericResult(par * rate * days / denominator);
  },
  ...Object.fromEntries(["AMORLINC", "AMORDEGRC"].map(name => [name, ((a, h) => {
    let cost = numberArg(a, 0, h); const from = serialDate(numberArg(a, 1, h), h), first = serialDate(numberArg(a, 2, h), h), salvage = numberArg(a, 3, h), period = Math.trunc(numberArg(a, 4, h)), basis = basisArg(a, 6, h); let rate = numberArg(a, 5, h);
    if (!from || !first || rate < 0 || basis < 0 || basis > 5) return error("#NUM!");
    const fraction = yearFraction(from, first, basis);
    if (name === "AMORLINC") {
      const annual = cost * rate, initial = fraction * annual, full = Math.trunc((cost - salvage - initial) / annual);
      return numericResult(period === 0 ? initial : period <= full ? annual : period === full + 1 ? cost - salvage - annual * full - initial : 0);
    }
    const life = 1 / rate; rate *= life < 3 ? 1 : life < 5 ? 1.5 : life <= 6 ? 2 : 2.5;
    let depreciation = roundEven(fraction * rate * cost); cost -= depreciation; let remaining = cost - salvage;
    for (let n = 0; n < period; n++) { h.tick(); depreciation = roundEven(rate * cost); remaining -= depreciation; if (remaining < 0) return numericResult(period - n <= 1 ? roundEven(cost / 2) : 0); cost -= depreciation; }
    return numericResult(depreciation);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["PRICEMAT", "YIELDMAT"].map(name => [name, ((a, h) => {
    const settle = serialDate(numberArg(a, 0, h), h), mature = serialDate(numberArg(a, 1, h), h), issue = serialDate(numberArg(a, 2, h), h), rate = numberArg(a, 3, h), value = numberArg(a, 4, h), basis = basisArg(a, 5, h);
    if (!settle || !mature || !issue || basis < 0 || basis > 5) return error("#NUM!");
    if (name === "YIELDMAT") return rate < 0 ? error("#NUM!") : numericResult(((1 + yearFraction(issue, mature, basis) * rate) / (value / 100 + yearFraction(issue, settle, basis) * rate) - 1) / yearFraction(settle, mature, basis));
    const denominator = basis === 1 ? leapYear(settle.getUTCFullYear()) ? 366 : 365 : basis === 3 ? 365 : 360;
    const sm = monthlyDays(settle, mature, basis, h), im = monthlyDays(issue, mature, basis, h), accrued = monthlyDays(issue, settle, basis, h), n = 1 + sm / denominator * value;
    return sm <= 0 || im <= 0 || accrued <= 0 || n === 0 ? error("#NUM!") : numericResult((100 + im / denominator * rate * 100) / n - accrued / denominator * rate * 100);
  }) satisfies FunctionImplementation])),
  ...Object.fromEntries(["ODDFPRICE", "ODDFYIELD", "ODDLPRICE", "ODDLYIELD"].map(name => [name, ((a, h) => {
    const early = name.startsWith("ODDF"), settle = serialDate(numberArg(a, 0, h), h), mature = serialDate(numberArg(a, 1, h), h), anchor = serialDate(numberArg(a, 2, h), h), first = early ? serialDate(numberArg(a, 3, h), h) : undefined;
    const rate = numberArg(a, early ? 4 : 3, h), value = numberArg(a, early ? 5 : 4, h), redemption = numberArg(a, early ? 6 : 5, h), freq = Math.trunc(numberArg(a, early ? 7 : 6, h)), basis = basisArg(a, early ? 8 : 7, h);
    if (!settle || !mature || !anchor || early && !first) return error("#VALUE!");
    if (basis < 0 || basis > 5 || ![1, 2, 4].includes(freq) || anchor > settle || settle > mature || early && (settle > first! || first! > mature) || rate < 0 || value < 0 || redemption <= 0 || name.endsWith("YIELD") && value === 0) return error("#NUM!");
    if (early) {
      const price = (r: number) => oddFirstPrice(settle, mature, anchor, first!, rate, r, redemption, freq, basis, h);
      return numericResult(name === "ODDFPRICE" ? price(value) : financialRoot(r => price(r) - value, .1, h));
    }
    let d = anchor; do { h.tick(); d = shiftMonths(d, 12 / freq); } while (d < mature);
    const x1 = dateRatio(anchor, settle, d, freq, basis, h), x2 = dateRatio(anchor, mature, d, freq, basis, h), x3 = dateRatio(settle, mature, d, freq, basis, h);
    return numericResult(name === "ODDLPRICE" ? (redemption * freq + 100 * rate * (x2 - x1 * (1 + value * x3 / freq))) / (value * x3 + freq) : (freq * (redemption - value) + 100 * rate * (x2 - x1)) / (x3 * value + 100 * rate * x1 * x3 / freq));
  }) satisfies FunctionImplementation])),
  SLN: (a, h) => { const life = numberArg(a, 2, h); return life <= 0 ? error("#NUM!") : numericResult((numberArg(a, 0, h) - numberArg(a, 1, h)) / life); },
  SYD: (a, h) => { const life = numberArg(a, 2, h), period = numberArg(a, 3, h); return life <= 0 ? error("#NUM!") : numericResult((numberArg(a, 0, h) - numberArg(a, 1, h)) * (life - period + 1) * 2 / (life * (life + 1))); },
  ...Object.fromEntries(["DB", "DDB", "VDB"].map(name => [name, ((a, h) => {
    const cost = numberArg(a, 0, h), salvage = numberArg(a, 1, h), life = numberArg(a, 2, h), start = numberArg(a, 3, h), end = name === "VDB" ? numberArg(a, 4, h) : start, factor = numberArg(a, name === "VDB" ? 5 : 4, h, name === "DB" ? 12 : 2);
    if (name === "DB") {
      if (cost === 0 || life <= 0 || salvage / cost < 0) return error("#NUM!");
      const rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
      let total = cost * rate * factor / 12;
      if (start === 1) return numericResult(total);
      for (let i = 1; i < life; i++) { h.tick(); if (i === start - 1) return numericResult((cost - total) * rate); total += (cost - total) * rate; }
      return numericResult((cost - total) * rate * (12 - factor) / 12);
    }
    if (name === "DDB") {
      if (cost < 0 || salvage < 0 || life <= 0 || start <= 0 || start > life || factor <= 0) return error("#NUM!");
      if (salvage >= cost) return numericResult(0);
      if (start < 1 && life < 1) return numericResult(cost - salvage);
      const fraction = factor / life, prior = -cost * growthDelta(-fraction, Math.max(1, start) - 1), remaining = cost - prior;
      return numericResult(Math.min(remaining * fraction, Math.max(0, remaining - salvage)));
    }
    if (start < 0 || end < start || end > life || cost < 0 || salvage > cost || factor <= 0) return error("#NUM!");
    const noSwitch = Math.trunc(numberArg(a, 6, h)) !== 0, first = Math.floor(start), last = Math.ceil(end);
    if (noSwitch) {
      if (last > 2147483647 || last - first > 10000) return error("#VALUE!");
      let result = 0;
      for (let i = first + 1; i <= last; i++) {
        h.tick(); let amount = vdbDeclining(cost, salvage, life, i, factor);
        if (i === first + 1) amount *= Math.min(end, first + 1) - start;
        else if (i === last) amount *= end + 1 - last;
        result += amount;
      }
      return numericResult(result);
    }
    let partial = 0;
    if (start > first) { const remaining = cost - vdbIntegral(cost, salvage, life, life, first, factor, h); partial += (start - first) * vdbIntegral(remaining, salvage, life, life - first, 1, factor, h); }
    if (end < last) { const remaining = cost - vdbIntegral(cost, salvage, life, life, last - 1, factor, h); partial += (last - end) * vdbIntegral(remaining, salvage, life, life - last + 1, 1, factor, h); }
    const remaining = cost - vdbIntegral(cost, salvage, life, life, first, factor, h);
    return numericResult(vdbIntegral(remaining, salvage, life, life - first, last - first, factor, h) - partial);
  }) satisfies FunctionImplementation]))
};
