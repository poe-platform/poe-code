//! Allocation admission only: the JSON parser still owns the full JSON grammar.
//! Count duplicate keys before parsing can collapse them, without building values
//! or decoded strings. String storage is measured in UTF-16 bytes, as in the host.
#[derive(Debug)]
pub enum JsonBudgetError {
    BudgetExceeded,
    Syntax(&'static str),
}

impl std::fmt::Display for JsonBudgetError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::BudgetExceeded => "MCP HTTP JSON structural budget exceeded",
            Self::Syntax(message) => message,
        })
    }
}

impl std::error::Error for JsonBudgetError {}

fn check(nodes: usize, decoded_bytes: usize) -> Result<(), JsonBudgetError> {
    if nodes > 100_000
        || decoded_bytes > 4 * 1024 * 1024
        || nodes * 128 + decoded_bytes > 8 * 1024 * 1024
    {
        return Err(JsonBudgetError::BudgetExceeded);
    }
    Ok(())
}

pub fn assert_http_json_budget(text: &[u16]) -> Result<(), JsonBudgetError> {
    let mut nodes = 0;
    let mut decoded_bytes = 0;
    let mut stack = [0u16; 64];
    let mut depth = 0;
    let mut index = 0;
    while let Some(&unit) = text.get(index) {
        index += 1;
        match unit {
            9 | 10 | 13 | 32 | 44 | 58 => continue, // whitespace, comma, colon
            93 | 125 => {
                if depth == 0 || stack[depth - 1] != unit {
                    return Err(JsonBudgetError::Syntax("Malformed MCP HTTP JSON nesting"));
                }
                depth -= 1;
                continue;
            }
            _ => {}
        }
        nodes += 1;
        check(nodes, decoded_bytes)?;
        match unit {
            91 | 123 => {
                if depth == stack.len() {
                    return Err(JsonBudgetError::BudgetExceeded);
                }
                stack[depth] = if unit == 91 { 93 } else { 125 };
                depth += 1;
            }
            34 => {
                let mut closed = false;
                while let Some(&character) = text.get(index) {
                    index += 1;
                    if character == 34 {
                        closed = true;
                        break;
                    }
                    if character < 32 {
                        return Err(JsonBudgetError::Syntax("Malformed MCP HTTP JSON string"));
                    }
                    if character == 92 {
                        match text.get(index) {
                            Some(117) => {
                                index += 1;
                                for _ in 0..4 {
                                    if !matches!(
                                        text.get(index),
                                        Some(48..=57 | 65..=70 | 97..=102)
                                    ) {
                                        return Err(JsonBudgetError::Syntax(
                                            "Malformed MCP HTTP JSON escape",
                                        ));
                                    }
                                    index += 1;
                                }
                            }
                            Some(34 | 47 | 92 | 98 | 102 | 110 | 114 | 116) => index += 1,
                            _ => {
                                return Err(JsonBudgetError::Syntax(
                                    "Malformed MCP HTTP JSON escape",
                                ));
                            }
                        }
                    }
                    decoded_bytes += 2;
                    check(nodes, decoded_bytes)?;
                }
                if !closed {
                    return Err(JsonBudgetError::Syntax("Unterminated MCP HTTP JSON string"));
                }
            }
            _ => {
                while text.get(index).is_some_and(|unit| {
                    !matches!(unit, 9 | 10 | 13 | 32 | 34 | 44 | 58 | 91 | 93 | 123 | 125)
                }) {
                    index += 1;
                }
            }
        }
    }
    if depth != 0 {
        return Err(JsonBudgetError::Syntax(
            "Unterminated MCP HTTP JSON container",
        ));
    }
    Ok(())
}
