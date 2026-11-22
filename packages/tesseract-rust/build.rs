fn main() {
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .include("vendor")
        .file("src/model.cpp")
        .compile("poe_tesseract_model");
    println!("cargo:rerun-if-changed=src/model.cpp");
    println!("cargo:rerun-if-changed=vendor");
    println!("cargo:rerun-if-changed=assets/eng.traineddata");
}
