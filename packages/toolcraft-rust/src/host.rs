//! Synchronous host capabilities shared by native schema traversals.
pub trait Host {
    type Value: Copy;
    type Error;
    fn call(&mut self, name: &str, args: Vec<Self::Value>) -> Result<Self::Value, Self::Error>;
    fn get(&mut self, value: Self::Value, key: &str) -> Result<Self::Value, Self::Error>;
    fn is_undefined(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_nullish(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_true(&self, value: Self::Value) -> Result<bool, Self::Error>;
    fn is_kind(&self, value: Self::Value, kind: &str) -> Result<bool, Self::Error>;
    fn same(&self, left: Self::Value, right: Self::Value) -> Result<bool, Self::Error>;
}
