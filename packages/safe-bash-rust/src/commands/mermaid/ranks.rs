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
    // Depth-first postorder excludes edges to ancestors from longest-path ranking.
    let mut state = vec![0; nodes.len()];
    let mut post = Vec::with_capacity(nodes.len());
    let mut stack = Vec::new();
    for root in 0..nodes.len() {
        if state[root] != 0 {
            continue;
        }
        state[root] = 1;
        stack.push((root, 0));
        while let Some((i, next)) = stack.last_mut() {
            if let Some(&j) = nodes[*i].to.get(*next) {
                *next += 1;
                if state[j] == 0 {
                    state[j] = 1;
                    stack.push((j, 0));
                }
            } else {
                state[*i] = 2;
                post.push(*i);
                stack.pop();
            }
        }
    }
    let mut rank = vec![0usize; nodes.len()];
    for &i in post.iter().rev() {
        state[i] = 0;
        for &j in &nodes[i].to {
            if state[j] != 0 {
                rank[j] = rank[j].max(rank[i] + 1);
            }
        }
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
            if rank[a].abs_diff(rank[b]) != 1 {
                return None;
            }
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
                let (sum, count) = n
                    .from
                    .iter()
                    .chain(&n.to)
                    .filter(|&&j| rank[i].abs_diff(rank[j]) == 1)
                    .fold((0i64, 0), |(s, n), &j| (s + i64::from(center[j]), n + 1));
                if count == 0 {
                    center[i]
                } else {
                    (sum as f64 / f64::from(count) + 0.5).floor() as i32
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
            let mut adj = nodes[i]
                .from
                .iter()
                .chain(&nodes[i].to)
                .filter(|&&j| rank[i].abs_diff(rank[j]) == 1);
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
