use super::Point;

// Cairo measures polygon edges in 1/256-pixel units horizontally and uses
// 15 subrows vertically. An uninterrupted pair of edges takes the analytic
// scanline path; a vertex inside the row switches to horizontal subspans.
pub(super) struct Footprint([Point; 4]);

pub(super) enum Coverage {
    Box { left: f64, right: f64, height: f64 },
    Edges([ScanEdge; 2]),
    Spans([(f64, f64); 15]),
}

// Keep both endpoints over a shared denominator: rounding their positions
// before finding column crossings can move a crossing by one subrow.
#[derive(Clone, Copy, Default)]
pub(super) struct ScanEdge {
    top: f64,
    bottom: f64,
    denominator: f64,
    next_sample: f64,
}

struct RowEdge {
    from: usize,
    to: usize,
    direction: i32,
    start_x: f64,
    slope: f64,
    den: f64,
}

impl RowEdge {
    fn new(p: Point, q: Point, start: f64) -> Option<Self> {
        let ([x0, y0], [x1, y1]) = if p[1] < q[1] { (p, q) } else { (q, p) };
        let subrow = |y: f64| ((y * 15. / 256. + 0.5).floor() - start).clamp(0., 15.) as usize;
        let (from, to) = (subrow(y0), subrow(y1));
        if from == to {
            return None;
        }
        let den = 2. * (y1 - y0) * 15.;
        Some(Self {
            from,
            to,
            direction: if p[1] < q[1] { 1 } else { -1 },
            den,
            slope: 512. * (x1 - x0),
            start_x: x0 * den + 2. * (start * 256. - y0 * 15.) * (x1 - x0),
        })
    }
    fn sample(&self, sub: usize) -> f64 {
        ((self.start_x + (sub as f64 + 0.5) * self.slope + self.den / 2.) / self.den).floor()
    }
    fn full(&self) -> ScanEdge {
        let top = self.start_x + (self.slope / self.den).trunc() % 2. * self.den / 2.;
        ScanEdge {
            top,
            bottom: top + 15. * self.slope,
            denominator: self.den,
            next_sample: self.sample(15),
        }
    }
    fn crosses_boundary(&self, width: usize) -> bool {
        let end = self.start_x + 15. * self.slope;
        [0., width as f64 * 256. * self.den]
            .iter()
            .any(|&x| self.start_x.min(end) < x && x < self.start_x.max(end))
    }
}

impl Footprint {
    pub(super) fn new([a, b, c, d, e, f]: [f64; 6]) -> Self {
        let corners = [
            [e, f],
            [e + a, f + b],
            [e + a + c, f + b + d],
            [e + c, f + d],
        ]
        .map(|p| p.map(|v| (v * 256.).round_ties_even()));
        Self(corners)
    }

    pub(super) fn row(&self, y: usize, width: usize) -> Coverage {
        let [a, b, c, d] = self.0;
        if (a[0] == b[0] && a[1] == d[1]) || (a[1] == b[1] && a[0] == d[0]) {
            return Coverage::rectangle(a, c, y);
        }
        let start = y as f64 * 15.;
        let mut lines = [ScanEdge::default(); 2];
        let mut count = 0;
        let mut spans = [(f64::INFINITY, f64::NEG_INFINITY); 15];
        let mut whole = true;
        for (i, &p) in self.0.iter().enumerate() {
            let q = self.0[(i + 1) % 4];
            let Some(edge) = RowEdge::new(p, q, start) else {
                continue;
            };
            let (from, to) = (edge.from, edge.to);
            if from == 0 && to == 15 && count < 2 {
                // The full-row stepper subtracts half its integer step and
                // half its remainder separately from the first sample.
                lines[count] = edge.full();
                // Clipping against the page introduces a vertex wherever
                // an edge crosses either side within the row.
                whole &= !edge.crosses_boundary(width);
                count += 1;
            } else {
                whole = false;
            }
            for (sub, span) in spans.iter_mut().enumerate().take(to).skip(from) {
                let sample = edge.sample(sub);
                span.0 = span.0.min(sample);
                span.1 = span.1.max(sample);
            }
        }
        let middle = |e: &ScanEdge| (e.top + e.bottom) / e.denominator;
        if count == 2 && middle(&lines[0]) > middle(&lines[1]) {
            lines.swap(0, 1);
        }
        whole &= count == 2 && lines[0].next_sample <= lines[1].next_sample;
        if whole {
            Coverage::Edges(lines)
        } else {
            Coverage::Spans(spans)
        }
    }
}

impl Coverage {
    pub(super) fn rectangle(a: Point, c: Point, y: usize) -> Self {
        let y = y as f64 * 256.;
        Self::Box {
            left: a[0].min(c[0]),
            right: a[0].max(c[0]),
            height: (a[1].max(c[1]).min(y + 256.) - a[1].min(c[1]).max(y)).max(0.),
        }
    }

    pub(super) fn alpha(&self, col: usize) -> u8 {
        let x = col as f64 * 256.;
        let area = match self {
            Self::Box {
                left,
                right,
                height,
            } => {
                let width = (right.min(x + 256.) - left.max(x)).max(0.);
                return (width * height / 256.) as u8;
            }
            Self::Edges(lines) => lines[1].area_to_left(x) - lines[0].area_to_left(x),
            Self::Spans(spans) => spans
                .iter()
                .map(|&(l, r)| 2. * (r.min(x + 256.) - l.max(x)).max(0.))
                .sum(),
        };
        area_alpha(area)
    }
}

impl ScanEdge {
    // Twice the subpixel area left of this edge inside the column.
    fn area_to_left(&self, x: f64) -> f64 {
        let den = self.denominator;
        let (lo, hi) = (
            self.top.min(self.bottom) - x * den,
            self.top.max(self.bottom) - x * den,
        );
        if hi <= 0. {
            return 0.;
        }
        if lo >= 256. * den {
            return 7680.;
        }
        if lo == hi {
            return 30. * (lo / den).floor();
        }
        let height = |at: f64| ((at * den - lo) * 15. / (hi - lo)).floor().clamp(0., 15.);
        let end = height(256.);
        ((lo / den).floor().clamp(0., 256.) + (hi / den).floor().clamp(0., 256.))
            * (end - height(0.))
            + 512. * (15. - end)
    }
}

// Fill all subpaths together: winding can change at every crossing, so the
// leftmost and rightmost edges alone do not describe holes or intersections.
pub(super) fn path_row(
    edges: &[(Point, Point)],
    y: usize,
    width: usize,
    x0: usize,
    areas: &mut [f64],
    even: bool,
    work: &mut usize,
) -> Option<()> {
    let active: Vec<_> = edges
        .iter()
        .filter_map(|&(p, q)| RowEdge::new(p, q, y as f64 * 15.))
        .collect();
    let mut crossings = Vec::with_capacity(active.len());
    let mut full = active.iter().all(|e| {
        e.from == 0
            && e.to == 15
            && ![0., width as f64 * 256.].iter().any(|&x| {
                let at = ((x * e.den - e.start_x) / e.slope).round();
                at > 0. && at < 15.
            })
    });
    areas.fill(0.);
    for sub in 0..15 {
        crossings.clear();
        crossings.extend(
            active
                .iter()
                .filter(|e| e.from <= sub && sub < e.to)
                .map(|e| (e.sample(sub), e)),
        );
        *work = work.checked_sub(
            crossings
                .len()
                .saturating_mul(crossings.len().max(1).ilog2() as usize + 1),
        )?;
        crossings.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then_with(|| (a.1.start_x / a.1.den).total_cmp(&(b.1.start_x / b.1.den)))
        });
        if full {
            // Edges outside the page are represented by its vertical side.
            // Keep the look-ahead sample of an interior edge unrestricted:
            // crossing that side after the last subrow rules out a full step.
            let next = |edge: &RowEdge| {
                let left = edge.sample(0);
                let last = edge.sample(14);
                let right = width as f64 * 256.;
                if left <= 0. && last <= 0. {
                    0.
                } else if left >= right && last >= right {
                    right
                } else {
                    edge.sample(15)
                }
            };
            full = crossings.windows(2).all(|w| next(w[0].1) <= next(w[1].1));
        }
        let mut winding = 0;
        let mut left = None;
        for (i, &(right_x, right)) in crossings.iter().enumerate() {
            left.get_or_insert((right_x, right));
            winding += right.direction;
            if (if even { winding % 2 } else { winding }) != 0
                || crossings.get(i + 1).is_some_and(|next| next.0 == right_x)
            {
                continue;
            }
            let (left_x, left_edge) = left.take().unwrap();
            let (l, r) = (left_edge.full(), right.full());
            let (lo, hi) = if full {
                (
                    l.top.min(l.bottom) / l.denominator,
                    r.top.max(r.bottom) / r.denominator,
                )
            } else {
                (left_x, right_x)
            };
            let start = ((lo / 256.).floor() as usize).max(x0);
            let end = ((hi / 256.).ceil() as usize).min(x0 + areas.len());
            *work = work.checked_sub(end.saturating_sub(start))?;
            for x in start..end {
                let at = x as f64 * 256.;
                areas[x - x0] += if full {
                    r.area_to_left(at) - l.area_to_left(at)
                } else {
                    2. * (right_x.min(at + 256.) - left_x.max(at)).max(0.)
                };
            }
        }
        if full {
            break;
        }
    }
    Some(())
}

pub(super) fn area_alpha(area: f64) -> u8 {
    ((area * 17. + 256.) / 512.).floor().clamp(0., 255.) as u8
}

// Cairo's mono converter rounds half toward the smaller pixel and samples
// the segment at 127/256 of the row. It joins spans one pixel apart.
pub(super) fn mono_row(
    edges: &[(Point, Point)],
    y: usize,
    width: usize,
    even: bool,
    work: &mut usize,
    mut span: impl FnMut(usize, usize),
) -> Option<()> {
    let pixel = |fixed: f64| ((fixed + 127.) / 256.).floor();
    let row = y as f64;
    let mut crossings = Vec::new();
    for &(p, q) in edges {
        if row < pixel(p[1].min(q[1])) || row >= pixel(p[1].max(q[1])) {
            continue;
        }
        let x = p[0] + ((row * 256. + 127. - p[1]) * (q[0] - p[0]) / (q[1] - p[1])).floor();
        crossings.push((
            pixel(x).clamp(0., width as f64),
            if p[1] < q[1] { 1 } else { -1 },
        ));
    }
    *work = work.checked_sub(
        crossings
            .len()
            .saturating_mul(crossings.len().max(1).ilog2() as usize + 1),
    )?;
    crossings.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
    let mut winding = 0;
    let mut left = None;
    for (i, &(x, dir)) in crossings.iter().enumerate() {
        winding += dir;
        if (if even { winding % 2 } else { winding }) != 0 {
            left.get_or_insert(x);
        } else if crossings.get(i + 1).is_none_or(|next| next.0 > x + 1.)
            && let Some(start) = left.take()
        {
            span(start as usize, x as usize);
        }
    }
    Some(())
}
