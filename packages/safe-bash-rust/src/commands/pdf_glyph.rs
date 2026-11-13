// Standard font contours generated from pdf-ast's pinned PDFium/Foxit fonts.
// Redistribution terms: pdf_fonts/LICENSE.
use super::Point;
use std::collections::BTreeMap;

// Curve subdivision adapted from Anti-Grain Geometry 2.3.
// Copyright (C) 2002-2005 Maxim Shemanarev (http://www.antigrain.com)
// Permission to copy, use, modify, sell and distribute this software
// is granted provided this copyright notice appears in all copies.
// This software is provided "as is" without express or implied
// warranty, and with no claim as to its suitability for any purpose.
pub(super) fn cubic(
    path: &mut Vec<Point>,
    a: Point,
    b: Point,
    c: Point,
    d: Point,
    work: &mut usize,
) -> Option<()> {
    fn mid(a: Point, b: Point) -> Point {
        [(a[0] + b[0]) / 2., (a[1] + b[1]) / 2.]
    }
    let mut stack = vec![([a, b, c, d], 0)];
    while let Some(([a, b, c, d], depth)) = stack.pop() {
        *work = work.checked_sub(1)?;
        if depth > 16 {
            continue;
        }
        let ab = mid(a, b);
        let bc = mid(b, c);
        let cd = mid(c, d);
        let abc = mid(ab, bc);
        let bcd = mid(bc, cd);
        let m = mid(abc, bcd);
        let (dx, dy) = (d[0] - a[0], d[1] - a[1]);
        let dist = |p: Point| ((p[0] - d[0]) * dy - (p[1] - d[1]) * dx).abs();
        let d2 = dist(b);
        let d3 = dist(c);
        if d2 <= 1e-30 && d3 <= 1e-30 {
            if (0..2)
                .map(|i| (a[i] + c[i] - 2. * b[i]).abs() + (b[i] + d[i] - 2. * c[i]).abs())
                .sum::<f64>()
                <= 4.
            {
                path.push(m);
                continue;
            }
        } else if (d2 + d3).powi(2) <= 0.25 * (dx * dx + dy * dy) {
            path.push(bc);
            continue;
        }
        stack.push(([m, bcd, cd, d], depth + 1));
        stack.push(([a, ab, abc, m], depth + 1));
    }
    path.push(d);
    Some(())
}

pub(super) fn outline(
    faces: &mut BTreeMap<&'static str, Vec<u8>>,
    name: &str,
    program: &super::super::pdf_text_layout::Program,
    code: u16,
    work: &mut usize,
    transform: impl Fn(f64, f64) -> Point,
) -> Option<Vec<Vec<Point>>> {
    match program {
        super::super::pdf_text_layout::Program::TrueType(bytes) => {
            return truetype(bytes, code, false, work, transform);
        }
        super::super::pdf_text_layout::Program::CidTrueType { bytes, map } => {
            let glyph = match map {
                None => code,
                Some(map) => {
                    let offset = usize::from(code) * 2;
                    // Unlisted CIDs select the font's .notdef glyph (PDF §9.7.4.2).
                    map.get(offset..offset + 2)
                        .map(|b| u16::from_be_bytes([b[0], b[1]]))
                        .unwrap_or(0)
                }
            };
            return truetype(bytes, glyph, true, work, transform);
        }
        super::super::pdf_text_layout::Program::Unsupported => return None,
        super::super::pdf_text_layout::Program::Standard => {}
    }
    macro_rules! faces { ($($name:literal),+) => { match name {
        $( $name => ($name,&include_bytes!(concat!("pdf_fonts/",$name,".deflate"))[..]), )+
        _ => return None,
    } }; }
    let (name, data) = faces!(
        "Helvetica",
        "Helvetica-Bold",
        "Helvetica-Oblique",
        "Helvetica-BoldOblique",
        "Times-Roman",
        "Times-Bold",
        "Times-Italic",
        "Times-BoldItalic",
        "Courier",
        "Courier-Bold",
        "Courier-Oblique",
        "Courier-BoldOblique",
        "Symbol",
        "ZapfDingbats"
    );
    let bytes = match faces.entry(name) {
        std::collections::btree_map::Entry::Occupied(o) => o.into_mut(),
        std::collections::btree_map::Entry::Vacant(v) => v.insert(
            crate::commands::codecs::inflate_raw_bounded(data, 2 << 20)
                .ok()?
                .0,
        ),
    };
    let i = usize::from(u8::try_from(code).ok()?) * 4;
    let offset =
        |i: usize| Some(u32::from_le_bytes(bytes.get(i..i + 4)?.try_into().ok()?) as usize);
    let mut input = bytes.get(offset(i)?..offset(i + 4)?)?;
    let mut paths: Vec<Vec<Point>> = vec![];
    while let Some((&op, rest)) = input.split_first() {
        input = rest;
        let mut point = || {
            let (v, r) = input.split_at_checked(8)?;
            input = r;
            Some(transform(
                f32::from_le_bytes(v[..4].try_into().ok()?) as f64,
                f32::from_le_bytes(v[4..].try_into().ok()?) as f64,
            ))
        };
        match op {
            0 => paths.push(vec![point()?]),
            1 => paths.last_mut()?.push(point()?),
            2 => {
                let path = paths.last_mut()?;
                cubic(path, *path.last()?, point()?, point()?, point()?, work)?;
            }
            3 => {}
            _ => return None,
        }
    }
    Some(paths)
}

// PDF WinAnsi maps character codes through Unicode into the font's cmap.
fn truetype(
    bytes: &[u8],
    code: u16,
    direct: bool,
    work: &mut usize,
    transform: impl Fn(f64, f64) -> Point,
) -> Option<Vec<Vec<Point>>> {
    use terminal_png_rust::font::{Font, Point as FontPoint};
    const WIN_ANSI: [u32; 32] = [
        0x20ac, 0x2022, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160,
        0x2039, 0x152, 0x2022, 0x17d, 0x2022, 0x2022, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
        0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x2022, 0x17e, 0x178,
    ];
    // Charge parsing as well as curve subdivision against the page work budget.
    *work =
        work.checked_sub(usize::from(u16::from_be_bytes(bytes.get(4..6)?.try_into().ok()?)) * 8)?;
    let font = if direct {
        Font::from_glyphs(bytes)
    } else {
        Font::new(bytes)
    }
    .ok()?;
    let cp = match code {
        0x7f => 0x2022,
        0x80..=0x9f => WIN_ANSI[usize::from(code - 0x80)],
        0xa0 => 32,
        0xad => 45,
        _ => u32::from(code),
    };
    let contours = font
        .outline(if direct { code } else { font.glyph_index(cp) })
        .ok()?;
    let scale = f64::from(font.units_per_em());
    let point = |p: FontPoint| transform(p.x / scale, p.y / scale);
    let mut paths = Vec::new();
    for contour in contours {
        if contour.is_empty() {
            continue;
        }
        *work = work.checked_sub(contour.len())?;
        let mut points = Vec::new();
        for (i, p) in contour.iter().enumerate() {
            points.push(*p);
            let next = contour[(i + 1) % contour.len()];
            if !p.on && !next.on {
                points.push(FontPoint {
                    x: (p.x + next.x) / 2.,
                    y: (p.y + next.y) / 2.,
                    on: true,
                });
            }
        }
        let start = points.iter().position(|p| p.on)?;
        points.rotate_left(start);
        let n = points.len();
        let mut path = vec![point(points[0])];
        let mut i = 1;
        while i <= n {
            let p = points[i % n];
            let b = point(p);
            if p.on {
                path.push(b);
                i += 1;
            } else {
                let a = *path.last()?;
                let c = point(points[(i + 1) % n]);
                let control = |p: Point| {
                    [
                        p[0] + (b[0] - p[0]) * 2. / 3.,
                        p[1] + (b[1] - p[1]) * 2. / 3.,
                    ]
                };
                cubic(&mut path, a, control(a), control(c), c, work)?;
                i += 2;
            }
        }
        paths.push(path);
    }
    Some(paths)
}
