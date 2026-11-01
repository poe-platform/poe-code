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
    byte: u8,
    work: &mut usize,
    transform: impl Fn(f64, f64) -> Point,
) -> Option<Vec<Vec<Point>>> {
    macro_rules! faces { ($($name:literal),+) => { match name {
        $( $name => ($name,&include_bytes!(concat!("pdf_fonts/",$name,".deflate"))[..]), )+
        _ => return Some(vec![]),
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
    let i = usize::from(byte) * 4;
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
