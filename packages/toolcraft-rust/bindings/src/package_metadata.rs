use napi::bindgen_prelude::*;
use napi_derive::napi;
use toolcraft_rust::package_metadata::{self, PackageMetadataHost};

struct Host<'env>(Object<'env>);

impl PackageMetadataHost for Host<'_> {
    type Error = napi::Error;

    fn realpath(&mut self, path: &[u16]) -> Result<Vec<u16>> {
        let function: Function<Utf16String, Utf16String> = self.0.get_named_property("realpath")?;
        Ok(function.call(path.to_vec().into())?.to_vec())
    }
    fn is_directory(&mut self, path: &[u16]) -> Result<bool> {
        let function: Function<Utf16String, bool> = self.0.get_named_property("isDirectory")?;
        function.call(path.to_vec().into())
    }
    fn parent(&mut self, path: &[u16]) -> Result<Vec<u16>> {
        let function: Function<Utf16String, Utf16String> = self.0.get_named_property("parent")?;
        Ok(function.call(path.to_vec().into())?.to_vec())
    }
    fn package_path(&mut self, path: &[u16]) -> Result<Vec<u16>> {
        let function: Function<Utf16String, Utf16String> =
            self.0.get_named_property("packagePath")?;
        Ok(function.call(path.to_vec().into())?.to_vec())
    }
    fn exists(&mut self, path: &[u16]) -> Result<bool> {
        let function: Function<Utf16String, bool> = self.0.get_named_property("exists")?;
        function.call(path.to_vec().into())
    }
}

#[napi]
pub fn find_package_path(from: Utf16String, host: Object<'_>) -> Result<Option<Utf16String>> {
    package_metadata::find_package_path(&from, &mut Host(host)).map(|value| value.map(Into::into))
}
