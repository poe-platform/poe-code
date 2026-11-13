use super::{Bitmap, Objects, Value, over_white};

// The renderer blends in RGB. Reject knockout and other blending spaces rather
// than silently changing their semantics. Omitted /I and /K default to false.
pub(super) fn read<'a>(objects: &mut Objects<'a>, value: &Value<'a>) -> Option<bool> {
    let dict = objects.resolve(value)?;
    if objects.resolve(dict.get(b"S")?)?.word()? != b"/Transparency" {
        return None;
    }
    let mut flag = |key: &[u8]| match dict.get(key) {
        None => Some(false),
        Some(v) => match objects.resolve(v)?.word()? {
            b"true" => Some(true),
            b"false" => Some(false),
            _ => None,
        },
    };
    let isolated = flag(b"I")?;
    if flag(b"K")? {
        return None;
    }
    if let Some(v) = dict.get(b"CS")
        && objects.resolve(v)?.word()? != b"/DeviceRGB"
    {
        return None;
    }
    Some(isolated)
}

pub(super) fn cover(alpha: &mut Option<Vec<f64>>, index: usize, source: f64) {
    if let Some(alpha) = alpha {
        alpha[index] += source * (1. - alpha[index]);
    }
}

pub(super) struct Group {
    pixels: Vec<[u8; 4]>,
    alpha: Option<Vec<f64>>,
    white: bool,
    isolated: bool,
}
impl Bitmap {
    pub(super) fn end_soft_mask(
        &mut self,
        group: Group,
        mask: super::super::pdf_text_layout::SoftMask,
        limit: usize,
        bytes: &mut usize,
    ) -> Option<()> {
        let count = self.pixels.len();
        // Retained masks can be shared by q/Q and Form states. Charge each
        // allocation to the page budget even after a state releases it.
        *bytes = bytes.checked_add(count.checked_mul(8)?)?;
        if *bytes > limit { return None; }
        self.work = self.work.checked_sub(count.checked_mul(16)?)?;
        let mut values = Vec::new();
        values.try_reserve_exact(count).ok()?;
        let [p0, p1, _, p3] = *self.form_clips.last()?;
        let (a, b, c, d) = (p1[0] - p0[0], p1[1] - p0[1], p3[0] - p0[0], p3[1] - p0[1]);
        let det = a * d - b * c;
        let outside_alpha = 0.3 * mask.backdrop[0] + 0.59 * mask.backdrop[1] + 0.11 * mask.backdrop[2];
        for (i, p) in self.pixels.iter().enumerate() {
            let alpha = f64::from(p[3]) / 255.;
            values.push(if mask.luminosity {
                [0.3, 0.59, 0.11].iter().enumerate().map(|(i, w)|
                    w * (f64::from(p[i]) / 255. * alpha + mask.backdrop[i] * (1. - alpha))
                ).sum::<f64>().clamp(0., 1.)
            } else {
                let (x, y) = ((i % self.w) as f64 + 0.5 - p0[0], (i / self.w) as f64 + 0.5 - p0[1]);
                let (u, v) = ((d * x - c * y) / det, (a * y - b * x) / det);
                if !(0. ..1.).contains(&u) || !(0. ..1.).contains(&v) { outside_alpha } else { alpha }
            });
        }
        self.pixels = group.pixels;
        self.group_alpha = group.alpha;
        self.white_background = group.white;
        self.soft_mask = Some(std::rc::Rc::new(values));
        *bytes = bytes.checked_sub(count.checked_mul(12)?)?;
        Some(())
    }

    pub(super) fn begin_group(
        &mut self,
        isolated: bool,
        limit: usize,
        bytes: &mut usize,
    ) -> Option<Group> {
        let count = self.pixels.len();
        // Account for every live surface and its independent group coverage.
        *bytes = bytes.checked_add(count.checked_mul(12)?)?;
        if *bytes > limit {
            return None;
        }
        self.work = self.work.checked_sub(count.checked_mul(2)?)?;
        let mut pixels = Vec::new();
        pixels.try_reserve_exact(count).ok()?;
        pixels.resize(count, [0; 4]);
        if !isolated {
            pixels.copy_from_slice(&self.pixels);
            if self.white_background {
                for pixel in &mut pixels {
                    over_white(pixel, self.backend);
                }
            }
        }
        let mut alpha = Vec::new();
        alpha.try_reserve_exact(count).ok()?;
        alpha.resize(count, 0.);
        Some(Group {
            pixels: std::mem::replace(&mut self.pixels, pixels),
            alpha: self.group_alpha.replace(alpha),
            white: std::mem::replace(&mut self.white_background, false),
            isolated,
        })
    }

    pub(super) fn end_group(
        &mut self,
        group: Group,
        opacity: f64,
        bytes: &mut usize,
    ) -> Option<()> {
        let count = self.pixels.len();
        self.work = self.work.checked_sub(count)?;
        let pixels = std::mem::replace(&mut self.pixels, group.pixels);
        let alpha = std::mem::replace(&mut self.group_alpha, group.alpha)?;
        self.white_background = group.white;
        for (i, (pixel, a)) in pixels.into_iter().zip(alpha).enumerate() {
            if a == 0. {
                continue;
            }
            let dest = &mut self.pixels[i];
            if group.white {
                over_white(dest, self.backend);
            }
            let source = if group.isolated {
                std::array::from_fn(|k| f64::from(pixel[k]) / 255.)
            } else {
                // Remove the initial backdrop before applying the group's entry
                // alpha and blend mode (PDF 32000-1, non-isolated group formula).
                std::array::from_fn(|k| {
                    ((f64::from(pixel[k]) * f64::from(pixel[3]) / 255.
                        - f64::from(dest[k]) * f64::from(dest[3]) / 255. * (1. - a))
                        / a
                        / 255.)
                        .clamp(0., 1.)
                })
            };
            let opacity = opacity * self.soft_mask.as_ref().map_or(1., |m| m[i]);
            cover(&mut self.group_alpha, i, a * opacity);
            self.blend.composite(dest, source, a * opacity);
        }
        *bytes = bytes.checked_sub(count.checked_mul(12)?)?;
        Some(())
    }
}
