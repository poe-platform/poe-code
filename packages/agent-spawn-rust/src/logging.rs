//! Spawn-log naming and content admission policy; Node owns file effects.
pub fn redacted_fields(event: &str) -> &'static [&'static str] {
    match event {
        "agent_message" | "reasoning" => &["text"],
        "tool_start" => &["title", "input"],
        "tool_complete" => &["path"],
        _ => &[],
    }
}
pub fn normalize_agent(input: &[u16]) -> Vec<u16> {
    let mut result = vec![];
    for scalar in char::decode_utf16(input.iter().copied()) {
        match scalar {
            Ok(c) if c.is_ascii_alphanumeric() || c == '-' || c == '_' => result.push(c as u16),
            _ => result.push(45),
        }
    }
    if result.is_empty() {
        "agent".encode_utf16().collect()
    } else {
        result
    }
}
pub fn filename(parts: &[Vec<u16>], agent: &[u16], session: &[u16], uuid: &[u16]) -> Vec<u16> {
    let mut result = vec![];
    for (index, width) in [0usize, 2, 2, 2, 2, 2, 3].into_iter().enumerate() {
        if index == 3 || index == 6 {
            result.push(45);
        }
        let part = parts.get(index).map_or(&[][..], |value| value.as_slice());
        result.extend(std::iter::repeat_n(48, width.saturating_sub(part.len())));
        result.extend(part);
    }
    result.push(45);
    result.extend(normalize_agent(agent));
    result.push(45);
    if !session.is_empty() && session != "unknown".encode_utf16().collect::<Vec<_>>() {
        result.extend(normalize_agent(session));
    } else {
        result.extend(uuid);
    }
    result.extend(".jsonl".encode_utf16());
    result
}
