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
    let mut count = 0;
    for (root, node) in nodes.iter().enumerate() {
        if node.from.is_some() {
            continue;
        }
        let mut p = root;
        loop {
            count += 1;
            let Some(next) = nodes[p].to else { break };
            rank[next] = rank[p] + 1;
            p = next;
        }
    }
    if count != nodes.len() {
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
    let spans: Vec<_> = layers
        .iter()
        .map(|layer| layer.iter().map(|&i| breadth[i]).sum::<i32>() + 36 * (layer.len() as i32 - 1))
        .collect();
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
    let mut cursor = 0_f64;
    for (r, layer) in layers.iter().enumerate() {
        let longest = layer.iter().map(|&i| depth[i]).max()?;
        let mut offset = (full - spans[r] + 1) / 2;
        for &i in layer {
            along[i] = (cursor + f64::from(longest - depth[i]) / 2.).round() as i32;
            center[i] = offset + breadth[i] / 2;
            offset += breadth[i] + 36;
        }
        cursor += f64::from(longest + if horizontal { 64 } else { 56 }) + allowance[r];
    }
    // Align each node to its neighbors, keeping declaration order and a clear gap.
    let mut desired = Vec::new();
    for sweep in 0..6 {
        for rr in 0..layers.len() {
            let layer = &layers[if sweep % 2 == 0 { rr } else { max_rank - rr }];
            desired.clear();
            desired.extend(layer.iter().map(|&i| match (nodes[i].from, nodes[i].to) {
                (Some(a), Some(b)) => (center[a] + center[b] + 1) / 2,
                (Some(a), _) | (_, Some(a)) => center[a],
                _ => center[i],
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
    for (r, layer) in layers.iter().enumerate() {
        if let [i] = layer[..] {
            match (nodes[i].from, nodes[i].to) {
                (Some(a), None) | (None, Some(a)) => center[i] = center[a],
                _ if (r > 0 && layers[r - 1].len() == 1)
                    || (r < max_rank && layers[r + 1].len() == 1)
                    || (center[i] - spine).abs() <= 48 =>
                {
                    center[i] = spine
                }
                _ => {}
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
        // Non-aligned ports require orthogonal obstacle routing.
        if center[a] != center[b] {
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
