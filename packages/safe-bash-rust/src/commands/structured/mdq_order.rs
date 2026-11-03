// mdq compares two numeric IDs as numbers but any other pair as strings.
// For example, "2" < "10" < "11a" < "2". On mixed IDs, the comparison
// sequence is observable: use the same natural runs and merges as V8.
pub(super) fn sort<T: Copy>(items: &mut [T], less: impl Fn(T, T) -> bool) {
    let mut min = items.len();
    let mut rounding = 0;
    while min >= 64 {
        rounding |= min & 1;
        min >>= 1;
    }
    min += rounding;
    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut threshold = 7;
    let mut start = 0;
    while start < items.len() {
        let mut end = (start + 2).min(items.len());
        if end == start + 2 {
            let descending = less(items[start + 1], items[start]);
            while end < items.len() && less(items[end], items[end - 1]) == descending {
                end += 1;
            }
            if descending {
                items[start..end].reverse();
            }
        }
        while end < items.len().min(start + min) {
            let pivot = items[end];
            let (mut lo, mut hi) = (start, end);
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                if less(pivot, items[mid]) {
                    hi = mid;
                } else {
                    lo = mid + 1;
                }
            }
            items.copy_within(lo..end, lo + 1);
            items[lo] = pivot;
            end += 1;
        }
        runs.push((start, end - start));
        start = end;
        while runs.len() >= 2 {
            let mut i = runs.len() - 2;
            let invariant = |j: usize| j < 2 || runs[j - 2].1 > runs[j - 1].1 + runs[j].1;
            if !invariant(i + 1) || !invariant(i) {
                if i > 0 && runs[i - 1].1 < runs[i + 1].1 {
                    i -= 1;
                }
            } else if runs[i].1 > runs[i + 1].1 {
                break;
            }
            merge_at(items, &mut runs, i, &mut threshold, &less);
        }
    }
    while runs.len() >= 2 {
        let mut i = runs.len() - 2;
        if i > 0 && runs[i - 1].1 < runs[i + 1].1 {
            i -= 1;
        }
        merge_at(items, &mut runs, i, &mut threshold, &less);
    }
}

// Find the first false comparison, probing exponentially from the merge end.
fn gallop<T: Copy>(a: &[T], from_end: bool, reversed: bool, before: impl Fn(T) -> bool) -> usize {
    if a.is_empty() {
        return 0;
    }
    let (mut lo, mut hi) = (0, a.len());
    let mut step = 1;
    if from_end {
        if before(a[hi - 1]) {
            return hi;
        }
        let last = hi - 1;
        hi = last;
        while step <= last {
            let at = last - step;
            if before(a[at]) {
                lo = at + 1;
                break;
            }
            hi = at;
            step = step * 2 + 1;
        }
    } else {
        if !before(a[0]) {
            return 0;
        }
        lo = 1;
        while step < a.len() {
            if !before(a[step]) {
                hi = step;
                break;
            }
            lo = step + 1;
            step = step * 2 + 1;
        }
    }
    while lo < hi {
        let mid = lo + (hi - lo - usize::from(reversed)) / 2;
        if before(a[mid]) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

fn merge_at<T: Copy>(
    items: &mut [T],
    runs: &mut Vec<(usize, usize)>,
    i: usize,
    threshold: &mut usize,
    less: &impl Fn(T, T) -> bool,
) {
    let (start, n) = runs[i];
    let (mid, m) = runs.remove(i + 1);
    runs[i].1 += m;
    let begin = start + gallop(&items[start..mid], false, false, |a| !less(items[mid], a));
    if begin == mid {
        return;
    }
    let end = mid
        + gallop(&items[mid..mid + m], true, false, |b| {
            less(b, items[mid - 1])
        });
    if end == mid {
        return;
    }
    let reversed = mid - begin > end - mid;
    let mut data = items[begin..end].to_vec();
    if reversed {
        data.reverse();
    }
    let split = if reversed {
        end - mid
    } else {
        n - (begin - start)
    };
    let (mut a, mut b) = data.split_at(split);
    let out = &mut items[begin..end];
    let mut at = 0;
    let first = |a, b| if reversed { less(b, a) } else { !less(b, a) };
    let mut emit = |slice: &[T]| {
        out[at..at + slice.len()].copy_from_slice(slice);
        at += slice.len();
    };
    emit(&b[..1]);
    b = &b[1..];
    'merge: while a.len() > 1 && !b.is_empty() {
        let (mut wins_a, mut wins_b) = (0, 0);
        loop {
            if first(a[0], b[0]) {
                emit(&a[..1]);
                a = &a[1..];
                wins_a += 1;
                wins_b = 0;
                if a.len() == 1 {
                    break 'merge;
                }
            } else {
                emit(&b[..1]);
                b = &b[1..];
                wins_b += 1;
                wins_a = 0;
                if b.is_empty() {
                    break 'merge;
                }
            }
            if wins_a.max(wins_b) >= *threshold {
                break;
            }
        }
        *threshold += 1;
        loop {
            *threshold = threshold.saturating_sub(1).max(1);
            let mut longest = 0;
            for take_a in [!reversed, reversed] {
                let count = if take_a {
                    let n = gallop(a, false, reversed, |v| first(v, b[0]));
                    emit(&a[..n]);
                    a = &a[n..];
                    if a.len() <= 1 {
                        break 'merge;
                    }
                    emit(&b[..1]);
                    b = &b[1..];
                    if b.is_empty() {
                        break 'merge;
                    }
                    n
                } else {
                    let n = gallop(b, false, reversed, |v| !first(a[0], v));
                    emit(&b[..n]);
                    b = &b[n..];
                    if b.is_empty() {
                        break 'merge;
                    }
                    emit(&a[..1]);
                    a = &a[1..];
                    if a.len() == 1 {
                        break 'merge;
                    }
                    n
                };
                longest = longest.max(count);
            }
            if longest < 7 {
                break;
            }
        }
        *threshold += 1;
    }
    emit(b);
    emit(a);
    if reversed {
        out.reverse();
    }
}
