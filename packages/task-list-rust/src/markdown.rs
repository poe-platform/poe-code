//! Markdown task framing without regexes or loss of UTF-16 code units.
fn valid_shape(id: &[u16]) -> bool {
    !id.is_empty()
        && id[0] != 46
        && !id.iter().any(|u| *u == 47 || *u == 92)
        && !id.windows(2).any(|p| p == [46, 46])
}
fn strip_cr(line: &[u16]) -> &[u16] {
    line.strip_suffix(&[13]).unwrap_or(line)
}
fn join(lines: &[&[u16]]) -> Vec<u16> {
    let mut output = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            output.push(10);
        }
        output.extend_from_slice(line);
    }
    output
}
pub fn split_document(content: &[u16], passthrough: bool) -> Option<(Vec<u16>, Vec<u16>)> {
    let lines: Vec<_> = content.split(|u| *u == 10).collect();
    if strip_cr(lines[0]) != [45, 45, 45] {
        return passthrough.then(|| (vec![], content.to_vec()));
    }
    let closing = (1..lines.len()).find(|i| strip_cr(lines[*i]) == [45, 45, 45])?;
    let mut body = closing + 1;
    if body < lines.len() && strip_cr(lines[body]).is_empty() {
        body += 1;
    }
    Some((join(&lines[1..closing]), join(&lines[body..])))
}
pub fn active_filename(filename: &[u16]) -> Option<(Vec<u16>, Option<f64>)> {
    let stem = filename.strip_suffix(&[46, 109, 100])?;
    let prefix = stem.iter().take_while(|u| matches!(**u, 48..=57)).count();
    if prefix > 0 && stem.get(prefix) == Some(&45) && prefix + 1 < stem.len() {
        let id = &stem[prefix + 1..];
        if valid_shape(id) && !id.iter().any(|u| matches!(*u, 10 | 13 | 0x2028 | 0x2029)) {
            let decimal = String::from_utf16_lossy(&stem[..prefix]);
            let order = decimal.parse::<f64>().unwrap_or(f64::INFINITY);
            return Some((id.to_vec(), Some(order)));
        }
    }
    valid_shape(stem).then(|| (stem.to_vec(), None))
}
