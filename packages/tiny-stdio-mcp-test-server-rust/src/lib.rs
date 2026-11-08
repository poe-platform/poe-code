//! Deterministic MCP fixtures and startup policy.
pub mod cli;
use mcp_protocol_rust::{json::Value, strings::trim_ecmascript};

pub const WORD_OF_THE_DAY: &str = "Bumfuzzle - to confuse or fluster someone";
pub const SERVE_TOOL_NAMES: &[&str] = &["encrypt", "word-of-the-day"];

pub fn caesar_encrypt(text: &[u16], shift: f64) -> Result<Vec<u16>, &'static str> {
    if !shift.is_finite() || shift.fract() != 0.0 {
        return Err("Caesar cipher shift must be a finite integer");
    }
    let shift = (((shift % 26.0) + 26.0) % 26.0) as u16;
    Ok(text
        .iter()
        .map(|unit| {
            let base = match unit {
                65..=90 => 65,
                97..=122 => 97,
                _ => return *unit,
            };
            (*unit - base + shift) % 26 + base
        })
        .collect())
}

pub fn next_spawn_count(current: Option<&[u16]>) -> Result<u64, &'static str> {
    const ERROR: &str = "TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer";
    let mut count = 0_u64;
    if let Some(current) = current {
        for digit in trim_ecmascript(current) {
            if !(48..=57).contains(digit) {
                return Err(ERROR);
            }
            count = count
                .checked_mul(10)
                .and_then(|count| count.checked_add(u64::from(*digit - 48)))
                .ok_or(ERROR)?;
            if count > 9_007_199_254_740_991 {
                return Err(ERROR);
            }
        }
    }
    Ok(count + 1)
}

fn text(value: &str) -> Value {
    Value::String(value.encode_utf16().collect())
}
fn object(fields: &[(&str, Value)]) -> Value {
    Value::Object(
        fields
            .iter()
            .map(|(key, value)| (key.encode_utf16().collect(), value.clone()))
            .collect(),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Encrypt,
    WordOfTheDay,
}
impl Tool {
    pub fn from_name(name: &[u16]) -> Option<Self> {
        [Self::Encrypt, Self::WordOfTheDay]
            .into_iter()
            .find(|tool| tool.serve_name().encode_utf16().eq(name.iter().copied()))
    }
    pub fn serve_name(self) -> &'static str {
        match self {
            Self::Encrypt => "encrypt",
            Self::WordOfTheDay => "word-of-the-day",
        }
    }
    pub fn descriptor(self) -> Value {
        let (name, description, schema) = match self {
            Self::Encrypt => (
                "caesar_cipher_encrypt",
                "Encrypts text using the Caesar cipher",
                object(&[
                    (
                        "text",
                        object(&[
                            ("type", text("string")),
                            ("description", text("The text to encrypt")),
                        ]),
                    ),
                    (
                        "shift",
                        object(&[
                            ("type", text("integer")),
                            ("description", text("The shift amount (default: 3)")),
                            ("optional", Value::Bool(true)),
                        ]),
                    ),
                ]),
            ),
            Self::WordOfTheDay => (
                "word_of_the_day",
                "Returns the word of the day",
                object(&[]),
            ),
        };
        object(&[
            ("name", text(name)),
            ("description", text(description)),
            ("schema", schema),
            ("serveName", text(self.serve_name())),
        ])
    }
    pub fn descriptors() -> Vec<Value> {
        [Self::Encrypt, Self::WordOfTheDay]
            .into_iter()
            .map(Self::descriptor)
            .collect()
    }
}
