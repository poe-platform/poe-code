/*
 * Options pricing
 *
 * Authors:
 *   Elliot Lee <sopwith@redhat.com> All initial work.
 *   Morten Welinder <terra@gnome.org> Port to new plugin framework.
 *                                         Cleanup.
 *   Hal Ashburner <hal_ashburner@yahoo.co.uk>
 *   Black Scholes Code re-structure, optional asset leakage paramaters,
 *   American approximations, alternative models to Black-Scholes
 *   and All exotic Options Functions.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <https://www.gnu.org/licenses/>.
 */

// SPDX-License-Identifier: GPL-2.0-or-later
// TypeScript adaptation of released Gnumeric 1.12.61 options algorithms.
import { SsconvertError } from "../../contracts.js";
import { error, numericResult } from "../values.js";
import { numberArg, textArg } from "./common.js";
import type { FunctionHost, FunctionImplementation, Value } from "./types.js";
const OS_Call = 0, OS_Put = 1, OS_Error = 2, OT_Euro = 0, OT_Amer = 1, OT_Error = 2;
import { normalCdf } from "./normal-distribution.js";
function factorial(n: number): number { let result = 1; for (let i = 2; i <= n; i++) result *= i; return result; }

function option_side(s: string): number {

	if (s[0] == 'p' || s[0] == 'P')
		return OS_Put;
	else if (s[0] == 'c' || s[0] == 'C')
		return OS_Call;
	else
		return OS_Error;

}
function option_type(s: string): number {

	if (s[0] == 'a' || s[0] == 'A')
		return OT_Amer;
	else if (s[0] == 'e' || s[0] == 'E')
		return OT_Euro;
	else
		return OT_Error;

}
const npdf = (x: number) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function Sgn(a: number): number {

	if ( a >0)
		return 1;
	else if (a < 0)
		return -1;
	else
		return 0;

}
function cum_biv_norm_dist1(a: number, b: number, rho: number, host: FunctionHost): number {

	let rho1: number;
let rho2: number;
let delta: number;
	

let sum =  0.0;
	let i: number;
let j: number;

	const x = [0.24840615, 0.39233107, 0.21141819, 0.03324666, 0.00082485334];
	const y = [0.10024215, 0.48281397, 1.0609498, 1.7797294, 2.6697604];
	const a1 = a / Math.sqrt (2 * (1 - (rho * rho)));
	const b1 = b / Math.sqrt (2 * (1 - (rho * rho)));

	if (a <= 0 && b <= 0 && rho <= 0) {
		for (i = 0; i != 5; ++i) { host.tick();
			for (j = 0; j != 5; ++j) { host.tick();
				sum = sum + x[i]! * x[j]! * Math.exp (a1 * (2 * y[i]! - a1) + b1 * (2 *
y[j]! - b1) + 2 * rho * (y[i]! - a1) * (y[j]! - b1));
			}
		}
		return Math.sqrt (1 - (rho * rho)) / Math.PI * sum;
	} else if (a <= 0 && b >= 0 && rho >= 0)
		return normalCdf (a) - cum_biv_norm_dist1 (a,-b,-rho, host);
	else if (a >= 0 && b <= 0 && rho >= 0)
		return normalCdf (b) - cum_biv_norm_dist1 (-a,b,-rho, host);
	else if (a >= 0 && b >= 0 && rho <= 0)
		return normalCdf (a) + normalCdf (b) - 1 + cum_biv_norm_dist1 (-a,-b,rho, host);
	else if ((a * b * rho) > 0) {
		rho1 = (rho * a - b) * Sgn (a) / Math.sqrt ((a * a) - 2 * rho * a
							   * b + (b * b));
		rho2 = (rho * b - a) * Sgn (b) / Math.sqrt ((a * a) - 2 * rho * a
							   * b + (b * b));
		// Sgn returns int in the released C algorithm: division truncates before
		// assignment to the floating-point delta, including opposite signs.
		delta = Math.trunc((1 - Sgn (a) * Sgn (b)) / 4);
		return (cum_biv_norm_dist1 (a,0.0,rho1, host) +
			cum_biv_norm_dist1 (b,0.0,rho2, host) -
			delta);
	}
	return NaN;


}
function cum_biv_norm_dist(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const a =  numberArg(argv, 0, host);
	const b =  numberArg(argv, 1, host);
	const rho =  numberArg(argv, 2, host);
	const result =  cum_biv_norm_dist1 (a,b,rho, host);

	if (Number.isNaN (result))
		return error("#NUM!");
	else
		return numericResult(result);

}
function opt_bs1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 =  d1 - v * Math.sqrt (t);

	switch (side) {
	case OS_Call:
		return (s * Math.exp ((b - r) * t) * normalCdf (d1) -
			x * Math.exp (-r * t) * normalCdf (d2));
	case OS_Put:
		return (x * Math.exp (-r * t) * normalCdf (-d2) -
			s * Math.exp ((b - r) * t) * normalCdf (-d1));
	default:
		return NaN;
	}

}
function opt_bs(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult =  opt_bs1 (call_put, s, x, t, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	return numericResult(gfresult);

}
function opt_bs_delta1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 = 
		(Math.log (s / x) + (b + (v * v) / 2) * t) /
		(v * Math.sqrt (t));

	switch (side) {
	case OS_Call:
		return Math.exp ((b - r) * t) * normalCdf (d1);

	case OS_Put:
		return Math.exp ((b - r) * t) * (normalCdf (d1) - 1);

	default:
		return NaN;
	}

}
function opt_bs_delta(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult =  opt_bs_delta1 (call_put, s, x, t, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");

	return numericResult(gfresult);

}
function opt_bs_gamma1(s: number, x: number, t: number, r: number, v: number, b: number): number {

	

	const d1 = (Math.log (s / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	return Math.exp ((b - r) * t) * npdf (d1) / (s * v * Math.sqrt (t));

}
function opt_bs_gamma(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s =  numberArg(argv, 0, host);
	const x =  numberArg(argv, 1, host);
	const t =  numberArg(argv, 2, host);
	const r =  numberArg(argv, 3, host);
	const v =  numberArg(argv, 4, host);
	const b =  argv[5]! ? numberArg(argv, 5, host) : 0;
	const gfresult =  opt_bs_gamma1 (s,x,t,r,v,b);
	return numericResult(gfresult);

}
function opt_bs_theta1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 =  d1 - v * Math.sqrt (t);

	switch (side) {
	case OS_Call:
		return -s * Math.exp ((b - r) * t) * npdf (d1) * v / (2 * Math.sqrt (t)) -
			(b - r) * s * Math.exp ((b - r) * t) * normalCdf (d1) - r * x * Math.exp (-r * t) * normalCdf (d2);
	case OS_Put:
		return -s * Math.exp ((b - r) * t) * npdf (d1) * v / (2 * Math.sqrt (t)) +
			(b - r) * s * Math.exp ((b - r) * t) * normalCdf (-d1) + r * x * Math.exp (-r * t) * normalCdf (-d2);
	default:
		return NaN;
	}

}
function opt_bs_theta(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult =  opt_bs_theta1 (call_put, s, x, t, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	return numericResult(gfresult);

}
function opt_bs_vega1(s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + (b + (v * v) / 2) * t) /
		(v * Math.sqrt (t));
	return s * Math.exp ((b - r) * t) * npdf (d1) * Math.sqrt (t);

}
function opt_bs_vega(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s =  numberArg(argv, 0, host);
	const x =  numberArg(argv, 1, host);
	const t =  numberArg(argv, 2, host);
	const r =  numberArg(argv, 3, host);
	const v =  numberArg(argv, 4, host);
	const b =  argv[5]! ? numberArg(argv, 5, host) : 0;

	return numericResult(opt_bs_vega1 (s, x, t, r, v, b));

}
function opt_bs_rho1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 =  d1 - v * Math.sqrt (t);
	switch (side) {
	case OS_Call:
		if (b != 0)
			return t * x * Math.exp (-r * t) * normalCdf (d2);
		else
			return -t *  opt_bs1 (side, s, x, t, r, v, b);

	case OS_Put:
		if (b != 0)
			return -t * x * Math.exp (-r * t) * normalCdf (-d2);
		else
			return -t * opt_bs1 (side, s, x, t, r, v, b);

	default:
		return NaN;
	}

}
function opt_bs_rho(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult =  opt_bs_rho1 (call_put, s, x, t, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	return numericResult(gfresult);

}
function opt_bs_carrycost1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + (b + (v * v) / 2) * t) /
		(v * Math.sqrt (t));

	switch (side) {
	case OS_Call:
		return t * s * Math.exp ((b - r) * t) * normalCdf (d1);
	case OS_Put:
		return -t * s * Math.exp ((b - r) * t) * normalCdf (-d1);
	default:
		return NaN; 
	}

}
function opt_bs_carrycost(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult =  opt_bs_carrycost1 (call_put, s, x, t, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	return numericResult(gfresult);

}
function opt_garman_kohlhagen1(side: number, s: number, x: number, t: number, r: number, rf: number, v: number): number {

	const d1 =  (Math.log (s / x) + (r - rf + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 =  d1 - v * Math.sqrt (t);
	switch (side) {
	case OS_Call:
		return s * Math.exp (-rf * t) * normalCdf (d1) - x * Math.exp (-r * t) * normalCdf (d2);
	case OS_Put:
		return x * Math.exp (-r * t) * normalCdf (-d2) - s * Math.exp (-rf * t) * normalCdf (-d1);
	default:
		return NaN; 
	}

}
function opt_garman_kohlhagen(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const rf =  numberArg(argv, 5, host);
	const v =  numberArg(argv, 6, host);
	const gfresult =  opt_garman_kohlhagen1 (call_put, s, x, t, r, rf, v);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	else
		return numericResult(gfresult);

}
function opt_french1(side: number, s: number, x: number, tradingt: number, calendart: number, r: number, v: number, b: number): number {

	const d1 =  (Math.log (s / x) + b * calendart + ((v * v) / 2) * tradingt) / (v * Math.sqrt (tradingt));
	const d2 =  d1 - v * Math.sqrt (tradingt);

	switch (side) {
	case OS_Call:
		return s * Math.exp ((b - r) * calendart) * normalCdf (d1) - x * Math.exp (-r * calendart) * normalCdf (d2);
	case OS_Put:
		return x * Math.exp (-r * calendart) * normalCdf (-d2) - s * Math.exp ((b - r) * calendart) * normalCdf (-d1);
	default:
		return NaN;
	}

}
function opt_french(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const t1 =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const v =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const gfresult =  opt_french1 (call_put, s, x, t, t1, r, v, b);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	else
		return numericResult(gfresult);

}
function opt_jump_diff1(side: number, s: number, x: number, t: number, r: number, v: number, lambda: number, gamma: number, host: FunctionHost): number {

	
let sum: number;
	
let vi: number;
	let i: number;

	const delta = Math.sqrt (gamma * (v * v) / lambda);
	const Z = Math.sqrt ((v * v) - lambda * (delta * delta));
	sum = 0.0;
	for (i = 0; i != 11; ++i) { host.tick();
		vi = Math.sqrt ((Z * Z) + (delta * delta) * (i / t));
		sum = sum + Math.exp (-lambda * t) * Math.pow (lambda * t, i) / factorial(i) *
			opt_bs1 (side, s, x, t, r, vi, r);
	}
	return sum;

}
function opt_jump_diff(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const lambda =  numberArg(argv, 6, host);
	const gamma =  numberArg(argv, 7, host);
	const gfresult = 
		opt_jump_diff1 (call_put, s, x, t, r, v, lambda, gamma, host);
	return numericResult(gfresult);

}
function opt_miltersen_schwartz1(side: number, p_t: number, f_t: number, x: number, t1: number, t2: number, v_s: number, v_e: number, v_f: number, rho_se: number, rho_sf: number, rho_ef: number, kappa_e: number, kappa_f: number): number {

	let vz: number;

	


	vz = (v_s * v_s) * t1 + 2 * v_s * (v_f * rho_sf * 1 / kappa_f * (t1 - 1 / kappa_f * Math.exp (-kappa_f * t2) * (Math.exp (kappa_f * t1) - 1))
					    - v_e * rho_se * 1 / kappa_e * (t1 - 1 / kappa_e * Math.exp (-kappa_e * t2) * (Math.exp (kappa_e * t1) - 1)))
		+ (v_e * v_e) * 1 / (kappa_e * kappa_e) * (t1 + 1 / (2 * kappa_e) * Math.exp (-2 * kappa_e * t2) * (Math.exp (2 * kappa_e * t1) - 1)
							 - 2 * 1 / kappa_e * Math.exp (-kappa_e * t2) * (Math.exp (kappa_e * t1) - 1))
		+ (v_f * v_f) * 1 / (kappa_f * kappa_f) * (t1 + 1 / (2 * kappa_f) * Math.exp (-2 * kappa_f * t2) * (Math.exp (2 * kappa_f * t1) - 1)
							 - 2 * 1 / kappa_f * Math.exp (-kappa_f * t2) * (Math.exp (kappa_f * t1) - 1))
		- 2 * v_e * v_f * rho_ef * 1 / kappa_e * 1 / kappa_f * (t1 - 1 / kappa_e * Math.exp (-kappa_e * t2) * (Math.exp (kappa_e * t1) - 1)
									- 1 / kappa_f * Math.exp (-kappa_f * t2) * (Math.exp (kappa_f * t1) - 1)
									+ 1 / (kappa_e + kappa_f) * Math.exp (-(kappa_e + kappa_f) * t2) * (Math.exp ((kappa_e + kappa_f) * t1) - 1));

	const vxz = v_f * 1 / kappa_f * (v_s * rho_sf * (t1 - 1 / kappa_f * (1 - Math.exp (-kappa_f * t1)))
				   + v_f * 1 / kappa_f * (t1 - 1 / kappa_f * Math.exp (-kappa_f * t2) * (Math.exp (kappa_f * t1) - 1) - 1 / kappa_f * (1 - Math.exp (-kappa_f * t1))
							  + 1 / (2 * kappa_f) * Math.exp (-kappa_f * t2) * (Math.exp (kappa_f * t1) - Math.exp (-kappa_f * t1)))
				   - v_e * rho_ef * 1 / kappa_e * (t1 - 1 / kappa_e * Math.exp (-kappa_e * t2) * (Math.exp (kappa_e * t1) - 1) - 1 / kappa_f * (1 - Math.exp (-kappa_f * t1))
								   + 1 / (kappa_e + kappa_f) * Math.exp (-kappa_e * t2) * (Math.exp (kappa_e * t1) - Math.exp (-kappa_f * t1))));

	vz = Math.sqrt (vz);

	const d1 = (Math.log (f_t / x) - vxz + (vz * vz) / 2) / vz;
	const d2 = (Math.log (f_t / x) - vxz - (vz * vz) / 2) / vz;

	switch (side) {
	case OS_Call:
		return p_t * (f_t * Math.exp (-vxz) * normalCdf (d1) - x * normalCdf (d2));
	case OS_Put:
		return p_t * (x * normalCdf (-d2) - f_t * Math.exp (-vxz) * normalCdf (-d1));
	default:
		return NaN;
	}

}
function opt_miltersen_schwartz(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const p_t =  numberArg(argv, 1, host);
	const f_t =  numberArg(argv, 2, host);
	const x =  numberArg(argv, 3, host);
	const t1 =  numberArg(argv, 4, host);
	const t2 =  numberArg(argv, 5, host);
	const v_s =  numberArg(argv, 6, host);
	const v_e =  numberArg(argv, 7, host);
	const v_f =  numberArg(argv, 8, host);
	const rho_se =  numberArg(argv, 9, host);
	const rho_sf =  numberArg(argv, 10, host);
	const rho_ef =  numberArg(argv, 11, host);
	const kappa_e =  numberArg(argv, 12, host);
	const kappa_f =  numberArg(argv, 13, host);

	const gfresult = 
		opt_miltersen_schwartz1 (call_put, p_t, f_t, x, t1, t2,
					 v_s, v_e, v_f,
					 rho_se, rho_sf, rho_ef, kappa_e, kappa_f);

	if (Number.isNaN (gfresult))
		return error("#NUM!");
	return numericResult(gfresult);

}
function opt_rgw1(s: number, x: number, t1: number, t2: number, r: number, d: number, v: number, host: FunctionHost): number {

	
let i: number;
	



	let HighS: number;
let LowS: number;

	let ci: number;

	

	if (!(s > 0))
		return NaN;

	const infinity = 100000000;
	const epsilon = 0.00001;
	const sx = s - d * Math.exp (-r * t1);
	if (d <= (x * (1 - Math.exp (-r * (t2 - t1)))))
		
		return opt_bs1 (OS_Call, sx, x, t2, r, v, 0);

	ci = opt_bs1 (OS_Call, s, x, t2 - t1, r, v, 0);
	HighS = s;
	while ((ci - HighS - d + x) > 0 && HighS < infinity) { host.tick();

		HighS *= 2;
		ci = opt_bs1 (OS_Call, HighS, x, t2 - t1, r, v, 0);
	}
	if (HighS > infinity)
		return opt_bs1 (OS_Call, sx, x, t2, r, v, 0);

	LowS = 0.0;
	i = HighS * (0.5);
	ci = opt_bs1 (OS_Call, i, x, t2 - t1, r, v, 0);

	
	while (Math.abs (ci - i - d + x) > epsilon && HighS - LowS > epsilon) { host.tick();
		if ((ci - i - d + x) < 0)
			HighS = i;
		else
			LowS = i;
		i = (HighS + LowS) / 2;
		ci = opt_bs1 (OS_Call, i, x, (t2 - t1), r, v, 0);
	}

	const a1 = (Math.log (sx / x) + (r + (v * v) / 2) * t2) / (v * Math.sqrt (t2));
	const a2 = a1 - v * Math.sqrt (t2);
	const b1 = (Math.log (sx / i) + (r + (v * v) / 2) * t1) / (v * Math.sqrt (t1));
	const b2 = b1 - v * Math.sqrt (t1);

	const gfresult = sx * normalCdf (b1) + sx * cum_biv_norm_dist1 (a1, -b1, -Math.sqrt (t1 / t2), host)
		- x * Math.exp (-r * t2) * cum_biv_norm_dist1 (a2, -b2, -Math.sqrt (t1 / t2), host) - (x - d)
		* Math.exp (-r * t1) * normalCdf (b2);
	return gfresult;

}
function opt_rgw(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s =  numberArg(argv, 0, host);
	const x =  numberArg(argv, 1, host);
	const t1 =  numberArg(argv, 2, host);
	const t2 =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const d =  numberArg(argv, 5, host);
	const v =  numberArg(argv, 6, host);
	let gfresult =  0.0;

	gfresult = opt_rgw1 (s, x, t1, t2, r, d, v, host);

	return numericResult(gfresult);

}
function opt_baw_amer(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  numberArg(argv, 6, host);
	let gfresult: number;

	switch (call_put) {
	case OS_Call:
		gfresult = opt_baw_call (s, x, t, r, v, b, host);
		break;
	case OS_Put:
		gfresult = opt_baw_put (s, x, t, r, v, b, host);
		break;
	default:
		return error("#NUM!");
	}

	if (Number.isNaN (gfresult))
		return error("#NUM!");

	return numericResult(gfresult);

}
function opt_baw_call(s: number, x: number, t: number, r: number, v: number, b: number, host: FunctionHost): number {

	let sk: number;
let n: number;
let k: number;
	let d1: number;
let q2: number;
let a2: number;
	let gfresult: number;
	if (b >= r)
		gfresult = opt_bs1 (OS_Call, s, x, t, r, v, b);
	else
	{
		sk = NRA_c (x, t, r, v, b, host);
		n = 2 * b / (v * v);
		k = 2 * r / ((v * v) * (1 - Math.exp (-r * t)));
		d1 = (Math.log (sk / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
		q2 = (-(n - 1) + Math.sqrt ((n - 1) * (n - 1) + 4 * k)) / 2;
		a2 = (sk / q2) * (1 - Math.exp ((b - r) * t) * normalCdf (d1));
		if (s < sk)
			gfresult = opt_bs1 (OS_Call, s, x, t, r, v, b) + a2 * Math.pow (s / sk, q2);
		else
			gfresult = s - x;

	} 
	return gfresult;

}
function NRA_c(x: number, t: number, r: number, v: number, b: number, host: FunctionHost): number {

	

	
let si: number;
	

	let d1: number;


	let LHS: number;
let RHS: number;
	let bi: number;


	
	const n = 2 * b / (v * v);
	const m = 2 * r / (v * v);
	const q2u = (-(n - 1) + Math.sqrt (((n - 1) * (n - 1)) + 4 * m)) / 2;
	const su = x / (1 - 1 / q2u);
	const h2 = -(b * t + 2 * v * Math.sqrt (t)) * x / (su - x);
	si = x + (su - x) * (1 - Math.exp (h2));

	const k = 2 * r / ((v * v) * (1 - Math.exp (-r * t)));
	d1 = (Math.log (si / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const q2 = (-(n - 1) + Math.sqrt (((n - 1) * (n - 1)) + 4 * k)) / 2;
	LHS = si - x;
	RHS = opt_bs1 (OS_Call, si, x, t, r, v, b) + (1 - Math.exp ((b - r) * t) * normalCdf (d1)) * si / q2;
	bi = Math.exp ((b - r) * t) * normalCdf (d1) * (1 - 1 / q2)
		+ (1 - Math.exp ((b - r) * t) * normalCdf (d1) / (v * Math.sqrt (t))) / q2;
	const e = 0.000001;

	
	while ((Math.abs (LHS - RHS) / x) > e) { host.tick();
		si = (x + RHS - bi * si) / (1 - bi);
		d1 = (Math.log (si / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
		LHS = si - x;
		RHS = opt_bs1 (OS_Call, si, x, t, r, v, b) + (1 - Math.exp ((b - r) * t) * normalCdf (d1)) * si / q2;
		bi = Math.exp ((b - r) * t) * normalCdf (d1) * (1 - 1 / q2)
			+ (1 - Math.exp ((b - r) * t) * npdf (d1) / (v * Math.sqrt (t))) / q2;
	}
	return si;

}
function opt_baw_put(s: number, x: number, t: number, r: number, v: number, b: number, host: FunctionHost): number {

	const sk =  NRA_p (x, t, r, v, b, host);
	const n =  2 * b / (v * v);
	const k =  2 * r / ((v * v) * (1 - Math.exp (-r * t)));
	const d1 =  (Math.log (sk / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const q1 =  (-(n - 1) - Math.sqrt (((n - 1) * (n - 1)) + 4 * k)) / 2;
	const a1 =  -(sk / q1) * (1 - Math.exp ((b - r) * t) * normalCdf (-d1));

	if (s > sk)
		return opt_bs1 (OS_Put, s, x, t, r, v, b) + a1 * Math.pow (s/ sk, q1);
	else
		return x - s;

}
function NRA_p(x: number, t: number, r: number, v: number, b: number, host: FunctionHost): number {


	

	
let si: number;
	

	let d1: number;


	let LHS: number;
let RHS: number;
	let bi: number;


	
	const n = 2 * b / (v * v);
	const m = 2 * r / (v * v);
	const q1u = (-(n - 1) - Math.sqrt (((n - 1) * (n - 1)) + 4 * m)) / 2;
	const su = x / (1 - 1 / q1u);
	const h1 = (b * t - 2 * v * Math.sqrt (t)) * x / (x - su);
	si = su + (x - su) * Math.exp (h1);

	const k = 2 * r / ((v * v) * (1 - Math.exp (-r * t)));
	d1 = (Math.log (si / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const q1 = (-(n - 1) - Math.sqrt (((n - 1) * (n - 1)) + 4 * k)) / 2;
	LHS = x - si;
	RHS = opt_bs1 (OS_Put, si, x, t, r, v, b) - (1 - Math.exp ((b - r) * t) * normalCdf (-d1)) * si / q1;
	bi = -Math.exp ((b - r) * t) * normalCdf (-d1) * (1 - 1 / q1)
		- (1 + Math.exp ((b - r) * t) * npdf (-d1) / (v * Math.sqrt (t))) / q1;
	const e = 0.000001;

	
	while(Math.abs (LHS - RHS) / x > e) { host.tick();
		si = (x - RHS + bi * si) / (1 + bi);
		d1 = (Math.log (si / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
		LHS = x - si;
		RHS = opt_bs1 (OS_Put, si, x, t, r, v, b) - (1 - Math.exp ((b - r) * t) * normalCdf (-d1)) * si / q1;
		bi = -Math.exp ((b - r) * t) * normalCdf (-d1) * (1 - 1 / q1)
			- (1 + Math.exp ((b - r) * t) * normalCdf (-d1) / (v * Math.sqrt (t))) / q1;
	}
	return si;

}
function opt_bjer_stens1(side: number, s: number, x: number, t: number, r: number, v: number, b: number): number {

	switch (side) {
	case OS_Call:
		return opt_bjer_stens1_c (s, x, t, r, v, b);
	case OS_Put:
		
		return opt_bjer_stens1_c (x, s, t, r - b, v, -b);
	default:
		return NaN;
	}

}
function opt_bjer_stens(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  argv[6]! ? numberArg(argv, 6, host) : 0;
	const gfresult = 
		opt_bjer_stens1 (call_put, s, x, t, r, v, b);
	return numericResult(gfresult);

}
function opt_bjer_stens1_c(s: number, x: number, t: number, r: number, v: number, b: number): number {

	if (b >= r) 
		return opt_bs1 (OS_Call, s, x, t, r, v, b);
	else {
		const Beta = 
			((0.5) - b / (v * v)) +
			Math.sqrt (Math.pow (b / (v * v) - (0.5), 2) + 2 * r / (v * v));
		const BInfinity =  Beta / (Beta - 1) * x;
		const B0 =  Math.max (x, r / (r - b) * x);
		const ht =  -(b * t + 2 * v * Math.sqrt (t)) * B0 / (BInfinity - B0);
		const I =  B0 + (BInfinity - B0) * (1 - Math.exp (ht));
		if (s >= I)
			return s - x;
		else {
			const alpha =  (I - x) * Math.pow (I ,-Beta);
			return alpha * Math.pow (s ,Beta) -
				alpha * phi (s, t, Beta, I, I, r, v, b) +
				phi (s, t, 1, I, I, r, v, b) -
				phi (s, t, 1, x, I, r, v, b) -
				x * phi (s, t, 0, I, I, r, v, b) +
				x * phi (s, t, 0, x, I, r, v, b);
		}
	}

}
function phi(s: number, t: number, gamma: number, H: number, I: number, r: number, v: number, b: number): number {

	

	
	

	const lambda = (-r + gamma * b + (0.5) * gamma * (gamma - 1) * (v * v)) * t;
	const d = -(Math.log (s / H) + (b + (gamma - (0.5)) * (v * v)) * t) / (v * Math.sqrt (t));
	const kappa = 2 * b / (v * v) + (2 * gamma - 1);
	const gfresult = Math.exp (lambda) * Math.pow (s, gamma) * (normalCdf (d) - Math.pow (I / s, kappa) * normalCdf (d - 2 * Math.log (I / s) / (v * Math.sqrt (t))));

	return gfresult;

}
function opt_exec(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const v =  numberArg(argv, 5, host);
	const b =  numberArg(argv, 6, host);
	const lambda =  numberArg(argv, 7, host);
	const gfresult = 
		Math.exp (-lambda * t) * opt_bs1 (call_put, s, x, t, r, v, b);
	return numericResult(gfresult);

}
function opt_forward_start(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const alpha =  numberArg(argv, 2, host);
	const t1 =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const v =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const gfresult = 
		s * Math.exp ((b - r) * t1) * opt_bs1 (call_put, 1, alpha, t - t1, r, v, b);
	return numericResult(gfresult);


}
function opt_time_switch(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x =  numberArg(argv, 2, host);
	const a =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const m =  numberArg(argv, 5, host);
	const dt =  numberArg(argv, 6, host);
	const r =  numberArg(argv, 7, host);
	const b =  numberArg(argv, 8, host);
	const v =  numberArg(argv, 9, host);

	
	let sum: number;
let d: number;
	let i: number;

let Z =  0;

	switch (call_put) {
	case OS_Call: Z = +1; break;
	case OS_Put: Z = -1; break;
	default: return error("#NUM!");
	}

	sum = 0.0;
	// Released native evaluation reports #NUM! for division by a zero time step;
	// do not turn its nonfinite loop bound into an unbounded JavaScript loop.
	if (dt === 0) return error("#NUM!");
	const n = Math.trunc(t / dt);
	for (i = 1; i < n; ++i) { host.tick();
		d = (Math.log (s / x) + (b - (v * v) / 2) * i * dt) / (v * Math.sqrt (i * dt));
		sum = sum + normalCdf (Z * d) * dt;
	}

	const gfresult = a * Math.exp (-r * t) * sum + dt * a * Math.exp (-r * t) * m;
	return numericResult(gfresult);


}
function opt_simple_chooser(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s =  numberArg(argv, 0, host);
	const x =  numberArg(argv, 1, host);
	const t1 =  numberArg(argv, 2, host);
	const t2 =  numberArg(argv, 3, host);
	const r =  numberArg(argv, 4, host);
	const b =  numberArg(argv, 5, host);
	const v =  numberArg(argv, 6, host);

	const d =  (Math.log (s / x) + (b + (v * v) / 2) * t2) / (v * Math.sqrt (t2));
	const y =  (Math.log (s / x) + b * t2 + (v * v) * t1 / 2) / (v * Math.sqrt (t1));
	const gfresult = 
		s * Math.exp ((b - r) * t2) * normalCdf ( d) - x * Math.exp (-r * t2) * normalCdf ( d - v * Math.sqrt (t2)) -
		s * Math.exp ((b - r) * t2) * normalCdf (-y) + x * Math.exp (-r * t2) * normalCdf (-y + v * Math.sqrt (t1));

	return numericResult(gfresult);

}
function opt_complex_chooser(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s =  numberArg(argv, 0, host);
	const xc =  numberArg(argv, 1, host);
	const xp =  numberArg(argv, 2, host);
	const t =  numberArg(argv, 3, host);
	const tc =  numberArg(argv, 4, host);
	const tp =  numberArg(argv, 5, host);
	const r =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const v =  numberArg(argv, 8, host);

	

	



	



	const I = opt_crit_val_chooser (s, xc, xp, t, tc, tp, r, b, v, host);
	const d1 = (Math.log (s / I) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 = d1 - v * Math.sqrt (t);
	const y1 = (Math.log (s / xc) + (b + (v * v) / 2) * tc) / (v * Math.sqrt (tc));
	const y2 = (Math.log (s / xp) + (b + (v * v) / 2) * tp) / (v * Math.sqrt (tp));
	const rho1 = Math.sqrt (t / tc);
	const rho2 = Math.sqrt (t / tp);

	const gfresult = s * Math.exp ((b - r) * tc) * cum_biv_norm_dist1 (d1, y1, rho1, host) - xc * Math.exp (-r * tc)
		* cum_biv_norm_dist1 (d2, y1 - v * Math.sqrt (tc), rho1, host) - s * Math.exp ((b - r) * tp)
		* cum_biv_norm_dist1 (-d1, -y2, rho2, host) + xp * Math.exp (-r * tp) * cum_biv_norm_dist1 (-d2, -y2 + v * Math.sqrt (tp), rho2, host);

	return numericResult(gfresult);


}
function opt_crit_val_chooser(s: number, xc: number, xp: number, t: number, tc: number, tp: number, r: number, b: number, v: number, host: FunctionHost): number {

	let sv: number;
let ci: number;
let Pi: number;

	let dc: number;
let dp: number;
let yi: number;
let di: number;

	sv = s;
	ci = opt_bs1 (OS_Call, sv, xc, tc - t, r, v, b);
	Pi = opt_bs1 (OS_Put, sv, xp, tp - t, r, v, b);
	dc = opt_bs_delta1 (OS_Call, sv, xc, tc - t, r, v, b);
	dp = opt_bs_delta1 (OS_Put, sv, xp, tp - t, r, v, b);
	yi = ci - Pi;
	di = dc - dp;
	const epsilon = 0.001;
	
	while (Math.abs (yi) > epsilon) { host.tick();
		sv = sv - (yi) / di;
		ci = opt_bs1 (OS_Call, sv, xc, tc - t, r, v, b);
		Pi = opt_bs1 (OS_Put, sv, xp, tp - t, r, v, b);
		dc = opt_bs_delta1 (OS_Call, sv, xc, tc - t, r, v, b);
		dp = opt_bs_delta1 (OS_Put, sv, xp, tp - t, r, v, b);
		yi = ci - Pi;
		di = dc - dp;
	}

	return sv;

}
function opt_on_options(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const type_flag = textArg(argv, 0, host);
	const s =  numberArg(argv, 1, host);
	const x1 =  numberArg(argv, 2, host);
	const x2 =  numberArg(argv, 3, host);
	const t1 =  numberArg(argv, 4, host);
	const t2 =  numberArg(argv, 5, host);
	const r =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const v =  numberArg(argv, 8, host);

	let gfresult: number;

	



	

	let call_put: number;

	if (type_flag === "cc" || type_flag === "pc")
		call_put = OS_Call;
	else
		call_put = OS_Put;

	const I = CriticalValueOptionsOnOptions (call_put, x1, x2, t2 - t1, r, b, v, host);

	const rho = Math.sqrt (t1 / t2);
	const y1 = (Math.log (s / I) + (b + (v * v) / 2) * t1) / (v * Math.sqrt (t1));
	const y2 = y1 - v * Math.sqrt (t1);
	const z1 = (Math.log (s / x1) + (b + (v * v) / 2) * t2) / (v * Math.sqrt (t2));
	const z2 = z1 - v * Math.sqrt (t2);

	if (type_flag === "cc")
		gfresult = s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (z1, y1, rho, host) -
			x1 * Math.exp (-r * t2) * cum_biv_norm_dist1 (z2, y2, rho, host) - x2 * Math.exp (-r * t1) * normalCdf (y2);
	else if (type_flag === "pc")
		gfresult = x1 * Math.exp (-r * t2) * cum_biv_norm_dist1 (z2, -y2, -rho, host) -
			s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (z1, -y1, -rho, host) + x2 * Math.exp (-r * t1) * normalCdf (-y2);
	else if (type_flag === "cp")
		gfresult = x1 * Math.exp (-r * t2) * cum_biv_norm_dist1 (-z2, -y2, rho, host) -
			s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (-z1, -y1, rho, host) - x2 * Math.exp (-r * t1) * normalCdf (-y2);
	else if (type_flag === "pp")
		gfresult = s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (-z1, y1, -rho, host) -
			x1 * Math.exp (-r * t2) * cum_biv_norm_dist1 (-z2, y2, -rho, host) + Math.exp (-r * t1) * x2 * normalCdf (y2);
	else
		return error("#VALUE!");

	return numericResult(gfresult);

}
function CriticalValueOptionsOnOptions(side: number, x1: number, x2: number, t: number, r: number, b: number, v: number, host: FunctionHost): number {

	let si: number;
let ci: number;
let di: number;


	si = x1;
	ci = opt_bs1 (side, si, x1, t, r, v, b);
	di = opt_bs_delta1 (side, si, x1, t, r, v, b);

	
	const epsilon = 0.0001;
	while (Math.abs (ci - x2) > epsilon) { host.tick();
		si = si - (ci - x2) / di;
		ci = opt_bs1 (side, si, x1, t, r, v, b);
		di = opt_bs_delta1 (side, si, x1, t, r, v, b);
	}
	return si;

}
function opt_extendible_writer(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const x1 =  numberArg(argv, 2, host);
	const x2 =  numberArg(argv, 3, host);
	const t1 =  numberArg(argv, 4, host);
	const t2 =  numberArg(argv, 5, host);
	const r =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const v =  numberArg(argv, 8, host);

	const rho =  Math.sqrt (t1 / t2);
	const z1 =  (Math.log (s / x2) + (b + (v * v) / 2) * t2) / (v * Math.sqrt (t2));
	const z2 =  (Math.log (s / x1) + (b + (v * v) / 2) * t1) / (v * Math.sqrt (t1));

	let gfresult: number;

	switch (call_put) {
	case OS_Call:
		gfresult = opt_bs1 (call_put, s, x1, t1, r, v, b) +
			s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (z1, -z2, -rho, host) -
			x2 * Math.exp (-r * t2) * cum_biv_norm_dist1 (z1 - Math.sqrt ((v * v) * t2), -z2 + Math.sqrt ((v * v) * t1), -rho, host);
	break;
	case OS_Put:
		gfresult = opt_bs1 (call_put, s, x1, t1, r, v, b) +
			x2 * Math.exp (-r * t2) * cum_biv_norm_dist1 (-z1 + Math.sqrt ((v * v) * t2), z2 - Math.sqrt ((v * v) * t1), -rho, host) -
			s * Math.exp ((b - r) * t2) * cum_biv_norm_dist1 (-z1, z2, -rho, host);
	break;
	default:
		return error("#NUM!");
	}

	return numericResult(gfresult);

}
function opt_2_asset_correlation(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put =  option_side (textArg(argv, 0, host));
	const s1 =  numberArg(argv, 1, host);
	const s2 =  numberArg(argv, 2, host);
	const x1 =  numberArg(argv, 3, host);
	const x2 =  numberArg(argv, 4, host);
	const t =  numberArg(argv, 5, host);
	const b1 =  numberArg(argv, 6, host);
	const b2 =  numberArg(argv, 7, host);
	const r =  numberArg(argv, 8, host);
	const v1 =  numberArg(argv, 9, host);
	const v2 =  numberArg(argv, 10, host);
	const rho =  numberArg(argv, 11, host);

	const y1 =  (Math.log (s1 / x1) + (b1 - (v1 * v1) / 2) * t) / (v1 * Math.sqrt (t));
	const y2 =  (Math.log (s2 / x2) + (b2 - (v2 * v2) / 2) * t) / (v2 * Math.sqrt (t));

	if (call_put == OS_Call) {
		return numericResult(s2 * Math.exp ((b2 - r) * t)
					* cum_biv_norm_dist1 (y2 + v2 * Math.sqrt (t), y1 + rho * v2 * Math.sqrt (t), rho, host)
					- x2 * Math.exp (-r * t) * cum_biv_norm_dist1 (y2, y1, rho, host));
	} else if (call_put == OS_Put) {
		return numericResult(x2 * Math.exp (-r * t) * cum_biv_norm_dist1 (-y2, -y1, rho, host)
					- s2 * Math.exp ((b2 - r) * t) * cum_biv_norm_dist1 (-y2 - v2 * Math.sqrt (t), -y1 - rho * v2 * Math.sqrt (t), rho, host));
	} else
		return error("#NUM!");

}
function opt_euro_exchange(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s1 =  numberArg(argv, 0, host);
	const s2 =  numberArg(argv, 1, host);
	const q1 =  numberArg(argv, 2, host);
	const q2 =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const b1 =  numberArg(argv, 6, host);
	const b2 =  numberArg(argv, 7, host);
	const v1 =  numberArg(argv, 8, host);
	const v2 =  numberArg(argv, 9, host);
	const rho =  numberArg(argv, 10, host);
	



	const v = Math.sqrt (v1 * v1 + v2 * v2 - 2 * rho * v1 * v2);
	const d1 = (Math.log (q1 * s1 / (q2 * s2)) + (b1 - b2 + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 = d1 - v * Math.sqrt (t);

	return numericResult(q1 * s1 * Math.exp ((b1 - r) * t) * normalCdf (d1) -
				q2 * s2 * Math.exp ((b2 - r) * t) * normalCdf (d2));

}
function opt_amer_exchange(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const s1 =  numberArg(argv, 0, host);
	const s2 =  numberArg(argv, 1, host);
	const q1 =  numberArg(argv, 2, host);
	const q2 =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const b1 =  numberArg(argv, 6, host);
	const b2 =  numberArg(argv, 7, host);
	const v1 =  numberArg(argv, 8, host);
	const v2 =  numberArg(argv, 9, host);
	const rho =  numberArg(argv, 10, host);
	const v =  Math.sqrt (v1 * v1 + v2 * v2 - 2 * rho * v1 * v2);

	return numericResult(opt_bjer_stens1 (OS_Call, q1 * s1, q2 * s2, t, r - b2, v,b1 - b2));

}
function opt_spread_approx(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put_flag =  option_side (textArg(argv, 0, host));
	const f1 =  numberArg(argv, 1, host);
	const f2 =  numberArg(argv, 2, host);
	const x =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const v1 =  numberArg(argv, 6, host);
	const v2 =  numberArg(argv, 7, host);
	const rho =  numberArg(argv, 8, host);

	const v =  Math.sqrt (v1 * v1 + Math.pow ((v2 * f2 / (f2 + x)), 2) - 2 * rho * v1 * v2 * f2 / (f2 + x));
	const F =  f1 / (f2 + x);

	return numericResult(opt_bs1 (call_put_flag, F, 1, t, r, v, 0) * (f2 + x));

}
function opt_float_strk_lkbk(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put_flag =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const s_min =  numberArg(argv, 2, host);
	const s_max =  numberArg(argv, 3, host);
	const t =  numberArg(argv, 4, host);
	const r =  numberArg(argv, 5, host);
	const b =  numberArg(argv, 6, host);
	const v =  numberArg(argv, 7, host);

	

let m: number;

	if (OS_Call == call_put_flag)
		m = s_min;
	else if (OS_Put == call_put_flag)
		m = s_max;
	else
		return error("#NUM!");

	const a1 = (Math.log (s / m) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const a2 = a1 - v * Math.sqrt (t);

	if (OS_Call == call_put_flag)
		return numericResult(s * Math.exp ((b - r) * t) * normalCdf (a1) -
					m * Math.exp (-r * t) * normalCdf (a2) +
					Math.exp (-r * t) * (v * v) / (2 * b) * s * (Math.pow (s / m, (-2 * b / (v * v))) * normalCdf (-a1 + 2 * b / v * Math.sqrt (t)) -
										    Math.exp (b * t) * normalCdf (-a1)));
	else if (OS_Put == call_put_flag)
		return numericResult(m * Math.exp (-r * t) * normalCdf (-a2) -
					s * Math.exp ((b - r) * t) * normalCdf (-a1) +
					Math.exp (-r * t) * (v * v) / (2 * b) * s * (-Math.pow (s / m, ((-2 * b) / (v * v))) * normalCdf (a1 - 2 * b / v * Math.sqrt (t)) +
										    Math.exp (b * t) * normalCdf (a1)));

	return error("#VALUE!");

}
function opt_fixed_strk_lkbk(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const call_put_flag =  option_side (textArg(argv, 0, host));
	const s =  numberArg(argv, 1, host);
	const s_min =  numberArg(argv, 2, host);
	const s_max =  numberArg(argv, 3, host);
	const x =  numberArg(argv, 4, host);
	const t =  numberArg(argv, 5, host);
	const r =  numberArg(argv, 6, host);
	const b =  numberArg(argv, 7, host);
	const v =  numberArg(argv, 8, host);

	

	

let m: number;

	if (OS_Call == call_put_flag)
		m = s_max;
	else if (OS_Put == call_put_flag)
		m = s_min;
	else
		return error("#VALUE!");

	const d1 = (Math.log (s / x) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const d2 = d1 - v * Math.sqrt (t);
	const e1 = (Math.log (s / m) + (b + (v * v) / 2) * t) / (v * Math.sqrt (t));
	const e2 = e1 - v * Math.sqrt (t);

	if (OS_Call == call_put_flag && x > m)
		return numericResult(s * Math.exp ((b - r) * t) * normalCdf (d1) - x * Math.exp (-r * t) * normalCdf (d2) + s * Math.exp (-r * t) * (v * v) / (2 * b) * (-Math.pow ((s / x), (-2 * b / (v * v))) * normalCdf (d1 - 2 * b / v * Math.sqrt (t)) + Math.exp (b * t) * normalCdf (d1)));

	else if (OS_Call == call_put_flag && x <= m)
		return numericResult(Math.exp (-r * t) * (m - x) + s * Math.exp ((b - r) * t) * normalCdf (e1) - Math.exp (-r * t) * m * normalCdf (e2) + s * Math.exp (-r * t) * (v * v) / (2 * b) * (-Math.pow ((s / m), (-2 * b / (v * v))) * normalCdf (e1 - 2 * b / v * Math.sqrt (t)) + Math.exp (b * t) * normalCdf (e1)));

	else if (OS_Put == call_put_flag && x < m)
		return numericResult(-s * Math.exp ((b - r) * t) * normalCdf (-d1) + x * Math.exp (-r * t) * normalCdf (-d1 + v * Math.sqrt (t)) + s * Math.exp (-r * t) * (v * v) / (2 * b) * (Math.pow ((s / x), (-2 * b / (v * v))) * normalCdf (-d1 + 2 * b / v * Math.sqrt (t)) - Math.exp (b * t) * normalCdf (-d1)));

	else if (OS_Put == call_put_flag && x >= m)
		return numericResult(Math.exp (-r * t) * (x - m) - s * Math.exp ((b - r) * t) * normalCdf (-e1) + Math.exp (-r * t) * m * normalCdf (-e1 + v * Math.sqrt (t)) + Math.exp (-r * t) * (v * v) / (2 * b) * s * (Math.pow ((s / m), (-2 * b / (v * v))) * normalCdf (-e1 + 2 * b / v * Math.sqrt (t)) - Math.exp (b * t) * normalCdf (-e1)));

	return error("#VALUE!");

}
function opt_binomial(argv: readonly (Value | undefined)[], host: FunctionHost): Value {

	const amer_euro_flag =  option_type(textArg(argv, 0, host));
	const call_put_flag =  option_side (textArg(argv, 1, host));
	const n =  Math.floor (numberArg(argv, 2, host));
	const s =  numberArg(argv, 3, host);
	const x =  numberArg(argv, 4, host);
	const t =  numberArg(argv, 5, host);
	const r =  numberArg(argv, 6, host);
	const v =  numberArg(argv, 7, host);
	const b =  argv[8]! ? numberArg(argv, 8, host) : 0;

	
	




let temp1: number;
let temp2: number;

	let i: number;
let j: number;
let z: number;

	if (n < 0 || n > 100000)
		return error("#NUM!");

	if (OS_Call == call_put_flag)
		z = 1;
        else if (OS_Put == call_put_flag)
		z = -1;
	else
		return error("#NUM!");

	if (OT_Error == amer_euro_flag)
		return error("#NUM!");

	if (n + 2 > host.context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert calculation array limit exceeded");
 const value_array = Array.from({ length: n + 2 }, () => 0);
	

	const dt = t / n;
	const u = Math.exp (v * Math.sqrt (dt));
	const d = 1 / u;
	const p = (Math.exp (b * dt) - d) / (u - d);
	const Df = Math.exp (-r * dt);

	for (i = 0; i <= n; ++i) { host.tick();
		temp1 = z * (s * Math.pow (u, i) * Math.pow (d, (n - i)) - x);
		value_array[i] = Math.max (temp1, 0);
	    }

	for (j = n - 1; j > -1; --j) { host.tick();
		for (i = 0; i <= j; ++i) { host.tick();
			
			if (OT_Euro == amer_euro_flag)
				value_array[i] = (p * value_array[i + 1]! + (1 - p) * value_array[i]!) * Df;
			else if (OT_Amer == amer_euro_flag) {
				temp1 = z * (s * Math.pow (u, i) * Math.pow (d, (Math.abs ((i - j)))) - x);
				temp2 = (p * value_array[i + 1]! + (1 - p) * value_array[i]!) * Df;
				value_array[i] = Math.max (temp1, temp2);
			}
		}
	}
	const gf_result = value_array[0]!;
	
	return numericResult(gf_result);

}
export const derivativeFunctions: Readonly<Record<string, FunctionImplementation>> = {
OPT_BS: opt_bs,
OPT_BS_DELTA: opt_bs_delta,
OPT_BS_RHO: opt_bs_rho,
OPT_BS_THETA: opt_bs_theta,
OPT_BS_GAMMA: opt_bs_gamma,
OPT_BS_VEGA: opt_bs_vega,
OPT_BS_CARRYCOST: opt_bs_carrycost,
CUM_BIV_NORM_DIST: cum_biv_norm_dist,
OPT_GARMAN_KOHLHAGEN: opt_garman_kohlhagen,
OPT_FRENCH: opt_french,
OPT_JUMP_DIFF: opt_jump_diff,
OPT_EXEC: opt_exec,
OPT_BJER_STENS: opt_bjer_stens,
OPT_MILTERSEN_SCHWARTZ: opt_miltersen_schwartz,
OPT_BAW_AMER: opt_baw_amer,
OPT_RGW: opt_rgw,
OPT_FORWARD_START: opt_forward_start,
OPT_TIME_SWITCH: opt_time_switch,
OPT_SIMPLE_CHOOSER: opt_simple_chooser,
OPT_COMPLEX_CHOOSER: opt_complex_chooser,
OPT_ON_OPTIONS: opt_on_options,
OPT_EXTENDIBLE_WRITER: opt_extendible_writer,
OPT_2_ASSET_CORRELATION: opt_2_asset_correlation,
OPT_EURO_EXCHANGE: opt_euro_exchange,
OPT_AMER_EXCHANGE: opt_amer_exchange,
OPT_SPREAD_APPROX: opt_spread_approx,
OPT_FLOAT_STRK_LKBK: opt_float_strk_lkbk,
OPT_FIXED_STRK_LKBK: opt_fixed_strk_lkbk,
OPT_BINOMIAL: opt_binomial
};
