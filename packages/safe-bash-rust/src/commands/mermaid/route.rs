use super::{Node, Shape};
use std::fmt::Write;

pub(super) type Point = (f64, f64);
pub(super) enum Segment {
    Line(Point),
    Quad(Point, Point),
}

pub(super) struct Route {
    pub start: Point,
    pub segments: Vec<Segment>,
}

fn hundredth(v: f64) -> f64 {
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

pub(super) fn forward(
    a: &Node,
    b: &Node,
    horizontal: bool,
    reversed: bool,
    lane: usize,
    count: usize,
) -> Vec<Point> {
    let sign = if reversed { -1. } else { 1. };
    let (p, s) = port(a, horizontal, sign, lane, count, 42.);
    let (q, t) = port(b, horizontal, -sign, lane, count, 42.);
    if count == 1 {
        return vec![p, q];
    }
    let f = (lane + 1) as f64 / (count + 1) as f64;
    if horizontal {
        let x = (s.0 + (t.0 - s.0) * f + 0.5).floor();
        vec![p, (x, p.1), (x, q.1), q]
    } else {
        let y = (s.1 + (t.1 - s.1) * f + 0.5).floor();
        vec![p, (p.0, y), (q.0, y), q]
    }
}
pub(super) fn loop_points(node: &Node, horizontal: bool, index: usize, total: usize) -> [Point; 4] {
    let sign = if horizontal { -1. } else { 1. };
    let a = port(node, !horizontal, sign, index * 2, total * 2, 44.).0;
    let b = port(node, !horizontal, sign, index * 2 + 1, total * 2, 44.).0;
    let out = 38. + 20. * index as f64;
    if horizontal {
        let y = f64::from(node.y) - out;
        [a, (a.0, y), (b.0, y), b]
    } else {
        let x = f64::from(node.x + node.w) + out;
        [a, (x, a.1), (x, b.1), b]
    }
}

pub(super) fn loop_intersection<'a>(
    points: &[Point],
    node: &Node,
    siblings: &[&'a Node],
    horizontal: bool,
) -> Option<(usize, &'a str)> {
    for (k, seg) in points.windows(2).enumerate() {
        let (a, b) = (seg[0], seg[1]);
        let (x, y) = (a.0.min(b.0), a.1.min(b.1));
        let (right, bottom) = (x + (a.0 - b.0).abs().max(1.), y + (a.1 - b.1).abs().max(1.));
        // A self-loop stays within its own rank along the flow axis. Siblings
        // are ordered across the rank, so skip those entirely before the segment.
        let begin = siblings.partition_point(|n| {
            if horizontal {
                f64::from(n.y + n.h) <= y + 2.
            } else {
                f64::from(n.x + n.w) <= x + 2.
            }
        });
        for n in &siblings[begin..] {
            if if horizontal {
                f64::from(n.y) >= bottom - 2.
            } else {
                f64::from(n.x) >= right - 2.
            } {
                break;
            }
            if n.id != node.id
                && x + 2. < f64::from(n.x + n.w)
                && right - 2. > f64::from(n.x)
                && y + 2. < f64::from(n.y + n.h)
                && bottom - 2. > f64::from(n.y)
            {
                return Some((k, n.id.as_str()));
            }
        }
    }
    None
}
