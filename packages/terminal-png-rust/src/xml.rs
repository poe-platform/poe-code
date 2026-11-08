//! Small bounded XML reader for independent SVG rasterization. No entity loaders.
#[derive(Debug)]
pub enum Node {
    Element(Element),
    Text(String),
}
#[derive(Debug)]
pub struct Element {
    pub name: String,
    pub attributes: Vec<(String, String)>,
    pub children: Vec<Node>,
}
impl Element {
    pub fn attribute(&self, key: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, v)| v.as_str())
    }
    pub fn text(&self) -> String {
        let mut result = String::new();
        for child in &self.children {
            match child {
                Node::Text(text) => result.push_str(text),
                Node::Element(element) => result.push_str(&element.text()),
            }
        }
        result
    }
}
fn decode(text: &str) -> Result<String, &'static str> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let end = rest[at..].find(';').ok_or("unterminated XML entity")? + at;
        let entity = &rest[at + 1..end];
        let ch = match entity {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ => {
                let cp = if let Some(value) = entity.strip_prefix("#x") {
                    u32::from_str_radix(value, 16).ok()
                } else if let Some(value) = entity.strip_prefix('#') {
                    value.parse().ok()
                } else {
                    None
                };
                let cp = cp.ok_or("unsupported XML entity")?;
                if cp == 0 || matches!(cp,1..=8|11..=12|14..=31|0xfffe..=0xffff) {
                    return Err("invalid XML character");
                }
                char::from_u32(cp).ok_or("invalid XML character")?
            }
        };
        out.push(ch);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}
struct Reader<'a> {
    input: &'a str,
    at: usize,
    nodes: usize,
}
impl Reader<'_> {
    fn rest(&self) -> &str {
        &self.input[self.at..]
    }
    fn space(&mut self) {
        while self
            .input
            .as_bytes()
            .get(self.at)
            .is_some_and(u8::is_ascii_whitespace)
        {
            self.at += 1;
        }
    }
    fn expect(&mut self, text: &str) -> Result<(), &'static str> {
        if !self.rest().starts_with(text) {
            return Err("invalid XML syntax");
        }
        self.at += text.len();
        Ok(())
    }
    fn name(&mut self) -> Result<String, &'static str> {
        let start = self.at;
        while self.input.as_bytes().get(self.at).is_some_and(|b| {
            !b.is_ascii_whitespace()
                && !matches!(*b, b'=' | b'/' | b'>' | b'<' | b'?' | b'\'' | b'"')
        }) {
            self.at += 1;
        }
        if start == self.at {
            return Err("XML name missing");
        }
        Ok(self.input[start..self.at].to_string())
    }
    fn skipped(&mut self) -> Result<bool, &'static str> {
        if self.rest().starts_with("<!--") {
            let end = self.rest().find("-->").ok_or("unterminated XML comment")?;
            self.at += end + 3;
            return Ok(true);
        }
        if self.rest().starts_with("<?") {
            let end = self
                .rest()
                .find("?>")
                .ok_or("unterminated XML instruction")?;
            self.at += end + 2;
            return Ok(true);
        }
        if self.rest().starts_with("<!") {
            return Err("XML declarations and external entities are unsupported");
        }
        Ok(false)
    }
    fn element(&mut self, depth: usize) -> Result<Element, &'static str> {
        if depth > 64 || self.nodes >= 50000 {
            return Err("SVG exceeds XML complexity budget");
        }
        self.nodes += 1;
        self.expect("<")?;
        let name = self.name()?;
        let mut attributes = vec![];
        loop {
            self.space();
            if self.rest().starts_with("/>") {
                self.at += 2;
                return Ok(Element {
                    name,
                    attributes,
                    children: vec![],
                });
            }
            if self.rest().starts_with('>') {
                self.at += 1;
                break;
            }
            if attributes.len() >= 256 {
                return Err("SVG attribute budget exceeded");
            }
            let key = self.name()?;
            if attributes.iter().any(|(name, _)| name == &key) {
                return Err("duplicate XML attribute");
            }
            self.space();
            self.expect("=")?;
            self.space();
            let quote = *self
                .input
                .as_bytes()
                .get(self.at)
                .ok_or("XML quote missing")?;
            if quote != b'\'' && quote != b'"' {
                return Err("XML quote missing");
            }
            self.at += 1;
            let end = self
                .rest()
                .find(char::from(quote))
                .ok_or("unterminated XML attribute")?;
            let value = decode(&self.rest()[..end])?;
            if self.rest()[..end].contains('<') {
                return Err("invalid XML attribute");
            }
            self.at += end + 1;
            attributes.push((key, value));
        }
        let mut children = vec![];
        loop {
            if self.at >= self.input.len() {
                return Err("unclosed XML element");
            }
            if self.rest().starts_with("</") {
                self.at += 2;
                let close = self.name()?;
                if close != name {
                    return Err("mismatched XML closing tag");
                }
                self.space();
                self.expect(">")?;
                break;
            }
            if self.rest().starts_with("<![CDATA[") {
                self.at += 9;
                let end = self.rest().find("]]>").ok_or("unterminated CDATA")?;
                children.push(Node::Text(self.rest()[..end].to_string()));
                self.at += end + 3;
                continue;
            }
            if self.rest().starts_with('<') {
                if !self.skipped()? {
                    children.push(Node::Element(self.element(depth + 1)?));
                }
                continue;
            }
            let end = self.rest().find('<').unwrap_or(self.rest().len());
            let value = decode(&self.rest()[..end])?;
            self.at += end;
            children.push(Node::Text(value));
        }
        Ok(Element {
            name,
            attributes,
            children,
        })
    }
}
pub fn parse(input: &str) -> Result<Element, &'static str> {
    if input.len() > 2 * 1024 * 1024 {
        return Err("SVG exceeds input budget");
    }
    let input = input.strip_prefix('\u{feff}').unwrap_or(input);
    let mut reader = Reader {
        input,
        at: 0,
        nodes: 0,
    };
    reader.space();
    while reader.skipped()? {
        reader.space();
    }
    let root = reader.element(0)?;
    reader.space();
    while reader.skipped()? {
        reader.space();
    }
    if reader.at != input.len() {
        return Err("XML trailing content");
    }
    Ok(root)
}
