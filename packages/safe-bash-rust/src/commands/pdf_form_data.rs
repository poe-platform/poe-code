// PDFtk accepts FDF, XFDF, a field report, or simple name=value lines.
use super::{Cursor, Value, pdf_fields::text};
use std::{
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};

pub(super) enum Input {
    Text(String),
    Check(bool),
}
impl Input {
    fn state(s: String) -> Self {
        match s.as_str() {
            "Yes" | "On" => Self::Check(true),
            "Off" => Self::Check(false),
            _ => Self::Text(s),
        }
    }
}
pub(super) fn parse(bytes: &[u8], limit: usize) -> Result<Vec<(String, Input)>, String> {
    let text = String::from_utf8_lossy(bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes));
    let mut order = BTreeMap::<String, usize>::new();
    let mut values = Vec::<(String, Input)>::new();
    let mut budget = limit;
    let mut put = |name: &str, v: Input, append: bool| -> Result<(), String> {
        budget = budget
            .checked_sub(name.len() + 1)
            .ok_or("PDF form data limit exceeded")?;
        if let Some(&i) = order.get(name) {
            if append
                && let (Input::Text(a), Input::Text(b)) = (&mut values[i].1, &v)
                && !a.is_empty()
            {
                a.push(',');
                a.push_str(b);
            } else {
                values[i].1 = v;
            }
        } else {
            order.insert(name.into(), values.len());
            values.push((name.into(), v));
        }
        Ok(())
    };
    let start = text.trim_start();
    if start.starts_with("%FDF-") || text.contains("/FDF") && text.contains("/Fields") {
        fdf(bytes, &mut put)?;
    } else if start.starts_with("<?xml") || start.starts_with("<xfdf") || text.contains("<fields") {
        let mut rest = text.as_ref();
        let mut parents = Vec::new();
        let mut field = String::new();
        while let Some((_, tag)) = rest.split_once('<') {
            let Some((tag, tail)) = tag.split_once('>') else {
                break;
            };
            rest = tail;
            let tag = tag.trim();
            if let Some(end) = tag.strip_prefix('/') {
                if end.trim().eq_ignore_ascii_case("field")
                    && let Some(len) = parents.pop()
                {
                    field.truncate(len);
                }
                continue;
            }
            if tag.ends_with('/') {
                continue;
            }
            let kind = tag.split(' ').next().unwrap();
            if kind.eq_ignore_ascii_case("field") {
                parents.push(field.len());
                if let Some((_, a)) = tag.split_once("name=")
                    && let Some(quote) = a.chars().next()
                    && matches!(quote, '\'' | '"')
                    && let Some((name, _)) = a[1..].split_once(quote)
                    && !name.is_empty()
                {
                    if !field.is_empty() {
                        field.push('.');
                    }
                    field.push_str(&entities(name)?);
                }
            } else if kind.eq_ignore_ascii_case("value")
                && !parents.is_empty()
                && let Some((value, end)) = rest.split_once("</value>")
            {
                if !field.is_empty() {
                    put(&field, Input::state(entities(value)?), true)?;
                }
                rest = end;
            }
        }
    } else if text.contains("FieldName:") {
        let mut name = String::new();
        let mut kind = "";
        for line in text.lines().map(str::trim) {
            if line == "---" {
                name.clear();
                kind = "";
            } else if let Some(v) = line.strip_prefix("FieldType:") {
                kind = v.trim();
            } else if let Some(v) = line.strip_prefix("FieldName:") {
                name = entities(v.trim())?;
            } else if let Some(v) = line.strip_prefix("FieldValue:")
                && !name.is_empty()
            {
                let v = entities(v.trim())?;
                put(
                    &name,
                    if v == "false" || kind == "Button" && v.is_empty() {
                        Input::Check(false)
                    } else {
                        Input::state(v)
                    },
                    true,
                )?;
            }
        }
    } else {
        for line in text.lines().map(str::trim).filter(|s| !s.starts_with('#')) {
            if let Some((k, v)) = line.split_once('=').or_else(|| line.split_once(':'))
                && !k.is_empty()
            {
                let value = match v.trim() {
                    "true" => Input::Check(true),
                    "false" => Input::Check(false),
                    s => Input::state(s.into()),
                };
                put(k.trim(), value, false)?;
            }
        }
    }
    Ok(values)
}
fn entities(mut s: &str) -> Result<String, String> {
    let mut out = String::new();
    while let Some((before, after)) = s.split_once('&') {
        out.push_str(before);
        let end = after.find([';', '&']);
        if let Some(end) = end
            && after.as_bytes()[end] == b';'
        {
            let e = &after[..end];
            let ch = match e {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "apos" => Some('\''),
                "quot" => Some('"'),
                _ if e.starts_with('#') => {
                    let (n, radix) =
                        if let Some(s) = e.strip_prefix("#x").or_else(|| e.strip_prefix("#X")) {
                            (s, 16)
                        } else {
                            (&e[1..], 10)
                        };
                    let digits = n
                        .trim_start()
                        .trim_start_matches('+')
                        .split(|c: char| !c.is_digit(radix))
                        .next()
                        .unwrap();
                    if digits.is_empty() {
                        None
                    } else {
                        Some(
                            u32::from_str_radix(digits, radix)
                                .ok()
                                .and_then(char::from_u32)
                                .ok_or("invalid form data character")?,
                        )
                    }
                }
                _ => None,
            };
            if let Some(c) = ch {
                out.push(c);
                s = &after[end + 1..];
                continue;
            }
        }
        out.push('&');
        s = after;
    }
    out.push_str(s);
    Ok(out)
}
fn fdf(
    bytes: &[u8],
    put: &mut impl FnMut(&str, Input, bool) -> Result<(), String>,
) -> Result<(), String> {
    let mut cur = Cursor(bytes);
    let mut roots = Vec::new();
    let mut ids = BTreeMap::new();
    let mut tokens = bytes.len() + 1;
    loop {
        cur.skip();
        if cur.0.is_empty() {
            break;
        }
        let mut next = cur;
        let id = next.object_header();
        if id.is_some() {
            cur = next;
        }
        if let Some(v) = cur.value(0, &mut tokens, false) {
            if let Value::Dict(_) = v {
                if let Some((n, _)) = id {
                    ids.insert(n, roots.len());
                }
                roots.push((id, v));
            }
        } else if tokens == 0 {
            return Err("PDF form data limit exceeded".into());
        } else {
            cur.byte();
        }
    }
    let mut children = BTreeSet::new();
    fn mark(v: &Value, children: &mut BTreeSet<usize>) {
        match v {
            Value::Dict(d) => {
                for (k, v) in d {
                    if k.as_ref() == b"Kids"
                        && let Value::Array(a) = v
                    {
                        children.extend(a.iter().filter_map(|x| x.reference().map(|r| r.0)));
                    }
                    mark(v, children)
                }
            }
            Value::Array(a) => {
                for v in a {
                    mark(v, children)
                }
            }
            _ => (),
        }
    }
    for (_, v) in &roots {
        mark(v, &mut children);
    }
    let mut seen = BTreeSet::new();
    let mut stack = Vec::new();
    for (id, v) in &roots {
        if id.is_some_and(|id| children.contains(&id.0) || seen.contains(&id.0)) {
            continue;
        }
        stack.push((v, Rc::new(String::new()), 0));
        while let Some((v, prefix, depth)) = stack.pop() {
            if depth > 64 {
                return Err("PDF form field depth limit exceeded".into());
            }
            match v {
                Value::Ref((n, _)) => {
                    if seen.insert(*n)
                        && let Some(&idx) = ids.get(n)
                    {
                        stack.push((&roots[idx].1, prefix, depth + 1));
                    }
                }
                Value::Array(a) => {
                    for child in a.iter().rev() {
                        stack.push((child, prefix.clone(), depth + 1));
                    }
                }
                Value::Dict(d) => {
                    let mut name = prefix;
                    if let Some(part) = v.get(b"T").and_then(text).filter(|x| !x.is_empty()) {
                        if !name.is_empty() {
                            Rc::make_mut(&mut name).push('.');
                        }
                        Rc::make_mut(&mut name).push_str(&part);
                    }
                    if !name.is_empty()
                        && let Some(v) = v.get(b"V")
                    {
                        let input = match v {
                            Value::Array(a) => Some(Input::Text(
                                a.iter().filter_map(text).collect::<Vec<_>>().join(","),
                            )),
                            Value::Word(w) if w.as_ref() == b"true" || w.as_ref() == b"false" => {
                                Some(Input::Check(w.as_ref() == b"true"))
                            }
                            Value::Word(_) if v.number().is_some() => {
                                Some(Input::Text(v.number().unwrap().to_string()))
                            }
                            Value::Word(_) => text(v).map(Input::state),
                            _ => text(v).map(Input::Text),
                        };
                        if let Some(input) = input {
                            put(&name, input, false)?;
                        }
                    }
                    for (k, child) in d.iter().rev() {
                        if matches!(k.as_ref(), b"FDF" | b"Fields" | b"Kids")
                            || matches!(child, Value::Dict(_))
                        {
                            stack.push((child, name.clone(), depth + 1));
                        }
                    }
                }
                _ => (),
            }
        }
    }
    Ok(())
}
