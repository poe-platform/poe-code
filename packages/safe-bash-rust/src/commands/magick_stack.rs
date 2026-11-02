use super::{
    SafeBashFs, gif,
    magick_color::Canvas,
    magick_coordinates::{Geometry, Gravity},
    magick_resize::Kernel,
    png_pixels::Raster,
    resolve_posix_path,
};
use std::{collections::HashMap, ops::Range, rc::Rc};

#[derive(Clone, Copy)]
pub(super) enum Modifier<'a> {
    None,
    Pages(&'a str),
    Crop(&'a str),
    Resize(&'a str),
}

pub(super) fn input_spec(token: &str) -> (&str, Modifier<'_>) {
    let Some((base, spec)) = token.strip_suffix(']').and_then(|s| s.rsplit_once('[')) else {
        return (token, Modifier::None);
    };
    if spec.is_empty() || spec.contains(']') {
        return (token, Modifier::None);
    }
    if spec.split(',').all(integer) || range(spec).is_some() {
        (base, Modifier::Pages(spec))
    } else if !super::magick_coordinates::split_offsets(spec).1.is_empty() {
        (base, Modifier::Crop(spec))
    } else {
        (base, Modifier::Resize(spec))
    }
}

pub(super) fn tile_pattern(token: &str) -> Option<&str> {
    token
        .get(..5)
        .filter(|s| s.eq_ignore_ascii_case("tile:"))
        .map(|_| &token[5..])
}

pub(super) fn tile_operand(mut token: &str) -> (&str, Modifier<'_>, Vec<Modifier<'_>>) {
    let mut tiles = Vec::new();
    loop {
        let (base, modifier) = input_spec(token);
        let Some(pattern) = tile_pattern(base) else {
            return (base, modifier, tiles);
        };
        tiles.push(modifier);
        token = pattern;
    }
}

impl Raster {
    pub(super) fn apply_tiles(
        &mut self,
        tiles: &[Modifier],
        (w, h): (u32, u32),
        kernel: Kernel,
        limit: usize,
    ) -> Result<(), &'static str> {
        let (w, h) = (w as usize, h as usize);
        for modifier in tiles.iter().rev() {
            if w.checked_mul(h).is_none_or(|n| n > limit / 4) {
                return Err("image exceeds memory budget");
            }
            if self.width == 0 || self.height == 0 {
                return Err("Invalid stored image dimensions");
            }
            if (w, h) != (self.width, self.height) {
                self.remap(w, h, |im, x, y| {
                    im.pixels[(y % im.height) * im.width + x % im.width]
                });
            }
            self.alpha = true;
            self.gray = false;
            self.density = 72;
            self.orientation = None;
            modifier.geometry(self, kernel, limit)?;
        }
        Ok(())
    }
}

fn integer(s: &str) -> bool {
    let s = s.strip_prefix('-').unwrap_or(s);
    !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())
}
fn range(s: &str) -> Option<(&str, &str)> {
    let (i, _) = s.char_indices().skip(1).find(|(_, c)| *c == '-')?;
    let (a, b) = (&s[..i], &s[i + 1..]);
    (integer(a) && integer(b)).then_some((a, b))
}

impl Modifier<'_> {
    pub fn geometry(
        self,
        im: &mut Raster,
        kernel: Kernel,
        limit: usize,
    ) -> Result<(), &'static str> {
        match self {
            Self::Crop(g) if im.width != 0 && im.height != 0 => {
                im.crop(Geometry::parse(g), Gravity::parse("northwest"))
            }
            Self::Crop(_) => return Err("internal error"),
            Self::Resize(g) if im.width != 0 && im.height != 0 => im.resize(g, kernel, limit)?,
            Self::Resize(_) => return Err("Invalid stored image dimensions"),
            _ => {}
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(super) enum Step<'a> {
    Input(&'a str, (u32, u32), Kernel),
    Write(&'a str, f64, bool),
    Edit(&'a str, &'a str, usize),
    Append(bool, Gravity, [u8; 4]),
}

struct SourceTiming {
    delays: Vec<u16>,
    repeat: Option<u16>,
}

#[derive(Clone)]
pub(super) struct Scene {
    pub image: Raster,
    format: &'static str,
    png_alpha: bool,
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

impl Scene {
    pub fn encode(
        mut self,
        format: &str,
        quality: f64,
        limit: usize,
    ) -> Result<Vec<u8>, &'static str> {
        if format == "png" {
            self.image.alpha |= self.png_alpha;
        }
        let im = &self.image;
        if format == "gif" {
            let source = self.timing.as_ref();
            gif::encode(
                im.width,
                im.height,
                &im.pixels,
                gif::Timing {
                    delays: source.map_or(&[][..], |s| s.delays.as_slice()),
                    repeat: source.and_then(|s| s.repeat),
                    explicit_delay: false,
                },
                limit,
            )
        } else if format == "png" {
            Ok(im.png())
        } else {
            super::frame_output::encode(im, format, quality, im.density, limit)
        }
    }
}

// A later input sees the most recent encoding for its exact operand. Files are
// published in first-write order, including on a subsequent pixel-operation error.
#[derive(Default)]
pub(super) struct Snapshots {
    files: HashMap<String, (usize, Vec<u8>)>,
    size: usize,
}

impl Snapshots {
    pub fn stage(
        &mut self,
        path: String,
        bytes: Vec<u8>,
        limit: usize,
    ) -> Result<(), &'static str> {
        let (order, previous) = self
            .files
            .get(&path)
            .map_or((self.files.len(), 0), |(index, data)| {
                (*index, data.len() + path.len())
            });
        let size = (self.size - previous)
            .saturating_add(path.len())
            .saturating_add(bytes.len());
        if size > limit {
            return Err("output byte limit exceeded");
        }
        self.files.insert(path, (order, bytes));
        self.size = size;
        Ok(())
    }

    pub fn publish(self, cwd: &str, fs: &dyn SafeBashFs) -> super::BuiltinOutcome {
        let mut files = self.files.into_iter().collect::<Vec<_>>();
        files.sort_unstable_by_key(|(_, (order, _))| *order);
        for (path, (_, bytes)) in files {
            if let Err(e) =
                super::publish_magick_output(fs, &resolve_posix_path(cwd, &path), &bytes)
            {
                return super::err_out(&format!("shell: line 1: {e}\n"), 1);
            }
        }
        super::ok_out("")
    }
}

impl Images {
    pub fn stage_split(
        self,
        name: SceneName,
        (format, path): (&str, &str),
        quality: f64,
        limit: usize,
        snapshots: &mut Snapshots,
    ) -> Result<(), &'static str> {
        for (index, scene) in self.frames.into_iter().enumerate() {
            snapshots.stage(
                name.filename(path, index, limit)?,
                scene.encode(format, quality, limit)?,
                limit,
            )?;
        }
        Ok(())
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
            ..
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

fn page_index(s: &str, len: usize) -> usize {
    let n = s.parse::<f64>().unwrap_or(f64::INFINITY);
    (if n < 0. { len as f64 + n } else { n }).clamp(0., len.saturating_sub(1) as f64) as usize
}

pub(super) fn first_page(spec: &str, len: usize) -> usize {
    let first = spec.split(',').next().unwrap_or(spec);
    page_index(range(first).map_or(first, |(a, _)| a), len)
}

fn indices(spec: &str, len: usize, limit: usize, clamp: bool) -> Result<Vec<usize>, &'static str> {
    let mut out = Vec::new();
    if len == 0 {
        return Ok(out);
    }
    let resolve = |v: f64| if v < 0. { len as f64 + v } else { v };
    for part in spec.split(',').map(str::trim) {
        if let Some((a, b)) = range(part) {
            let (a, b) = (page_index(a, len), page_index(b, len));
            if out.len().saturating_add(a.abs_diff(b) + 1) > limit / size_of::<usize>() {
                return Err("frame index exceeds memory budget");
            }
            if a <= b {
                out.extend(a..=b);
            } else {
                out.extend((b..=a).rev());
            }
            continue;
        }
        let prefix = part.strip_prefix(['+', '-']).unwrap_or(part);
        let digits = prefix.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 {
            continue;
        }
        let index = resolve(
            part[..part.len() - prefix.len() + digits]
                .parse()
                .unwrap_or(f64::INFINITY),
        );
        let index = if clamp {
            index.clamp(0., (len - 1) as f64)
        } else {
            index
        };
        if (0. ..len as f64).contains(&index) {
            if out.len() >= limit / size_of::<usize>() {
                return Err("frame index exceeds memory budget");
            }
            out.push(index as usize);
        }
    }
    Ok(out)
}

pub(super) fn evaluate(
    steps: &[(usize, Step)],
    end: usize,
    transform: impl Fn(&mut Raster, Range<usize>, bool) -> Result<(bool, bool), &'static str>,
    limit: usize,
    read_file: impl Fn(&str) -> Result<Vec<u8>, String>,
    snapshots: &mut Snapshots,
) -> Result<Option<Images>, String> {
    // Defer each image's pixel operations until the next append. Later inputs
    // don't see operations that occurred before they joined the stack.
    let mut stack: Vec<(Rc<Scene>, usize)> = Vec::new();
    let mut retained = 0usize;
    for (at, step) in steps {
        let first = stack.len();
        match step {
            Step::Input(token, size, kernel) => {
                let (spec, modifier, tiles) = tile_operand(token);
                let mut push = |mut im: Raster, format, timing| {
                    modifier.geometry(&mut im, *kernel, limit)?;
                    im.apply_tiles(&tiles, *size, *kernel, limit)?;
                    let (format, timing) = if tiles.is_empty() {
                        (format, timing)
                    } else {
                        ("png", None)
                    };
                    retained = retained
                        .saturating_add(im.pixels.len().saturating_mul(4))
                        .saturating_add(size_of::<Scene>() + size_of::<(Rc<Scene>, usize)>());
                    if retained > limit {
                        return Err("image exceeds memory budget");
                    }
                    stack.push((
                        Rc::new(Scene {
                            image: im,
                            format,
                            png_alpha: false,
                            timing,
                        }),
                        *at,
                    ));
                    Ok(())
                };
                if let Some(canvas) = Canvas::parse(spec) {
                    let size = if spec.eq_ignore_ascii_case("null:") {
                        (1, 1)
                    } else {
                        *size
                    };
                    push(canvas?.raster(size, limit)?, "png", None)?;
                    continue;
                }
                let path = super::png_pixels::destination(spec).map_or(spec, |(_, path)| path);
                let from_disk;
                let bytes =
                    if let Some((_, data)) = snapshots.files.get(path).filter(|_| path != "-") {
                        data
                    } else {
                        match read_file(path) {
                            Ok(data) => {
                                from_disk = data;
                                &from_disk
                            }
                            Err(e) if e.starts_with("ENOENT") => continue,
                            Err(_) => return Ok(None),
                        }
                    };
                let mut order = None;
                let format = super::png_pixels::still_format(bytes);
                if format == Some("gif") {
                    let mut delays = Vec::new();
                    let repeat = match gif::packets(bytes, |delay, _| {
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
                    let selected = if let Modifier::Pages(spec) = modifier {
                        Some(indices(spec, delays.len().max(1), limit, true)?)
                    } else {
                        None
                    };
                    let mut unique = selected.clone().unwrap_or_default();
                    unique.sort_unstable();
                    unique.dedup();
                    let source = Rc::new(SourceTiming { delays, repeat });
                    gif::scenes(bytes, &unique, limit, |im| {
                        push(im, "gif", Some(source.clone()))
                    })?;
                    if let Some(selected) = selected {
                        order = Some(
                            selected
                                .into_iter()
                                .map(|idx| unique.binary_search(&idx).unwrap())
                                .collect::<Vec<_>>(),
                        );
                    }
                } else if let Some(format) = format {
                    let im = Raster::decode(bytes, limit)?;
                    push(im, format, None)?;
                    if let Modifier::Pages(spec) = modifier {
                        order = Some(indices(spec, 1, limit, true)?);
                    }
                } else {
                    return Ok(None);
                }
                if let Some(order) = order {
                    let scenes = stack.split_off(first);
                    retained = retained.saturating_add(
                        order
                            .len()
                            .saturating_sub(scenes.len())
                            .saturating_mul(size_of::<(Rc<Scene>, usize)>()),
                    );
                    if retained > limit {
                        return Err("image exceeds memory budget".into());
                    }
                    for idx in order {
                        let scene = scenes.get(idx).ok_or("Invalid frame index")?;
                        stack.push(scene.clone());
                    }
                }
            }
            Step::Write(spec, quality, adjoin) => {
                let Some((top, _)) = stack.last() else {
                    continue;
                };
                if spec.is_empty() || spec.eq_ignore_ascii_case("null:") {
                    continue;
                }
                let (format, path) =
                    super::png_pixels::named_destination(spec).unwrap_or((top.format, *spec));
                let name = SceneName::parse(path);
                let split = stack.len() > 1 && (!adjoin || !matches!(name, SceneName::Literal));
                let mut writes = Vec::new();
                let mut size = 0usize;
                for (index, (scene, start)) in stack.iter().enumerate() {
                    let write = split || index + 1 == stack.len();
                    if !write && start == at {
                        continue;
                    }
                    let mut scene = (**scene).clone();
                    let (keep, alpha) =
                        transform(&mut scene.image, *start..*at, scene.timing.is_some())?;
                    scene.png_alpha = alpha;
                    if !keep {
                        scene.timing = None;
                    }
                    if write {
                        let path = if split {
                            name.filename(path, index, limit)?
                        } else {
                            path.to_owned()
                        };
                        let bytes = scene.encode(format, *quality, limit)?;
                        size = size.saturating_add(path.len()).saturating_add(bytes.len());
                        if size > limit {
                            return Err("output byte limit exceeded".into());
                        }
                        writes.push((path, bytes));
                    }
                }
                for (path, bytes) in writes {
                    snapshots.stage(path, bytes, limit)?;
                }
            }
            Step::Edit(op, spec, count) if !stack.is_empty() => {
                let len = stack.len();
                match *op {
                    "-reverse" => stack.reverse(),
                    "+swap" | "-swap" => {
                        let mut parts = spec.split(',');
                        let index = |s: &str| {
                            let v = super::js_number(s, 0.);
                            let v = if v < 0. { len as f64 + v } else { v };
                            (v.fract() == 0. && (0. ..len as f64).contains(&v))
                                .then_some(v as usize)
                        };
                        if let (Some(a), Some(b)) = (
                            index(parts.next().unwrap_or("-2")),
                            index(parts.next().unwrap_or("-1")),
                        ) {
                            stack.swap(a, b);
                        }
                    }
                    "+insert" | "-insert" => {
                        let n = super::js_number(spec, 0.);
                        if !n.is_nan() {
                            let at = (if n < 0. { len as f64 + n } else { n })
                                .clamp(0., (len - 1) as f64)
                                as usize;
                            stack[at..].rotate_right(1);
                        }
                    }
                    "+delete" | "-delete" => {
                        let mut remove = vec![false; len];
                        for i in indices(spec, len, limit, false)? {
                            remove[i] = true;
                        }
                        for ((scene, start), drop) in
                            std::mem::take(&mut stack).into_iter().zip(remove)
                        {
                            if !drop {
                                stack.push((scene, start));
                                continue;
                            }
                            retained = retained.saturating_sub(size_of::<(Rc<Scene>, usize)>());
                            if Rc::strong_count(&scene) == 1 {
                                retained = retained.saturating_sub(
                                    scene.image.pixels.len() * 4 + size_of::<Scene>(),
                                );
                            }
                            // A later deletion cannot discard an earlier operator's error.
                            if start < *at {
                                let mut scene = Rc::unwrap_or_clone(scene);
                                transform(&mut scene.image, start..*at, scene.timing.is_some())?;
                            }
                        }
                    }
                    _ if *count > 0 => {
                        let selected = indices(spec, len, limit, false)?;
                        if !selected.is_empty() {
                            retained = retained.saturating_add(
                                selected
                                    .len()
                                    .saturating_mul(*count)
                                    .saturating_mul(size_of::<(Rc<Scene>, usize)>()),
                            );
                            if retained > limit {
                                return Err("image exceeds memory budget".into());
                            }
                            for _ in 0..*count {
                                for &i in &selected {
                                    stack.push(stack[i].clone());
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Step::Edit(..) => {}
            Step::Append(vertical, gravity, bg) if stack.len() > 1 => {
                let (mut w, mut h) = (0usize, 0usize);
                retained = 0;
                for (scene, start) in &mut stack {
                    let scene = Rc::make_mut(scene);
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
                for (scene, _) in stack.drain(..) {
                    let im = &scene.image;
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
                    Rc::new(Scene {
                        image: out,
                        format: "png",
                        png_alpha: false,
                        timing: None,
                    }),
                    *at,
                ));
            }
            Step::Append(..) => {}
        }
    }
    retained = 0;
    let mut frames = Vec::with_capacity(stack.len());
    for (scene, start) in stack {
        let mut scene = Rc::unwrap_or_clone(scene);
        let im = &mut scene.image;
        let (keep, alpha) = transform(im, start..end, scene.timing.is_some())?;
        scene.png_alpha = alpha;
        if !keep {
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
