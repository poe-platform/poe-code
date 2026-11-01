use super::{Node, Shape};
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
    pub fn rounded(points: &mut [Point], start_arrow: bool, end_arrow: bool) -> Self {
        let last = points.len() - 1;
        for (i, j, arrow) in [(0, 1, start_arrow), (last, last - 1, end_arrow)] {
            if arrow && (points[i].0 - points[j].0).hypot(points[i].1 - points[j].1) > 7.8 {
                points[i] = towards(points[i], points[j], 6.8);
            }
        }
        let mut segments = Vec::new();
        for triple in points.windows(3) {
            let (a, b, c) = (triple[0], triple[1], triple[2]);
            let r = 10_f64
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
    let allowance = (f64::from(node.radius) + 4.).min(w.min(h) * 0.3);
    let spacing = if count < 2 {
        0.
    } else {
        max_spacing.min((half - allowance) * 2. / (count - 1) as f64)
    };
    let mut off = (index as f64 - (count - 1) as f64 / 2.) * spacing;
    let mut outer = depth;
    let normal = match node.shape {
        Shape::Circle => {
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

pub(super) fn waypoints(
    nodes: &[Node],
    edges: &[(usize, usize, &str, &str)],
    pairs: &BTreeMap<(usize, usize), usize>,
    siblings: &BTreeMap<i32, Vec<&Node>>,
    horizontal: bool,
    reverse: bool,
    mut work: usize,
) -> Option<Vec<Vec<Point>>> {
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
    let extremes = nodes.iter().fold((i32::MAX, i32::MIN), |(lo, hi), n| {
        let (l, h) = cross(n);
        (lo.min(l), hi.max(h))
    });
    let mut rails = vec![None; edges.len()];
    let mut bypass_index = 0;
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
            bypass_index += 1;
            let dir = usize::from(positive);
            faces = [Face {
                x: !horizontal,
                positive,
            }; 2];
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
                if [src, dst].iter().all(|n| {
                    intersection(
                        &[p, turn, q],
                        (src, dst),
                        &siblings[&n.center(horizontal)],
                        horizontal,
                        8.,
                    )
                    .is_none()
                }) {
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
    Some(
        edges
            .iter()
            .enumerate()
            .map(|(i, &(a, b, _, _))| {
                let [src, dst] = attachments[i];
                let (p, s) = src.point(&nodes[a]);
                let (q, t) = dst.point(&nodes[b]);
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
                if horizontal {
                    let x = (s.0 + (t.0 - s.0) * f + 0.5).floor();
                    vec![p, (x, p.1), (x, q.1), q]
                } else {
                    let y = (s.1 + (t.1 - s.1) * f + 0.5).floor();
                    vec![p, (p.0, y), (q.0, y), q]
                }
            })
            .collect(),
    )
}

pub(super) fn intersection<'a>(
    points: &[Point],
    endpoints: (&Node, &Node),
    siblings: &[&'a Node],
    horizontal: bool,
    margin: f64,
) -> Option<(usize, &'a str)> {
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
                return Some((k, n.id.as_str()));
            }
        }
    }
    None
}
