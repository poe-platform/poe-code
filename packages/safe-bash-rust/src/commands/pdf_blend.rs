// PDF separable and nonseparable blend functions, on unassociated RGB channels.
#[derive(Clone, Copy, PartialEq, Default)]
pub(super) enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}
impl BlendMode {
    pub(super) fn read(name: &[u8]) -> Option<Self> {
        Some(match name {
            b"Normal" | b"Compatible" => Self::Normal,
            b"Multiply" => Self::Multiply,
            b"Screen" => Self::Screen,
            b"Overlay" => Self::Overlay,
            b"Darken" => Self::Darken,
            b"Lighten" => Self::Lighten,
            b"ColorDodge" => Self::ColorDodge,
            b"ColorBurn" => Self::ColorBurn,
            b"HardLight" => Self::HardLight,
            b"SoftLight" => Self::SoftLight,
            b"Difference" => Self::Difference,
            b"Exclusion" => Self::Exclusion,
            b"Hue" => Self::Hue,
            b"Saturation" => Self::Saturation,
            b"Color" => Self::Color,
            b"Luminosity" => Self::Luminosity,
            _ => return None,
        })
    }
    pub(super) fn composite(self, dest: &mut [u8; 4], source: [f64; 3], alpha: f64) {
        let prior = f64::from(dest[3]) / 255.;
        let out = alpha + prior * (1. - alpha);
        if out == 0. {
            return;
        }
        let back = [dest[0], dest[1], dest[2]].map(|v| f64::from(v) / 255.);
        let blended = match self {
            Self::Hue => set_lum(set_sat(source, sat(back)), lum(back)),
            Self::Saturation => set_lum(set_sat(back, sat(source)), lum(back)),
            Self::Color => set_lum(source, lum(back)),
            Self::Luminosity => set_lum(back, lum(source)),
            _ => std::array::from_fn(|i| {
                let (b, s) = (back[i], source[i]);
                match self {
                    Self::Multiply => b * s,
                    Self::Screen => b + s - b * s,
                    Self::Overlay => {
                        if b <= 0.5 {
                            2. * b * s
                        } else {
                            1. - 2. * (1. - b) * (1. - s)
                        }
                    }
                    Self::Darken => b.min(s),
                    Self::Lighten => b.max(s),
                    Self::ColorDodge => {
                        if b == 0. {
                            0.
                        } else if s == 1. {
                            1.
                        } else {
                            (b / (1. - s)).min(1.)
                        }
                    }
                    Self::ColorBurn => {
                        if b == 1. {
                            1.
                        } else if s == 0. {
                            0.
                        } else {
                            1. - ((1. - b) / s).min(1.)
                        }
                    }
                    Self::HardLight => {
                        if s <= 0.5 {
                            2. * b * s
                        } else {
                            1. - 2. * (1. - b) * (1. - s)
                        }
                    }
                    Self::SoftLight => {
                        if s <= 0.5 {
                            b - (1. - 2. * s) * b * (1. - b)
                        } else {
                            let d = if b <= 0.25 {
                                ((16. * b - 12.) * b + 4.) * b
                            } else {
                                b.sqrt()
                            };
                            b + (2. * s - 1.) * (d - b)
                        }
                    }
                    Self::Difference => (b - s).abs(),
                    Self::Exclusion => b + s - 2. * b * s,
                    _ => s,
                }
            }),
        };
        for i in 0..3 {
            let effective = (1. - prior) * source[i] + prior * blended[i];
            dest[i] =
                ((effective * alpha + back[i] * prior * (1. - alpha)) / out * 255.).round() as u8;
        }
        dest[3] = (out * 255.).round() as u8;
    }
}
fn lum(c: [f64; 3]) -> f64 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}
fn sat(c: [f64; 3]) -> f64 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}
fn set_lum(c: [f64; 3], l: f64) -> [f64; 3] {
    let mut c = c.map(|v| v + l - lum(c));
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    if n < 0. && l - n > 1e-7 {
        c = c.map(|v| l + (v - l) * l / (l - n));
    }
    if x > 1. && x - l > 1e-7 {
        c = c.map(|v| l + (v - l) * (1. - l) / (x - l));
    }
    c.map(|v| v.clamp(0., 1.))
}
fn set_sat(c: [f64; 3], s: f64) -> [f64; 3] {
    let mut indices = [0, 1, 2];
    indices.sort_by(|&a, &b| c[a].total_cmp(&c[b]));
    let [min, mid, max] = indices;
    let mut out = [0.; 3];
    if c[max] > c[min] {
        out[mid] = (c[mid] - c[min]) * s / (c[max] - c[min]);
        out[max] = s;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::BlendMode;

    #[test]
    fn separable_modes_use_pdf_channel_equations() {
        // Backdrop (.2, .4, .6), source (.8, .3, .5), opaque samples.
        for (mode, expected) in [
            (BlendMode::Normal, [204u8, 77, 128]),
            (BlendMode::Multiply, [41, 31, 77]),
            (BlendMode::Screen, [214, 148, 204]),
            (BlendMode::Overlay, [82, 61, 153]),
            (BlendMode::Darken, [51, 77, 128]),
            (BlendMode::Lighten, [204, 102, 153]),
            (BlendMode::ColorDodge, [255, 146, 255]),
            (BlendMode::ColorBurn, [0, 0, 51]),
            (BlendMode::HardLight, [173, 61, 153]),
            (BlendMode::SoftLight, [89, 78, 153]),
            (BlendMode::Difference, [153, 26, 26]),
            (BlendMode::Exclusion, [173, 117, 128]),
        ] {
            let mut pixel = [51, 102, 153, 255];
            mode.composite(&mut pixel, [0.8, 0.3, 0.5], 1.);
            for i in 0..3 {
                assert!(
                    pixel[i].abs_diff(expected[i]) <= 1,
                    "{pixel:?} != {expected:?}"
                );
            }
            assert_eq!(pixel[3], 255);
        }
    }

    #[test]
    fn nonseparable_modes_preserve_luminance_and_saturation() {
        // Red backdrop and blue source: PDF luminance red=.3, blue=.11.
        for (mode, expected) in [
            (BlendMode::Hue, [54u8, 54, 255]),
            (BlendMode::Saturation, [255, 0, 0]),
            (BlendMode::Color, [54, 54, 255]),
            (BlendMode::Luminosity, [94, 0, 0]),
        ] {
            let mut pixel = [255, 0, 0, 255];
            mode.composite(&mut pixel, [0., 0., 1.], 1.);
            for i in 0..3 {
                assert!(
                    pixel[i].abs_diff(expected[i]) <= 1,
                    "{pixel:?} != {expected:?}"
                );
            }
        }
    }

    #[test]
    fn blending_accounts_for_source_and_backdrop_alpha() {
        let mut pixel = [255, 0, 0, 128];
        BlendMode::Multiply.composite(&mut pixel, [0., 0., 1.], 0.5);
        assert_eq!(pixel, [85, 0, 85, 192]);
        let mut pixel = [0; 4];
        BlendMode::Screen.composite(&mut pixel, [0., 0., 1.], 0.5);
        assert_eq!(pixel, [0, 0, 255, 128]);
    }
}
