// RFC 1951 encoding with the match selection, block boundaries, and tree tie breaks
// of zlib's compression levels (the production JavaScript codec uses pako).
use super::{DIST_BASE, DIST_EXTRA, DeflateWriter, LEN_BASE, LEN_EXTRA};

type Code = (u16, u8); // reversed canonical code and bit length

fn codes(lengths: &[u8]) -> Vec<Code> {
    let mut count = [0u16; 16];
    for &len in lengths {
        if len != 0 {
            count[len as usize] += 1;
        }
    }
    let mut next = [0u16; 16];
    for i in 1..16 {
        next[i] = (next[i - 1] + count[i - 1]) << 1;
    }
    lengths
        .iter()
        .map(|&n| {
            if n == 0 {
                return (0, 0);
            }
            let code = &mut next[n as usize];
            let bits = code.reverse_bits() >> (16 - n);
            *code += 1;
            (bits, n)
        })
        .collect()
}

fn tree(hist: &[u32], max_bits: usize) -> Vec<Code> {
    let mut heap = vec![0]; // 1-based min heap, ties resolved by subtree depth
    let mut weight: Vec<_> = hist.iter().map(|&f| (f, 0u16)).collect();
    heap.extend((0..hist.len()).filter(|&i| hist[i] != 0));
    let mut max_sym = heap.last().copied().unwrap_or(0);
    while heap.len() < 3 {
        let sym = if heap.len() == 1 {
            0
        } else if max_sym < 2 {
            max_sym + 1
        } else {
            0
        };
        max_sym = max_sym.max(sym);
        heap.push(sym);
        weight[sym].0 = 1;
    }
    fn sift(heap: &mut [usize], mut i: usize, weight: &[(u32, u16)]) {
        let v = heap[i];
        while i * 2 < heap.len() {
            let mut j = i * 2;
            if j + 1 < heap.len() && weight[heap[j + 1]] <= weight[heap[j]] {
                j += 1;
            }
            if weight[v] <= weight[heap[j]] {
                break;
            }
            heap[i] = heap[j];
            i = j;
        }
        heap[i] = v;
    }
    for i in (1..heap.len().div_ceil(2)).rev() {
        sift(&mut heap, i, &weight);
    }
    let mut parent = vec![0; 2 * hist.len()];
    let mut order = Vec::new();
    while heap.len() > 2 {
        let a = heap.swap_remove(1);
        sift(&mut heap, 1, &weight);
        let b = heap[1];
        let n = weight.len();
        parent[a] = n;
        parent[b] = n;
        weight.push((weight[a].0 + weight[b].0, weight[a].1.max(weight[b].1) + 1));
        order.extend([a, b]);
        heap[1] = n;
        sift(&mut heap, 1, &weight);
    }
    let mut lens = vec![0; weight.len()];
    let mut overflow = 0i32;
    let mut counts = [0usize; 16];
    for &n in order.iter().rev() {
        let bits = lens[parent[n]] as usize + 1;
        if bits > max_bits {
            overflow += 1;
        }
        lens[n] = bits.min(max_bits) as u8;
        if n <= max_sym {
            counts[lens[n] as usize] += 1;
        }
    }
    if overflow > 0 {
        while overflow > 0 {
            let b = (1..max_bits).rev().find(|&b| counts[b] > 0).unwrap();
            counts[b] -= 1;
            counts[b + 1] += 2;
            counts[max_bits] -= 1;
            overflow -= 2;
        }
        let mut leaves = order.into_iter().filter(|&n| n <= max_sym);
        for b in (1..=max_bits).rev() {
            for _ in 0..counts[b] {
                lens[leaves.next().unwrap()] = b as u8;
            }
        }
    }
    codes(&lens[..=max_sym])
}

fn length_runs(tree: &[Code], runs: &mut Vec<(usize, Code)>) {
    let mut i = 0;
    let mut prev = 255;
    while i < tree.len() {
        let len = tree[i].1;
        let max = if len == 0 {
            138
        } else if len == prev {
            6
        } else {
            7
        };
        let count = tree[i..]
            .iter()
            .take(max)
            .take_while(|c| c.1 == len)
            .count();
        i += count;
        match (len, count) {
            (_, 1..=2) => runs.extend(std::iter::repeat_n((len as usize, (0, 0)), count)),
            (0, 3..=10) => runs.push((17, ((count - 3) as u16, 3))),
            (0, _) => runs.push((18, ((count - 11) as u16, 7))),
            (_, 3) if prev != len => runs.extend(std::iter::repeat_n((len as usize, (0, 0)), 3)),
            _ => {
                let first = usize::from(len != prev);
                if first == 1 {
                    runs.push((len as usize, (0, 0)));
                }
                runs.push((16, ((count - first - 3) as u16, 2)));
            }
        }
        prev = len;
    }
}

#[derive(Clone, Copy)]
struct Token {
    lit: usize,
    dist: usize,
    len_bits: Code,
    dist_bits: Code,
}
impl Token {
    fn literal(lit: usize) -> Self {
        Self {
            lit,
            dist: 0,
            len_bits: (0, 0),
            dist_bits: (0, 0),
        }
    }
    fn matched(len: usize, dist: usize) -> Self {
        let l = LEN_BASE.partition_point(|&v| v <= len as u16) - 1;
        let d = DIST_BASE.partition_point(|&v| v <= dist as u16) - 1;
        Self {
            lit: l + 257,
            dist: d,
            len_bits: (len as u16 - LEN_BASE[l], LEN_EXTRA[l]),
            dist_bits: (dist as u16 - DIST_BASE[d], DIST_EXTRA[d]),
        }
    }
}

const CL_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

fn block(w: &mut DeflateWriter, tokens: &[Token], raw: Option<&[u8]>, last: bool) -> bool {
    let mut lh = [0; 286];
    let mut dh = [0; 30];
    lh[256] = 1;
    let mut extras = 0;
    for t in tokens {
        lh[t.lit] += 1;
        if t.lit > 256 {
            dh[t.dist] += 1;
            extras += usize::from(t.len_bits.1 + t.dist_bits.1);
        }
    }
    let lt = tree(&lh, 15);
    let dt = tree(&dh, 15);
    let mut runs = Vec::new();
    length_runs(&lt, &mut runs);
    length_runs(&dt, &mut runs);
    let mut ch = [0; 19];
    for &(s, _) in &runs {
        ch[s] += 1;
    }
    let ct = tree(&ch, 7);
    let n_cl = CL_ORDER
        .iter()
        .rposition(|&s| ct.get(s).is_some_and(|c| c.1 != 0))
        .map_or(4, |i| (i + 1).max(4));
    let cost = |hist: &[u32], tree: &[Code]| {
        hist.iter()
            .zip(tree)
            .map(|(f, c)| *f as usize * c.1 as usize)
            .sum::<usize>()
    };
    let dynamic = (3
        + extras
        + cost(&lh, &lt)
        + cost(&dh, &dt)
        + 14
        + 3 * n_cl
        + runs
            .iter()
            .map(|&(s, c)| usize::from(ct[s].1 + c.1))
            .sum::<usize>())
    .div_ceil(8);
    let fixed = (3
        + extras
        + lh.iter()
            .enumerate()
            .map(|(s, &f)| {
                f as usize
                    * match s {
                        0..=143 => 8,
                        144..=255 => 9,
                        256..=279 => 7,
                        _ => 8,
                    }
            })
            .sum::<usize>()
        + dh.iter().sum::<u32>() as usize * 5)
        .div_ceil(8);
    if let Some(raw) = raw
        && raw.len() <= 65535
        && raw.len() + 4 <= fixed.min(dynamic)
    {
        w.bits(last as u16, 3);
        w.bits(0, (8 - w.bits) % 8);
        let n = raw.len() as u16;
        w.bytes.extend(n.to_le_bytes());
        w.bytes.extend((!n).to_le_bytes());
        w.bytes.extend(raw);
        return true;
    }
    let dyn_tree = dynamic < fixed;
    w.bits(last as u16 + if dyn_tree { 4 } else { 2 }, 3);
    if dyn_tree {
        w.bits((lt.len() - 257) as u16, 5);
        w.bits((dt.len() - 1) as u16, 5);
        w.bits((n_cl - 4) as u16, 4);
        for &s in &CL_ORDER[..n_cl] {
            w.bits(ct.get(s).map_or(0, |c| c.1 as u16), 3);
        }
        for (s, (b, n)) in runs {
            w.bits(ct[s].0, ct[s].1);
            w.bits(b, n);
        }
    }
    for t in tokens
        .iter()
        .copied()
        .chain(std::iter::once(Token::literal(256)))
    {
        if dyn_tree {
            w.bits(lt[t.lit].0, lt[t.lit].1);
        } else {
            w.symbol(t.lit as u16);
        }
        if t.lit > 256 {
            w.bits(t.len_bits.0, t.len_bits.1);
            let (b, n) = if dyn_tree {
                dt[t.dist]
            } else {
                ((t.dist as u16).reverse_bits() >> 11, 5)
            };
            w.bits(b, n);
            w.bits(t.dist_bits.0, t.dist_bits.1);
        }
    }
    false
}

pub(super) fn deflate(
    data: &[u8],
    level: u8,
    header: Vec<u8>,
    mut emit: impl FnMut(&[u8]),
) -> Vec<u8> {
    let mut w = DeflateWriter {
        bytes: header,
        pending: 0,
        bits: 0,
    };
    // Good match length, lazy match limit, early-stop length, hash chain limit.
    let (good, lazy, nice, chain) = match level {
        1 => (4, 4, 8, 4),
        2 => (4, 5, 16, 8),
        3 => (4, 6, 32, 32),
        4 => (4, 4, 16, 16),
        5 => (8, 16, 32, 32),
        7 => (8, 32, 128, 256),
        8 => (32, 128, 258, 1024),
        9 => (32, 258, 258, 4096),
        _ => (8, 16, 128, 128),
    };
    let fast = matches!(level, 1..=3);
    let mut heads = vec![0usize; 32768];
    let mut prev = vec![0usize; 32768];
    let insert = |p: usize, heads: &mut [usize], prev: &mut [usize]| {
        if p + 2 >= data.len() {
            return 0;
        }
        let h = ((usize::from(data[p]) << 10)
            ^ (usize::from(data[p + 1]) << 5)
            ^ usize::from(data[p + 2]))
            & 32767;
        let old = heads[h];
        heads[h] = p;
        prev[p & 32767] = old;
        old
    };
    let mut tokens = Vec::with_capacity(data.len().min(16383));
    let mut aligned = w.bytes.len();
    let mut sent = aligned;
    let mut p = 0;
    let mut start = 0;
    let mut window = 0;
    let mut pending = false;
    let mut len = 2;
    let mut distance = 0;
    while p < data.len() {
        if p > window + 65536 - 262 {
            window += 32768;
        }
        let lookahead = data.len() - p;
        let mut candidate = insert(p, &mut heads, &mut prev);
        let old_len = len;
        let old_dist = distance;
        len = 2;
        if candidate > window && p - candidate <= 32506 && old_len < lazy {
            let max = (data.len() - p).min(258);
            let limit = p.saturating_sub(32506).max(window);
            let mut best = old_len;
            for _ in 0..if old_len >= good { chain / 4 } else { chain } {
                if best >= max {
                    break;
                }
                if data[p + best] == data[candidate + best]
                    && data[p..p + 2] == data[candidate..candidate + 2]
                {
                    let mut n = 2;
                    while n < max && data[p + n] == data[candidate + n] {
                        n += 1;
                    }
                    if n > best {
                        best = n;
                        len = n;
                        distance = p - candidate;
                        if n >= nice {
                            break;
                        }
                    }
                }
                candidate = prev[candidate & 32767];
                if candidate <= limit {
                    break;
                }
            }
            if !fast && len == 3 && distance > 4096 {
                len = 2;
            }
        }
        let end = if fast {
            if len >= 3 {
                tokens.push(Token::matched(len, distance));
                if len <= lazy && data.len() - (p + len) >= 3 {
                    for at in p + 1..p + len {
                        insert(at, &mut heads, &mut prev);
                    }
                }
                p += len;
            } else {
                tokens.push(Token::literal(data[p] as usize));
                p += 1;
            }
            len = 2;
            p
        } else if old_len >= 3 && len <= old_len {
            tokens.push(Token::matched(old_len, old_dist));
            for at in p + 1..p + old_len - 1 {
                insert(at, &mut heads, &mut prev);
            }
            p += old_len - 1;
            pending = false;
            len = 2;
            p
        } else if pending {
            tokens.push(Token::literal(data[p - 1] as usize));
            p += 1;
            p - 1
        } else {
            pending = true;
            p += 1;
            continue;
        };
        if tokens.len() == 16383 {
            let stored = block(
                &mut w,
                &tokens,
                (start >= window).then(|| &data[start..end]),
                false,
            );
            // zlib keeps up to 16 pending bits between compressed blocks. A
            // stored block aligns the stream and flushes all its bytes.
            let flushed = if stored {
                aligned = w.bytes.len();
                aligned
            } else {
                let bits = (w.bytes.len() - aligned) as u64 * 8 + u64::from(w.bits);
                aligned + (((bits - 1) / 16) * 2) as usize
            };
            if lookahead >= 262 {
                emit(&w.bytes[sent..flushed]);
                sent = flushed;
            }
            start = end;
            tokens.clear();
        }
    }
    if pending {
        tokens.push(Token::literal(data[p - 1] as usize));
    }
    block(
        &mut w,
        &tokens,
        (start >= window).then(|| &data[start..]),
        true,
    );
    if w.bits > 0 {
        w.bytes.push(w.pending as u8);
    }
    w.bytes
}
