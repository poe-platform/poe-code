// Rust adaptation of the coding algorithm in bzip2 1.0.8; see LICENSE.BZIP2.
// BZip2 codes each run of 50 MTF symbols with one of up to six Huffman tables.
use super::MsbBitWriter;

fn lengths(freq: &[u32], out: &mut [u8]) {
    let n = freq.len();
    let mut weight = vec![0; 2 * n - 1];
    let mut parent = vec![0; 2 * n - 1];
    let mut heap = Vec::with_capacity(n);
    for (w, &count) in weight.iter_mut().zip(freq) {
        *w = count.max(1) << 8;
    }
    loop {
        heap.clear();
        for node in 0..2 * n - 1 {
            // Internal nodes combine the two lightest subtrees. The low byte
            // of the weight breaks equal frequencies by tree depth.
            if node >= n {
                let mut combined = 0;
                let mut depth = 0;
                for _ in 0..2 {
                    let child = heap.swap_remove(0);
                    parent[child] = node;
                    combined += weight[child] & !255;
                    depth = depth.max(weight[child] & 255);
                    let mut k = 0;
                    while 2 * k + 1 < heap.len() {
                        let mut j = 2 * k + 1;
                        if j + 1 < heap.len() && weight[heap[j + 1]] < weight[heap[j]] {
                            j += 1;
                        }
                        if weight[heap[k]] < weight[heap[j]] {
                            break;
                        }
                        heap.swap(k, j);
                        k = j;
                    }
                }
                weight[node] = combined | (depth + 1);
            }
            let mut k = heap.len();
            heap.push(node);
            while k > 0 {
                let p = (k - 1) / 2;
                if weight[node] >= weight[heap[p]] {
                    break;
                }
                heap.swap(k, p);
                k = p;
            }
        }
        // Parents are always created after their children. Reuse the parent
        // array for depths when walking back from the root.
        parent[2 * n - 2] = 0;
        for i in (0..2 * n - 2).rev() {
            parent[i] = parent[parent[i]] + 1;
        }
        if parent[..n].iter().all(|&d| d <= 17) {
            for (len, &depth) in out.iter_mut().zip(&parent) {
                *len = depth as u8;
            }
            return;
        }
        for w in &mut weight[..n] {
            *w = (1 + (*w >> 9)) << 8;
        }
    }
}

pub(super) fn write_symbols(writer: &mut MsbBitWriter, symbols: &[u16], alphabet: usize) {
    let groups = match symbols.len() {
        0..200 => 2,
        200..600 => 3,
        600..1200 => 4,
        1200..2400 => 5,
        _ => 6,
    };
    let mut lens = vec![vec![15; alphabet]; groups];
    let mut frequencies = vec![0; alphabet];
    for &s in symbols {
        frequencies[s as usize] += 1;
    }
    let mut left = symbols.len();
    let mut start = 0;
    for t in (0..groups).rev() {
        let target = left / (t + 1);
        let mut count = 0;
        let mut end = start;
        while count < target && end < alphabet {
            count += frequencies[end];
            end += 1;
        }
        if end > start + 1 && t > 0 && (groups - 1 - t) % 2 == 1 {
            end -= 1;
            count -= frequencies[end];
        }
        lens[t][start..end].fill(0);
        start = end;
        left -= count;
    }

    // Refine code lengths using just the chunks assigned to each table.
    let mut selectors = Vec::with_capacity(symbols.len().div_ceil(50));
    let mut counts = vec![vec![0u32; alphabet]; groups];
    for _ in 0..4 {
        for f in &mut counts {
            f.fill(0);
        }
        selectors.clear();
        for chunk in symbols.chunks(50) {
            let table = (0..groups)
                .min_by_key(|&t| {
                    chunk
                        .iter()
                        .map(|&s| u32::from(lens[t][s as usize]))
                        .sum::<u32>()
                })
                .unwrap();
            selectors.push(table);
            for &s in chunk {
                counts[table][s as usize] += 1;
            }
        }
        for (freq, len) in counts.iter().zip(&mut lens) {
            lengths(freq, len);
        }
    }

    writer.write_bits(groups as u64, 3);
    writer.write_bits(selectors.len() as u64, 15);
    let mut order: Vec<usize> = (0..groups).collect();
    for &table in &selectors {
        let pos = order.iter().position(|&t| t == table).unwrap();
        writer.write_bits((1u64 << (pos + 1)) - 2, (pos + 1) as u8);
        order[..=pos].rotate_right(1);
    }
    let mut codes = vec![vec![0u32; alphabet]; groups];
    for (len, code) in lens.iter().zip(&mut codes) {
        let mut current = len[0];
        writer.write_bits(current.into(), 5);
        for &target in len {
            while current < target {
                writer.write_bits(2, 2);
                current += 1;
            }
            while current > target {
                writer.write_bits(3, 2);
                current -= 1;
            }
            writer.write_bits(0, 1);
        }
        let mut next = 0;
        for bits in 1..=*len.iter().max().unwrap() {
            for (slot, &l) in code.iter_mut().zip(len) {
                if l == bits {
                    *slot = next;
                    next += 1;
                }
            }
            next <<= 1;
        }
    }
    for (chunk, table) in symbols.chunks(50).zip(selectors) {
        for &s in chunk {
            let i = usize::from(s);
            writer.write_bits(codes[table][i].into(), lens[table][i]);
        }
    }
}

// Equal rotations have identical last bytes but their order determines the
// primary index in the block header. Preserve bzip2's fallback-sort tie order.
fn sort_bucket(mut bucket: &mut [usize], rank: &[usize], seed: &mut usize) {
    while bucket.len() > 10 {
        *seed = (*seed * 7621 + 1) % 32768;
        let n = bucket.len();
        let pivot = rank[bucket[match *seed % 3 {
            0 => 0,
            1 => (n - 1) / 2,
            _ => n - 1,
        }]];
        let (mut i, mut j) = (0, n);
        let (mut left, mut right) = (0, n);
        loop {
            while i < j && rank[bucket[i]] <= pivot {
                if rank[bucket[i]] == pivot {
                    bucket.swap(i, left);
                    left += 1;
                }
                i += 1;
            }
            while i < j && rank[bucket[j - 1]] >= pivot {
                j -= 1;
                if rank[bucket[j]] == pivot {
                    right -= 1;
                    bucket.swap(j, right);
                }
            }
            if i == j {
                break;
            }
            j -= 1;
            bucket.swap(i, j);
            i += 1;
        }
        if left == right {
            return;
        }
        let low = i - left;
        let high = right - j;
        let span = low.min(left);
        for k in 0..span {
            bucket.swap(k, i - span + k);
        }
        let span = high.min(n - right);
        for k in 0..span {
            bucket.swap(i + k, n - span + k);
        }
        let (a, b) = bucket.split_at_mut(low);
        let b = &mut b[n - low - high..];
        // Process the shorter side first, bounding recursion and preserving
        // the sequence of pivots used for this bucket.
        if low <= high {
            sort_bucket(a, rank, seed);
            bucket = b;
        } else {
            sort_bucket(b, rank, seed);
            bucket = a;
        }
    }
    for gap in [4, 1] {
        for i in (0..bucket.len().saturating_sub(gap)).rev() {
            let entry = bucket[i];
            let mut j = i;
            while j + gap < bucket.len() && rank[entry] > rank[bucket[j + gap]] {
                bucket[j] = bucket[j + gap];
                j += gap;
            }
            bucket[j] = entry;
        }
    }
}

pub(super) fn rotations(block: &[u8]) -> Vec<usize> {
    let n = block.len();
    let mut counts = [0; 256];
    for &b in block {
        counts[usize::from(b)] += 1;
    }
    let mut end = 0;
    for k in &mut counts {
        end += *k;
        *k = end;
    }
    let mut order = vec![0; n];
    for (i, &b) in block.iter().enumerate() {
        let slot = &mut counts[usize::from(b)];
        *slot -= 1;
        order[*slot] = i;
    }
    let mut heads = vec![false; n + 1];
    for i in counts {
        heads[i] = true;
    }
    heads[n] = true;
    let mut rank = vec![0; n];
    let mut width = 1;
    while width < n {
        // Rank the second half of every doubled prefix using the buckets
        // from the previous pass. Only tied prefixes need another sort.
        let mut class = 0;
        for (i, &pos) in order.iter().enumerate() {
            if heads[i] {
                class = i;
            }
            rank[if pos < width {
                pos + (n - width)
            } else {
                pos - width
            }] = class;
        }
        let mut split = false;
        let mut start = 0;
        while start < n {
            let mut end = start + 1;
            while !heads[end] {
                end += 1;
            }
            if end > start + 1 {
                sort_bucket(&mut order[start..end], &rank, &mut 0);
                for i in start + 1..end {
                    if rank[order[i - 1]] != rank[order[i]] {
                        heads[i] = true;
                        split = true;
                    }
                }
            }
            start = end;
        }
        if !split {
            break;
        }
        width *= 2;
    }
    order
}
