use napi::bindgen_prelude::*;
use napi_derive::napi;
use process_runner_rust::docker_template::{self, Entry, Template};
#[napi(object)]
pub struct BuildPair {
    pub key: Utf16String,
    pub value: Utf16String,
}
#[napi(object)]
pub struct BuildFile {
    pub path: Utf16String,
    pub bytes: Buffer,
}
fn pairs(input: Vec<BuildPair>) -> Vec<(Vec<u16>, Vec<u16>)> {
    input
        .into_iter()
        .map(|pair| (pair.key.to_vec(), pair.value.to_vec()))
        .collect()
}
#[napi]
pub struct DockerTemplate {
    plan: Template,
}
#[napi]
impl DockerTemplate {
    #[napi(constructor)]
    pub fn new(
        dockerfile: BufferSlice<'_>,
        files: Vec<BuildFile>,
        args: Vec<BuildPair>,
        engine: Utf16String,
    ) -> Self {
        let entries = files
            .iter()
            .map(|file| Entry {
                path: &file.path,
                bytes: &file.bytes,
            })
            .collect::<Vec<_>>();
        Self {
            plan: Template::new(docker_template::hash(
                &dockerfile,
                &entries,
                &pairs(args),
                &engine,
            )),
        }
    }
    #[napi(getter)]
    pub fn hash(&self) -> String {
        self.plan.hash.clone()
    }
    #[napi(getter)]
    pub fn image(&self) -> String {
        self.plan.image()
    }
    #[napi]
    pub fn cached(&self, force: bool, image: Option<Utf16String>, code: i32) -> bool {
        self.plan.cached(force, image.as_deref(), code)
    }
    #[napi]
    pub fn build_args(
        &self,
        engine: Utf16String,
        context: Option<Utf16String>,
        dockerfile: Utf16String,
        directory: Utf16String,
        args: Vec<BuildPair>,
    ) -> Vec<Utf16String> {
        self.plan
            .build_args(
                &engine,
                context.as_deref(),
                &dockerfile,
                &directory,
                &pairs(args),
            )
            .into_iter()
            .map(Into::into)
            .collect()
    }
}
#[napi]
pub fn docker_template_path_inside(relative: Utf16String, absolute: bool) -> bool {
    docker_template::inside(&relative, absolute)
}
