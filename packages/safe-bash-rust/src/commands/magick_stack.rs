use super::{
    SafeBashFs, gif, magick_color::Canvas, magick_coordinates::Gravity, png_pixels::Raster,
    resolve_posix_path,
};
use std::{ops::Range, rc::Rc};

pub(super) enum Step<'a> {
    Canvas(Canvas, (u32, u32)),
    File(&'a str),
    Append(bool, Gravity, [u8; 4]),
}

struct SourceTiming {
    delays: Vec<u16>,
    repeat: Option<u16>,
}

pub(super) struct Scene {
    pub image: Raster,
    timing: Option<Rc<SourceTiming>>,
}

pub(super) struct Images {
    pub frames: Vec<Scene>,
}

pub(super) enum SceneName {
    Literal,
    Suffix,
    Index(Range<usize>, usize),
}

impl SceneName {
    pub fn parse(path: &str) -> Self {
        let mut result = Self::Literal;
        for (at, _) in path.match_indices('%') {
            let tail = &path[at + 1..];
            let n = tail.bytes().take_while(u8::is_ascii_digit).count();
            if tail.as_bytes().get(n) != Some(&b'd') {
                continue;
            }
            let range = at..at + 2 + n;
            if n > 1 && tail.starts_with('0') {
                return Self::Index(range, tail[1..n].parse().unwrap_or(usize::MAX));
            }
            if n == 0 && !matches!(result, Self::Index(..)) {
                result = Self::Index(range, 0);
            } else if matches!(result, Self::Literal) {
                result = Self::Suffix;
            }
        }
        result
    }

    fn filename(&self, path: &str, index: usize, limit: usize) -> Result<String, &'static str> {
        if let Self::Index(range, width) = self {
            if width.saturating_add(path.len()) > limit {
                return Err("output byte limit exceeded");
            }
            let mut name = path.to_owned();
            name.replace_range(range.clone(), &format!("{index:0width$}"));
            Ok(name)
        } else {
            let dot = path.rfind('.').filter(|i| *i > 0).unwrap_or(path.len());
            Ok(format!("{}-{index}{}", &path[..dot], &path[dot..]))
        }
    }
}

impl Images {
    pub fn split(
        self,
        name: SceneName,
        (format, path): (&str, &str),
        quality: f64,
        cwd: &str,
        fs: &dyn SafeBashFs,
    ) -> super::BuiltinOutcome {
        let limit = fs.max_input_bytes();
        let mut outputs = Vec::with_capacity(self.frames.len());
        let mut remaining = limit;
        for (index, scene) in self.frames.into_iter().enumerate() {
            let im = scene.image;
            let path = match name.filename(path, index, remaining) {
                Ok(path) => path,
                Err(e) => return super::err_out(&format!("magick: {e}\n"), 1),
            };
            let bytes = if format == "gif" {
                let source = scene.timing.as_ref();
                gif::encode(
                    im.width,
                    im.height,
                    &im.pixels,
                    gif::Timing {
                        delays: source.map_or(&[][..], |s| s.delays.as_slice()),
                        repeat: source.and_then(|s| s.repeat),
                        explicit_delay: false,
                    },
                    remaining,
                )
            } else if format == "png" {
                Ok(im.png())
            } else {
                super::frame_output::encode(&im, format, quality, im.density, limit)
            };
            let bytes = match bytes {
                Ok(b) => b,
                Err(e) => return super::err_out(&format!("magick: {e}\n"), 1),
            };
            let Some(left) = remaining.checked_sub(path.len().saturating_add(bytes.len())) else {
                return super::err_out("magick: output byte limit exceeded\n", 1);
            };
            remaining = left;
            outputs.push((path, bytes));
        }
        for (path, bytes) in outputs {
            let result = Raster::publish_bytes(&bytes, &path, cwd, fs);
            if result.exit_code != 0 {
                return result;
            }
        }
        super::ok_out("")
    }
    pub fn gif(
        self,
        timing: gif::Timing,
        kernel: super::magick_resize::Kernel,
        limit: usize,
    ) -> Result<Vec<u8>, &'static str> {
        let mut frames = self.frames.into_iter();
        let Scene {
            mut image,
            timing: source,
        } = frames.next().ok_or("internal error")?;
        let (w, h) = (image.width, image.height);
        if (frames.len() + 1).saturating_mul(image.pixels.len()) > limit / 4 {
            return Err("image exceeds memory budget");
        }
        image
            .pixels
            .reserve_exact(frames.len() * image.pixels.len());
        let size = format!("{w}x{h}!");
        for Scene {
            image: mut frame, ..
        } in frames
        {
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
                    source.as_ref().map_or(&[][..], |s| s.delays.as_slice())
                },
                repeat: timing
                    .repeat
                    .or_else(|| source.as_ref().and_then(|s| s.repeat)),
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
    let mut stack: Vec<(Scene, usize)> = Vec::new();
    let mut retained = 0usize;
    for (at, step) in steps {
        let mut push = |im: Raster, timing| {
            retained = retained
                .saturating_add(im.pixels.len().saturating_mul(4))
                .saturating_add(size_of::<Raster>());
            if retained > limit {
                return Err("image exceeds memory budget");
            }
            stack.push((Scene { image: im, timing }, *at));
            Ok(())
        };
        match step {
            Step::Canvas(canvas, size) => push(canvas.raster(*size, limit)?, None)?,
            Step::File(spec) => {
                let path = spec.strip_prefix("png:").unwrap_or(spec);
                let Ok(bytes) = fs.read_file(&resolve_posix_path(cwd, path)) else {
                    return Ok(None);
                };
                if gif::signature(&bytes) && !bytes[6..].starts_with(b"\n__IMG__:") {
                    let mut delays = Vec::new();
                    let repeat = match gif::packets(&bytes, |delay, _| {
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
                    let source = Rc::new(SourceTiming { delays, repeat });
                    gif::scenes(&bytes, limit, |im| push(im, Some(source.clone())))?;
                } else if let Some(im) = Raster::input(path, &bytes, limit)? {
                    push(im, None)?;
                } else {
                    return Ok(None);
                }
            }
            Step::Append(vertical, gravity, bg) if stack.len() > 1 => {
                let (mut w, mut h) = (0usize, 0usize);
                retained = 0;
                for (scene, start) in &mut stack {
                    let im = &mut scene.image;
                    transform(im, *start..*at, scene.timing.is_some())?;
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
                for (Scene { image: im, .. }, _) in stack.drain(..) {
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
                retained = w * h * 4;
                stack.push((
                    Scene {
                        image: out,
                        timing: None,
                    },
                    *at,
                ));
            }
            Step::Append(..) => {}
        }
    }
    if stack.is_empty() {
        return Ok(None);
    }
    retained = 0;
    let mut frames = Vec::with_capacity(stack.len());
    for (mut scene, start) in stack {
        let im = &mut scene.image;
        if !transform(im, start..end, scene.timing.is_some())? {
            scene.timing = None;
        }
        retained = retained.saturating_add(im.pixels.len().saturating_mul(4));
        if retained > limit {
            return Err("image exceeds memory budget".into());
        }
        frames.push(scene);
    }
    Ok(Some(Images { frames }))
}
