// Stroke glyph contours in PDF user space, then transform the resulting geometry.
// Text matrices shape the glyph but do not scale the graphics-state line width.
use super::{Point, pdf_stroke::Stroke};


fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}
fn add(a: Point, b: Point) -> Point {
    [a[0] + b[0], a[1] + b[1]]
}
fn mul(p: Point, k: f64) -> Point {
    [p[0] * k, p[1] * k]
}
fn cross(a: Point, b: Point) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn unit(a: Point, b: Point) -> Option<Point> {
    let d = sub(b, a);
    let length = d[0].hypot(d[1]);
    (length > 0. && length.is_finite()).then(|| mul(d, 1. / length))
}

struct Outline<'a> {
    paths: Vec<Vec<Point>>,
    matrix: [f64; 4],
    work: &'a mut usize,
    vertices: usize,
}
impl Outline<'_> {
    fn polygon(&mut self, mut points: Vec<Point>) -> Option<()> {
        self.vertices = self.vertices.checked_add(points.len())?;
        if self.vertices > 1_000_000 {
            return None;
        }
        *self.work = self.work.checked_sub(points.len())?;
        // All stroke pieces must have the same winding, including inner contours.
        let area: f64 = points
            .iter()
            .zip(points.iter().cycle().skip(1))
            .map(|(&a, &b)| cross(a, b))
            .sum();
        if area < 0. {
            points.reverse();
        }
        let [a, b, c, d] = self.matrix;
        for p in &mut points {
            *p = [a * p[0] + c * p[1], b * p[0] + d * p[1]];
            if p.iter().any(|v| !v.is_finite() || v.abs() > 1e12) {
                return None;
            }
        }
        self.paths.push(points);
        Some(())
    }
    fn circle(&mut self, center: Point, radius: f64) -> Option<()> {
        let [a, b, c, d] = self.matrix;
        let pixels = radius * (a.hypot(b) + c.hypot(d));
        let count = (std::f64::consts::PI * pixels.sqrt()).ceil().max(16.) as usize;
        if count > 4096 || count > *self.work {
            return None;
        }
        self.polygon(
            (0..count)
                .map(|i| {
                    let angle = i as f64 * std::f64::consts::TAU / count as f64;
                    add(center, [radius * angle.cos(), radius * angle.sin()])
                })
                .collect(),
        )
    }
    fn run(&mut self, points: &[Point], closed: bool, stroke: &Stroke) -> Option<()> {
        let half = stroke.width / 2.;
        let n = points.len();
        if n < 2 {
            return Some(());
        }
        for i in 0..n - usize::from(!closed) {
            let a = points[i];
            let b = points[(i + 1) % n];
            let Some(t) = unit(a, b) else {
                continue;
            };
            let normal = [-t[1] * half, t[0] * half];
            self.polygon(vec![
                add(a, normal),
                add(b, normal),
                sub(b, normal),
                sub(a, normal),
            ])?;
        }
        for i in 0..n {
            let p = points[i];
            if !closed && (i == 0 || i + 1 == n) {
                if stroke.cap == 1 {
                    self.circle(p, half)?;
                }
                if stroke.cap == 2 {
                    let next = points[if i == 0 { 1 } else { n - 2 }];
                    if let Some(t) = unit(next, p) {
                        let normal = [-t[1] * half, t[0] * half];
                        let end = add(p, mul(t, half));
                        self.polygon(vec![
                            add(p, normal),
                            add(end, normal),
                            sub(end, normal),
                            sub(p, normal),
                        ])?;
                    }
                }
                continue;
            }
            let (Some(before), Some(after)) = (
                unit(points[(i + n - 1) % n], p),
                unit(p, points[(i + 1) % n]),
            ) else {
                continue;
            };
            let turn = cross(before, after);
            if turn.abs() < 1e-12 {
                continue;
            }
            if stroke.join == 1 {
                self.circle(p, half)?;
                continue;
            }
            let side = if turn > 0. { -half } else { half };
            let a = add(p, [-before[1] * side, before[0] * side]);
            let b = add(p, [-after[1] * side, after[0] * side]);
            let miter = add(a, mul(before, cross(sub(b, a), after) / turn));
            let delta = sub(miter, p);
            if stroke.join == 0 && delta[0].hypot(delta[1]) <= stroke.miter * half {
                self.polygon(vec![p, a, miter, b])?;
            } else {
                self.polygon(vec![p, a, b])?;
            }
        }
        Some(())
    }
}

pub(super) fn outline(
    paths: &[Vec<Point>],
    stroke: &Stroke,
    matrix: [f64; 4],
    work: &mut usize,
) -> Option<Vec<Vec<Point>>> {
    if !stroke.width.is_finite()
        || stroke.width < 0.
        || !stroke.miter.is_finite()
        || stroke.miter < 1.
        || !stroke.phase.is_finite()
        || stroke.dash.iter().any(|v| !v.is_finite() || *v < 0.)
    {
        return None;
    }
    let mut matrix = matrix;
    let det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
    if !det.is_finite() {
        return None;
    }
    if det == 0. {
        return Some(vec![]);
    }
    *work = work.checked_sub(stroke.dash.len())?;
    let mut style = stroke.clone();
    // Match the TypeScript renderer's device-pixel hairline correction.
    if style.width == 0. {
        let sx = matrix[2].hypot(matrix[3]) / det.abs();
        let sy = matrix[0].hypot(matrix[1]) / det.abs();
        style.width = 1.;
        if sx == sy {
            style.width = sx;
        } else {
            matrix[0] *= sx;
            matrix[1] *= sx;
            matrix[2] *= sy;
            matrix[3] *= sy;
            for dash in &mut style.dash {
                *dash /= sx.max(sy);
            }
            style.phase /= sx.max(sy);
        }
    }
    let [a, b, c, d] = matrix;
    let det = a * d - b * c;
    if !det.is_finite() || det == 0. {
        return None;
    }
    let inverse = |p: Point| [(d * p[0] - c * p[1]) / det, (a * p[1] - b * p[0]) / det];
    let mut output = Outline {
        paths: vec![],
        matrix,
        work,
        vertices: 0,
    };
    let dash_count = style.dash.len() * if style.dash.len() % 2 == 1 { 2 } else { 1 };
    let cycle = style.dash.iter().sum::<f64>() * if style.dash.len() % 2 == 1 { 2. } else { 1. };
    if !cycle.is_finite() {
        return None;
    }
    for path in paths {
        *output.work = output.work.checked_sub(path.len())?;
        let mut points = Vec::with_capacity(path.len());
        for &p in path {
            if p.iter().any(|v| !v.is_finite() || v.abs() > 1e12) {
                return None;
            }
            let p = inverse(p);
            if p.iter().any(|v| !v.is_finite() || v.abs() > 1e12) {
                return None;
            }
            if points.last() != Some(&p) {
                points.push(p);
            }
        }
        if points.first() == points.last() {
            points.pop();
        }
        if points.len() < 2 {
            continue;
        }
        if cycle == 0. {
            output.run(&points, true, &style)?;
            continue;
        }
        let mut index = 0;
        let mut phase = style.phase.rem_euclid(cycle);
        while phase > 0. {
            *output.work = output.work.checked_sub(1)?;
            let length = style.dash[index % style.dash.len()];
            if phase < length {
                break;
            }
            phase -= length;
            index = (index + 1) % dash_count;
        }
        let mut remaining = style.dash[index % style.dash.len()] - phase;
        let mut runs = vec![];
        let mut run = vec![];
        let mut steps = 0;
        for (&a, &b) in points.iter().zip(points.iter().cycle().skip(1)) {
            let delta = sub(b, a);
            let length = delta[0].hypot(delta[1]);
            if length / cycle * dash_count as f64 > 1_000_000. {
                return None;
            }
            let mut distance = 0.;
            while distance < length {
                *output.work = output.work.checked_sub(1)?;
                steps += 1;
                if steps > 1_000_000 {
                    return None;
                }
                let start = add(a, mul(delta, distance / length));
                if remaining <= 0. {
                    if index % 2 == 0 {
                        if !run.is_empty() {
                            runs.push(std::mem::take(&mut run));
                        }
                        if style.dash[index % style.dash.len()] == 0. && style.cap == 1 {
                            output.circle(start, style.width / 2.)?;
                        }
                    }
                    index = (index + 1) % dash_count;
                    remaining = style.dash[index % style.dash.len()];
                    continue;
                }
                let step = remaining.min(length - distance);
                if distance + step == distance {
                    return None;
                }
                distance += step;
                remaining -= step;
                if index % 2 == 0 {
                    if run.is_empty() {
                        run.push(start);
                    }
                    run.push(if distance == length {
                        b
                    } else {
                        add(a, mul(delta, distance / length))
                    });
                }
            }
        }
        if !run.is_empty() {
            runs.push(run);
        }
        // A dash crossing the contour seam is one joined run, not two caps.
        if runs.first().and_then(|r| r.first()) == points.first()
            && runs.last().and_then(|r| r.last()) == points.first()
        {
            if runs.len() == 1 {
                let mut run = runs.pop()?;
                run.pop();
                output.run(&run, true, &style)?;
            } else {
                let mut last = runs.pop()?;
                last.extend_from_slice(&runs[0][1..]);
                runs[0] = last;
            }
        }
        for run in runs {
            output.run(&run, false, &style)?;
        }
    }
    Some(output.paths)
}
