//! WWW-Authenticate scanning uses UTF-16 units to preserve JavaScript strings,
//! including malformed surrogate pairs. Name case conversion is a host string primitive.

type AuthParam = (Vec<u16>, Vec<u16>);
pub type AuthParams = Vec<AuthParam>;

fn whitespace(input: &[u16], mut index: usize) -> usize {
    while matches!(input.get(index), Some(32 | 9)) {
        index += 1;
    }
    index
}

fn token(input: &[u16], start: usize) -> Option<usize> {
    let mut index = start;
    while input
        .get(index)
        .is_some_and(|unit| !matches!(unit, 32 | 9 | 44 | 61 | 34))
    {
        index += 1;
    }
    (index > start).then_some(index)
}

fn looks_like_param(input: &[u16], index: usize) -> bool {
    token(input, index).is_some_and(|end| input.get(whitespace(input, end)) == Some(&61))
}

fn token68(input: &[u16], start: usize) -> Option<usize> {
    let mut end = start;
    while input
        .get(end)
        .is_some_and(|unit| !matches!(unit, 44 | 32 | 9))
    {
        end += 1;
    }
    let mut index = start;
    while index < end
        && matches!(input[index], 65..=90 | 97..=122 | 48..=57 | 45 | 46 | 95 | 126 | 43 | 47)
    {
        index += 1;
    }
    if index == start {
        return None;
    }
    while index < end && input[index] == 61 {
        index += 1;
    }
    (index == end).then_some(end)
}

fn quoted(input: &[u16], start: usize) -> Option<(Vec<u16>, usize)> {
    if input.get(start) != Some(&34) {
        return None;
    }
    let mut value = vec![];
    let mut index = start + 1;
    while let Some(&unit) = input.get(index) {
        match unit {
            34 => return Some((value, index + 1)),
            92 => {
                index += 1;
                value.push(*input.get(index)?);
            }
            _ => value.push(unit),
        }
        index += 1;
    }
    None
}

fn param(input: &[u16], start: usize) -> Option<(AuthParam, usize)> {
    let name_end = token(input, start)?;
    let equals = whitespace(input, name_end);
    if input.get(equals) != Some(&61) {
        return None;
    }
    let value_start = whitespace(input, equals + 1);
    input.get(value_start)?;
    let (value, end) = quoted(input, value_start).unwrap_or_else(|| {
        let mut end = value_start;
        while input
            .get(end)
            .is_some_and(|unit| !matches!(unit, 44 | 32 | 9))
        {
            end += 1;
        }
        (input[value_start..end].to_vec(), end)
    });
    Some(((input[start..name_end].to_vec(), value), end))
}

/// Returns the first parameter-bearing Bearer challenge, or the first bare
/// Bearer challenge when none has parameters. Duplicate parameters stay ordered
/// so the host can apply its Unicode lowercase primitive before last-write wins.
pub fn parse_bearer(input: &[u16]) -> Option<AuthParams> {
    let mut index = 0;
    let mut first_bearer = None;
    while index < input.len() {
        index = whitespace(input, index);
        while input.get(index) == Some(&44) {
            index = whitespace(input, index + 1);
        }
        let scheme_start = index;
        let Some(scheme_end) = token(input, index) else {
            break;
        };
        index = whitespace(input, scheme_end);
        let mut params = vec![];
        if index < input.len() && input[index] != 44 {
            if let Some(end) = token68(input, index) {
                index = end;
            } else if looks_like_param(input, index) {
                while index < input.len() {
                    let Some((entry, end)) = param(input, index) else {
                        break;
                    };
                    params.push(entry);
                    index = whitespace(input, end);
                    if input.get(index) != Some(&44) {
                        break;
                    }
                    index = whitespace(input, index + 1);
                    if !looks_like_param(input, index) {
                        break;
                    }
                }
            }
        }
        let bearer = input[scheme_start..scheme_end]
            .iter()
            .copied()
            .zip("bearer".bytes())
            .all(|(left, right)| left == u16::from(right) || left == u16::from(right - 32))
            && scheme_end - scheme_start == 6;
        if bearer {
            if !params.is_empty() {
                return Some(params);
            }
            first_bearer = Some(params);
        }
        if input.get(index) == Some(&44) {
            index += 1;
        }
    }
    first_bearer
}
