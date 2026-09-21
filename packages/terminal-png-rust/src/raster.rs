//! Independent antialiased SVG/TrueType rasterization for terminal captures.
use crate::{
    font::{Font, Outline, Point},
    xml::{self, Element, Node},
};
use std::{collections::HashMap, sync::OnceLock};
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}
#[derive(Clone, Copy)]
struct Matrix {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
    f: f64,
}
impl Matrix {
    fn identity() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 0.0,
            f: 0.0,
        }
    }
    fn point(self, x: f64, y: f64) -> (f64, f64) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }
    fn then(self, n: Self) -> Self {
        Self {
            a: self.a * n.a + self.c * n.b,
            b: self.b * n.a + self.d * n.b,
            c: self.a * n.c + self.c * n.d,
            d: self.b * n.c + self.d * n.d,
            e: self.a * n.e + self.c * n.f + self.e,
            f: self.b * n.e + self.d * n.f + self.f,
        }
    }
}
#[derive(Clone)]
struct Paint {
    fill: Option<[u8; 4]>,
    opacity: f64,
    font_size: f64,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    visible: bool,
    even_odd: bool,
    matrix: Matrix,
}
impl Default for Paint {
    fn default() -> Self {
        Self {
            fill: Some([0, 0, 0, 255]),
            opacity: 1.0,
            font_size: 16.0,
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            visible: true,
            even_odd: false,
            matrix: Matrix {
                a: 4.0,
                d: 4.0,
                ..Matrix::identity()
            },
        }
    }
}
fn number(value: &str) -> Option<f64> {
    value
        .trim()
        .strip_suffix("px")
        .unwrap_or(value.trim())
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}
fn attribute(e: &Element, key: &str, default: f64) -> f64 {
    e.attribute(key).and_then(number).unwrap_or(default)
}
fn numbers(value: &str) -> Result<Vec<f64>, &'static str> {
    let mut values = vec![];
    let mut start = 0;
    let mut in_number = false;
    let bytes = value.as_bytes();
    for (i, b) in bytes.iter().copied().enumerate() {
        if b.is_ascii_whitespace() || b == b',' {
            if in_number {
                values.push(number(&value[start..i]).ok_or("invalid SVG number list")?);
                in_number = false;
            }
            continue;
        }
        if (b == b'-' || b == b'+')
            && in_number
            && i > 0
            && bytes[i - 1] != b'e'
            && bytes[i - 1] != b'E'
        {
            values.push(number(&value[start..i]).ok_or("invalid SVG number list")?);
            start = i;
        } else if !in_number {
            start = i;
            in_number = true;
        }
    }
    if in_number {
        values.push(number(&value[start..]).ok_or("invalid SVG number list")?);
    }
    Ok(values)
}
fn color(value: &str) -> Option<[u8; 4]> {
    let value = value.trim();
    if value == "none" {
        return None;
    }
    if let Some(hex) = value.strip_prefix('#') {
        let n = u32::from_str_radix(hex, 16).ok()?;
        return match hex.len() {
            3 => Some([
                ((n >> 8) & 15) as u8 * 17,
                ((n >> 4) & 15) as u8 * 17,
                (n & 15) as u8 * 17,
                255,
            ]),
            6 => Some([(n >> 16) as u8, (n >> 8) as u8, n as u8, 255]),
            8 => Some([(n >> 24) as u8, (n >> 16) as u8, (n >> 8) as u8, n as u8]),
            _ => None,
        };
    }
    if let Some(raw) = value.strip_prefix("rgb(").and_then(|v| v.strip_suffix(')')) {
        let values = raw
            .split(',')
            .map(|n| number(n).map(|v| v.clamp(0.0, 255.0).round() as u8))
            .collect::<Option<Vec<_>>>()?;
        if values.len() == 3 {
            return Some([values[0], values[1], values[2], 255]);
        }
        return None;
    }
    match value {
        "black" => Some([0, 0, 0, 255]),
        "white" => Some([255, 255, 255, 255]),
        "red" => Some([255, 0, 0, 255]),
        "green" => Some([0, 128, 0, 255]),
        "blue" => Some([0, 0, 255, 255]),
        "transparent" => Some([0, 0, 0, 0]),
        _ => None,
    }
}
fn transform(value: &str) -> Result<Matrix, &'static str> {
    let mut rest = value.trim();
    let mut matrix = Matrix::identity();
    while !rest.is_empty() {
        let open = rest.find('(').ok_or("invalid SVG transform")?;
        let close = rest.find(')').ok_or("invalid SVG transform")?;
        let name = rest[..open].trim();
        let v = numbers(&rest[open + 1..close])?;
        let n = match (name, v.as_slice()) {
            ("matrix", [a, b, c, d, e, f]) => Matrix {
                a: *a,
                b: *b,
                c: *c,
                d: *d,
                e: *e,
                f: *f,
            },
            ("translate", [x]) => Matrix {
                e: *x,
                ..Matrix::identity()
            },
            ("translate", [x, y]) => Matrix {
                e: *x,
                f: *y,
                ..Matrix::identity()
            },
            ("scale", [x]) => Matrix {
                a: *x,
                d: *x,
                ..Matrix::identity()
            },
            ("scale", [x, y]) => Matrix {
                a: *x,
                d: *y,
                ..Matrix::identity()
            },
            ("rotate", [angle]) => {
                let r = angle.to_radians();
                Matrix {
                    a: r.cos(),
                    b: r.sin(),
                    c: -r.sin(),
                    d: r.cos(),
                    e: 0.0,
                    f: 0.0,
                }
            }
            ("rotate", [angle, x, y]) => {
                let r = angle.to_radians();
                Matrix {
                    e: *x,
                    f: *y,
                    ..Matrix::identity()
                }
                .then(Matrix {
                    a: r.cos(),
                    b: r.sin(),
                    c: -r.sin(),
                    d: r.cos(),
                    e: 0.0,
                    f: 0.0,
                })
                .then(Matrix {
                    e: -x,
                    f: -y,
                    ..Matrix::identity()
                })
            }
            ("skewX", [angle]) => Matrix {
                c: angle.to_radians().tan(),
                ..Matrix::identity()
            },
            ("skewY", [angle]) => Matrix {
                b: angle.to_radians().tan(),
                ..Matrix::identity()
            },
            _ => return Err("unsupported SVG transform"),
        };
        matrix = matrix.then(n);
        rest = rest[close + 1..].trim_start_matches(|c: char| c.is_ascii_whitespace() || c == ',');
    }
    Ok(matrix)
}
impl Paint {
    fn apply(&self, e: &Element) -> Result<Self, &'static str> {
        let mut out = self.clone();
        let mut attrs = e
            .attributes
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect::<Vec<_>>();
        if let Some(style) = e.attribute("style") {
            for pair in style.split(';') {
                if let Some((key, value)) = pair.split_once(':') {
                    attrs.push((key.trim(), value.trim()));
                }
            }
        }
        let mut fill_opacity = None;
        for (key, value) in attrs {
            match key {
                "fill" => out.fill = color(value),
                "opacity" => out.opacity *= number(value).unwrap_or(1.0).clamp(0.0, 1.0),
                "fill-opacity" => fill_opacity = number(value),
                "font-size" => out.font_size = number(value).unwrap_or(out.font_size),
                "font-weight" => {
                    out.bold = value == "bold" || number(value).is_some_and(|v| v >= 600.0)
                }
                "font-style" => out.italic = value == "italic" || value == "oblique",
                "text-decoration" => {
                    out.underline = value.split_whitespace().any(|v| v == "underline");
                    out.strike = value.split_whitespace().any(|v| v == "line-through");
                }
                "display" if value == "none" => out.visible = false,
                "visibility" => out.visible = value != "hidden" && value != "collapse",
                "fill-rule" => out.even_odd = value == "evenodd",
                "transform" => out.matrix = out.matrix.then(transform(value)?),
                "clip-path" | "mask" | "filter" => {
                    return Err("SVG clipping, masks and filters are not implemented");
                }
                _ => {}
            }
        }
        if let Some(opacity) = fill_opacity {
            out.opacity *= opacity.clamp(0.0, 1.0);
        }
        Ok(out)
    }
}
type Edge = ((f64, f64), (f64, f64));
fn edge(edges: &mut Vec<Edge>, a: (f64, f64), b: (f64, f64)) {
    if a != b {
        edges.push((a, b));
    }
}
fn quadratic(edges: &mut Vec<Edge>, a: (f64, f64), b: (f64, f64), c: (f64, f64), depth: usize) {
    let dx = a.0 - 2.0 * b.0 + c.0;
    let dy = a.1 - 2.0 * b.1 + c.1;
    if depth >= 10 || dx * dx + dy * dy < 0.02 {
        edge(edges, a, c);
        return;
    }
    let ab = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
    let bc = ((b.0 + c.0) / 2.0, (b.1 + c.1) / 2.0);
    let mid = ((ab.0 + bc.0) / 2.0, (ab.1 + bc.1) / 2.0);
    quadratic(edges, a, ab, mid, depth + 1);
    quadratic(edges, mid, bc, c, depth + 1);
}
fn glyph_edges(outline: &Outline, matrix: Matrix) -> Vec<Edge> {
    let mut edges = vec![];
    for contour in outline {
        if contour.is_empty() {
            continue;
        }
        let mut points = vec![];
        for (i, p) in contour.iter().enumerate() {
            points.push(*p);
            let next = contour[(i + 1) % contour.len()];
            if !p.on && !next.on {
                points.push(Point {
                    x: (p.x + next.x) / 2.0,
                    y: (p.y + next.y) / 2.0,
                    on: true,
                });
            }
        }
        let start = points.iter().position(|p| p.on).unwrap();
        points.rotate_left(start);
        let n = points.len();
        let mut current = matrix.point(points[0].x, points[0].y);
        let mut i = 1;
        while i <= n {
            let p = points[i % n];
            let next = matrix.point(p.x, p.y);
            if p.on {
                edge(&mut edges, current, next);
                current = next;
                i += 1;
            } else {
                let end = points[(i + 1) % n];
                let end = matrix.point(end.x, end.y);
                quadratic(&mut edges, current, next, end, 0);
                current = end;
                i += 2;
            }
        }
    }
    edges
}
fn fonts() -> Result<&'static [Font<'static>; 4], &'static str> {
    static FONTS: OnceLock<Result<[Font<'static>; 4], &'static str>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            Ok([
                Font::new(include_bytes!("../assets/jetbrains-mono-400-normal.ttf"))?,
                Font::new(include_bytes!("../assets/jetbrains-mono-700-normal.ttf"))?,
                Font::new(include_bytes!("../assets/jetbrains-mono-400-italic.ttf"))?,
                Font::new(include_bytes!("../assets/jetbrains-mono-700-italic.ttf"))?,
            ])
        })
        .as_ref()
        .map_err(|v| *v)
}
struct Canvas {
    image: Image,
    glyphs: HashMap<(usize, u16), Outline>,
    characters: usize,
}
impl Canvas {
    fn blend(&mut self, x: usize, y: usize, color: [u8; 4], coverage: f64, opacity: f64) {
        let alpha = coverage * opacity * f64::from(color[3]) / 255.0;
        if alpha <= 0.0 {
            return;
        }
        let at = (y * self.image.width as usize + x) * 4;
        let target = &mut self.image.rgba[at..at + 4];
        if alpha >= 1.0 {
            target.copy_from_slice(&color);
            return;
        }
        let dest = f64::from(target[3]) / 255.0;
        let combined = alpha + dest * (1.0 - alpha);
        for i in 0..3 {
            target[i] = ((f64::from(color[i]) * alpha
                + f64::from(target[i]) * dest * (1.0 - alpha))
                / combined)
                .round()
                .clamp(0.0, 255.0) as u8;
        }
        target[3] = (combined * 255.0).round().clamp(0.0, 255.0) as u8;
    }
    fn fill(&mut self, edges: &[Edge], paint: &Paint) -> Result<(), &'static str> {
        let Some(color) = paint.fill else {
            return Ok(());
        };
        if edges.is_empty() || !paint.visible {
            return Ok(());
        }
        if edges.len() > 200000
            || edges.iter().any(|(a, b)| {
                !a.0.is_finite() || !a.1.is_finite() || !b.0.is_finite() || !b.1.is_finite()
            })
        {
            return Err("shape exceeds raster complexity budget");
        }
        let height = self.image.height as usize;
        let width = self.image.width as usize;
        let min_y = edges
            .iter()
            .flat_map(|v| [v.0.1, v.1.1])
            .fold(f64::INFINITY, f64::min)
            .floor()
            .max(0.0) as usize;
        let max_y = edges
            .iter()
            .flat_map(|v| [v.0.1, v.1.1])
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil()
            .max(0.0)
            .min(height as f64) as usize;
        let min_x = edges
            .iter()
            .flat_map(|v| [v.0.0, v.1.0])
            .fold(f64::INFINITY, f64::min)
            .floor()
            .clamp(0.0, width as f64) as usize;
        let max_x = edges
            .iter()
            .flat_map(|v| [v.0.0, v.1.0])
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil()
            .clamp(0.0, width as f64) as usize;
        if min_x >= max_x {
            return Ok(());
        }
        let mut intersections = Vec::with_capacity(edges.len());
        let mut coverage = vec![0.0; max_x - min_x];
        for y in min_y.min(height)..max_y {
            coverage.fill(0.0);
            for sub in 0..8 {
                let scan = y as f64 + (sub as f64 + 0.5) / 8.0;
                intersections.clear();
                for (a, b) in edges {
                    if a.1 == b.1 || scan < a.1.min(b.1) || scan >= a.1.max(b.1) {
                        continue;
                    }
                    let x = a.0 + (scan - a.1) * (b.0 - a.0) / (b.1 - a.1);
                    intersections.push((x, if b.1 > a.1 { 1 } else { -1 }));
                }
                intersections.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
                let mut winding = 0;
                let mut from: f64 = 0.0;
                for &(x, direction) in &intersections {
                    let inside = if paint.even_odd {
                        winding % 2 != 0
                    } else {
                        winding != 0
                    };
                    if inside {
                        let left = from.clamp(min_x as f64, max_x as f64);
                        let right = x.clamp(min_x as f64, max_x as f64);
                        if right > left {
                            for (at, cov) in coverage
                                .iter_mut()
                                .enumerate()
                                .take(right.ceil() as usize - min_x)
                                .skip(left.floor() as usize - min_x)
                            {
                                let x = (at + min_x) as f64;
                                *cov += (right.min(x + 1.0) - left.max(x)).max(0.0) / 8.0;
                            }
                        }
                    }
                    winding += direction;
                    from = x;
                }
            }
            for (x, cov) in coverage.iter().copied().enumerate() {
                if cov > 0.0 {
                    self.blend(x + min_x, y, color, cov.min(1.0), paint.opacity);
                }
            }
        }
        Ok(())
    }
    fn polygon(&mut self, points: &[(f64, f64)], paint: &Paint) -> Result<(), &'static str> {
        if points.len() < 3 {
            return Ok(());
        }
        let mut edges = vec![];
        for i in 0..points.len() {
            edge(
                &mut edges,
                paint.matrix.point(points[i].0, points[i].1),
                paint.matrix.point(
                    points[(i + 1) % points.len()].0,
                    points[(i + 1) % points.len()].1,
                ),
            );
        }
        self.fill(&edges, paint)
    }
    fn rect(
        &mut self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        paint: &Paint,
    ) -> Result<(), &'static str> {
        if width <= 0.0 || height <= 0.0 {
            return Ok(());
        }
        self.polygon(
            &[
                (x, y),
                (x + width, y),
                (x + width, y + height),
                (x, y + height),
            ],
            paint,
        )
    }
    fn ellipse(
        &mut self,
        x: f64,
        y: f64,
        rx: f64,
        ry: f64,
        paint: &Paint,
    ) -> Result<(), &'static str> {
        if rx <= 0.0 || ry <= 0.0 {
            return Ok(());
        }
        let points = (0..128)
            .map(|i| {
                let t = i as f64 * std::f64::consts::TAU / 128.0;
                (x + rx * t.cos(), y + ry * t.sin())
            })
            .collect::<Vec<_>>();
        self.polygon(&points, paint)
    }
    fn text(
        &mut self,
        e: &Element,
        parent: &Paint,
        cursor: &mut (f64, f64),
    ) -> Result<(), &'static str> {
        let paint = parent.apply(e)?;
        let x = e
            .attribute("x")
            .map(numbers)
            .transpose()?
            .unwrap_or_default();
        let y = e
            .attribute("y")
            .map(numbers)
            .transpose()?
            .unwrap_or_default();
        if let Some(x) = x.first() {
            cursor.0 = *x;
        }
        if let Some(y) = y.first() {
            cursor.1 = *y;
        }
        cursor.0 += attribute(e, "dx", 0.0);
        cursor.1 += attribute(e, "dy", 0.0);
        let mut index = 0;
        for child in &e.children {
            match child {
                Node::Element(span) => self.text(span, &paint, cursor)?,
                Node::Text(text) => {
                    for ch in text.chars() {
                        self.characters += 1;
                        if self.characters > 100000 {
                            return Err("SVG text exceeds glyph budget");
                        }
                        if let Some(x) = x.get(index) {
                            cursor.0 = *x;
                        }
                        if let Some(y) = y.get(index) {
                            cursor.1 = *y;
                        }
                        let face = usize::from(paint.bold) + if paint.italic { 2 } else { 0 };
                        let font = &fonts()?[face];
                        let glyph = font.glyph_index(ch as u32);
                        let scale = paint.font_size / f64::from(font.units_per_em());
                        let outline = match self.glyphs.entry((face, glyph)) {
                            std::collections::hash_map::Entry::Occupied(v) => v.into_mut(),
                            std::collections::hash_map::Entry::Vacant(v) => {
                                v.insert(font.outline(glyph)?)
                            }
                        };
                        let matrix = paint.matrix.then(Matrix {
                            a: scale,
                            d: -scale,
                            e: cursor.0,
                            f: cursor.1,
                            ..Matrix::identity()
                        });
                        let edges = glyph_edges(outline, matrix);
                        self.fill(&edges, &paint)?;
                        let advance = f64::from(font.advance(glyph)?) * scale;
                        if paint.underline {
                            self.rect(
                                cursor.0,
                                cursor.1 + paint.font_size * 0.1,
                                advance,
                                paint.font_size * 0.06,
                                &paint,
                            )?;
                        }
                        if paint.strike {
                            self.rect(
                                cursor.0,
                                cursor.1 - paint.font_size * 0.3,
                                advance,
                                paint.font_size * 0.06,
                                &paint,
                            )?;
                        }
                        cursor.0 += advance;
                        index += 1;
                    }
                }
            }
        }
        Ok(())
    }
    fn element(&mut self, e: &Element, parent: &Paint) -> Result<(), &'static str> {
        let name = e.name.rsplit(':').next().unwrap_or(&e.name);
        if matches!(name, "defs" | "style" | "title" | "desc" | "metadata") {
            return Ok(());
        }
        if name == "text" || name == "tspan" {
            return self.text(e, parent, &mut (0.0, 0.0));
        }
        let paint = parent.apply(e)?;
        if !paint.visible {
            return Ok(());
        }
        match name {
            "svg" | "g" => {
                for node in &e.children {
                    if let Node::Element(child) = node {
                        self.element(child, &paint)?;
                    }
                }
            }
            "rect" => self.rect(
                attribute(e, "x", 0.0),
                attribute(e, "y", 0.0),
                attribute(e, "width", 0.0),
                attribute(e, "height", 0.0),
                &paint,
            )?,
            "circle" => {
                let r = attribute(e, "r", 0.0);
                self.ellipse(
                    attribute(e, "cx", 0.0),
                    attribute(e, "cy", 0.0),
                    r,
                    r,
                    &paint,
                )?;
            }
            "ellipse" => self.ellipse(
                attribute(e, "cx", 0.0),
                attribute(e, "cy", 0.0),
                attribute(e, "rx", 0.0),
                attribute(e, "ry", 0.0),
                &paint,
            )?,
            "polygon" => {
                let v = numbers(e.attribute("points").unwrap_or(""))?;
                if v.len() % 2 != 0 {
                    return Err("invalid SVG polygon");
                }
                let p = v
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|v| (v[0], v[1]))
                    .collect::<Vec<_>>();
                self.polygon(&p, &paint)?;
            }
            _ => return Err("unsupported SVG drawing element"),
        }
        Ok(())
    }
}
pub fn render(svg: &str) -> Result<Image, &'static str> {
    let root = xml::parse(svg)?;
    if root.name.rsplit(':').next() != Some("svg") {
        return Err("expected SVG root");
    }
    let width = root
        .attribute("width")
        .and_then(number)
        .ok_or("SVG width missing or invalid")?;
    let height = root
        .attribute("height")
        .and_then(number)
        .ok_or("SVG height missing or invalid")?;
    let viewport_width = width * 4.0;
    let viewport_height = height * 4.0;
    let width = viewport_width.round();
    let height = viewport_height.round();
    if width <= 0.0
        || height <= 0.0
        || width > 65535.0
        || height > 65535.0
        || width * height > 32.0 * 1024.0 * 1024.0
    {
        return Err("SVG dimensions exceed pixel budget");
    }
    let image = Image {
        width: width as u32,
        height: height as u32,
        rgba: vec![0; width as usize * height as usize * 4],
    };
    let mut canvas = Canvas {
        image,
        glyphs: HashMap::new(),
        characters: 0,
    };
    let mut paint = Paint::default();
    if let Some(view) = root.attribute("viewBox") {
        let v = numbers(view)?;
        if v.len() != 4 || v[2] <= 0.0 || v[3] <= 0.0 {
            return Err("invalid SVG viewBox");
        }
        let sx = viewport_width / v[2];
        let sy = viewport_height / v[3];
        let scale = sx.min(sy);
        paint.matrix = Matrix {
            a: scale,
            d: scale,
            e: (viewport_width - v[2] * scale) / 2.0 - v[0] * scale,
            f: (viewport_height - v[3] * scale) / 2.0 - v[1] * scale,
            ..Matrix::identity()
        };
    }
    canvas.element(&root, &paint)?;
    Ok(canvas.image)
}
