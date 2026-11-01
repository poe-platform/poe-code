use super::{
    SafeBashFs, gif, magick_color::Canvas, magick_coordinates::Gravity, png_pixels::Raster,
    resolve_posix_path,
};
use std::ops::Range;

pub(super) enum Step<'a> {
    Canvas(Canvas, (u32, u32)),
    File(&'a str),
    Append(bool, Gravity, [u8; 4]),
}

pub(super) struct Images {
    pub frames: Vec<Raster>,
    delays: Vec<u16>,
    repeat: Option<u16>,
}

impl Images {
    pub fn gif(
        self,
        timing: gif::Timing,
        kernel: super::magick_resize::Kernel,
        limit: usize,
    ) -> Result<Vec<u8>, &'static str> {
        let mut frames = self.frames.into_iter();
        let mut image = frames.next().ok_or("internal error")?;
        let (w, h) = (image.width, image.height);
        if (frames.len() + 1).saturating_mul(image.pixels.len()) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        image.pixels.reserve_exact(frames.len() * image.pixels.len());
        let size = format!("{w}x{h}!");
        for mut frame in frames {
            if (frame.width, frame.height) != (w, h) {
                frame.resize(&size, kernel, limit)?;
            }
            image.pixels.append(&mut frame.pixels);
        }
        gif::encode(
            w,
            h,
            &image.pixels,
            gif::Timing {
                delays: if timing.explicit_delay {
                    timing.delays
                } else {
                    &self.delays
                },
                repeat: timing.repeat.or(self.repeat),
                explicit_delay: timing.explicit_delay,
            },
            limit,
        )
    }
}

pub(super) fn evaluate(
    steps: &[(usize, Step)],
    end: usize,
    transform: impl Fn(&mut Raster, Range<usize>, bool) -> Result<bool, &'static str>,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> Result<Option<Images>, String> {
    let limit = fs.max_input_bytes();
    // Defer each image's pixel operations until the next append. Later inputs
    // don't see operations that occurred before they joined the stack.
    let mut stack: Vec<(Raster, usize, bool)> = Vec::new();
    let mut retained = 0usize;
    let (mut delays, mut repeat) = (Vec::new(), None);
    for (at, step) in steps {
        let first = stack.is_empty();
        let mut push = |im: Raster, gif_input| {
            retained = retained
                .saturating_add(im.pixels.len().saturating_mul(4))
                .saturating_add(size_of::<Raster>());
            if retained > limit {
                return Err("image exceeds memory budget");
            }
            stack.push((im, *at, gif_input));
            Ok(())
        };
        match step {
            Step::Canvas(canvas, size) => push(canvas.raster(*size, limit)?, false)?,
            Step::File(spec) => {
                let path = spec.strip_prefix("png:").unwrap_or(spec);
                let Ok(bytes) = fs.read_file(&resolve_posix_path(cwd, path)) else {
                    return Ok(None);
                };
                if gif::signature(&bytes) && !bytes[6..].starts_with(b"\n__IMG__:") {
                    if first {
                        repeat = match gif::packets(&bytes, |delay, _| {
                            if delays.len() >= limit / size_of::<u16>() {
                                return Err("image exceeds memory budget");
                            }
                            delays.push(delay);
                            Ok(())
                        }) {
                            Ok(repeat) => repeat,
                            Err(e @ "image exceeds memory budget") => return Err(e.into()),
                            Err(_) => None,
                        };
                    }
                    gif::scenes(&bytes, limit, |im| push(im, true))?;
                } else if let Some(im) = Raster::input(path, &bytes, limit)? {
                    push(im, false)?;
                } else {
                    return Ok(None);
                }
            }
            Step::Append(vertical, gravity, bg) if stack.len() > 1 => {
                let (mut w, mut h) = (0usize, 0usize);
                retained = 0;
                for (im, start, gif_input) in &mut stack {
                    transform(im, *start..*at, *gif_input)?;
                    retained = retained.saturating_add(im.pixels.len() * 4);
                    if retained > limit {
                        return Err("image exceeds memory budget".into());
                    }
                    if *vertical {
                        w = w.max(im.width);
                        h = h.saturating_add(im.height);
                    } else {
                        w = w.saturating_add(im.width);
                        h = h.max(im.height);
                    }
                }
                if w.saturating_mul(h) > limit / 4 {
                    return Err("image exceeds memory budget".into());
                }
                let mut out = Raster {
                    width: w,
                    height: h,
                    gray: false,
                    alpha: true,
                    density: 72,
                    orientation: None,
                    pixels: vec![*bg; w * h],
                };
                let mut cursor = 0;
                for (im, ..) in stack.drain(..) {
                    let (x, y) = if *vertical {
                        (gravity.offset(w - im.width, 0).0, cursor)
                    } else {
                        (cursor, gravity.offset(0, h - im.height).1)
                    };
                    for (row, pixels) in im.pixels.chunks_exact(im.width).enumerate() {
                        let start = (row + y) * w + x;
                        for (d, &s) in out.pixels[start..start + im.width].iter_mut().zip(pixels) {
                            *d = super::magick_composite::blend(s, *d, "over", 1., 1.);
                        }
                    }
                    cursor += if *vertical { im.height } else { im.width };
                }
                delays.clear();
                repeat = None;
                retained = w * h * 4;
                stack.push((out, *at, false));
            }
            Step::Append(..) => {}
        }
    }
    if stack.is_empty() {
        return Ok(None);
    }
    retained = 0;
    let mut frames = Vec::with_capacity(stack.len());
    for (mut im, start, gif_input) in stack {
        let keep_timing = transform(&mut im, start..end, gif_input)?;
        if frames.is_empty() && !keep_timing {
            delays.clear();
            repeat = None;
        }
        retained = retained.saturating_add(im.pixels.len().saturating_mul(4));
        if retained > limit {
            return Err("image exceeds memory budget".into());
        }
        frames.push(im);
    }
    Ok(Some(Images {
        frames,
        delays,
        repeat,
    }))
}
