use super::{Edge, Group, Node, Shape};
use std::{collections::BTreeMap, fmt::Write};

pub(super) type Point = (f64, f64);
pub(super) enum Segment {
    Line(Point),
    Quad(Point, Point),
}

pub(super) struct Route {
    pub start: Point,
    pub segments: Vec<Segment>,
}

pub(super) fn hundredth(v: f64) -> f64 {
    ((v * 100.) + 0.5).floor() / 100.
}
fn towards(a: Point, b: Point, dist: f64) -> Point {
    let len = (b.0 - a.0).hypot(b.1 - a.1);
    (
        hundredth(a.0 + (b.0 - a.0) / len * dist),
        hundredth(a.1 + (b.1 - a.1) / len * dist),
    )
}
impl Route {
    pub fn rounded(points: &mut [Point], start_arrow: bool, end_arrow: bool, elbow: f64) -> Self {
        let last = points.len() - 1;
        for (i, j, arrow) in [(0, 1, start_arrow), (last, last - 1, end_arrow)] {
            if arrow && (points[i].0 - points[j].0).hypot(points[i].1 - points[j].1) > 7.8 {
                points[i] = towards(points[i], points[j], 6.8);
            }
        }
        let mut segments = Vec::new();
        for triple in points.windows(3) {
            let (a, b, c) = (triple[0], triple[1], triple[2]);
            let r = elbow
                .min((a.0 - b.0).hypot(a.1 - b.1) * 0.45)
                .min((c.0 - b.0).hypot(c.1 - b.1) * 0.45);
            if r < 1. {
                segments.push(Segment::Line(b));
            } else {
                segments.push(Segment::Line(towards(b, a, r)));
                segments.push(Segment::Quad(b, towards(b, c, r)));
            }
        }
        segments.push(Segment::Line(points[last]));
        Self {
            start: points[0],
            segments,
        }
    }
    pub fn svg(&self) -> String {
        let mut d = format!("M {} {}", self.start.0, self.start.1);
        for s in &self.segments {
            match *s {
                Segment::Line((x, y)) => write!(d, " L {x} {y}").unwrap(),
                Segment::Quad((cx, cy), (x, y)) => write!(d, " Q {cx} {cy} {x} {y}").unwrap(),
            }
        }
        d
    }
    pub fn pixels(&self, scale: f64) -> Vec<Point> {
        let scaled = |(x, y): Point| (x * scale, y * scale);
        let mut prev = scaled(self.start);
        let mut pts = vec![prev];
        for seg in &self.segments {
            match *seg {
                Segment::Line(p) => {
                    prev = scaled(p);
                    pts.push(prev);
                }
                Segment::Quad(c, p) => {
                    let (c, p) = (scaled(c), scaled(p));
                    for i in 1..=12 {
                        let t = f64::from(i) / 12.;
                        let u = 1. - t;
                        pts.push((
                            u * u * prev.0 + 2. * u * t * c.0 + t * t * p.0,
                            u * u * prev.1 + 2. * u * t * c.1 + t * t * p.1,
                        ));
                    }
                    prev = p;
                }
            }
        }
        pts
    }
}

// Return the attachment on a shape and the stub 18 pixels outside it.
fn port(
    node: &Node,
    side_x: bool,
    sign: f64,
    index: usize,
    count: usize,
    max_spacing: f64,
) -> (Point, Point) {
    let (w, h) = (f64::from(node.w), f64::from(node.h));
    let (half, depth) = if side_x {
        (h / 2., w / 2.)
    } else {
        (w / 2., h / 2.)
    };
    let allowance = (node.radius + 4.).min(w.min(h) * 0.3);
    let spacing = if count < 2 {
        0.
    } else {
        max_spacing.min((half - allowance) * 2. / (count - 1) as f64)
    };
    let mut off = (index as f64 - (count - 1) as f64 / 2.) * spacing;
    let mut outer = depth;
    let normal = match node.shape {
        Shape::Circle | Shape::StateStart | Shape::StateEnd => {
            outer = depth.min(half);
            off = off.clamp(-outer * 0.65, outer * 0.65);
            (outer * outer - off * off).sqrt()
        }
        Shape::Diamond => {
            off = off.clamp(-half * 0.65, half * 0.65);
            depth * (1. - off.abs() / half)
        }
        _ => depth,
    };
    let (cx, cy) = (f64::from(node.x) + w / 2., f64::from(node.y) + h / 2.);
    let at = |d: f64| {
        if side_x {
            (hundredth(cx + sign * d), hundredth(cy + off))
        } else {
            (hundredth(cx + off), hundredth(cy + sign * d))
        }
    };
    (at(normal), at(outer + 18.))
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Face {
    x: bool,
    positive: bool,
}
#[derive(Clone, Copy)]
struct Attachment {
    face: Face,
    lane: usize,
    count: usize,
    spacing: f64,
}
impl Attachment {
    fn point(self, n: &Node) -> (Point, Point) {
        port(
            n,
            self.face.x,
            if self.face.positive { 1. } else { -1. },
            self.lane,
            self.count,
            self.spacing,
        )
    }
}

pub(super) struct Routes {
    pub paths: Vec<Vec<Point>>,
    pub intersection: Option<String>,
}

pub(super) fn waypoints(
    nodes: &[Node],
    groups: &[Group],
    edges: &[Edge],
    pairs: &BTreeMap<(usize, usize), usize>,
    (horizontal, reverse): (bool, bool),
    edge_id: fn(usize) -> String,
    mut work: usize,
) -> Option<Routes> {
    let mut siblings = BTreeMap::<i32, Vec<&Node>>::new();
    let mut max_depth = 0;
    for n in nodes {
        siblings.entry(n.center(horizontal)).or_default().push(n);
        max_depth = max_depth.max(if horizontal { n.w / 2 } else { n.h / 2 });
    }
    for layer in siblings.values_mut() {
        layer.sort_by_key(|n| n.center(!horizontal));
    }
    let first_hit = |points: &[Point],
                     ends: (&Node, &Node),
                     margin: f64,
                     work: &mut usize|
     -> Option<Option<(usize, &Node)>> {
        for (k, seg) in points.windows(2).enumerate() {
            let a = if horizontal { seg[0].0 } else { seg[0].1 };
            let b = if horizontal { seg[1].0 } else { seg[1].1 };
            let low = (a.min(b) - margin).floor() as i32 - max_depth;
            let high = (a.max(b) + margin + 1.).ceil() as i32 + max_depth;
            let mut earliest: Option<&Node> = None;
            for (_, layer) in siblings.range(low..=high) {
                *work = work.checked_sub(1)?;
                if let Some((_, hit)) = intersection(seg, ends, layer, horizontal, margin)
                    && earliest.is_none_or(|n| hit.order < n.order)
                {
                    earliest = Some(hit);
                }
            }
            if let Some(hit) = earliest {
                return Some(Some((k, hit)));
            }
        }
        Some(None)
    };
    let forward = Face {
        x: horizontal,
        positive: !reverse,
    };
    let towards = Face {
        x: horizontal,
        positive: reverse,
    };
    let loop_face = Face {
        x: !horizontal,
        positive: !horizontal,
    };
    let cross = |n: &Node| {
        if horizontal {
            (n.y, n.y + n.h)
        } else {
            (n.x, n.x + n.w)
        }
    };
    let along = |n: &Node| {
        if horizontal {
            (n.x, n.x + n.w)
        } else {
            (n.y, n.y + n.h)
        }
    };
    let (primary, transverse) = if horizontal { (0, 1) } else { (1, 0) };
    let extremes = nodes
        .iter()
        .map(cross)
        .chain(groups.iter().map(|g| {
            (
                g.bounds[transverse],
                g.bounds[transverse] + g.bounds[transverse + 2],
            )
        }))
        .fold((i32::MAX, i32::MIN), |(lo, hi), (l, h)| {
            (lo.min(l), hi.max(h))
        });
    let mut rails = vec![None; edges.len()];
    let mut bypass_index = 0;
    let mut detour_offset = vec![0.; edges.len()];
    let mut back_index = 0;
    let mut lanes = [0; 2];
    let mut seen = BTreeMap::new();
    let mut buckets = BTreeMap::<(usize, Face), Vec<(i64, usize, usize)>>::new();
    let mut attachments = Vec::with_capacity(edges.len());
    let mut offsets = Vec::with_capacity(edges.len());
    for (i, &(a, b, _, _)) in edges.iter().enumerate() {
        let pair = (a.min(b), a.max(b));
        let index = seen.entry(pair).or_insert(0usize);
        offsets.push(*index);
        let (src, dst) = (&nodes[a], &nodes[b]);
        let mut faces = [forward, towards];
        let ac = src.center(horizontal);
        let bc = dst.center(horizontal);
        let span = ac.min(bc)..=ac.max(bc);
        let back = if reverse { bc > ac } else { bc < ac };
        let mut blocked = false;
        let mut local = (i32::MAX, i32::MIN);
        let (start, end) = if ac < bc {
            (along(src).1, along(dst).0)
        } else {
            (along(dst).1, along(src).0)
        };
        if a != b {
            let lo = src.center(!horizontal).min(dst.center(!horizontal)) - 14;
            let hi = src.center(!horizontal).max(dst.center(!horizontal)) + 14;
            for (_, layer) in siblings.range(span) {
                work = work.checked_sub(1)?;
                local.0 = local.0.min(cross(layer.first()?).0);
                local.1 = local.1.max(cross(layer.last()?).1);
                if !back && !blocked && end - start > 24 {
                    let from = layer.partition_point(|n| cross(n).1 <= lo);
                    for n in layer[from..].iter().take_while(|n| cross(n).0 < hi) {
                        work = work.checked_sub(1)?;
                        if n.id != src.id
                            && n.id != dst.id
                            && along(n).1 > start + 8
                            && along(n).0 < end - 8
                        {
                            blocked = true;
                            break;
                        }
                    }
                }
            }
        }
        if a == b {
            faces = [loop_face; 2];
        } else if back || blocked {
            let mut hits = [0; 2];
            for ep in [src, dst] {
                let layer = &siblings[&ep.center(horizontal)];
                let (lo, hi) = cross(ep);
                let before = layer.partition_point(|n| cross(n).0 < lo);
                let after = layer.partition_point(|n| cross(n).1 <= hi);
                hits[0] += before - layer[..before].partition_point(|n| cross(n).1 <= -10002);
                hits[1] += layer[after..].partition_point(|n| cross(n).0 < hi + 20004);
            }
            let tie = if back {
                (back_index % 2 == 0) != horizontal
            } else {
                bypass_index % 2 == 0
            };
            let positive = if hits[0] == hits[1] {
                tie
            } else {
                hits[1] < hits[0]
            };
            if back {
                back_index += 1;
            }
            detour_offset[i] = f64::from(bypass_index) * 16.;
            bypass_index += 1;
            let dir = usize::from(positive);
            faces = [Face {
                x: !horizontal,
                positive,
            }; 2];
            if !back {
                let low = along(src).0.min(along(dst).0) - 12;
                let high = along(src).1.max(along(dst).1) + 12;
                work = work.checked_sub(groups.len())?;
                for g in groups {
                    let b = g.bounds;
                    if b[primary] <= high && b[primary] + b[primary + 2] >= low {
                        local.0 = local.0.min(b[transverse]);
                        local.1 = local.1.max(b[transverse] + b[transverse + 2]);
                    }
                }
            }
            let (lo, hi) = if back { extremes } else { local };
            let sign = if positive { 1. } else { -1. };
            let outer = if positive { hi } else { lo };
            let distance = if horizontal {
                26 + 42 * lanes[dir]
            } else {
                28 + 48 * lanes[dir]
            };
            rails[i] = Some((f64::from(outer), sign, distance));
            lanes[dir] += 1;
        } else if src.shape == Shape::Diamond || src.to.len() == 2 {
            let delta = dst.center(!horizontal) - src.center(!horizontal);
            let across = if horizontal { src.h } else { src.w };
            if delta.abs() >= across / 2 + if src.shape == Shape::Diamond { 22 } else { 16 } {
                let side = Face {
                    x: !horizontal,
                    positive: delta > 0,
                };
                let p = port(src, side.x, if side.positive { 1. } else { -1. }, 0, 1, 0.).0;
                let q = port(dst, towards.x, if reverse { 1. } else { -1. }, 0, 1, 0.).0;
                let turn = if side.x { (q.0, p.1) } else { (p.0, q.1) };
                if first_hit(&[p, turn, q], (src, dst), 8., &mut work)?.is_none() {
                    faces[0] = side;
                }
            }
        }
        attachments.push(faces.map(|face| Attachment {
            face,
            lane: 0,
            count: 0,
            spacing: 0.,
        }));
        for (end, (n, other)) in [(a, b), (b, a)].into_iter().enumerate() {
            let face = faces[end];
            let key = i64::from(nodes[other].center(!face.x)) + 36 * (*index as i64);
            buckets.entry((n, face)).or_default().push((key, i, end));
        }
        *index += 1;
    }
    for bucket in buckets.values_mut() {
        bucket.sort_by_key(|&(key, _, _)| key);
        let spacing = if bucket.iter().any(|&(_, i, _)| {
            let (a, b, _, _) = edges[i];
            pairs.get(&(a.min(b), a.max(b))).copied().unwrap_or(0) > 1
        }) {
            42.
        } else if bucket.iter().any(|&(_, i, _)| edges[i].0 == edges[i].1) {
            44.
        } else {
            16.
        };
        for (lane, &(_, i, end)) in bucket.iter().enumerate() {
            let at = &mut attachments[i][end];
            at.lane = lane;
            at.count = bucket.len();
            at.spacing = spacing;
        }
    }
    let mut paths = Vec::with_capacity(edges.len());
    let internal: Vec<_> = nodes
        .iter()
        .map(|n| n.group.is_some() && n.to.iter().any(|&i| nodes[i].group == n.group))
        .collect();
    let mut collision = None;
    for (i, &(a, b, _, ref label)) in edges.iter().enumerate() {
        let [mut src, mut dst] = attachments[i];
        let (mut p, mut s) = src.point(&nodes[a]);
        let (mut q, mut t) = dst.point(&nodes[b]);
        if nodes[a].group != nodes[b].group {
            let boundary = |mut point: Point, face: Face, normal: Face, [x, y, w, h]: [i32; 4]| {
                if face.x {
                    point.0 = f64::from(if face.positive { x + w } else { x });
                } else {
                    point.1 = f64::from(if face.positive { y + h } else { y });
                }
                let mut stub = point;
                let dist = if normal.positive { 16. } else { -16. };
                if normal.x {
                    stub.0 += dist;
                } else {
                    stub.1 += dist;
                }
                (point, stub)
            };
            let original_dst = dst.face;
            if let Some(g) = nodes[a].group
                && groups[g].composite
                && !internal[a]
            {
                let bounds @ [x, y, w, h] = groups[g].bounds;
                let target = &nodes[b];
                let positive = if horizontal && target.x >= x + w + 24
                    || !horizontal && target.y >= y + h + 24
                {
                    Some(true)
                } else if horizontal && target.x + target.w <= x - 24 {
                    Some(false)
                } else {
                    None
                };
                if let Some(positive) = positive {
                    src.face = Face {
                        x: horizontal,
                        positive,
                    };
                    dst.face = Face {
                        x: horizontal,
                        positive: !positive,
                    };
                    (q, t) = dst.point(target);
                }
                (p, s) = boundary(p, src.face, src.face, bounds);
            }
            if let Some(g) = nodes[b].group
                && groups[g].composite
                && nodes[b].shape == Shape::StateStart
            {
                (q, t) = boundary(q, original_dst, dst.face, groups[g].bounds);
            }
        }
        let mut points = (|| {
            if a == b {
                let n = &nodes[a];
                let out = 38. + 20. * offsets[i] as f64;
                if horizontal {
                    let y = f64::from(n.y) - out;
                    return vec![p, (p.0, y), (q.0, y), q];
                }
                let x = f64::from(n.x + n.w) + out;
                return vec![p, (x, p.1), (x, q.1), q];
            }
            if let Some((outer, sign, distance)) = rails[i] {
                let (v, w) = if horizontal { (s.1, t.1) } else { (s.0, t.0) };
                let rail =
                    sign * ((outer * sign).max(v * sign).max(w * sign) + f64::from(distance));
                return if horizontal {
                    vec![p, (p.0, rail), (q.0, rail), q]
                } else {
                    vec![p, (rail, p.1), (rail, q.1), q]
                };
            }
            if src.face.x != dst.face.x {
                return vec![p, if src.face.x { (q.0, p.1) } else { (p.0, q.1) }, q];
            }
            let (u, v) = if horizontal { (p.1, q.1) } else { (p.0, q.0) };
            if (u - v).abs() <= 4. && pairs[&(a.min(b), a.max(b))] == 1 {
                let c = if nodes[b].shape == Shape::Diamond {
                    v
                } else if nodes[a].shape == Shape::Diamond {
                    u
                } else {
                    ((u + v) * 0.5 + 0.5).floor()
                };
                return if horizontal {
                    vec![(p.0, c), (q.0, c)]
                } else {
                    vec![(c, p.1), (c, q.1)]
                };
            }
            let lane = if src.count >= dst.count { src } else { dst };
            let f = (lane.lane + 1) as f64 / (lane.count + 1) as f64;
            let reserve = label.as_ref().map_or(0., |p| {
                if horizontal {
                    p.width + 24.
                } else {
                    p.height + 24.
                }
            });
            if horizontal {
                let delta = t.0 - s.0;
                let end = t.0 - delta.signum() * reserve.min(delta.abs());
                let x = (s.0 + (end - s.0) * f + 0.5).floor();
                vec![p, (x, p.1), (x, q.1), q]
            } else {
                let (mut start, mut end) = (s.1, t.1);
                if !reverse && nodes[a].group != nodes[b].group {
                    if let Some(g) = nodes[a].group {
                        let [_, y, _, h] = groups[g].bounds;
                        if f64::from(y + h) < end {
                            start = start.max(f64::from(y + h + 10));
                        }
                    }
                    if let Some(g) = nodes[b].group {
                        let y = groups[g].bounds[1];
                        if f64::from(y) > start {
                            end = end.min(f64::from(y - 10));
                        }
                    }
                }
                let end = if reverse {
                    start.min(end + reserve)
                } else {
                    start.max(end - reserve)
                };
                let y = (start + (end - start) * f + 0.5).floor();
                vec![p, (p.0, y), (q.0, y), q]
            }
        })();
        if a != b {
            for _ in 0..6 {
                let Some((k, obstacle)) =
                    first_hit(&points, (&nodes[a], &nodes[b]), 4., &mut work)?
                else {
                    break;
                };
                work = work.checked_sub(nodes.len())?;
                let (u, v) = (points[k], points[k + 1]);
                let vertical = (u.0 - v.0).abs() < 1.;
                // Work in (cross, along) coordinates for both kinds of detour.
                let axes = |(x, y): Point| if vertical { (x, y) } else { (y, x) };
                let ((c0, l0), (_, l1)) = (axes(u), axes(v));
                let rect = |n: &Node| {
                    if vertical {
                        (n.x, n.w, n.y, n.h)
                    } else {
                        (n.y, n.h, n.x, n.w)
                    }
                };
                let (oc, ow, ol, oh) = rect(obstacle);
                let (mut low, mut high) = (oc, oc + ow);
                for n in nodes.iter().filter(|n| n.order != a && n.order != b) {
                    let (c, w, l, h) = rect(n);
                    if f64::from(l + h) >= l0.min(l1) - 12.
                        && f64::from(l) <= l0.max(l1) + 12.
                        && (f64::from(c + w / 2) - c0).abs()
                            <= f64::from(w.max(if vertical { 220 } else { 160 }))
                    {
                        low = low.min(c);
                        high = high.max(c + w);
                    }
                }
                let pad = detour_offset[i] + if vertical { 28. } else { 24. };
                let (low, high) = (f64::from(low) - pad, f64::from(high) + pad);
                let detour = (if (high - c0).abs() <= (c0 - low).abs() {
                    high
                } else {
                    low
                })
                .round();
                if vertical && points.len() == 4 && (k == 0 || k == 2) {
                    points = vec![p, s, (detour, s.1), (detour, t.1), t, q];
                } else if !vertical && points.len() == 4 && k == 1 {
                    points = vec![
                        points[0],
                        (points[0].0, detour),
                        (points[3].0, detour),
                        points[3],
                    ];
                } else {
                    let (enter, exit) = if l0 <= l1 {
                        (
                            l0.max(f64::from(ol) - 18.),
                            l1.min(f64::from(ol + oh) + 18.),
                        )
                    } else {
                        (
                            l0.min(f64::from(ol + oh) + 18.),
                            l1.max(f64::from(ol) - 18.),
                        )
                    };
                    points.splice(
                        k + 1..k + 1,
                        [
                            (c0, enter),
                            (detour, enter),
                            (detour, exit),
                            (axes(v).0, exit),
                        ]
                        .map(axes),
                    );
                }
            }
        }
        points.dedup_by(|b, a| (a.0 - b.0).hypot(a.1 - b.1) <= 0.25);
        if collision.is_none()
            && let Some((k, other)) = first_hit(&points, (&nodes[a], &nodes[b]), -2., &mut work)?
        {
            collision = Some(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 6 (edge-node intersection): edge \"{}\" ({}->{}) segment [{k}] intersects unrelated node \"{}\"\n",
                edge_id(i),
                nodes[a].id,
                nodes[b].id,
                other.id
            ));
        }
        paths.push(points);
    }
    Some(Routes {
        paths,
        intersection: collision,
    })
}

pub(super) fn attachment_error(
    points: &[Point],
    source: &Node,
    target: &Node,
    id: &str,
    groups: &[Group],
    (dx, dy): (i32, i32),
) -> Option<String> {
    let end = points.len() - 1;
    for (n, (x, y), side, tip) in [
        (source, points[0], "source", "start"),
        (target, points[end], "target", "end"),
    ] {
        let (w, h) = (f64::from(n.w) / 2., f64::from(n.h) / 2.);
        let (xoff, yoff) = (
            (x - f64::from(n.center(true))).abs(),
            (y - f64::from(n.center(false))).abs(),
        );
        let dist = match n.shape {
            Shape::Diamond => (xoff / w + yoff / h - 1.).abs() * w.min(h),
            Shape::Circle | Shape::StateStart | Shape::StateEnd => {
                (xoff.hypot(yoff) - w.min(h)).abs()
            }
            _ if xoff > w || yoff > h => (xoff - w).max(0.).hypot((yoff - h).max(0.)),
            _ => (w - xoff).min(h - yoff),
        };
        let dist = if let Some(g) = n.group {
            let [gx, gy, gw, gh] = groups[g].bounds;
            let (w, h) = (f64::from(gw) / 2., f64::from(gh) / 2.);
            let (a, b) = (
                (x - f64::from(gx + dx) - w).abs() - w,
                (y - f64::from(gy + dy) - h).abs() - h,
            );
            dist.min(if a > 0. || b > 0. {
                a.max(0.).hypot(b.max(0.))
            } else {
                -a.max(b)
            })
        } else {
            dist
        };
        if dist > 0.5 {
            return Some(format!(
                "({side} port perimeter): edge '{id}' {tip} ({x},{y}) is {dist:.2}px from '{}' perimeter (> 0.5px)",
                n.id
            ));
        }
    }
    for (a, b, side, part) in [
        (0, 1, "source", "initial"),
        (end, end - 1, "target", "terminal"),
    ] {
        let (dx, dy) = (points[a].0 - points[b].0, points[a].1 - points[b].1);
        let orthogonal = dx.abs() < 0.1 || dy.abs() < 0.1;
        let len = dx.hypot(dy);
        if !orthogonal || len < 11.9 {
            return Some(format!(
                "({side} perpendicular stub): edge '{id}' {part} segment length={len:.2}px orthogonal={orthogonal}"
            ));
        }
    }
    None
}

fn intersection<'a>(
    points: &[Point],
    endpoints: (&Node, &Node),
    siblings: &[&'a Node],
    horizontal: bool,
    margin: f64,
) -> Option<(usize, &'a Node)> {
    for (k, seg) in points.windows(2).enumerate() {
        let (a, b) = (seg[0], seg[1]);
        let (x, y) = (a.0.min(b.0), a.1.min(b.1));
        let (right, bottom) = (x + (a.0 - b.0).abs().max(1.), y + (a.1 - b.1).abs().max(1.));
        // Siblings are ordered across their rank.
        let begin = siblings.partition_point(|n| {
            if horizontal {
                f64::from(n.y + n.h) <= y - margin
            } else {
                f64::from(n.x + n.w) <= x - margin
            }
        });
        for n in &siblings[begin..] {
            if if horizontal {
                f64::from(n.y) >= bottom + margin
            } else {
                f64::from(n.x) >= right + margin
            } {
                break;
            }
            if n.id != endpoints.0.id
                && n.id != endpoints.1.id
                && x - margin < f64::from(n.x + n.w)
                && right + margin > f64::from(n.x)
                && y - margin < f64::from(n.y + n.h)
                && bottom + margin > f64::from(n.y)
            {
                return Some((k, n));
            }
        }
    }
    None
}
