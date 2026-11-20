//! Retained Graphviz spline commands, using the existing bounded SVG path grammar.
use document_ast_rust::vector::{Path, PathSegment};
fn number(value: &str) -> Result<f64, String> {
    let value = value.trim();
    let n = value
        .strip_suffix("px")
        .unwrap_or(value)
        .parse::<f64>()
        .map_err(|_| format!("Invalid SVG number {value:?}"))?;
    if !n.is_finite() || n.abs() > 1e9 {
        return Err("SVG geometry exceeds limits".into());
    }
    Ok(n)
}
fn tokens(source: &str) -> Result<Vec<Result<f64, char>>, String> {
    let bytes = source.as_bytes();
    let mut at = 0;
    let mut out = Vec::new();
    while at < bytes.len() {
        if out.len() >= 200_000 {
            return Err("SVG geometry content limit exceeded".into());
        }
        if bytes[at].is_ascii_whitespace() || bytes[at] == b',' {
            at += 1;
            continue;
        }
        if bytes[at].is_ascii_alphabetic() {
            out.push(Err(char::from(bytes[at])));
            at += 1;
            continue;
        }
        let start = at;
        if matches!(bytes[at], b'+' | b'-') {
            at += 1;
        }
        let mut digits = 0;
        while at < bytes.len() && bytes[at].is_ascii_digit() {
            at += 1;
            digits += 1;
        }
        if bytes.get(at) == Some(&b'.') {
            at += 1;
            while at < bytes.len() && bytes[at].is_ascii_digit() {
                at += 1;
                digits += 1;
            }
        }
        if digits == 0 {
            return Err("Invalid SVG number list".into());
        }
        if matches!(bytes.get(at), Some(b'e' | b'E')) {
            at += 1;
            if matches!(bytes.get(at), Some(b'+' | b'-')) {
                at += 1;
            }
            let exponent = at;
            while at < bytes.len() && bytes[at].is_ascii_digit() {
                at += 1;
            }
            if at == exponent {
                return Err("Invalid SVG exponent".into());
            }
        }
        out.push(Ok(number(&source[start..at])?));
        if out.len() > 200_000 {
            return Err("SVG geometry content limit exceeded".into());
        }
    }
    Ok(out)
}
pub(crate) fn parse(source: &str) -> Result<Path, String> {
    let mut tokens = tokens(source)?.into_iter().peekable();
    if tokens.peek().is_some_and(|v| !matches!(v, Err('M' | 'm'))) {
        return Err("SVG path must begin with moveto".into());
    }
    let (mut command, mut previous) = (' ', ' ');
    let (mut p, mut start, mut control) = ([0.; 2], [0.; 2], [0.; 2]);
    let mut out = Path::default();
    while tokens.peek().is_some() {
        if let Some(Err(c)) = tokens.peek() {
            command = *c;
            tokens.next();
        }
        let relative = command.is_ascii_lowercase();
        let upper = command.to_ascii_uppercase();
        let mut next = |axis: usize| {
            tokens
                .next()
                .and_then(Result::ok)
                .map(|v| if relative { v + p[axis] } else { v })
                .ok_or("Invalid SVG path")
        };
        match upper {
            'Z' => {
                out.segments.push(PathSegment::Close);
                p = start;
                command = ' ';
            }
            'M' | 'L' => {
                p = [next(0)?, next(1)?];
                out.segments.push(if upper == 'M' {
                    PathSegment::MoveTo(p)
                } else {
                    PathSegment::LineTo(p)
                });
                if upper == 'M' {
                    start = p;
                    command = if relative { 'l' } else { 'L' };
                }
            }
            'H' => {
                p[0] = next(0)?;
                out.segments.push(PathSegment::LineTo(p));
            }
            'V' => {
                p[1] = next(1)?;
                out.segments.push(PathSegment::LineTo(p));
            }
            'C' | 'S' => {
                let a = if upper == 'C' {
                    [next(0)?, next(1)?]
                } else if matches!(previous, 'C' | 'S') {
                    [2. * p[0] - control[0], 2. * p[1] - control[1]]
                } else {
                    p
                };
                control = [next(0)?, next(1)?];
                p = [next(0)?, next(1)?];
                out.segments.push(PathSegment::CurveTo([
                    a[0], a[1], control[0], control[1], p[0], p[1],
                ]));
            }
            'Q' | 'T' => {
                control = if upper == 'Q' {
                    [next(0)?, next(1)?]
                } else if matches!(previous, 'Q' | 'T') {
                    [2. * p[0] - control[0], 2. * p[1] - control[1]]
                } else {
                    p
                };
                let end = [next(0)?, next(1)?];
                let cp = |v: f64, c: f64| v + (c - v) * 2. / 3.;
                out.segments.push(PathSegment::CurveTo([
                    cp(p[0], control[0]),
                    cp(p[1], control[1]),
                    cp(end[0], control[0]),
                    cp(end[1], control[1]),
                    end[0],
                    end[1],
                ]));
                p = end;
            }
            _ => return Err(format!("Unsupported SVG path command {command}")),
        }
        previous = upper;
    }
    Ok(out)
}
