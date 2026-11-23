// Shared bounded wildcard matcher for formulas and table filters. Filter text
// matching follows Univer's line-break semantics; formula lookup accepts them.
pub(super) fn matches(
    pattern: &str,
    text: &str,
    whole: bool,
    line_breaks: bool,
    work: &mut usize,
) -> Option<bool> {
    *work = work.checked_sub(pattern.len().checked_add(text.len())?.checked_mul(24)?)?;
    let input: Vec<_> = text.to_lowercase().chars().collect();
    let lower = pattern.to_lowercase();
    let mut chars = lower.chars().peekable();
    let mut previous = vec![!whole; input.len() + 1];
    previous[0] = true;
    while let Some(mut token) = chars.next() {
        *work = work.checked_sub(1)?;
        let literal = token == '~' && chars.peek().is_some();
        if literal {
            token = chars.next()?;
        }
        let mut next = vec![false; input.len() + 1];
        next[0] = !literal && token == '*' && previous[0];
        for i in 1..=input.len() {
            *work = work.checked_sub(1)?;
            let any = line_breaks || !matches!(input[i - 1], '\n' | '\r' | '\u{2028}' | '\u{2029}');
            next[i] = if !literal && token == '*' {
                previous[i] || (any && next[i - 1])
            } else {
                previous[i - 1] && ((!literal && token == '?' && any) || token == input[i - 1])
            };
        }
        previous = next;
    }
    Some(if whole {
        previous[input.len()]
    } else {
        previous.into_iter().any(|matched| matched)
    })
}
