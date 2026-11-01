// Rank and align nodes, keeping the members of each subgraph together.
use super::{
    Edge, Group, Node,
    groups::{ancestors, crossings},
};

pub(super) fn place(
    nodes: &mut [Node],
    edges: &[Edge],
    groups: &[Group],
    horizontal: bool,
    reverse: bool,
    work: usize,
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
    if !groups.is_empty() {
        let depth = groups.iter().map(|g| g.depth).max()?;
        if groups
            .len()
            .saturating_mul(nodes.len() + edges.len())
            .saturating_mul(depth)
            .saturating_mul(3)
            > work
        {
            return None;
        }
        let mut topo = vec![0; nodes.len()];
        for (k, &i) in post.iter().rev().enumerate() {
            topo[i] = k;
        }
        for _ in 0..3 {
            let mut adjusted = false;
            for g in 0..groups.len() {
                let inside = |i: usize| ancestors(groups, nodes[i].group).any(|p| p == g);
                let Some(pred) = edges
                    .iter()
                    .filter(|&&(a, b, _, _)| topo[a] < topo[b] && !inside(a) && inside(b))
                    .map(|e| rank[e.0])
                    .max()
                else {
                    continue;
                };
                let min = (0..nodes.len())
                    .filter(|&i| inside(i))
                    .map(|i| rank[i])
                    .min()?;
                if min <= pred {
                    let delta = pred + 1 - min;
                    for (i, r) in rank.iter_mut().enumerate() {
                        if inside(i) {
                            *r += delta;
                        }
                    }
                    adjusted = true;
                }
            }
            if !adjusted {
                break;
            }
            for &i in post.iter().rev() {
                for &j in &nodes[i].to {
                    if topo[i] < topo[j] {
                        rank[j] = rank[j].max(rank[i] + 1);
                    }
                }
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
    let mut open = vec![0; layers.len()];
    let mut close = vec![0; layers.len()];
    if !groups.is_empty() {
        for layer in &mut layers {
            layer.sort_by_key(|&i| nodes[i].group.map_or((999, 999), |g| (groups[g].root, g)));
        }
        let mut spans = vec![(usize::MAX, 0); groups.len()];
        for (i, n) in nodes.iter().enumerate() {
            for g in ancestors(groups, n.group) {
                spans[g].0 = spans[g].0.min(rank[i]);
                spans[g].1 = spans[g].1.max(rank[i]);
            }
        }
        for (lo, hi) in spans {
            if lo != usize::MAX {
                open[lo] += 1;
                close[hi] += 1;
            }
        }
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
            gaps[pair[1]] = 36
                .max(previous_diamond + 64 - (breadth[pair[0]] + breadth[pair[1]]) / 2)
                + 32 * crossings(groups, nodes[pair[0]].group, nodes[pair[1]].group);
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
    let mut intervals: Vec<_> = edges
        .iter()
        .filter_map(|(a, b, _, label)| {
            let label = label.as_ref()?;
            let needed = if horizontal {
                label.rank_width + 36.
            } else {
                label.height - 7. + 28.
            };
            (a != b).then(|| (needed, rank[*a].min(rank[*b])..rank[*a].max(rank[*b])))
        })
        .collect();
    if !intervals.is_empty() {
        intervals.sort_unstable_by(|a, b| b.0.total_cmp(&a.0));
        let mut free: std::collections::BTreeSet<_> = (0..max_rank).collect();
        for (needed, span) in intervals {
            while let Some(&r) = free.range(span.clone()).next() {
                allowance[r] = needed;
                free.remove(&r);
            }
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
    let mut cursor = f64::from(open[0] * 56);
    for (r, layer) in layers.iter().enumerate() {
        let longest = layer.iter().map(|&i| depth[i]).max().unwrap_or(0);
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
        cursor +=
            f64::from(longest + gap + close[r] * 28 + open.get(r + 1).copied().unwrap_or(0) * 58)
                + allowance[r];
    }
    // Align each node to its neighbors, keeping declaration order and a clear gap.
    let mut desired = Vec::new();
    for sweep in 0..6 {
        for rr in 0..layers.len() {
            let layer = &layers[if sweep % 2 == 0 { rr } else { max_rank - rr }];
            if layer.is_empty() {
                continue;
            }
            desired.clear();
            desired.extend(layer.iter().map(|&i| {
                let n = &nodes[i];
                let (sum, count) = n
                    .from
                    .iter()
                    .chain(&n.to)
                    .filter(|&&j| rank[i].abs_diff(rank[j]) == 1)
                    .fold((0i64, 0), |(s, count), &j| {
                        let w = if n.group.is_some() && n.group == nodes[j].group {
                            4
                        } else {
                            1
                        };
                        (s + i64::from(center[j]) * i64::from(w), count + w)
                    });
                if count == 0 {
                    center[i]
                } else {
                    (sum as f64 / f64::from(count) + 0.5).floor() as i32
                }
            }));
            let before: i64 = desired.iter().copied().map(i64::from).sum();
            for j in 1..desired.len() {
                desired[j] = desired[j].max(
                    desired[j - 1]
                        + (breadth[layer[j - 1]] + breadth[layer[j]]) / 2
                        + 36
                        + 32 * crossings(groups, nodes[layer[j - 1]].group, nodes[layer[j]].group),
                );
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
    let length = along.iter().zip(&depth).map(|(a, d)| a + d).max()? + 64;
    let width = max_cross - min_cross + 64;
    let (start, offset) = if groups.is_empty() {
        (32, 32 - min_cross)
    } else {
        (80, 80)
    };
    for (i, n) in nodes.iter_mut().enumerate() {
        let cross = offset + center[i] - breadth[i] / 2;
        (n.x, n.y) = if horizontal {
            (start + along[i], cross)
        } else {
            (cross, start + along[i])
        };
    }
    Some(if horizontal {
        (length, width)
    } else {
        (width, length)
    })
}
