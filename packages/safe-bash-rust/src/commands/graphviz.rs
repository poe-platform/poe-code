pub use diagram_renderer_rust::render_dot_svg;
use diagram_renderer_rust::graphviz::Options as GvLayoutOptions;

fn gv_render_graph(source: &str, format: &str, layout: &str, options: &GvLayoutOptions) -> Result<Vec<u8>, String> {
    let (bytes, graph_width, graph_height) = diagram_renderer_rust::graphviz::render_legacy(source, format, layout, options)?;
    if matches!(format, "svg" | "canon" | "json" | "plain" | "dot") { return Ok(bytes); }
    let svg_str = String::from_utf8(bytes).map_err(|_| "Invalid SVG UTF-8")?;
    if format == "pdf" {
        let root = parse_svg_xml(&svg_str)?;
        let width = parse_svg_length_px(root.get_attr("width"), graph_width)?;
        let height = parse_svg_length_px(root.get_attr("height"), graph_height)?;
        let mut texts = Vec::new();
        collect_svg_texts(&root, &mut texts);
        let mut doc = PdfDoc::new();
        doc.version = "1.7".to_string();
        doc.page_w = width * 0.75;
        doc.page_h = height * 0.75;
        doc.pages.push(PdfPage {
            rot: 0,
            text: texts.join("\n"),
            html: String::new(),
            images: Vec::new(),
            urls: Vec::new(),
        });
        return Ok(doc.serialize());
    }
    let area = graph_width.ceil() * graph_height.ceil();
    if !area.is_finite() || area > 16_000_000.0 {
        return Err("raster pixel limit exceeded".to_string());
    }
    if !matches!(format, "png" | "jpg" | "jpeg" | "webp") {
        return Err(format!("unknown format: {format}"));
    }
    let base_w: f64 = format!("{}", js_math_round(graph_width * 1000.) / 1000.).parse().unwrap_or(graph_width);
    let base_h: f64 = format!("{}", js_math_round(graph_height * 1000.) / 1000.).parse().unwrap_or(graph_height);
    let w = js_math_round(base_w).max(1.0) as u32;
    let h = js_math_round(base_h).max(1.0) as u32;
    let fmt = match format {
        "png" => "PNG",
        "jpg" | "jpeg" => "JPEG",
        "webp" => "WEBP",
        _ => "PNG",
    };
    let im = ImageMeta {
        fmt: fmt.to_string(),
        w,
        h,
        cs: "sRGB".to_string(),
        exif: BTreeMap::new(),
    };
    Ok(write_image_bytes(&im))
}


fn cmd_graphviz(
    name: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut format = "svg".to_string();
    let mut layout = name.to_string();
    let mut outfile = "-".to_string();
    let mut end = false;
    let mut files: Vec<String> = Vec::new();
    let mut options = GvLayoutOptions::default();
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !end && arg == "--" {
            end = true;
            i += 1;
            continue;
        }
        if !end && (arg == "--help" || arg == "-?") {
            return ok_out(&format!(
                "Usage: {name} [-Tsvg|pdf|png|jpg|jpeg|webp|json|dot|canon|plain] [-o FILE]\n       [-Gname=value] [-Nname=value] [-Ename=value] [-Kdot|neato] [FILE ...]\nReads stdin when FILE is omitted or -. -V prints version.\n"
            ));
        }
        if !end && arg == "-V" {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: format!("{name} (Safe Bash Graphviz) 0.0.1\n"),
                exit_code: 0,
            };
        }
        if !end && arg.starts_with('-') && arg != "-" {
            let flag = arg.as_bytes()[1] as char;
            let value = if arg.len() > 2 {
                Some(arg[2..].to_string())
            } else {
                i += 1;
                args.get(i).cloned()
            };
            let Some(val) = value.filter(|v| !v.is_empty()) else {
                return err_out(&format!("{name}: missing value for -{flag}\n"), 1);
            };
            if flag == 'T' {
                format = val;
            } else if flag == 'K' {
                layout = val;
            } else if flag == 'o' {
                outfile = val;
            } else if flag == 'G' || flag == 'N' || flag == 'E' {
                let Some(eq) = val.find('=') else {
                    return err_out(&format!("{name}: expected -{flag}name=value\n"), 1);
                };
                if eq < 1 {
                    return err_out(&format!("{name}: expected -{flag}name=value\n"), 1);
                }
                let k = val[..eq].to_string();
                let v = val[eq + 1..].to_string();
                match flag {
                    'G' => options.graph.set(k, v),
                    'N' => options.node.set(k, v),
                    _ => options.edge.set(k, v),
                }
            } else {
                return err_out(&format!("{name}: unknown option: {arg}\n"), 1);
            }
            i += 1;
            continue;
        }
        files.push(arg.to_string());
        i += 1;
    }
    if !matches!(
        format.as_str(),
        "svg" | "pdf" | "png" | "jpg" | "jpeg" | "webp" | "json" | "dot" | "canon" | "plain"
    ) {
        return err_out(&format!("{name}: unknown format: {format}\n"), 1);
    }
    if layout != "dot" && layout != "neato" {
        return err_out(
            &format!("{name}: unsupported layout: {layout} (choose dot or neato)\n"),
            1,
        );
    }
    if files.is_empty() {
        files.push("-".to_string());
    }
    let mut total_in = 0usize;
    let mut out_bytes: Vec<u8> = Vec::new();
    for file in &files {
        let raw_bytes = if file == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, file);
            if fs.is_dir(&full) {
                return err_out(
                    &format!("{name}: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                    1,
                );
            }
            match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => {
                    return err_out(
                        &format!("{name}: ENOENT: no such file or directory, readFile '{full}'\n"),
                        1,
                    );
                }
            }
        };
        total_in += raw_bytes.len();
        if total_in > 1_048_576 {
            return err_out(&format!("{name}: input byte limit exceeded\n"), 1);
        }
        let Ok(source) = String::from_utf8(raw_bytes) else {
            return err_out(&format!("{name}: invalid utf-8 input\n"), 1);
        };
        let rendered = match gv_render_graph(&source, &format, &layout, &options) {
            Ok(b) => b,
            Err(e) => return err_out(&format!("{name}: {e}\n"), 1),
        };
        if out_bytes.len() + rendered.len() > 16_777_216 {
            return err_out(&format!("{name}: output byte limit exceeded\n"), 1);
        }
        out_bytes.extend_from_slice(&rendered);
    }
    if outfile == "-" {
        ok_out(&crate::vfs::bytes_to_stream_string(&out_bytes))
    } else {
        let full = resolve_posix_path(cwd, &outfile);
        let _ = fs.write_file(&full, &out_bytes);
        ok_out("")
    }
}


#[cfg(test)]
mod graphviz_unit_tests {
    use super::*;
    use crate::vfs::MemoryVfs;
    fn gv_args(list: &[&str]) -> Vec<String> { list.iter().map(|s| s.to_string()).collect() }
    #[test]
    fn explicit_dot_styles_override_command_line_defaults() {
        let source = include_str!("../../../graphviz-ast/fixtures/styles.dot");
        let vfs = MemoryVfs::new();
        let defaults = ["-Gbgcolor=#000000", "-Nfillcolor=#edf5ff", "-Nshape=box", "-Nstyle=rounded,filled", "-Ecolor=#637f96"];
        let mut args = gv_args(&defaults);
        args.push("-Tsvg".into());
        let svg = cmd_graphviz("dot", &args, source, "/", &vfs);
        assert_eq!(svg.exit_code, 0, "{}", svg.stderr);
        for color in ["#fffaf0", "#edf5ff", "#ccfbf1", "#e0f2fe", "#fce7f3"] {
            assert!(svg.stdout.contains(&format!("fill=\"{color}\"")), "missing fill {color}");
        }
        for color in ["#d97706", "#637f96", "#7c3aed"] {
            assert!(svg.stdout.contains(&format!("stroke=\"{color}\"")), "missing stroke {color}");
        }
        assert!(!svg.stdout.contains("fill=\"#000000\""));
        let fallback = cmd_graphviz("dot", &args, "digraph { a }", "/", &vfs);
        assert_eq!(fallback.exit_code, 0);
        assert!(fallback.stdout.contains("fill=\"#000000\""));
        *args.last_mut().unwrap() = "-Tcanon".into();
        let canon = cmd_graphviz("dot", &args, source, "/", &vfs);
        assert_eq!(canon.exit_code, 0);
        let canonical_svg = cmd_graphviz("dot", &gv_args(&["-Tsvg"]), &canon.stdout, "/", &vfs);
        assert_eq!(canonical_svg.exit_code, 0);
        assert_eq!(svg.stdout, canonical_svg.stdout);
        let public_svg = render_dot_svg(source, &[("bgcolor", "#000000")],
            &[("fillcolor", "#edf5ff"), ("shape", "box"), ("style", "rounded,filled")],
            &[("color", "#637f96")]).unwrap();
        assert_eq!(svg.stdout.as_bytes(), public_svg);
    }

    #[test]
    fn unit_graphviz_formats_svg_json_plain_dot_canon_and_png() {


        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work").unwrap();
        let src = "digraph Pipeline { rankdir=LR; start [shape=box]; start -> end [label=\"ok\"]; }\n";
        vfs.write_file("/work/p.dot", src.as_bytes()).unwrap();

        for fmt in ["svg", "json", "plain", "dot", "canon", "pdf"] {
            let flag = format!("-T{fmt}");
            let out = cmd_graphviz("dot", &gv_args(&[&flag, "/work/p.dot"]), "", "/work", &vfs);
            assert_eq!(out.exit_code, 0, "format {fmt} failed: {}", out.stderr);
            assert!(!out.stdout.is_empty());
        }

        let png = cmd_graphviz(
            "dot",
            &gv_args(&["-Tpng", "-o", "/work/p.png", "/work/p.dot"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(png.exit_code, 0);
        let png_bytes = vfs.read_file("/work/p.png").unwrap();
        assert!(png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
    }

    #[test]
    fn unit_graphviz_neato_attributes_and_error_validation() {
        let vfs = MemoryVfs::new();
        let neato = cmd_graphviz(
            "neato",
            &gv_args(&["-Tjson", "-Gpad=0.2", "-Nshape=ellipse", "-Ecolor=blue"]),
            "graph G { a -- b -- c; }\n",
            "/",
            &vfs,
        );
        assert_eq!(neato.exit_code, 0);
        assert!(neato.stdout.contains("\"id\"") && neato.stdout.contains("\"nodes\""));

        let bad_fmt = cmd_graphviz("dot", &gv_args(&["-Tinvalid"]), "digraph { a -> b }", "/", &vfs);
        assert_eq!(bad_fmt.exit_code, 1);
        assert!(bad_fmt.stderr.contains("unknown format"));

        let bad_layout = cmd_graphviz("dot", &gv_args(&["-Ktwopi"]), "digraph { a -> b }", "/", &vfs);
        assert_eq!(bad_layout.exit_code, 1);
        assert!(bad_layout.stderr.contains("unsupported layout"));

        vfs.mkdir_all("/dir").unwrap();
        let missing = cmd_graphviz("dot", &gv_args(&["/dir/missing.dot"]), "", "/dir", &vfs);
        assert_eq!(missing.exit_code, 1);
        assert_eq!(
            missing.stderr,
            "dot: ENOENT: no such file or directory, readFile '/dir/missing.dot'\n"
        );
        let dir_err = cmd_graphviz("neato", &gv_args(&["/dir"]), "", "/", &vfs);
        assert_eq!(dir_err.exit_code, 1);
        assert_eq!(
            dir_err.stderr,
            "neato: EISDIR: illegal operation on a directory, readFile '/dir'\n"
        );
    }

    #[test]
    fn unit_graphviz_stdin_and_subgraph_cluster_rendering() {
        let vfs = MemoryVfs::new();
        let out = cmd_graphviz(
            "dot",
            &gv_args(&["-Tjson"]),
            "digraph G { subgraph cluster_0 { a -> b; } b -> c; }\n",
            "/",
            &vfs,
        );
        assert_eq!(out.exit_code, 0);
        assert!(out.stdout.contains("\"directed\": true") || out.stdout.contains("\"directed\":true"));
    }
}
