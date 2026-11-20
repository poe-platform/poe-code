use super::{Edge, Group, Node, route::Point};

use super::Pill;
use std::collections::BTreeMap;
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Slot {
    Center,
    Source,
    Target,
}
impl Slot {
    pub fn suffix(self) -> &'static str {
        match self {
            Self::Center => "label",
            Self::Source => "srcLabel",
            Self::Target => "dstLabel",
        }
    }
}
pub(super) type Endpoints = BTreeMap<(usize, Slot), Pill>;
pub(super) type Positions = BTreeMap<(usize, Slot), Rect>;
type Rect = [f64; 4];
pub(super) fn overlaps([x, y, w, h]: Rect, [a, b, c, d]: Rect, margin: f64) -> bool {
    x - margin < a + c && x + w + margin > a && y - margin < b + d && y + h + margin > b
}

pub(super) fn place(
    nodes: &[Node],
    groups: &[Group],
    edges: &[Edge],
    paths: &[Vec<Point>],
    endpoints: &Endpoints,
    edge_id: fn(usize) -> String,
    mut work: usize,
) -> Result<Positions, String> {
    let mut placed = Positions::new();
    if endpoints.is_empty() && edges.iter().all(|e| e.3.is_none()) {
        return Ok(placed);
    }
    let boxes: Vec<_> = nodes
        .iter()
        .map(|n| [n.x.into(), n.y.into(), n.w.into(), n.h.into()])
        .chain(groups.iter().map(Group::header))
        .collect();
    let segments: Vec<_> = paths
        .iter()
        .enumerate()
        .flat_map(|(i, path)| {
            path.windows(2).map(move |w| {
                let (a, b) = (w[0], w[1]);
                (
                    i,
                    [
                        a.0.min(b.0),
                        a.1.min(b.1),
                        (b.0 - a.0).abs().max(1.),
                        (b.1 - a.1).abs().max(1.),
                    ],
                )
            })
        })
        .collect();
    let mut charge = |count| {
        work = work
            .checked_sub(count)
            .ok_or("mmdc: E_LIMIT: Render work budget exceeded\n")?;
        Ok::<_, String>(())
    };
    for (i, e) in edges.iter().enumerate() {
        for (slot, label) in [
            (Slot::Center, e.3.as_ref()),
            (Slot::Source, endpoints.get(&(i, Slot::Source))),
            (Slot::Target, endpoints.get(&(i, Slot::Target))),
        ] {
            let Some(label) = label else {
                continue;
            };
            if slot != Slot::Center && label.lines.iter().all(|l| l.is_empty()) {
                continue;
            }
            let (width, height) = (label.width, label.height);
            let path = &paths[i];
            let rect = |cx: f64, cy: f64| {
                [
                    (cx - width * 0.5 + 0.5).floor(),
                    (cy - height * 0.5 + 0.5).floor(),
                    width,
                    height,
                ]
            };
            let mut clear = |r, margin| -> Result<bool, String> {
                charge(boxes.len() + placed.len())?;
                if boxes
                    .iter()
                    .chain(placed.values())
                    .any(|&p| overlaps(r, p, margin))
                {
                    return Ok(false);
                }
                if margin == 4. {
                    charge(segments.len())?;
                    if segments
                        .iter()
                        .any(|&(j, s)| j != i && overlaps(r, s, margin))
                    {
                        return Ok(false);
                    }
                }
                Ok(true)
            };
            let end_segment;
            let path = if slot == Slot::Center {
                path.as_slice()
            } else {
                let (a, b) = if slot == Slot::Source {
                    (path[0], path[1])
                } else {
                    (path[path.len() - 1], path[path.len() - 2])
                };
                let (dx, dy) = (b.0 - a.0, b.1 - a.1);
                let len = dx.hypot(dy).max(1.);
                let (ux, uy) = (dx / len, dy / len);
                let (along, normal) = if dx.abs() < 1. {
                    (height / 2. + 4., width / 2. + 12.)
                } else {
                    (width / 2. + 6., height / 2. + 12.)
                };
                let mut found = None;
                'badge: for extra in [0., 6., 12., 18.] {
                    let dist = (along + extra).min((len - 4.).max(along));
                    for side in [-1., 1., -1.5, 1.5, -2., 2.] {
                        let off = normal.max(28.) * side;
                        let r = rect(a.0 + ux * dist - uy * off, a.1 + uy * dist + ux * off);
                        if clear(r, 4.)? {
                            found = Some(r);
                            break 'badge;
                        }
                    }
                }
                if let Some(r) = found {
                    placed.insert((i, slot), r);
                    continue;
                }
                end_segment = [a, b];
                &end_segment
            };
            let mut spans: Vec<_> = path
                .windows(2)
                .enumerate()
                .map(|(j, w)| {
                    let (a, b) = (w[0], w[1]);
                    (j, a, b, (b.0 - a.0).hypot(b.1 - a.1))
                })
                .collect();
            let last = spans.len() - 1;
            // Prefer the terminal segment, then longer segments. Interior segments
            // of at least 32px precede equally long end segments.
            spans.sort_by(|a, b| {
                (b.0 == last)
                    .cmp(&(a.0 == last))
                    .then_with(|| b.3.total_cmp(&a.3))
                    .then_with(|| (b.0 != 0 && b.3 >= 32.).cmp(&(a.0 != 0 && a.3 >= 32.)))
            });
            let mid =
                |a: Point, b: Point, t: f64| rect(a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
            let mut best = mid(spans[0].1, spans[0].2, 0.5);
            'search: for margin in [4., 2.] {
                for &(_, a, b, len) in &spans {
                    if len < 1. {
                        continue;
                    }
                    for t in [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8] {
                        let r = mid(a, b, t);
                        if !clear(r, margin)? {
                            continue;
                        }
                        best = r;
                        break 'search;
                    }
                }
            }
            placed.insert((i, slot), best);
        }
    }
    let id = |(i, slot): (usize, Slot)| format!("{}:{}", edge_id(i), slot.suffix());
    for (&key, &r) in &placed {
        charge(nodes.len())?;
        if let Some(j) = boxes[..nodes.len()]
            .iter()
            .position(|&n| overlaps(r, n, -0.5))
        {
            return Err(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 2 (label collision): pill '{}' overlaps node '{}'\n",
                id(key),
                nodes[j].id
            ));
        }
    }
    for (idx, (&key, &r)) in placed.iter().enumerate() {
        charge(placed.len() - idx - 1)?;
        if let Some((&other, _)) = placed
            .range((std::ops::Bound::Excluded(key), std::ops::Bound::Unbounded))
            .find(|&(_, p)| overlaps(r, *p, -0.5))
        {
            return Err(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 2 (pill collision): '{}' overlaps '{}'\n",
                id(key),
                id(other)
            ));
        }
    }
    Ok(placed)
}
