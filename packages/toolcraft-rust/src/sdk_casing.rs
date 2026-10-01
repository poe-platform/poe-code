//! SDK word boundaries use UTF-16 code units. Casing itself belongs to the
//! caller's Unicode runtime, including contextual lowercasing of whole words.
pub fn format<E>(
    value: &[u16],
    mut lower: impl FnMut(&[u16]) -> Result<Vec<u16>, E>,
    mut upper: impl FnMut(&[u16]) -> Result<Vec<u16>, E>,
) -> Result<Vec<u16>, E> {
    let mut words = Vec::new();
    let mut current = Vec::new();
    for (index, unit) in value.iter().copied().enumerate() {
        let character = [unit];
        let lowercase = lower(&character)?;
        let uppercase = upper(&character)?;
        if [45, 95, 32, 46].contains(&unit) {
            if !current.is_empty() {
                words.push(lower(&current)?);
                current.clear();
            }
            continue;
        }
        let is_upper = character.as_slice() != lowercase && character.as_slice() == uppercase;
        let previous_lower = if index > 0 {
            let previous = &value[index - 1..index];
            previous == lower(previous)? && previous != upper(previous)?
        } else {
            false
        };
        let next_lower = if index + 1 < value.len() {
            let next = &value[index + 1..index + 2];
            next == lower(next)? && next != upper(next)?
        } else {
            false
        };
        if is_upper && !current.is_empty() && (previous_lower || next_lower) {
            words.push(lower(&current)?);
            current.clear();
        }
        current.push(unit);
    }
    if !current.is_empty() {
        words.push(lower(&current)?);
    }
    let mut result = Vec::new();
    for (index, word) in words.into_iter().enumerate() {
        if index == 0 || word.is_empty() {
            result.extend(word);
        } else {
            result.extend(upper(&word[..1])?);
            result.extend(&word[1..]);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::format;

    #[test]
    fn host_casing_can_return_empty_words() {
        let result = format::<()>(
            &"first_second".encode_utf16().collect::<Vec<_>>(),
            |_| Ok(Vec::new()),
            |value| Ok(value.to_vec()),
        );
        assert_eq!(result, Ok(Vec::new()));
    }
}
