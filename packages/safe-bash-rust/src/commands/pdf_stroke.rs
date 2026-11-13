use super::{Point, Value};

#[derive(Clone)]
pub(super) struct Stroke {
    pub width: f64,
    pub cap: i32,
    pub join: i32,
    pub miter: f64,
    pub dash: Vec<f64>,
    pub phase: f64,
}
impl Default for Stroke {
    fn default() -> Self {
        Self {
            width: 1.,
            cap: 0,
            join: 0,
            miter: 10.,
            dash: vec![],
            phase: 0.,
        }
    }
}

impl Stroke {
    pub fn set_dash(&mut self, args: &[Value<'_>], work: &mut usize) -> Option<()> {
        let Some(Value::Array(array)) = args.first() else {
            return Some(());
        };
        *work = work.checked_sub(array.len())?;
        // Match the TypeScript evaluator's recovery: discard negative entries,
        // treat non-numbers as zero, and use solid strokes for an all-zero array.
        let mut values = Vec::new();
        for value in array {
            let value = value.poppler_number().unwrap_or(0.);
            if !value.is_finite() {
                return None;
            }
            if value >= 0. {
                values.push(value);
            }
        }
        let total: f64 = values.iter().sum();
        let phase = args.get(1).and_then(Value::poppler_number).unwrap_or(0.);
        if !total.is_finite() || !phase.is_finite() {
            return None;
        }
        if total == 0. {
            values.clear();
        }
        self.dash = values;
        self.phase = phase;
        Some(())
    }

    fn dashed(
        &self,
        paths: &[Vec<Point>],
        [xx, yx, xy, yy]: [f64; 4],
        work: &mut usize,
    ) -> Option<Vec<Vec<Point>>> {
        let det = xx * yy - xy * yx;
        let count = self.dash.len() * if self.dash.len() % 2 == 1 { 2 } else { 1 };
        let cycle = self.dash.iter().sum::<f64>() * if self.dash.len() % 2 == 1 { 2. } else { 1. };
        if !cycle.is_finite() || det == 0. {
            return None;
        }
        let value = |i: usize| self.dash[i % self.dash.len()];
        let mut index = 0;
        let mut phase = self.phase.rem_euclid(cycle);
        while phase > 0. {
            *work = work.checked_sub(1)?;
            if phase < value(index) {
                break;
            }
            phase -= value(index);
            index = (index + 1) % count;
        }
        let mut result = vec![];
        for path in paths {
            let first = result.len();
            let (mut index, mut remaining) = (index, value(index) - phase);
            let mut run = vec![];
            for segment in path.windows(2) {
                *work = work.checked_sub(1)?;
                let [a, b] = [segment[0], segment[1]];
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                // Undo the paint-time device matrix to measure PDF user-space distances.
                let length = ((yy * dx - xy * dy) / det).hypot((xx * dy - yx * dx) / det);
                if !length.is_finite() || length / cycle * count as f64 > *work as f64 {
                    return None;
                }
                let mut distance = 0.;
                let point = |d: f64| {
                    if d == length {
                        b
                    } else {
                        [a[0] + dx * d / length, a[1] + dy * d / length]
                    }
                };
                while length - distance > 8. * f64::EPSILON * length.max(1.) {
                    let start = point(distance);
                    while remaining <= 0. {
                        *work = work.checked_sub(2)?;
                        if index % 2 == 0 {
                            if value(index) == 0. {
                                result.push(vec![start, start]);
                            }
                            if !run.is_empty() {
                                result.push(std::mem::take(&mut run));
                            }
                        }
                        index = (index + 1) % count;
                        remaining = value(index);
                    }
                    *work = work.checked_sub(2)?;
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
                        run.push(point(distance));
                    }
                }
            }
            if !run.is_empty() {
                result.push(run);
            }
            // A dash crossing a closed subpath's seam has a join there, not two caps.
            if result.len() > first + 1
                && path.first() == path.last()
                && result[first].first() == path.first()
                && result.last()?.last() == path.first()
            {
                let mut last = result.pop()?;
                last.extend_from_slice(&result[first][1..]);
                result[first] = last;
            }
        }
        Some(result)
    }

    pub fn outlines(
        &self,
        paths: &[Vec<Point>],
        matrix: [f64; 4],
        cairo: bool,
        work: &mut usize,
    ) -> Option<Vec<Vec<Point>>> {
        // Bound dash expansion and cap geometry as well as charging the raster work budget.
        let initial = (*work).min(1_000_000);
        let mut budget = initial;
        let dashed;
        let paths = if self.dash.is_empty() {
            paths
        } else {
            dashed = self.dashed(paths, matrix, &mut budget)?;
            &dashed
        };
        let [xx, yx, xy, yy] = matrix;
        let det = xx * yy - xy * yx;
        let adjusted = cairo
            && (self.width * (xx + xy)).abs() <= 1.
            && (self.width * (yx + yy)).abs() <= 1.
            && det != 0.;
        let half = if adjusted {
            ((yy - xy) / det).abs().min(((xx - yx) / det).abs()) / 2.
        } else {
            self.width / 2.
        };
        let fixed = |v: f64| (v * 256.).round_ties_even() / 256.;
        let transform = |[u, v]: Point| [xx * u + xy * v, yx * u + yy * v];
        let circle = |p: Point, budget: &mut usize| -> Option<Vec<Point>> {
            let radius = half.abs() * (xx.hypot(yx) + xy.hypot(yy));
            let steps = (std::f64::consts::PI / (radius / (radius + 0.125)).acos())
                .ceil()
                .max(8.) as usize;
            *budget = budget.checked_sub(steps)?;
            Some(
                (0..steps)
                    .map(|i| {
                        let angle =
                            -(i as f64) * std::f64::consts::TAU / steps as f64 * det.signum();
                        let v = transform([half * angle.cos(), half * angle.sin()]);
                        [p[0] + v[0], p[1] + v[1]]
                    })
                    .collect(),
            )
        };
        let mut outlines = vec![];
        for path in paths {
            let closed = path.len() > 2 && path.first() == path.last();
            for (i, seg) in path.windows(2).enumerate() {
                let (mut a, mut b) = (seg[0], seg[1]);
                if cairo {
                    if adjusted && ((b[0] - a[0]).abs() < 0.5 || (b[1] - a[1]).abs() < 0.5) {
                        a = a.map(|v| v.floor() + 0.5);
                        b = b.map(|v| v.floor() + 0.5);
                    } else {
                        a = a.map(fixed);
                        b = b.map(fixed);
                    }
                }
                let (x, y) = (b[0] - a[0], b[1] - a[1]);
                let (ux, uy) = (yy * x - xy * y, xx * y - yx * x);
                let len = ux.hypot(uy);
                let start_cap = !closed && i == 0;
                let end_cap = !closed && i + 2 == path.len();
                if len == 0. {
                    // Zero-length dashes use a user-space square or disk; butt caps paint nothing.
                    if self.cap == 2 {
                        budget = budget.checked_sub(4)?;
                        let mut square: Vec<_> =
                            [[-half, -half], [half, -half], [half, half], [-half, half]]
                                .into_iter()
                                .map(|p| {
                                    let p = transform(p);
                                    [a[0] + p[0], a[1] + p[1]]
                                })
                                .collect();
                        if det > 0. {
                            square.reverse();
                        }
                        outlines.push(square);
                    }
                } else {
                    let mut normal = transform([-uy / len * half, ux / len * half]);
                    if cairo {
                        normal = normal.map(fixed);
                    }
                    let [nx, ny] = normal;
                    if self.cap == 2 {
                        let tangent = transform([
                            ux / len * half * det.signum(),
                            uy / len * half * det.signum(),
                        ]);
                        if start_cap {
                            a = [a[0] - tangent[0], a[1] - tangent[1]];
                        }
                        if end_cap {
                            b = [b[0] + tangent[0], b[1] + tangent[1]];
                        }
                    }
                    budget = budget.checked_sub(4)?;
                    outlines.push(vec![
                        [a[0] + nx, a[1] + ny],
                        [b[0] + nx, b[1] + ny],
                        [b[0] - nx, b[1] - ny],
                        [a[0] - nx, a[1] - ny],
                    ]);
                }
                if self.cap == 1 {
                    for (p, cap) in [(a, start_cap), (b, end_cap && len != 0.)] {
                        if !cap {
                            continue;
                        }
                        outlines.push(circle(p, &mut budget)?);
                    }
                }
            }
            // A continuous dash keeps the path's joins at vertices and across a closed seam.
            let n = path.len();
            if n < 3 {
                continue;
            }
            for i in usize::from(!closed)..n - 1 {
                budget = budget.checked_sub(1)?;
                let p = path[i];
                let tangent = |a: Point, b: Point| {
                    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                    let (u, v) = (yy * dx - xy * dy, xx * dy - yx * dx);
                    let len = u.hypot(v);
                    (len > 0.).then(|| [u / len * det.signum(), v / len * det.signum()])
                };
                let (Some(before), Some(after)) = (
                    tangent(path[if i == 0 { n - 2 } else { i - 1 }], p),
                    tangent(p, path[i + 1]),
                ) else {
                    continue;
                };
                let cross = |a: Point, b: Point| a[0] * b[1] - a[1] * b[0];
                let turn = cross(before, after);
                if turn.abs() < 1e-12 {
                    continue;
                }
                if self.join == 1 {
                    outlines.push(circle(p, &mut budget)?);
                    continue;
                }
                let side = if turn > 0. { -half } else { half };
                let a = [-before[1] * side, before[0] * side];
                let b = [-after[1] * side, after[0] * side];
                let along = cross([b[0] - a[0], b[1] - a[1]], after) / turn;
                let miter = [a[0] + before[0] * along, a[1] + before[1] * along];
                budget = budget.checked_sub(4)?;
                let mut join = vec![[0., 0.], a];
                if self.join == 0 && miter[0].hypot(miter[1]) <= self.miter * half {
                    join.push(miter);
                }
                join.push(b);
                for v in &mut join {
                    let offset = transform(*v);
                    *v = [p[0] + offset[0], p[1] + offset[1]];
                }
                let area: f64 = join
                    .iter()
                    .zip(join.iter().cycle().skip(1))
                    .map(|(&a, &b)| cross(a, b))
                    .sum();
                if area > 0. {
                    join.reverse();
                }
                outlines.push(join);
            }
        }
        *work -= initial - budget;
        Some(outlines)
    }
}
