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

pub(super) fn loop_points(node: &Node, horizontal: bool, index: usize, total: usize) -> [Point; 4] {
    let (w, h) = (f64::from(node.w), f64::from(node.h));
    let (cx, cy) = (f64::from(node.x) + w / 2., f64::from(node.y) + h / 2.);
    let half = if horizontal { w / 2. } else { h / 2. };
    let normal_half = if horizontal { h / 2. } else { w / 2. };
    let allowance = (f64::from(node.radius()) + 4.).min(w.min(h) * 0.3);
    let spacing = 44_f64.min((half - allowance) * 2. / (2 * total - 1) as f64);
    let port = |n: usize| {
        let mut off = (n as f64 - (2 * total - 1) as f64 / 2.) * spacing;
        let normal = match node.shape {
            Shape::Circle | Shape::Diamond => {
                off = off.clamp(-half * 0.65, half * 0.65);
                if node.shape == Shape::Circle {
                    (half * half - off * off).sqrt()
                } else {
                    normal_half * (1. - off.abs() / half)
                }
            }
            _ => normal_half,
        };
        if horizontal {
            (hundredth(cx + off), hundredth(cy - normal))
        } else {
            (hundredth(cx + normal), hundredth(cy + off))
        }
    };
    let (a, b) = (port(2 * index), port(2 * index + 1));
    let out = 38. + 20. * index as f64;
    if horizontal {
        let y = f64::from(node.y) - out;
        [a, (a.0, y), (b.0, y), b]
    } else {
        let x = f64::from(node.x + node.w) + out;
        [a, (x, a.1), (x, b.1), b]
    }
}
