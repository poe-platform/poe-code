// PDFtk form reports follow the field hierarchy; unnamed widget children
// contribute appearance states to their parent rather than separate fields.
use super::super::encode_pdftk_text;
use super::{ObjectId, Objects, Value, index, pdf_string};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
struct Field {
    name: String,
    kind: String,
    flags: f64,
    justification: f64,
    max_length: Option<f64>,
}

pub(super) fn text(v: &Value) -> Option<String> {
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
fn fdf_string(s: &str) -> String {
    let mut result = String::from("(");
    for c in s.chars() {
        match c {
            '(' | ')' | '\\' => {
                result.push('\\');
                result.push(c);
            }
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            _ => result.push(c),
        }
    }
    result.push(')');
    result
}
struct Report {
    output: String,
    limit: usize,
    utf8: bool,
    fdf_values: Option<BTreeMap<String, String>>,
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
        let v = obj.inherited(&d, b"V");
        let values = if button {
            let state = match v.as_ref().and_then(Value::word) {
                Some(b"true") => options.get(1).cloned().unwrap_or_else(|| "Yes".into()),
                Some(w) if w.starts_with(b"/") => pdf_string::name(&w[1..]),
                _ => "Off".into(),
            };
            vec![state]
        } else if let Some(Value::Array(values)) = v {
            let mut selected = Vec::new();
            let mut remaining = self.limit;
            for v in values {
                if let Some(s) = obj.resolve(&v).as_ref().and_then(text) {
                    remaining = remaining
                        .checked_sub(s.len() + 1)
                        .ok_or("PDF output byte limit exceeded")?;
                    selected.push(s);
                }
            }
            if selected.is_empty() {
                selected.push(String::new());
            }
            selected
        } else {
            vec![v.as_ref().and_then(text).unwrap_or_default()]
        };
        if let Some(fdf) = &mut self.fdf_values {
            let value = if button {
                format!("/{}", values[0])
            } else if values.len() == 1 {
                fdf_string(&values[0])
            } else {
                format!(
                    "[ {} ]",
                    values
                        .iter()
                        .map(|v| fdf_string(v))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            };
            // Bound the retained lookup independently of the eventual FDF output.
            obj.remaining_bytes = obj
                .remaining_bytes
                .checked_sub(field.name.len() + value.len())
                .ok_or("PDF form field byte limit exceeded")?;
            fdf.insert(field.name, value);
            return Ok(());
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
        for value in values {
            self.line("FieldValue: ", &value)?;
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
    fn push(&mut self, s: &str) -> Result<(), &'static str> {
        if s.len() > self.limit.saturating_sub(self.output.len()) {
            return Err("PDF output byte limit exceeded");
        }
        self.output.push_str(s);
        Ok(())
    }
    fn fdf_node<'a>(
        &mut self,
        obj: &mut Objects<'a>,
        node: &Value<'a>,
        prefix: &str,
        separator: &str,
        depth: usize,
    ) -> Result<bool, &'static str> {
        if depth > 128 {
            return Err("PDF FDF field depth limit exceeded");
        }
        let Some(d @ Value::Dict(_)) = obj.resolve(node) else {
            return Ok(false);
        };
        if depth > 0 && d.get(b"T").is_none() {
            return Ok(false);
        }
        let partial = match d.get(b"T").and_then(|v| obj.resolve(v)) {
            Some(Value::String { bytes, .. }) => pdf_string::decode(&bytes),
            _ => String::new(),
        };
        let full = if prefix.is_empty() {
            partial.clone()
        } else if partial.is_empty() {
            prefix.to_owned()
        } else {
            format!("{prefix}.{partial}")
        };
        let original = self.output.len();
        self.push(separator)?;
        self.push("<< /T ")?;
        self.push(&fdf_string(if partial.is_empty() {
            &full
        } else {
            &partial
        }))?;
        let start_kids = self.output.len();
        let mut any = false;
        if let Some(Value::Array(kids)) = d.get(b"Kids").and_then(|v| obj.resolve(v)) {
            for kid in kids {
                any |= self.fdf_node(
                    obj,
                    &kid,
                    &full,
                    if any { " " } else { " /Kids [ " },
                    depth + 1,
                )?;
            }
        }
        if any {
            self.push(" ] >>")?;
        } else if full.is_empty() {
            self.output.truncate(original);
            return Ok(false);
        } else {
            debug_assert_eq!(self.output.len(), start_kids);
            let value = self
                .fdf_values
                .as_ref()
                .and_then(|f| f.get(&full))
                .cloned()
                .unwrap_or_else(|| match d.get(b"V").and_then(|v| obj.resolve(v)) {
                    Some(Value::Word(w)) if w.starts_with(b"/") => {
                        format!("/{}", pdf_string::name(&w[1..]))
                    }
                    Some(Value::String { bytes, .. }) => fdf_string(&pdf_string::decode(&bytes)),
                    _ => "()".into(),
                });
            self.push(" /V ")?;
            self.push(&value)?;
            self.push(" >>")?;
        }
        Ok(true)
    }
}
pub(in super::super) fn report(
    bytes: &[u8],
    password: &str,
    op: &str,
    limit: usize,
) -> Result<String, &'static str> {
    let mut report = Report {
        output: String::new(),
        limit,
        utf8: op.ends_with("_utf8"),
        fdf_values: (op == "generate_fdf").then(BTreeMap::new),
        active: BTreeSet::new(),
    };
    if report.fdf_values.is_some() {
        report.push("%FDF-1.2\n1 0 obj\n<< /FDF << /Fields [\n")?;
    }
    if !super::super::is_legacy_pdf(bytes) {
        let (mut obj, trailer) = index(bytes, password)?;
        let root = obj
            .resolve(trailer.get(b"Root").ok_or("missing PDF catalog")?)
            .ok_or("missing PDF catalog")?;
        if let Some(Value::Array(fields)) = root
            .get(b"AcroForm")
            .and_then(|v| obj.resolve(v))
            .and_then(|f| f.get(b"Fields").and_then(|v| obj.resolve(v)))
        {
            for f in &fields {
                report.field(&mut obj, f, &Field::default(), 0)?;
            }
            if report.fdf_values.is_some() {
                let mut any = false;
                for f in fields {
                    any |= report.fdf_node(&mut obj, &f, "", if any { "\n  " } else { "  " }, 0)?;
                }
            }
        }
    }
    if report.fdf_values.is_some() {
        report.push("\n] >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")?;
    }
    Ok(report.output)
}
