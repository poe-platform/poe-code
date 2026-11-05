use super::Point;

// Cairo measures polygon edges in 1/256-pixel units horizontally and uses
// 15 subrows vertically. An uninterrupted pair of edges takes the analytic
// scanline path; a vertex inside the row switches to horizontal subspans.
pub(super) enum Coverage {
    Box { left: f64, right: f64, height: f64 },
    Subrows { left: f64, right: f64, count: f64 },
}

// Keep both endpoints over a shared denominator: rounding their positions
// before finding column crossings can move a crossing by one subrow.
struct ScanEdge {
    top: f64,
    bottom: f64,
    denominator: f64,
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
    fn new(p: Point, q: Point, start: f64, top: f64, bottom: f64) -> Option<Self> {
        let ([x0, y0], [x1, y1]) = if p[1] < q[1] { (p, q) } else { (q, p) };
        let subrow = |y: f64| ((y * 15. / 256. + 0.5).floor() - start).clamp(0., 15.) as usize;
        let (from, to) = (subrow(top), subrow(bottom));
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
        }
    }
}

pub(super) fn image_corners([a, b, c, d, e, f]: [f64; 6]) -> [Point; 4] {
    // cairo_rectangle starts at PDF (0,0) and appends relative edges.
    // Cairo rounds that origin and each delta separately to 24.8.
    let fixed = |x: f64| (x * 256.).round_ties_even();
    let (x, y) = (fixed(e + c), fixed(f + d));
    let [a, b, c, d] = [a, b, c, d].map(fixed);
    [
        [x - c, y - d],
        [x - c + a, y - d + b],
        [x + a, y + b],
        [x, y],
    ]
}

impl Coverage {
    pub(super) fn rectangle(a: Point, c: Point, y: usize, clip: Point) -> Self {
        let left = a[0].min(c[0]);
        let top = a[1].min(c[1]);
        let right = a[0].max(c[0]);
        let bottom = a[1].max(c[1]);
        let y = y as f64 * 256.;
        // A fractional clip through the box's integer paint bounds uses
        // Cairo's polygon compositor, even if the box itself fits inside.
        if (right / 256.).ceil() * 256. > clip[0] && clip[0] % 256. != 0.
            || (bottom / 256.).ceil() * 256. > clip[1] && clip[1] % 256. != 0.
        {
            let from = ((top - y) * 15. / 256. + 0.5).floor();
            let to = ((bottom.min(clip[1]) - y) * 15. / 256. + 0.5).floor();
            return Self::Subrows {
                left,
                right: right.min(clip[0]),
                count: (to.clamp(0., 15.) - from.clamp(0., 15.)).max(0.),
            };
        }
        Self::Box {
            left,
            right,
            height: (bottom.min(y + 256.) - top.max(y)).max(0.),
        }
    }

    pub(super) fn alpha(&self, col: usize) -> u8 {
        let x = col as f64 * 256.;
        let overlap = |left: f64, right: f64| (right.min(x + 256.) - left.max(x)).max(0.);
        match *self {
            Self::Box {
                left,
                right,
                height,
            } => (overlap(left, right) * height / 256.) as u8,
            Self::Subrows { left, right, count } => area_alpha(2. * overlap(left, right) * count),
        }
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

// Keep the original slope for the interior portion of a clipped edge. The
// portions outside the page run down its sides to preserve the winding count.
pub(super) struct PolygonEdge {
    rank: usize,
    p: Point,
    q: Point,
    direction: i32,
    top: f64,
    bottom: f64,
}

pub(super) fn clipped_edges(edges: &[(Point, Point)], clip: Point) -> Vec<PolygonEdge> {
    let mut result = Vec::new();
    for &(p, q) in edges {
        let (p, q, direction) = if p[1] <= q[1] { (p, q, 1) } else { (q, p, -1) };
        let (mut top, mut bottom) = (p[1].max(0.), q[1].min(clip[1]));
        if top >= bottom {
            continue;
        }
        let mut side = |x, top, bottom| {
            result.push(PolygonEdge {
                rank: usize::MAX,
                p: [x, top],
                q: [x, bottom],
                direction,
                top,
                bottom,
            });
        };
        if p[0].max(q[0]) <= 0. {
            side(0., top, bottom);
            continue;
        }
        if p[0].min(q[0]) >= clip[0] {
            side(clip[0], top, bottom);
            continue;
        }
        let dx = q[0] - p[0];
        let dy = q[1] - p[1];
        for (x, outside) in [
            (0., p[0].min(q[0]) < 0.),
            (clip[0], p[0].max(q[0]) > clip[0]),
        ] {
            if !outside {
                continue;
            }
            let entering = if x == 0. { dx > 0. } else { dx < 0. };
            let mut y = p[1] + ((x - p[0]) * dy / dx).floor();
            let at = p[0] + ((y - p[1]) * dx / dy).floor();
            if (x == 0. && at < x) || (x != 0. && at > x) {
                y += if entering { 1. } else { -1. };
            }
            let cut = y.clamp(top, bottom);
            if entering {
                if top < cut {
                    side(x, top, cut);
                }
                top = cut;
            } else {
                if cut < bottom {
                    side(x, cut, bottom);
                }
                bottom = cut;
            }
        }
        if top < bottom {
            result.push(PolygonEdge {
                rank: usize::MAX,
                p,
                q,
                direction,
                top,
                bottom,
            });
        }
    }
    result
}

// Fill all subpaths together: winding can change at every crossing, so the
// leftmost and rightmost edges alone do not describe holes or intersections.
pub(super) fn path_row(
    edges: &mut [PolygonEdge],
    y: usize,
    x0: usize,
    areas: &mut [f64],
    even: bool,
    work: &mut usize,
) -> Option<()> {
    let active: Vec<_> = edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let mut row = RowEdge::new(e.p, e.q, y as f64 * 15., e.top, e.bottom)?;
            row.direction = e.direction;
            Some((i, row))
        })
        .collect();
    let mut crossings = Vec::with_capacity(active.len());
    let mut full = active.iter().all(|(_, e)| e.from == 0 && e.to == 15);
    areas.fill(0.);
    for sub in 0..15 {
        crossings.clear();
        crossings.extend(
            active
                .iter()
                .filter(|(_, e)| e.from <= sub && sub < e.to)
                .map(|(i, e)| (e.sample(sub), e, *i)),
        );
        *work = work.checked_sub(
            crossings
                .len()
                .saturating_mul(crossings.len().max(1).ilog2() as usize + 1),
        )?;
        crossings.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then_with(|| edges[a.2].rank.cmp(&edges[b.2].rank))
        });
        // Cairo keeps the active list in its previous order when samples tie.
        for (rank, &(_, _, i)) in crossings.iter().enumerate() {
            edges[i].rank = rank;
        }
        if full {
            full = crossings
                .windows(2)
                .all(|w| w[0].1.sample(15) <= w[1].1.sample(15));
        }
        let mut winding = 0;
        let mut left = None;
        for (i, &(right_x, right, _)) in crossings.iter().enumerate() {
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
