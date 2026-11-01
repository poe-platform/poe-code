use super::{
    Node, Shape, Statement, esc, measure,
    raster::{BoxStyle, Paint},
    route::Point,
    scanner, snap,
};
use std::fmt::Write;

#[derive(Default)]
pub(super) struct Group {
    pub id: String,
    pub label: String,
    pub parent: Option<usize>,
    pub depth: usize,
    pub root: usize,
    pub bounds: [i32; 4],
}
impl Group {
    pub fn header(&self) -> [f64; 4] {
        let [x, y, w, _] = self.bounds;
        [x.into(), y.into(), w.into(), 32.]
    }
    pub fn parse(
        text: &str,
        stmt: &Statement,
        index: usize,
        groups: &[Self],
        parent: Option<usize>,
        auto: &mut usize,
    ) -> Result<Self, String> {
        let rest = text["subgraph".len()..].trim();
        if rest.is_empty() {
            return Err(stmt.error(
                "E_SYNTAX",
                text,
                "Subgraph declaration requires an identifier or title",
            ));
        }
        let (id, raw) = if rest.starts_with(['"', '\'']) {
            *auto += 1;
            (format!("subgraph_{auto}"), rest)
        } else if let Some((id, label)) = rest.split_once('[')
            && !id.is_empty()
            && let Some(label) = label.strip_suffix(']')
        {
            (id.trim().into(), label)
        } else {
            let id = rest.split_ascii_whitespace().next().unwrap();
            let tail = rest[id.len()..].trim();
            (id.into(), if tail.is_empty() { id } else { tail })
        };
        Ok(Self {
            id,
            label: scanner::label(raw, stmt, text)?,
            parent,
            root: parent.map_or(index, |p| groups[p].root),
            depth: parent.map_or(1, |p| groups[p].depth + 1),
            bounds: [0; 4],
        })
    }

    pub fn paint(
        &self,
        idx: usize,
        prefix: &str,
        theme: &super::config::Theme,
        shift: (i32, i32),
        paths: &[Vec<Point>],
        paint: &mut Vec<Paint>,
    ) -> String {
        let [gx, gy, w, h] = self.bounds;
        let (x, y) = (gx + shift.0, gy + shift.1);
        let (fill, fill_rgba) = theme.color("groupSurface");
        let (header, header_rgba) = theme.color("groupHeaderSurface");
        let (border, stroke) = theme.color("groupBorder");
        let (color, text_rgba) = theme.color("text");
        let font = &theme.font;
        paint.push(Paint::Box {
            bounds: [x.into(), y.into(), w.into(), h.into()],
            style: BoxStyle {
                radius: 12.,
                fill: fill_rgba,
                header: Some((32., header_rgba)),
                border: stroke,
                thickness: 1.25,
            },
            shape: Shape::Rounded,
            shadow: None,
        });
        let bottom = y + 32;
        let right = x + w;
        paint.push(Paint::Path {
            points: vec![(x.into(), bottom.into()), (right.into(), bottom.into())],
            fill: None,
            stroke,
            width: 1.,
            dashed: false,
        });
        let clip = format!("{prefix}mmdc-group-clip-{idx}");
        let mut el = format!(
            r#"<g class="mmdc-group" data-id="{}"><defs><clipPath id="{clip}"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12"/></clipPath></defs><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}"/><rect x="{x}" y="{y}" width="{w}" height="32" fill="{header}" clip-path="url(#{clip})"/><line x1="{x}" y1="{bottom}" x2="{right}" y2="{bottom}" stroke="{border}" stroke-width="1"/><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="none" stroke="{border}" stroke-width="1.25"/>"#,
            esc(&self.id)
        );
        if !self.label.is_empty() {
            let mut lx = f64::from(x + 16);
            let lw = measure(&self.label, 12., true);
            for segment in paths.iter().flat_map(|p| p.windows(2)) {
                let [(sx, sy), (ex, ey)] = segment else {
                    unreachable!()
                };
                if (sx - ex).abs() < 1.5
                    && sy.min(*ey) <= f64::from(bottom)
                    && sy.max(*ey) >= f64::from(y)
                    && (lx - 8. ..=lx + lw + 8.).contains(sx)
                {
                    lx = (sx + 14.5).floor();
                }
            }
            let ly = y + 21;
            write!(el,r#"<text x="{lx}" y="{ly}" fill="{color}" font-family="{font}" font-size="12" font-weight="600" letter-spacing="0.025em" text-anchor="start">{}</text>"#,esc(&self.label)).unwrap();
            paint.push(Paint::Text {
                start: lx,
                baseline: ly.into(),
                size: 12.,
                weight: 600,
                color: text_rgba,
                text: self.label.clone(),
            });
        }
        el.push_str("\n</g>");
        el
    }
}

pub(super) fn ancestors(groups: &[Group], id: Option<usize>) -> impl Iterator<Item = usize> + '_ {
    std::iter::successors(id, |i| groups[*i].parent)
}
pub(super) fn crossings(groups: &[Group], mut a: Option<usize>, mut b: Option<usize>) -> i32 {
    let mut n = 0;
    while a != b {
        if a.map_or(0, |i| groups[i].depth) >= b.map_or(0, |i| groups[i].depth) {
            a = groups[a.unwrap()].parent;
        } else {
            b = groups[b.unwrap()].parent;
        }
        n += 1;
    }
    n
}

// Fit parents around their direct children, then move overlapping sibling subtrees apart.
pub(super) fn place(
    groups: &mut [Group],
    nodes: &mut [Node],
    mut work: usize,
) -> Option<Vec<usize>> {
    if groups.is_empty() {
        return Some(Vec::new());
    }
    let mut order: Vec<_> = (0..groups.len()).collect();
    order.sort_by_key(|&i| groups[i].depth);
    let mut extents = vec![[i32::MAX, i32::MAX, i32::MIN, i32::MIN]; groups.len()];
    let include = |out: &mut [i32; 4], [x, y, w, h]: [i32; 4]| {
        out[0] = out[0].min(x);
        out[1] = out[1].min(y);
        out[2] = out[2].max(x + w);
        out[3] = out[3].max(y + h);
    };
    for n in nodes.iter() {
        if let Some(g) = n.group {
            include(&mut extents[g], [n.x, n.y, n.w, n.h]);
        }
    }
    for &i in order.iter().rev() {
        let [x, y, right, bottom] = if extents[i][0] == i32::MAX {
            [80, 80, 200, 140]
        } else {
            extents[i]
        };
        let w = (right - x + 44).max(snap(measure(&groups[i].label, 12., true) * 2.3 + 56.));
        let bounds = [
            (x + right - w + 1).div_euclid(2),
            y - 54,
            w,
            bottom - y + 76,
        ];
        groups[i].bounds = bounds;
        if let Some(p) = groups[i].parent {
            include(&mut extents[p], bounds);
        }
    }
    for _ in 0..4 {
        let mut shifted = false;
        for (k, &i) in order.iter().enumerate() {
            let [ax, ay, aw, ah] = groups[i].bounds;
            for &j in &order[k + 1..] {
                work = work.checked_sub(groups[j].depth + 1)?;
                if ancestors(groups, groups[j].parent).any(|p| p == i) {
                    continue;
                }
                let [bx, by, bw, bh] = groups[j].bounds;
                if ax - 24 >= bx + bw
                    || ax + aw + 24 <= bx
                    || ay - 24 >= by + bh
                    || ay + ah + 24 <= by
                {
                    continue;
                }
                let (which, dx) = if ax <= bx {
                    (j, ax + aw + 24 - bx)
                } else {
                    (i, bx + bw + 24 - ax)
                };
                for n in nodes.iter_mut() {
                    work = work.checked_sub(n.group.map_or(1, |g| groups[g].depth))?;
                    if ancestors(groups, n.group).any(|g| g == which) {
                        n.x += dx;
                    }
                }
                for &g in &order {
                    work = work.checked_sub(groups[g].depth)?;
                    if ancestors(groups, Some(g)).any(|p| p == which) {
                        groups[g].bounds[0] += dx;
                    }
                }
                shifted = true;
            }
        }
        if !shifted {
            break;
        }
    }
    Some(order)
}

fn clearance([x, y, w, h]: [i32; 4], [a, b, c, d]: [i32; 4]) -> i32 {
    let gap = (a - x - w).max(x - a - c).max(b - y - h).max(y - b - d);
    if gap > 0 {
        gap
    } else {
        -((x + w).min(a + c) - x.max(a)).min((y + h).min(b + d) - y.max(b))
    }
}
const BUDGET: &str = "mmdc: E_LIMIT: Render work budget exceeded\n";
fn violation(message: String) -> String {
    format!("mmdc: E_LIMIT: Scene geometry verification failed: {message}\n")
}

// Moving sibling groups can change the clearance between nodes on different layers.
pub(super) fn verify_nodes(
    nodes: &[Node],
    horizontal: bool,
    mut work: usize,
) -> Result<(), String> {
    let boxes: Vec<_> = nodes.iter().map(|n| [n.x, n.y, n.w, n.h]).collect();
    let mut order: Vec<_> = (0..nodes.len()).collect();
    let axis = usize::from(horizontal);
    order.sort_unstable_by_key(|&i| boxes[i][axis]);
    let mut first = None;
    for (k, &i) in order.iter().enumerate() {
        for &j in &order[k + 1..] {
            if boxes[j][axis] >= boxes[i][axis] + boxes[i][axis + 2] + 24 {
                break;
            }
            work = work.checked_sub(1).ok_or(BUDGET)?;
            let d = clearance(boxes[i], boxes[j]);
            if d < 24 {
                let pair = (i.min(j), i.max(j), d);
                first = Some(first.map_or(pair, |old: (usize, usize, i32)| old.min(pair)));
            }
        }
    }
    if let Some((a, b, d)) = first {
        return Err(violation(format!(
            "Invariant 1 (node clearance): nodes '{}' and '{}' have clearance {d}.00px (< 24px)",
            nodes[a].id, nodes[b].id
        )));
    }
    Ok(())
}

pub(super) fn verify(
    groups: &[Group],
    order: &[usize],
    nodes: &[Node],
    pills: &[Option<[f64; 4]>],
    mut work: usize,
) -> Result<(), String> {
    let margins = |[x, y, w, h]: [i32; 4], [a, b, c, d]: [i32; 4]| {
        [x - a, a + c - x - w, y - b - 32, b + d - y - h]
    };
    for &i in order {
        let group = &groups[i];
        let id = &group.id;
        let header = group.header();
        work = work.checked_sub(nodes.len() + pills.len()).ok_or(BUDGET)?;
        for n in nodes {
            let rect = [n.x, n.y, n.w, n.h];
            if super::labels::overlaps(rect.map(f64::from), header, -0.5) {
                return Err(violation(format!(
                    "Invariant 3 (header clearance): node '{}' overlaps header band of group '{id}'",
                    n.id
                )));
            }
            if n.group == Some(i) {
                let m = margins(rect, group.bounds);
                if m.iter().any(|v| *v < 16) {
                    let [l, r, t, b] = m;
                    return Err(violation(format!(
                        "Invariant 3 (subgraph containment): child node '{}' in '{id}' has margins L={l} R={r} T={t} B={b} (< 16px)",
                        n.id
                    )));
                }
            }
        }
        if let Some(k) = pills
            .iter()
            .position(|p| p.is_some_and(|r| super::labels::overlaps(r, header, -0.5)))
        {
            return Err(violation(format!(
                "Invariant 3 (pill header clearance): pill 'edge_{}:label' overlaps header band of '{id}'",
                k + 1
            )));
        }
        if let Some(g) = group.parent {
            let m = margins(group.bounds, groups[g].bounds);
            if m.iter().any(|v| *v < 16) {
                let [l, r, t, b] = m;
                return Err(violation(format!(
                    "Invariant 3 (nested subgraph containment): '{id}' in '{}' has margins L={l} R={r} T={t} B={b} (< 16px)",
                    groups[g].id
                )));
            }
        }
    }
    for (k, &i) in order.iter().enumerate() {
        for &j in &order[k + 1..] {
            work = work.checked_sub(groups[j].depth).ok_or(BUDGET)?;
            let d = clearance(groups[i].bounds, groups[j].bounds);
            if d < 16 && !ancestors(groups, groups[j].parent).any(|p| p == i) {
                return Err(violation(format!(
                    "Invariant 3 (disjoint group clearance): groups \"{}\" and \"{}\" have clearance {d}.00px (< 16px)",
                    groups[i].id, groups[j].id
                )));
            }
        }
    }
    Ok(())
}
