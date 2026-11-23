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

#[path = "office_formula_options_normal.rs"]
pub(in super::super) mod normal;
use super::super::statistics::logarithm::ln;
use super::power::pow;
use normal::{cdf, exp};

pub(in super::super) fn calculate(
    name: &str,
    numbers: [f64; 13],
    flags: [&str; 2],
    work: &mut usize,
) -> Option<Result<f64, &'static str>> {
    let call = match flags[usize::from(name == "OPT_BINOMIAL")]
        .as_bytes()
        .first()
    {
        Some(b'c' | b'C') => Some(true),
        Some(b'p' | b'P') => Some(false),
        _ => None,
    };
    if call.is_none()
        && !matches!(
            name,
            "OPT_BS_GAMMA"
                | "OPT_BS_VEGA"
                | "OPT_SIMPLE_CHOOSER"
                | "OPT_COMPLEX_CHOOSER"
                | "CUM_BIV_NORM_DIST"
                | "OPT_RGW"
                | "OPT_EURO_EXCHANGE"
                | "OPT_AMER_EXCHANGE"
                | "OPT_ON_OPTIONS"
        )
    {
        return Some(Err(if name == "OPT_FIXED_STRK_LKBK" {
            "#VALUE!"
        } else {
            "#NUM!"
        }));
    }
    let call = call.unwrap_or(true);
    let result = if name == "CUM_BIV_NORM_DIST" {
        normal::bivariate(numbers[0], numbers[1], numbers[2], work)?
    } else if name == "OPT_RGW" {
        let [
            spot,
            strike,
            dividend_time,
            time,
            rate,
            dividend,
            volatility,
            ..,
        ] = numbers;
        if spot <= 0. {
            return Some(Err("#NUM!"));
        }
        let adjusted = spot - dividend * exp(-rate * dividend_time);
        let mut high = spot;
        let mut value = black_scholes(
            true,
            high,
            strike,
            time - dividend_time,
            rate,
            volatility,
            0.,
        );
        if dividend > strike * (1. - exp(-rate * (time - dividend_time))) {
            while value - high - dividend + strike > 0. && high < 100000000. {
                *work = work.checked_sub(1)?;
                high *= 2.;
                value = black_scholes(
                    true,
                    high,
                    strike,
                    time - dividend_time,
                    rate,
                    volatility,
                    0.,
                );
            }
        }
        if dividend <= strike * (1. - exp(-rate * (time - dividend_time))) || high > 100000000. {
            black_scholes(true, adjusted, strike, time, rate, volatility, 0.)
        } else {
            let mut low = 0.;
            let mut critical = high * 0.5;
            value = black_scholes(
                true,
                critical,
                strike,
                time - dividend_time,
                rate,
                volatility,
                0.,
            );
            while (value - critical - dividend + strike).abs() > 0.00001 && high - low > 0.00001 {
                *work = work.checked_sub(1)?;
                if value - critical - dividend + strike < 0. {
                    high = critical;
                } else {
                    low = critical;
                }
                critical = (high + low) / 2.;
                value = black_scholes(
                    true,
                    critical,
                    strike,
                    time - dividend_time,
                    rate,
                    volatility,
                    0.,
                );
            }
            let a1 = (ln(adjusted / strike) + (rate + volatility * volatility / 2.) * time)
                / (volatility * time.sqrt());
            let a2 = a1 - volatility * time.sqrt();
            let b1 = (ln(adjusted / critical)
                + (rate + volatility * volatility / 2.) * dividend_time)
                / (volatility * dividend_time.sqrt());
            let b2 = b1 - volatility * dividend_time.sqrt();
            let rho = -(dividend_time / time).sqrt();
            adjusted * cdf(b1) + adjusted * normal::bivariate(a1, -b1, rho, work)?
                - strike * exp(-rate * time) * normal::bivariate(a2, -b2, rho, work)?
                - (strike - dividend) * exp(-rate * dividend_time) * cdf(b2)
        }
    } else if matches!(name, "OPT_BJER_STENS" | "OPT_BAW_AMER") {
        let [spot, strike, time, rate, volatility, carry, ..] = numbers;
        if name == "OPT_BAW_AMER" {
            baw(call, spot, strike, time, rate, volatility, carry, work)?
        } else if call {
            bjer_stens(spot, strike, time, rate, volatility, carry)
        } else {
            bjer_stens(strike, spot, time, rate - carry, volatility, -carry)
        }
    } else if matches!(name, "OPT_EURO_EXCHANGE" | "OPT_AMER_EXCHANGE") {
        let [
            spot1,
            spot2,
            quantity1,
            quantity2,
            time,
            rate,
            carry1,
            carry2,
            vol1,
            vol2,
            rho,
            ..,
        ] = numbers;
        let volatility = (vol1 * vol1 + vol2 * vol2 - 2. * rho * vol1 * vol2).sqrt();
        if name == "OPT_AMER_EXCHANGE" {
            bjer_stens(
                quantity1 * spot1,
                quantity2 * spot2,
                time,
                rate - carry2,
                volatility,
                carry1 - carry2,
            )
        } else {
            let d1 = (ln(quantity1 * spot1 / (quantity2 * spot2))
                + (carry1 - carry2 + volatility * volatility / 2.) * time)
                / (volatility * time.sqrt());
            let d2 = d1 - volatility * time.sqrt();
            quantity1 * spot1 * exp((carry1 - rate) * time) * cdf(d1)
                - quantity2 * spot2 * exp((carry2 - rate) * time) * cdf(d2)
        }
    } else if name == "OPT_2_ASSET_CORRELATION" {
        let [
            spot1,
            spot2,
            strike1,
            strike2,
            time,
            carry1,
            carry2,
            rate,
            vol1,
            vol2,
            rho,
            ..,
        ] = numbers;
        let y1 = (ln(spot1 / strike1) + (carry1 - vol1 * vol1 / 2.) * time) / (vol1 * time.sqrt());
        let y2 = (ln(spot2 / strike2) + (carry2 - vol2 * vol2 / 2.) * time) / (vol2 * time.sqrt());
        if call {
            spot2
                * exp((carry2 - rate) * time)
                * normal::bivariate(
                    y2 + vol2 * time.sqrt(),
                    y1 + rho * vol2 * time.sqrt(),
                    rho,
                    work,
                )?
                - strike2 * exp(-rate * time) * normal::bivariate(y2, y1, rho, work)?
        } else {
            strike2 * exp(-rate * time) * normal::bivariate(-y2, -y1, rho, work)?
                - spot2
                    * exp((carry2 - rate) * time)
                    * normal::bivariate(
                        -y2 - vol2 * time.sqrt(),
                        -y1 - rho * vol2 * time.sqrt(),
                        rho,
                        work,
                    )?
        }
    } else if name == "OPT_MILTERSEN_SCHWARTZ" {
        let [
            discount,
            forward,
            strike,
            t1,
            t2,
            vs,
            ve,
            vf,
            rho_se,
            rho_sf,
            rho_ef,
            ke,
            kf,
        ] = numbers;
        let variance = vs * vs * t1
            + 2. * vs
                * (vf * rho_sf / kf * (t1 - 1. / kf * exp(-kf * t2) * (exp(kf * t1) - 1.))
                    - ve * rho_se / ke * (t1 - 1. / ke * exp(-ke * t2) * (exp(ke * t1) - 1.)))
            + ve * ve / (ke * ke)
                * (t1 + 1. / (2. * ke) * exp(-2. * ke * t2) * (exp(2. * ke * t1) - 1.)
                    - 2. / ke * exp(-ke * t2) * (exp(ke * t1) - 1.))
            + vf * vf / (kf * kf)
                * (t1 + 1. / (2. * kf) * exp(-2. * kf * t2) * (exp(2. * kf * t1) - 1.)
                    - 2. / kf * exp(-kf * t2) * (exp(kf * t1) - 1.))
            - 2. * ve * vf * rho_ef / ke / kf
                * (t1
                    - 1. / ke * exp(-ke * t2) * (exp(ke * t1) - 1.)
                    - 1. / kf * exp(-kf * t2) * (exp(kf * t1) - 1.)
                    + 1. / (ke + kf) * exp(-(ke + kf) * t2) * (exp((ke + kf) * t1) - 1.));
        let covariance = vf / kf
            * (vs * rho_sf * (t1 - 1. / kf * (1. - exp(-kf * t1)))
                + vf / kf
                    * (t1
                        - 1. / kf * exp(-kf * t2) * (exp(kf * t1) - 1.)
                        - 1. / kf * (1. - exp(-kf * t1))
                        + 1. / (2. * kf) * exp(-kf * t2) * (exp(kf * t1) - exp(-kf * t1)))
                - ve * rho_ef / ke
                    * (t1
                        - 1. / ke * exp(-ke * t2) * (exp(ke * t1) - 1.)
                        - 1. / kf * (1. - exp(-kf * t1))
                        + 1. / (ke + kf) * exp(-ke * t2) * (exp(ke * t1) - exp(-kf * t1))));
        let width = variance.sqrt();
        let d1 = (ln(forward / strike) - covariance + width * width / 2.) / width;
        let d2 = (ln(forward / strike) - covariance - width * width / 2.) / width;
        discount
            * if call {
                forward * exp(-covariance) * cdf(d1) - strike * cdf(d2)
            } else {
                strike * cdf(-d2) - forward * exp(-covariance) * cdf(-d1)
            }
    } else if name == "OPT_ON_OPTIONS" {
        let [
            spot,
            strike1,
            strike2,
            time1,
            time2,
            rate,
            carry,
            volatility,
            ..,
        ] = numbers;
        let underlying_call = matches!(flags[0], "cc" | "pc");
        let mut critical = strike1;
        loop {
            let difference = black_scholes(
                underlying_call,
                critical,
                strike1,
                time2 - time1,
                rate,
                volatility,
                carry,
            ) - strike2;
            if difference.abs() > 0.0001 {
                *work = work.checked_sub(1)?;
                let d = (ln(critical / strike1)
                    + (carry + volatility * volatility / 2.) * (time2 - time1))
                    / (volatility * (time2 - time1).sqrt());
                let delta = exp((carry - rate) * (time2 - time1))
                    * if underlying_call { cdf(d) } else { cdf(d) - 1. };
                critical -= difference / delta;
            } else {
                break;
            }
        }
        let rho = (time1 / time2).sqrt();
        let y1 = (ln(spot / critical) + (carry + volatility * volatility / 2.) * time1)
            / (volatility * time1.sqrt());
        let y2 = y1 - volatility * time1.sqrt();
        let z1 = (ln(spot / strike1) + (carry + volatility * volatility / 2.) * time2)
            / (volatility * time2.sqrt());
        let z2 = z1 - volatility * time2.sqrt();
        match flags[0] {
            "cc" => {
                spot * exp((carry - rate) * time2) * normal::bivariate(z1, y1, rho, work)?
                    - strike1 * exp(-rate * time2) * normal::bivariate(z2, y2, rho, work)?
                    - strike2 * exp(-rate * time1) * cdf(y2)
            }
            "pc" => {
                strike1 * exp(-rate * time2) * normal::bivariate(z2, -y2, -rho, work)?
                    - spot * exp((carry - rate) * time2) * normal::bivariate(z1, -y1, -rho, work)?
                    + strike2 * exp(-rate * time1) * cdf(-y2)
            }
            "cp" => {
                strike1 * exp(-rate * time2) * normal::bivariate(-z2, -y2, rho, work)?
                    - spot * exp((carry - rate) * time2) * normal::bivariate(-z1, -y1, rho, work)?
                    - strike2 * exp(-rate * time1) * cdf(-y2)
            }
            "pp" => {
                spot * exp((carry - rate) * time2) * normal::bivariate(-z1, y1, -rho, work)?
                    - strike1 * exp(-rate * time2) * normal::bivariate(-z2, y2, -rho, work)?
                    + exp(-rate * time1) * strike2 * cdf(y2)
            }
            _ => return Some(Err("#VALUE!")),
        }
    } else if name == "OPT_BINOMIAL" {
        let [steps, spot, strike, time, rate, volatility, carry, ..] = numbers;
        let steps = steps.floor();
        if !(0. ..=100000.).contains(&steps) {
            return Some(Err("#NUM!"));
        }
        let american = match flags[0].as_bytes().first() {
            Some(b'a' | b'A') => true,
            Some(b'e' | b'E') => false,
            _ => return Some(Err("#NUM!")),
        };
        let count = steps as usize;
        *work = work.checked_sub(
            (count + 2)
                .checked_mul(8)?
                .checked_add(count.checked_mul(count + 1)? / 2 + 2 * count + 1)?,
        )?;
        let mut values = vec![0.; count + 2];
        let dt = time / steps;
        let up = exp(volatility * dt.sqrt());
        let down = 1. / up;
        let probability = (exp(carry * dt) - down) / (up - down);
        let discount = exp(-rate * dt);
        let direction = if call { 1. } else { -1. };
        for (i, value) in values.iter_mut().take(count + 1).enumerate() {
            let payoff =
                direction * (spot * pow(up, i as f64) * pow(down, steps - i as f64) - strike);
            *value = if payoff.is_nan() {
                payoff
            } else {
                payoff.max(0.)
            };
        }
        for j in (0..count).rev() {
            for i in 0..=j {
                let continuation =
                    (probability * values[i + 1] + (1. - probability) * values[i]) * discount;
                values[i] = if american {
                    let payoff =
                        direction * (spot * pow(up, i as f64) * pow(down, (j - i) as f64) - strike);
                    if payoff.is_nan() || continuation.is_nan() {
                        f64::NAN
                    } else {
                        payoff.max(continuation)
                    }
                } else {
                    continuation
                };
            }
        }
        values[0]
    } else if name == "OPT_COMPLEX_CHOOSER" {
        let [
            spot,
            call_strike,
            put_strike,
            choice,
            call_time,
            put_time,
            rate,
            carry,
            volatility,
            ..,
        ] = numbers;
        let variance = volatility * volatility;
        let mut estimate = spot;
        loop {
            let call_price = black_scholes(
                true,
                estimate,
                call_strike,
                call_time - choice,
                rate,
                volatility,
                carry,
            );
            let put_price = black_scholes(
                false,
                estimate,
                put_strike,
                put_time - choice,
                rate,
                volatility,
                carry,
            );
            let difference = call_price - put_price;
            // NaN also stops production's Newton iteration.
            if difference.abs() > 0.001 {
                *work = work.checked_sub(1)?;
                let call_d = (ln(estimate / call_strike)
                    + (carry + variance / 2.) * (call_time - choice))
                    / (volatility * (call_time - choice).sqrt());
                let put_d = (ln(estimate / put_strike)
                    + (carry + variance / 2.) * (put_time - choice))
                    / (volatility * (put_time - choice).sqrt());
                let call_delta = exp((carry - rate) * (call_time - choice)) * cdf(call_d);
                let put_delta = exp((carry - rate) * (put_time - choice)) * (cdf(put_d) - 1.);
                estimate -= difference / (call_delta - put_delta);
            } else {
                break;
            }
        }
        let d1 =
            (ln(spot / estimate) + (carry + variance / 2.) * choice) / (volatility * choice.sqrt());
        let d2 = d1 - volatility * choice.sqrt();
        let y1 = (ln(spot / call_strike) + (carry + variance / 2.) * call_time)
            / (volatility * call_time.sqrt());
        let y2 = (ln(spot / put_strike) + (carry + variance / 2.) * put_time)
            / (volatility * put_time.sqrt());
        let rho1 = (choice / call_time).sqrt();
        let rho2 = (choice / put_time).sqrt();
        spot * exp((carry - rate) * call_time) * normal::bivariate(d1, y1, rho1, work)?
            - call_strike
                * exp(-rate * call_time)
                * normal::bivariate(d2, y1 - volatility * call_time.sqrt(), rho1, work)?
            - spot * exp((carry - rate) * put_time) * normal::bivariate(-d1, -y2, rho2, work)?
            + put_strike
                * exp(-rate * put_time)
                * normal::bivariate(-d2, -y2 + volatility * put_time.sqrt(), rho2, work)?
    } else if name == "OPT_EXTENDIBLE_WRITER" {
        let [
            spot,
            strike1,
            strike2,
            time1,
            time2,
            rate,
            carry,
            volatility,
            ..,
        ] = numbers;
        let rho = (time1 / time2).sqrt();
        let variance = volatility * volatility;
        let z1 =
            (ln(spot / strike2) + (carry + variance / 2.) * time2) / (volatility * time2.sqrt());
        let z2 =
            (ln(spot / strike1) + (carry + variance / 2.) * time1) / (volatility * time1.sqrt());
        let width1 = (variance * time1).sqrt();
        let width2 = (variance * time2).sqrt();
        let base = black_scholes(call, spot, strike1, time1, rate, volatility, carry);
        if call {
            base + spot * exp((carry - rate) * time2) * normal::bivariate(z1, -z2, -rho, work)?
                - strike2
                    * exp(-rate * time2)
                    * normal::bivariate(z1 - width2, -z2 + width1, -rho, work)?
        } else {
            base + strike2
                * exp(-rate * time2)
                * normal::bivariate(-z1 + width2, z2 - width1, -rho, work)?
                - spot * exp((carry - rate) * time2) * normal::bivariate(-z1, z2, -rho, work)?
        }
    } else if name == "OPT_GARMAN_KOHLHAGEN" {
        let [spot, strike, time, rate, foreign, volatility, ..] = numbers;
        let width = volatility * time.sqrt();
        let d1 =
            (ln(spot / strike) + (rate - foreign + volatility * volatility / 2.) * time) / width;
        price(
            call,
            spot,
            strike,
            d1,
            d1 - width,
            exp(-foreign * time),
            exp(-rate * time),
        )
    } else if name == "OPT_FRENCH" {
        let [spot, strike, trading, calendar, rate, volatility, carry, ..] = numbers;
        let width = volatility * trading.sqrt();
        let d1 = (ln(spot / strike) + carry * calendar + (volatility * volatility / 2.) * trading)
            / width;
        price(
            call,
            spot,
            strike,
            d1,
            d1 - width,
            exp((carry - rate) * calendar),
            exp(-rate * calendar),
        )
    } else if name == "OPT_JUMP_DIFF" {
        let [spot, strike, time, rate, volatility, lambda, gamma, ..] = numbers;
        let delta = (gamma * (volatility * volatility) / lambda).sqrt();
        let z = ((volatility * volatility) - lambda * (delta * delta)).sqrt();
        let mut sum = 0.;
        let mut factorial = 1.;
        for i in 0..11 {
            if i > 1 {
                factorial *= f64::from(i);
            }
            let v = ((z * z) + (delta * delta) * (f64::from(i) / time)).sqrt();
            sum += exp(-lambda * time) * pow(lambda * time, f64::from(i)) / factorial
                * black_scholes(call, spot, strike, time, rate, v, rate);
        }
        sum
    } else if name == "OPT_EXEC" {
        let [spot, strike, time, rate, volatility, carry, lambda, ..] = numbers;
        exp(-lambda * time) * black_scholes(call, spot, strike, time, rate, volatility, carry)
    } else if name == "OPT_FORWARD_START" {
        let [spot, alpha, start, time, rate, volatility, carry, ..] = numbers;
        spot * exp((carry - rate) * start)
            * black_scholes(call, 1., alpha, time - start, rate, volatility, carry)
    } else if name == "OPT_TIME_SWITCH" {
        let [
            spot,
            strike,
            payment,
            time,
            accrued,
            step,
            rate,
            carry,
            volatility,
            ..,
        ] = numbers;
        if step == 0. {
            return Some(Err("#NUM!"));
        }
        let count = ((time / step).trunc() - 1.).max(0.) as usize;
        *work = work.checked_sub(count)?;
        let direction = if call { 1. } else { -1. };
        let mut sum = 0.;
        for index in 1..=count {
            let i = index as f64;
            let d = (ln(spot / strike) + (carry - volatility * volatility / 2.) * i * step)
                / (volatility * (i * step).sqrt());
            sum += cdf(direction * d) * step;
        }
        payment * exp(-rate * time) * sum + step * payment * exp(-rate * time) * accrued
    } else if name == "OPT_SIMPLE_CHOOSER" {
        let [spot, strike, start, time, rate, carry, volatility, ..] = numbers;
        let width = volatility * start.sqrt();
        let y = (ln(spot / strike) + carry * time + (volatility * volatility) * start / 2.) / width;
        black_scholes(true, spot, strike, time, rate, volatility, carry)
            - spot * exp((carry - rate) * time) * cdf(-y)
            + strike * exp(-rate * time) * cdf(-y + width)
    } else if name == "OPT_SPREAD_APPROX" {
        let [
            first,
            second,
            strike,
            time,
            rate,
            vol1,
            vol2,
            correlation,
            ..,
        ] = numbers;
        let ratio = vol2 * second / (second + strike);
        let volatility = (vol1 * vol1 + ratio * ratio
            - 2. * correlation * vol1 * vol2 * second / (second + strike))
            .sqrt();
        black_scholes(
            call,
            first / (second + strike),
            1.,
            time,
            rate,
            volatility,
            0.,
        ) * (second + strike)
    } else if name == "OPT_FLOAT_STRK_LKBK" {
        let [spot, minimum, maximum, time, rate, carry, volatility, ..] = numbers;
        let extreme = if call { minimum } else { maximum };
        let variance = volatility * volatility;
        let root_time = time.sqrt();
        let a1 = (ln(spot / extreme) + (carry + variance / 2.) * time) / (volatility * root_time);
        let a2 = a1 - volatility * root_time;
        let asset = exp((carry - rate) * time);
        let discount = exp(-rate * time);
        if call {
            spot * asset * cdf(a1) - extreme * discount * cdf(a2)
                + discount * variance / (2. * carry)
                    * spot
                    * (pow(spot / extreme, -2. * carry / variance)
                        * cdf(-a1 + 2. * carry / volatility * root_time)
                        - exp(carry * time) * cdf(-a1))
        } else {
            extreme * discount * cdf(-a2) - spot * asset * cdf(-a1)
                + discount * variance / (2. * carry)
                    * spot
                    * (-pow(spot / extreme, -2. * carry / variance)
                        * cdf(a1 - 2. * carry / volatility * root_time)
                        + exp(carry * time) * cdf(a1))
        }
    } else if name == "OPT_FIXED_STRK_LKBK" {
        let [
            spot,
            minimum,
            maximum,
            strike,
            time,
            rate,
            carry,
            volatility,
            ..,
        ] = numbers;
        let extreme = if call { maximum } else { minimum };
        let variance = volatility * volatility;
        let root_time = time.sqrt();
        let d1 = (ln(spot / strike) + (carry + variance / 2.) * time) / (volatility * root_time);
        let d2 = d1 - volatility * root_time;
        let e1 = (ln(spot / extreme) + (carry + variance / 2.) * time) / (volatility * root_time);
        let e2 = e1 - volatility * root_time;
        let asset = exp((carry - rate) * time);
        let discount = exp(-rate * time);
        if call && strike > extreme {
            spot * asset * cdf(d1) - strike * discount * cdf(d2)
                + spot * discount * variance / (2. * carry)
                    * (-pow(spot / strike, -2. * carry / variance)
                        * cdf(d1 - 2. * carry / volatility * root_time)
                        + exp(carry * time) * cdf(d1))
        } else if call {
            discount * (extreme - strike) + spot * asset * cdf(e1) - discount * extreme * cdf(e2)
                + spot * discount * variance / (2. * carry)
                    * (-pow(spot / extreme, -2. * carry / variance)
                        * cdf(e1 - 2. * carry / volatility * root_time)
                        + exp(carry * time) * cdf(e1))
        } else if strike < extreme {
            -spot * asset * cdf(-d1)
                + strike * discount * cdf(-d1 + volatility * root_time)
                + spot * discount * variance / (2. * carry)
                    * (pow(spot / strike, -2. * carry / variance)
                        * cdf(-d1 + 2. * carry / volatility * root_time)
                        - exp(carry * time) * cdf(-d1))
        } else {
            discount * (strike - extreme) - spot * asset * cdf(-e1)
                + discount * extreme * cdf(-e1 + volatility * root_time)
                + discount * variance / (2. * carry)
                    * spot
                    * (pow(spot / extreme, -2. * carry / variance)
                        * cdf(-e1 + 2. * carry / volatility * root_time)
                        - exp(carry * time) * cdf(-e1))
        }
    } else if name == "OPT_BS" {
        let [spot, strike, time, rate, volatility, carry, ..] = numbers;
        black_scholes(call, spot, strike, time, rate, volatility, carry)
    } else {
        let [spot, strike, time, rate, volatility, carry, ..] = numbers;
        let root_time = time.sqrt();
        let d1 = (ln(spot / strike) + (carry + volatility * volatility / 2.) * time)
            / (volatility * root_time);
        let d2 = d1 - volatility * root_time;
        let asset = exp((carry - rate) * time);
        let discount = exp(-rate * time);
        let density = exp(-d1 * d1 / 2.) / (2. * std::f64::consts::PI).sqrt();
        match name {
            "OPT_BS_DELTA" => asset * if call { cdf(d1) } else { cdf(d1) - 1. },
            "OPT_BS_GAMMA" => asset * density / (spot * volatility * root_time),
            "OPT_BS_VEGA" => spot * asset * density * root_time,
            "OPT_BS_RHO" if carry == 0. => {
                -time * price(call, spot, strike, d1, d2, asset, discount)
            }
            "OPT_BS_RHO" if call => time * strike * discount * cdf(d2),
            "OPT_BS_RHO" => -time * strike * discount * cdf(-d2),
            "OPT_BS_CARRYCOST" if call => time * spot * asset * cdf(d1),
            "OPT_BS_CARRYCOST" => -time * spot * asset * cdf(-d1),
            "OPT_BS_THETA" => {
                let theta = -spot * asset * density * volatility / (2. * root_time);
                if call {
                    theta
                        - (carry - rate) * spot * asset * cdf(d1)
                        - rate * strike * discount * cdf(d2)
                } else {
                    theta
                        + (carry - rate) * spot * asset * cdf(-d1)
                        + rate * strike * discount * cdf(-d2)
                }
            }
            _ => unreachable!(),
        }
    };
    Some(if result.is_finite() {
        Ok(result)
    } else {
        Err("#NUM!")
    })
}

fn bjer_stens(spot: f64, strike: f64, time: f64, rate: f64, volatility: f64, carry: f64) -> f64 {
    if carry >= rate {
        return black_scholes(true, spot, strike, time, rate, volatility, carry);
    }
    let variance = volatility * volatility;
    let beta =
        (0.5 - carry / variance) + (pow(carry / variance - 0.5, 2.) + 2. * rate / variance).sqrt();
    let infinity = beta / (beta - 1.) * strike;
    let lower = rate / (rate - carry) * strike;
    let lower = if lower.is_nan() {
        lower
    } else {
        strike.max(lower)
    };
    let h = -(carry * time + 2. * volatility * time.sqrt()) * lower / (infinity - lower);
    let critical = lower + (infinity - lower) * (1. - exp(h));
    if spot >= critical {
        return spot - strike;
    }
    let alpha = (critical - strike) * pow(critical, -beta);
    let phi = |gamma: f64, threshold: f64| {
        let lambda = (-rate + gamma * carry + 0.5 * gamma * (gamma - 1.) * variance) * time;
        let d = -(ln(spot / threshold) + (carry + (gamma - 0.5) * variance) * time)
            / (volatility * time.sqrt());
        let kappa = 2. * carry / variance + (2. * gamma - 1.);
        exp(lambda)
            * pow(spot, gamma)
            * (cdf(d)
                - pow(critical / spot, kappa)
                    * cdf(d - 2. * ln(critical / spot) / (volatility * time.sqrt())))
    };
    alpha * pow(spot, beta) - alpha * phi(beta, critical) + phi(1., critical)
        - phi(1., strike)
        - strike * phi(0., critical)
        + strike * phi(0., strike)
}

fn baw(
    call: bool,
    spot: f64,
    strike: f64,
    time: f64,
    rate: f64,
    volatility: f64,
    carry: f64,
    work: &mut usize,
) -> Option<f64> {
    if call && carry >= rate {
        return Some(black_scholes(
            true, spot, strike, time, rate, volatility, carry,
        ));
    }
    let variance = volatility * volatility;
    let width = volatility * time.sqrt();
    let n = 2. * carry / variance;
    let m = 2. * rate / variance;
    let root = ((n - 1.) * (n - 1.) + 4. * m).sqrt();
    let unlimited_q = if call {
        (-(n - 1.) + root) / 2.
    } else {
        (-(n - 1.) - root) / 2.
    };
    let upper = strike / (1. - 1. / unlimited_q);
    let mut critical = if call {
        let h = -(carry * time + 2. * volatility * time.sqrt()) * strike / (upper - strike);
        strike + (upper - strike) * (1. - exp(h))
    } else {
        let h = (carry * time - 2. * volatility * time.sqrt()) * strike / (strike - upper);
        upper + (strike - upper) * exp(h)
    };
    let k = 2. * rate / (variance * (1. - exp(-rate * time)));
    let root = ((n - 1.) * (n - 1.) + 4. * k).sqrt();
    let q = if call {
        (-(n - 1.) + root) / 2.
    } else {
        (-(n - 1.) - root) / 2.
    };
    let asset = exp((carry - rate) * time);
    let mut first = true;
    loop {
        let d = (ln(critical / strike) + (carry + variance / 2.) * time) / width;
        let lhs = if call {
            critical - strike
        } else {
            strike - critical
        };
        let base = black_scholes(call, critical, strike, time, rate, volatility, carry);
        let rhs = if call {
            base + (1. - asset * cdf(d)) * critical / q
        } else {
            base - (1. - asset * cdf(-d)) * critical / q
        };
        if (lhs - rhs).abs() / strike > 0.000001 {
            *work = work.checked_sub(1)?;
            let density = exp(-d * d / 2.) / (2. * std::f64::consts::PI).sqrt();
            // Production switches CDF/PDF terms after the first iteration.
            let slope = if call {
                asset * cdf(d) * (1. - 1. / q)
                    + (1. - asset * if first { cdf(d) } else { density } / width) / q
            } else {
                -asset * cdf(-d) * (1. - 1. / q)
                    - (1. + asset * if first { density } else { cdf(-d) } / width) / q
            };
            critical = if call {
                (strike + rhs - slope * critical) / (1. - slope)
            } else {
                (strike - rhs + slope * critical) / (1. + slope)
            };
            first = false;
        } else {
            break;
        }
    }
    let d = (ln(critical / strike) + (carry + variance / 2.) * time) / width;
    Some(if call {
        let coefficient = critical / q * (1. - asset * cdf(d));
        if spot < critical {
            black_scholes(true, spot, strike, time, rate, volatility, carry)
                + coefficient * pow(spot / critical, q)
        } else {
            spot - strike
        }
    } else {
        let coefficient = -(critical / q) * (1. - asset * cdf(-d));
        if spot > critical {
            black_scholes(false, spot, strike, time, rate, volatility, carry)
                + coefficient * pow(spot / critical, q)
        } else {
            strike - spot
        }
    })
}

fn black_scholes(
    call: bool,
    spot: f64,
    strike: f64,
    time: f64,
    rate: f64,
    volatility: f64,
    carry: f64,
) -> f64 {
    let width = volatility * time.sqrt();
    let d1 = (ln(spot / strike) + (carry + volatility * volatility / 2.) * time) / width;
    price(
        call,
        spot,
        strike,
        d1,
        d1 - width,
        exp((carry - rate) * time),
        exp(-rate * time),
    )
}

fn price(call: bool, spot: f64, strike: f64, d1: f64, d2: f64, asset: f64, discount: f64) -> f64 {
    if call {
        spot * asset * cdf(d1) - strike * discount * cdf(d2)
    } else {
        strike * discount * cdf(-d2) - spot * asset * cdf(-d1)
    }
}
