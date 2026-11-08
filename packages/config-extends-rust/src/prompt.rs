//! Owned prompt composition independent of template rendering and filesystem IO.
use crate::Layer;
use config_mutations_rust::value::Value;
#[derive(Debug, PartialEq)]
pub struct Composed {
    pub prompt: Vec<u16>,
    pub source: Option<Vec<u16>>,
    pub consumed: Vec<usize>,
}
const YIELD_TOKEN: [u16; 9] = [123, 123, 121, 105, 101, 108, 100, 125, 125];
fn count(prompt: &[u16]) -> usize {
    let token = YIELD_TOKEN;
    let mut count = 0;
    let mut position = 0;
    while let Some(offset) = prompt[position..]
        .windows(token.len())
        .position(|window| window == token)
    {
        count += 1;
        position += offset + token.len();
    }
    count
}
fn validate(prompt: &[u16]) -> Result<(), &'static str> {
    if count(prompt) > 1 {
        Err("Prompt composition supports exactly one \"{{yield}}\" token per prompt.")
    } else {
        Ok(())
    }
}
fn replace(prompt: &[u16], replacement: &[u16]) -> Vec<u16> {
    let token = YIELD_TOKEN;
    let mut output = vec![];
    let mut position = 0;
    while let Some(offset) = prompt[position..]
        .windows(token.len())
        .position(|window| window == token)
    {
        let at = position + offset;
        output.extend(&prompt[position..at]);
        output.extend(replacement);
        position = at + token.len();
    }
    output.extend(&prompt[position..]);
    output
}
pub fn compose_prompts(
    document: &Layer,
    bases: &[Layer],
) -> Result<Option<Composed>, &'static str> {
    let mut prompt = match document.data.get("prompt") {
        None | Some(Value::Undefined) => None,
        Some(Value::String(prompt)) => {
            validate(prompt)?;
            Some(prompt.clone())
        }
        _ => return Ok(None),
    };
    let mut source = prompt
        .as_ref()
        .filter(|prompt| !prompt.is_empty())
        .map(|_| document.source.clone());
    let mut consumed = vec![];
    for (index, layer) in bases.iter().enumerate() {
        let low = match layer.data.get("prompt") {
            None | Some(Value::Undefined) => continue,
            Some(Value::String(prompt)) => prompt,
            _ => break,
        };
        validate(low)?;
        consumed.push(index);
        prompt = Some(match &prompt {
            None => replace(low, &[]),
            Some(high) if high.is_empty() => replace(low, &[]),
            Some(high) if count(high) > 0 => replace(high, low),
            Some(high) if count(low) > 0 => replace(low, high),
            Some(high) => high.clone(),
        });
        if source.is_none() && !low.is_empty() {
            source = Some(layer.source.clone());
        }
    }
    match prompt {
        None => Ok(None),
        Some(prompt) => {
            if count(&prompt) > 0 {
                return Err("Final resolved prompt contains an unresolved \"{{yield}}\" token.");
            }
            Ok(Some(Composed {
                prompt,
                source,
                consumed,
            }))
        }
    }
}
