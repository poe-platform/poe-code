// Coordinates for ungrouped flowchart ranks, in source order within each rank.
use super::{Node, measure};

pub(super) fn place(
    nodes: &mut [Node],
    edges: &[(usize, usize, &str, &str)],
    horizontal: bool,
    reverse: bool,
) -> Option<(i32, i32)> {
    if nodes.is_empty() {
        return Some((184, 144));
    }
    let mut rank = vec![0; nodes.len()];
    let mut pending: Vec<_> = nodes.iter().map(|n| n.from.len()).collect();
    let mut ready: Vec<_> = (0..nodes.len()).filter(|&i| pending[i] == 0).collect();
    let mut count = 0;
    while let Some(i) = ready.pop() {
        count += 1;
        for &child in &nodes[i].to {
            rank[child] = rank[child].max(rank[i] + 1);
            pending[child] -= 1;
            if pending[child] == 0 {
                ready.push(child);
            }
        }
    }
    if count != nodes.len()
        || edges
            .iter()
            .any(|&(a, b, _, _)| a != b && rank[b] != rank[a] + 1)
    {
        return None;
    }
    let max_rank = *rank.iter().max()?;
    if reverse {
        for r in &mut rank {
            *r = max_rank - *r;
        }
    }
    let mut layers = vec![Vec::new(); max_rank + 1];
    for (i, &r) in rank.iter().enumerate() {
        layers[r].push(i);
    }
    let (breadth, depth): (Vec<i32>, Vec<i32>) = nodes
        .iter()
        .map(|n| if horizontal { (n.h, n.w) } else { (n.w, n.h) })
        .unzip();
    let mut gaps = vec![0; nodes.len()];
    let mut spans = Vec::new();
    let mut previous_diamond = 0;
    for layer in &layers {
        for pair in layer.windows(2) {
            gaps[pair[1]] =
                36.max(previous_diamond + 64 - (breadth[pair[0]] + breadth[pair[1]]) / 2);
        }
        spans.push(layer.iter().map(|&i| breadth[i] + gaps[i]).sum::<i32>());
        previous_diamond = layer
            .iter()
            .filter(|&&i| nodes[i].shape == super::Shape::Diamond)
            .map(|&i| breadth[i])
            .max()
            .unwrap_or(0);
    }
    let full = *spans.iter().max()?.max(&200);
    let mut center = vec![0; nodes.len()];
    let mut along = vec![0; nodes.len()];
    let mut allowance = vec![0_f64; layers.len()];
    for &(a, b, _, label) in edges {
        if !label.is_empty() {
            let r = rank[a].min(rank[b]);
            allowance[r] = allowance[r].max(if horizontal {
                measure(label, 11.5, false) + 36.
            } else {
                44.
            });
        }
    }
    let degree: Vec<_> = layers
        .iter()
        .map(|layer| {
            layer
                .iter()
                .map(|&i| nodes[i].from.len().max(nodes[i].to.len()))
                .max()
                .unwrap_or(0)
        })
        .collect();
    let mut cursor = 0_f64;
    for (r, layer) in layers.iter().enumerate() {
        let longest = layer.iter().map(|&i| depth[i]).max()?;
        let mut offset = (full - spans[r] + 1) / 2;
        for &i in layer {
            along[i] = (cursor + f64::from(longest - depth[i]) / 2.).round() as i32;
            offset += gaps[i];
            center[i] = offset + breadth[i] / 2;
            offset += breadth[i];
        }
        let mut gap = if horizontal { 64 } else { 56 };
        let d = degree[r].max(degree.get(r + 1).copied().unwrap_or(0));
        if d > 4 {
            gap = gap.max(((d + 1) * 16 + 32) as i32);
        }
        cursor += f64::from(longest + gap) + allowance[r];
    }
    // Align each node to its neighbors, keeping declaration order and a clear gap.
    let mut desired = Vec::new();
    for sweep in 0..6 {
        for rr in 0..layers.len() {
            let layer = &layers[if sweep % 2 == 0 { rr } else { max_rank - rr }];
            desired.clear();
            desired.extend(layer.iter().map(|&i| {
                let n = &nodes[i];
                let count = n.from.len() + n.to.len();
                if count == 0 {
                    center[i]
                } else {
                    let sum: i64 = n
                        .from
                        .iter()
                        .chain(&n.to)
                        .map(|&j| i64::from(center[j]))
                        .sum();
                    (sum as f64 / count as f64 + 0.5).floor() as i32
                }
            }));
            let before: i64 = desired.iter().copied().map(i64::from).sum();
            for j in 1..desired.len() {
                desired[j] = desired[j]
                    .max(desired[j - 1] + (breadth[layer[j - 1]] + breadth[layer[j]]) / 2 + 36);
            }
            let after: i64 = desired.iter().copied().map(i64::from).sum();
            let shift = ((before - after) as f64 / layer.len() as f64 + 0.5).floor() as i32;
            for (&i, c) in layer.iter().zip(&desired) {
                center[i] = c + shift;
            }
        }
    }
    let spine = (full + 1) / 2;
    for ranks in layers.windows(3) {
        if let ([a], layer, [b]) = (ranks[0].as_slice(), &ranks[1], ranks[2].as_slice())
            && layer.len() > 1
        {
            let mut anchors = layer.iter().filter(|&&i| {
                let n = &nodes[i];
                (n.from.contains(a) && n.to.contains(b)) || (n.to.contains(a) && n.from.contains(b))
            });
            if let Some(&i) = anchors.next()
                && anchors.next().is_none()
            {
                let shift = spine - center[i];
                for &k in layer {
                    center[k] += shift;
                }
            }
        }
    }
    for (r, layer) in layers.iter().enumerate() {
        if let [i] = layer[..] {
            let mut adj = nodes[i].from.iter().chain(&nodes[i].to);
            if let Some(&a) = adj.next()
                && adj.all(|&other| other == a)
            {
                center[i] = center[a];
            } else if (r > 0 && layers[r - 1].len() == 1)
                || (r < max_rank && layers[r + 1].len() == 1)
                || (center[i] - spine).abs() <= 48
            {
                center[i] = spine;
            }
        }
    }
    let mut min_cross = i32::MAX;
    let mut max_cross = i32::MIN;
    for i in 0..nodes.len() {
        min_cross = min_cross.min(center[i] - breadth[i] / 2);
        max_cross = max_cross.max(center[i] + breadth[i] / 2);
    }
    for &(a, b, _, label) in edges {
        if !label.is_empty() && center[a] != center[b] {
            return None;
        }
        if !label.is_empty() {
            let pill = if horizontal {
                23
            } else {
                super::pill_style(label).3 as i32
            };
            let start = center[a] - pill / 2;
            min_cross = min_cross.min(start);
            max_cross = max_cross.max(start + pill);
        }
    }
    let length = along.iter().zip(&depth).map(|(a, d)| a + d).max()? + 64;
    let width = max_cross - min_cross + 64;
    for (i, n) in nodes.iter_mut().enumerate() {
        let cross = 32 + center[i] - breadth[i] / 2 - min_cross;
        (n.x, n.y) = if horizontal {
            (32 + along[i], cross)
        } else {
            (cross, 32 + along[i])
        };
    }
    Some(if horizontal {
        (length, width)
    } else {
        (width, length)
    })
}
