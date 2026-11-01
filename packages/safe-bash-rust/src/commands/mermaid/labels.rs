use super::{Edge, Group, Node, route::Point};

type Rect = [f64; 4];
pub(super) fn overlaps([x, y, w, h]: Rect, [a, b, c, d]: Rect, margin: f64) -> bool {
    x - margin < a + c && x + w + margin > a && y - margin < b + d && y + h + margin > b
}

pub(super) fn place(
    nodes: &[Node],
    groups: &[Group],
    edges: &[Edge],
    paths: &[Vec<Point>],
    edge_id: fn(usize) -> String,
    mut work: usize,
) -> Result<Vec<Option<Rect>>, String> {
    let mut placed = vec![None; edges.len()];
    if edges.iter().all(|e| e.3.is_none()) {
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
    let mut labels: Vec<(usize, Rect)> = Vec::new();
    for (i, label) in edges
        .iter()
        .enumerate()
        .filter_map(|(i, e)| Some((i, e.3.as_ref()?)))
    {
        let (width, height) = (label.width, label.height);
        let path = &paths[i];
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
        let rect = |a: Point, b: Point, t: f64| {
            [
                (a.0 + (b.0 - a.0) * t - width * 0.5 + 0.5).floor(),
                (a.1 + (b.1 - a.1) * t - height * 0.5 + 0.5).floor(),
                width,
                height,
            ]
        };
        let mut best = rect(spans[0].1, spans[0].2, 0.5);
        'search: for margin in [4., 2.] {
            for &(_, a, b, len) in &spans {
                if len < 1. {
                    continue;
                }
                for t in [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8] {
                    let r = rect(a, b, t);
                    charge(boxes.len() + labels.len())?;
                    if boxes.iter().any(|&n| overlaps(r, n, margin))
                        || labels.iter().any(|&(_, p)| overlaps(r, p, margin))
                    {
                        continue;
                    }
                    if margin == 4. {
                        charge(segments.len())?;
                        if segments
                            .iter()
                            .any(|&(j, s)| j != i && overlaps(r, s, margin))
                        {
                            continue;
                        }
                    }
                    best = r;
                    break 'search;
                }
            }
        }
        charge(boxes.len())?;
        if let Some(j) = boxes[..nodes.len()]
            .iter()
            .position(|&n| overlaps(best, n, -0.5))
        {
            return Err(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 2 (label collision): pill '{}:label' overlaps node '{}'\n",
                edge_id(i),
                nodes[j].id
            ));
        }
        placed[i] = Some(best);
        labels.push((i, best));
    }
    for (k, &(i, r)) in labels.iter().enumerate() {
        charge(labels.len() - k - 1)?;
        if let Some(&(j, _)) = labels[k + 1..].iter().find(|&&(_, p)| overlaps(r, p, -0.5)) {
            return Err(format!(
                "mmdc: E_LIMIT: Scene geometry verification failed: Invariant 2 (pill collision): '{}:label' overlaps '{}:label'\n",
                edge_id(i),
                edge_id(j)
            ));
        }
    }
    Ok(placed)
}
