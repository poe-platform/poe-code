pub(in crate::commands) fn css_named_color(s: &str) -> Option<[u8; 4]> {
    match s {
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
        "fuchsia" | "magenta" => Some([255, 0, 255, 255]),
        "gainsboro" => Some([220, 220, 220, 255]),
        "ghostwhite" => Some([248, 248, 255, 255]),
        "gold" => Some([255, 215, 0, 255]),
        "goldenrod" => Some([218, 165, 32, 255]),
        "gray" | "grey" => Some([128, 128, 128, 255]),
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
    }
}

pub(in crate::commands) fn parse_color(raw: &str) -> Result<[u8; 4], String> {
    let raw = raw.trim();
    let s = raw.to_ascii_lowercase();
    let error = || format!("Unable to parse color from string: {raw}");
    let named = match s.as_str() {
        "gray" | "grey" => Some([126, 126, 126, 255]),
        "fractal" => Some([128, 128, 128, 255]),
        "none" | "transparent" => Some([0; 4]),
        _ => css_named_color(&s),
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

#[derive(Clone, Copy)]
pub(super) enum Canvas {
    Solid([u8; 4]),
    Gradient {
        first: [u8; 4],
        last: [u8; 4],
        radial: bool,
    },
    Checker,
}

impl Canvas {
    pub fn raster(
        self,
        (w, h): (u32, u32),
        limit: usize,
    ) -> Result<super::png_pixels::Raster, &'static str> {
        let (width, height) = (w.max(1) as usize, h.max(1) as usize);
        if width.saturating_mul(height) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        let pixels = (0..width * height)
            .map(|i| self.pixel(i % width, i / width, width, height))
            .collect();
        Ok(super::png_pixels::Raster {
            width,
            height,
            density: 72,
            orientation: None,
            gray: false,
            alpha: true,
            pixels,
        })
    }

    pub(super) fn parse(spec: &str) -> Option<Result<Self, String>> {
        let (kind, colors) = spec.split_once(':')?;
        Some(match kind.to_ascii_lowercase().as_str() {
            "xc" | "canvas" => {
                parse_color(if colors.is_empty() { "white" } else { colors }).map(Self::Solid)
            }
            "null" if colors.is_empty() => Ok(Self::Solid([0; 4])),
            "pattern" | "plasma" => Ok(Self::Checker),
            "gradient" | "radial-gradient" => {
                let mut ends = colors.split('-');
                let first = ends.next().filter(|s| !s.is_empty()).unwrap_or("white");
                let last = ends.next().filter(|s| !s.is_empty()).unwrap_or("black");
                parse_color(first).and_then(|first| {
                    Ok(Self::Gradient {
                        first,
                        last: parse_color(last)?,
                        radial: kind.eq_ignore_ascii_case("radial-gradient"),
                    })
                })
            }
            _ => return None,
        })
    }

    pub(super) fn pixel(&self, x: usize, y: usize, w: usize, h: usize) -> [u8; 4] {
        match *self {
            Self::Solid(rgba) => rgba,
            Self::Checker => {
                let v = if (x / 8 + y / 8) % 2 == 0 { 102 } else { 153 };
                [v, v, v, 255]
            }
            Self::Gradient {
                first,
                last,
                radial,
            } => {
                let t = if radial {
                    let cx = (w - 1) as f64 / 2.0;
                    let cy = (h - 1) as f64 / 2.0;
                    ((x as f64 - cx).hypot(y as f64 - cy) / cx.hypot(cy).max(1.0)).min(1.0)
                } else {
                    y as f64 / (h - 1).max(1) as f64
                };
                std::array::from_fn(|i| {
                    (first[i] as f64 * (1.0 - t) + last[i] as f64 * t).round() as u8
                })
            }
        }
    }
}

// Thresholds use the leading JavaScript number, even when units follow it.
pub(super) fn threshold_value(raw: &str) -> f64 {
    let text = raw.trim_start();
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let mut rest = unsigned.trim_start_matches(|c: char| c.is_ascii_digit());
    if let Some(fraction) = rest.strip_prefix('.') {
        rest = fraction.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    if let Some(exp) = rest.strip_prefix(['e', 'E']) {
        let digits = exp.strip_prefix(['+', '-']).unwrap_or(exp);
        let tail = digits.trim_start_matches(|c: char| c.is_ascii_digit());
        if digits.len() > tail.len() {
            rest = tail;
        }
    }
    if let Some(tail) = unsigned.strip_prefix("Infinity") {
        rest = tail;
    }
    let value = text[..text.len() - rest.len()]
        .parse::<f64>()
        .unwrap_or(f64::NAN);
    if raw.ends_with('%') {
        value / 100. * 255.
    } else {
        value
    }
}

fn intensity(p: &[u8; 4]) -> f64 {
    0.212656 * f64::from(p[0]) + 0.715158 * f64::from(p[1]) + 0.072186 * f64::from(p[2])
}

pub(super) fn linear(byte: u8) -> f64 {
    static LINEAR: std::sync::LazyLock<[f64; 256]> = std::sync::LazyLock::new(|| {
        std::array::from_fn(|i| {
            let s = i as f64 / 255.;
            if s <= 0.04045 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        })
    });
    LINEAR[usize::from(byte)]
}

// image-ast interpolates the rounded sRGB table rather than rounding the final transfer curve.
pub(super) fn srgb_byte(v: f64) -> u8 {
    static SRGB: std::sync::LazyLock<[u8; 257]> = std::sync::LazyLock::new(|| {
        std::array::from_fn(|i| {
            let y = i as f64 / 255.;
            let s = if y <= 0.0031308 {
                12.92 * y
            } else {
                1.055 * y.powf(1. / 2.4) - 0.055
            };
            (255. * s).round() as u8
        })
    });
    let t = v.clamp(0., 1.) * 255.;
    let i = t as usize;
    (f64::from(SRGB[i]) + f64::from(SRGB[i + 1] - SRGB[i]) * t.fract()).round() as u8
}

pub(super) fn gray(r: u8, g: u8, b: u8) -> u8 {
    if r == g && g == b {
        return r;
    }
    let [r, g, b] = [r, g, b].map(|c| f64::from(linear(c) as f32));
    srgb_byte(f64::from(
        (0.2126_f32 as f64 * r + 0.7152_f32 as f64 * g + 0.0722_f32 as f64 * b) as f32,
    ))
}

pub(super) fn channel_mask(spec: &str) -> [bool; 4] {
    let s = spec.trim().to_ascii_lowercase();
    match s.as_str() {
        "all" | "rgba" | "sync,rgba" => [true; 4],
        "rgb" | "default" => [true, true, true, false],
        "alpha" | "opacity" | "a" => [false, false, false, true],
        _ => {
            let channels = ['r', 'g', 'b', 'a'].map(|c| s.contains(c));
            if channels.contains(&true) {
                channels
            } else {
                [true, true, true, false]
            }
        }
    }
}

pub(super) fn negate(pixel: &mut [u8; 4], channels: [bool; 4], only_gray: bool) {
    if only_gray && (pixel[0] != pixel[1] || pixel[1] != pixel[2]) {
        return;
    }
    for (c, selected) in pixel.iter_mut().zip(channels) {
        if selected {
            *c = 255 - *c;
        }
    }
}

fn srgb_to_lab([r, g, b]: [u8; 3]) -> [f64; 3] {
    let [r, g, b] = [r, g, b].map(linear);
    let f = |v: f64| if v > 0.008856 { v.cbrt() } else { 7.787 * v + 16. / 116. };
    let x = f((0.4124564*r + 0.3575761*g + 0.1804375*b) / 0.95047);
    let y = f(0.2126729*r + 0.7151522*g + 0.0721750*b);
    let z = f((0.0193339*r + 0.1191920*g + 0.9503041*b) / 1.08883);
    [116.*y - 16., 500.*(x - y), 200.*(y - z)]
}

fn lab_to_srgb(l: f64, a: f64, b: f64) -> [u8; 3] {
    let (y, fy) = if l < 8. {
        let y = f64::from((l * 100. / 903.3) as f32);
        (y, y / 100. * 7.787 + 16. / 116.)
    } else {
        let fy = (l + 16.) / 116.;
        (f64::from((fy * fy * fy * 100.) as f32), fy)
    };
    let inv = |v: f64| if v > 0.206893 { v*v*v } else { (v - 16./116.) / 7.787 };
    let x = f64::from((95.047 * inv(a / 500. + fy)) as f32) / 100.;
    let z = f64::from((108.883 * inv(fy - b / 200.)) as f32) / 100.;
    let y = y / 100.;
    [3.2404542*x - 1.5371385*y - 0.4985314*z,
     -0.9692660*x + 1.8760108*y + 0.0415560*z,
     0.0556434*x - 0.2040259*y + 1.0572252*z].map(srgb_byte)
}

impl super::png_pixels::Raster {
    pub fn modulate(&mut self, [brightness, saturation, hue]: [f64; 3]) {
        let brightness = brightness / 100.;
        let saturation = saturation / 100.;
        let offset = ((hue - 100.) * 1.8).to_radians();
        for pixel in &mut self.pixels {
            let [l, a, b] = srgb_to_lab([pixel[0], pixel[1], pixel[2]]);
            let chroma = a.hypot(b) * saturation;
            let (sin, cos) = (b.atan2(a) + offset).sin_cos();
            pixel[..3].copy_from_slice(&lab_to_srgb(l * brightness, chroma * cos, chroma * sin));
        }
        self.gray = false;
    }

    pub fn tint(&mut self, [r, g, b, _]: [u8; 4]) {
        let [_, a, b] = srgb_to_lab([r, g, b]);
        let lut: [[u8; 3]; 256] = std::array::from_fn(|i| {
            let [l, _, _] = srgb_to_lab([i as u8; 3]);
            let d = l / 100. - 0.5;
            let weight = 1. - 4. * d * d;
            lab_to_srgb(l, a * weight, b * weight)
        });
        for pixel in &mut self.pixels {
            let value = gray(pixel[0], pixel[1], pixel[2]);
            pixel[..3].copy_from_slice(&lut[usize::from(value)]);
        }
        self.gray = false;
    }

    pub fn replace_color(&mut self, target: [u8; 4], fill: Option<[u8; 4]>, fuzz: f64, invert: bool) {
        for pixel in &mut self.pixels {
            let matched = (0..3).all(|c| f64::from(pixel[c].abs_diff(target[c])) <= fuzz);
            if matched != invert {
                if let Some(color) = fill { *pixel = color; } else { pixel[3] = 0; }
            }
        }
        self.alpha = true;
    }

    pub fn sepia(&mut self, strength: f64) {
        for pixel in &mut self.pixels {
            let [r, g, b, _] = pixel.map(f64::from);
            let sepia = [0.393*r + 0.769*g + 0.189*b, 0.349*r + 0.686*g + 0.168*b, 0.272*r + 0.534*g + 0.131*b];
            for (c, tone) in pixel[..3].iter_mut().zip(sepia) {
                *c = (f64::from(*c) * (1. - strength) + tone.min(255.) * strength).round() as u8;
            }
        }
    }

    fn map_rgb(&mut self, curve: impl Fn(f64) -> u8) {
        let lut: [u8; 256] = std::array::from_fn(|i| curve(i as f64));
        for p in &mut self.pixels {
            for c in &mut p[..3] {
                *c = lut[usize::from(*c)];
            }
        }
    }

    pub fn linear(&mut self, slope: f64, offset: f64, gray_alpha: bool) {
        self.map_rgb(|v| (v * slope + offset + 1e-6).floor() as u8);
        if gray_alpha {
            for p in &mut self.pixels {
                let gray = p[0];
                p[1..3].fill(gray);
            }
        }
    }

    pub fn sigmoidal_contrast(&mut self, spec: &str) {
        let mut parts = spec.split('x');
        let beta = super::parse_float_prefix(parts.next().filter(|s| !s.is_empty()).unwrap_or("3"));
        let beta = if beta < 1e-4 { 1e-4 } else { beta };
        let midpoint = parts.next().unwrap_or("50%");
        let mid = super::parse_float_prefix(if midpoint.is_empty() { "50" } else { midpoint });
        let alpha = mid / if midpoint.ends_with('%') { 100. } else { 255. };
        let sigmoid = |v: f64| 1. / (1. + (beta * (alpha - v)).exp());
        let low = sigmoid(0.);
        let span = (sigmoid(1.) - low).max(1e-6);
        self.map_rgb(|v| ((sigmoid(v / 255.) - low) / span * 255.).round() as u8);
    }

    pub fn level(&mut self, spec: &str, inverse: bool) {
        let mut parts = spec.split(',');
        let percent = spec.contains('%');
        let point = |s: Option<&str>, default| s.filter(|s| !s.is_empty()).map_or(default, |s| {
            let n = super::parse_float_prefix(s);
            if percent { n / 100. * 255. } else { n }
        });
        let black = point(parts.next(), 0.);
        let white = point(parts.next(), 255.);
        let gamma = parts.next().map_or(1., super::parse_float_prefix);
        let exponent = 1. / gamma.max(0.01);
        let span = (white - black).max(1e-6);
        self.map_rgb(|v| {
            if gamma.is_nan() || black.is_nan() || white.is_nan() { return 0; }
            let n = if inverse {
                black + (v / 255.).powf(exponent) * span
            } else {
                ((v - black) / span).clamp(0., 1.).powf(exponent) * 255.
            };
            if n.is_finite() { n.round() as u8 } else { 0 }
        });
    }

    pub fn posterize(&mut self, levels: f64) {
        let max = levels - 1.;
        let step = 255. / max;
        self.map_rgb(|v| ((v / 255. * max).round() * step).round() as u8);
    }

    pub fn gamma(&mut self, gamma: f64) {
        let g = if gamma < 0.1 { 0.1 } else { gamma };
        self.map_rgb(|v| {
            if g.is_nan() { return 0; }
            let first = (255. * (v / 255.).powf(g)).floor();
            (255. * (first / 255.).powf(1. / g)).floor() as u8
        });
    }

    pub fn threshold(&mut self, value: f64) {
        self.gray = true;
        for p in &mut self.pixels {
            let bit = if f64::from(gray(p[0], p[1], p[2])) >= value {
                255
            } else {
                0
            };
            p[..3].fill(bit);
            p[3] = if !self.alpha || f64::from(p[3]) >= value {
                255
            } else {
                0
            };
        }
    }

    pub fn clip_threshold(&mut self, value: f64, white: bool) {
        for p in &mut self.pixels {
            let level = intensity(p);
            if white && level > value || !white && level <= value {
                p[..3].fill(if white { 255 } else { 0 });
            }
        }
    }

    pub fn apply_alpha(&mut self, mode: &str, bg: [u8; 4], channels: &mut u8) {
        match mode {
            "remove" => {
                for p in &mut self.pixels {
                    let a = u32::from(p[3]);
                    for i in 0..3 {
                        let background = bg[if *channels == 2 { 0 } else { i }];
                        p[i] =
                            ((u32::from(p[i]) * a + u32::from(background) * (255 - a)) / 255) as u8;
                    }
                    p[3] = 255;
                }
                self.alpha = false;
                if matches!(*channels, 2 | 4) {
                    *channels -= 1;
                }
            }
            "off" | "deactivate" | "opaque" | "transparent" => {
                for p in &mut self.pixels {
                    p[3] = if mode == "transparent" { 0 } else { 255 };
                }
                self.alpha = matches!(mode, "opaque" | "transparent");
            }
            "copy" | "shape" => {
                for p in &mut self.pixels {
                    p[3] = intensity(p).round() as u8;
                    if mode == "shape" {
                        p[..3].copy_from_slice(&bg[..3]);
                    }
                }
                self.alpha = true;
            }
            "on" | "set" | "activate" if !self.alpha => {
                for p in &mut self.pixels {
                    p[3] = 255;
                }
                self.alpha = true;
                *channels = 4;
            }
            "extract" => {
                for p in &mut self.pixels {
                    let a = if self.alpha { p[3] } else { 255 };
                    *p = [a, a, a, 255];
                }
                self.gray = true;
                self.alpha = false;
                *channels = 1;
            }
            _ => {}
        }
    }
}
