// PDFtk form reports follow the field hierarchy; unnamed widget children
// contribute appearance states to their parent rather than separate fields.
use super::super::encode_pdftk_text;
use super::{ObjectId, Objects, Value, index, pdf_string};
use std::collections::BTreeSet;

#[derive(Default)]
struct Field {
    name: String,
    kind: String,
    flags: f64,
    justification: f64,
    max_length: Option<f64>,
}

fn text(v: &Value) -> Option<String> {
    match v {
        Value::String { bytes, .. } => Some(pdf_string::decode(bytes)),
        Value::Word(w) => Some(pdf_string::name(w.strip_prefix(b"/")?)),
        _ => None,
    }
}
impl<'a> Objects<'a> {
    fn inherited(&mut self, dict: &Value<'a>, key: &[u8]) -> Option<Value<'a>> {
        if let Some(v) = dict.get(key) {
            return self.resolve(v);
        }
        let mut parent = dict.get(b"Parent")?.clone();
        let mut seen = BTreeSet::new();
        for _ in 0..128 {
            if parent.reference().is_some_and(|id| !seen.insert(id)) {
                break;
            }
            let d = self.resolve(&parent)?;
            if let Some(v) = d.get(key) {
                return self.resolve(v);
            }
            parent = d.get(b"Parent")?.clone();
        }
        None
    }
}
struct Report {
    output: String,
    limit: usize,
    utf8: bool,
    active: BTreeSet<ObjectId>,
}
impl Report {
    fn line(&mut self, key: &str, value: &str) -> Result<(), &'static str> {
        let value = encode_pdftk_text(value, self.utf8);
        if key.len() + value.len() + 1 > self.limit.saturating_sub(self.output.len()) {
            return Err("PDF output byte limit exceeded");
        }
        self.output.push_str(key);
        self.output.push_str(&value);
        self.output.push('\n');
        Ok(())
    }
    fn field<'a>(
        &mut self,
        obj: &mut Objects<'a>,
        node: &Value<'a>,
        parent: &Field,
        depth: usize,
    ) -> Result<(), &'static str> {
        if depth > 128 {
            return Err("PDF form field depth limit exceeded");
        }
        if node.reference().is_some_and(|id| self.active.contains(&id)) {
            return Ok(());
        }
        let Some(d @ Value::Dict(_)) = obj.resolve(node) else {
            return Ok(());
        };
        let mut get = |k: &[u8]| d.get(k).and_then(|v| obj.resolve(v));
        let partial = get(b"T").as_ref().and_then(text).unwrap_or_default();
        let name = if parent.name.is_empty() {
            partial
        } else if partial.is_empty() {
            parent.name.clone()
        } else {
            format!("{}.{}", parent.name, partial)
        };
        if name.len() > self.limit {
            return Err("PDF output byte limit exceeded");
        }
        let field = Field {
            name,
            kind: get(b"FT")
                .and_then(|v| Some(pdf_string::name(v.word()?.strip_prefix(b"/")?)))
                .unwrap_or_else(|| parent.kind.clone()),
            flags: get(b"Ff").and_then(|v| v.number()).unwrap_or(parent.flags),
            justification: get(b"Q")
                .and_then(|v| v.number())
                .unwrap_or(parent.justification),
            max_length: get(b"MaxLen")
                .and_then(|v| v.number())
                .or(parent.max_length),
        };
        let kids = match get(b"Kids") {
            Some(Value::Array(v)) => v,
            _ => Vec::new(),
        };
        if !kids.is_empty()
            && (field.name.is_empty()
                || field.kind.is_empty()
                || kids
                    .iter()
                    .any(|kid| obj.resolve(kid).is_some_and(|d| d.get(b"T").is_some())))
        {
            if let Some(id) = node.reference() {
                self.active.insert(id);
            }
            for kid in &kids {
                self.field(obj, kid, &field, depth + 1)?;
            }
            if let Some(id) = node.reference() {
                self.active.remove(&id);
            }
            return Ok(());
        }
        if field.name.is_empty() {
            return Ok(());
        }
        let button = field.kind == "Btn";
        let mut options = Vec::new();
        let mut seen = BTreeSet::new();
        let mut option = |value: String| {
            if !value.is_empty() && seen.insert(value.clone()) {
                options.push(value);
            }
        };
        if button {
            option("Off".into());
            let mut appearances = |o: &mut Objects<'a>, d: &Value<'a>| -> Option<()> {
                let ap = o.resolve(d.get(b"AP")?)?;
                if let Value::Dict(entries) = o.resolve(ap.get(b"N")?)? {
                    for (k, _) in entries {
                        option(pdf_string::name(&k));
                    }
                }
                Some(())
            };
            appearances(obj, &d);
            for kid in kids {
                if let Some(d) = obj.resolve(&kid) {
                    appearances(obj, &d);
                }
            }
        }
        if button && options.len() == 1 {
            options.push("Yes".into());
            seen.insert("Yes".to_owned());
        }
        if let Some(Value::Array(items)) = obj.inherited(&d, b"Opt") {
            for item in items {
                let v = match obj.resolve(&item) {
                    Some(Value::Array(items)) => items.last().and_then(|last| obj.resolve(last)),
                    other => other,
                };
                if let Some(s) = v.as_ref().and_then(text).filter(|v| !v.is_empty())
                    && seen.insert(s.clone())
                {
                    options.push(s);
                }
            }
        }
        self.line("---", "")?;
        self.line(
            "FieldType: ",
            match field.kind.as_str() {
                "Ch" => "Choice",
                "Btn" => "Button",
                _ => "Text",
            },
        )?;
        self.line("FieldName: ", &field.name)?;
        if let Some(s) = obj
            .inherited(&d, b"TU")
            .as_ref()
            .and_then(text)
            .filter(|s| !s.is_empty())
        {
            self.line("FieldNameAlt: ", &s)?;
        }
        self.line("FieldFlags: ", &field.flags.to_string())?;
        let v = obj.inherited(&d, b"V");
        if button {
            let state = match v.as_ref().and_then(Value::word) {
                Some(b"true") => options.get(1).cloned().unwrap_or_else(|| "Yes".into()),
                Some(w) if w.starts_with(b"/") => pdf_string::name(&w[1..]),
                _ => "Off".into(),
            };
            self.line("FieldValue: ", &state)?;
        } else if let Some(Value::Array(values)) = v {
            let mut any = false;
            for v in values {
                if let Some(s) = obj.resolve(&v).as_ref().and_then(text) {
                    self.line("FieldValue: ", &s)?;
                    any = true;
                }
            }
            if !any {
                self.line("FieldValue: ", "")?;
            }
        } else {
            self.line(
                "FieldValue: ",
                &v.as_ref().and_then(text).unwrap_or_default(),
            )?;
        }
        if let Some(s) = obj
            .inherited(&d, b"DV")
            .as_ref()
            .and_then(text)
            .filter(|s| !s.is_empty())
        {
            self.line("FieldValueDefault: ", &s)?;
        }
        self.line(
            "FieldJustification: ",
            match field.justification {
                1. => "Centered",
                2. => "Right",
                _ => "Left",
            },
        )?;
        for opt in options {
            self.line("FieldStateOption: ", &opt)?;
        }
        if let Some(n) = field.max_length {
            self.line("FieldMaxLength: ", &n.to_string())?;
        }
        Ok(())
    }
}
pub(in super::super) fn report(
    bytes: &[u8],
    password: &str,
    utf8: bool,
    limit: usize,
) -> Result<String, &'static str> {
    let (mut obj, trailer) = index(bytes, password)?;
    let root = obj
        .resolve(trailer.get(b"Root").ok_or("missing PDF catalog")?)
        .ok_or("missing PDF catalog")?;
    let form = root.get(b"AcroForm").and_then(|v| obj.resolve(v));
    let Some(Value::Array(fields)) = form
        .as_ref()
        .and_then(|v| v.get(b"Fields"))
        .and_then(|v| obj.resolve(v))
    else {
        return Ok(String::new());
    };
    let mut report = Report {
        output: String::new(),
        limit,
        utf8,
        active: BTreeSet::new(),
    };
    for f in fields {
        report.field(&mut obj, &f, &Field::default(), 0)?;
    }
    Ok(report.output)
}
