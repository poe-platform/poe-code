//! Codec snapshots. Host merge operations retain foreign object identities.
use crate::temporal::Temporal;
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Undefined,
    Bool(bool),
    Number(f64),
    String(Vec<u16>),
    BigInt(Vec<u16>),
    Symbol(Vec<u16>),
    Date(Temporal),
    /// Host-rendered Date text, after host validity and hook evaluation.
    DateLiteral(Vec<u16>),
    Array(Vec<Value>),
    Object(Vec<(Vec<u16>, Value)>),
    Unsupported(Vec<u16>),
}
impl Value {
    pub fn get(&self, name: &str) -> Option<&Self> {
        let Self::Object(properties) = self else {
            return None;
        };
        let key: Vec<_> = name.encode_utf16().collect();
        properties
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value)
    }
}
