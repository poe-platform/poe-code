// SPDX-License-Identifier: GPL-2.0-or-later
import { error, numericResult } from "../values.js";
import { numberArg } from "./common.js";
import { distributions, gammaProbability } from "./probability.js";
import type { FunctionHost, FunctionImplementation } from "./types.js";

/** Released calculate_gos, including its fractional-circuit branch behavior. */
function blocking(traffic: number, circuits: number, complement: boolean, host: FunctionHost): number {
  if (circuits < 1 || traffic < 0) return -1;
  if (traffic === 0) return complement ? 1 : 0;
  if (circuits < 100) {
    let gos = 1;
    for (let n = 1; n <= circuits; n++) { host.tick(); const term = traffic * gos; gos = term / (n + term); }
    return complement ? 1 - gos : gos;
  }
  if (circuits / traffic < .9) {
    let sum = 0, term = 1;
    for (let n = circuits; n > 1; n--) { host.tick(); term *= n / traffic; if (term < Number.EPSILON * sum) break; sum += term; }
    return complement ? sum / (1 + sum) : 1 / (1 + sum);
  }
  const loggos = distributions.gamma!.density(traffic,[circuits + 1,1],host) - gammaProbability(traffic,circuits + 1,false,true,host);
  return complement ? -Math.expm1(loggos) : Math.exp(loggos);
}
function trafficRoot(target: number, circuits: number, carried: boolean, host: FunctionHost): number {
  if (target === 0) return 0;
  let lo = carried ? target : 0, hi = carried ? Math.max(circuits,target * 2) : circuits / (1 - target);
  const value = (x: number) => carried ? x * blocking(x,circuits,true,host) : blocking(x,circuits,false,host);
  while (value(hi) < target) { host.tick(); hi *= 2; if (!Number.isFinite(hi)) return NaN; }
  for (let i = 0; i < 200; i++) { host.tick(); const mid = lo / 2 + hi / 2; if (mid === lo || mid === hi) return mid; if (value(mid) < target) lo = mid; else hi = mid; }
  return NaN;
}
export const erlangFunctions: Readonly<Record<string, FunctionImplementation>> = {
  PROBBLOCK: (a,h) => { const gos = blocking(numberArg(a,0,h),numberArg(a,1,h),false,h); return gos >= 0 ? numericResult(gos) : error('#VALUE!'); },
  OFFTRAF: (a,h) => { const traffic = numberArg(a,0,h), circuits = numberArg(a,1,h); if (circuits < 1 || traffic < 0 || traffic >= circuits) return error('#VALUE!'); const value = trafficRoot(traffic,circuits,true,h); return Number.isFinite(value) ? numericResult(value) : error('#VALUE!'); },
  OFFCAP: (a,h) => { const circuits = numberArg(a,0,h), gos = numberArg(a,1,h); if (gos <= 0 || gos >= 1 || circuits < 1) return error('#VALUE!'); const value = trafficRoot(gos,circuits,false,h); return Number.isFinite(value) ? numericResult(value) : error('#VALUE!'); },
  DIMCIRC: (a,h) => { const traffic = numberArg(a,0,h), gos = numberArg(a,1,h); if (gos <= 0 || gos > 1) return error('#VALUE!'); let lo = 1, hi = 1; while (blocking(traffic,hi,false,h) > gos) { h.tick(); lo = hi; hi *= 2; if (!Number.isFinite(hi)) return error('#VALUE!'); } while (hi - lo > 1.5) { h.tick(); const mid = Math.floor((hi + lo) / 2 + .1); if (blocking(traffic,mid,false,h) > gos) lo = mid; else hi = mid; } return numericResult(hi); },
};
