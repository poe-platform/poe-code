//! RFC 6570 expansion and readable-resource matching, independent of a JS runtime.
use mcp_protocol_rust::json::Value;

const WORK_LIMIT: usize = 262_144;
const OUTPUT_LIMIT: usize = 1_048_576;

pub struct UriTemplate {
    segments: Vec<Segment>,
}
enum Segment {
    Literal(Vec<u16>),
    Expression {
        operator: u8,
        variables: Vec<Variable>,
    },
}
struct Variable {
    name: Vec<u16>,
    explode: bool,
    prefix: Option<usize>,
}
struct Options {
    prefix: &'static str,
    separator: u16,
    named: bool,
    empty: &'static str,
    reserved: bool,
}

fn options(operator: u8) -> Options {
    let (prefix, separator, named, empty, reserved) = match operator {
        b'+' => ("", b',', false, "", true),
        b'#' => ("#", b',', false, "", true),
        b'.' => (".", b'.', false, "", false),
        b'/' => ("/", b'/', false, "", false),
        b';' => (";", b';', true, "", false),
        b'?' => ("?", b'&', true, "=", false),
        b'&' => ("&", b'&', true, "=", false),
        _ => ("", b',', false, "", false),
    };
    Options {
        prefix,
        separator: u16::from(separator),
        named,
        empty,
        reserved,
    }
}
fn units(value: &str) -> Vec<u16> {
    value.encode_utf16().collect()
}
fn syntax(source: &[u16], offset: usize, detail: &str) -> String {
    format!(
        "Invalid URI template at {offset}: {detail} ({})",
        String::from_utf16_lossy(source)
    )
}
fn hex(unit: u16) -> Option<u8> {
    match unit {
        48..=57 => Some((unit - 48) as u8),
        65..=70 => Some((unit - 65 + 10) as u8),
        97..=102 => Some((unit - 97 + 10) as u8),
        _ => None,
    }
}
fn variable_name(name: &[u16]) -> bool {
    if name.is_empty() {
        return false;
    }
    let mut component = 0;
    let mut index = 0;
    while index < name.len() {
        match name[index] {
            46 => {
                if component == 0 {
                    return false;
                }
                component = 0;
            }
            37 => {
                if name.get(index + 1).and_then(|unit| hex(*unit)).is_none()
                    || name.get(index + 2).and_then(|unit| hex(*unit)).is_none()
                {
                    return false;
                }
                component += 1;
                index += 2;
            }
            48..=57 | 65..=90 | 97..=122 | 95 => component += 1,
            _ => return false,
        }
        index += 1;
    }
    component > 0
}
fn variable(source: &[u16], specification: &[u16], offset: usize) -> Result<Variable, String> {
    if specification.is_empty() {
        return Err(syntax(source, offset, "empty variable specification"));
    }
    let explode = specification.last() == Some(&42);
    let specification = if explode {
        &specification[..specification.len() - 1]
    } else {
        specification
    };
    let colon = specification.iter().position(|unit| *unit == 58);
    if explode && colon.is_some() {
        return Err(syntax(
            source,
            offset,
            "explode and prefix modifiers cannot be combined",
        ));
    }
    let name = &specification[..colon.unwrap_or(specification.len())];
    if !variable_name(name) {
        return Err(syntax(
            source,
            offset,
            &format!("invalid variable name {}", String::from_utf16_lossy(name)),
        ));
    }
    let prefix = if let Some(colon) = colon {
        let count = &specification[colon + 1..];
        if count.is_empty()
            || count.len() > 4
            || count[0] == 48
            || count.iter().any(|unit| !(48..=57).contains(unit))
        {
            return Err(syntax(
                source,
                offset,
                &format!(
                    "invalid prefix modifier {}",
                    String::from_utf16_lossy(count)
                ),
            ));
        }
        Some(
            count
                .iter()
                .fold(0usize, |number, unit| number * 10 + usize::from(*unit - 48)),
        )
    } else {
        None
    };
    Ok(Variable {
        name: name.to_vec(),
        explode,
        prefix,
    })
}

impl UriTemplate {
    pub fn parse(source: &[u16]) -> Result<Self, String> {
        if source.len() > 65_536 {
            return Err("URI template compilation resource limit exceeded".into());
        }
        let mut segments = Vec::new();
        let mut literal = 0;
        let mut index = 0;
        while index < source.len() {
            if source[index] == 125 {
                return Err(syntax(source, index, "unmatched closing brace"));
            }
            if source[index] != 123 {
                index += 1;
                continue;
            }
            if index > literal {
                segments.push(Segment::Literal(source[literal..index].to_vec()));
            }
            let close = source[index + 1..]
                .iter()
                .position(|unit| *unit == 125)
                .map(|close| close + index + 1)
                .ok_or_else(|| syntax(source, index, "unclosed expression"))?;
            let expression = &source[index + 1..close];
            if expression.contains(&123) {
                return Err(syntax(source, index, "nested expression"));
            }
            if expression.is_empty() {
                return Err(syntax(source, index, "empty expression"));
            }
            let operator = if expression[0] < 128 && b"+#./;?&".contains(&(expression[0] as u8)) {
                expression[0] as u8
            } else {
                0
            };
            let list = if operator == 0 {
                expression
            } else {
                &expression[1..]
            };
            if list.is_empty() {
                return Err(syntax(source, index, "expression has no variables"));
            }
            if operator == 0 && expression[0] < 128 && b"=,!@|".contains(&(expression[0] as u8)) {
                return Err(syntax(
                    source,
                    index,
                    &format!("unsupported operator {}", char::from(expression[0] as u8)),
                ));
            }
            let variables = list
                .split(|unit| *unit == 44)
                .map(|specification| variable(source, specification, index))
                .collect::<Result<Vec<_>, _>>()?;
            segments.push(Segment::Expression {
                operator,
                variables,
            });
            if segments.len() > 256 {
                return Err("URI template compilation resource limit exceeded".into());
            }
            index = close + 1;
            literal = index;
        }
        if literal < source.len() || segments.is_empty() {
            segments.push(Segment::Literal(source[literal..].to_vec()));
        }
        Ok(Self { segments })
    }

    pub fn expand(&self, variables: &Value) -> Result<Vec<u16>, String> {
        let mut result = Vec::new();
        for segment in &self.segments {
            match segment {
                Segment::Literal(literal) => result.extend(literal),
                Segment::Expression {
                    operator,
                    variables: specifications,
                } => {
                    let options = options(*operator);
                    let mut first = true;
                    for specification in specifications {
                        let value = match variables {
                            Value::Object(properties) => properties
                                .iter()
                                .find(|(name, _)| name == &specification.name)
                                .map(|(_, value)| value),
                            _ => return Err("URI template variables must be an object".into()),
                        };
                        let Some(value) = value.filter(|value| !matches!(value, Value::Null))
                        else {
                            continue;
                        };
                        for part in expand_variable(specification, value, &options)? {
                            if first {
                                result.extend(options.prefix.encode_utf16());
                                first = false;
                            } else {
                                result.push(options.separator);
                            }
                            result.extend(part);
                            if result.len() > OUTPUT_LIMIT {
                                return Err("URI template expansion resource limit exceeded".into());
                            }
                        }
                    }
                }
            }
            if result.len() > OUTPUT_LIMIT {
                return Err("URI template expansion resource limit exceeded".into());
            }
        }
        Ok(result)
    }

    pub fn match_uri(&self, uri: &[u16]) -> Result<Option<Value>, String> {
        if uri.len() > OUTPUT_LIMIT {
            return Err("URI template matching resource limit exceeded".into());
        }
        self.match_segments(uri, 0, 0, Vec::new(), &mut 0)
    }

    fn match_segments(
        &self,
        uri: &[u16],
        index: usize,
        position: usize,
        captures: Vec<(Vec<u16>, Value)>,
        work: &mut usize,
    ) -> Result<Option<Value>, String> {
        *work += 1;
        if *work > WORK_LIMIT {
            return Err("URI template matching resource limit exceeded".into());
        }
        let Some(segment) = self.segments.get(index) else {
            return Ok((position == uri.len()).then_some(Value::Object(captures)));
        };
        match segment {
            Segment::Literal(literal) => {
                if uri[position..].starts_with(literal) {
                    self.match_segments(uri, index + 1, position + literal.len(), captures, work)
                } else {
                    Ok(None)
                }
            }
            Segment::Expression {
                operator,
                variables,
            } => {
                let next = self.segments.get(index + 1);
                let boundary = match next {
                    Some(Segment::Literal(literal)) => literal.clone(),
                    Some(Segment::Expression { operator, .. }) => units(options(*operator).prefix),
                    None => Vec::new(),
                };
                let start = if next.is_none() { uri.len() } else { position };
                for end in (start..=uri.len()).rev() {
                    *work += 1;
                    if *work > WORK_LIMIT {
                        return Err("URI template matching resource limit exceeded".into());
                    }
                    if !boundary.is_empty() && !uri[end..].starts_with(&boundary) {
                        continue;
                    }
                    let Some(additions) =
                        match_expression(*operator, variables, &uri[position..end])
                    else {
                        continue;
                    };
                    let mut merged = captures.clone();
                    for (name, value) in additions {
                        if let Some((_, old)) = merged.iter_mut().find(|(key, _)| key == &name) {
                            *old = value;
                        } else {
                            merged.push((name, value));
                        }
                    }
                    if let Some(result) = self.match_segments(uri, index + 1, end, merged, work)? {
                        return Ok(Some(result));
                    }
                }
                Ok(None)
            }
        }
    }
}

fn scalar_string(value: &Value) -> Vec<u16> {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => units("null"),
        Value::Bool(value) => units(if *value { "true" } else { "false" }),
        Value::Number(value) => units(&if *value == 0.0 {
            "0".into()
        } else {
            value.to_string()
        }),
        Value::Object(_) => units("[object Object]"),
        Value::Array(values) => join(
            &values
                .iter()
                .map(|value| {
                    if matches!(value, Value::Null) {
                        Vec::new()
                    } else {
                        scalar_string(value)
                    }
                })
                .collect::<Vec<_>>(),
            44,
        ),
    }
}
fn join(values: &[Vec<u16>], separator: u16) -> Vec<u16> {
    let mut result = Vec::new();
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            result.push(separator);
        }
        result.extend(value);
    }
    result
}
fn named(variable: &Variable, encoded: Vec<u16>, options: &Options) -> Vec<u16> {
    if !options.named {
        return encoded;
    }
    let mut result = encode(&variable.name, true);
    if encoded.is_empty() {
        result.extend(options.empty.encode_utf16());
    } else {
        result.push(61);
        result.extend(encoded);
    }
    result
}
fn expand_variable(
    variable: &Variable,
    value: &Value,
    options: &Options,
) -> Result<Vec<Vec<u16>>, String> {
    if variable.prefix.is_some() && matches!(value, Value::Array(_) | Value::Object(_)) {
        return Err(format!(
            "Prefix modifier requires a scalar value: {}",
            String::from_utf16_lossy(&variable.name)
        ));
    }
    match value {
        Value::Array(values) => {
            if values.is_empty() {
                return Ok(Vec::new());
            }
            let encoded = values
                .iter()
                .map(|value| encode(&scalar_string(value), options.reserved))
                .collect::<Vec<_>>();
            if !variable.explode {
                Ok(vec![named(variable, join(&encoded, 44), options)])
            } else if !options.named {
                Ok(encoded)
            } else {
                Ok(encoded
                    .into_iter()
                    .map(|value| named(variable, value, options))
                    .collect())
            }
        }
        Value::Object(properties) => {
            if properties.is_empty() {
                return Ok(Vec::new());
            }
            let encoded = properties
                .iter()
                .map(|(key, value)| {
                    (
                        encode(key, options.reserved),
                        encode(&scalar_string(value), options.reserved),
                    )
                })
                .collect::<Vec<_>>();
            if !variable.explode {
                let flattened = encoded
                    .into_iter()
                    .flat_map(|(key, value)| [key, value])
                    .collect::<Vec<_>>();
                Ok(vec![named(variable, join(&flattened, 44), options)])
            } else {
                Ok(encoded
                    .into_iter()
                    .map(|(mut key, value)| {
                        key.push(61);
                        key.extend(value);
                        key
                    })
                    .collect())
            }
        }
        value => {
            let text = scalar_string(value);
            let text = if let Some(prefix) = variable.prefix {
                let mut index = 0;
                for _ in 0..prefix {
                    let Some(unit) = text.get(index) else {
                        break;
                    };
                    index += if (0xd800..=0xdbff).contains(unit)
                        && text
                            .get(index + 1)
                            .is_some_and(|low| (0xdc00..=0xdfff).contains(low))
                    {
                        2
                    } else {
                        1
                    };
                }
                &text[..index]
            } else {
                &text
            };
            Ok(vec![named(
                variable,
                encode(text, options.reserved),
                options,
            )])
        }
    }
}
fn encode(source: &[u16], reserved: bool) -> Vec<u16> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < source.len() {
        let unit = source[index];
        if reserved
            && unit == 37
            && source.get(index + 1).and_then(|unit| hex(*unit)).is_some()
            && source.get(index + 2).and_then(|unit| hex(*unit)).is_some()
        {
            result.extend(&source[index..index + 3]);
            index += 3;
            continue;
        }
        if matches!(unit, 48..=57 | 65..=90 | 97..=122 | 45 | 46 | 95 | 126)
            || (reserved && unit < 128 && b":/?#[]@!$&'()*+,;=".contains(&(unit as u8)))
        {
            result.push(unit);
            index += 1;
            continue;
        }
        let length = if (0xd800..=0xdbff).contains(&unit)
            && source
                .get(index + 1)
                .is_some_and(|low| (0xdc00..=0xdfff).contains(low))
        {
            2
        } else {
            1
        };
        let scalar = char::decode_utf16(source[index..index + length].iter().copied())
            .next()
            .expect("nonempty scalar")
            .unwrap_or(char::REPLACEMENT_CHARACTER);
        for byte in scalar.encode_utf8(&mut [0; 4]).bytes() {
            result.extend([
                37,
                u16::from(b"0123456789ABCDEF"[(byte >> 4) as usize]),
                u16::from(b"0123456789ABCDEF"[(byte & 15) as usize]),
            ]);
        }
        index += length;
    }
    result
}
fn decode(source: &[u16]) -> Vec<u16> {
    let mut result = Vec::new();
    let mut index = 0;
    while index < source.len() {
        if source[index] != 37 {
            result.push(source[index]);
            index += 1;
            continue;
        }
        let mut bytes = Vec::new();
        while source.get(index) == Some(&37) {
            let (Some(high), Some(low)) = (
                source.get(index + 1).and_then(|unit| hex(*unit)),
                source.get(index + 2).and_then(|unit| hex(*unit)),
            ) else {
                return source.to_vec();
            };
            bytes.push(high * 16 + low);
            index += 3;
        }
        let Ok(text) = std::str::from_utf8(&bytes) else {
            return source.to_vec();
        };
        result.extend(text.encode_utf16());
    }
    result
}
fn match_expression(
    operator: u8,
    variables: &[Variable],
    expansion: &[u16],
) -> Option<Vec<(Vec<u16>, Value)>> {
    if expansion.is_empty() {
        return Some(Vec::new());
    }
    let options = options(operator);
    let prefix = units(options.prefix);
    let body = expansion.strip_prefix(prefix.as_slice())?;
    let mut captures = Vec::new();
    if options.named {
        let fields = if body.is_empty() {
            Vec::new()
        } else {
            body.split(|unit| *unit == options.separator)
                .collect::<Vec<_>>()
        };
        for variable in variables {
            let name = encode(&variable.name, true);
            let values = fields
                .iter()
                .filter_map(|field| {
                    let equals = field
                        .iter()
                        .position(|unit| *unit == 61)
                        .unwrap_or(field.len());
                    (field[..equals] == name).then(|| {
                        if equals == field.len() {
                            Vec::new()
                        } else {
                            field[equals + 1..].to_vec()
                        }
                    })
                })
                .collect::<Vec<_>>();
            if !values.is_empty() {
                let joined = if variable.explode {
                    join(&values, 44)
                } else {
                    values.concat()
                };
                captures.push((variable.name.clone(), Value::String(decode(&joined))));
            } else if variable.explode && variables.len() == 1 && !body.is_empty() {
                captures.push((variable.name.clone(), Value::String(decode(body))));
            }
        }
    } else if variables.len() == 1 {
        captures.push((variables[0].name.clone(), Value::String(decode(body))));
    } else {
        let fields = body
            .split(|unit| *unit == options.separator)
            .collect::<Vec<_>>();
        for (index, variable) in variables.iter().enumerate().take(fields.len()) {
            let value = if index + 1 == variables.len() {
                join(
                    &fields[index..]
                        .iter()
                        .map(|field| field.to_vec())
                        .collect::<Vec<_>>(),
                    options.separator,
                )
            } else {
                fields[index].to_vec()
            };
            captures.push((variable.name.clone(), Value::String(decode(&value))));
        }
    }
    Some(captures)
}
