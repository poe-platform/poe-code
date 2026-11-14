// Common annotation geometry without a supplied normal appearance stream.
use super::{BlendMode, Draw, ID, Objects, Value};
type Operator = (&'static [u8], Vec<Value<'static>>);
fn numbers<'a>(
    objects: &mut Objects<'a>,
    value: Option<&Value<'a>>,
    remaining: &mut usize,
) -> Option<Vec<f64>> {
    let Some(value) = value else {
        return Some(vec![]);
    };
    let value = objects.resolve(value)?;
    if value.word() == Some(b"null") {
        return Some(vec![]);
    }
    let Value::Array(values) = value else {
        return None;
    };
    *remaining = remaining.checked_sub(values.len())?;
    values
        .iter()
        .map(|v| {
            let n = objects.resolve(v)?.number()?;
            n.is_finite().then_some(n)
        })
        .collect()
}
fn op(ops: &mut Vec<Operator>, name: &'static [u8], values: &[f64]) {
    ops.push((
        name,
        values
            .iter()
            .map(|v| Value::Word(v.to_string().into_bytes().into()))
            .collect(),
    ));
}
fn color(ops: &mut Vec<Operator>, values: &[f64], stroke: bool) -> Option<bool> {
    let name: &[u8] = match (values.len(), stroke) {
        (0, _) => return Some(false),
        (1, false) => b"g",
        (1, true) => b"G",
        (3, false) => b"rg",
        (3, true) => b"RG",
        (4, false) => b"k",
        (4, true) => b"K",
        _ => return None,
    };
    op(ops, name, values);
    Some(true)
}
pub(super) fn draw<'a>(
    annot: &Value<'a>,
    objects: &mut Objects<'a>,
    emit: &mut impl FnMut(Draw<'_, '_>, &mut Objects<'a>) -> Option<()>,
) -> Option<()> {
    let Some(subtype) = annot.get(b"Subtype") else {
        return Some(());
    };
    let subtype = objects.resolve(subtype)?;
    let subtype = subtype.word()?;
    if !matches!(
        subtype,
        b"/Highlight"
            | b"/Underline"
            | b"/StrikeOut"
            | b"/Squiggly"
            | b"/Square"
            | b"/Circle"
            | b"/Ink"
    ) {
        return Some(());
    }
    let mut remaining = 65536;
    let rect = numbers(objects, annot.get(b"Rect"), &mut remaining)?;
    if rect.len() != 4 {
        return None;
    }
    let alpha = match annot.get(b"CA") {
        Some(v) => {
            let value = objects.resolve(v)?;
            if value.word() == Some(b"null") {
                1.
            } else {
                value.number()?
            }
        }
        None => 1.,
    };
    if !alpha.is_finite() {
        return None;
    }
    let alpha = alpha.clamp(0., 1.);
    let mut c = numbers(objects, annot.get(b"C"), &mut remaining)?;
    let highlight = subtype == b"/Highlight";
    if annot.get(b"C").is_none()
        || annot
            .get(b"C")
            .and_then(|v| objects.resolve(v))
            .as_ref()
            .and_then(Value::word)
            == Some(b"null")
    {
        c = if highlight {
            vec![1., 1., 0.]
        } else {
            vec![0.]
        };
    }
    let mut bounds = [
        rect[0].min(rect[2]),
        rect[1].min(rect[3]),
        rect[0].max(rect[2]),
        rect[1].max(rect[3]),
    ];
    let mut ops = Vec::new();
    if matches!(
        subtype,
        b"/Highlight" | b"/Underline" | b"/StrikeOut" | b"/Squiggly"
    ) {
        let quads = numbers(objects, annot.get(b"QuadPoints"), &mut remaining)?;
        if quads.len() % 8 != 0 {
            return None;
        }
        if quads.is_empty() {
            return Some(());
        }
        bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for p in quads.chunks_exact(2) {
            bounds[0] = bounds[0].min(p[0]);
            bounds[1] = bounds[1].min(p[1]);
            bounds[2] = bounds[2].max(p[0]);
            bounds[3] = bounds[3].max(p[1]);
        }
        color(&mut ops, &c, !highlight)?;
        op(&mut ops, b"w", &[1.]);
        for q in quads.chunks_exact(8) {
            let left = [q[0], q[2], q[4], q[6]]
                .into_iter()
                .fold(f64::INFINITY, f64::min);
            let right = [q[0], q[2], q[4], q[6]]
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max);
            let bottom = [q[1], q[3], q[5], q[7]]
                .into_iter()
                .fold(f64::INFINITY, f64::min);
            let top = [q[1], q[3], q[5], q[7]]
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max);
            if highlight {
                op(&mut ops, b"m", &q[..2]);
                op(&mut ops, b"l", &q[2..4]);
                op(&mut ops, b"l", &q[6..8]);
                op(&mut ops, b"l", &q[4..6]);
                op(&mut ops, b"h", &[]);
                op(&mut ops, b"f", &[]);
            } else if subtype == b"/Squiggly" {
                let count = ((right - left) / 2.).ceil();
                if !count.is_finite() || count > remaining as f64 {
                    return None;
                }
                let count = count as usize;
                remaining -= count;
                op(&mut ops, b"m", &[left, bottom + 2.]);
                for n in 1..=count {
                    let x = right.min(left + n as f64 * 2.);
                    let fraction = (x - left - (n - 1) as f64 * 2.) / 2.;
                    let y = bottom
                        + if n % 2 == 1 {
                            2. - 2. * fraction
                        } else {
                            2. * fraction
                        };
                    op(&mut ops, b"l", &[x, y]);
                }
                op(&mut ops, b"S", &[]);
            } else {
                let y = if subtype == b"/Underline" {
                    bottom + 1.
                } else {
                    (bottom + top) / 2.
                };
                op(&mut ops, b"m", &[left, y]);
                op(&mut ops, b"l", &[right, y]);
                op(&mut ops, b"S", &[]);
            }
        }
    } else {
        let bs = match annot.get(b"BS") {
            Some(v) => {
                let value = objects.resolve(v)?;
                if value.word() == Some(b"null") {
                    None
                } else {
                    Some(value)
                }
            }
            None => None,
        };
        let border = match annot.get(b"Border") {
            Some(v) => {
                let value = objects.resolve(v)?;
                if value.word() == Some(b"null") {
                    vec![]
                } else {
                    let Value::Array(a) = value else {
                        return None;
                    };
                    if !(3..=4).contains(&a.len()) {
                        return None;
                    }
                    a
                }
            }
            None => vec![],
        };
        for v in border.iter().take(3) {
            if !objects.resolve(v)?.number()?.is_finite() {
                return None;
            }
        }
        let width = match bs.as_ref().and_then(|v| v.get(b"W")) {
            Some(v) => objects.resolve(v)?.number()?,
            None => match border.get(2) {
                Some(v) => objects.resolve(v)?.number()?,
                None => 1.,
            },
        };
        if !width.is_finite() {
            return None;
        }
        let width = width.max(0.);
        op(&mut ops, b"w", &[width]);
        let stroke = color(&mut ops, &c, true)? && width > 0.;
        let dashed = bs
            .as_ref()
            .and_then(|b| b.get(b"S"))
            .and_then(|v| objects.resolve(v))
            .as_ref()
            .and_then(Value::word)
            == Some(b"/D");
        if dashed || (bs.is_none() && border.len() == 4) {
            let raw = if let Some(bs) = &bs {
                bs.get(b"D")
            } else {
                border.get(3)
            };
            let dash = if raw.is_none() {
                vec![3.]
            } else {
                numbers(objects, raw, &mut remaining)?
            };
            if dash.iter().any(|&v| v < 0.) || (!dash.is_empty() && !dash.iter().any(|&v| v > 0.)) {
                return None;
            }
            let values = dash
                .iter()
                .map(|v| Value::Word(v.to_string().into_bytes().into()))
                .collect();
            ops.push((
                b"d",
                vec![Value::Array(values), Value::Word(b"0".as_slice().into())],
            ));
        }
        if subtype == b"/Ink" {
            for (i, v) in bounds.iter_mut().enumerate() {
                *v += if i < 2 { -width / 2. } else { width / 2. };
            }
            let Some(lists) = annot.get(b"InkList") else {
                return Some(());
            };
            let lists = objects.resolve(lists)?;
            if lists.word() == Some(b"null") {
                return Some(());
            }
            let Value::Array(lists) = lists else {
                return None;
            };
            if !stroke {
                return Some(());
            }
            for list in lists {
                remaining = remaining.checked_sub(1)?;
                let points = numbers(objects, Some(&list), &mut remaining)?;
                if points.len() % 2 != 0 {
                    return None;
                }
                if points.len() < 2 {
                    continue;
                }
                op(&mut ops, b"m", &points[..2]);
                for point in points.chunks_exact(2) {
                    op(&mut ops, b"l", point);
                }
                op(&mut ops, b"S", &[]);
            }
        } else {
            let fill = color(
                &mut ops,
                &numbers(objects, annot.get(b"IC"), &mut remaining)?,
                false,
            )?;
            if !fill && !stroke {
                return Some(());
            }
            let x = rect[0].min(rect[2]) + width / 2.;
            let y = rect[1].min(rect[3]) + width / 2.;
            let rw = (rect[2] - rect[0]).abs() - width;
            let rh = (rect[3] - rect[1]).abs() - width;
            if rw <= 0. || rh <= 0. {
                return Some(());
            }
            if subtype == b"/Square" {
                op(&mut ops, b"re", &[x, y, rw, rh]);
            } else {
                let (cx, cy, rx, ry, k) = (x + rw / 2., y + rh / 2., rw / 2., rh / 2., 0.5523);
                op(&mut ops, b"m", &[cx, y + rh]);
                op(
                    &mut ops,
                    b"c",
                    &[cx + k * rx, y + rh, x + rw, cy + k * ry, x + rw, cy],
                );
                op(
                    &mut ops,
                    b"c",
                    &[x + rw, cy - k * ry, cx + k * rx, y, cx, y],
                );
                op(&mut ops, b"c", &[cx - k * rx, y, x, cy - k * ry, x, cy]);
                op(
                    &mut ops,
                    b"c",
                    &[x, cy + k * ry, cx - k * rx, y + rh, cx, y + rh],
                );
            }
            let paint: &[u8] = if fill {
                if stroke { b"b" } else { b"f" }
            } else {
                b"s"
            };
            op(&mut ops, paint, &[]);
        }
    }
    emit(Draw::BeginForm(bounds, ID, None, None), objects)?;
    emit(
        Draw::Transparency {
            fill: Some(alpha),
            stroke: Some(alpha),
            blend: Some(if highlight {
                BlendMode::Multiply
            } else {
                BlendMode::Normal
            }),
        },
        objects,
    )?;
    for (name, values) in &ops {
        emit(Draw::Operator(name, values, ID), objects)?;
    }
    emit(Draw::EndForm, objects)
}
