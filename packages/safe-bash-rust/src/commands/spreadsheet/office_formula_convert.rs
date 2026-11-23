// Adapted from IronCalc engineering/convert.rs, f93662006b8fb1c401dc870bbda26c5d60ac6037.
// Copyright 2023 EqualTo GmbH; 2023–Present IronCalc contributors;
// 2026–Present IronCalc GmbH. MIT license: LICENSE.IronCalc.
// Immutable unit matches replace per-cell HashMaps and unit-name allocations.
use super::{Value, lookup::number};

#[derive(PartialEq, Clone, Copy)]
enum Temperature {
    Kelvin,
    Celsius,
    Rankine,
    Reaumur,
    Fahrenheit,
}

impl Temperature {
    /// Kelvin and Rankine start at absolute zero. Celsius, Fahrenheit and Réaumur are
    /// measured from the freezing point of water (Fahrenheit with an extra offset of 32).
    fn is_absolute(self) -> bool {
        matches!(self, Temperature::Kelvin | Temperature::Rankine)
    }
}

// Within the same family the conversion is a plain factor (and the 32 offset of Fahrenheit),
// so the 273.15 offset is only added or removed when going from one family to the other.
// Going through Kelvin every time would make CONVERT(100,"C","F") 211.99999999999994 and
// CONVERT(0.00075,"C","C") 0.000749999999982 instead of 212 and 0.00075.
//
// T_K = T_C + 273.15
// T_K = 5/9 * T_Rank
// T_C = (T_F - 32) * 5/9
// T_C = 5/4 * T_Reau
fn convert_temperature(
    value: f64,
    from_temperature: Temperature,
    to_temperature: Temperature,
) -> f64 {
    if from_temperature == to_temperature {
        return value;
    }
    if from_temperature.is_absolute() || to_temperature.is_absolute() {
        let kelvin = match from_temperature {
            Temperature::Kelvin => value,
            Temperature::Rankine => value * 5.0 / 9.0,
            Temperature::Celsius => value + 273.15,
            Temperature::Fahrenheit => (value - 32.0) * 5.0 / 9.0 + 273.15,
            Temperature::Reaumur => value * 5.0 / 4.0 + 273.15,
        };
        match to_temperature {
            Temperature::Kelvin => kelvin,
            Temperature::Rankine => kelvin * 9.0 / 5.0,
            Temperature::Celsius => kelvin - 273.15,
            Temperature::Fahrenheit => (kelvin - 273.15) * 9.0 / 5.0 + 32.0,
            Temperature::Reaumur => (kelvin - 273.15) * 4.0 / 5.0,
        }
    } else {
        let celsius = match from_temperature {
            Temperature::Fahrenheit => (value - 32.0) * 5.0 / 9.0,
            Temperature::Reaumur => value * 5.0 / 4.0,
            _ => value,
        };
        match to_temperature {
            Temperature::Fahrenheit => celsius * 9.0 / 5.0 + 32.0,
            Temperature::Reaumur => celsius * 4.0 / 5.0,
            _ => celsius,
        }
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Kind {
    Weight,
    Distance,
    Time,
    Pressure,
    Force,
    Energy,
    Power,
    Magnetism,
    Volume,
    Area,
    Information,
    Speed,
    Temperature(Temperature),
}

fn unit(name: &str) -> Option<(Kind, f64)> {
    Some(match name {
        "g" => (Kind::Weight, 1.0),
        "sg" => (Kind::Weight, 14593.9029372064),
        "lbm" => (Kind::Weight, 453.59237),
        "u" => (Kind::Weight, 1.660538782E-24),
        "ozm" => (Kind::Weight, 28.349523125),
        "grain" => (Kind::Weight, 0.06479891),
        "cwt" | "shweight" => (Kind::Weight, 45359.237),
        "uk_cwt" | "lcwt" => (Kind::Weight, 50802.34544),
        "stone" => (Kind::Weight, 6350.29318),
        "ton" => (Kind::Weight, 907184.74),
        "brton" | "LTON" | "uk_ton" => (Kind::Weight, 1016046.9088),
        "m" => (Kind::Distance, 1.0),
        "mi" => (Kind::Distance, 1609.344),
        "Nmi" => (Kind::Distance, 1852.0),
        "in" => (Kind::Distance, 0.0254),
        "ft" => (Kind::Distance, 0.3048),
        "yd" => (Kind::Distance, 0.9144),
        "ang" => (Kind::Distance, 0.0000000001),
        "ell" => (Kind::Distance, 1.143),
        "ly" => (Kind::Distance, 9460730472580800.0),
        "parsec" | "pc" => (Kind::Distance, 30856775812815500.0),
        "Picapt" | "Pica" => (Kind::Distance, 0.000352777777777778),
        "pica" => (Kind::Distance, 0.00423333333333333),
        "survey_mi" => (Kind::Distance, 1609.34721869444),
        "yr" => (Kind::Time, 31557600.0),
        "day" | "d" => (Kind::Time, 86400.0),
        "hr" => (Kind::Time, 3600.0),
        "mn" | "min" => (Kind::Time, 60.0),
        "sec" | "s" => (Kind::Time, 1.0),
        "Pa" | "p" => (Kind::Pressure, 1.0),
        "atm" | "at" => (Kind::Pressure, 101325.0),
        "mmHg" => (Kind::Pressure, 133.322),
        "psi" => (Kind::Pressure, 6894.75729316836),
        "Torr" => (Kind::Pressure, 133.322368421053),
        "N" => (Kind::Force, 1.0),
        "dyn" | "dy" => (Kind::Force, 0.00001),
        "lbf" => (Kind::Force, 4.4482216152605),
        "pond" => (Kind::Force, 0.00980665),
        "J" => (Kind::Energy, 1.0),
        "e" => (Kind::Energy, 0.0000001),
        "c" => (Kind::Energy, 4.184),
        "cal" => (Kind::Energy, 4.1868),
        "eV" | "ev" => (Kind::Energy, 1.602176487E-19),
        "HPh" | "hh" => (Kind::Energy, 2684519.53769617),
        "Wh" | "wh" => (Kind::Energy, 3600.0),
        "flb" => (Kind::Energy, 1.3558179483314),
        "BTU" | "btu" => (Kind::Energy, 1055.05585262),
        "HP" | "h" => (Kind::Power, 745.69987158227),
        "PS" => (Kind::Power, 735.49875),
        "W" | "w" => (Kind::Power, 1.0),
        "T" => (Kind::Magnetism, 1.0),
        "ga" => (Kind::Magnetism, 0.0001),
        "tsp" => (Kind::Volume, 0.00000492892159375),
        "tspm" => (Kind::Volume, 0.000005),
        "tbs" => (Kind::Volume, 0.00001478676478125),
        "oz" => (Kind::Volume, 0.0000295735295625),
        "cup" => (Kind::Volume, 0.0002365882365),
        "pt" | "us_pt" => (Kind::Volume, 0.000473176473),
        "uk_pt" => (Kind::Volume, 0.00056826125),
        "qt" => (Kind::Volume, 0.000946352946),
        "uk_qt" => (Kind::Volume, 0.0011365225),
        "gal" => (Kind::Volume, 0.003785411784),
        "uk_gal" => (Kind::Volume, 0.00454609),
        "l" | "L" | "lt" => (Kind::Volume, 0.001),
        "ang3" | "ang^3" => (Kind::Volume, 1E-30),
        "barrel" => (Kind::Volume, 0.158987294928),
        "bushel" => (Kind::Volume, 0.03523907016688),
        "ft3" | "ft^3" => (Kind::Volume, 0.028316846592),
        "in3" | "in^3" => (Kind::Volume, 0.000016387064),
        "ly3" | "ly^3" => (Kind::Volume, 8.46786664623715E+47),
        "m3" | "m^3" => (Kind::Volume, 1.0),
        "mi3" | "mi^3" => (Kind::Volume, 4168181825.44058),
        "yd3" | "yd^3" => (Kind::Volume, 0.764554857984),
        "Nmi3" | "Nmi^3" => (Kind::Volume, 6352182208.0),
        "Picapt3" | "Picapt^3" | "Pica3" | "Pica^3" => (Kind::Volume, 4.39039566186557E-11),
        "GRT" | "regton" => (Kind::Volume, 2.8316846592),
        "MTON" => (Kind::Volume, 1.13267386368),
        "uk_acre" => (Kind::Area, 4046.8564224),
        "us_acre" => (Kind::Area, 4046.87260987425),
        "ang2" | "ang^2" => (Kind::Area, 1E-20),
        "ar" => (Kind::Area, 100.0),
        "ft2" | "ft^2" => (Kind::Area, 0.09290304),
        "ha" => (Kind::Area, 10000.0),
        "in2" | "in^2" => (Kind::Area, 0.00064516),
        "ly2" | "ly^2" => (Kind::Area, 8.95054210748189E+31),
        "m2" | "m^2" => (Kind::Area, 1.0),
        "Morgen" => (Kind::Area, 2500.0),
        "mi2" | "mi^2" => (Kind::Area, 2589988.110336),
        "Nmi2" | "Nmi^2" => (Kind::Area, 3429904.0),
        "Picapt2" | "Pica2" | "Pica^2" | "Picapt^2" => (Kind::Area, 0.000000124452160493827),
        "yd2" | "yd^2" => (Kind::Area, 0.83612736),
        "bit" => (Kind::Information, 1.0),
        "byte" => (Kind::Information, 8.0),
        "admkn" => (Kind::Speed, 0.514773333333333),
        "kn" => (Kind::Speed, 0.514444444444444),
        "m/h" | "m/hr" => (Kind::Speed, 0.000277777777777778),
        "m/s" | "m/sec" => (Kind::Speed, 1.0),
        "mph" => (Kind::Speed, 0.44704),
        "C" | "cel" => (Kind::Temperature(Temperature::Celsius), 1.),
        "F" | "fah" => (Kind::Temperature(Temperature::Fahrenheit), 1.),
        "K" | "kel" => (Kind::Temperature(Temperature::Kelvin), 1.),
        "Rank" => (Kind::Temperature(Temperature::Rankine), 1.),
        "Reau" => (Kind::Temperature(Temperature::Reaumur), 1.),
        _ => return None,
    })
}

fn prefixed(name: &str) -> Option<(Kind, f64)> {
    // Exact units win: pc is parsec, not pico-calorie.
    if let Some(unit) = unit(name) {
        return Some(unit);
    }
    for (prefix, modifier) in [
        ("Yi", 1208925819614629174706176.),
        ("Zi", 1180591620717411303424.),
        ("Ei", 1152921504606846976.),
        ("Pi", 1125899906842624.),
        ("Ti", 1099511627776.),
        ("Gi", 1073741824.),
        ("Mi", 1048576.),
        ("ki", 1024.),
        ("da", 10.),
        ("Y", 1e24),
        ("Z", 1e21),
        ("E", 1e18),
        ("P", 1e15),
        ("T", 1e12),
        ("G", 1e9),
        ("M", 1e6),
        ("k", 1e3),
        ("h", 1e2),
        ("e", 10.),
        ("d", 1e-1),
        ("c", 1e-2),
        ("m", 1e-3),
        ("u", 1e-6),
        ("n", 1e-9),
        ("p", 1e-12),
        ("f", 1e-15),
        ("a", 1e-18),
        ("z", 1e-21),
        ("y", 1e-24),
    ] {
        let Some(base) = name.strip_prefix(prefix) else {
            continue;
        };
        if !matches!(
            base,
            "Pa" | "p"
                | "atm"
                | "at"
                | "mmHg"
                | "g"
                | "u"
                | "m"
                | "ang"
                | "ly"
                | "parsec"
                | "pc"
                | "ang2"
                | "ang^2"
                | "ar"
                | "m2"
                | "m^2"
                | "N"
                | "dyn"
                | "dy"
                | "pond"
                | "J"
                | "e"
                | "c"
                | "cal"
                | "eV"
                | "ev"
                | "Wh"
                | "wh"
                | "W"
                | "w"
                | "T"
                | "ga"
                | "uk_pt"
                | "l"
                | "L"
                | "lt"
                | "ang3"
                | "ang^3"
                | "m3"
                | "m^3"
                | "bit"
                | "byte"
                | "m/h"
                | "m/hr"
                | "m/s"
                | "m/sec"
                | "mph"
                | "K"
                | "kel"
        ) {
            continue;
        }
        let (kind, scale) = unit(base)?;
        let factor = match kind {
            Kind::Area if base != "ar" => modifier * modifier,
            Kind::Volume if matches!(base, "ang3" | "ang^3" | "m3" | "m^3") => {
                modifier * modifier * modifier
            }
            _ => modifier,
        };
        return Some((kind, factor * scale));
    }
    None
}

pub(super) fn calculate(args: [&Value; 3], date1904: bool, work: &mut usize) -> Option<Value> {
    *work = work.checked_sub(256)?;
    let value = match args[0] {
        Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
        Value::Text(s) | Value::UninternedText(s) => number::parse_excel(s, date1904),
        v => v.numeric(),
    };
    let Some(value) = value else {
        return Some(Value::Error("#VALUE!"));
    };
    let mut units = [""; 2];
    for (i, arg) in args[1..].iter().enumerate() {
        units[i] = match arg {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::Text(s) | Value::UninternedText(s) => s,
            _ => "",
        };
    }
    let Some((from, from_scale)) = prefixed(units[0]) else {
        return Some(Value::Error("#N/A"));
    };
    let Some((to, to_scale)) = prefixed(units[1]) else {
        return Some(Value::Error("#N/A"));
    };
    let result = match (from, to) {
        (Kind::Temperature(from), Kind::Temperature(to)) => {
            convert_temperature(value * from_scale, from, to) / to_scale
        }
        _ if from != to => return Some(Value::Error("#N/A")),
        _ => value * from_scale / to_scale,
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}
