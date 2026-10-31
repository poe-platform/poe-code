pub(super) fn parse_color(raw: &str) -> Result<[u8; 4], String> {
    let raw = raw.trim();
    let s = raw.to_ascii_lowercase();
    let error = || format!("Unable to parse color from string: {raw}");
    let named = match s.as_str() {
        "aliceblue" => Some([240, 248, 255, 255]),
        "antiquewhite" => Some([250, 235, 215, 255]),
        "aqua" | "cyan" => Some([0, 255, 255, 255]),
        "aquamarine" => Some([127, 255, 212, 255]),
        "azure" => Some([240, 255, 255, 255]),
        "beige" => Some([245, 245, 220, 255]),
        "bisque" => Some([255, 228, 196, 255]),
        "black" => Some([0, 0, 0, 255]),
        "blanchedalmond" => Some([255, 235, 205, 255]),
        "blue" => Some([0, 0, 255, 255]),
        "blueviolet" => Some([138, 43, 226, 255]),
        "brown" => Some([165, 42, 42, 255]),
        "burlywood" => Some([222, 184, 135, 255]),
        "cadetblue" => Some([95, 158, 160, 255]),
        "chartreuse" => Some([127, 255, 0, 255]),
        "chocolate" => Some([210, 105, 30, 255]),
        "coral" => Some([255, 127, 80, 255]),
        "cornflowerblue" => Some([100, 149, 237, 255]),
        "cornsilk" => Some([255, 248, 220, 255]),
        "crimson" => Some([220, 20, 60, 255]),
        "darkblue" => Some([0, 0, 139, 255]),
        "darkcyan" => Some([0, 139, 139, 255]),
        "darkgoldenrod" => Some([184, 134, 11, 255]),
        "darkgray" | "darkgrey" => Some([169, 169, 169, 255]),
        "darkgreen" => Some([0, 100, 0, 255]),
        "darkkhaki" => Some([189, 183, 107, 255]),
        "darkmagenta" => Some([139, 0, 139, 255]),
        "darkolivegreen" => Some([85, 107, 47, 255]),
        "darkorange" => Some([255, 140, 0, 255]),
        "darkorchid" => Some([153, 50, 204, 255]),
        "darkred" => Some([139, 0, 0, 255]),
        "darksalmon" => Some([233, 150, 122, 255]),
        "darkseagreen" => Some([143, 188, 143, 255]),
        "darkslateblue" => Some([72, 61, 139, 255]),
        "darkslategray" | "darkslategrey" => Some([47, 79, 79, 255]),
        "darkturquoise" => Some([0, 206, 209, 255]),
        "darkviolet" => Some([148, 0, 211, 255]),
        "deeppink" => Some([255, 20, 147, 255]),
        "deepskyblue" => Some([0, 191, 255, 255]),
        "dimgray" | "dimgrey" => Some([105, 105, 105, 255]),
        "dodgerblue" => Some([30, 144, 255, 255]),
        "firebrick" => Some([178, 34, 34, 255]),
        "floralwhite" => Some([255, 250, 240, 255]),
        "forestgreen" => Some([34, 139, 34, 255]),
        "fractal" => Some([128, 128, 128, 255]),
        "fuchsia" | "magenta" => Some([255, 0, 255, 255]),
        "gainsboro" => Some([220, 220, 220, 255]),
        "ghostwhite" => Some([248, 248, 255, 255]),
        "gold" => Some([255, 215, 0, 255]),
        "goldenrod" => Some([218, 165, 32, 255]),
        "gray" | "grey" => Some([126, 126, 126, 255]),
        "green" => Some([0, 128, 0, 255]),
        "greenyellow" => Some([173, 255, 47, 255]),
        "honeydew" => Some([240, 255, 240, 255]),
        "hotpink" => Some([255, 105, 180, 255]),
        "indianred" => Some([205, 92, 92, 255]),
        "indigo" => Some([75, 0, 130, 255]),
        "ivory" => Some([255, 255, 240, 255]),
        "khaki" => Some([240, 230, 140, 255]),
        "lavender" => Some([230, 230, 250, 255]),
        "lavenderblush" => Some([255, 240, 245, 255]),
        "lawngreen" => Some([124, 252, 0, 255]),
        "lemonchiffon" => Some([255, 250, 205, 255]),
        "lightblue" => Some([173, 216, 230, 255]),
        "lightcoral" => Some([240, 128, 128, 255]),
        "lightcyan" => Some([224, 255, 255, 255]),
        "lightgoldenrodyellow" => Some([250, 250, 210, 255]),
        "lightgray" | "lightgrey" => Some([211, 211, 211, 255]),
        "lightgreen" => Some([144, 238, 144, 255]),
        "lightpink" => Some([255, 182, 193, 255]),
        "lightsalmon" => Some([255, 160, 122, 255]),
        "lightseagreen" => Some([32, 178, 170, 255]),
        "lightskyblue" => Some([135, 206, 250, 255]),
        "lightslategray" | "lightslategrey" => Some([119, 136, 153, 255]),
        "lightsteelblue" => Some([176, 196, 222, 255]),
        "lightyellow" => Some([255, 255, 224, 255]),
        "lime" => Some([0, 255, 0, 255]),
        "limegreen" => Some([50, 205, 50, 255]),
        "linen" => Some([250, 240, 230, 255]),
        "maroon" => Some([128, 0, 0, 255]),
        "mediumaquamarine" => Some([102, 205, 170, 255]),
        "mediumblue" => Some([0, 0, 205, 255]),
        "mediumorchid" => Some([186, 85, 211, 255]),
        "mediumpurple" => Some([147, 112, 219, 255]),
        "mediumseagreen" => Some([60, 179, 113, 255]),
        "mediumslateblue" => Some([123, 104, 238, 255]),
        "mediumspringgreen" => Some([0, 250, 154, 255]),
        "mediumturquoise" => Some([72, 209, 204, 255]),
        "mediumvioletred" => Some([199, 21, 133, 255]),
        "midnightblue" => Some([25, 25, 112, 255]),
        "mintcream" => Some([245, 255, 250, 255]),
        "mistyrose" => Some([255, 228, 225, 255]),
        "moccasin" => Some([255, 228, 181, 255]),
        "navajowhite" => Some([255, 222, 173, 255]),
        "navy" => Some([0, 0, 128, 255]),
        "none" | "transparent" => Some([0, 0, 0, 0]),
        "oldlace" => Some([253, 245, 230, 255]),
        "olive" => Some([128, 128, 0, 255]),
        "olivedrab" => Some([107, 142, 35, 255]),
        "orange" => Some([255, 165, 0, 255]),
        "orangered" => Some([255, 69, 0, 255]),
        "orchid" => Some([218, 112, 214, 255]),
        "palegoldenrod" => Some([238, 232, 170, 255]),
        "palegreen" => Some([152, 251, 152, 255]),
        "paleturquoise" => Some([175, 238, 238, 255]),
        "palevioletred" => Some([219, 112, 147, 255]),
        "papayawhip" => Some([255, 239, 213, 255]),
        "peachpuff" => Some([255, 218, 185, 255]),
        "peru" => Some([205, 133, 63, 255]),
        "pink" => Some([255, 192, 203, 255]),
        "plum" => Some([221, 160, 221, 255]),
        "powderblue" => Some([176, 224, 230, 255]),
        "purple" => Some([128, 0, 128, 255]),
        "rebeccapurple" => Some([102, 51, 153, 255]),
        "red" => Some([255, 0, 0, 255]),
        "rosybrown" => Some([188, 143, 143, 255]),
        "royalblue" => Some([65, 105, 225, 255]),
        "saddlebrown" => Some([139, 69, 19, 255]),
        "salmon" => Some([250, 128, 114, 255]),
        "sandybrown" => Some([244, 164, 96, 255]),
        "seagreen" => Some([46, 139, 87, 255]),
        "seashell" => Some([255, 245, 238, 255]),
        "sienna" => Some([160, 82, 45, 255]),
        "silver" => Some([192, 192, 192, 255]),
        "skyblue" => Some([135, 206, 235, 255]),
        "slateblue" => Some([106, 90, 205, 255]),
        "slategray" | "slategrey" => Some([112, 128, 144, 255]),
        "snow" => Some([255, 250, 250, 255]),
        "springgreen" => Some([0, 255, 127, 255]),
        "steelblue" => Some([70, 130, 180, 255]),
        "tan" => Some([210, 180, 140, 255]),
        "teal" => Some([0, 128, 128, 255]),
        "thistle" => Some([216, 191, 216, 255]),
        "tomato" => Some([255, 99, 71, 255]),
        "turquoise" => Some([64, 224, 208, 255]),
        "violet" => Some([238, 130, 238, 255]),
        "wheat" => Some([245, 222, 179, 255]),
        "white" => Some([255, 255, 255, 255]),
        "whitesmoke" => Some([245, 245, 245, 255]),
        "yellow" => Some([255, 255, 0, 255]),
        "yellowgreen" => Some([154, 205, 50, 255]),
        _ => None,
    };
    if let Some(c) = named {
        return Ok(c);
    }
    if let Some(percent) = s.strip_prefix("gray").or_else(|| s.strip_prefix("grey"))
        && (1..=3).contains(&percent.len())
        && percent.bytes().all(|c| c.is_ascii_digit())
    {
        let v = (percent.parse::<f64>().unwrap() / 100.0 * 255.0).round() as u8;
        return Ok([v, v, v, 255]);
    }
    let hex = s.strip_prefix('#').unwrap_or(&s);
    if hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        let width = match hex.len() {
            3 | 4 => 1,
            6 | 8 => 2,
            12 | 16 if s.starts_with('#') => 4,
            _ => 0,
        };
        if width > 0 {
            let mut rgba = [255; 4];
            for (i, part) in hex.as_bytes().chunks_exact(width).enumerate() {
                let v = u16::from_str_radix(std::str::from_utf8(part).unwrap(), 16).unwrap();
                rgba[i] = match width {
                    1 => v as u8 * 17,
                    4 => ((u32::from(v) + 128) / 257) as u8,
                    _ => v as u8,
                };
            }
            return Ok(rgba);
        }
    }
    if let Some((kind, values)) = s.split_once('(')
        && let Some(values) = values.strip_suffix(')')
        && !values.is_empty()
    {
        let mut parts = values
            .split(|c: char| c == ',' || c.is_ascii_whitespace())
            .filter(|p| !p.is_empty());
        let number = |s: &str| s.parse::<f64>().unwrap_or(f64::NAN);
        let chan = |p: Option<&str>, alpha: bool| {
            let Some(p) = p else {
                return if alpha { 255 } else { 0 };
            };
            let n = if let Some(p) = p.strip_suffix('%') {
                number(p) / 100. * 255.
            } else {
                let n = number(p);
                if alpha && n <= 1. { n * 255. } else { n }
            };
            n.round() as u8
        };
        match kind {
            "rgb" | "rgba" | "srgb" | "srgba" => {
                return Ok([
                    chan(parts.next(), false),
                    chan(parts.next(), false),
                    chan(parts.next(), false),
                    chan(parts.next(), true),
                ]);
            }
            "gray" | "grey" | "graya" | "greya" => {
                let v = chan(parts.next(), false);
                return Ok([v, v, v, chan(parts.next(), true)]);
            }
            "cmyk" | "cmyka" => {
                let mut unit = || {
                    let p = parts.next().unwrap_or("0");
                    let v = if let Some(p) = p.strip_suffix('%') {
                        number(p) / 100.
                    } else {
                        let n = number(p);
                        if n <= 1. { n } else { n / 255. }
                    };
                    v.clamp(0., 1.)
                };
                let c = unit();
                let m = unit();
                let y = unit();
                let k = unit();
                let rgb = |v: f64| (255. * (1. - v) * (1. - k)).round() as u8;
                return Ok([rgb(c), rgb(m), rgb(y), chan(parts.next(), true)]);
            }
            "hsl" | "hsla" => {
                let h = parts
                    .next()
                    .and_then(|v| v.parse::<f64>().ok())
                    .ok_or_else(error)?
                    .rem_euclid(360.)
                    / 60.;
                let mut sl = || {
                    parts
                        .next()
                        .and_then(|p| p.trim_end_matches('%').parse::<f64>().ok())
                        .map(|n| n.clamp(0., 100.) / 100.)
                        .ok_or_else(error)
                };
                let sat = sl()?;
                let l = sl()?;
                let c = (1. - (2. * l - 1.).abs()) * sat;
                let x = c * (1. - (h % 2. - 1.).abs());
                let rgb = match h as u8 {
                    0 => [c, x, 0.],
                    1 => [x, c, 0.],
                    2 => [0., c, x],
                    3 => [0., x, c],
                    4 => [x, 0., c],
                    _ => [c, 0., x],
                };
                let [r, g, b] = rgb.map(|v| ((v + l - c / 2.) * 255.).round() as u8);
                return Ok([r, g, b, chan(parts.next(), true)]);
            }
            _ => {}
        }
    }
    if !(3..=200).contains(&raw.encode_utf16().count()) {
        return Err(format!(
            "Expected object or string for background but received {raw} of type string"
        ));
    }
    Err(error())
}
