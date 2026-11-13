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
            cover(&mut self.group_alpha, i, a * opacity);
            self.blend.composite(dest, source, a * opacity);
        }
        *bytes = bytes.checked_sub(count.checked_mul(12)?)?;
        Some(())
    }
}
