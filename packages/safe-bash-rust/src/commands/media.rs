#[derive(Clone, Debug)]
struct ImageMeta {
    fmt: String,
    w: u32,
    h: u32,
    cs: String,
    exif: BTreeMap<String, String>,
}

impl ImageMeta {
    fn has_alpha(&self, channels: u8) -> bool {
        matches!(channels, 2 | 4) && self.cs != "CMYK"
            || self.fmt == "TIFF" && self.cs == "Gray" && channels == 3
    }
}

fn format_from_path(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "JPEG"
    } else if lower.ends_with(".webp") {
        "WEBP"
    } else if lower.ends_with(".gif") {
        "GIF"
    } else if lower.ends_with(".bmp") {
        "BMP"
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        "TIFF"
    } else if lower.ends_with(".ppm") {
        "PPM"
    } else if lower.ends_with(".pgm") {
        "PGM"
    } else if lower.ends_with(".pbm") {
        "PBM"
    } else {
        "PNG"
    }
}

fn try_magick_list_option(args: &[String]) -> Option<BuiltinOutcome> {
    let limit = args.iter().position(|a| a == "--").unwrap_or(args.len());
    for i in 0..limit {
        let a = args[i].as_str();
        if a == "-list" || a == "--list" {
            let lt = args.get(i + 1).map(|s| s.to_ascii_lowercase()).unwrap_or_else(|| "list".to_string());
            if lt == "font" || lt == "type" {
                return Some(ok_out(concat!(
                    "  Font: DejaVu-Sans\n    family: DejaVu Sans\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: DejaVu-Sans-Bold\n    family: DejaVu Sans\n    style: Normal\n    stretch: Normal\n    weight: 700\n",
                    "  Font: DejaVu-Sans-Mono\n    family: DejaVu Sans Mono\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Arial\n    family: Arial\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Helvetica\n    family: Helvetica\n    style: Normal\n    stretch: Normal\n    weight: 400\n",
                    "  Font: Liberation-Sans\n    family: Liberation Sans\n    style: Normal\n    stretch: Normal\n    weight: 400\n"
                )));
            }
            if lt == "format" {
                return Some(ok_out(concat!(
                    "   Format  Module    Mode  Description\n",
                    "-------------------------------------------------------------------------------\n",
                    "      BMP* BMP       rw-   Microsoft Windows bitmap image\n",
                    "      GIF* GIF       rw+   CompuServe graphics interchange format\n",
                    "     JPEG* JPEG      rw-   Joint Photographic Experts Group JFIF format\n",
                    "      JPG* JPEG      rw-   Joint Photographic Experts Group JFIF format\n",
                    "      PNG* PNG       rw-   Portable Network Graphics\n",
                    "      PPM* PNM       rw+   Portable pixmap format (color)\n",
                    "      SVG* SVG       r--   Scalable Vector Graphics\n",
                    "     TIFF* TIFF      rw+   Tagged Image File Format\n",
                    "     WEBP* WEBP      rw-   WebP Image Format\n"
                )));
            }
            if lt == "color" {
                return Some(ok_out(concat!(
                    "Name                  Color                   Compliance\n",
                    "-------------------------------------------------------------------------------\n",
                    "black                 srgb(0,0,0)             SVG, X11, XPM\n",
                    "white                 srgb(255,255,255)       SVG, X11, XPM\n",
                    "red                   srgb(255,0,0)           SVG, X11, XPM\n",
                    "green                 srgb(0,128,0)           SVG\n",
                    "blue                  srgb(0,0,255)           SVG, X11, XPM\n",
                    "transparent           srgba(0,0,0,0)          SVG, X11, XPM\n"
                )));
            }
            if lt == "configure" {
                return Some(ok_out(concat!(
                    "Name                  Value\n",
                    "-------------------------------------------------------------------------------\n",
                    "DELEGATES             png jpeg webp tiff gif svg freetype\n",
                    "FEATURES              Cipher DPC\n",
                    "NAME                  ImageMagick\n",
                    "VERSION               7.1.1\n"
                )));
            }
            return Some(ok_out("color\nconfigure\ndelegate\nfont\nformat\nlocale\nlog\nmagic\nmodule\nresource\nthreshold\ntype\n"));
        }
    }
    None
}

const EXIF_TAGS: &[&str] = &["Artist","Title","Author","Description","ImageDescription","Software","Comment","Copyright","ModifyDate",
                "ImageWidth","ImageHeight","BitDepth","ColorType","FileName","Directory","FileSize","FileTypeExtension","FileType",
                "MIMEType","ImageSize","Subject","Keywords","Creator","Producer","CreateDate","PDFVersion","PageCount","Make",
                "Model","Orientation","DateTime","XResolution","YResolution","ResolutionUnit","ExposureTime","FNumber","ISO",
                "DateTimeOriginal","FocalLength","LensModel","UserComment"];

#[path = "exiftool_png.rs"]
mod exiftool_png;
#[path = "exiftool_json.rs"]
mod exiftool_json;
#[path = "qpdf_argfiles.rs"]
mod qpdf_argfiles;
#[path = "exiftool_argfiles.rs"]
mod exiftool_argfiles;
#[path = "fax.rs"]
mod fax;
#[path = "tiff.rs"]
mod tiff;
#[path = "bmp.rs"]
mod bmp;
#[path = "identify.rs"]
mod identify;
#[path = "netpbm.rs"]
mod netpbm;
#[path = "sips_geometry.rs"]
mod sips_geometry;
#[path = "sips_properties.rs"]
mod sips_properties;
#[path = "image_header.rs"]
mod image_header;
#[path = "gif.rs"]
mod gif;
#[path = "heif.rs"]
mod heif;
#[path = "webp.rs"]
mod webp;
#[path = "png_pixels.rs"]
mod png_pixels;
#[path = "magick_stack.rs"]
mod magick_stack;
#[path = "magick_coordinates.rs"]
mod magick_coordinates;
#[path = "magick_morphology.rs"]
mod magick_morphology;
#[path = "magick_filter.rs"]
mod magick_filter;
#[path = "magick_histogram.rs"]
mod magick_histogram;
#[path = "magick_resize.rs"]
mod magick_resize;
#[path = "magick_composite.rs"]
mod magick_composite;
#[path = "magick_compare.rs"]
mod magick_compare;
#[path = "magick_color.rs"]
mod magick_color;
use magick_color::Canvas;
pub(super) use magick_color::{css_named_color, parse_color};

fn apply_magick_resize_geom(w: u32, h: u32, spec: &str) -> (u32, u32) {
    let units = magick_coordinates::split_offsets(spec).0;
    let dims = units.trim_end_matches(['%', '@', '!', '<', '>', '^']);
    let mut axes = dims.split(['x', 'X']);
    let axis = |s: &str| {
        s.trim_end_matches('%')
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite())
    };
    let horizontal = axes.next().unwrap_or("");
    let vertical = axes.next().unwrap_or("");
    let (x, y) = (axis(horizontal), axis(vertical));
    let (sw, sh) = (f64::from(w), f64::from(h));
    let size = |a: f64, b: f64| (a.round().max(1.) as u32, b.round().max(1.) as u32);
    let scaled = |k: f64| size(sw * k, sh * k);
    let shrink = spec.contains('>');
    let enlarge = spec.contains('<');
    let area = spec.contains('@');
    if area && !dims.contains(['x', 'X']) {
        let k = (x.unwrap_or(1.).max(1.) / (sw * sh).max(1.)).sqrt();
        return if shrink && k >= 1. || enlarge && k <= 1. {
            (w, h)
        } else {
            scaled(k)
        };
    }
    if !area && spec.contains('%') {
        let px = if horizontal.is_empty() { y } else { x };
        let py = if vertical.is_empty() { x } else { y };
        return size(
            sw * (px.unwrap_or(100.) / 100.),
            sh * (py.unwrap_or(100.) / 100.),
        );
    }
    if x.is_none() && y.is_none() && !area {
        return (w, h);
    }
    let (mut tw, mut th) = (x.unwrap_or(sw), y.unwrap_or(sh));
    if area {
        tw = x.unwrap_or(1.).max(1.);
        th = y.unwrap_or(1.).max(1.);
    }
    let exact = spec.contains('!');
    if exact {
        (tw, th) = (tw.round().max(1.), th.round().max(1.));
    }
    if shrink && sw <= tw && sh <= th || enlarge && sw >= tw && sh >= th {
        return (w, h);
    }
    if exact {
        return size(tw, th);
    }
    let sx = tw / sw.max(1.);
    let sy = th / sh.max(1.);
    if spec.contains('^') {
        scaled(sx.max(sy))
    } else if x.is_none() && !area {
        size(sw * sy, th)
    } else if y.is_none() && !area {
        size(tw, sh * sx)
    } else {
        scaled(sx.min(sy))
    }
}

fn read_image_meta(bytes: &[u8], path: &str) -> ImageMeta {
    if let Some(fmt)=heif::format(bytes){return heif::header(bytes).image_meta(fmt);}
    let mut meta = ImageMeta {
        fmt: format_from_path(path).to_string(),
        w: 32,
        h: 32,
        cs: "sRGB".to_string(),
        exif: BTreeMap::new(),
    };
    if bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        meta.fmt = "PNG".to_string();
        if matches!(bytes.get(25), Some(0 | 4)) {
            meta.cs = "Gray".to_string();
        }
        meta.w = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        meta.h = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        meta.fmt = "JPEG".to_string();
        if let Ok(header) = image_header::jpeg(bytes) {
            (meta.w, meta.h) = (header.width, header.height);
        }
    } else if webp::signature(bytes) {
        meta.fmt = "WEBP".into();
        if let Ok(h) = webp::header(bytes) { (meta.w, meta.h) = (h.width, h.height); }
    } else if bytes.starts_with(b"GIF8") {
        meta.fmt = "GIF".to_string();
        if gif::signature(bytes) && let Ok(dims) = gif::dimensions(bytes) { (meta.w, meta.h) = dims; }
    }
    for line in bytes.split_inclusive(|&b| b == b'\n') {
        if !(line.starts_with(b"__IMG__:") || line.starts_with(b"__EXIF__:")) {
            continue;
        }
        let line = String::from_utf8_lossy(line.strip_suffix(b"\r\n").or_else(|| line.strip_suffix(b"\n")).unwrap_or(line));
        if let Some(rest) = line.strip_prefix("__IMG__:") {
            for kv in rest.split(';') {
                if let Some((k, v)) = kv.split_once('=') {
                    match k {
                        "fmt" => meta.fmt = v.to_string(),
                        "w" => meta.w = v.parse().unwrap_or(meta.w),
                        "h" => meta.h = v.parse().unwrap_or(meta.h),
                        "cs" => meta.cs = v.to_string(),
                        _ => {}
                    }
                }
            }
        } else if let Some(rest) = line.strip_prefix("__EXIF__:")
            && let Some((k, v)) = rest.split_once('=')
        {
            if v.is_empty() {
                if k.eq_ignore_ascii_case("all") {
                    meta.exif.clear();
                } else {
                    meta.exif.remove(k);
                }
            } else {
                meta.exif.insert(k.to_string(), v.to_string());
            }
        }
    }
    meta
}

use crate::commands::js_number;

// JavaScript parseFloat accepts a numeric prefix followed by units.
fn parse_float_prefix(raw:&str)->f64{
    let s=raw.trim_start();
    let b=s.as_bytes();
    let mut i=usize::from(matches!(b.first(),Some(b'+'|b'-')));
    if s[i..].starts_with("Infinity"){
        if s.starts_with('-'){f64::NEG_INFINITY}else{f64::INFINITY}
    }else{
        while b.get(i).is_some_and(u8::is_ascii_digit){i+=1;}
        if b.get(i)==Some(&b'.'){i+=1;while b.get(i).is_some_and(u8::is_ascii_digit){i+=1;}}
        if matches!(b.get(i),Some(b'e'|b'E')){
            let mut j=i+1+usize::from(matches!(b.get(i+1),Some(b'+'|b'-')));
            if b.get(j).is_some_and(u8::is_ascii_digit){while b.get(j).is_some_and(u8::is_ascii_digit){j+=1;}i=j;}
        }
        s[..i].parse().unwrap_or(f64::NAN)
    }
}

fn magick_fuzz(raw:&str)->f64{
    let value=parse_float_prefix(raw);
    if raw.ends_with('%'){value/100.*255.}else{value}
}

fn inspect_raster(bytes: &[u8], path: &str, limit: usize) -> Result<(ImageMeta, u8, u8, u32), &'static str> {
    if let Some(fmt)=heif::format(bytes){let h=heif::header(bytes);return Ok((h.image_meta(fmt),h.depth,h.channels,h.density));}
    if !image_header::recognized_image(bytes) { return Err("Input buffer contains unsupported image format"); }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() < 24 { return Err("Invalid PNG header"); }
    let mut meta = read_image_meta(bytes, path);
    let (depth, channels, dpi) = if netpbm::signature(bytes) && let Ok(im) = netpbm::Netpbm::parse(bytes, limit) {
        meta.w = im.width as u32;
        meta.h = im.height as u32;
        let gray = im.codec() != b"ppm ";
        meta.fmt = std::str::from_utf8(im.codec()).unwrap().trim_end().to_ascii_uppercase();
        meta.cs = if gray { "Gray" } else { "sRGB" }.into();
        (im.bit_depth(), if gray { 1 } else { 3 }, 72)
    } else if gif::signature(bytes) && !bytes[6..].starts_with(b"\n__IMG__:") {
        (meta.w,meta.h) = gif::dimensions(bytes)?;
        (8,4,72)
    } else if webp::signature(bytes) && !bytes[12..].starts_with(b"\n__IMG__:") {
        let h = webp::header(bytes)?;
        (8, if h.alpha { 4 } else { 3 }, h.density)
    } else if tiff::signature(bytes) {
        let im = tiff::Tiff::parse(bytes,limit)?;
        if im.width==0 || im.height==0 {return Err("Invalid TIFF dimensions");}
        meta.w=im.width as u32; meta.h=im.height as u32; meta.fmt="TIFF".into();
        meta.cs=if im.samples<3 {"Gray"} else {"sRGB"}.into();
        (im.depth, if im.samples==2 {3} else {im.samples as u8}, im.density)
    } else if bmp::signature(bytes) && let Ok(im) = bmp::Bmp::parse(bytes, limit) {
        meta.w = im.width as u32;
        meta.h = im.height as u32;
        meta.fmt = "BMP".into();
        (8, if im.bpp == 32 { 4 } else { 3 }, im.density)
    } else if bytes.starts_with(b"\xff\xd8\xff") && bytes.get(20..29) != Some(b"\n__IMG__:") {
        let header = image_header::jpeg(bytes)?;
        let (w,h,channels,dpi)=(header.width,header.height,header.channels,header.density);
        (meta.w, meta.h) = (w, h);
        meta.cs = match channels { 1 => "Gray", 4 => "CMYK", _ => "sRGB" }.into();
        (8, channels, dpi)
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.get(29..38) != Some(b"\n__IMG__:") && let Ok(header) = image_header::Png::read(bytes, |_| Ok(())) {
        let (w, h, depth, color) = header.ihdr.map_or((0, 0, 8, 6), |v| (
            u32::from_be_bytes(v[..4].try_into().unwrap()), u32::from_be_bytes(v[4..8].try_into().unwrap()), v[8], v[9]));
        (meta.w, meta.h) = (w, h);
        let gray = matches!(color, 0 | 4);
        meta.cs = if gray { "Gray" } else { "sRGB" }.into();
        let alpha = matches!(color, 4 | 6) || header.transparency.is_some();
        (depth, (if gray { 1 } else { 3 }) + u8::from(alpha), header.density)
    } else { (8, 3, 72) };
    Ok((meta, depth, channels, dpi))
}

fn write_image_bytes(meta: &ImageMeta) -> Vec<u8> {
    let mut buf = match meta.fmt.as_str() {
        "PNG" => {
            let mut b = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
            b.extend_from_slice(&meta.w.to_be_bytes());
            b.extend_from_slice(&meta.h.to_be_bytes());
            b.extend_from_slice(b"\x08\x02\x00\x00\x00");
            b
        }
        "JPEG" => b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00".to_vec(),
        "GIF" => b"GIF89a".to_vec(),
        "WEBP" => b"RIFF\x24\x00\x00\x00WEBP".to_vec(),
        "BMP" => b"BM\x36\x00\x00\x00".to_vec(),
        "TIFF" => b"II*\x00\x08\x00\x00\x00".to_vec(),
        "PPM" => format!("P6\n{} {}\n255\n", meta.w, meta.h).into_bytes(),
        "PGM" => format!("P5\n{} {}\n255\n", meta.w, meta.h).into_bytes(),
        "PBM" => format!("P4\n{} {}\n", meta.w, meta.h).into_bytes(),
        _ => {
            let mut b = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
            b.extend_from_slice(&meta.w.to_be_bytes());
            b.extend_from_slice(&meta.h.to_be_bytes());
            b.extend_from_slice(b"\x08\x02\x00\x00\x00");
            b
        }
    };
    buf.extend_from_slice(
        format!("\n__IMG__:fmt={};w={};h={};cs={}", meta.fmt, meta.w, meta.h, meta.cs).as_bytes(),
    );
    for (k, v) in &meta.exif {
        buf.extend_from_slice(format!("\n__EXIF__:{k}={v}").as_bytes());
    }
    buf
}

fn hex_enc(data: &[u8]) -> String {
    let mut s = String::with_capacity(data.len() * 2);
    for &b in data {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_dec(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if let Ok(st) = std::str::from_utf8(&bytes[i..i + 2])
            && let Ok(v) = u8::from_str_radix(st, 16)
        {
            out.push(v);
        }
        i += 2;
    }
    out
}

fn hex_dec_str(s: &str) -> String {
    String::from_utf8_lossy(&hex_dec(s)).to_string()
}

#[derive(Clone, Debug, Default)]
struct PdfPage {
    rot: i32,
    text: String,
    html: String,
    images: Vec<(u32, u32, String)>,
    urls: Vec<String>,
}

#[derive(Clone, Debug)]
struct PdfDoc {
    version: String,
    title: String,
    author: String,
    trailer_id: Option<Vec<u8>>,
    pdf_id0: String,
    pdf_id1: String,
    encrypted: Option<String>,
    linearized: bool,
    page_w: f64,
    page_h: f64,
    direct_media: BTreeMap<usize,[f64;4]>,
    page_media: BTreeMap<usize, (f64, f64, Option<[f64; 4]>)>,
    info: Vec<(String, String)>,
    bookmarks: Vec<(String, String, String)>,
    page_labels: Vec<(String, String, String, String)>,
    attachments: Vec<(String, String, String, Vec<u8>)>,
    pages: Vec<PdfPage>,
    exif: BTreeMap<String, String>,
}

#[path = "wkhtmltopdf.rs"]
mod wkhtmltopdf;

#[path = "office.rs"]
mod office;

#[path = "pdf_reader.rs"]
mod pdf_reader;
pub(super) use pdf_reader::image_pdf;

fn exiftool_shift_error(key: &str, value: &str) -> Option<&'static str> {
    if key != "Title+" {
        return None;
    }
    let value = value.strip_suffix('\n').unwrap_or(value);
    let numeric = value.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'+' | b'-' | b'.' | b',' | b'E' | b'e'))
        && value.replace(',', ".").parse::<f64>().is_ok();
    (!numeric).then_some("Shift value for XMP-xmp:Title is not a number")
}

fn publish_magick_output(fs: &dyn SafeBashFs, path: &str, bytes: &[u8]) -> Result<(), String> {
    use crate::vfs::{VfsEntryKind, dirname_posix_path};
    let version = fs.generation();
    let mut target = path.to_owned();
    for _ in 0..=40 {
        let parent = dirname_posix_path(&target);
        let stat = fs.stat(&parent)?;
        if stat.kind != VfsEntryKind::Directory {
            return Err(format!("ENOTDIR: not a directory, lstat '{target}'"));
        }
        if let Ok(entry) = fs.lstat(&target) {
            match entry.kind {
                VfsEntryKind::Symlink => {
                    target = resolve_posix_path(&parent, &fs.readlink(&target)?);
                    continue;
                }
                VfsEntryKind::Directory => return Err(format!("EISDIR: illegal operation on a directory, writeFile '{target}'")),
                VfsEntryKind::File => {}
            }
        }
        if stat.mode & 0o300 != 0o300 {
            return Err(format!("EACCES: permission denied, writeFile '{target}'"));
        }
        let stamp=fs.observe_publication(&target,version,crate::vfs::PublicationMode::Write)?;
        return match fs.publish_file(&target, bytes, &[], stamp.version) {
            Ok(_) => Ok(()),
            Err(e) if e.starts_with("UNSUPPORTED_CAPABILITY:") => fs.write_file(&target, bytes),
            Err(e) => Err(e),
        };
    }
    Err(format!("ELOOP: too many symbolic links encountered, writeFile '{path}'"))
}

fn write_regular_output(fs: &dyn SafeBashFs, cwd: &str, name: &str, bytes: &[u8]) -> bool {
    let path = resolve_posix_path(cwd, name);
    fs.is_dir(&crate::vfs::dirname_posix_path(&path))
        && !fs.lstat(&path).is_ok_and(|st| st.kind != crate::vfs::VfsEntryKind::File || st.mode & 0o170000 == 0o020000)
        && fs.write_file(&path, bytes).is_ok()
}

fn write_copied_pdf(fs: &dyn SafeBashFs, cwd: &str, name: &str, bytes: &[u8], status: i32) -> BuiltinOutcome {
    if !write_regular_output(fs, cwd, name, bytes) {
        return err_out(&format!("I/O Error: Couldn't open file '{name}'\n"), status);
    }
    ok_out("")
}

fn pdftk_attachment_leaf(name: &str) -> Option<&str> {
    let leaf = name.rsplit(['/', '\\']).next()?;
    (!matches!(leaf, "" | "." | "..") && !leaf.contains('\0')).then_some(leaf)
}

fn is_legacy_pdf(bytes: &[u8]) -> bool {
    bytes.split(|c| *c == b'\n').nth(1).is_some_and(|line| matches!(line, b"%%SAFE_PDF_V2%%" | b"%%PAGE%%"))
}

impl PdfDoc {
    fn new() -> Self {
        Self {
            version: "1.4".to_string(),
            title: String::new(),
            author: String::new(),
            trailer_id: None,
            pdf_id0: "00000000000000000000000000000000".to_string(),
            pdf_id1: "00000000000000000000000000000000".to_string(),
            encrypted: None,
            linearized: false,
            page_w: 612.0,
            page_h: 792.0,
            direct_media: BTreeMap::new(),
            page_media: BTreeMap::new(),
            info: Vec::new(),
            bookmarks: Vec::new(),
            page_labels: Vec::new(),
            attachments: Vec::new(),
            pages: Vec::new(),
            exif: BTreeMap::new(),
        }
    }

    fn parse(bytes: &[u8]) -> Self {
        if let Ok((doc,_)) = pdf_reader::read(bytes,"") {
            return doc;
        }
        let raw = String::from_utf8_lossy(bytes);
        let mut doc = Self::new();
        for line in raw.lines() {
            if let Some(rest) = line.strip_prefix("%PDF-") {
                doc.version = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("__EXIF__:")
                && let Some((k, v)) = rest.split_once('=')
            {
                if v.is_empty() {
                    if k.eq_ignore_ascii_case("all") {
                        doc.exif.clear();
                    } else {
                        doc.exif.remove(k);
                    }
                } else {
                    doc.exif.insert(k.to_string(), v.to_string());
                }
            }
        }
        if raw.contains("%%SAFE_PDF_V2%%") {
            for line in raw.lines() {
                if let Some(v) = line.strip_prefix("VER:") {
                    doc.version = v.to_string();
                } else if let Some(v) = line.strip_prefix("TITLE:") {
                    doc.title = hex_dec_str(v);
                } else if let Some(v) = line.strip_prefix("AUTHOR:") {
                    doc.author = hex_dec_str(v);
                } else if line == "LIN:1" {
                    doc.linearized = true;
                } else if let Some(v) = line.strip_prefix("ID0:") {
                    doc.pdf_id0 = v.to_string();
                } else if let Some(v) = line.strip_prefix("ID1:") {
                    doc.pdf_id1 = v.to_string();
                } else if let Some(v) = line.strip_prefix("SIZE:") {
                    if let Some((ws, hs)) = v.split_once(':') {
                        doc.page_w = ws.parse().unwrap_or(612.0);
                        doc.page_h = hs.parse().unwrap_or(792.0);
                    }
                } else if let Some(v) = line.strip_prefix("PMEDIA:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4
                        && let Ok(pno) = parts[0].parse::<usize>()
                    {
                        let pw = parts[1].parse::<f64>().unwrap_or(doc.page_w);
                        let ph = parts[2].parse::<f64>().unwrap_or(doc.page_h);
                        let crop = if parts[3].is_empty() {
                            None
                        } else {
                            let nums: Vec<f64> = parts[3]
                                .split(',')
                                .filter_map(|s| s.parse::<f64>().ok())
                                .collect();
                            if nums.len() == 4 {
                                Some([nums[0], nums[1], nums[2], nums[3]])
                            } else {
                                None
                            }
                        };
                        doc.page_media.insert(pno, (pw, ph, crop));
                    }
                } else if let Some(v) = line.strip_prefix("ENC:") {
                    if !v.is_empty() {
                        doc.encrypted = Some(hex_dec_str(v));
                    }
                } else if let Some(v) = line.strip_prefix("INFO:") {
                    if let Some((kh, vh)) = v.split_once(':') {
                        doc.info.push((hex_dec_str(kh), hex_dec_str(vh)));
                    }
                } else if let Some(v) = line.strip_prefix("BM:") {
                    let parts: Vec<&str> = v.splitn(3, ':').collect();
                    if parts.len() == 3 {
                        doc.bookmarks.push((
                            hex_dec_str(parts[0]),
                            parts[1].to_string(),
                            parts[2].to_string(),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("PL:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4 {
                        doc.page_labels.push((
                            parts[0].to_string(),
                            parts[1].to_string(),
                            hex_dec_str(parts[2]),
                            hex_dec_str(parts[3]),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("ATT:") {
                    let parts: Vec<&str> = v.splitn(4, ':').collect();
                    if parts.len() == 4 {
                        doc.attachments.push((
                            hex_dec_str(parts[0]),
                            hex_dec_str(parts[1]),
                            hex_dec_str(parts[2]),
                            hex_dec(parts[3]),
                        ));
                    }
                } else if let Some(v) = line.strip_prefix("PAGE:") {
                    let parts: Vec<&str> = v.splitn(5, ':').collect();
                    if parts.len() == 5 {
                        let rot = parts[0].parse().unwrap_or(0);
                        let text = hex_dec_str(parts[1]);
                        let html = hex_dec_str(parts[2]);
                        let mut images = Vec::new();
                        if !parts[3].is_empty() {
                            for im in parts[3].split(';') {
                                let ip: Vec<&str> = im.split(',').collect();
                                if ip.len() == 3 {
                                    images.push((
                                        ip[0].parse().unwrap_or(24),
                                        ip[1].parse().unwrap_or(24),
                                        ip[2].to_string(),
                                    ));
                                }
                            }
                        }
                        let mut urls = Vec::new();
                        if !parts[4].is_empty() {
                            for u in parts[4].split(';') {
                                urls.push(hex_dec_str(u));
                            }
                        }
                        doc.pages.push(PdfPage {
                            rot,
                            text,
                            html,
                            images,
                            urls,
                        });
                    }
                }
            }
            if doc.pages.is_empty() {
                doc.pages.push(PdfPage {
                    rot: 0,
                    text: String::new(),
                    html: String::new(),
                    images: Vec::new(),
                    urls: Vec::new(),
                });
            }
            for (k, v) in &doc.info {
                if k.eq_ignore_ascii_case("Title") && !v.is_empty() {
                    doc.title = v.clone();
                } else if k.eq_ignore_ascii_case("Author") && !v.is_empty() {
                    doc.author = v.clone();
                }
            }
            if let Some(t) = doc.exif.get("Title")
                && !t.is_empty()
            {
                doc.title = t.clone();
            }
            if let Some(a) = doc.exif.get("Author")
                && !a.is_empty()
            {
                doc.author = a.clone();
            }
            return doc;
        }
        // Fallback for legacy %%PAGE%% PDFs
        let chunks: Vec<&str> = if raw.contains("%%PAGE%%") {
            raw.split("%%PAGE%%").skip(1).collect()
        } else {
            vec![raw.as_ref()]
        };
        for c in chunks {
            let text = strip_html_tags(c);
            doc.pages.push(PdfPage {
                rot: 0,
                text,
                html: c.to_string(),
                images: Vec::new(),
                urls: extract_html_urls(c),
            });
        }
        if doc.pages.is_empty() {
            doc.pages.push(PdfPage {
                rot: 0,
                text: String::new(),
                html: String::new(),
                images: Vec::new(),
                urls: Vec::new(),
            });
        }
        doc
    }

    fn serialize(&self) -> Vec<u8> {
        self.serialize_with_copies(1, true, usize::MAX).unwrap()
    }

    fn serialize_with_copies(&self, copies: usize, collate: bool, limit: usize) -> Option<Vec<u8>> {
        let repeat = |out: &mut String, start: usize| -> Option<()> {
            let end = out.len();
            let count = copies - 1;
            let extra = (end - start).checked_mul(count)?;
            if end.checked_add(extra)? > limit {
                return None;
            }
            if extra > 0 {
                out.reserve(extra);
                for _ in 0..count {
                    out.extend_from_within(start..end);
                }
            }
            Some(())
        };
        let mut out = format!("%PDF-{}\n%%SAFE_PDF_V2%%\n", self.version);
        out.push_str(&format!("VER:{}\n", self.version));
        out.push_str(&format!("TITLE:{}\n", hex_enc(self.title.as_bytes())));
        out.push_str(&format!("AUTHOR:{}\n", hex_enc(self.author.as_bytes())));
        if self.linearized {
            out.push_str("LIN:1\n");
        }
        if self.pdf_id0 != "00000000000000000000000000000000" {
            out.push_str(&format!("ID0:{}\n", self.pdf_id0));
        }
        if self.pdf_id1 != "00000000000000000000000000000000" {
            out.push_str(&format!("ID1:{}\n", self.pdf_id1));
        }
        if (self.page_w - 612.0).abs() > 1e-6 || (self.page_h - 792.0).abs() > 1e-6 {
            out.push_str(&format!("SIZE:{}:{}\n", self.page_w, self.page_h));
        }
        for (pno, (pw, ph, crop)) in &self.page_media {
            let crop_str = match crop {
                Some([c0, c1, c2, c3]) => format!("{c0},{c1},{c2},{c3}"),
                None => String::new(),
            };
            out.push_str(&format!("PMEDIA:{pno}:{pw}:{ph}:{crop_str}\n"));
        }
        if let Some(ref pw) = self.encrypted {
            out.push_str(&format!("ENC:{}\n", hex_enc(pw.as_bytes())));
        }
        for (k, v) in &self.info {
            out.push_str(&format!(
                "INFO:{}:{}\n",
                hex_enc(k.as_bytes()),
                hex_enc(v.as_bytes())
            ));
        }
        for (t, l, p) in &self.bookmarks {
            out.push_str(&format!("BM:{}:{}:{}\n", hex_enc(t.as_bytes()), l, p));
        }
        for (ni, st, pf, sy) in &self.page_labels {
            out.push_str(&format!(
                "PL:{}:{}:{}:{}\n",
                ni,
                st,
                hex_enc(pf.as_bytes()),
                hex_enc(sy.as_bytes())
            ));
        }
        for (k, f, d, b) in &self.attachments {
            out.push_str(&format!(
                "ATT:{}:{}:{}:{}\n",
                hex_enc(k.as_bytes()),
                hex_enc(f.as_bytes()),
                hex_enc(d.as_bytes()),
                hex_enc(b)
            ));
        }
        let pages_start = out.len();
        for p in &self.pages {
            let page_start = out.len();
            let imgs: Vec<String> = p
                .images
                .iter()
                .map(|(w, h, fmt)| format!("{w},{h},{fmt}"))
                .collect();
            let urls: Vec<String> = p.urls.iter().map(|u| hex_enc(u.as_bytes())).collect();
            out.push_str(&format!(
                "PAGE:{}:{}:{}:{}:{}\n",
                p.rot,
                hex_enc(p.text.as_bytes()),
                hex_enc(p.html.as_bytes()),
                imgs.join(";"),
                urls.join(";")
            ));
            if !collate {
                repeat(&mut out, page_start)?;
            }
        }
        if collate {
            repeat(&mut out, pages_start)?;
        }
        for (k, v) in &self.exif {
            out.push_str(&format!("__EXIF__:{k}={v}\n"));
        }
        out.push_str("%%EOF\n");
        (out.len() <= limit).then(|| out.into_bytes())
    }
}

fn strip_html_tags(html: &str) -> String {
    let mut s = html.to_string();
    while let Some(start) = s.find("<head") {
        if let Some(end) = s[start..].find("</head>") {
            s.replace_range(start..start + end + 7, "");
        } else {
            break;
        }
    }
    while let Some(start) = s.find("<style") {
        if let Some(end) = s[start..].find("</style>") {
            s.replace_range(start..start + end + 8, "");
        } else {
            break;
        }
    }
    let mut out = String::new();
    let mut in_tag = false;
    let mut tag_buf = String::new();
    for ch in s.chars() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
        } else if ch == '>' {
            in_tag = false;
            let t = tag_buf.trim().to_ascii_lowercase();
            if matches!(
                t.split_whitespace().next().unwrap_or(""),
                "h1" | "/h1" | "h2" | "/h2" | "h3" | "/h3" | "p" | "/p" | "div" | "/div" | "br" | "br/" | "li" | "/li" | "tr" | "/tr"
            ) {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
        } else if in_tag {
            tag_buf.push(ch);
        } else {
            out.push(ch);
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let mut lines = Vec::new();
    for l in decoded.lines() {
        let trimmed = l.trim();
        if !trimmed.is_empty() && !trimmed.starts_with("%PDF-") {
            lines.push(trimmed.to_string());
        }
    }
    lines.join("\n")
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    if let Some(s) = lower.find("<title>")
        && let Some(e) = lower[s + 7..].find("</title>")
    {
        return Some(html[s + 7..s + 7 + e].trim().to_string());
    }
    None
}

fn extract_html_urls(html: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find("href=") {
        rest = &rest[pos + 5..];
        let q = rest.chars().next().unwrap_or(' ');
        if (q == '"' || q == '\'')
            && let Some(end) = rest[1..].find(q)
        {
            urls.push(rest[1..1 + end].to_string());
            rest = &rest[1 + end + 1..];
        }
    }
    urls
}

fn extract_html_images(html: &str, base_dir: &str, fs: &dyn SafeBashFs) -> Vec<(u32, u32, String)> {
    let mut imgs = Vec::new();
    let mut rest = html;
    while let Some(pos) = rest.find("<img") {
        rest = &rest[pos + 4..];
        let end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..end];
        let mut w = 24u32;
        let mut h = 24u32;
        if let Some(wp) = tag.find("width=\"") {
            let r = &tag[wp + 7..];
            if let Some(we) = r.find('"') {
                w = r[..we].parse().unwrap_or(24);
            }
        }
        if let Some(hp) = tag.find("height=\"") {
            let r = &tag[hp + 8..];
            if let Some(he) = r.find('"') {
                h = r[..he].parse().unwrap_or(24);
            }
        }
        let mut fmt = "PNG".to_string();
        if let Some(sp) = tag.find("src=\"") {
            let r = &tag[sp + 5..];
            if let Some(se) = r.find('"') {
                let src = &r[..se];
                if let Some(rest_data) = src.strip_prefix("data:") {
                    if rest_data.starts_with("image/jpeg") || rest_data.starts_with("image/jpg") {
                        fmt = "JPEG".to_string();
                    } else if rest_data.starts_with("image/tiff") {
                        fmt = "TIFF".to_string();
                    }
                    if let Some(b64_pos) = rest_data.find(";base64,") {
                        let b64 = &rest_data[b64_pos + 8..];
                        if let Ok(b) = base64_decode(b64) {
                            let m = read_image_meta(&b, if fmt == "JPEG" { "inline.jpg" } else { "inline.png" });
                            w = m.w;
                            h = m.h;
                            if !m.fmt.is_empty() {
                                fmt = m.fmt;
                            }
                        }
                    }
                } else {
                    let full = resolve_posix_path(base_dir, src);
                    if let Ok(b) = fs.read_file(&full) {
                        let m = read_image_meta(&b, &full);
                        w = m.w;
                        h = m.h;
                        if !m.fmt.is_empty() {
                            fmt = m.fmt;
                        }
                    }
                }
            }
        }
        imgs.push((w, h, fmt));
        rest = &rest[end..];
    }
    imgs
}

fn split_html_pages(html: &str) -> Vec<String> {
    let mut pages = Vec::new();
    let mut cur = String::new();
    let mut rest = html;
    loop {
        let next_before = rest.find("page-break-before");
        let next_after = rest.find("page-break-after");
        match (next_before, next_after) {
            (Some(pb), Some(pa)) if pb <= pa => {
                let before = &rest[..pb];
                let div_start = before.rfind("<div").unwrap_or(pb);
                cur.push_str(&rest[..div_start]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                let after_pb = &rest[pb..];
                if let Some(gt) = after_pb.find('>') {
                    rest = &after_pb[gt + 1..];
                } else {
                    break;
                }
            }
            (_, Some(pa)) => {
                let after_pa = &rest[pa..];
                let split_offset = if let Some(close_div) = after_pa.find("</div>") {
                    pa + close_div + 6
                } else if let Some(gt) = after_pa.find('>') {
                    pa + gt + 1
                } else {
                    break;
                };
                cur.push_str(&rest[..split_offset]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                rest = &rest[split_offset..];
            }
            (Some(pb), None) => {
                let before = &rest[..pb];
                let div_start = before.rfind("<div").unwrap_or(pb);
                cur.push_str(&rest[..div_start]);
                if !strip_html_tags(&cur).trim().is_empty() {
                    pages.push(cur.clone());
                    cur.clear();
                }
                let after_pb = &rest[pb..];
                if let Some(gt) = after_pb.find('>') {
                    rest = &after_pb[gt + 1..];
                } else {
                    break;
                }
            }
            (None, None) => break,
        }
    }
    cur.push_str(rest);
    if !strip_html_tags(&cur).trim().is_empty() || pages.is_empty() {
        pages.push(cur);
    }
    pages
}

#[derive(Clone, Debug)]
struct MediaDoc {
    codec_type: String,
    codec_name: String,
    format_name: String,
    width: u32,
    height: u32,
    nb_frames: u32,
    fps: u32,
    duration: f64,
    sample_rate: u32,
    channels: u32,
    has_audio: bool,
    title: String,
    tags: BTreeMap<String, String>,
    subtitles: String,
    chapters: Vec<(usize, String)>,
}

impl MediaDoc {
    fn default_video() -> Self {
        Self {
            codec_type: "video".to_string(),
            codec_name: "h264".to_string(),
            format_name: "mp4".to_string(),
            width: 64,
            height: 48,
            nb_frames: 4,
            fps: 10,
            duration: 0.4,
            sample_rate: 16000,
            channels: 1,
            has_audio: false,
            title: String::new(),
            tags: BTreeMap::new(),
            subtitles: String::new(),
            chapters: Vec::new(),
        }
    }

    fn parse(bytes: &[u8], path: &str) -> Self {
        if bytes.get(4..8) == Some(b"ftyp") && let Some(doc) = mp4::media_doc(bytes) {
            return doc;
        }
        let mut d = Self::default_video();
        let lower_path = path.to_ascii_lowercase();
        if lower_path.ends_with(".wav") || (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE") {
            d.codec_type = "audio".to_string();
            d.codec_name = "pcm_s16le".to_string();
            d.format_name = "wav".to_string();
            if let Ok(info) = probe_wav_info(bytes) {
                d.sample_rate = info.sample_rate;
                d.channels = info.channels as u32;
                d.duration = info.duration;
                d.codec_name = if info.codec == "pcm_float" {
                    format!("pcm_f{}le", info.bits_per_sample)
                } else if info.bits_per_sample == 8 {
                    "pcm_u8".to_string()
                } else {
                    format!("pcm_s{}le", info.bits_per_sample)
                };
            }
        } else if lower_path.ends_with(".png")
            || lower_path.ends_with(".jpg")
            || lower_path.ends_with(".jpeg")
            || lower_path.ends_with(".webp")
            || lower_path.ends_with(".bmp")
            || lower_path.ends_with(".ppm")
            || lower_path.ends_with(".pgm")
            || lower_path.ends_with(".pbm")
            || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || bytes.starts_with(b"\xff\xd8\xff")
        {
            let im = read_image_meta(bytes, path);
            d.codec_type = "video".to_string();
            d.codec_name = match im.fmt.as_str() {
                "JPEG" => "mjpeg",
                "GIF" => "gif",
                "WEBP" => "webp",
                "BMP" => "bmp",
                _ => "png",
            }
            .to_string();
            d.format_name = "image2".to_string();
            d.width = im.w;
            d.height = im.h;
            d.nb_frames = 1;
            d.duration = 0.04;
        }
        let text = String::from_utf8_lossy(bytes);
        for line in text.lines() {
            if let Some(rest) = line.trim_start_matches("# ").strip_prefix("__MEDIA__:") {
                for kv in rest.split(';') {
                    if let Some((k, v)) = kv.split_once('=') {
                        match k {
                            "type" => d.codec_type = v.to_string(),
                            "codec" => d.codec_name = v.to_string(),
                            "fmt" => d.format_name = v.to_string(),
                            "w" => d.width = v.parse().unwrap_or(d.width),
                            "h" => d.height = v.parse().unwrap_or(d.height),
                            "n" => d.nb_frames = v.parse().unwrap_or(d.nb_frames),
                            "fps" => d.fps = v.parse().unwrap_or(d.fps),
                            "dur" => d.duration = v.parse().unwrap_or(d.duration),
                            "sr" => d.sample_rate = v.parse().unwrap_or(d.sample_rate),
                            "ch" => d.channels = v.parse().unwrap_or(d.channels),
                            "ha" => d.has_audio = v == "1",
                            "title" => {
                                d.title = hex_dec_str(v);
                                if !d.title.is_empty() {
                                    d.tags.insert("title".to_string(), d.title.clone());
                                }
                            }
                            "tags" => {
                                if !v.is_empty() {
                                    for item in v.split(',') {
                                        if let Some((kh, vh)) = item.split_once(':') {
                                            let key = hex_dec_str(kh);
                                            let val = hex_dec_str(vh);
                                            if key == "title" {
                                                d.title = val.clone();
                                            }
                                            d.tags.insert(key, val);
                                        }
                                    }
                                }
                            }
                            "subs" => d.subtitles = hex_dec_str(v),
                            "chaps" => {
                                d.chapters.clear();
                                if !v.is_empty() {
                                    for item in v.split(',') {
                                        if let Some((id_s, th)) = item.split_once(':') {
                                            d.chapters.push((
                                                id_s.parse().unwrap_or(0),
                                                hex_dec_str(th),
                                            ));
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        d
    }

    fn serialize(&self) -> Vec<u8> {
        let chaps: Vec<String> = self
            .chapters
            .iter()
            .map(|(id, t)| format!("{id}:{}", hex_enc(t.as_bytes())))
            .collect();
        let tags_encoded: Vec<String> = self
            .tags
            .iter()
            .map(|(k, v)| format!("{}:{}", hex_enc(k.as_bytes()), hex_enc(v.as_bytes())))
            .collect();
        let meta_line = format!(
            "__MEDIA__:type={};codec={};fmt={};w={};h={};n={};fps={};dur={:.6};sr={};ch={};ha={};title={};tags={};subs={};chaps={}\n",
            self.codec_type,
            self.codec_name,
            self.format_name,
            self.width,
            self.height,
            self.nb_frames,
            self.fps,
            self.duration,
            self.sample_rate,
            self.channels,
            if self.has_audio { 1 } else { 0 },
            hex_enc(self.title.as_bytes()),
            tags_encoded.join(","),
            hex_enc(self.subtitles.as_bytes()),
            chaps.join(",")
        );
        let mut out = if self.format_name == "wav" {
            let ch = self.channels.max(1) as u16;
            let sr = self.sample_rate.max(1);
            let block_align = ch * 2;
            let byte_rate = sr * (block_align as u32);
            let total_frames = ((self.duration.max(0.0) * (sr as f64)).round() as usize).min(262_144);
            let data_len = total_frames * (block_align as usize);
            let riff_size = (36 + data_len) as u32;
            let mut wav = Vec::with_capacity(44 + data_len + meta_line.len() + 2);
            wav.extend_from_slice(b"RIFF");
            wav.extend_from_slice(&riff_size.to_le_bytes());
            wav.extend_from_slice(b"WAVEfmt ");
            wav.extend_from_slice(&16u32.to_le_bytes());
            wav.extend_from_slice(&1u16.to_le_bytes());
            wav.extend_from_slice(&ch.to_le_bytes());
            wav.extend_from_slice(&sr.to_le_bytes());
            wav.extend_from_slice(&byte_rate.to_le_bytes());
            wav.extend_from_slice(&block_align.to_le_bytes());
            wav.extend_from_slice(&16u16.to_le_bytes());
            wav.extend_from_slice(b"data");
            wav.extend_from_slice(&(data_len as u32).to_le_bytes());
            wav.resize(44 + data_len, 0u8);
            wav
        } else if self.format_name == "gif" {
            b"GIF89a".to_vec()
        } else {
            b"\x00\x00\x00\x18ftypmp42".to_vec()
        };
        out.push(b'\n');
        out.extend_from_slice(meta_line.as_bytes());
        out
    }
}

fn parse_rtf_paragraphs(rtf: &str, fs: &dyn SafeBashFs) -> Vec<String> {
    let res = crate::commands::structured::try_run_structured_command(
        "unrtf",
        &["--text".to_string()],
        rtf,
        "/",
        &BTreeMap::new(),
        fs,
    );
    let txt = res.map(|o| o.stdout).unwrap_or_default();
    txt.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

fn html_escape_str(s: &str) -> String {
    let mut out = String::new();
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn xml_unescape_str(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

fn parse_markdown_pipe_table_rows(source: &str) -> Vec<Vec<String>> {
    let pipe_cells = |line: &str| -> Option<Vec<String>> {
        let mut cells = Vec::new();
        let mut cell = String::new();
        let chars: Vec<char> = line.chars().collect();
        let mut idx = 0usize;
        while idx < chars.len() {
            let ch = chars[idx];
            if ch == '\\' && idx + 1 < chars.len() && chars[idx + 1] == '|' {
                cell.push('|');
                idx += 2;
            } else if ch == '|' {
                cells.push(cell.trim().to_string());
                cell.clear();
                idx += 1;
            } else {
                cell.push(ch);
                idx += 1;
            }
        }
        if cells.is_empty() {
            return None;
        }
        cells.push(cell.trim().to_string());
        if line.trim_start().starts_with('|') && !cells.is_empty() {
            cells.remove(0);
        }
        if line.trim_end().ends_with('|') && cells.last().is_some_and(|c| c.is_empty()) {
            cells.pop();
        }
        Some(cells)
    };

    let lines: Vec<&str> = source.lines().collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut index = 0usize;
    while index + 1 < lines.len() {
        let header = pipe_cells(lines[index]);
        let delimiter = pipe_cells(lines[index + 1]);
        if let (Some(hdr), Some(delim)) = (header, delimiter)
            && !hdr.is_empty()
            && delim.len() == hdr.len()
            && delim.iter().all(|c| {
                let s = c.trim_start_matches(':').trim_end_matches(':');
                !s.is_empty() && s.chars().all(|ch| ch == '-')
            })
        {
            let col_len = hdr.len();
            rows.push(hdr);
            index += 2;
            while index < lines.len() {
                if let Some(cells) = pipe_cells(lines[index]) {
                    let mut row = Vec::with_capacity(col_len);
                    for col in 0..col_len {
                        row.push(cells.get(col).cloned().unwrap_or_default());
                    }
                    rows.push(row);
                    index += 1;
                } else {
                    break;
                }
            }
            continue;
        }
        index += 1;
    }
    rows
}

fn read_office_source(
    full_path: &str,
    bytes: &[u8],
    fs: &dyn SafeBashFs,
) -> Result<(Vec<String>, Option<Vec<Vec<String>>>), &'static str> {
    let lower = full_path.to_ascii_lowercase();
    if lower.ends_with(".csv") || lower.ends_with(".tsv") {
        let delim = if lower.ends_with(".tsv") { '\t' } else { ',' };
        let text = String::from_utf8_lossy(bytes);
        let rows = office::delimited(&text,delim)?;
        let paras: Vec<String> = rows.iter().map(|r| r.join(",")).collect();
        return Ok((paras, Some(rows)));
    }
    if lower.ends_with(".xlsx") || lower.ends_with(".ods") {
        let entries = crate::commands::structured::read_office_archive(bytes);
        let mut shared_strings: Vec<String> = Vec::new();
        if let Some(content) = entries.get("xl/sharedStrings.xml") {
            let sst_xml = String::from_utf8_lossy(content);
            let mut rest = sst_xml.as_ref();
            while let Some(si_pos) = rest.find("<si") {
                rest = &rest[si_pos + 3..];
                if let Some(si_end) = rest.find("</si>") {
                    let si_body = &rest[..si_end];
                    let mut val = String::new();
                    let mut s_rest = si_body;
                    while let Some(t_pos) = s_rest.find("<t") {
                        let after_t = &s_rest[t_pos + 2..];
                        if !after_t.starts_with('>') && !after_t.starts_with(' ') {
                            s_rest = after_t;
                            continue;
                        }
                        if let Some(gt) = after_t.find('>') {
                            let inner = &after_t[gt + 1..];
                            if let Some(te) = inner.find("</t>") {
                                val.push_str(&xml_unescape_str(&inner[..te]));
                                s_rest = &inner[te + 4..];
                                continue;
                            }
                        }
                        break;
                    }
                    shared_strings.push(val);
                    rest = &rest[si_end + 5..];
                } else {
                    break;
                }
            }
        }
        if let Some(content) = entries.get("xl/worksheets/sheet1.xml").or_else(|| entries.iter().find(|(n,_)| n.starts_with("xl/worksheets/sheet")).map(|(_,v)|v)) {
            let xml = String::from_utf8_lossy(content);
            let mut rows = Vec::new();
            let mut remaining_cells = fs.max_input_bytes() / size_of::<String>();
            let mut rest = xml.as_ref();
            while let Some(rs) = rest.find("<row") {
                rest = &rest[rs + 4..];
                if let Some(re) = rest.find("</row>") {
                    let row_xml = &rest[..re];
                    let mut cells: Vec<String> = Vec::new();
                    let mut rcell = row_xml;
                    while let Some(cs) = rcell.find("<c") {
                        let after_c = &rcell[cs + 2..];
                        if !after_c.starts_with(' ') && !after_c.starts_with('>') && !after_c.starts_with('/') {
                            rcell = after_c;
                            continue;
                        }
                        if let Some(gt) = after_c.find('>') {
                            let attrs = &after_c[..gt];
                            if let Some(r_pos) = attrs.find("r=\"") {
                                let r_rest = &attrs[r_pos + 3..];
                                if let Some(r_end) = r_rest.find('"') {
                                    let ref_str = &r_rest[..r_end];
                                    let mut col_idx = 0usize;
                                    for ch in ref_str.chars() {
                                        if ch.is_ascii_alphabetic() {
                                            col_idx = col_idx * 26 + ((ch.to_ascii_uppercase() as u8 - b'A') as usize + 1);
                                            if col_idx > 16384 { return Err("Error: conversion failed: worksheet exceeds cell limit\n"); }
                                        } else {
                                            break;
                                        }
                                    }
                                    if col_idx > 0 {
                                        let target_col = col_idx - 1;
                                        if target_col >= remaining_cells { return Err("Error: conversion failed: worksheet exceeds cell limit\n"); }
                                        while cells.len() < target_col {
                                            cells.push(String::new());
                                        }
                                    }
                                }
                            }
                            if attrs.ends_with('/') {
                                cells.push(String::new());
                                rcell = &after_c[gt + 1..];
                                continue;
                            }
                            let body_rest = &after_c[gt + 1..];
                            if let Some(ce) = body_rest.find("</c>") {
                                let cell_body = &body_rest[..ce];
                                let is_shared = attrs.contains("t=\"s\"");
                                let is_inline = attrs.contains("t=\"inlineStr\"");
                                let val = if is_inline {
                                    if let Some(ts) = cell_body.find("<t")
                                        && let Some(tgt) = cell_body[ts + 2..].find('>')
                                    {
                                        let inner = &cell_body[ts + 2 + tgt + 1..];
                                        if let Some(te) = inner.find("</t>") {
                                            xml_unescape_str(&inner[..te])
                                        } else {
                                            String::new()
                                        }
                                    } else {
                                        String::new()
                                    }
                                } else if let Some(vs) = cell_body.find("<v>")
                                    && let Some(ve) = cell_body[vs + 3..].find("</v>")
                                {
                                    let raw = xml_unescape_str(&cell_body[vs + 3..vs + 3 + ve]);
                                    if is_shared {
                                        let idx: usize = raw.trim().parse().unwrap_or(usize::MAX);
                                        shared_strings.get(idx).cloned().unwrap_or_default()
                                    } else {
                                        raw
                                    }
                                } else if let Some(ts) = cell_body.find("<t>")
                                    && let Some(te) = cell_body[ts + 3..].find("</t>")
                                {
                                    xml_unescape_str(&cell_body[ts + 3..ts + 3 + te])
                                } else {
                                    String::new()
                                };
                                cells.push(val);
                                rcell = &body_rest[ce + 4..];
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    if !cells.is_empty() {
                        let Some(left) = remaining_cells.checked_sub(cells.len()) else { return Err("Error: conversion failed: worksheet exceeds cell limit\n"); };
                        remaining_cells = left;
                        rows.push(cells);
                    }
                    rest = &rest[re + 6..];
                } else {
                    break;
                }
            }
            let paras: Vec<String> = rows.iter().map(|r| r.join("\t")).collect();
            return Ok((paras, Some(rows)));
        }
        if let Some(content) = entries.get("content.xml") {
            let xml = String::from_utf8_lossy(content);
            let mut rows = Vec::new();
            let mut rest = xml.as_ref();
            while let Some(rs) = rest.find("<table:table-row") {
                rest = &rest[rs + 16..];
                if let Some(re) = rest.find("</table:table-row>") {
                    let row_xml = &rest[..re];
                    let mut cells = Vec::new();
                    let mut rcell = row_xml;
                    while let Some(cs) = rcell.find("<table:table-cell") {
                        rcell = &rcell[cs + 17..];
                        if let Some(gt) = rcell.find('>') {
                            let inner = &rcell[gt + 1..];
                            if let Some(ce) = inner.find("</table:table-cell>") {
                                let cell_txt = strip_html_tags(&inner[..ce]).trim().to_string();
                                cells.push(cell_txt);
                                rcell = &inner[ce + 19..];
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    }
                    if !cells.is_empty() {
                        rows.push(cells);
                    }
                    rest = &rest[re + 18..];
                } else {
                    break;
                }
            }
            let paras: Vec<String> = rows.iter().map(|r| r.join("\t")).collect();
            return Ok((paras, Some(rows)));
        }
    }
    if lower.ends_with(".docx") || lower.ends_with(".odt") || lower.ends_with(".pptx") {
        let entries = crate::commands::structured::read_office_archive(bytes);
        if let Some(content) = entries.get("word/document.xml") {
            let xml = String::from_utf8_lossy(content);
            let mut paras = Vec::new();
            let mut rest = xml.as_ref();
            while let Some(ps) = rest.find("<w:p") {
                let after_p = &rest[ps + 4..];
                if !after_p.starts_with('>') && !after_p.starts_with(' ') && !after_p.starts_with('/') {
                    rest = after_p;
                    continue;
                }
                if let Some(pe) = after_p.find("</w:p>") {
                    let p_xml = &after_p[..pe];
                    let mut line = String::new();
                    let mut p_rest = p_xml;
                    while let Some(ts) = p_rest.find("<w:t") {
                        let after_t = &p_rest[ts + 4..];
                        if let Some(gt) = after_t.find('>') {
                            let t_inner = &after_t[gt + 1..];
                            if let Some(te) = t_inner.find("</w:t>") {
                                line.push_str(&xml_unescape_str(&t_inner[..te]));
                                p_rest = &t_inner[te + 6..];
                                continue;
                            }
                        }
                        break;
                    }
                    if !line.trim().is_empty() {
                        paras.push(line.trim().to_string());
                    }
                    rest = &after_p[pe + 6..];
                } else {
                    break;
                }
            }
            return Ok((paras, None));
        }
        if let Some(content) = entries.get("content.xml") {
            let xml = String::from_utf8_lossy(content);
            let stripped = strip_html_tags(&xml);
            let paras: Vec<String> = stripped
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            return Ok((paras, None));
        }
        let slide_entries = entries
            .iter()
            .filter(|(name,_)| name.starts_with("ppt/slides/slide") && name.ends_with(".xml"))
            .collect::<Vec<_>>();
        if !slide_entries.is_empty() {
            let mut paras = Vec::new();
            for (_, content) in slide_entries {
                let xml = String::from_utf8_lossy(content);
                let mut rest = xml.as_ref();
                while let Some(ts) = rest.find("<a:t") {
                    let after_t = &rest[ts + 4..];
                    if let Some(gt) = after_t.find('>') {
                        let inner = &after_t[gt + 1..];
                        if let Some(te) = inner.find("</a:t>") {
                            let val = xml_unescape_str(&inner[..te]);
                            if !val.trim().is_empty() {
                                paras.push(val.trim().to_string());
                            }
                            rest = &inner[te + 6..];
                            continue;
                        }
                    }
                    break;
                }
            }
            return Ok((paras, None));
        }
    }
    if lower.ends_with(".pdf") || bytes.starts_with(b"%PDF-") {
        let doc = PdfDoc::parse(bytes);
        let mut paras = Vec::new();
        for p in doc.pages {
            for l in p.text.lines() {
                if !l.trim().is_empty() {
                    paras.push(l.trim().to_string());
                }
            }
        }
        return Ok((paras, None));
    }
    let text = String::from_utf8_lossy(bytes);
    if lower.ends_with(".rtf") || text.trim_start().starts_with("{\\rtf") {
        return Ok((parse_rtf_paragraphs(&text, fs), None));
    }
    if lower.ends_with(".html") || lower.ends_with(".htm") {
        let stripped = strip_html_tags(&text);
        let paras = stripped
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();
        return Ok((paras, None));
    }
    if lower.ends_with(".md") {
        let md_rows = parse_markdown_pipe_table_rows(&text);
        let paras = text
            .lines()
            .map(|l| l.trim().trim_start_matches("# ").to_string())
            .filter(|l| !l.is_empty())
            .collect();
        return Ok((paras, if md_rows.is_empty() { None } else { Some(md_rows) }));
    }
    let paras = text
        .lines()
        .map(|l| l.trim().trim_start_matches("# ").to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok((paras, None))
}

// Number.parseInt(value, 10) consumes just a signed decimal prefix.
fn qpdf_decimal(s: &str) -> Option<f64> {
    let s = s.trim_start_matches(|c: char| c == '\u{feff}' || c != '\u{85}' && c.is_whitespace());
    let digits = s.strip_prefix(['-', '+']).unwrap_or(s);
    let count = digits.bytes().take_while(u8::is_ascii_digit).count();
    (count > 0)
        .then(|| s[..s.len() - digits.len() + count].parse().ok())
        .flatten()
}

fn parse_qpdf_page_spec(spec: &str, total: usize) -> Vec<usize> {
    let mut selected: Vec<usize> = Vec::new();
    for tok in spec.split(',') {
        let tok = tok.trim();
        if tok.is_empty() {
            continue;
        }
        let is_excl = tok.starts_with('x');
        let rest = if is_excl { &tok[1..] } else { tok };
        let (range_part, parity) = if let Some(r) = rest.strip_suffix(":odd") {
            (r, Some(1usize))
        } else if let Some(r) = rest.strip_suffix(":even") {
            (r, Some(0usize))
        } else {
            (rest, None)
        };
        let resolve_idx = |s: &str| -> usize {
            if s == "z" || s == "end" {
                total.max(1)
            } else if let Some(r) = s.strip_prefix('r') {
                let off: usize = r.parse().unwrap_or(1);
                total.saturating_sub(off.saturating_sub(1)).max(1)
            } else {
                s.parse::<usize>().unwrap_or(1).clamp(1, total.max(1))
            }
        };
        let mut pages = Vec::new();
        if let Some((a, b)) = range_part.split_once('-') {
            let start = resolve_idx(a);
            let end = resolve_idx(b);
            if start <= end {
                for p in start..=end {
                    pages.push(p);
                }
            } else {
                let mut p = start;
                while p >= end {
                    pages.push(p);
                    if p == 1 {
                        break;
                    }
                    p -= 1;
                }
            }
        } else {
            pages.push(resolve_idx(range_part));
        }
        if let Some(par) = parity {
            pages = pages
                .into_iter()
                .enumerate()
                .filter(|(idx, _)| (idx + 1) % 2 == par)
                .map(|(_, p)| p)
                .collect();
        }
        if is_excl {
            selected.retain(|p| !pages.contains(p));
        } else {
            selected.extend(pages);
        }
    }
    selected
}

fn extract_html_headings(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut pos = 0usize;
    while pos < lower.len() {
        let mut best: Option<(usize, &str, &str)> = None;
        for (tag, lvl) in [("h1", "1"), ("h2", "2"), ("h3", "3")] {
            let open = format!("<{tag}");
            if let Some(rel) = lower[pos..].find(&open) {
                let abs = pos + rel;
                let after_ch = lower[abs + open.len()..].chars().next().unwrap_or('>');
                if after_ch == '>' || after_ch.is_ascii_whitespace() {
                    if best.is_none() || abs < best.unwrap().0 {
                        best = Some((abs, tag, lvl));
                    }
                }
            }
        }
        let Some((abs, tag, lvl)) = best else {
            break;
        };
        let Some(gt_rel) = lower[abs..].find('>') else {
            break;
        };
        let content_start = abs + gt_rel + 1;
        let close = format!("</{tag}>");
        let Some(close_rel) = lower[content_start..].find(&close) else {
            pos = content_start;
            continue;
        };
        let inner = strip_html_tags(&html[content_start..content_start + close_rel]);
        let trimmed = inner.split_whitespace().collect::<Vec<_>>().join(" ");
        if !trimmed.is_empty() {
            out.push((trimmed, lvl.to_string()));
        }
        pos = content_start + close_rel + close.len();
    }
    out
}

fn format_qpdf_split_name(template: &str, total: usize, group: usize, start: usize, end: usize) -> Option<String> {
    let pad_len = total.max(1).to_string().len();
    if let Some((prefix, spec, suffix)) = filename_number_spec(template) {
        let digits = spec.strip_prefix('0').unwrap_or(spec);
        let width = if digits.is_empty() { pad_len } else if spec.starts_with('0') { filename_width(digits)? } else { 0 };
        let mut name = prefix.replace("%%", "%");
        name.push_str(&format!("{start:0width$}"));
        if group != 1 { name.push_str(&format!("-{end:0width$}")); }
        name.push_str(&suffix.replace("%%", "%"));
        return Some(name);
    }
    let stem = if template.to_ascii_lowercase().ends_with(".pdf") {
        &template[..template.len() - 4]
    } else {
        template
    };
    let first = format!("{start:0>pad_len$}");
    let last = format!("{end:0>pad_len$}");
    Some(if group == 1 {
        format!("{stem}-{first}.pdf")
    } else {
        format!("{stem}-{first}-{last}.pdf")
    })
}

fn decode_pdftk_entities(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(amp) = rest.find("&#") {
        out.push_str(&rest[..amp]);
        let after = &rest[amp + 2..];
        if let Some(semi) = after.find(';') {
            let token = &after[..semi];
            let cp_opt = if let Some(hex) = token.strip_prefix('x').or_else(|| token.strip_prefix('X')) {
                u32::from_str_radix(hex, 16).ok()
            } else {
                token.parse::<u32>().ok()
            };
            if let Some(cp) = cp_opt
                && let Some(ch) = char::from_u32(cp)
            {
                out.push(ch);
                rest = &after[semi + 1..];
                continue;
            }
        }
        out.push_str("&#");
        rest = after;
    }
    out.push_str(rest);
    out
}

fn encode_pdftk_text(s: &str, utf8: bool) -> String {
    if utf8 {
        return s.to_string();
    }
    let mut out = String::new();
    for ch in s.chars() {
        let cp = ch as u32;
        if cp > 127 {
            out.push_str(&format!("&#{cp};"));
        } else {
            out.push(ch);
        }
    }
    out
}

fn format_pdf_date(raw: &str, mode: &str) -> String {
    if mode == "raw" {
        return raw.to_string();
    }
    let trimmed = raw.strip_prefix("D:").unwrap_or(raw);
    let bytes = trimmed.as_bytes();
    if bytes.len() < 4 || !bytes[..4].iter().all(|b| b.is_ascii_digit()) {
        return raw.to_string();
    }
    let year = &trimmed[0..4];
    let mut pos = 4usize;
    let take_pair = |p: &mut usize| -> Option<&str> {
        if *p + 2 <= bytes.len() && bytes[*p].is_ascii_digit() && bytes[*p + 1].is_ascii_digit() {
            let s = &trimmed[*p..*p + 2];
            *p += 2;
            Some(s)
        } else {
            None
        }
    };
    let month = take_pair(&mut pos).unwrap_or("01");
    let day = take_pair(&mut pos).unwrap_or("01");
    let hour = take_pair(&mut pos).unwrap_or("00");
    let minute = take_pair(&mut pos).unwrap_or("00");
    let second = take_pair(&mut pos).unwrap_or("00");
    let mut tz_sign: Option<char> = None;
    let mut tz_hour = "00";
    let mut tz_min = "00";
    if pos < bytes.len() {
        let sc = bytes[pos] as char;
        if matches!(sc, 'Z' | 'z' | '+' | '-') {
            tz_sign = Some(sc);
            pos += 1;
            if let Some(th) = take_pair(&mut pos) {
                tz_hour = th;
                if pos < bytes.len() && bytes[pos] == b'\'' {
                    pos += 1;
                }
                if let Some(tm) = take_pair(&mut pos) {
                    tz_min = tm;
                }
            }
        }
    }
    if mode == "iso" {
        let suffix = match tz_sign {
            None | Some('Z') | Some('z') => "Z".to_string(),
            Some(_) if tz_hour == "00" && tz_min == "00" => "Z".to_string(),
            Some(s) if tz_min == "00" => format!("{s}{tz_hour}"),
            Some(s) => format!("{s}{tz_hour}:{tz_min}"),
        };
        return format!("{year}-{month}-{day}T{hour}:{minute}:{second}{suffix}");
    }
    let y_num = year.parse::<i64>().unwrap_or(1970);
    let m_num = month.parse::<usize>().unwrap_or(1).clamp(1, 12);
    let d_num = day.parse::<i64>().unwrap_or(1).clamp(1, 31);
    let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let t: [i64; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let y_adj = if m_num < 3 { y_num - 1 } else { y_num };
    let dow = ((y_adj + y_adj / 4 - y_adj / 100 + y_adj / 400 + t[m_num - 1] + d_num)
        .rem_euclid(7)) as usize;
    format!(
        "{} {} {:2} {hour}:{minute}:{second} {year} UTC",
        days[dow], months[m_num - 1], d_num
    )
}

fn paper_size_label(w: f64, h: f64) -> &'static str {
    let matches_dim = |cw: f64, ch: f64, tol: f64| -> bool {
        ((w - cw).abs() <= tol && (h - ch).abs() <= tol)
            || ((w - ch).abs() <= tol && (h - cw).abs() <= tol)
    };
    if matches_dim(612.0, 792.0, 1.0) {
        " (letter)"
    } else if matches_dim(595.28, 841.89, 2.5) {
        " (A4)"
    } else if matches_dim(841.89, 1190.55, 3.0) {
        " (A3)"
    } else if matches_dim(419.53, 595.28, 2.0) {
        " (A5)"
    } else if matches_dim(612.0, 1008.0, 2.0) {
        " (legal)"
    } else if matches_dim(498.9, 708.66, 2.5) {
        " (B5)"
    } else {
        ""
    }
}

// Only the first unescaped %d (with optional decimal width) is substituted.
fn filename_number_spec(pattern: &str) -> Option<(&str, &str, &str)> {
    let mut offset = 0;
    while let Some(pos) = pattern[offset..].find('%') {
        let i = offset + pos;
        let tail = &pattern[i + 1..];
        if tail.starts_with('%') {
            offset = i + 2;
            continue;
        }
        let n = tail.bytes().take_while(u8::is_ascii_digit).count();
        if tail.as_bytes().get(n) == Some(&b'd') {
            return Some((&pattern[..i], &tail[..n], &tail[n + 1..]));
        }
        offset = i + 1 + n;
    }
    None
}

fn filename_width(digits: &str) -> Option<usize> {
    if digits.is_empty() { return Some(0); }
    digits.parse().ok().filter(|&w| w <= 4096)
}

fn format_printf_num(pattern: &str, num: usize, pad: Option<char>) -> Option<String> {
    let Some((prefix, digits, suffix)) = filename_number_spec(pattern) else {
        return Some(pattern.replace("%%", "%"));
    };
    let pad = if digits.starts_with('0') { Some('0') } else { pad };
    let number = match pad {
        Some(c) => {
            let width = filename_width(digits)?;
            if c == '0' { format!("{num:0width$}") } else { format!("{num:>width$}") }
        }
        None => num.to_string(),
    };
    Some(format!("{}{number}{}", prefix.replace("%%", "%"), suffix.replace("%%", "%")))
}

#[derive(Clone, Debug)]
struct SvgEl {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<SvgChild>,
}

#[derive(Clone, Debug)]
enum SvgChild {
    El(SvgEl),
    Text(String),
}

impl SvgEl {
    fn get_attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    fn set_attr(&mut self, key: &str, val: String) {
        if let Some(pair) = self.attrs.iter_mut().find(|(k, _)| k == key) {
            pair.1 = val;
        } else {
            self.attrs.push((key.to_string(), val));
        }
    }
}

fn parse_svg_xml(source: &str) -> Result<SvgEl, String> {
    parse_svg_xml_impl(source, true)
}

fn parse_svg_xml_impl(source: &str, require_svg_root: bool) -> Result<SvgEl, String> {
    let bytes = source.as_bytes();
    let mut roots: Vec<SvgEl> = Vec::new();
    let mut stack: Vec<SvgEl> = Vec::new();
    let mut i = 0usize;
    let is_ws = |b: u8| matches!(b, b' ' | b'\n' | b'\t' | b'\r');
    let skip_ws = |idx: &mut usize| {
        while *idx < bytes.len() && is_ws(bytes[*idx]) {
            *idx += 1;
        }
    };
    let read_name = |idx: &mut usize| -> Result<String, String> {
        let start = *idx;
        while *idx < bytes.len() && !is_ws(bytes[*idx]) && !b"/=<>\"'".contains(&bytes[*idx]) {
            *idx += 1;
        }
        if *idx == start {
            return Err(format!("Malformed SVG at offset {}", *idx));
        }
        Ok(source[start..*idx].to_string())
    };
    while i < bytes.len() {
        if bytes[i] != b'<' {
            let start = i;
            while i < bytes.len() && bytes[i] != b'<' {
                i += 1;
            }
            let txt = &source[start..i];
            if let Some(top) = stack.last_mut() {
                top.children.push(SvgChild::Text(txt.to_string()));
            } else if !txt.trim().is_empty() {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            continue;
        }
        if source[i..].starts_with("<!--") {
            let Some(rel) = source[i + 4..].find("-->") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            i += 4 + rel + 3;
            continue;
        }
        if source[i..].starts_with("<?") {
            let Some(rel) = source[i + 2..].find("?>") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            i += 2 + rel + 2;
            continue;
        }
        if source[i..].starts_with("<![CDATA[") {
            let Some(rel) = source[i + 9..].find("]]>") else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            let end = i + 9 + rel + 3;
            let Some(top) = stack.last_mut() else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            top.children.push(SvgChild::Text(source[i..end].to_string()));
            i = end;
            continue;
        }
        if source[i..].starts_with("<!DOCTYPE") {
            let mut quote = 0u8;
            let mut brackets = 0i32;
            i += 9;
            while i < bytes.len() {
                let c = bytes[i];
                i += 1;
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'[' {
                    brackets += 1;
                } else if c == b']' {
                    brackets -= 1;
                } else if c == b'>' && brackets == 0 {
                    break;
                }
            }
            continue;
        }
        i += 1;
        if i < bytes.len() && bytes[i] == b'/' {
            i += 1;
            let closing = read_name(&mut i)?;
            skip_ws(&mut i);
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            let Some(popped) = stack.pop() else {
                return Err(format!("Malformed SVG at offset {i}"));
            };
            if popped.name != closing {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            if let Some(parent) = stack.last_mut() {
                parent.children.push(SvgChild::El(popped));
            } else {
                roots.push(popped);
            }
            continue;
        }
        let el_name = read_name(&mut i)?;
        let mut attrs: Vec<(String, String)> = Vec::new();
        skip_ws(&mut i);
        while i < bytes.len() && bytes[i] != b'>' && bytes[i] != b'/' {
            let key = read_name(&mut i)?;
            skip_ws(&mut i);
            if i >= bytes.len() || bytes[i] != b'=' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            skip_ws(&mut i);
            if i >= bytes.len() || (bytes[i] != b'"' && bytes[i] != b'\'') {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            let quote = bytes[i];
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != quote {
                if bytes[i] == b'<' {
                    return Err(format!("Malformed SVG at offset {i}"));
                }
                i += 1;
            }
            if i >= bytes.len() || attrs.iter().any(|(k, _)| k == &key) {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            let val = source[start..i].replace('"', "&quot;");
            attrs.push((key, val));
            i += 1;
            skip_ws(&mut i);
        }
        let el = SvgEl {
            name: el_name,
            attrs,
            children: Vec::new(),
        };
        if i < bytes.len() && bytes[i] == b'/' {
            i += 1;
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            if let Some(parent) = stack.last_mut() {
                parent.children.push(SvgChild::El(el));
            } else {
                roots.push(el);
            }
        } else {
            if i >= bytes.len() || bytes[i] != b'>' {
                return Err(format!("Malformed SVG at offset {i}"));
            }
            i += 1;
            stack.push(el);
            if stack.len() > 256 {
                return Err("SVG nesting exceeds 256".to_string());
            }
        }
    }
    if !stack.is_empty() || roots.len() != 1 || (require_svg_root && roots[0].name != "svg") {
        return Err(format!("Malformed SVG at offset {i}"));
    }
    Ok(roots.remove(0))
}

fn svg_read_number(source: &str, start: usize) -> Option<(f64, usize)> {
    let bytes = source.as_bytes();
    let mut i = start;
    if i < bytes.len() && (bytes[i] == b'-' || bytes[i] == b'+') {
        i += 1;
    }
    let mut digits = 0usize;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        digits += 1;
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            digits += 1;
            i += 1;
        }
    }
    if digits == 0 {
        return None;
    }
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        let before = i;
        i += 1;
        if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
            i += 1;
        }
        let exp = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp {
            i = before;
        }
    }
    let val: f64 = source[start..i].parse().ok()?;
    if val.is_finite() { Some((val, i)) } else { None }
}

fn svg_format_num(n: f64, precision: usize) -> String {
    let s = format!("{n:.precision$}", precision = precision);
    let parsed: f64 = s.parse().unwrap_or(0.0);
    if parsed == 0.0 {
        "0".to_string()
    } else {
        format!("{parsed}")
    }
}

fn svg_round_list(source: &str, precision: usize) -> String {
    let mut result = String::new();
    let mut i = 0usize;
    while i < source.len() {
        if let Some((val, end)) = svg_read_number(source, i) {
            result.push_str(&svg_format_num(val, precision));
            i = end;
        } else {
            let ch = source[i..].chars().next().unwrap();
            result.push(ch);
            i += ch.len_utf8();
        }
    }
    result
}

fn svg_compact_path(source: &str, precision: usize) -> String {
    let arity = |c: char| -> Option<usize> {
        match c.to_ascii_uppercase() {
            'M' | 'L' | 'T' => Some(2),
            'H' | 'V' => Some(1),
            'S' | 'Q' => Some(4),
            'C' => Some(6),
            'A' => Some(7),
            'Z' => Some(0),
            _ => None,
        }
    };
    let bytes = source.as_bytes();
    let is_sep = |b: u8| matches!(b, b' ' | b'\n' | b'\t' | b'\r' | b',');
    let mut result = String::new();
    let mut command: Option<char> = None;
    let mut i = 0usize;
    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut sx = 0.0f64;
    let mut sy = 0.0f64;
    while i < bytes.len() {
        while i < bytes.len() && is_sep(bytes[i]) {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let ch = bytes[i] as char;
        if arity(ch).is_some() {
            command = Some(ch);
            i += 1;
            if ch.eq_ignore_ascii_case(&'Z') {
                result.push('Z');
                x = sx;
                y = sy;
                command = None;
                continue;
            }
        }
        let Some(cmd_ch) = command else {
            return source.to_string();
        };
        let count = arity(cmd_ch).unwrap_or(0);
        let mut values: Vec<f64> = Vec::with_capacity(count);
        for _ in 0..count {
            while i < bytes.len() && is_sep(bytes[i]) {
                i += 1;
            }
            let Some((val, end)) = svg_read_number(source, i) else {
                return source.to_string();
            };
            values.push(val);
            i = end;
        }
        let upper = cmd_ch.to_ascii_uppercase();
        let relative = cmd_ch != upper;
        let mut emitted = cmd_ch;
        if matches!(upper, 'M' | 'L' | 'T') {
            let nx = values[0] + if relative { x } else { 0.0 };
            let ny = values[1] + if relative { y } else { 0.0 };
            if upper == 'L' && svg_format_num(ny, precision) == svg_format_num(y, precision) {
                emitted = 'H';
                values = vec![nx];
            } else if upper == 'L' && svg_format_num(nx, precision) == svg_format_num(x, precision) {
                emitted = 'V';
                values = vec![ny];
            }
            x = nx;
            y = ny;
            if upper == 'M' {
                sx = x;
                sy = y;
            }
        } else if upper == 'H' {
            x = values[0] + if relative { x } else { 0.0 };
        } else if upper == 'V' {
            y = values[0] + if relative { y } else { 0.0 };
        } else if values.len() >= 2 {
            x = values[values.len() - 2] + if relative { x } else { 0.0 };
            y = values[values.len() - 1] + if relative { y } else { 0.0 };
        }
        result.push(emitted);
        let formatted: Vec<String> = values.into_iter().map(|v| svg_format_num(v, precision)).collect();
        result.push_str(&formatted.join(" "));
        if upper == 'M' {
            command = Some(if relative { 'l' } else { 'L' });
        }
    }
    result
}

fn optimize_svg_str(source: &str, precision: usize, pretty: bool, indent: usize) -> Result<String, String> {
    let mut root = parse_svg_xml(source)?;
    let is_num_attr = |k: &str| {
        matches!(
            k,
            "x" | "y"
                | "x1"
                | "y1"
                | "x2"
                | "y2"
                | "cx"
                | "cy"
                | "r"
                | "rx"
                | "ry"
                | "width"
                | "height"
                | "stroke-width"
                | "stroke-opacity"
                | "fill-opacity"
                | "opacity"
                | "font-size"
                | "offset"
        )
    };
    fn visit_el(
        mut el: SvgEl,
        precision: usize,
        is_num_attr: &dyn Fn(&str) -> bool,
    ) -> Vec<SvgChild> {
        if el.name == "metadata" {
            return Vec::new();
        }
        for (k, v) in &mut el.attrs {
            if k == "d" {
                *v = svg_compact_path(v, precision);
            } else if k == "viewBox" || k == "points" || k == "transform" {
                *v = svg_round_list(v, precision);
            } else if is_num_attr(k)
                && let Some((num, end)) = svg_read_number(v, 0)
            {
                *v = format!("{}{}", svg_format_num(num, precision), &v[end..]);
            }
        }
        let old_children = std::mem::take(&mut el.children);
        for ch in old_children {
            match ch {
                SvgChild::Text(t) => el.children.push(SvgChild::Text(t)),
                SvgChild::El(sub) => el.children.extend(visit_el(sub, precision, is_num_attr)),
            }
        }
        if el.name == "g" && el.attrs.is_empty() {
            return el.children;
        }
        vec![SvgChild::El(el)]
    }
    if let Some(SvgChild::El(r)) = visit_el(root, precision, &is_num_attr).into_iter().next() {
        root = r;
    } else {
        return Err("Malformed SVG".to_string());
    }
    if root.get_attr("viewBox").is_none() {
        let w_str = root.get_attr("width").unwrap_or("").to_string();
        let h_str = root.get_attr("height").unwrap_or("").to_string();
        if let (Some((wv, we)), Some((hv, he))) = (svg_read_number(&w_str, 0), svg_read_number(&h_str, 0)) {
            let wu = &w_str[we..];
            let hu = &h_str[he..];
            if wv > 0.0 && hv > 0.0 && (wu.is_empty() || wu == "px") && (hu.is_empty() || hu == "px") {
                root.set_attr(
                    "viewBox",
                    format!("0 0 {} {}", svg_format_num(wv, precision), svg_format_num(hv, precision)),
                );
            }
        }
    } else if let Some(vb) = root.get_attr("viewBox").map(|s| s.to_string()) {
        let vals: Vec<&str> = vb
            .split(|c: char| matches!(c, ',' | ' ' | '\t' | '\r' | '\n'))
            .filter(|s| !s.is_empty())
            .collect();
        if vals.len() == 4 {
            let parsed: Vec<Option<f64>> = vals.iter().map(|v| v.parse::<f64>().ok().filter(|n| n.is_finite())).collect();
            if parsed.iter().all(|o| o.is_some()) {
                let formatted: Vec<String> = parsed
                    .into_iter()
                    .map(|o| svg_format_num(o.unwrap(), precision))
                    .collect();
                root.set_attr("viewBox", formatted.join(" "));
            }
        }
    }
    fn serialize_svg(el: &SvgEl, depth: usize, pretty: bool, indent: usize) -> String {
        let mut attrs = String::new();
        for (k, v) in &el.attrs {
            attrs.push_str(&format!(" {k}=\"{v}\""));
        }
        if pretty
            && !el.children.is_empty()
            && el.children.iter().all(|c| matches!(c, SvgChild::El(_)))
            && el.name != "text"
            && el.name != "tspan"
        {
            let mut inner = Vec::new();
            for ch in &el.children {
                if let SvgChild::El(sub) = ch {
                    inner.push(format!(
                        "{}{}",
                        " ".repeat((depth + 1) * indent),
                        serialize_svg(sub, depth + 1, pretty, indent)
                    ));
                }
            }
            return format!(
                "<{}{}>\n{}\n{}</{}>",
                el.name,
                attrs,
                inner.join("\n"),
                " ".repeat(depth * indent),
                el.name
            );
        }
        if el.children.is_empty() {
            format!("<{}{}/>", el.name, attrs)
        } else {
            let mut inner = String::new();
            for ch in &el.children {
                match ch {
                    SvgChild::Text(t) => inner.push_str(t),
                    SvgChild::El(sub) => inner.push_str(&serialize_svg(sub, depth + 1, pretty, indent)),
                }
            }
            format!("<{}{}>{}</{}>", el.name, attrs, inner, el.name)
        }
    }
    Ok(serialize_svg(&root, 0, pretty, indent))
}

fn parse_svg_length_px(val: Option<&str>, fallback: f64) -> Result<f64, String> {
    let Some(v) = val else {
        return Ok(fallback);
    };
    let (scale, num_str) = if let Some(s) = v.strip_suffix("px") {
        (1.0, s)
    } else if let Some(s) = v.strip_suffix("pt") {
        (96.0 / 72.0, s)
    } else if let Some(s) = v.strip_suffix("in") {
        (96.0, s)
    } else if let Some(s) = v.strip_suffix("cm") {
        (96.0 / 2.54, s)
    } else if let Some(s) = v.strip_suffix("mm") {
        (96.0 / 25.4, s)
    } else if let Some(s) = v.strip_suffix("pc") {
        (16.0, s)
    } else {
        (1.0, v)
    };
    let n: f64 = num_str
        .trim()
        .parse()
        .map_err(|_| format!("Unsupported SVG length {v}"))?;
    if !n.is_finite() {
        return Err(format!("Unsupported SVG length {v}"));
    }
    Ok(n * scale)
}

fn collect_svg_texts(el: &SvgEl, out: &mut Vec<String>) {
    if el.name == "text" {
        let mut t = String::new();
        for ch in &el.children {
            if let SvgChild::Text(s) = ch {
                t.push_str(&xml_unescape_str(s));
            }
        }
        if !t.is_empty() {
            out.push(t);
        }
        return;
    }
    for ch in &el.children {
        if let SvgChild::El(sub) = ch {
            collect_svg_texts(sub, out);
        }
    }
}

fn svg_tokens(source: &str) -> Result<Vec<Result<f64, char>>, String> {
    let bytes = source.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_whitespace() || b == b',' {
            i += 1;
            continue;
        }
        if !b"0123456789.+-".contains(&b) {
            let ch = source[i..].chars().next().unwrap();
            out.push(Err(ch));
            i += ch.len_utf8();
            continue;
        }
        let start = i;
        i += 1;
        while i < bytes.len() && b"0123456789.".contains(&bytes[i]) {
            i += 1;
        }
        if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
            i += 1;
            if i < bytes.len() && (bytes[i] == b'+' || bytes[i] == b'-') {
                i += 1;
            }
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
        }
        let num: f64 = source[start..i]
            .parse()
            .map_err(|_| "Invalid SVG number".to_string())?;
        if !num.is_finite() {
            return Err("Invalid SVG number".to_string());
        }
        out.push(Ok(num));
    }
    Ok(out)
}

fn svg_numbers(source: &str) -> Result<Vec<f64>, String> {
    let mut out = Vec::new();
    for tok in svg_tokens(source)? {
        match tok {
            Ok(n) => out.push(n),
            Err(_) => return Err("Expected SVG number".to_string()),
        }
    }
    Ok(out)
}

fn js_math_round(v: f64) -> f64 {
    if !v.is_finite() || v == 0.0 {
        return v;
    }
    if v > 0.0 {
        let f = v.floor();
        if v - f >= 0.5 { f + 1.0 } else { f }
    } else {
        let c = v.ceil();
        if c - v > 0.5 { c - 1.0 } else { c }
    }
}

fn fmt_js_precision_3(val: f64) -> String {
    if !val.is_finite() || val == 0.0 {
        return "0.00".to_string();
    }
    let abs = val.abs();
    let mut exp = abs.log10().floor() as i32;
    let scale = 10f64.powi(exp - 2);
    let mut mant = js_math_round(abs / scale) as i64;
    if mant >= 1000 {
        mant = 100;
        exp += 1;
    }
    let d0 = (mant / 100) % 10;
    let d1 = (mant / 10) % 10;
    let d2 = mant % 10;
    let sign = if val < 0.0 { "-" } else { "" };
    if exp < -6 || exp >= 3 {
        let esign = if exp >= 0 { "+" } else { "-" };
        format!("{sign}{d0}.{d1}{d2}e{esign}{}", exp.abs())
    } else if exp == 2 {
        format!("{sign}{d0}{d1}{d2}")
    } else if exp == 1 {
        format!("{sign}{d0}{d1}.{d2}")
    } else if exp == 0 {
        format!("{sign}{d0}.{d1}{d2}")
    } else {
        let zeros = "0".repeat((-exp - 1) as usize);
        format!("{sign}0.{zeros}{d0}{d1}{d2}")
    }
}

#[derive(Clone, Debug)]
struct WavStreamInfo {
    format_name: String,
    codec: String,
    sample_rate: u32,
    channels: usize,
    bits_per_sample: u32,
    samples: usize,
    duration: f64,
    bitrate: f64,
    tags: Vec<(String, String)>,
}

#[derive(Clone, Debug)]
struct PcmAudio {
    sample_rate: u32,
    channels: Vec<Vec<f64>>,
}

fn probe_wav_info(bytes: &[u8]) -> Result<WavStreamInfo, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("Unsupported audio container".to_string());
    }
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = if riff_size == 0xffffffff {
        bytes.len()
    } else {
        riff_size.saturating_add(8)
    };
    if end > bytes.len() {
        return Err("Truncated binary input".to_string());
    }
    let mut format = 0u16;
    let mut sample_rate = 0u32;
    let mut channels = 0usize;
    let mut bits = 0u32;
    let mut valid_bits = 0u32;
    let mut align = 0usize;
    let mut data_size = 0usize;
    let mut tags: Vec<(String, String)> = Vec::new();
    let mut offset = 12usize;
    while offset < end {
        if offset + 8 > end {
            return Err("WAV chunk exceeds RIFF bounds".to_string());
        }
        let ctype = &bytes[offset..offset + 4];
        let decl_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let size = if ctype == b"data" && decl_size == 0xffffffff {
            end - start
        } else {
            decl_size
        };
        if size > end - start {
            return Err("WAV chunk exceeds RIFF bounds".to_string());
        }
        if ctype == b"fmt " {
            if size < 16 {
                return Err("Short WAV fmt chunk".to_string());
            }
            format = u16::from_le_bytes(bytes[start..start + 2].try_into().unwrap());
            channels = u16::from_le_bytes(bytes[start + 2..start + 4].try_into().unwrap()) as usize;
            sample_rate = u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap());
            align = u16::from_le_bytes(bytes[start + 12..start + 14].try_into().unwrap()) as usize;
            bits = u16::from_le_bytes(bytes[start + 14..start + 16].try_into().unwrap()) as u32;
            valid_bits = bits;
            if format == 0xfffe {
                if size < 40 || u16::from_le_bytes(bytes[start + 16..start + 18].try_into().unwrap()) < 22 {
                    return Err("Short extensible WAV fmt".to_string());
                }
                let vb = u16::from_le_bytes(bytes[start + 18..start + 20].try_into().unwrap()) as u32;
                valid_bits = if vb == 0 { bits } else { vb };
                let guid_tail = &bytes[start + 26..start + 40];
                if guid_tail != [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113] {
                    return Err("Unsupported WAV subformat GUID".to_string());
                }
                format = u16::from_le_bytes(bytes[start + 24..start + 26].try_into().unwrap());
            }
        } else if ctype == b"data" {
            data_size += size;
        } else if ctype == b"LIST" && size >= 4 && &bytes[start..start + 4] == b"INFO" {
            let mut pos = start + 4;
            while pos < start + size {
                if pos + 8 > start + size {
                    return Err("WAV INFO exceeds LIST bounds".to_string());
                }
                let id = String::from_utf8_lossy(&bytes[pos..pos + 4]).to_string();
                let len = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().unwrap()) as usize;
                if len > start + size - pos - 8 {
                    return Err("WAV INFO exceeds LIST bounds".to_string());
                }
                let raw_val = &bytes[pos + 8..pos + 8 + len];
                let val = String::from_utf8_lossy(raw_val)
                    .trim_end_matches('\0')
                    .to_string();
                let key = match id.as_str() {
                    "INAM" => "title".to_string(),
                    "IART" => "artist".to_string(),
                    "IPRD" => "album".to_string(),
                    "ITRK" => "track".to_string(),
                    "ICMT" => "comment".to_string(),
                    "ICRD" => "date".to_string(),
                    "IGNR" => "genre".to_string(),
                    "ISFT" => "encoder".to_string(),
                    "ICOP" => "copyright".to_string(),
                    _ => id,
                };
                if let Some(existing) = tags.iter_mut().find(|(k, _)| k == &key) {
                    existing.1 = val;
                } else {
                    tags.push((key, val));
                }
                pos += 8 + len + (len % 2);
            }
        }
        offset = start + size + (size % 2);
    }
    if channels == 0
        || sample_rate == 0
        || align == 0
        || align * 8 != channels * (bits as usize)
        || data_size % align != 0
        || valid_bits > bits
        || valid_bits == 0
    {
        return Err("Inconsistent WAV sample layout".to_string());
    }
    if (format != 1 && format != 3)
        || (format == 1 && !matches!(bits, 8 | 16 | 24 | 32))
        || (format == 3 && !matches!(bits, 32 | 64))
    {
        return Err("Unsupported WAV encoding".to_string());
    }
    let samples = data_size / align;
    let duration = samples as f64 / sample_rate as f64;
    let bitrate = if duration > 0.0 { (bytes.len() as f64 * 8.0) / duration } else { 0.0 };
    Ok(WavStreamInfo {
        format_name: "wav".to_string(),
        codec: if format == 3 { "pcm_float".to_string() } else { "pcm".to_string() },
        sample_rate,
        channels,
        bits_per_sample: bits,
        samples,
        duration,
        bitrate,
        tags,
    })
}

#[path = "video_filter.rs"]
mod video_filter;
#[path = "ffmpeg_input.rs"]
mod ffmpeg_input;
#[path = "ffmpeg_wave.rs"]
mod ffmpeg_wave;
#[path = "lavfi.rs"]
mod lavfi;
#[path = "y4m.rs"]
mod y4m;
#[path = "jpeg.rs"]
mod jpeg;
#[path = "jpeg_decode.rs"]
mod jpeg_decode;
#[path = "frame_output.rs"]
mod frame_output;
#[path = "subtitles.rs"]
mod subtitles;
#[path = "adts.rs"]
mod adts;
#[path = "mp4.rs"]
mod mp4;

#[path = "streaming_input.rs"]
mod streaming_input;
#[path = "avi_input.rs"]
mod avi_input;
#[path = "media_format.rs"]
mod media_format;
#[path = "media_probe.rs"]
mod media_probe;

fn format_wave_probe(
    info: &WavStreamInfo,
    size: usize,
    filename: &str,
    sections: &BTreeMap<&str, Option<&str>>,
    writer: &str,
    settings: &BTreeMap<&str, &str>,
) -> String {
    use super::structured::{JVal, format_jval_with_indent};
    use JVal::{Number, Object, Str};
    let enabled = |long, short, fallback| {
        settings
            .get(long)
            .or_else(|| settings.get(short))
            .map_or(fallback, |v| *v == "1")
    };
    let includes = |section, key: &str| match sections.get(section) {
        Some(None) => true,
        Some(Some(fields)) => fields.split(',').any(|field| field == key),
        None => false,
    };
    let mut result = Vec::new();
    let mut lines = Vec::new();
    for (section, tag_section) in [("stream", "stream_tags"), ("format", "format_tags")] {
        if !sections.contains_key(section) && !sections.contains_key(tag_section) {
            continue;
        }
        let duration = Str(format!("{:.6}", info.duration));
        let mut fields = if section == "stream" {
            let bits = info.bits_per_sample;
            let codec = match (info.codec.as_str(), bits) {
                ("pcm_float", _) => format!("pcm_f{bits}le"),
                (_, 8) => "pcm_u8".to_owned(),
                _ => format!("pcm_s{bits}le"),
            };
            vec![
                ("index", Number(0.0, None)),
                ("codec_name", Str(codec)),
                ("codec_type", Str("audio".into())),
                ("sample_rate", Str(info.sample_rate.to_string())),
                ("channels", Number(info.channels as f64, None)),
                ("bits_per_sample", Number(bits as f64, None)),
                ("duration", duration),
                (
                    "bit_rate",
                    Str((info.sample_rate as u64 * info.channels as u64 * bits as u64).to_string()),
                ),
            ]
        } else {
            vec![
                ("filename", Str(filename.into())),
                ("nb_streams", Number(1.0, None)),
                ("format_name", Str("wav".into())),
                ("duration", duration),
                ("size", Str(size.to_string())),
                ("bit_rate", Str(info.bitrate.floor().to_string())),
            ]
        };
        fields.retain(|(key, _)| includes(section, key));
        if sections.contains_key(tag_section)
            || (section == "format" && !info.tags.is_empty() && includes(section, "tags"))
        {
            fields.push((
                "tags",
                Object(
                    info.tags
                        .iter()
                        .filter(|(k, _)| {
                            !sections.contains_key(tag_section) || includes(tag_section, k)
                        })
                        .map(|(k, v)| {
                            (
                                k.clone(),
                                Str(v.split('\0').next().unwrap_or("").trim().to_owned()),
                            )
                        })
                        .collect(),
                ),
            ));
        }
        if writer == "json" {
            let row = Object(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect());
            result.push(if section == "stream" {
                ("streams".into(), JVal::Array(vec![row]))
            } else {
                ("format".into(), row)
            });
            continue;
        }
        let csv = writer == "csv";
        let delimited = csv || writer == "compact";
        let mut values = Vec::new();
        let sep = settings
            .get("item_sep")
            .or_else(|| settings.get("s"))
            .copied()
            .unwrap_or(if csv { "," } else { "|" });
        let wrappers = writer == "default" && !enabled("noprint_wrappers", "nw", false);
        if wrappers {
            lines.push(format!("[{}]", section.to_uppercase()));
        }
        if delimited && enabled("print_section", "p", true) {
            values.push(section.to_owned());
        }
        let mut emit = |key: &str, value: &JVal, tag: bool| {
            if writer == "flat" {
                let prefix = if section == "stream" {
                    "streams.stream.0"
                } else {
                    "format"
                };
                let tag_prefix = if tag { "tags." } else { "" };
                lines.push(format!(
                    "{prefix}.{tag_prefix}{key}={}",
                    value.to_json_string(true, false, 0)
                ));
                return;
            }
            let mut field = String::new();
            if !enabled("nokey", "nk", csv) {
                if tag {
                    field.push_str(if delimited { "tag:" } else { "TAG:" });
                }
                field.push_str(key);
                field.push('=');
            }
            match value {
                Str(s) => field.push_str(s),
                _ => field.push_str(&value.to_json_string(true, false, 0)),
            }
            if delimited {
                if csv {
                    if field.contains(sep) || field.contains(['"', '\n']) {
                        field = format!("\"{}\"", field.replace('"', "\"\""));
                    }
                } else {
                    field = field
                        .replace('\\', "\\\\")
                        .replace('\n', "\\n")
                        .replace('\r', "\\r");
                    if !sep.is_empty() {
                        field = field.replace(sep, &format!("\\{sep}"));
                    }
                }
                values.push(field);
            } else {
                lines.push(field);
            }
        };
        for (key, value) in &fields {
            if let Object(tags) = value {
                for (k, v) in tags {
                    emit(k, v, true);
                }
            } else {
                emit(key, value, false);
            }
        }
        if delimited {
            lines.push(values.join(sep));
        }
        if wrappers {
            lines.push(format!("[/{}]", section.to_uppercase()));
        }
    }
    if writer == "json" {
        lines.push(format_jval_with_indent(&Object(result), Some(4), 0));
    }
    if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    }
}

fn decode_wav_pcm(bytes: &[u8]) -> Result<(PcmAudio, WavStreamInfo), String> {
    let info = probe_wav_info(bytes)?;
    let width = (info.bits_per_sample / 8) as usize;
    let mut channels = vec![vec![0.0f64; info.samples]; info.channels];
    let riff_size = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let end = if riff_size == 0xffffffff {
        bytes.len()
    } else {
        riff_size.saturating_add(8)
    };
    let mut frame = 0usize;
    let mut offset = 12usize;
    while offset < end {
        let ctype = &bytes[offset..offset + 4];
        let decl_size = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let start = offset + 8;
        let size = if ctype == b"data" && decl_size == 0xffffffff {
            end - start
        } else {
            decl_size
        };
        if ctype == b"data" {
            let chunk = &bytes[start..start + size];
            let step = width * info.channels;
            let mut pos_frame = 0usize;
            while pos_frame < chunk.len() {
                for ch in 0..info.channels {
                    let pos = pos_frame + ch * width;
                    let sample = if info.codec == "pcm_float" {
                        if info.bits_per_sample == 32 {
                            f32::from_le_bytes(chunk[pos..pos + 4].try_into().unwrap()) as f64
                        } else {
                            f64::from_le_bytes(chunk[pos..pos + 8].try_into().unwrap())
                        }
                    } else if info.bits_per_sample == 8 {
                        (chunk[pos] as f64 - 128.0) / 128.0
                    } else if info.bits_per_sample == 16 {
                        i16::from_le_bytes(chunk[pos..pos + 2].try_into().unwrap()) as f64 / 32768.0
                    } else if info.bits_per_sample == 24 {
                        let raw = (chunk[pos] as i32)
                            | ((chunk[pos + 1] as i32) << 8)
                            | ((chunk[pos + 2] as i32) << 16);
                        let signed = if raw >= 0x800000 { raw - 0x1000000 } else { raw };
                        signed as f64 / 8388608.0
                    } else {
                        i32::from_le_bytes(chunk[pos..pos + 4].try_into().unwrap()) as f64 / 2147483648.0
                    };
                    if !sample.is_finite() {
                        return Err("Non-finite PCM sample".to_string());
                    }
                    channels[ch][frame] = sample;
                }
                pos_frame += step;
                frame += 1;
            }
        }
        offset = start + size + (size % 2);
    }
    Ok((
        PcmAudio {
            sample_rate: info.sample_rate,
            channels,
        },
        info,
    ))
}

fn encode_wav_pcm(pcm: &PcmAudio, bits: u32, floating: bool) -> Result<Vec<u8>, String> {
    if (floating && !matches!(bits, 32 | 64)) || (!floating && !matches!(bits, 8 | 16 | 24 | 32)) {
        return Err("Unsupported WAV precision".to_string());
    }
    let ch_count = pcm.channels.len();
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let align = (ch_count * (bits as usize)) / 8;
    let mut fmt = Vec::with_capacity(16);
    fmt.extend_from_slice(&(if floating { 3u16 } else { 1u16 }).to_le_bytes());
    fmt.extend_from_slice(&(ch_count as u16).to_le_bytes());
    fmt.extend_from_slice(&pcm.sample_rate.to_le_bytes());
    fmt.extend_from_slice(&(pcm.sample_rate * (align as u32)).to_le_bytes());
    fmt.extend_from_slice(&(align as u16).to_le_bytes());
    fmt.extend_from_slice(&(bits as u16).to_le_bytes());

    let width = (bits / 8) as usize;
    let mut data = vec![0u8; frames * align];
    let scale = 2f64.powi((bits as i32) - 1);
    for frame in 0..frames {
        for ch in 0..ch_count {
            let pos = frame * align + ch * width;
            let value = pcm.channels[ch][frame];
            if floating {
                if bits == 32 {
                    data[pos..pos + 4].copy_from_slice(&(value as f32).to_le_bytes());
                } else {
                    data[pos..pos + 8].copy_from_slice(&value.to_le_bytes());
                }
            } else {
                let sample = js_math_round(value * scale).clamp(-scale, scale - 1.0) as i64;
                if bits == 8 {
                    data[pos] = (sample + 128) as u8;
                } else if bits == 16 {
                    data[pos..pos + 2].copy_from_slice(&(sample as i16).to_le_bytes());
                } else if bits == 24 {
                    data[pos] = (sample & 0xff) as u8;
                    data[pos + 1] = ((sample >> 8) & 0xff) as u8;
                    data[pos + 2] = ((sample >> 16) & 0xff) as u8;
                } else {
                    data[pos..pos + 4].copy_from_slice(&(sample as i32).to_le_bytes());
                }
            }
        }
    }

    let push_chunk = |out: &mut Vec<u8>, tag: &[u8; 4], payload: &[u8]| {
        out.extend_from_slice(tag);
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(payload);
        if payload.len() % 2 == 1 {
            out.push(0);
        }
    };
    let mut body = Vec::new();
    body.extend_from_slice(b"WAVE");
    push_chunk(&mut body, b"fmt ", &fmt);
    if floating {
        push_chunk(&mut body, b"fact", &(frames as u32).to_le_bytes());
    }
    push_chunk(&mut body, b"data", &data);
    let mut riff = Vec::with_capacity(8 + body.len());
    riff.extend_from_slice(b"RIFF");
    riff.extend_from_slice(&(body.len() as u32).to_le_bytes());
    riff.extend_from_slice(&body);
    Ok(riff)
}

fn sox_numeric(text: Option<&str>, label: &str) -> Result<f64, String> {
    let Some(t) = text else {
        return Err(format!("Missing {label}"));
    };
    let trimmed = t.trim();
    if trimmed.is_empty() {
        return Err(format!("Missing {label}"));
    }
    match trimmed.parse::<f64>() {
        Ok(v) if v.is_finite() => Ok(v),
        _ => Err(format!("Invalid {label}: {t}")),
    }
}

fn sox_seconds(text: Option<&str>, rate: u32) -> Result<f64, String> {
    let Some(t) = text else {
        return Err("Missing time".to_string());
    };
    let val = if let Some(prefix) = t.strip_suffix('s') {
        sox_numeric(Some(prefix), "sample position")? / (rate as f64)
    } else if t.contains(':') {
        let mut sum = 0.0f64;
        for part in t.split(':') {
            sum = sum * 60.0 + sox_numeric(Some(part), "time")?;
        }
        sum
    } else {
        sox_numeric(Some(t), "time")?
    };
    if val < 0.0 {
        return Err("Negative time".to_string());
    }
    Ok(val)
}

fn sox_stats(pcm: &PcmAudio) -> (f64, f64, f64, f64, f64, f64) {
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let mut peak = 0.0f64;
    let mut sum = 0.0f64;
    let mut squares = 0.0f64;
    for ch in &pcm.channels {
        for &v in ch {
            if v.abs() > peak {
                peak = v.abs();
            }
            sum += v;
            squares += v * v;
        }
    }
    let count = (frames * pcm.channels.len()) as f64;
    let rms = if count > 0.0 { (squares / count).sqrt() } else { 0.0 };
    let peak_dbfs = 20.0 * peak.log10();
    let rms_dbfs = 20.0 * rms.log10();
    let dc_offset = if count > 0.0 { sum / count } else { 0.0 };
    let crest = if rms > 0.0 { peak / rms } else { 0.0 };
    (peak, rms, peak_dbfs, rms_dbfs, dc_offset, crest)
}

fn sox_remix(pcm: &PcmAudio, count: usize, matrix: Option<Vec<Vec<f64>>>) -> Result<PcmAudio, String> {
    if count == 0 || count > 64 {
        return Err("Invalid output channel count".to_string());
    }
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let in_ch = pcm.channels.len();
    let weights = match matrix {
        Some(m) => m,
        None => (0..count)
            .map(|out_i| {
                (0..in_ch)
                    .map(|in_i| {
                        if count == 1 {
                            1.0 / (in_ch as f64)
                        } else if in_ch == 1 || out_i == in_i {
                            1.0
                        } else {
                            0.0
                        }
                    })
                    .collect()
            })
            .collect(),
    };
    let channels = weights
        .into_iter()
        .map(|row| {
            (0..frames)
                .map(|i| {
                    row.iter()
                        .enumerate()
                        .fold(0.0, |acc, (ch, &w)| acc + w * pcm.channels[ch][i])
                })
                .collect()
        })
        .collect();
    Ok(PcmAudio {
        sample_rate: pcm.sample_rate,
        channels,
    })
}

fn sox_resample(pcm: &PcmAudio, target_rate: u32) -> PcmAudio {
    let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
    let ratio = (target_rate as f64) / (pcm.sample_rate as f64);
    let length = js_math_round((frames as f64) * ratio) as usize;
    let cutoff = ratio.min(1.0);
    let radius = (24.0 / cutoff).ceil();
    let channels = pcm
        .channels
        .iter()
        .map(|ch| {
            (0..length)
                .map(|i| {
                    if frames == 0 {
                        return 0.0;
                    }
                    let position = (i as f64) / ratio;
                    let j_min = (position - radius).ceil().max(0.0) as usize;
                    let j_max = (position + radius).floor().min((frames - 1) as f64) as usize;
                    let mut sum = 0.0f64;
                    let mut weight = 0.0f64;
                    for j in j_min..=j_max {
                        let distance = position - (j as f64);
                        let x = std::f64::consts::PI * distance * cutoff;
                        let sinc = if x == 0.0 { 1.0 } else { x.sin() / x };
                        let win = 0.5 + 0.5 * ((std::f64::consts::PI * distance) / radius).cos();
                        let w = sinc * win;
                        sum += ch[j] * w;
                        weight += w;
                    }
                    if weight != 0.0 { sum / weight } else { 0.0 }
                })
                .collect()
        })
        .collect();
    PcmAudio {
        sample_rate: target_rate,
        channels,
    }
}

fn run_audio_info(
    prefix: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    let mut flag: Option<&str> = None;
    let mut files: Vec<&str> = Vec::new();
    for arg in args {
        if arg.starts_with('-') && arg != "-" {
            if flag.is_some()
                || !matches!(
                    arg.as_str(),
                    "-t" | "-r" | "-c" | "-s" | "-d" | "-D" | "-b" | "-B" | "-a"
                )
            {
                return err_out(&format!("{prefix}: Unsupported info option {arg}\n"), 1);
            }
            flag = Some(arg.as_str());
        } else {
            files.push(arg.as_str());
        }
    }
    if files.is_empty() || files.len() > 64 {
        return err_out(&format!("{prefix}: Expected bounded input files\n"), 1);
    }
    let mut text = String::new();
    for file in files {
        let data = if file == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, file);
            if fs.is_dir(&full) {
                return err_out(
                    &format!("{prefix}: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                    1,
                );
            }
            let Ok(b) = fs.read_file(&full) else {
                return err_out(
                    &format!("{prefix}: ENOENT: no such file or directory, readFile '{full}'\n"),
                    1,
                );
            };
            b
        };
        let info = match probe_wav_info(&data) {
            Ok(i) => i,
            Err(e) => return err_out(&format!("{prefix}: {e}\n"), 1),
        };
        let hh = (info.duration / 3600.0).floor() as u64;
        let mm = ((info.duration / 60.0).floor() as u64) % 60;
        let ss = info.duration % 60.0;
        let duration = format!("{hh:02}:{mm:02}:{ss:05.2}");
        let bitrate_str = format!("{}k", fmt_js_precision_3(info.bitrate / 1000.0));
        let comments = info
            .tags
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(fl) = flag {
            let v = match fl {
                "-t" => info.format_name,
                "-r" => info.sample_rate.to_string(),
                "-c" => info.channels.to_string(),
                "-s" => info.samples.to_string(),
                "-d" => duration,
                "-D" => format!("{:.6}", info.duration),
                "-b" => info.bits_per_sample.to_string(),
                "-B" => bitrate_str,
                "-a" => comments,
                _ => String::new(),
            };
            text.push_str(&v);
            text.push('\n');
        } else {
            text.push_str(&format!(
                "\nInput File     : '{file}'\nChannels       : {}\nSample Rate    : {}\nPrecision      : {}-bit\nDuration       : {duration} = {} samples\nBit Rate       : {bitrate_str}\n",
                info.channels, info.sample_rate, info.bits_per_sample, info.samples
            ));
        }
    }
    ok_out(&text)
}

const QR_CAPACITIES: [(usize, [usize; 4]); 41] = [
    (0, [0, 0, 0, 0]),
    (26, [7, 10, 13, 17]),
    (44, [10, 16, 22, 28]),
    (70, [15, 26, 36, 44]),
    (100, [20, 36, 52, 64]),
    (134, [26, 48, 72, 88]),
    (172, [36, 64, 96, 112]),
    (196, [40, 72, 108, 130]),
    (242, [48, 88, 132, 156]),
    (292, [60, 110, 160, 192]),
    (346, [72, 130, 192, 224]),
    (404, [80, 150, 224, 264]),
    (466, [96, 176, 260, 308]),
    (532, [104, 198, 288, 352]),
    (581, [120, 216, 320, 384]),
    (655, [132, 240, 360, 432]),
    (733, [144, 280, 408, 480]),
    (815, [168, 308, 448, 532]),
    (901, [180, 338, 504, 588]),
    (991, [196, 364, 546, 650]),
    (1085, [224, 416, 600, 700]),
    (1156, [224, 442, 644, 750]),
    (1258, [252, 476, 690, 816]),
    (1364, [270, 504, 750, 900]),
    (1474, [300, 560, 810, 960]),
    (1588, [312, 588, 870, 1050]),
    (1706, [336, 644, 952, 1110]),
    (1828, [360, 700, 1020, 1200]),
    (1921, [390, 728, 1050, 1260]),
    (2051, [420, 784, 1140, 1350]),
    (2185, [450, 812, 1200, 1440]),
    (2323, [480, 868, 1290, 1530]),
    (2465, [510, 924, 1350, 1620]),
    (2611, [540, 980, 1440, 1710]),
    (2761, [570, 1036, 1530, 1800]),
    (2876, [570, 1064, 1590, 1890]),
    (3034, [600, 1120, 1680, 1980]),
    (3196, [630, 1204, 1770, 2100]),
    (3362, [660, 1260, 1860, 2220]),
    (3532, [720, 1316, 1950, 2310]),
    (3706, [750, 1372, 2040, 2430]),
];

const QR_BLOCKS: [[usize; 4]; 41] = [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 2, 2],
    [1, 2, 2, 4],
    [1, 2, 4, 4],
    [2, 4, 4, 4],
    [2, 4, 6, 5],
    [2, 4, 6, 6],
    [2, 5, 8, 8],
    [4, 5, 8, 8],
    [4, 5, 8, 11],
    [4, 8, 10, 11],
    [4, 9, 12, 16],
    [4, 9, 16, 16],
    [6, 10, 12, 18],
    [6, 10, 17, 16],
    [6, 11, 16, 19],
    [6, 13, 18, 21],
    [7, 14, 21, 25],
    [8, 16, 20, 25],
    [8, 17, 23, 25],
    [9, 17, 23, 34],
    [9, 18, 25, 30],
    [10, 20, 27, 32],
    [12, 21, 29, 35],
    [12, 23, 34, 37],
    [12, 25, 34, 40],
    [13, 26, 35, 42],
    [14, 28, 38, 45],
    [15, 29, 40, 48],
    [16, 31, 43, 51],
    [17, 33, 45, 54],
    [18, 35, 48, 57],
    [19, 37, 51, 60],
    [19, 38, 53, 63],
    [20, 40, 56, 66],
    [21, 43, 59, 70],
    [22, 45, 62, 74],
    [24, 47, 65, 77],
    [25, 49, 68, 81],
];

const QR_MICRO_ECC: [[usize; 4]; 5] = [
    [0, 0, 0, 0],
    [2, 0, 0, 0],
    [5, 6, 0, 0],
    [6, 8, 0, 0],
    [8, 10, 14, 0],
];

fn qr_gf_mul(mut a: u16, mut b: u16) -> u8 {
    let mut res = 0u16;
    while b != 0 {
        if (b & 1) != 0 {
            res ^= a;
        }
        a <<= 1;
        if (a & 256) != 0 {
            a ^= 0x11d;
        }
        b >>= 1;
    }
    res as u8
}

fn qr_reed_solomon(data: &[u8], degree: usize) -> Vec<u8> {
    let mut poly = vec![0u8; degree + 1];
    poly[0] = 1;
    let mut root = 1u8;
    for n in 0..degree {
        for j in (1..=n + 1).rev() {
            poly[j] = poly[j - 1] ^ qr_gf_mul(poly[j] as u16, root as u16);
        }
        poly[0] = qr_gf_mul(poly[0] as u16, root as u16);
        root = qr_gf_mul(root as u16, 2);
    }
    let mut rem = vec![0u8; degree];
    for &byte in data {
        let factor = byte ^ rem[0];
        rem.copy_within(1..degree, 0);
        rem[degree - 1] = 0;
        for j in 0..degree {
            rem[j] ^= qr_gf_mul(factor as u16, poly[degree - j - 1] as u16);
        }
    }
    rem
}

fn qr_put_bits(bits: &mut Vec<u8>, value: usize, length: usize) {
    for i in (0..length).rev() {
        bits.push(((value >> i) & 1) as u8);
    }
}

fn qr_kanji_value(data: &[u8], offset: usize) -> i32 {
    if offset + 1 >= data.len() {
        return -1;
    }
    let lead = data[offset] as u32;
    let trail = data[offset + 1] as u32;
    let pair = lead * 256 + trail;
    if trail < 0x40
        || trail > 0xfc
        || trail == 0x7f
        || !((0x8140..=0x9ffc).contains(&pair) || (0xe040..=0xebbf).contains(&pair))
    {
        return -1;
    }
    let reduced = pair - if pair <= 0x9ffc { 0x8140 } else { 0xc140 };
    (((reduced >> 8) * 192) + (reduced & 0xff)) as i32
}

fn qr_count_bits(mode: usize, version: usize, micro: bool) -> usize {
    if micro {
        [[3, 4, 5, 6], [0, 3, 4, 5], [0, 0, 4, 5], [0, 0, 3, 4]][mode][version - 1]
    } else {
        let grp = if version < 10 { 0 } else if version < 27 { 1 } else { 2 };
        [[10, 12, 14], [9, 11, 13], [8, 16, 16], [8, 10, 12]][mode][grp]
    }
}

fn qr_payload_bits(mode: usize, count: usize) -> usize {
    match mode {
        0 => (count / 3) * 10 + [0, 4, 7][count % 3],
        1 => (count / 2) * 11 + (count % 2) * 6,
        2 => count * 8,
        _ => count * 13,
    }
}

#[derive(Clone, Copy)]
struct QrEncodeOpts {
    version: usize,
    level: usize,
    byte_mode: bool,
    kanji: bool,
    micro: bool,
    strict: bool,
    append: Option<(usize, usize, u8)>,
}

fn qr_capacity(version: usize, level: usize, micro: bool) -> (usize, usize, usize) {
    if micro {
        let ecc = QR_MICRO_ECC[version][level];
        let bits = if ecc > 0 {
            (version * 2 + 8).pow(2) - 64 - ecc * 8
        } else {
            0
        };
        (bits, ecc, 1)
    } else {
        let (total, eccs) = QR_CAPACITIES[version];
        let ecc = eccs[level];
        ((total - ecc) * 8, ecc, QR_BLOCKS[version][level])
    }
}

fn qr_segments(data: &[u8], version: usize, opts: QrEncodeOpts) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    let n = data.len();
    let mut bits = Vec::new();
    if let Some((idx, total, parity)) = opts.append {
        qr_put_bits(&mut bits, 3, 4);
        qr_put_bits(&mut bits, idx, 4);
        qr_put_bits(&mut bits, total - 1, 4);
        qr_put_bits(&mut bits, parity as usize, 8);
    }
    if opts.byte_mode {
        let length_bits = qr_count_bits(2, version, opts.micro);
        if length_bits == 0 || n >= 1 << length_bits {
            return Err("Input is not supported by this symbol version".to_string());
        }
        qr_put_bits(&mut bits, if opts.micro { 2 } else { 4 }, if opts.micro { version - 1 } else { 4 });
        qr_put_bits(&mut bits, n, length_bits);
        bits.reserve(n * 8);
        for &byte in data { qr_put_bits(&mut bits, byte as usize, 8); }
        return Ok(bits);
    }
    let mut costs = vec![f64::INFINITY; n + 1];
    let mut starts = vec![0usize; n + 1];
    let mut modes = vec![0usize; n + 1];
    costs[0] = 0.0;
    for start in 0..n {
        if !costs[start].is_finite() {
            continue;
        }
        for mode in 0..4usize {
            if mode == 3 && !opts.kanji {
                continue;
            }
            let cb = qr_count_bits(mode, version, opts.micro);
            if cb == 0 {
                continue;
            }
            let step = if mode == 3 { 2 } else { 1 };
            let max_count = 1usize << cb;
            let mut end = start + step;
            let mut count = 1usize;
            while end <= n && count < max_count {
                let b = data[end - step];
                if (mode == 0 && !b.is_ascii_digit())
                    || (mode == 1 && !ALPHABET.contains(&b))
                    || (mode == 3 && qr_kanji_value(data, end - 2) < 0)
                {
                    break;
                }
                let header = if opts.micro { version - 1 } else { 4 };
                let cost = costs[start] + ((header + cb + qr_payload_bits(mode, count)) as f64);
                if cost < costs[end] {
                    costs[end] = cost;
                    starts[end] = start;
                    modes[end] = mode;
                }
                end += step;
                count += 1;
            }
        }
    }
    if !costs[n].is_finite() {
        return Err("Input is not supported by this symbol version".to_string());
    }
    let mut parts: Vec<(usize, usize, usize)> = Vec::new();
    let mut cur = n;
    while cur > 0 {
        let st = starts[cur];
        parts.push((st, cur, modes[cur]));
        cur = st;
    }
    parts.reverse();
    for (start, end, mode) in parts {
        let mode_ind = if opts.micro { mode } else { [1, 2, 4, 8][mode] };
        let mode_len = if opts.micro { version - 1 } else { 4 };
        qr_put_bits(&mut bits, mode_ind, mode_len);
        let char_count = (end - start) / if mode == 3 { 2 } else { 1 };
        qr_put_bits(&mut bits, char_count, qr_count_bits(mode, version, opts.micro));
        let mut i = start;
        while i < end {
            match mode {
                0 => {
                    let cnt = (end - i).min(3);
                    let mut val = 0usize;
                    for _ in 0..cnt {
                        val = val * 10 + (data[i] - b'0') as usize;
                        i += 1;
                    }
                    qr_put_bits(&mut bits, val, [0, 4, 7, 10][cnt]);
                }
                1 => {
                    let a = ALPHABET.iter().position(|&c| c == data[i]).unwrap();
                    i += 1;
                    if i < end {
                        let b = ALPHABET.iter().position(|&c| c == data[i]).unwrap();
                        i += 1;
                        qr_put_bits(&mut bits, a * 45 + b, 11);
                    } else {
                        qr_put_bits(&mut bits, a, 6);
                    }
                }
                2 => {
                    qr_put_bits(&mut bits, data[i] as usize, 8);
                    i += 1;
                }
                _ => {
                    qr_put_bits(&mut bits, qr_kanji_value(data, i) as usize, 13);
                    i += 2;
                }
            }
        }
    }
    Ok(bits)
}

fn qr_codewords(mut bits: Vec<u8>, version: usize, level: usize, micro: bool) -> Vec<u8> {
    let (cap_bits, cap_ecc, cap_blocks) = qr_capacity(version, level, micro);
    let term = (cap_bits - bits.len()).min(if micro { version * 2 + 1 } else { 4 });
    qr_put_bits(&mut bits, 0, term);
    while bits.len() < cap_bits && bits.len() % 8 != 0 {
        bits.push(0);
    }
    let mut pad = 0usize;
    while bits.len() + 8 <= cap_bits {
        qr_put_bits(&mut bits, if pad % 2 == 1 { 0x11 } else { 0xec }, 8);
        pad += 1;
    }
    while bits.len() < cap_bits {
        bits.push(0);
    }
    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &b) in bits.iter().enumerate() {
        bytes[i >> 3] |= b << (7 - (i & 7));
    }
    if micro {
        for byte in qr_reed_solomon(&bytes, cap_ecc) {
            qr_put_bits(&mut bits, byte as usize, 8);
        }
        return bits;
    }
    let mut data_blocks: Vec<Vec<u8>> = Vec::with_capacity(cap_blocks);
    let mut ecc_blocks: Vec<Vec<u8>> = Vec::with_capacity(cap_blocks);
    let short_len = bytes.len() / cap_blocks;
    let long_cnt = bytes.len() % cap_blocks;
    let mut offset = 0usize;
    for i in 0..cap_blocks {
        let len = short_len + usize::from(i >= cap_blocks - long_cnt);
        let blk = bytes[offset..offset + len].to_vec();
        offset += len;
        ecc_blocks.push(qr_reed_solomon(&blk, cap_ecc / cap_blocks));
        data_blocks.push(blk);
    }
    let mut result = Vec::new();
    for group in [&data_blocks, &ecc_blocks] {
        let max_len = group.iter().map(|b| b.len()).max().unwrap_or(0);
        for i in 0..max_len {
            for blk in group {
                if i < blk.len() {
                    qr_put_bits(&mut result, blk[i] as usize, 8);
                }
            }
        }
    }
    result
}

fn qr_bch(value: usize, poly: usize, degree: usize) -> usize {
    let mut rem = value << degree;
    for bit in (degree..=30).rev() {
        if ((rem >> bit) & 1) != 0 {
            rem ^= poly << (bit - degree);
        }
    }
    (value << degree) | rem
}

fn qr_mask_bit(mask: usize, x: usize, y: usize) -> bool {
    let v = match mask {
        0 => (x + y) % 2,
        1 => y % 2,
        2 => x % 3,
        3 => (x + y) % 3,
        4 => ((y / 2) + (x / 3)) % 2,
        5 => ((x * y) % 2) + ((x * y) % 3),
        6 => (((x * y) % 2) + ((x * y) % 3)) % 2,
        _ => (((x + y) % 2) + ((x * y) % 3)) % 2,
    };
    v == 0
}

fn qr_penalty(grid: &[Vec<bool>]) -> i64 {
    let n = grid.len();
    let mut score = 0i64;
    let mut dark = 0i64;
    for y in 0..n {
        for x in 0..n {
            if grid[y][x] {
                dark += 1;
            }
            if x > 0
                && y > 0
                && grid[y][x] == grid[y - 1][x]
                && grid[y][x] == grid[y][x - 1]
                && grid[y][x] == grid[y - 1][x - 1]
            {
                score += 3;
            }
        }
    }
    for axis in 0..2 {
        for i in 0..n {
            let line: Vec<bool> = (0..n).map(|j| if axis == 1 { grid[j][i] } else { grid[i][j] }).collect();
            let mut run = 1i64;
            for j in 1..=n {
                if j < n && line[j] == line[j - 1] {
                    run += 1;
                } else {
                    if run >= 5 {
                        score += run - 2;
                    }
                    run = 1;
                }
            }
            let mut runs: Vec<(bool, usize)> = vec![(false, n)];
            for &color in &line {
                let last = runs.last_mut().unwrap();
                if last.0 == color {
                    last.1 += 1;
                } else {
                    runs.push((color, 1));
                }
            }
            if !runs.last().unwrap().0 {
                runs.last_mut().unwrap().1 += n;
            } else {
                runs.push((false, n));
            }
            let mut j = 1usize;
            while j + 5 < runs.len() {
                let unit = runs[j].1;
                if runs[j].0
                    && runs[j + 1].1 == unit
                    && runs[j + 2].1 == unit * 3
                    && runs[j + 3].1 == unit
                    && runs[j + 4].1 == unit
                    && (runs[j - 1].1 >= unit * 4 || runs[j + 5].1 >= unit * 4)
                {
                    score += 40;
                }
                j += 1;
            }
        }
    }
    let area = (n * n) as i64;
    let percent = (100 * dark + area / 2) / area;
    score + (percent - 50).abs() / 5 * 10
}

fn qr_matrix(bits: &[u8], version: usize, level: usize, micro: bool) -> Vec<Vec<bool>> {
    let n = if micro { 9 + version * 2 } else { 17 + version * 4 };
    let mut base = vec![vec![false; n]; n];
    let mut fixed = vec![vec![false; n]; n];
    let mut set = |x: isize, y: isize, val: bool| {
        if x >= 0 && y >= 0 && (x as usize) < n && (y as usize) < n {
            base[y as usize][x as usize] = val;
            fixed[y as usize][x as usize] = true;
        }
    };
    let mut finder = |cx: isize, cy: isize| {
        for y in -4..=4isize {
            for x in -4..=4isize {
                let d = x.abs().max(y.abs());
                set(cx + x, cy + y, d != 2 && d != 4);
            }
        }
    };
    finder(3, 3);
    if micro {
        for i in 8..n {
            set(i as isize, 0, i % 2 == 0);
            set(0, i as isize, i % 2 == 0);
        }
        for i in 1..=8 {
            set(8, i as isize, false);
            set(i as isize, 8, false);
        }
    } else {
        finder((n as isize) - 4, 3);
        finder(3, (n as isize) - 4);
        for i in 8..(n - 8) {
            set(6, i as isize, i % 2 == 0);
            set(i as isize, 6, i % 2 == 0);
        }
        if version > 1 {
            let count = (version / 7) + 2;
            let step = if version == 32 {
                26
            } else {
                ((n - 13) as f64 / ((count * 2 - 2) as f64)).ceil() as usize * 2
            };
            let mut positions = vec![6isize];
            for i in (0..=(count as isize - 2)).rev() {
                positions.push((n as isize) - 7 - i * (step as isize));
            }
            for yi in 0..count {
                for xi in 0..count {
                    if (xi == 0 && yi == 0)
                        || (xi == 0 && yi == count - 1)
                        || (xi == count - 1 && yi == 0)
                    {
                        continue;
                    }
                    for y in -2..=2isize {
                        for x in -2..=2isize {
                            set(
                                positions[xi] + x,
                                positions[yi] + y,
                                x.abs().max(y.abs()) != 1,
                            );
                        }
                    }
                }
            }
        }
        for i in 0..9 {
            if i != 6 {
                set(8, i as isize, false);
                set(i as isize, 8, false);
            }
        }
        for i in 0..8 {
            set((n - 1 - i) as isize, 8, false);
            set(8, (n - 1 - i) as isize, false);
        }
        set(8, (n - 8) as isize, true);
        if version >= 7 {
            let val = qr_bch(version, 0x1f25, 12);
            for i in 0..18 {
                let bit_val = ((val >> i) & 1) != 0;
                set((n - 11 + (i % 3)) as isize, (i / 3) as isize, bit_val);
                set((i / 3) as isize, (n - 11 + (i % 3)) as isize, bit_val);
            }
        }
    }
    let mut bit_idx = 0usize;
    let mut upward = true;
    let mut right = (n - 1) as isize;
    while right > 0 {
        if !micro && right == 6 {
            right -= 1;
        }
        for row in 0..n {
            let y = if upward { n - 1 - row } else { row };
            for x in [right as usize, (right - 1) as usize] {
                if !fixed[y][x] {
                    base[y][x] = bits.get(bit_idx).copied().unwrap_or(0) != 0;
                    bit_idx += 1;
                }
            }
        }
        upward = !upward;
        right -= 2;
    }
    let mut best = base.clone();
    let mut best_score = if micro { i64::MIN } else { i64::MAX };
    let mask_count = if micro { 4 } else { 8 };
    for mask in 0..mask_count {
        let actual_mask = if micro { [1, 4, 6, 7][mask] } else { mask };
        let mut grid: Vec<Vec<bool>> = (0..n)
            .map(|y| {
                (0..n)
                    .map(|x| {
                        if fixed[y][x] {
                            base[y][x]
                        } else {
                            base[y][x] != qr_mask_bit(actual_mask, x, y)
                        }
                    })
                    .collect()
            })
            .collect();
        if micro {
            let mtype = match version {
                1 => 0,
                2 => 1 + level,
                3 => 3 + level,
                _ => 5 + level,
            };
            let fmt = qr_bch(mtype * 4 + mask, 0x537, 10) ^ 0x4445;
            for i in 0..8 {
                grid[i + 1][8] = ((fmt >> i) & 1) != 0;
            }
            for i in 0..7 {
                grid[8][7 - i] = ((fmt >> (i + 8)) & 1) != 0;
            }
        } else {
            let fmt = qr_bch([1, 0, 3, 2][level] * 8 + mask, 0x537, 10) ^ 0x5412;
            for i in 0..15 {
                let val = ((fmt >> i) & 1) != 0;
                if i < 6 {
                    grid[i][8] = val;
                } else if i < 8 {
                    grid[i + 1][8] = val;
                } else {
                    grid[8][if i == 8 { 7 } else { 14 - i }] = val;
                }
                if i < 8 {
                    grid[8][n - 1 - i] = val;
                } else {
                    grid[n - 15 + i][8] = val;
                }
            }
        }
        let score = if micro {
            let mut a = 0i64;
            let mut b = 0i64;
            for i in 1..n {
                a += i64::from(grid[n - 1][i]);
                b += i64::from(grid[i][n - 1]);
            }
            a.min(b) * 16 + a.max(b)
        } else {
            qr_penalty(&grid)
        };
        if (micro && score > best_score) || (!micro && score < best_score) {
            best = grid;
            best_score = score;
        }
    }
    best
}

fn qr_encode_single(data: &[u8], opts: QrEncodeOpts) -> Result<Vec<Vec<bool>>, String> {
    if data.is_empty() || data.len() > 7089 {
        return Err("Input is empty or exceeds QR capacity".to_string());
    }
    let min_v = if opts.version == 0 { 1 } else { opts.version };
    let max_v = if opts.micro { 4 } else { 40 };
    if min_v < 1 || min_v > max_v || (opts.micro && opts.append.is_some()) {
        return Err("Invalid QR version or level".to_string());
    }
    let mut cached: Option<Vec<u8>> = None;
    let mut cached_group = isize::MIN;
    for version in min_v..=max_v {
        let (cap_bits, _, _) = qr_capacity(version, opts.level, opts.micro);
        if cap_bits == 0 {
            if opts.strict {
                break;
            }
            continue;
        }
        let grp = if opts.micro {
            version as isize
        } else if version < 10 {
            0
        } else if version < 27 {
            1
        } else {
            2
        };
        if grp != cached_group {
            cached = qr_segments(data, version, opts).ok();
            cached_group = grp;
        }
        if let Some(ref bits) = cached
            && bits.len() <= cap_bits
        {
            let cw = qr_codewords(bits.clone(), version, opts.level, opts.micro);
            return Ok(qr_matrix(&cw, version, opts.level, opts.micro));
        }
        if opts.strict {
            break;
        }
    }
    Err("Input does not fit the requested QR symbol".to_string())
}

fn qr_encode_symbols(data: &[u8], opts: QrEncodeOpts, structured: bool) -> Result<Vec<Vec<Vec<bool>>>, String> {
    if !structured {
        return Ok(vec![qr_encode_single(data, opts)?]);
    }
    let mut strict_opts = opts;
    strict_opts.strict = true;
    if let Ok(sym) = qr_encode_single(data, strict_opts) {
        return Ok(vec![sym]);
    }
    let mut parity = 0u8;
    for &b in data {
        parity ^= b;
    }
    let mut parts: Vec<&[u8]> = Vec::new();
    let mut offset = 0usize;
    while offset < data.len() {
        if parts.len() == 16 {
            return Err("Structured append exceeds 16 symbols".to_string());
        }
        let mut low = 0usize;
        let mut high = (data.len() - offset).min(7089);
        while low < high {
            let len = (low + high).div_ceil(2);
            let mut probe_opts = strict_opts;
            probe_opts.append = Some((0, 16, parity));
            if qr_encode_single(&data[offset..offset + len], probe_opts).is_ok() {
                low = len;
            } else {
                high = len - 1;
            }
        }
        if low == 0 {
            return Err("Input does not fit a structured symbol".to_string());
        }
        if opts.kanji && !opts.byte_mode && offset + low < data.len() {
            let mut cursor = offset;
            while cursor < offset + low {
                let b = data[cursor];
                cursor += if (0x81..=0x9f).contains(&b) || (0xe0..=0xeb).contains(&b) { 2 } else { 1 };
            }
            if cursor > offset + low {
                low -= 1;
            }
        }
        parts.push(&data[offset..offset + low]);
        offset += low;
    }
    let mut out = Vec::with_capacity(parts.len());
    for (idx, part) in parts.iter().enumerate() {
        let mut part_opts = strict_opts;
        part_opts.append = Some((idx, parts.len(), parity));
        out.push(qr_encode_single(part, part_opts)?);
    }
    Ok(out)
}

fn qr_fmt_ratio(v: u8) -> String {
    if v == 0 {
        "0".to_string()
    } else if v == 255 {
        "1".to_string()
    } else {
        format!("{}", (v as f64) / 255.0)
    }
}

pub(super) enum PngEncoding { Palette(u32, [u8; 4], [u8; 4]), PixelsPerMeter(u32), Density(u32), SplitDensity(u32, Option<u8>), Mermaid }

pub(super) fn pixel_png<const N: usize>(width: usize, height: usize, encoding: PngEncoding, pixel: impl Fn(usize, usize) -> [u8; N]) -> Vec<u8> {
    let indexed = matches!(encoding, PngEncoding::Palette(..));
    let mut raw = Vec::with_capacity((if indexed { width.div_ceil(8) } else { width * N } + 1) * height);
    for y in 0..height {
        if indexed {
            raw.push(0);
            let start = raw.len();
            raw.resize(start + width.div_ceil(8), 0xff);
            for x in 0..width {
                if pixel(x, y)[0] == 0 { raw[start + x / 8] &= !(0x80 >> (x % 8)); }
            }
        } else {
            raw.push(1); // Sub filter: store the channel difference from the pixel to the left.
            let mut prev = [0; N];
            for x in 0..width {
                let rgba = pixel(x, y);
                for i in 0..N { raw.push(rgba[i].wrapping_sub(prev[i])); }
                prev = rgba;
            }
        }
    }
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |tag: &[u8; 4], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(tag);
        out.extend_from_slice(data);
        out.extend_from_slice(&crc32_ieee(&out[start..]).to_be_bytes());
    };
    let mut header = [0; 13];
    header[..4].copy_from_slice(&(width as u32).to_be_bytes());
    header[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    header[8..10].copy_from_slice(&if indexed { [1, 3] } else { [8, match N { 1 => 0, 2 => 4, 3 => 2, 4 => 6, _ => unreachable!() }] });
    chunk(b"IHDR", &header);
    if let PngEncoding::Palette(_, fg, bg) = encoding {
        chunk(b"PLTE", &[fg[0], fg[1], fg[2], bg[0], bg[1], bg[2]]);
        chunk(b"tRNS", &[fg[3], bg[3]]);
    }
    match encoding {
        PngEncoding::Mermaid=>chunk(b"IDAT",&crate::commands::codecs::zlib_pixel_runs(&raw)),
        PngEncoding::Palette(value,..)|PngEncoding::PixelsPerMeter(value)|PngEncoding::Density(value)|PngEncoding::SplitDensity(value,_)=>{
            let ppm = if matches!(encoding, PngEncoding::PixelsPerMeter(_) | PngEncoding::Palette(..)) { value } else { (value as f64 / 0.0254).round() as u32 }.to_be_bytes();
            let mut phys=[1;9];phys[..4].copy_from_slice(&ppm);phys[4..8].copy_from_slice(&ppm);
            chunk(b"pHYs",&phys);
            if let PngEncoding::SplitDensity(dpi,orientation)=encoding {
                if let Some(o)=orientation {chunk(b"eXIf",&image_header::encode_exif(o,dpi));}
                crate::commands::codecs::png_zlib_chunks(&raw,|part|chunk(b"IDAT",part));
            }else{chunk(b"IDAT",&crate::commands::codecs::zlib_compress(&raw));}
        }
    }
    chunk(b"IEND", &[]);
    out
}

fn qr_render(
    modules: &[Vec<bool>],
    rtype: &str,
    size: usize,
    margin: usize,
    dpi: u32,
    fg: [u8; 4],
    bg: [u8; 4],
) -> Vec<u8> {
    let n = modules.len();
    let width = n + 2 * margin;
    let pixels = width.saturating_mul(size);
    let dark = |x: usize, y: usize| -> bool {
        if x >= margin && y >= margin && x - margin < n && y - margin < n {
            modules[y - margin][x - margin]
        } else {
            false
        }
    };
    if rtype == "PNG" || rtype == "PNG32" {
        let ppm = (u64::from(dpi) * 5000 / 127) as u32;
        if rtype == "PNG" {
            return pixel_png(pixels, pixels, PngEncoding::Palette(ppm, fg, bg), |x, y| [u8::from(!dark(x / size, y / size))]);
        }
        return pixel_png(pixels, pixels, PngEncoding::PixelsPerMeter(ppm), |x, y| if dark(x / size, y / size) { fg } else { bg });
    }
    let mut text = String::new();
    if rtype == "SVG" {
        let color = |c: [u8; 4]| format!("rgb({},{},{})", c[0], c[1], c[2]);
        text.push_str(&format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{pixels}\" height=\"{pixels}\" viewBox=\"0 0 {width} {width}\" shape-rendering=\"crispEdges\">\n<rect width=\"{width}\" height=\"{width}\" fill=\"{}\" fill-opacity=\"{}\"/>\n<path fill=\"{}\" fill-opacity=\"{}\" d=\"",
            color(bg),
            qr_fmt_ratio(bg[3]),
            color(fg),
            qr_fmt_ratio(fg[3])
        ));
        for y in 0..n {
            for x in 0..n {
                if modules[y][x] {
                    text.push_str(&format!("M{} {}h1v1h-1z", x + margin, y + margin));
                }
            }
        }
        text.push_str("\"/>\n</svg>\n");
    } else if rtype == "EPS" {
        let rgb = |c: [u8; 4]| format!("{} {} {}", qr_fmt_ratio(c[0]), qr_fmt_ratio(c[1]), qr_fmt_ratio(c[2]));
        text.push_str(&format!(
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 {pixels} {pixels}\n%%EndComments\n{} setrgbcolor\n0 0 {pixels} {pixels} rectfill\n{} setrgbcolor\n",
            rgb(bg),
            rgb(fg)
        ));
        for y in 0..n {
            for x in 0..n {
                if modules[y][x] {
                    text.push_str(&format!(
                        "{} {} {size} {size} rectfill\n",
                        (x + margin) * size,
                        (width - y - margin - 1) * size
                    ));
                }
            }
        }
        text.push_str("showpage\n%%EOF\n");
    } else if rtype == "ASCII" || rtype == "ASCIIi" {
        let inv = rtype == "ASCIIi";
        for y in 0..width {
            for x in 0..width {
                text.push_str(if dark(x, y) != inv { "##" } else { "  " });
            }
            text.push('\n');
        }
    } else if rtype == "ANSI" || rtype == "ANSI256" {
        let white = if rtype == "ANSI" { "\x1b[47m" } else { "\x1b[48;5;231m" };
        let black = if rtype == "ANSI" { "\x1b[40m" } else { "\x1b[48;5;16m" };
        for y in 0..width {
            text.push_str(white);
            let mut prev = false;
            for x in 0..width {
                let val = dark(x, y);
                if val != prev {
                    text.push_str(if val { black } else { white });
                }
                prev = val;
                text.push_str("  ");
            }
            if prev {
                text.push_str(white);
            }
            text.push_str("\x1b[0m\n");
        }
    } else {
        let inv = matches!(rtype, "UTF8i" | "ANSIUTF8i");
        let colors = match rtype {
            "ANSI256UTF8" => "\x1b[38;5;231m\x1b[48;5;16m",
            "ANSIUTF8" | "ANSIUTF8i" => "\x1b[40;37;1m",
            _ => "",
        };
        let mut y = margin % 2;
        while y < width {
            text.push_str(colors);
            for x in 0..width {
                let top = dark(x, y) != inv;
                let bottom = dark(x, y + 1) != inv;
                let idx = usize::from(top) + 2 * usize::from(bottom);
                text.push_str(["█", "▄", "▀", " "][idx]);
            }
            if !colors.is_empty() {
                text.push_str("\x1b[0m");
            }
            text.push('\n');
            y += 2;
        }
    }
    text.into_bytes()
}

#[derive(Clone, Copy, Default)]
struct InputTime {
    loops: usize,
    start: Option<f64>,
    to: Option<f64>,
    duration: Option<f64>,
}
impl InputTime {
    fn end(self) -> Option<f64> {
        self.to.or_else(||self.duration.map(|d|self.start.unwrap_or(0.)+d))
    }
    fn then(self, outer: Self) -> Self {
        if self.start.is_none() && self.end().is_none() { return outer; }
        let origin = self.start.unwrap_or(0.);
        let end = outer.end().map(|t|origin+t);
        Self {
            start: Some(origin+outer.start.unwrap_or(0.)),
            to: match (self.end(),end) { (Some(a),Some(b))=>Some(a.min(b)), (a,b)=>a.or(b) },
            duration: None,
            loops: outer.loops,
        }
    }
    fn generation_end(self, output_end: Option<f64>) -> Option<f64> {
        let start=self.start.unwrap_or(0.);
        self.duration.map(|d|start+d).or(self.to).or_else(||output_end.map(|e|start+e))
    }
}

fn parse_ffmpeg_timestamp(spec: &str) -> f64 {
    let number = |s: &str| {
        let n = parse_float_prefix(s);
        if n.is_nan() { 0. } else { n }
    };
    let spec = spec.trim();
    if let Some(ms) = spec.strip_suffix("ms") { return number(ms) / 1_000.; }
    if let Some(us) = spec.strip_suffix("us") { return number(us) / 1_000_000.; }
    let mut parts = spec.split(':');
    match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(h), Some(m), Some(s), None) => number(h) * 3600. + number(m) * 60. + number(s),
        (Some(m), Some(s), None, None) => number(m) * 60. + number(s),
        _ => number(spec),
    }
}

fn format_ffmpeg_introspection(flag: &str, cmd: &str) -> Option<String> {
    use std::fmt::Write;
    match flag {
        "-version" | "--version" => Some(format!(
            "{cmd} version 7.1-safe-bash Copyright (c) 2000-2025 the FFmpeg developers\n  built with @poe-code/mp4-ast (registered ASTs: {})\n  libavutil      59. 39.100 / 59. 39.100\n  libavcodec     61. 19.100 / 61. 19.100\n  libavformat    61.  7.100 / 61.  7.100\n  libavfilter    10.  4.100 / 10.  4.100\n",
            media_format::FORMATS.iter().map(|f| f.0).collect::<Vec<_>>().join(", ")
        )),
        "-formats" | "-demuxers" | "-muxers" => {
            let mut out = String::from("File formats:\n D. = Demuxing supported\n .E = Muxing supported\n --\n");
            for (_, name, description, _) in media_format::FORMATS {
                writeln!(out, " DE {name:20} {description}").unwrap();
            }
            Some(out)
        }
        "-codecs" | "-decoders" | "-encoders" => {
            let mut out = String::from("Codecs:\n D..... = Decoding supported\n .E.... = Encoding supported\n ..V... = Video codec\n ..A... = Audio codec\n ------\n");
            for codec in ["h264", "hevc", "av1", "vp8", "vp9", "mpeg4", "mjpeg", "png", "prores", "mpeg2video", "rawvideo", "flv1", "theora", "gif", "webp", "bmp", "ppm"] {
                writeln!(out, " DEV.LS {codec:18} {codec} video").unwrap();
            }
            for codec in ["aac", "mp3", "opus", "flac", "alac", "ac3", "eac3", "pcm_s16le", "pcm_s16be", "vorbis", "pcm_u8"] {
                writeln!(out, " DEA.L. {codec:18} {codec} audio").unwrap();
            }
            Some(out)
        }
        "-protocols" => Some(
            [
                "Supported file protocols:",
                "Input:",
                "  file",
                "  pipe",
                "  concat",
                "Output:",
                "  file",
                "  pipe",
                "",
            ]
            .join("\n"),
        ),
        "-filters" => Some(
            [
                "Filters:",
                "  scale            V->V       Scale the input video size.",
                "  crop             V->V       Crop the input video.",
                "  pad              V->V       Pad the input video.",
                "  fps              V->V       Force constant framerate.",
                "  hflip            V->V       Horizontally flip the input video.",
                "  vflip            V->V       Vertically flip the input video.",
                "  transpose        V->V       Transpose rows with columns.",
                "  negate           V->V       Negate input video.",
                "  drawbox          V->V       Draw a colored box on the input video.",
                "  overlay          VV->V      Overlay a video source on top of the input.",
                "  hstack           N->V       Stack video inputs horizontally.",
                "  vstack           N->V       Stack video inputs vertically.",
                "  concat           N->N       Concatenate audio and video streams.",
                "  volume           A->A       Change input volume.",
                "",
            ]
            .join("\n"),
        ),
        "-h" | "-help" | "--help" => Some(if cmd == "ffprobe" {
            "Multimedia stream analyzer (safe-bash pure-AST engine)\nusage: ffprobe [options] input_file\n"
        } else {
            "Hyper fast Audio and Video encoder (safe-bash pure-AST engine)\nusage: ffmpeg [options] [[infile options] -i infile]... {[outfile options] outfile}...\n"
        }.to_string()),
        _ => None,
    }
}

fn parse_lavfi_input_doc(inp: &str) -> Option<MediaDoc> {
    if let Some(video) = lavfi::Video::parse(inp) {
        let mut doc = MediaDoc::default_video();
        doc.width = video.width;
        doc.height = video.height;
        doc.fps = video.fps.round() as u32;
        doc.duration = video.duration;
        doc.nb_frames = (video.fps * video.duration).round().max(1.) as u32;
        return Some(doc);
    }
    if inp.starts_with("sine=")
        || inp.starts_with("anoisesrc=")
        || inp.starts_with("anullsrc=")
        || inp == "sine"
        || inp == "anoisesrc"
        || inp == "anullsrc"
    {
        let default_rate = if inp.starts_with("anoisesrc") { 16000 } else { 44100 };
        let mut sr = default_rate;
        let mut d = 1.0f64;
        let mut ch = if inp.starts_with("anullsrc") { 2 } else { 1 };
        let params = inp
            .split_once('=')
            .map(|(_, rest)| if rest.contains('=') { rest } else { inp })
            .unwrap_or(inp);
        for part in params.split(':') {
            if let Some((k, v)) = part.split_once('=') {
                if k == "sample_rate" || k == "r" {
                    sr = v.parse().ok().filter(|&v|v!=0).unwrap_or(default_rate);
                } else if k == "duration" || k == "d" {
                    d = v.parse().unwrap_or(1.0);
                } else if k == "channel_layout" || k == "cl" {
                    ch = if v == "mono" { 1 } else { 2 };
                }
            }
        }
        let mut doc = MediaDoc::default_video();
        doc.codec_type = "audio".to_string();
        doc.codec_name = "pcm_s16le".to_string();
        doc.format_name = "wav".to_string();
        doc.sample_rate = sr;
        doc.duration = d;
        doc.channels = ch;
        return Some(doc);
    }
    None
}

fn eval_dim_expr(expr: &str, iw: u32, ih: u32) -> Option<i32> {
    let s = expr.trim();
    if let Ok(v) = s.parse::<i32>() {
        return Some(v);
    }
    let base = if s.starts_with("iw") || s.starts_with("in_w") {
        Some((iw as f64, s.trim_start_matches("in_w").trim_start_matches("iw")))
    } else if s.starts_with("ih") || s.starts_with("in_h") {
        Some((ih as f64, s.trim_start_matches("in_h").trim_start_matches("ih")))
    } else {
        None
    };
    if let Some((val, rest)) = base {
        let rest = rest.trim();
        if rest.is_empty() {
            return Some(val.round() as i32);
        }
        if let Some(div_s) = rest.strip_prefix('/')
            && let Ok(div) = div_s.trim().parse::<f64>()
            && div > 0.0
        {
            return Some((val / div).round() as i32);
        }
        if let Some(mul_s) = rest.strip_prefix('*')
            && let Ok(mul) = mul_s.trim().parse::<f64>()
        {
            return Some((val * mul).round() as i32);
        }
    }
    None
}

fn apply_vf_chain_to_doc(doc: &mut MediaDoc, vf_chain: &str) {
    for f in vf_chain.split(',') {
        let f = f.trim();
        if f.is_empty() {
            continue;
        }
        let f = if let Some(idx) = f.rfind(']') {
            f[idx + 1..].trim()
        } else {
            f
        };
        let f = if let Some(idx) = f.find('[') {
            f[..idx].trim()
        } else {
            f
        };
        if let Some(rest) = f.strip_prefix("scale=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                let w_eval = eval_dim_expr(w_raw, doc.width, doc.height).unwrap_or(doc.width as i32);
                let h_eval = eval_dim_expr(h_raw, doc.width, doc.height).unwrap_or(doc.height as i32);
                let (new_w, new_h) = if w_eval < 0 && h_eval > 0 {
                    let mut nw = ((doc.width as f64) * (h_eval as f64) / (doc.height.max(1) as f64)).round() as u32;
                    if w_eval == -2 && nw % 2 == 1 {
                        nw += 1;
                    }
                    (nw.max(1), h_eval as u32)
                } else if h_eval < 0 && w_eval > 0 {
                    let mut nh = ((doc.height as f64) * (w_eval as f64) / (doc.width.max(1) as f64)).round() as u32;
                    if h_eval == -2 && nh % 2 == 1 {
                        nh += 1;
                    }
                    (w_eval as u32, nh.max(1))
                } else {
                    (w_eval.max(1) as u32, h_eval.max(1) as u32)
                };
                doc.width = new_w;
                doc.height = new_h;
            }
        } else if let Some(rest) = f.strip_prefix("crop=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                if let Some(w) = eval_dim_expr(w_raw, doc.width, doc.height)
                    && w > 0
                {
                    doc.width = w as u32;
                }
                if let Some(h) = eval_dim_expr(h_raw, doc.width, doc.height)
                    && h > 0
                {
                    doc.height = h as u32;
                }
            }
        } else if let Some(rest) = f.strip_prefix("pad=") {
            let parts: Vec<&str> = rest.split(':').collect();
            if parts.len() >= 2 {
                let w_raw = parts[0].strip_prefix("w=").unwrap_or(parts[0]);
                let h_raw = parts[1].strip_prefix("h=").unwrap_or(parts[1]);
                if let Some(w) = eval_dim_expr(w_raw, doc.width, doc.height)
                    && w > 0
                {
                    doc.width = w as u32;
                }
                if let Some(h) = eval_dim_expr(h_raw, doc.width, doc.height)
                    && h > 0
                {
                    doc.height = h as u32;
                }
            }
        } else if let Some(rest) = f.strip_prefix("transpose") {
            let arg = rest.strip_prefix('=').unwrap_or("1");
            if arg == "1" || arg == "2" || arg == "clock" || arg == "cclock" || arg.is_empty() {
                std::mem::swap(&mut doc.width, &mut doc.height);
            }
        } else if let Some(rest) = f.strip_prefix("fps=") {
            let val_s = rest.strip_prefix("fps=").unwrap_or(rest);
            if let Ok(fr) = val_s.parse::<f64>()
                && fr > 0.0
            {
                doc.fps = fr.round() as u32;
                doc.nb_frames = (fr * doc.duration).round().max(1.0) as u32;
            }
        } else if let Some(rest) = f.strip_prefix("tile=")
            && let Some((cs, rs)) = rest.split_once('x')
        {
            let cols: u32 = cs.parse().unwrap_or(1);
            let rows: u32 = rs.parse().unwrap_or(1);
            doc.width *= cols;
            doc.height *= rows;
        }
    }
}

fn media_stdin(name: &str) -> bool {
    matches!(name, "-" | "pipe:" | "pipe:0" | "/dev/stdin" | "/dev/fd/0")
}

fn read_media_stdin(stdin: &mut super::CommandInput) -> Result<Vec<u8>, String> {
    if let Some(source) = stdin.file { source.admit_bounded_read()?; }
    let mut bytes = Vec::new();
    stdin.append_bytes(&mut bytes)?;
    Ok(bytes)
}

fn write_ffmpeg_output(fs: &dyn SafeBashFs, path: &str, bytes: &[u8]) -> Result<(), String> {
    let parent = crate::vfs::dirname_posix_path(path);
    if !fs.is_dir(&parent) {
        let reason = if fs.exists(&parent) { "ENOTDIR: not a directory" } else { "ENOENT: no such file or directory" };
        return Err(format!("{reason}, writeFile '{path}'"));
    }
    fs.write_file(path, bytes)
}

struct Hls<'a> {
    fs: &'a dyn SafeBashFs,
    cwd: &'a str,
    dir: &'a str,
    pattern: Option<&'a str>,
    time: f64,
    fmp4: bool,
}

fn write_streaming_file(fs: &dyn SafeBashFs, path: &str, bytes: &[u8]) -> Result<(), String> {
    let dir = crate::vfs::dirname_posix_path(path);
    fs.mkdir_all(&dir).map_err(|e| {
        if e.starts_with("ENOTDIR:") { format!("ENOTDIR: not a directory, stat '{dir}'") } else { e }
    })?;
    write_ffmpeg_output(fs, path, bytes).map_err(|e| e.replacen(", open '", ", writeFile '", 1))
}

enum MediaInput {
    Bytes(&'static str,Vec<u8>),
    Images(frame_output::ImageSequence),
    Joined(Vec<u8>, mp4::mux::DecodedConcat),
}

impl MediaInput {
    fn decoded(&self) -> Option<&mp4::mux::DecodedConcat> {
        if let Self::Joined(_, decoded) = self { Some(decoded) } else { None }
    }
    fn byte_size(&self) -> usize {
        match self {
            Self::Bytes(_, b) => b.len(),
            Self::Joined(b, decoded) => b.len().saturating_add(decoded.byte_size()),
            Self::Images(seq) => seq.frames.iter().map(|im|im.pixels.len()*4 + size_of::<png_pixels::Raster>()).sum(),
        }
    }
    fn remuxable(&self)->bool {
        match self {
            Self::Bytes("lavfi",b)=>matches!(b.split(|&v|v==b'=').next(),Some(b"color"|b"smptebars"|b"testsrc"|b"testsrc2"|b"sine"|b"anullsrc")),
            Self::Bytes("gif",b)=>gif::signature(b) && !b[6..].starts_with(b"\n__MEDIA__:") && !b[6..].starts_with(b"\n__IMG__:"),
            Self::Bytes("image2",b)=>png_pixels::still_format(b).is_some(),
            Self::Bytes("mp4"|"mov",b)=>!b.starts_with(b"\0\0\0\x18ftypmp42\n__MEDIA__:"),
            Self::Joined(..) | Self::Images(_) | Self::Bytes("mpegts"|"avi"|"mkv"|"webm"|"flv"|"aac"|"wav"|"y4m"|"srt"|"webvtt",_)=>true,
            _=>false,
        }
    }
}

fn exif_printable(output: &mut String, value: &str) {
    output.extend(value.trim_end_matches([' ', '\0']).chars().filter(|&c| c != '\0').map(|c| if c.is_ascii_control() { '.' } else { c }));
}

fn cmd_media_doc(
    cmd: &str,
    args: &[String],
    stdin: &str,
    cwd: &str,
    fs: &dyn SafeBashFs,
) -> BuiltinOutcome {
    match cmd {
        "ffmpeg" => cmd_ffmpeg(args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs),
        "ffprobe" => cmd_ffprobe(args, super::CommandInput { text: &mut stdin.to_owned(), file: None }, cwd, fs),
        "soffice" | "libreoffice" => cmd_soffice(args, cwd, fs),
        "wkhtmltopdf" => wkhtmltopdf::wkhtmltopdf(args, stdin, cwd, fs, false),
        "pdfunite" => cmd_pdfunite(args, cwd, fs),
        "pdfseparate" => cmd_pdfseparate(args, cwd, fs),
        "qpdf" => cmd_qpdf(args, stdin, cwd, fs),
        "pdftk" => cmd_pdftk(args, stdin, cwd, fs),
        "pdfdetach" => cmd_pdfdetach(args, stdin, cwd, fs),
        "pdfinfo" => cmd_pdfinfo(args, stdin, cwd, fs),
        "pdffonts" => cmd_pdffonts(args, stdin, cwd, fs),
        "pdftotext" => cmd_pdftotext(args, stdin, cwd, fs),
        "pdftohtml" => cmd_pdftohtml(args, stdin, cwd, fs),
        "pdftoppm" | "pdftocairo" => cmd_pdftoppm(cmd, args, stdin, cwd, fs),
        "pdfimages" => cmd_pdfimages(args, stdin, cwd, fs),
        "magick" | "convert" | "mogrify" => cmd_magick(cmd, args, stdin, cwd, fs),
        "composite" => cmd_composite(cmd, args, cwd, fs),
        "montage" => cmd_montage(args, cwd, fs),
        "compare" => cmd_compare(args, cwd, fs),
        "identify" => cmd_identify(args, stdin, cwd, fs),
        "sips" => cmd_sips(args, cwd, fs),
        "exiftool" => cmd_exiftool(args, stdin, cwd, fs),
        "diffpdf" | "pdfdiff" => cmd_diffpdf(cmd, args, cwd, fs),
        "svgo" => cmd_svgo(args, stdin, cwd, fs),
        "rsvg-convert" => cmd_rsvg_convert(args, stdin, cwd, fs),
        "soxi" => cmd_soxi(args, stdin, cwd, fs),
        "sox" => cmd_sox(args, stdin, cwd, fs),
        "qrencode" => cmd_qrencode(args, stdin, cwd, fs),
        _ => ok_out(""),
    }
}

pub(super) fn cmd_ffmpeg(args: &[String], mut stdin: super::CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out(&format_ffmpeg_introspection("-h", "ffmpeg").unwrap_or_default(), 1);
    }
    for arg in args {
        if let Some(intro) = format_ffmpeg_introspection(arg, "ffmpeg") {
            return ok_out(&intro);
        }
    }
    let mut inputs: Vec<String> = Vec::new();
    let (mut pending_format,mut output_format) = (None,None);
    let mut input_formats=Vec::new();
    let mut input_times=Vec::new();
    let mut pending_time=InputTime::default();
    let (mut audio_copy,mut video_copy)=(false,false);
    let mut audio_filters=Vec::new();let mut fragmented=false;let mut maps=Vec::new();let mut strip_subtitles=false;let mut rotation=None;let mut shortest=false;
    let mut hls_time = 2.;
    let mut hls_pattern = None;
    let mut hls_fmp4 = false;
    let mut fmt_flag = String::new();
    let mut vf_flags: Vec<String> = Vec::new();
    let mut fc_flag = String::new();
    let mut ar_opt: Option<u32> = None;
    let mut ac_opt: Option<u32> = None;
    let (mut input_fps,mut output_fps)=(None,None);
    let mut ss_opt: Option<f64> = None;
    let mut to_opt: Option<f64> = None;
    let mut t_opt: Option<f64> = None;
    let mut vframes_opt: Option<u32> = None;
    let mut size_opt: Option<(u32, u32)> = None;
    let mut strip_audio = false;
    let mut strip_video = false;
    let mut overwrite = false;
    let mut output_start=1u64;
    let mut input_start=None;
    let mut image_options=Vec::new();
    let mut meta_title: Option<String> = None;
    let mut meta_tags: BTreeMap<String, String> = BTreeMap::new();
    let mut out_arg: Option<String> = None;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-y" => {
                overwrite = true;
                i += 1;
            }
            "-n" => {
                overwrite = false;
                i += 1;
            }
            "-an" => {
                strip_audio = true;
                i += 1;
            }
            "-vn" => {
                strip_video = true;
                i += 1;
            }
            "-i" if i + 1 < args.len() => {
                inputs.push(args[i + 1].clone());
                input_formats.push(pending_format.take());
                image_options.push((input_start.take(),input_fps.take()));
                input_times.push(std::mem::take(&mut pending_time));
                i += 2;
            }
            "-f" if i + 1 < args.len() => {
                fmt_flag = args[i + 1].clone();
                if args[i+2..].iter().any(|arg| arg == "-i") { pending_format = Some(args[i+1].as_str()); }
                else { output_format = Some(args[i+1].as_str()); }
                i += 2;
            }
            "-vf" | "-filter:v" if i + 1 < args.len() => {
                vf_flags.push(args[i + 1].clone());
                i += 2;
            }
            "-filter_complex" if i + 1 < args.len() => {
                fc_flag = args[i + 1].clone();
                i += 2;
            }
            "-ar" if i + 1 < args.len() => {
                ar_opt = args[i + 1].parse().ok().filter(|v| *v != 0);
                i += 2;
            }
            "-ac" if i + 1 < args.len() => {
                ac_opt = args[i + 1].parse().ok().filter(|v| *v != 0);
                i += 2;
            }
            "-framerate" | "-r" if i + 1 < args.len() => {
                let fps=args[i+1].parse::<f64>().ok().filter(|v|v.is_finite() && *v!=0.).unwrap_or(25.);
                if args[i+2..].iter().any(|a|a=="-i"){input_fps=Some(fps);}else{output_fps=Some(fps);}
                i += 2;
            }
            "-ss" if i + 1 < args.len() => {
                let target=if args[i+2..].iter().any(|arg|arg=="-i"){&mut pending_time.start}else{&mut ss_opt};
                *target = Some(parse_ffmpeg_timestamp(&args[i + 1]));
                i += 2;
            }
            "-to" if i + 1 < args.len() => {
                let target=if args[i+2..].iter().any(|arg|arg=="-i"){&mut pending_time.to}else{&mut to_opt};
                *target = Some(parse_ffmpeg_timestamp(&args[i + 1]));
                i += 2;
            }
            "-t" if i + 1 < args.len() => {
                let target=if args[i+2..].iter().any(|arg|arg=="-i"){&mut pending_time.duration}else{&mut t_opt};
                *target = Some(parse_ffmpeg_timestamp(&args[i + 1]));
                i += 2;
            }
            "-frames:v" | "-vframes" if i + 1 < args.len() => {
                vframes_opt = args[i + 1].parse().ok();
                i += 2;
            }
            "-s" if i + 1 < args.len() => {
                if let Some((ws, hs)) = args[i + 1].split_once('x')
                    && let (Ok(w), Ok(h)) = (ws.parse::<u32>(), hs.parse::<u32>())
                {
                    size_opt = Some((w, h));
                }
                i += 2;
            }
            a if (a=="-metadata" || a.starts_with("-metadata:")) && i + 1 < args.len() => {
                if let Some((k, v)) = args[i + 1].split_once('=') {
                    if k=="rotate"{rotation=Some(v.parse::<i32>().unwrap_or(0));}
                    if k == "title" {
                        meta_title = Some(v.to_string());
                    }
                    meta_tags.insert(k.to_string(), v.to_string());
                }
                i += 2;
            }
            "-af" | "-filter:a" if i + 1 < args.len() => { audio_filters.push(args[i+1].as_str()); i += 2; }
            "-c" | "-codec" | "-c:a" | "-acodec" | "-codec:a" if i + 1 < args.len() => { audio_copy = args[i+1] == "copy"; if matches!(args[i].as_str(),"-c"|"-codec") {video_copy=audio_copy;} i += 2; }
            "-c:v" | "-vcodec" | "-codec:v" if i + 1 < args.len() => { video_copy = args[i+1] == "copy"; i += 2; }
            "-map" if i+1<args.len()=>{maps.push(args[i+1].as_str());i+=2;}
            "-shortest"=>{shortest=true;i+=1;}
            "-sn"=>{strip_subtitles=true;i+=1;}
            "-display_rotation" if i+1<args.len()=>{rotation=Some(args[i+1].parse::<i32>().unwrap_or(0).saturating_abs());i+=2;}
            "-movflags" if i+1<args.len()=>{let flags=&args[i+1];fragmented|=flags.contains("frag_keyframe")||flags.contains("empty_moov");i+=2;}
            "-hls_time" | "-seg_duration" => {
                let sec = args.get(i+1).map_or(2., |v| parse_float_prefix(v));
                hls_time = if sec.is_nan() || sec == 0. { 2. } else { sec.max(0.2) };
                i += 2;
            }
            "-hls_segment_type" => { hls_fmp4 = args.get(i+1).is_some_and(|v| v == "fmp4"); i += 2; }
            "-hls_segment_filename" => { hls_pattern = args.get(i+1).map(String::as_str); i += 2; }
            "-c:s" | "-scodec" | "-safe" | "-hls_list_size" | "-hls_flags" | "-b:a" | "-b:v"
            | "-pix_fmt" | "-v" | "-loglevel" | "-preset"
            | "-crf" | "-threads"
                if i + 1 < args.len() =>
            {
                i += 2;
            }
            "-stream_loop" if i+1<args.len()=>{
                let n=args[i+1].trim_start().trim_start_matches('+');
                let digits=n.bytes().take_while(u8::is_ascii_digit).count();
                pending_time.loops=n[..digits].parse().unwrap_or(if digits>0{usize::MAX}else{0});
                i+=2;
            }
            "-start_number" => {
                let Some(n)=args.get(i+1).and_then(|s|s.parse::<u64>().ok()).filter(|&n|n<=9007199254740991) else {
                    return err_out("ffmpeg: invalid start_number\n",1);
                };
                if !args[i+2..].iter().any(|a|a=="-i") {output_start=n;}else{input_start=Some(n);}
                i += 2;
            }
            a if a == "-" || !a.starts_with('-') => {
                out_arg = Some(a.to_string());
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }
    if inputs.is_empty() {
        return err_out("ffmpeg: must specify at least one input (-i)\n", 1);
    }
    let out_rel = match out_arg {
        Some(o) => o,
        None => return err_out("ffmpeg: must specify an output file\n", 1),
    };
    let out_lower = out_rel.to_ascii_lowercase();
    let out_full = resolve_posix_path(cwd, &out_rel);
    let stdout = matches!(out_rel.as_str(), "-" | "pipe:" | "pipe:1" | "/dev/stdout" | "/dev/fd/1");
    if !overwrite && !stdout && output_format != Some("null") {
        let parent=crate::vfs::dirname_posix_path(&out_full);
        if fs.exists(&parent) && !fs.is_dir(&parent) {
            return err_out(&format!("ffmpeg: ENOTDIR: not a directory, stat '{out_full}'\n"),1);
        }
        match fs.stat(&out_full) {
            Ok(_) => return err_out(&format!("File '{out_rel}' already exists. Exiting.\n"), 1),
            Err(reason) if !reason.starts_with("ENOENT:") => return err_out(&format!("ffmpeg: {reason}\n"),1),
            Err(_) => {}
        }
    }
    let ext=out_lower.rsplit_once('.').map(|(_,ext)|ext);
    let sequence=if ext.and_then(|f|frame_output::image_format(f,true)).is_some() && !matches!(output_format,Some("null"|"hls"|"dash")) {
        match frame_output::sequence(&out_rel){Ok(p)=>p,Err(e)=>return err_out(&format!("ffmpeg: {e}\n"),1)}
    }else{None};
    let muxer = if sequence.is_some(){Some("image2")}else if out_rel=="/dev/null" || output_format==Some("null"){Some("null")}else if out_lower.ends_with(".mpd"){Some("dash")}else if output_format != Some("dash") && matches!(ext,Some("m3u"|"m3u8")){Some("hls")}else{match output_format {
        Some("webm") => Some("webm"),
        Some(name) => media_format::by_name(name),
        None => media_format::by_filename(&out_rel),
    }};
    let y4m_output = muxer == Some("y4m");
    let named=output_format.map(str::to_ascii_lowercase);
    let image_name=if sequence.is_some(){ext}else{named.as_deref().or(ext)};
    let image_format=if muxer==Some("gif"){Some("gif")}else{image_name.filter(|_|muxer==Some("image2")).and_then(|f|frame_output::image_format(f,sequence.is_some()))};
    let frame_output=y4m_output || image_format.is_some();
    let audio_output = muxer == Some("aac");
    let movie_output = matches!(muxer, Some("hls" | "dash" | "mpegts" | "avi" | "mp4" | "mov" | "flv" | "mkv" | "webm"));
    let subtitle_output = matches!(muxer, Some("srt" | "webvtt"));
    let mut input_reader = ffmpeg_input::Reader {fs, cwd, stdin: &mut stdin};
    let mut sources = Vec::new();
    if movie_output || subtitle_output || audio_output || matches!(muxer,Some("wav"|"ffmetadata"|"null")) || frame_output{
        let composition=if inputs.len()>=2 {mp4::mux::Composition::parse(&fc_flag)}else{None};
        let concat=fc_flag.contains("concat=");
        let chain = !fc_flag.is_empty() && !concat && composition.is_none();
        let source=&inputs[0];
        let input_format=input_formats[0];
        let generator = (frame_output && input_format==Some("lavfi")).then(||lavfi::Video::parse(source)).flatten();
        let start=ss_opt.unwrap_or(0.).max(0.);
        let end=to_opt.or_else(||t_opt.map(|t|start+t));
        let limit=fs.max_input_bytes();
        let mut remaining=limit;
        let retain=(composition.is_some() || frame_output || !vf_flags.is_empty() || size_opt.is_some() || output_fps.is_some() || vframes_opt.is_some() || ss_opt.is_some() || end.is_some(),muxer==Some("wav"));
        for (i,path) in inputs.iter().enumerate(){
            let (input,cut) = match input_reader.load(path, input_formats[i], image_options[i], remaining, retain, 0) {
                Ok(input) => input, Err(e) => return err_out(&format!("ffmpeg: {e}\n"), 1),
            };
            input_times[i] = cut.then(input_times[i]);
            let size = input.byte_size();
            let Some(left)=remaining.checked_sub(size)else{return err_out("ffmpeg: input byte limit exceeded\n",1)};
            remaining=left;
            let supported=input.remuxable();
            sources.push(input);
            if !supported{break;}
        }
        let (format,bytes)=match sources.first(){Some(MediaInput::Bytes(f,b))=>(Some(*f),b.as_slice()),Some(MediaInput::Joined(b,_))=>(Some("mp4"),b.as_slice()),_=>(None,&[][..])};
        let supported=sources.first().is_some_and(MediaInput::remuxable);
        let real_mp4=supported && matches!(format,Some("mp4"|"mov"));
        let still_input=format==Some("image2") && supported;
        let remux_inputs=sources.len()==inputs.len() && sources.iter().all(MediaInput::remuxable);
        if !fc_flag.is_empty() && remux_inputs {
            maps.clear();
            strip_video=false; strip_audio=false; strip_subtitles=false; rotation=None;
            if concat || composition.is_some(){shortest=false;}
            if concat {
                let disabled=|option:&str| fc_flag.match_indices("concat=").any(|(i,_)|{
                    let args=fc_flag[i+7..].split([';','[']).next().unwrap_or("");
                    let word=|c:char|c.is_ascii_alphanumeric()||c=='_';
                    args.match_indices(option).any(|(j,_)|!args[..j].ends_with(word) && !args[j+option.len()..].starts_with(word))
                });
                strip_audio=disabled("a=0");strip_video=disabled("v=0");
            }
        }
        if chain && remux_inputs {
            // The portable graph muxes all inputs first, then appends its
            // unlabelled chain after any explicit video filters.
            let mut rest=fc_flag.as_str();
            let mut filter=String::new();
            while let Some((prefix,suffix))=rest.split_once('[') {
                let Some((label,tail))=suffix.split_once(']') else {break;};
                filter.push_str(prefix);
                if label.is_empty(){filter.push_str("[]");}
                rest=tail;
            }
            filter.push_str(rest);
            if !filter.trim().is_empty(){vf_flags.push(filter);}
        }
        if (frame_output || movie_output && remux_inputs) && !video_copy {
            if let Some((w,h))=size_opt {vf_flags.push(format!("scale={w}:{h}"));}
            if let Some(fps)=output_fps {vf_flags.push(format!("fps={fps}"));}
        }
        let mut decoded=mp4::mux::DecodedConcat::new(!strip_video && (frame_output || !vf_flags.is_empty() || vframes_opt.is_some() || ss_opt.is_some() || end.is_some()),!strip_audio && muxer==Some("wav"));
        let output_container=if muxer==Some("mkv") && matches!(format,Some("mkv"|"webm")) && mp4::mkv_input::webm_header(bytes) {"webm"}else{muxer.unwrap_or("")};
        let out_dir = crate::vfs::dirname_posix_path(&out_full);
        let hls = (muxer == Some("hls")).then_some(Hls { fs, cwd, dir: &out_dir, time: hls_time, pattern: hls_pattern, fmp4: hls_fmp4 });
        let mut remux=mp4::mux::Remux{hls,composition,concat:concat.then_some(&mut decoded),rate:ar_opt.filter(|_|!audio_copy),channels:ac_opt.filter(|_|!audio_copy),audio_filters:if audio_copy{&[]}else{&audio_filters},video_filters:&vf_flags,maps:&maps,strip_audio,strip_video,strip_subtitles,shortest,start:ss_opt,end,source_end:end,input_times:&input_times,frames:vframes_opt,format:output_container,fragmented,metadata:&meta_tags,rotation,limit:fs.max_input_bytes()};
        // Cutting a graph first materializes its decoded frames as AVC. Let the
        // packet slicer handle keyframes, partial samples, and edit lists.
        let graph_movie;
        let sources=if remux_inputs && (concat && inputs.len()>1 || composition.is_some() && (ss_opt.is_some() || end.is_some())){
            let opts=mp4::mux::Remux{hls:None,concat:remux.concat.as_deref_mut(),frames:None,format:"mp4",fragmented:false,metadata:&BTreeMap::new(),audio_filters:&[],video_filters:&[],rate:None,channels:None,..remux};
            let opts=if concat{mp4::mux::Remux{start:None,end:None,strip_audio:false,strip_video:false,..opts}}else{opts};
            graph_movie=match mp4::mux::remux(&sources,opts,0,&mut Vec::new()){Ok(bytes)=>[MediaInput::Bytes("mp4",bytes)],Err(e)=>return err_out(&format!("ffmpeg: {e}\n"),1)};
            remux.composition=None;
            remux.input_times=&[InputTime{start:None,to:None,duration:None,loops:0}];
            &graph_movie[..]
        }else{&sources[..]};
        let mut resources = Vec::new();
        let output=if muxer==Some("wav") && !remux_inputs && inputs.len()==1 && fc_flag.is_empty() {
            match ffmpeg_wave::Input::parse(format.unwrap_or(""),bytes).map_err(str::to_owned).and_then(|input|input.map(|a|a.render(input_times[0],&remux)).transpose()){
                Ok(data)=>data, Err(e)=>return err_out(&format!("ffmpeg: {e}\n"),1)
            }
        } else if frame_output && (inputs.len()==1 && supported || remux_inputs) {
            let seek=input_times[0];
            let limit=fs.max_input_bytes();
            let result=frame_output::render(fs,cwd,&out_rel,image_format,sequence,output_start,vf_flags.is_empty(),|sequence,emit|{
                let frames=if image_format.is_some() && image_format!=Some("gif") && !sequence{Some(1)}else{vframes_opt};
                if inputs.len()>1 || sources[0].decoded().is_some() || remux.concat.is_some() || matches!(format,Some("mpegts"|"avi"|"wav"|"y4m"|"gif"|"flv"|"mkv"|"webm")) || (real_mp4 || still_input || generator.is_some()) && seek.loops>0 {
                    return mp4::mux::render_mapped(sources,&remux,frames,sequence,emit);
                }
                let opts=y4m::Options {filters:&vf_flags,frames,start,end,no_video:strip_video,limit};
                let input=&sources[0];
                let no_video=strip_video || !real_mp4 && !maps.is_empty() && mp4::mux::select_tracks(&maps,1,|_|1,|_,_|"video")?.is_empty();
                if no_video {Ok((64,64,10))}
                else if let MediaInput::Images(seq)=input {
                    let input_cut=seek.start.is_some() || seek.end().is_some();
                    if input_cut || shortest || ss_opt.is_some() || end.is_some(){
                        let movie=mp4::mux::input_slice(input,seek,None,limit)?;
                        let end=if input_cut{end}else{Some(end.unwrap_or(seq.template_duration()).min(seq.template_duration()))};
                        mp4::render_video(&movie,y4m::Options{end,..opts},&maps,sequence,emit)
                    }else{seq.render(opts,emit)}
                }
                else if still_input {frame_output::render_still(bytes,opts,seek,shortest || ss_opt.is_some() || end.is_some(),emit)}
                    else if (seek.start.is_some() || seek.end().is_some()) && (generator.is_some() || real_mp4) {
                    mp4::mux::input_slice(input,seek,seek.generation_end(end),limit).and_then(|b|mp4::render_video(&b,opts,&maps,sequence,emit))
                }else if image_format.is_some() && generator.is_some() && (ss_opt.is_some() || end.is_some() || shortest) {
                    mp4::mux::input_slice(input,InputTime{start:Some(start),to:end,..InputTime::default()},end,limit).and_then(|b|mp4::render_video(&b,y4m::Options{start:0.,end:None,..opts},&maps,sequence,emit))
                } else if let Some(video)=generator {video.render(opts,ss_opt.is_some() || end.is_some(),emit)}
                    else if real_mp4{mp4::render_video(bytes,opts,&maps,sequence,emit)}
                    else{Ok((64,64,10))}
            });
            match result {Ok(Some(data))=>Some(data),Ok(None)=>return ok_out(""),Err(e)=>return err_out(&format!("ffmpeg: {e}\n"),1)}
        } else if (movie_output || subtitle_output || audio_output || matches!(muxer,Some("wav"|"ffmetadata"|"null"))) && remux_inputs {
            match mp4::mux::remux(sources,remux,0,&mut resources){Ok(b)=>Some(b),Err(e)=>return err_out(&format!("ffmpeg: {e}\n"),1)}
        } else {None};
        if let Some(output)=output {
            if muxer==Some("null"){return ok_out("");}
            if matches!(muxer, Some("dash" | "hls")) {
                for (name, bytes) in resources {
                    if let Err(e) = write_streaming_file(fs, &resolve_posix_path(&out_dir, &name), &bytes) {
                        return err_out(&format!("ffmpeg: {e}\n"),1);
                    }
                }
                return match write_streaming_file(fs, &out_full, &output) {
                    Ok(()) => ok_out(""), Err(e) => err_out(&format!("ffmpeg: {e}\n"),1)
                };
            }
            if stdout {
                return ok_out(&crate::vfs::bytes_to_stream_string(&output));
            }
            return match write_ffmpeg_output(fs,&out_full,&output) {
                Ok(()) => ok_out(""), Err(reason) => err_out(&format!("ffmpeg: {reason}\n"),1),
            };
        }
    }
    let InputTime{start:input_ss,to:input_to,duration:input_duration,..}=input_times[0];
    let ss_opt=ss_opt.or(input_ss);
    let to_opt=to_opt.or(input_to);
    let t_opt=t_opt.or(input_duration);
    let mut doc = MediaDoc::default_video();
    let mut parsed_input_docs: Vec<MediaDoc> = Vec::new();
    let mut loaded = sources.into_iter();
    for (source_idx,inp) in inputs.iter().enumerate() {
        let prior = loaded.next();
        if let Some(lavfi_doc) = parse_lavfi_input_doc(inp) {
            if parsed_input_docs.is_empty() {
                doc = lavfi_doc.clone();
            } else if doc.codec_type == "video" && lavfi_doc.codec_type == "audio" {
                doc.has_audio = true;
                doc.sample_rate = lavfi_doc.sample_rate;
                doc.channels = lavfi_doc.channels;
            } else {
                doc = lavfi_doc.clone();
            }
            parsed_input_docs.push(lavfi_doc);
        } else if !inp.starts_with("concat:") && inp.contains('%') {
            let mut count = 0u32;
            let mut idx = 1usize;
            while idx <= 100 {
                let Some(name) = format_printf_num(inp, idx, Some('0')) else { return err_out("ffmpeg: image sequence filename is too long\n", 1); };
                let candidate = resolve_posix_path(cwd, &name);
                if let Ok(b) = fs.read_file(&candidate) {
                    if idx == 1 {
                        let im = read_image_meta(&b, &candidate);
                        doc.width = im.w;
                        doc.height = im.h;
                    }
                    count += 1;
                    idx += 1;
                } else {
                    break;
                }
            }
            doc.nb_frames = count.max(1);
            if let Some(fr) = image_options[source_idx].1 {
                doc.fps = fr.round() as u32;
            }
            doc.duration = (doc.nb_frames as f64) / (doc.fps.max(1) as f64);
            parsed_input_docs.push(doc.clone());
        } else {
            let full_in = resolve_posix_path(cwd, inp);
            let input = match prior {
                Some(input) => input,
                None => match input_reader.load(inp, input_formats[source_idx], image_options[source_idx], fs.max_input_bytes(), (false,false), 0) {
                    Ok((input,_)) => input, Err(e) => return err_out(&format!("ffmpeg: {e}\n"),1),
                },
            };
            let (format,b)=match input {MediaInput::Bytes(f,b)=>(f,b),MediaInput::Joined(b,_)=>("mp4",b),_=>return err_out("ffmpeg: unsupported image sequence output\n",1)};
            let text = String::from_utf8_lossy(&b);
            if format == "srt" {
                doc.subtitles = text.to_string();
            } else if full_in.ends_with(".ffmeta") || text.starts_with(";FFMETADATA1") {
                let mut cid = 0usize;
                let mut in_chap = false;
                for line in text.lines() {
                    if line.trim() == "[CHAPTER]" {
                        in_chap = true;
                    } else if in_chap
                        && let Some(t) = line.trim().strip_prefix("title=")
                    {
                        doc.chapters.push((cid, t.to_string()));
                        cid += 1;
                    } else if !in_chap
                        && let Some(t) = line.trim().strip_prefix("title=")
                    {
                        doc.title = t.to_string();
                    }
                }
            } else if parsed_input_docs.is_empty() {
                let parsed = MediaDoc::parse(&b, &full_in);
                doc = parsed.clone();
                parsed_input_docs.push(parsed);
            } else {
                let sub = MediaDoc::parse(&b, &full_in);
                if doc.codec_type == "video" && sub.codec_type == "audio" {
                    doc.has_audio = true;
                    doc.sample_rate = sub.sample_rate;
                    doc.channels = sub.channels;
                } else if doc.codec_type == "audio" && sub.codec_type == "video" {
                    let sr = doc.sample_rate;
                    let ch = doc.channels;
                    doc = sub.clone();
                    doc.has_audio = true;
                    doc.sample_rate = sr;
                    doc.channels = ch;
                }
                parsed_input_docs.push(sub);
            }
        }
    }
    if output_format == Some("null") || out_rel == "/dev/null" {
        return ok_out("");
    }
    if muxer.is_none() && !out_lower.ends_with(".mpd") && !out_lower.ends_with(".m3u") && !out_lower.ends_with(".m3u8") {
        let fmt_desc = output_format.unwrap_or(&out_rel);
        return err_out(
            &format!(
                "ffmpeg: Unable to find a suitable output format for '{fmt_desc}' (format AST not registered)\n"
            ),
            1,
        );
    }
    if !fc_flag.is_empty() {
        if parsed_input_docs.len() >= 2 {
            let d0 = &parsed_input_docs[0];
            let d1 = &parsed_input_docs[1];
            if fc_flag.contains("vstack") {
                doc.width = d0.width.max(d1.width);
                doc.height = parsed_input_docs.iter().map(|d| d.height).sum();
            } else if fc_flag.contains("hstack") {
                doc.width = parsed_input_docs.iter().map(|d| d.width).sum();
                doc.height = d0.height.max(d1.height);
            } else if fc_flag.contains("concat") {
                doc.width = d0.width;
                doc.height = d0.height;
                doc.fps = d0.fps;
                doc.nb_frames = parsed_input_docs.iter().map(|d| d.nb_frames).sum();
                doc.duration = parsed_input_docs.iter().map(|d| d.duration).sum();
            }
        }
        for stage in fc_flag.split(';') {
            apply_vf_chain_to_doc(&mut doc, stage);
        }
    }
    for vf_chain in &vf_flags {
        apply_vf_chain_to_doc(&mut doc, vf_chain);
    }
    if let Some((sw, sh)) = size_opt {
        doc.width = sw;
        doc.height = sh;
    }
    if let Some(sr) = ar_opt {
        doc.sample_rate = sr;
    }
    if let Some(ch) = ac_opt {
        doc.channels = ch;
    }
    if let Some(fr) = output_fps {
        doc.fps = fr.round() as u32;
        doc.nb_frames = ((doc.fps as f64) * doc.duration).round().max(1.0) as u32;
    }
    if let Some(dur) = t_opt {
        let _ = ss_opt;
        doc.duration = dur;
        doc.nb_frames = ((doc.fps as f64) * dur).round().max(1.0) as u32;
    } else if let Some(to_val) = to_opt {
        let start = ss_opt.unwrap_or(0.0);
        let dur = (to_val - start).max(0.05);
        doc.duration = dur;
        doc.nb_frames = ((doc.fps as f64) * dur).round().max(1.0) as u32;
    } else if let Some(ss_val) = ss_opt
        && ss_val > 0.0
        && ss_val < doc.duration
    {
        doc.duration = (doc.duration - ss_val).max(0.05);
        doc.nb_frames = ((doc.fps as f64) * doc.duration).round().max(1.0) as u32;
    }
    if let Some(vf_cnt) = vframes_opt {
        doc.nb_frames = vf_cnt.max(1);
        doc.duration = (doc.nb_frames as f64) / (doc.fps.max(1) as f64);
    }
    if strip_audio {
        doc.has_audio = false;
    }
    if strip_video {
        doc.codec_type = "audio".to_string();
    }
    if let Some(t) = meta_title {
        doc.title = t.clone();
        doc.tags.insert("title".to_string(), t);
    }
    for (k, v) in meta_tags {
        doc.tags.insert(k, v);
    }
    if out_lower.ends_with(".ffmeta") || fmt_flag == "ffmetadata" {
        let mut ffmeta = String::from(";FFMETADATA1\n");
        if !doc.title.is_empty() && !doc.tags.contains_key("title") {
            ffmeta.push_str(&format!("title={}\n", doc.title));
        }
        for (k, v) in &doc.tags {
            ffmeta.push_str(&format!("{k}={v}\n"));
        }
        for (cid, ctitle) in &doc.chapters {
            ffmeta.push_str(&format!(
                "[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle={ctitle}\n",
                cid * 1000,
                (cid + 1) * 1000
            ));
        }
        let _ = fs.write_file(&out_full, ffmeta.as_bytes());
        return ok_out("");
    }
    if matches!(muxer, Some("dash" | "hls")) {
        return err_out("ffmpeg: unsupported streaming input\n", 1);
    }
    if out_lower.ends_with(".vtt") {
        let vtt = format!("WEBVTT\n\n{}", doc.subtitles.replace(',', "."));
        let _ = fs.write_file(&out_full, vtt.as_bytes());
        return ok_out("");
    }
    if out_lower.ends_with(".srt") {
        let _ = fs.write_file(&out_full, doc.subtitles.as_bytes());
        return ok_out("");
    }
    if out_lower.ends_with(".png") {
        let im = ImageMeta {
            fmt: "PNG".to_string(),
            w: doc.width,
            h: doc.height,
            cs: "sRGB".to_string(),
            exif: BTreeMap::new(),
        };
        let bytes = write_image_bytes(&im);
        if out_rel.contains('%') {
            for idx in 1..=(doc.nb_frames as usize) {
                let Some(name) = format_printf_num(&out_rel, idx, Some('0')) else { return err_out("ffmpeg: image sequence filename is too long\n", 1); };
                let p = resolve_posix_path(cwd, &name);
                let _ = fs.write_file(&p, &bytes);
            }
        } else {
            let _ = fs.write_file(&out_full, &bytes);
        }
        return ok_out("");
    }
    if out_lower.ends_with(".wav") {
        doc.codec_type = "audio".to_string();
        doc.codec_name = "pcm_s16le".to_string();
        doc.format_name = "wav".to_string();
    } else if out_lower.ends_with(".gif") {
        doc.codec_name = "gif".to_string();
        doc.format_name = "gif".to_string();
    } else {
        doc.codec_name = "h264".to_string();
        doc.format_name = "mp4".to_string();
    }
    let _ = fs.write_file(&out_full, &doc.serialize());
    ok_out("")
}

pub(super) fn cmd_ffprobe(args: &[String], mut stdin: super::CommandInput, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out(
            "Simple multimedia streams analyzer\nusage: ffprobe [OPTIONS] INPUT_FILE\n",
            1,
        );
    }
    for arg in args {
        if let Some(intro) = format_ffmpeg_introspection(arg, "ffprobe") {
            return ok_out(&intro);
        }
    }
    let quiet = args
        .windows(2)
        .any(|w| (w[0] == "-v" || w[0] == "-loglevel") && w[1] == "quiet");
    let ffprobe_err = |msg: &str| -> BuiltinOutcome {
        if quiet {
            err_out("", 1)
        } else {
            err_out(&format!("ffprobe: {msg}\n"), 1)
        }
    };
    let mut audio_options = true;
    let mut explicit_format = None;
    let mut requested = std::collections::BTreeSet::new();
    let mut entry_filter = None;
    let mut sections = BTreeMap::new();
    let mut of_fmt = "default".to_string();
    let mut in_arg: Option<String> = None;
    let mut show_entries = String::new();
    let mut select_streams: Option<String> = None;
    let mut count_frames = false;
    let mut count_packets = false;
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-print_format" | "-of" => {
                let Some(v) = args.get(i + 1) else {
                    return ffprobe_err(&format!("Missing value for {}", args[i]));
                };
                of_fmt = v.clone();
                i += 2;
            }
            "-show_entries" => {
                let Some(v) = args.get(i + 1) else {
                    return ffprobe_err(&format!("Missing value for {}", args[i]));
                };
                show_entries = v.clone();
                entry_filter = Some(v.as_str());
                for entry in v.split(':') {
                    let mut parts = entry.split('=');
                    let section = parts.next().unwrap();
                    audio_options &= matches!(section, "stream" | "format" | "stream_tags" | "format_tags");
                    sections.insert(section, parts.next());
                }
                i += 2;
            }
            "-select_streams" => {
                let Some(v) = args.get(i + 1) else {
                    return ffprobe_err(&format!("Missing value for {}", args[i]));
                };
                audio_options &= matches!(v.as_str(), "0" | "a" | "a:0");
                select_streams = Some(v.to_ascii_lowercase());
                i += 2;
            }
            "-i" => {
                let Some(v) = args.get(i + 1) else {
                    return ffprobe_err(&format!("Missing value for {}", args[i]));
                };
                if in_arg.is_some() {
                    return ffprobe_err("Expected one input");
                }
                in_arg = Some(v.clone());
                i += 2;
            }
            "-v" | "-loglevel" | "-f" => {
                if i + 1 >= args.len() {
                    return ffprobe_err(&format!("Missing value for {}", args[i]));
                }
                if args[i]=="-f" { explicit_format=Some(args[i+1].as_str()); }
                audio_options &= args[i] == "-v" && matches!(args[i+1].as_str(), "quiet" | "error" | "warning" | "info");
                i += 2;
            }
            "-hide_banner" | "-show_format" | "-show_streams" | "-show_packets"
            | "-show_frames" | "-show_chapters" | "-show_programs" => {
                if let Some(section) = args[i].strip_prefix("-show_") {
                    let section = section.strip_suffix('s').unwrap_or(section);
                    requested.insert(section);
                    if matches!(section, "stream" | "format") { sections.insert(section, None); }
                    else { audio_options = false; }
                } else { audio_options = false; }
                i += 1;
            }
            "-count_frames" => {
                count_frames = true;
                i += 1;
            }
            "-count_packets" => {
                count_packets = true;
                i += 1;
            }
            a if a.starts_with('-') && a != "-" => {
                return ffprobe_err(&format!("Unknown option {a}"));
            }
            a => {
                if in_arg.is_some() {
                    return ffprobe_err("Expected one input");
                }
                in_arg = Some(a.to_string());
                i += 1;
            }
        }
    }
    let Some(name) = in_arg.as_deref() else {
        return ffprobe_err("must specify an input file");
    };
    let mut fmt_parts = of_fmt.split(':');
    let head = fmt_parts.next().unwrap_or("default");
    let mut params: Vec<&str> = fmt_parts.collect();
    let writer = if let Some((w, rest)) = head.split_once('=') {
        params.insert(0, rest);
        w.to_ascii_lowercase()
    } else {
        head.to_ascii_lowercase()
    };
    if !matches!(writer.as_str(), "json" | "compact" | "csv" | "default" | "flat") {
        return ffprobe_err(&format!("Unknown output format {writer}"));
    }
    audio_options &= head == writer;
    let mut settings = BTreeMap::new();
    for param in params {
        let mut parts = param.split('=');
        let k = parts.next().unwrap();
        if let Some(v) = parts.next() {
            settings.insert(k, v);
            audio_options &= !matches!(k, "compact" | "c");
        } else {
            audio_options = false;
            settings.insert(param,"1");
        }
        if param.is_empty() {
            continue;
        }
        let key = param.split('=').next().unwrap_or("");
        if !matches!(
            key,
            "c" | "compact"
                | "nokey"
                | "nk"
                | "noprint_wrappers"
                | "nw"
                | "print_section"
                | "p"
                | "item_sep"
                | "s"
        ) {
            return ffprobe_err(&format!("Unsupported writer option {key}"));
        }
    }
    let from_stdin = media_stdin(name);
    let (raw_bytes, path_str) = if from_stdin {
        let bytes = match read_media_stdin(&mut stdin) { Ok(bytes) => bytes, Err(error) => return ffprobe_err(&error) };
        (bytes, "pipe:0".to_string())
    } else {
        let full = resolve_posix_path(cwd, name);
        if fs.is_dir(&full) {
            return ffprobe_err(&format!(
                "EISDIR: illegal operation on a directory, openReadFile '{full}'"
            ));
        }
        match fs.read_file(&full) {
            Ok(b) => (b, full),
            Err(_) => {
                return ffprobe_err(&format!(
                    "ENOENT: no such file or directory, openReadFile '{full}'"
                ));
            }
        }
    };
    if raw_bytes.is_empty() && !from_stdin && explicit_format.is_none_or(str::is_empty) {
        return ffprobe_err(&format!("EINVAL: invalid argument, read '{path_str}'"));
    }
    let Some(container) = media_format::detect(&raw_bytes, name, explicit_format) else {
        return ffprobe_err(&match explicit_format {
            Some(f) => format!("Unknown input format: '{f}' (AST not registered)"),
            None => format!("{name}: Invalid data found when processing input or format AST not registered"),
        });
    };
    let real_mp4=matches!(container,"mp4" | "mov") && !raw_bytes.starts_with(b"\0\0\0\x18ftypmp42\n__MEDIA__:");
    if container == "wav" {
        if !raw_bytes.starts_with(b"RIFF") || raw_bytes.get(8..12) != Some(b"WAVE") {
            return ffprobe_err("Invalid WAV file: missing RIFF WAVE signature");
        }
        if audio_options && !count_frames && !count_packets && let Ok(info) = probe_wav_info(&raw_bytes) {
            return ok_out(&format_wave_probe(&info, raw_bytes.len(), name, &sections, &writer, &settings));
        }
    }
    let still = container == "image2" && png_pixels::still_format(&raw_bytes).is_some();
    let gif = container=="gif" && !raw_bytes.get(6..).is_some_and(|v| v.starts_with(b"\n__MEDIA__:") || v.starts_with(b"\n__IMG__:"));
    if gif || still || real_mp4 || matches!(container, "dash" | "hls" | "mpegts" | "avi" | "mkv" | "webm" | "flv" | "aac" | "y4m" | "srt" | "webvtt") {
        let records=requested.contains("packet") || requested.contains("frame");
        let opts=media_probe::ProbeOptions {show:requested, entries:entry_filter, select:select_streams.as_deref(), counts:(count_frames,count_packets),
            writer:&writer, settings:&settings, limit:fs.shell_limits().max_output_bytes};
        if matches!(container, "hls" | "dash") {
            let format = media_format::FORMATS.iter().find(|f|f.0==container).unwrap();
            let result = streaming_input::read(container, &raw_bytes, &path_str, fs).and_then(|doc|
                mp4::streaming_probe::report(&doc, name, (format.1, format.2), raw_bytes.len(), fs.max_input_bytes(), opts));
            return match result { Ok(output) => ok_out(&output), Err(e) => ffprobe_err(&e) };
        }
        if container == "mpegts" {
            return match mp4::mpegts_input::report(&raw_bytes, name, fs.max_input_bytes(), opts) {
                Ok(output) => ok_out(&output), Err(reason) => ffprobe_err(reason),
            };
        }
        if container == "avi" {
            return match avi_input::report(&raw_bytes, name, fs.max_input_bytes(), opts) {
                Ok(output) => ok_out(&output), Err(reason) => ffprobe_err(reason),
            };
        }
        if matches!(container, "mkv" | "webm") {
            return match mp4::mkv_input::report(&raw_bytes, name, fs.max_input_bytes(), opts) {
                Ok(output) => ok_out(&output), Err(reason) => ffprobe_err(reason),
            };
        }
        if container == "flv" {
            return match mp4::flv_input::report(&raw_bytes, name, opts) {
                Ok(output) => ok_out(&output),
                Err(reason) => ffprobe_err(reason),
            };
        }
        if real_mp4 {
            return match mp4::report(&raw_bytes,name,opts) {
                Ok(output)=>ok_out(&output),Err(reason)=>ffprobe_err(&reason),
            };
        }
        let clip = if gif {
            media_probe::Clip::gif(&raw_bytes,records,fs.max_input_bytes())
        } else if still {
            media_probe::Clip::still(&raw_bytes, fs.max_input_bytes())
        } else if matches!(container,"srt" | "webvtt") {
            media_probe::Clip::subtitles(&raw_bytes,container=="webvtt",records,fs.max_input_bytes())
        } else if container == "aac" {
            Ok(media_probe::Clip::adts(&raw_bytes, records))
        } else { media_probe::Clip::y4m(&raw_bytes) };
        return match clip.and_then(|clip|clip.report(name,raw_bytes.len(),opts)) {
            Ok(output)=>ok_out(&output), Err(reason)=>ffprobe_err(reason),
        };
    }
    let doc = MediaDoc::parse(&raw_bytes, &path_str);
    let dur_val = if doc.duration > 0.0 {
        doc.duration
    } else {
        (doc.nb_frames.max(1) as f64) / (doc.fps.max(1) as f64)
    };
    let want_video = match select_streams.as_deref() {
        Some("a") | Some("a:0") | Some("1") => false,
        _ => doc.codec_type == "video",
    };
    let want_audio = match select_streams.as_deref() {
        Some("v") | Some("v:0") => false,
        Some("0") => doc.codec_type == "audio",
        _ => doc.codec_type == "audio" || doc.has_audio,
    };
    let video_field = |f: &str| -> Option<String> {
        match f.trim() {
            "index" => Some("0".to_string()),
            "codec_name" => Some(doc.codec_name.clone()),
            "codec_type" => Some("video".to_string()),
            "width" => Some(doc.width.to_string()),
            "height" => Some(doc.height.to_string()),
            "nb_frames" | "nb_read_frames" | "nb_read_packets" => {
                Some(doc.nb_frames.to_string())
            }
            "r_frame_rate" | "avg_frame_rate" => Some(format!("{}/1", doc.fps)),
            "duration" => Some(format!("{dur_val:.6}")),
            _ => None,
        }
    };
    let audio_field = |f: &str| -> Option<String> {
        let a_codec = if doc.codec_type == "audio" {
            doc.codec_name.clone()
        } else {
            "aac".to_string()
        };
        let a_idx = if doc.codec_type == "video" { "1" } else { "0" };
        match f.trim() {
            "index" => Some(a_idx.to_string()),
            "codec_name" => Some(a_codec),
            "codec_type" => Some("audio".to_string()),
            "sample_rate" => Some(doc.sample_rate.to_string()),
            "channels" => Some(doc.channels.to_string()),
            "duration" => Some(format!("{dur_val:.6}")),
            "nb_frames" | "nb_read_frames" | "nb_read_packets" => {
                Some(doc.nb_frames.to_string())
            }
            _ => None,
        }
    };
    let format_field = |f: &str| -> Option<String> {
        match f.trim() {
            "filename" => Some(in_arg.clone().unwrap_or_else(|| path_str.clone())),
            "nb_streams" => Some(
                if doc.codec_type == "video" && doc.has_audio {
                    "2".to_string()
                } else {
                    "1".to_string()
                },
            ),
            "format_name" => Some(doc.format_name.clone()),
            "duration" => Some(format!("{dur_val:.6}")),
            "size" => Some(raw_bytes.len().to_string()),
            "title" | "tag:title" => Some(doc.title.clone()),
            s if s.starts_with("tag:") => doc.tags.get(&s[4..]).cloned(),
            _ => None,
        }
    };
    if of_fmt.starts_with("default") && !show_entries.is_empty() {
        let nokey = of_fmt.contains("nokey=1") || of_fmt.contains("nk=1");
        let nowrappers = of_fmt.contains("noprint_wrappers=1") || of_fmt.contains("nw=1");
        let mut lines: Vec<String> = Vec::new();
        for sec in show_entries.split(':') {
            if let Some((sec_name, fields)) = sec.split_once('=') {
                let sec_lower = sec_name.trim().to_ascii_lowercase();
                if sec_lower == "stream" {
                    if want_video {
                        if !nowrappers {
                            lines.push("[STREAM]".to_string());
                        }
                        for f in fields.split(',') {
                            if let Some(v) = video_field(f) {
                                lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                            }
                        }
                        if !nowrappers {
                            lines.push("[/STREAM]".to_string());
                        }
                    }
                    if want_audio {
                        if !nowrappers {
                            lines.push("[STREAM]".to_string());
                        }
                        for f in fields.split(',') {
                            if let Some(v) = audio_field(f) {
                                lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                            }
                        }
                        if !nowrappers {
                            lines.push("[/STREAM]".to_string());
                        }
                    }
                } else if sec_lower == "format" || sec_lower == "format_tags" {
                    if !nowrappers {
                        lines.push("[FORMAT]".to_string());
                    }
                    for f in fields.split(',') {
                        if let Some(v) = format_field(f) {
                            lines.push(if nokey { v } else { format!("{}={v}", f.trim()) });
                        }
                    }
                    if !nowrappers {
                        lines.push("[/FORMAT]".to_string());
                    }
                }
            }
        }
        if lines.is_empty() {
            lines.push(doc.nb_frames.to_string());
        }
        return ok_out(&format!("{}\n", lines.join("\n")));
    }
    if of_fmt.starts_with("default=noprint_wrappers=1:nokey=1") {
        return ok_out(&format!("{}\n", doc.nb_frames));
    }
    if of_fmt == "flat" && !show_entries.is_empty() {
        let mut lines: Vec<String> = Vec::new();
        let fmt_flat_val = |k: &str, v: &str| -> String {
            if matches!(k, "width" | "height" | "channels" | "index") {
                v.to_string()
            } else {
                format!("\"{v}\"")
            }
        };
        for sec in show_entries.split(':') {
            if let Some((sec_name, fields)) = sec.split_once('=') {
                let sec_lower = sec_name.trim().to_ascii_lowercase();
                if sec_lower == "stream" {
                    if want_video {
                        for f in fields.split(',') {
                            let ft = f.trim();
                            if let Some(v) = video_field(ft) {
                                lines.push(format!("streams.stream.0.{ft}={}", fmt_flat_val(ft, &v)));
                            }
                        }
                    }
                    if want_audio {
                        let a_idx = if doc.codec_type == "video" { 1 } else { 0 };
                        for f in fields.split(',') {
                            let ft = f.trim();
                            if let Some(v) = audio_field(ft) {
                                lines.push(format!("streams.stream.{a_idx}.{ft}={}", fmt_flat_val(ft, &v)));
                            }
                        }
                    }
                } else if sec_lower == "format" || sec_lower == "format_tags" {
                    for f in fields.split(',') {
                        let ft = f.trim();
                        if let Some(v) = format_field(ft) {
                            lines.push(format!("format.{ft}={}", fmt_flat_val(ft, &v)));
                        }
                    }
                }
            }
        }
        return ok_out(&format!("{}\n", lines.join("\n")));
    }
    if of_fmt == "flat" {
        return ok_out(&format!(
            "streams.stream.0.codec_type=\"{}\"\nstreams.stream.0.codec_name=\"{}\"\nstreams.stream.0.width={}\nstreams.stream.0.height={}\nstreams.stream.0.nb_frames=\"{}\"\nstreams.stream.0.sample_rate=\"{}\"\nstreams.stream.0.channels={}\nformat.format_name=\"{}\"\nformat.duration=\"{dur_val:.6}\"\nformat.tags.title=\"{}\"\n",
            doc.codec_type,
            doc.codec_name,
            doc.width,
            doc.height,
            doc.nb_frames,
            doc.sample_rate,
            doc.channels,
            doc.format_name,
            doc.title
        ));
    }
    if of_fmt.starts_with("compact") {
        let no_key = of_fmt.contains("nk=1") || of_fmt.contains("nokey=1");
        let no_sec = of_fmt.contains("p=0") || of_fmt.contains("print_section=0");
        let mut out = String::new();
        let fields: Vec<&str> = if let Some(s) = show_entries.strip_prefix("stream=") {
            s.split(':').next().unwrap_or(s).split(',').collect()
        } else {
            vec!["codec_type", "codec_name", "width", "height"]
        };
        if want_video {
            let mut parts = Vec::new();
            if !no_sec {
                parts.push("stream".to_string());
            }
            for f in &fields {
                if let Some(v) = video_field(f) {
                    parts.push(if no_key { v } else { format!("{}={v}", f.trim()) });
                }
            }
            out.push_str(&parts.join("|"));
            out.push('\n');
        }
        if want_audio {
            let mut parts = Vec::new();
            if !no_sec {
                parts.push("stream".to_string());
            }
            for f in &fields {
                if let Some(v) = audio_field(f) {
                    parts.push(if no_key { v } else { format!("{}={v}", f.trim()) });
                }
            }
            out.push_str(&parts.join("|"));
            out.push('\n');
        }
        return ok_out(&out);
    }
    if of_fmt == "csv=p=0" || of_fmt == "csv" {
        let print_sec = of_fmt == "csv";
        if !show_entries.is_empty() {
            let mut out = String::new();
            for sec in show_entries.split(':') {
                if let Some((sec_name, fields_spec)) = sec.split_once('=') {
                    let sec_lower = sec_name.trim().to_ascii_lowercase();
                    if sec_lower == "stream" {
                        if want_video {
                            let mut vals = Vec::new();
                            if print_sec {
                                vals.push("stream".to_string());
                            }
                            for f in fields_spec.split(',') {
                                if let Some(v) = video_field(f) {
                                    vals.push(v);
                                }
                            }
                            if !vals.is_empty() {
                                out.push_str(&format!("{}\n", vals.join(",")));
                            }
                        }
                        if want_audio {
                            let mut vals = Vec::new();
                            if print_sec {
                                vals.push("stream".to_string());
                            }
                            for f in fields_spec.split(',') {
                                if let Some(v) = audio_field(f) {
                                    vals.push(v);
                                }
                            }
                            if !vals.is_empty() {
                                out.push_str(&format!("{}\n", vals.join(",")));
                            }
                        }
                    } else if sec_lower == "format" || sec_lower == "format_tags" {
                        let mut vals = Vec::new();
                        if print_sec {
                            vals.push("format".to_string());
                        }
                        for f in fields_spec.split(',') {
                            if let Some(v) = format_field(f) {
                                vals.push(v);
                            }
                        }
                        if !vals.is_empty() {
                            out.push_str(&format!("{}\n", vals.join(",")));
                        }
                    }
                }
            }
            return ok_out(&out);
        }
        if of_fmt == "csv" {
            return ok_out(&format!(
                "stream,0,{},{},{},{},{},{}\n",
                doc.codec_name,
                doc.codec_type,
                doc.width,
                doc.height,
                doc.sample_rate,
                doc.channels
            ));
        }
    }
    if of_fmt == "default" {
        return ok_out(&format!(
            "[STREAM]\ncodec_name={}\ncodec_type={}\nwidth={}\nheight={}\nsample_rate={}\nchannels={}\n[/STREAM]\n[FORMAT]\nformat_name={}\n[/FORMAT]\n",
            doc.codec_name,
            doc.codec_type,
            doc.width,
            doc.height,
            doc.sample_rate,
            doc.channels,
            doc.format_name
        ));
    }
    let chaps_json: Vec<String> = doc
        .chapters
        .iter()
        .map(|(id, t)| format!("{{\"id\":{id},\"tags\":{{\"title\":\"{t}\"}}}}"))
        .collect();
    let read_frames_extra = if count_frames {
        format!(",\"nb_read_frames\":\"{}\"", doc.nb_frames)
    } else {
        String::new()
    };
    let read_packets_extra = if count_packets {
        format!(",\"nb_read_packets\":\"{}\"", doc.nb_frames)
    } else {
        String::new()
    };
    let mut stream_objs = Vec::new();
    if want_video {
        stream_objs.push(format!(
            "{{\"index\":0,\"codec_type\":\"video\",\"codec_name\":\"{}\",\"width\":{},\"height\":{},\"r_frame_rate\":\"{}/1\",\"nb_frames\":\"{}\",\"duration\":\"{dur_val:.6}\"{read_frames_extra}{read_packets_extra}}}",
            doc.codec_name, doc.width, doc.height, doc.fps, doc.nb_frames
        ));
    }
    if want_audio {
        let a_codec = if doc.codec_type == "audio" {
            doc.codec_name.as_str()
        } else {
            "aac"
        };
        let a_idx = if doc.codec_type == "video" { 1 } else { 0 };
        stream_objs.push(format!(
            "{{\"index\":{a_idx},\"codec_type\":\"audio\",\"codec_name\":\"{a_codec}\",\"sample_rate\":\"{}\",\"channels\":{},\"duration\":\"{dur_val:.6}\"{read_frames_extra}{read_packets_extra}}}",
            doc.sample_rate, doc.channels
        ));
    }
    let stream_json = stream_objs.join(",");
    let esc_json = |s: &str| -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"")
    };
    let mut tags_map = BTreeMap::new();
    tags_map.insert("title".to_string(), doc.title.clone());
    for (k, v) in &doc.tags {
        tags_map.insert(k.clone(), v.clone());
    }
    let tags_entries: Vec<String> = tags_map
        .iter()
        .map(|(k, v)| format!("\"{}\":\"{}\"", esc_json(k), esc_json(v)))
        .collect();
    let tags_json = format!("{{{}}}", tags_entries.join(","));
    ok_out(&format!(
        "{{\"streams\":[{stream_json}],\"format\":{{\"format_name\":\"{}\",\"duration\":\"{dur_val:.6}\",\"tags\":{tags_json}}},\"chapters\":[{}]}}\n",
        doc.format_name,
        chaps_json.join(",")
    ))
}

fn cmd_soffice(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut outdir = cwd.to_string();
    let mut convert_to: Option<String> = None;
    let mut cat_mode = false;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--" {
            for f in &args[i + 1..] {
                files.push(f.clone());
            }
            break;
        }
        if arg == "--help" || arg == "-h" || arg == "-help" || arg == "-?" {
            return ok_out(
                "LibreOffice 24.8 (@poe-code/pdf-ast)\nUsage: soffice --headless --convert-to <format> [--outdir <dir>] <files...>\n",
            );
        }
        if arg == "--version" || arg == "-version" {
            return ok_out("LibreOffice 24.8.0.0 (@poe-code/pdf-ast)\n");
        }
        if arg == "--cat" || arg == "-cat" {
            cat_mode = true;
            i += 1;
            continue;
        }
        let opt = arg
            .strip_prefix("--")
            .or_else(|| arg.strip_prefix('-'))
            .unwrap_or("");
        let (opt_name, eq_val) = match opt.split_once('=') {
            Some((n, v)) => (n, Some(v)),
            None => (opt, None),
        };
        if matches!(
            opt_name,
            "convert-to" | "outdir" | "infilter" | "pidfile" | "language"
        ) {
            let val = if let Some(v) = eq_val {
                if v.is_empty() {
                    return err_out(&format!("Error: {arg} requires a value\n"), 1);
                }
                i += 1;
                v.to_string()
            } else {
                let next = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                if next.is_empty() || next.starts_with('-') {
                    return err_out(&format!("Error: {arg} requires a value\n"), 1);
                }
                i += 2;
                next.to_string()
            };
            if opt_name == "convert-to" {
                convert_to = Some(val);
            } else if opt_name == "outdir" {
                outdir = resolve_posix_path(cwd, &val);
            }
        } else if arg.starts_with('-') {
            i += 1;
        } else {
            files.push(arg.to_string());
            i += 1;
        }
    }
    if cat_mode && convert_to.is_none() && !files.is_empty() {
        let mut out = String::new();
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            let bytes = match fs.read_file(&full) {
                Ok(b) => b,
                Err(_) => {
                    return err_out(
                        &format!("Error: source file could not be loaded: {f}\n"),
                        1,
                    )
                }
            };
            let (paras, _) = match read_office_source(&full, &bytes, fs) { Ok(v) => v, Err(e) => return err_out(e, 1) };
            for p in paras {
                out.push_str(&p);
                out.push('\n');
            }
        }
        return ok_out(&out);
    }
    let conv_spec = match convert_to {
        Some(s) if !files.is_empty() => s,
        _ => {
            return err_out(
                "Error: --convert-to and at least one input file are required\n",
                1,
            )
        }
    };
    let _ = fs.mkdir_all(&outdir);
    let first_colon = conv_spec.find(':');
    let second_colon = first_colon.and_then(|fc| conv_spec[fc + 1..].find(':').map(|sc| fc + 1 + sc));
    let target_ext = match first_colon {
        Some(fc) => conv_spec[..fc].to_ascii_lowercase(),
        None => conv_spec.to_ascii_lowercase(),
    };
    let filter_name_raw = match (first_colon, second_colon) {
        (Some(fc), Some(sc)) => Some(&conv_spec[fc + 1..sc]),
        (Some(fc), None) => Some(&conv_spec[fc + 1..]),
        _ => None,
    };
    let filter_opts = second_colon.map(|sc| &conv_spec[sc + 1..]);
    let mut stdout_msg = String::new();
    for f in &files {
        let full = resolve_posix_path(cwd, f);
        let bytes = match fs.read_file(&full) {
            Ok(b) => b,
            Err(_) => {
                return err_out(
                    &format!("Error: source file could not be loaded: {f}\n"),
                    1,
                )
            }
        };
        let fname = f.rsplit('/').next().unwrap_or(f);
        let stem = fname
            .rsplit_once('.')
            .map(|(s, _)| s)
            .unwrap_or(fname);
        let lower_in = fname.to_ascii_lowercase();
        let dest = format!("{}/{stem}.{target_ext}", outdir.trim_end_matches('/'));
        let default_filter = if target_ext == "pdf" {
            if lower_in.ends_with(".xlsx") || lower_in.ends_with(".csv") || lower_in.ends_with(".ods") {
                "calc_pdf_Export".to_string()
            } else if lower_in.ends_with(".pptx") || lower_in.ends_with(".odp") {
                "impress_pdf_Export".to_string()
            } else {
                "writer_pdf_Export".to_string()
            }
        } else if target_ext == "csv" {
            "Text - txt - csv (StarCalc)".to_string()
        } else {
            format!("{target_ext}_Export")
        };
        let filter_name = match filter_name_raw {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => default_filter,
        };
        let (paras, mut rows_opt) = match read_office_source(&full, &bytes, fs) { Ok(v) => v, Err(e) => return err_out(e, 1) };
        let source = String::from_utf8_lossy(&bytes);
        let Some(blocks) = office::blocks(&source,&lower_in,&paras,rows_opt.as_deref()) else {
            return err_out("Error: conversion failed: document exceeds nesting limit\n",1);
        };
        let input_ext = lower_in.rsplit('.').next().unwrap_or("");
        if matches!(target_ext.as_str(),"xlsx"|"csv") && matches!(input_ext,"html"|"htm") {
            let mut rows=Vec::new();
            for b in &blocks { if let office::Block::Table(t)=b { rows.extend(t.iter().cloned()); } }
            if rows.is_empty() { rows.extend(blocks.iter().map(|b|vec![match b {office::Block::Text(t,_)=>t.clone(),_=>String::new()}])); }
            rows_opt=Some(rows);
        }
        if rows_opt.is_none() && matches!(target_ext.as_str(),"xlsx"|"csv") && !matches!(input_ext,"rtf"|"docx"|"odt"|"odp"|"pptx"|"pdf") {
            let delim=if source.contains('\t') {'\t'} else {','};
            rows_opt=Some(match office::delimited(&source,delim){Ok(rows)=>rows, Err(e)=>return err_out(e,1)});
        }
        match target_ext.as_str() {
            "pdf" if !matches!(input_ext,"pdf"|"pptx"|"odp"|"docx"|"odt"|"ods") => {
                let Some(pdf) = pdf_reader::render_office(blocks, stem, filter_opts, fs.max_input_bytes()) else {
                    return err_out("Error: conversion failed: PDF exceeds resource limits\n", 1);
                };
                if fs.write_file(&dest, &pdf).is_err() { return err_out("Error: conversion failed: cannot write PDF\n", 1); }
            }
            "pdf" => {
                let mut pdf = if full.to_ascii_lowercase().ends_with(".pdf") {
                    PdfDoc::parse(&bytes)
                } else {
                    let mut d = PdfDoc::new();
                    let body = paras.join("\n");
                    d.pages.push(PdfPage {
                        rot: 0,
                        text: body.clone(),
                        html: format!("<p>{}</p>", html_escape_str(&body)),
                        images: Vec::new(),
                        urls: Vec::new(),
                    });
                    d
                };
                pdf.version = "1.7".to_string();
                if conv_spec.contains("\"value\":16") || conv_spec.contains("\"value\": 16")
                {
                    pdf.version = "1.6".to_string();
                } else if conv_spec.contains("\"value\":15") {
                    pdf.version = "1.5".to_string();
                } else if conv_spec.contains("\"value\":14") {
                    pdf.version = "1.4".to_string();
                }
                if let Some(pr_idx) = conv_spec.find("\"PageRange\"") {
                    let after = &conv_spec[pr_idx..];
                    if let Some(v_idx) = after.find("\"value\":\"") {
                        let r = &after[v_idx + 9..];
                        if let Some(end_q) = r.find('"') {
                            let range_str = &r[..end_q];
                            let sel = parse_qpdf_page_spec(range_str, pdf.pages.len());
                            let mut new_pages = Vec::new();
                            for pno in sel {
                                if let Some(pg) = pdf.pages.get(pno - 1) {
                                    new_pages.push(pg.clone());
                                }
                            }
                            if !new_pages.is_empty() {
                                pdf.pages = new_pages;
                            }
                        }
                    }
                }
                let _ = fs.write_file(&dest, &pdf.serialize());
            }
            "docx" => {
                let Some(doc) = office::docx(&blocks, fs.max_input_bytes()) else { return err_out("Error: conversion failed: document exceeds byte limit\n",1); };
                if fs.write_file(&dest,&doc).is_err() { return err_out("Error: conversion failed: cannot write document\n",1); }
            }
            "xlsx" | "csv" if matches!(input_ext,"rtf"|"docx"|"odt"|"odp") => {
                let _=fs.write_file(&dest, office::text(&blocks).as_bytes());
            }
            "xlsx" => {
                let rows = rows_opt.unwrap_or_else(|| paras.iter().map(|p| vec![p.clone()]).collect());
                let Some(book) = office::xlsx(&rows, fs.max_input_bytes()) else { return err_out("Error: conversion failed: workbook exceeds byte limit\n",1); };
                if fs.write_file(&dest,&book).is_err() { return err_out("Error: conversion failed: cannot write workbook\n",1); }
            }
            "csv" => {
                let mut delim = ',';
                let mut quote = '"';
                let mut quote_all = false;
                if let Some(fopts) = filter_opts {
                    let fparts: Vec<&str> = fopts.split(',').collect();
                    if let Some(first_num) = fparts.first()
                        && let Ok(code) = first_num.parse::<u8>()
                        && code > 0
                    {
                        delim = code as char;
                    }
                    if let Some(second_num) = fparts.get(1)
                        && let Ok(code) = second_num.parse::<u8>()
                        && code > 0
                    {
                        quote = code as char;
                    }
                    quote_all = fparts.get(6) == Some(&"true") || fopts.ends_with(",true");
                }
                let rows = rows_opt.unwrap_or_else(|| paras.iter().map(|p| vec![p.clone()]).collect());
                let mut csv_out = String::new();
                let q_str = quote.to_string();
                let qq_str = format!("{quote}{quote}");
                for r in rows {
                    let formatted_cells: Vec<String> = r
                        .into_iter()
                        .map(|c| {
                            let must_quote = quote_all
                                || c.contains(delim)
                                || c.contains(quote)
                                || c.contains('\n')
                                || c.contains('\r');
                            if must_quote {
                                let escaped = c.replace(&q_str, &qq_str);
                                format!("{quote}{escaped}{quote}")
                            } else {
                                c
                            }
                        })
                        .collect();
                    let d_str = delim.to_string();
                    csv_out.push_str(&formatted_cells.join(&d_str));
                    csv_out.push('\n');
                }
                let _ = fs.write_file(&dest, csv_out.as_bytes());
            }
            "html" => { let _=fs.write_file(&dest, office::html(&blocks,stem).as_bytes()); }
            "txt" if !matches!(input_ext,"html"|"htm"|"md"|"rtf"|"docx"|"odt"|"ods"|"odp"|"pptx"|"pdf"|"csv"|"xlsx") => { let _=fs.write_file(&dest,&bytes); }
            "txt" | "ods" | "odt" => { let _=fs.write_file(&dest,office::text(&blocks).as_bytes()); }
            "png" => {
                let im = ImageMeta {
                    fmt: "PNG".to_string(),
                    w: 612,
                    h: 792,
                    cs: "sRGB".to_string(),
                    exif: BTreeMap::new(),
                };
                let _ = fs.write_file(&dest, &write_image_bytes(&im));
            }
            _ => {}
        }
        stdout_msg.push_str(&format!("convert {f} -> {dest} using filter : {filter_name}\n"));
    }
    ok_out(&stdout_msg)
}

fn cmd_pdfunite(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut pos: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        if a == "-v" || a == "--version" {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "pdfunite version 24.08.0\n".to_string(),
                exit_code: 0,
            };
        }
        if matches!(a.as_str(), "-h" | "-help" | "--help" | "-?") {
            return BuiltinOutcome {
                stdout: String::new(),
                stderr: "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n".to_string(),
                exit_code: 0,
            };
        }
        if a == "--" {
            pos.extend(args[i + 1..].iter().cloned());
            break;
        }
        if a.starts_with('-') {
            return err_out(
                "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n",
                99,
            );
        }
        pos.push(a.clone());
        i += 1;
    }
    if pos.len() < 3 {
        return err_out(
            "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n",
            99,
        );
    }
    let sources = &pos[..pos.len()-1];
    let destination = pos.last().unwrap();
    let mut inputs = BTreeMap::new();
    let mut remaining = fs.max_input_bytes();
    for src in sources {
        if inputs.contains_key(src) { continue; }
        let full = resolve_posix_path(cwd, src);
        let Ok(b) = fs.read_file(&full) else {
            return err_out(
                &format!(
                    "I/O Error: Couldn't open file '{src}': No such file or directory.\nSyntax Error: Could not merge damaged documents ('{src}')\n"
                ),
                255,
            );
        };
        if !b.starts_with(b"%PDF-") {
            return err_out(
                &format!("Syntax Error: Could not merge damaged documents ('{src}')\n"),
                255,
            );
        }
        let Some(left) = remaining.checked_sub(b.len()) else {
            return err_out("pdfunite: input byte limit exceeded\n", 255);
        };
        remaining = left;
        inputs.insert(src, b);
    }
    if !inputs.values().any(|bytes| is_legacy_pdf(bytes)) {
        let mut output = pdf_reader::PageOutput::new(crate::budget::ShellLimits::default().max_output_bytes);
        for src in sources {
            let damaged = || err_out(&format!("Syntax Error: Could not merge damaged documents ('{src}')\n"), 255);
            let Ok(mut source) = pdf_reader::PageSource::open(&inputs[src],"") else { return damaged() };
            if output.append(&mut source, None).is_none() { return damaged(); }
        }
        return match output.finish() {
            Some(bytes) => write_copied_pdf(fs, cwd, destination, &bytes, 255),
            None => err_out("pdfunite: output byte limit exceeded\n", 255),
        };
    }
    let mut out_doc = PdfDoc::new();
    for (idx, src) in sources.iter().enumerate() {
        let b = &inputs[src];
        let mut sub = PdfDoc::parse(b);
        if !is_legacy_pdf(b) {
            let source = pdf_reader::attachments::CopyAttachments {path:src.to_string(),prefix:String::new(),password:String::new()};
            if source.visit(b,|key,name,data|{
                sub.attachments.push((key,name,String::new(),data.to_vec()));
                Ok(())
            }).is_err(){return err_out(&format!("Syntax Error: Could not merge damaged documents ('{src}')\n"),255);}
        }
        if sub.encrypted.is_some() {
            return err_out(
                &format!("Unimplemented Feature: Could not merge encrypted files ('{src}')\n"),
                255,
            );
        }
        let page_offset = out_doc.pages.len();
        if idx == 0 {
            out_doc.version = sub.version.clone();
            out_doc.title = sub.title.clone();
            out_doc.author = sub.author.clone();
            out_doc.page_w = sub.page_w;
            out_doc.page_h = sub.page_h;
            out_doc.info = sub.info.clone();
            out_doc.exif = sub.exif.clone();
        }
        for (pno, media) in &sub.page_media {
            out_doc.page_media.insert(page_offset + pno, *media);
        }
        for (bt, bl, bp) in &sub.bookmarks {
            let shifted = bp.parse::<usize>().unwrap_or(1) + page_offset;
            out_doc.bookmarks.push((bt.clone(), bl.clone(), shifted.to_string()));
        }
        for (ni, st, pf, sy) in &sub.page_labels {
            let shifted = ni.parse::<usize>().unwrap_or(1) + page_offset;
            out_doc.page_labels.push((shifted.to_string(), st.clone(), pf.clone(), sy.clone()));
        }
        for att in &sub.attachments {
            if !out_doc.attachments.iter().any(|x| x.0 == att.0) {
                out_doc.attachments.push(att.clone());
            }
        }
        out_doc.pages.extend(sub.pages);
    }
    write_copied_pdf(fs, cwd, destination, &out_doc.serialize(), 255)
}

fn cmd_pdfseparate(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut first_p = 1usize;
    let mut last_p: Option<usize> = None;
    let mut pos: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-v" | "--version" => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "pdfseparate version 24.08.0\n".to_string(),
                    exit_code: 0,
                };
            }
            "-h" | "-help" | "--help" | "-?" => {
                return BuiltinOutcome {
                    stdout: String::new(),
                    stderr: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n".to_string(),
                    exit_code: 0,
                };
            }
            "--" => {
                pos.extend(args[i + 1..].iter().cloned());
                break;
            }
            "-f" => {
                let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                    return err_out(
                        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n",
                        99,
                    );
                };
                first_p = v.max(1);
                i += 2;
            }
            "-l" => {
                let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                    return err_out(
                        "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n",
                        99,
                    );
                };
                if v > 0 {
                    last_p = Some(v);
                } else {
                    last_p = None;
                }
                i += 2;
            }
            a if !a.starts_with('-') => {
                pos.push(a.to_string());
                i += 1;
            }
            _ => {
                return err_out(
                    "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n",
                    99,
                );
            }
        }
    }
    if pos.len() != 2 {
        return err_out("Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n", 99);
    }
    let src = resolve_posix_path(cwd, &pos[0]);
    let pat = &pos[1];
    let Ok(b) = fs.read_file(&src) else {
        return err_out(
            &format!(
                "I/O Error: Couldn't open file '{}': No such file or directory.\nSyntax Error: Could not extract page(s) from damaged file ('{}')\n",
                pos[0], pos[0]
            ),
            99,
        );
    };
    if !b.starts_with(b"%PDF-") {
        return err_out(&format!("Syntax Error: Could not extract page(s) from damaged file ('{}')\n", pos[0]), 99);
    }
    let mut source = pdf_reader::PageSource::open(&b,"").ok();
    let legacy = if source.is_none() && is_legacy_pdf(&b) { Some(PdfDoc::parse(&b)) } else { None };
    let damaged = || err_out(&format!("Syntax Error: Could not extract page(s) from damaged file ('{}')\n", pos[0]), 99);
    let total = match (&source, &legacy) {
        (Some(s), _) => s.len(),
        (_, Some(doc)) => doc.pages.len(),
        _ => return damaged(),
    };
    let end_p = last_p.map(|lp| total.min(lp)).unwrap_or(total);
    if first_p > total || last_p.is_some_and(|lp| lp > total || first_p > lp) {
        return err_out(
            &format!(
                "Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n"
            ),
            99,
        );
    }
    let count = end_p - first_p + 1;
    if count > 1 && filename_number_spec(pat).is_none() {
        return err_out(&format!("Error: '{pat}' must contain '%d' if more than one page should be extracted\n"), 99);
    }
    let mut outputs = Vec::new();
    let mut remaining = crate::budget::ShellLimits::default().max_output_bytes;
    for pno in first_p..=end_p {
        let bytes = if let Some(s) = &mut source {
            let mut output = pdf_reader::PageOutput::new(remaining);
            let Some(bytes) = output.append(s, Some(pno - 1)).and_then(|()| output.finish()) else { return damaged() };
            bytes
        } else if let Some(doc) = &legacy {
            let pg = &doc.pages[pno - 1];
            let mut single = PdfDoc::new();
            single.version = doc.version.clone();
            single.title = doc.title.clone();
            single.author = doc.author.clone();
            single.page_w = doc.page_w;
            single.page_h = doc.page_h;
            if let Some(m) = doc.page_media.get(&pno) {
                single.page_media.insert(1, *m);
            }
            single.pages.push(pg.clone());
            single.serialize()
        } else { return damaged() };
        let Some(left) = remaining.checked_sub(bytes.len()) else {
            return err_out("pdfseparate: output byte limit exceeded\n", 99);
        };
        remaining = left;
        let Some(name) = format_printf_num(pat, pno, Some(' ')) else { return err_out("shell: line 1: internal error\n", 1); };
        outputs.push((name, bytes));
    }
    for (name, bytes) in outputs {
        let result = write_copied_pdf(fs, cwd, &name, &bytes, 99);
        if result.exit_code != 0 { return result; }
    }
    ok_out("")
}

fn cmd_qpdf(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let (args, input_remaining) = match qpdf_argfiles::expand(args, cwd, fs) {
        Ok(expanded) => expanded,
        Err(e) => return err_out(&e, 2),
    };
    let publish = |operand: &str, bytes: &[u8]| {
        let path = resolve_posix_path(cwd, operand);
        fs.mkdir(&crate::vfs::dirname_posix_path(&path), true, 0o755)
            .map_err(|(code, _)| code)
            .and_then(|()| fs.replace_file_entry(&path, bytes, fs.generation()))
            .map_err(|error| {
                let code = error.split(':').next().unwrap_or(&error);
                let reason = if code == "ENOENT" { "No such file or directory" } else { code };
                err_out(&format!("qpdf: open {operand}: {reason}\n"), 2)
            })
    };
    let mut password: Option<String> = None;
    let mut empty_input = false;
    let mut replace_input = false;
    let mut check_mode = false;
    let mut show_npages = false;
    let mut show_enc = false;
    let mut is_enc = false;
    let mut req_pw = false;
    let mut show_lin = false;
    let mut show_xref = false;
    let mut show_pages = false;
    let mut with_images = false;
    let mut show_object: Option<String> = None;
    let mut raw_stream_data = false;
    let mut filtered_stream_data = false;
    let mut json_version: Option<u32> = None;
    let mut json_keys: Vec<String> = Vec::new();
    let mut json_objects: Vec<Option<(usize,usize)>> = Vec::new();
    let mut json_stream_prefix = None;
    let mut json_stream_data = "none".to_string();
    let mut json_input = false;
    let mut update_from_json = Vec::new();
    let mut list_att = false;
    let mut show_att: Option<String> = None;
    let mut remove_atts: Vec<String> = Vec::new();
    let mut add_atts = Vec::new();
    let mut copy_atts = Vec::new();
    let mut encryption = None;
    let mut qdf_mode = false;
    let mut uncompress = false;
    let mut normalize_content = None;
    let mut externalize_inline=false;
    let mut ii_min_bytes=1024;
    let mut collate_group: Option<usize> = None;
    let mut edits = pdf_reader::PageEdits::default();
    let mut pos_files: Vec<String> = Vec::new();

    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if matches!(a,"--help"|"-h"){return ok_out("Usage: qpdf [options] infile [outfile]\n")}
        if a=="--version"{return ok_out("qpdf version 11.9.1 (@poe-code/pdf-ast)\n")}
        if let Some(mode) = a.strip_prefix("--normalize-content=") {
            normalize_content = Some(match mode {
                "y" => true, "n" => false,
                _ => return err_out(&format!("qpdf: invalid normalize-content value {mode}\n"),2),
            });
            i += 1;
            continue;
        }
        if let Some(mode) = a.strip_prefix("--compress-streams=") {
            uncompress = match mode {
                "y" => false, "n" => true,
                _ => return err_out(&format!("qpdf: invalid compress-streams value {mode}\n"),2),
            };
            i += 1;
            continue;
        }
        if let Some(mode) = a.strip_prefix("--stream-data=") {
            match mode {
                "uncompress" => uncompress = true,
                "compress" | "preserve" => uncompress = false,
                _ => {}
            }
            i += 1;
            continue;
        }
        if let Some(mode) = a.strip_prefix("--object-streams=") {
            edits.generate_object_streams = match mode {
                "generate" => true,
                "preserve" | "disable" => false,
                _ => return err_out(&format!("qpdf: invalid object-streams mode {mode}\n"),2),
            };
            i += 1;
            continue;
        }
        if a == "--empty" {
            empty_input = true;
            i += 1;
            continue;
        }
        if a == "--replace-input" {
            replace_input = true;
            i += 1;
            continue;
        }
        if let Some(pw) = a.strip_prefix("--password=") {
            password = Some(pw.to_string());
            i += 1;
            continue;
        }
        if a == "--check" {
            check_mode = true;
            i += 1;
            continue;
        }
        if a == "--show-npages" || a == "--npages" {
            show_npages = true;
            i += 1;
            continue;
        }
        if a == "--show-encryption" {
            show_enc = true;
            i += 1;
            continue;
        }
        if a == "--is-encrypted" {
            is_enc = true;
            i += 1;
            continue;
        }
        if a == "--requires-password" {
            req_pw = true;
            i += 1;
            continue;
        }
        if a == "--show-linearization" || a == "--check-linearization" {
            show_lin = true;
            i += 1;
            continue;
        }
        if a == "--show-xref" {
            show_xref = true;
            i += 1;
            continue;
        }
        if a == "--show-pages" {
            show_pages = true;
            i += 1;
            continue;
        }
        if a == "--with-images" {
            with_images = true;
            i += 1;
            continue;
        }
        if let Some(obj) = a.strip_prefix("--show-object=") {
            show_object = Some(obj.to_string());
            i += 1;
            continue;
        }
        if a == "--raw-stream-data" {
            raw_stream_data = true;
            i += 1;
            continue;
        }
        if a == "--filtered-stream-data" {
            filtered_stream_data = true;
            i += 1;
            continue;
        }
        if a == "--json" || a.starts_with("--json=") {
            json_version = Some(match a.strip_prefix("--json=").unwrap_or("latest") {
                "latest" | "2" => 2, "1" => 1,
                v => return err_out(&format!("qpdf: invalid json version {v}\n"),2),
            });
            i += 1;
            continue;
        }
        if let Some(k) = a.strip_prefix("--json-key=") {
            if !matches!(k,"qpdf"|"objects"|"objectinfo"|"pages"|"pagelabels"|"outlines"|"acroform"|"attachments"|"encrypt") {
                return err_out(&format!("qpdf: invalid json-key {k}\n"),2);
            }
            json_keys.push(k.to_string());
            i += 1;
            continue;
        }
        if let Some(o) = a.strip_prefix("--json-object=") {
            let selector = if o == "trailer" { None } else {
                let (n,g) = o.split_once(',').unwrap_or((o,"0"));
                let number = |s: &str| s.bytes().all(|b| b.is_ascii_digit()).then(|| s.parse::<usize>().ok()).flatten();
                match (number(n),number(g)) {
                    (Some(n @ 1..=2147483647),Some(g @ 0..=65535)) => Some((n,g)),
                    _ => return err_out("qpdf: invalid json-object selector\n",2),
                }
            };
            json_objects.push(selector);
            i += 1;
            continue;
        }
        if let Some(m) = a.strip_prefix("--json-stream-data=") {
            if !matches!(m,"none"|"inline"|"file") {
                return err_out(&format!("qpdf: invalid json-stream-data mode {m}\n"),2);
            }
            json_stream_data = m.to_string();
            i += 1;
            continue;
        }
        if let Some(p) = a.strip_prefix("--json-stream-prefix=") {
            json_stream_prefix = Some(p.to_owned());
            i += 1;
            continue;
        }
        if a == "--json-input" {
            json_input = true;
            i += 1;
            continue;
        }
        if let Some(uf) = a.strip_prefix("--update-from-json=") {
            update_from_json.push(uf);
            i += 1;
            continue;
        }
        if a == "--list-attachments" {
            list_att = true;
            i += 1;
            continue;
        }
        if let Some(key) = a.strip_prefix("--show-attachment=") {
            show_att = Some(key.to_string());
            i += 1;
            continue;
        }
        if let Some(key) = a.strip_prefix("--remove-attachment=") {
            remove_atts.push(key.to_string());
            i += 1;
            continue;
        }
        if a == "--add-attachment" || a.starts_with("--add-attachment=") {
            let att_file = if let Some(path) = a.strip_prefix("--add-attachment=") { path.to_owned() } else {
                i += 1;
                args.get(i).cloned().unwrap_or_default()
            };
            let mut key = att_file.rsplit('/').next().unwrap_or(&att_file).to_string();
            if key.is_empty() {key = "attachment".into();}
            let mut fname = key.clone();
            let mut description = String::new();
            let mut replace = false;
            i += 1;
            while i < args.len() && args[i] != "--" {
                if let Some(k) = args[i].strip_prefix("--key=") {
                    if !k.is_empty() {key = k.to_owned();}
                } else if let Some(d) = args[i].strip_prefix("--description=") {
                    description = d.to_owned();
                } else if let Some(f) = args[i].strip_prefix("--filename=") {
                    fname = f.to_string();
                } else if args[i] == "--replace" {
                    replace = true;
                }
                i += 1;
            }
            if i < args.len() && args[i] == "--" {
                i += 1;
            }
            add_atts.push(pdf_reader::attachments::AddAttachment {path:att_file, key, filename:fname, description, replace});
            continue;
        }
        if a == "--copy-attachments-from" || a.starts_with("--copy-attachments-from=") {
            let src_pdf = if let Some(path) = a.strip_prefix("--copy-attachments-from=") {path.to_owned()} else {
                i += 1;
                args.get(i).cloned().unwrap_or_default()
            };
            let mut source = pdf_reader::attachments::CopyAttachments {path:src_pdf, prefix:String::new(), password:String::new()};
            i += 1;
            while i < args.len() && args[i] != "--" {
                if let Some(p) = args[i].strip_prefix("--prefix=") {
                    source.prefix = p.to_string();
                } else if let Some(p) = args[i].strip_prefix("--password=") {
                    source.password = p.to_string();
                }
                i += 1;
            }
            if i < args.len() && args[i] == "--" {
                i += 1;
            }
            copy_atts.push(source);
            continue;
        }
        if a == "--split-pages" {
            edits.split_pages = Some(1);
            i += 1;
            continue;
        }
        if let Some(sp) = a.strip_prefix("--split-pages=") {
            edits.split_pages = Some((qpdf_decimal(sp).unwrap_or(1.) as usize).max(1));
            i += 1;
            continue;
        }
        if a == "--encrypt" {
            let user = args.get(i+1).map_or("", String::as_str);
            let owner = args.get(i+2).map_or("", String::as_str);
            // The production command writes revision 6 for every requested key length.
            let mut permissions = -1028i32; // all enabled except document assembly
            i += 4;
            while i < args.len() && args[i] != "--" {
                permissions &= !match args[i].as_str() {
                    "--print=none" => 4, "--modify=none" => 8, "--extract=n" => 16, "--annotate=n" => 32, _ => 0,
                };
                i += 1;
            }
            encryption = Some((user,owner,permissions));
            if i < args.len() && args[i] == "--" {
                i += 1;
            }
            continue;
        }
        if a == "--decrypt" {
            edits.decrypt = true;
            i += 1;
            continue;
        }
        if a == "--linearize" {
            edits.linearize = true;
            i += 1;
            continue;
        }
        if a == "--qdf" {
            qdf_mode = true;
            uncompress = true;
            i += 1;
            continue;
        }
        if let Some(rot_spec) = a.strip_prefix("--rotate=") {
            edits.rotations.push(rot_spec);
            i += 1;
            continue;
        }
        if a == "--generate-appearances" {
            edits.generate_appearances=true;i+=1;continue;
        }
        if a=="--externalize-inline-images" {externalize_inline=true;i+=1;continue;}
        if let Some(s)=a.strip_prefix("--ii-min-bytes="){
            if let Some(n) = qpdf_decimal(s).filter(|n| n.is_finite() && *n >= 0.) {
                ii_min_bytes = n as u64;
            }
            i+=1;continue;
        }
        if a == "--remove-unreferenced-resources" || a.starts_with("--remove-unreferenced-resources=") {
            edits.prune_resources = match a.split_once('=').map_or("yes", |(_,m)|m) {
                "yes"|"auto"=>true,"no"=>false,
                m=>return err_out(&format!("qpdf: invalid remove-unreferenced-resources mode {m}\n"),2),
            };
            i+=1;continue;
        }
        if a == "--flatten-annotations" || a.starts_with("--flatten-annotations=") {
            edits.flatten_annotations=Some(a.split_once('=').map_or("all",|(_,m)|m));i+=1;continue;
        }
        if a == "--flatten-rotation" {
            edits.flatten_rotation = true;
            i += 1;
            continue;
        }
        if matches!(a, "--overlay" | "--underlay") || a.starts_with("--overlay=") || a.starts_with("--underlay=")
        {
            let path = if let Some((_, p)) = a.split_once('=') {
                p
            } else {
                i += 1;
                args.get(i).map_or("", String::as_str)
            };
            let mut spec = pdf_reader::Layer {
                overlay: a.starts_with("--overlay"),
                path,
                from: "1-z",
                to: "1-z",
                repeat: "",
                password: None,
            };
            i += 1;
            while i < args.len() && args[i] != "--" {
                if let Some((key, v)) = args[i].split_once('=') {
                    match key {
                        "--from" => spec.from = v,
                        "--to" => spec.to = v,
                        "--repeat" => spec.repeat = v,
                        "--password" => spec.password = Some(v),
                        _ => (),
                    }
                }
                i += 1;
            }
            if i < args.len() {
                i += 1;
            }
            edits.layers.push(spec);
            continue;
        }
        if a == "--collate" {
            collate_group = Some(1);
            i += 1;
            continue;
        }
        if let Some(cg) = a.strip_prefix("--collate=") {
            collate_group = Some((qpdf_decimal(cg).unwrap_or(1.) as usize).max(1));
            i += 1;
            continue;
        }
        if a == "--pages" {
            i += 1;
            while i < args.len() && args[i] != "--" {
                if args[i].starts_with("--password=") {
                    i += 1;
                    continue;
                }
                let src_f = args[i].clone();
                let mut rng = "1-z".to_string();
                let mut j = i + 1;
                let source_password = args.get(j).and_then(|s| s.strip_prefix("--password="));
                if source_password.is_some() {
                    j += 1;
                }
                let next_is_range = j < args.len()
                    && args[j] != "--"
                    && args[j] != "."
                    && !args[j].ends_with(".pdf");
                if next_is_range {
                    rng = args[j].clone();
                    i = j + 1;
                } else {
                    i = j;
                }
                edits.selections.push((src_f, rng, source_password));
            }
            if i < args.len() && args[i] == "--" {
                i += 1;
            }
            continue;
        }
        if a == "--set-page-labels" {
            i += 1;
            while i < args.len() && args[i] != "--" {
                edits.label_specs.push(args[i].as_str());
                i += 1;
            }
            if i < args.len() && args[i] == "--" {
                i += 1;
            }
            continue;
        }
        match a {
            "--remove-page-labels" => edits.page_labels = true,
            "--remove-info" => edits.info = true,
            "--remove-metadata" => edits.metadata = true,
            "--remove-structure" => edits.structure = true,
            "--remove-acroform" => edits.acroform = true,
            _ => {}
        }
        if !a.starts_with('-') || a == "-" {
            pos_files.push(a.to_string());
        }
        i += 1;
    }

    edits.inline_images=externalize_inline.then_some((ii_min_bytes,!uncompress));
    edits.normalize_content = normalize_content.unwrap_or(qdf_mode || uncompress);

    let read = |name: &str| if name == "-" {Some(crate::vfs::stream_string_to_bytes(stdin))}
        else {fs.read_file(&resolve_posix_path(cwd, name)).ok()};
    let load_input = |path_arg: &str| -> Result<PdfDoc, BuiltinOutcome> {
        if path_arg == "-" {
            let b = crate::vfs::stream_string_to_bytes(stdin);
            return Ok(PdfDoc::parse(&b));
        }
        let full = resolve_posix_path(cwd, path_arg);
        let Ok(b) = fs.read_file(&full) else {
            return Err(err_out(&format!("qpdf: cannot open {path_arg}\n"), 2));
        };
        if pdf_reader::header_version(&b).is_none() {
            return Err(err_out(
                &format!("qpdf: {path_arg}: Invalid PDF header: missing %PDF- signature\n"),
                2,
            ));
        }
        Ok(PdfDoc::parse(&b))
    };

    let primary_arg = if empty_input {
        None
    } else {
        pos_files.first().cloned()
    };

    if input_remaining < fs.shell_limits().max_input_bytes {
        let mut remaining = input_remaining;
        let mut seen = std::collections::BTreeSet::new();
        for path in primary_arg.iter().map(String::as_str)
            .chain(update_from_json.iter().copied())
            .chain(edits.selections.iter().map(|s| s.0.as_str()))
            .chain(add_atts.iter().map(|a| a.path.as_str()))
            .chain(copy_atts.iter().map(|a| a.path.as_str()))
            .chain(edits.layers.iter().map(|l| l.path)) {
            if path.is_empty() || path == "." || !seen.insert(path) { continue; }
            let size = if path == "-" {
                crate::vfs::stream_byte_len(stdin)
            } else {
                fs.stat(&resolve_posix_path(cwd, path)).map_or(0, |s| s.size)
            };
            // The JS PDF reader reports a command failure if an operand
            // exceeds the budget remaining after argument-file reads.
            let Some(left) = remaining.checked_sub(size) else {
                return err_out("shell: line 1: internal error\n", 1);
            };
            remaining = left;
        }
    }
    if is_enc || req_pw {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let bytes = if f == "-" { crate::vfs::stream_string_to_bytes(stdin) }
            else { match fs.read_file(&resolve_posix_path(cwd,f)) {
                Ok(data) => data, Err(_) => return err_out(&format!("qpdf: cannot open {f}\n"),2),
            }};
        if is_legacy_pdf(&bytes) {
            let Some(key) = PdfDoc::parse(&bytes).encrypted else {return err_out("",2)};
            return if !is_enc && password.as_ref().is_some_and(|p| key.is_empty() || p == &key) {err_out("",3)} else {ok_out("")};
        }
        // The compatibility predicates deliberately recognize a literal
        // marker, including in malformed files, before opening a PDF.
        if !bytes.windows(8).any(|s| s == b"/Encrypt") { return err_out("",2); }
        if !is_enc && let Some(pw) = password.as_deref() && pdf_reader::accepts_password(&bytes,pw).is_some() { return err_out("",3); }
        return ok_out("");
    }
    let original = || if empty_input {pdf_reader::empty_pdf(fs.shell_limits().max_output_bytes)}else{primary_arg.as_deref().and_then(read)};
    let mut rebuilt=if json_input && !empty_input || !update_from_json.is_empty(){
        let name=primary_arg.as_deref().unwrap_or("empty");
        let Some(mut bytes)=original()else{return if primary_arg.is_none(){err_out("qpdf: an input file is required\n",2)}else{err_out(&format!("qpdf: cannot open {name}\n"),2)}};
        let limits=fs.shell_limits();
        let mut seen=std::collections::BTreeSet::new();seen.insert(name.to_string());
        let mut left=input_remaining;
        if !empty_input{let Some(n)=left.checked_sub(bytes.len())else{return err_out("qpdf: input byte limit exceeded\n",2)};left=n;}
        let mut acquire=|path:&str|->Result<Option<Vec<u8>>,String>{
            let b=read(path);if let Some(b)=&b && seen.insert(path.to_string()){left=left.checked_sub(b.len()).ok_or("input byte limit exceeded")?;}
            Ok(b)
        };
        if json_input && !empty_input{
            let mut graph=pdf_reader::JsonDocument::default();
            bytes=match graph.apply(&bytes,&mut acquire,limits.max_output_bytes).and_then(|()|graph.save(limits.max_output_bytes)){
                Ok(b)=>b,Err(e)=>return err_out(&format!("qpdf: {name}: {e}\n"),2)
            };
        }
        if !update_from_json.is_empty(){
            if pdf_reader::header_version(&bytes).is_none(){return err_out(&format!("qpdf: {name}: Invalid PDF header: missing %PDF- signature\n"),2)}
            let mut graph=match pdf_reader::JsonDocument::from_pdf(&bytes,password.as_deref().unwrap_or("")){
                Ok(g)=>g,Err(e)=>return err_out(&format!("qpdf: {name}: {e}\n"),2)
            };
            for path in update_from_json{
                let source=match acquire(path){
                    Ok(Some(b))=>b,Ok(None)=>return err_out(&format!("qpdf: cannot open {path}\n"),2),
                    Err(e)=>return err_out(&format!("qpdf: {e}\n"),2)
                };
                if let Err(e)=graph.apply(&source,&mut acquire,limits.max_output_bytes){return err_out(&format!("qpdf: {path}: {e}\n"),2)}
            }
            bytes=match graph.save(limits.max_output_bytes){Ok(b)=>b,Err(_)=>return err_out("shell: line 1: internal error\n",1)};
        }
        Some(bytes)
    }else{None};
    let base_is_input=rebuilt.is_none();
    let mut primary=||rebuilt.take().or_else(original);
    if show_lin || check_mode || show_npages || show_pages || show_xref || show_object.is_some() || show_enc || list_att || show_att.is_some() {
        let input = primary_arg.as_deref().unwrap_or("empty");
        let bytes=primary();
        if let Some(bytes) = bytes {
            let source = pdf_reader::PageSource::open(&bytes,password.as_deref().unwrap_or(""));
            if let Err(e @ (pdf_reader::NO_CATALOG | pdf_reader::PASSWORD | pdf_reader::UNSUPPORTED)) = source && !is_legacy_pdf(&bytes) {
                return err_out(&format!("qpdf: {input}: {e}\n"),2);
            }
            if let Ok(mut source) = source {
            let out = if show_lin || check_mode { source.qpdf_summary(input,check_mode,show_lin) }
                else if show_pages {source.qpdf_pages(with_images)}
                else if show_npages {source.qpdf_summary(input,false,false)}
                else if show_enc { Some(source.encryption_description()) }
                else if show_xref {source.qpdf_xref()}
                else if let Some(spec) = &show_object {
                    let number = qpdf_decimal(spec).unwrap_or(0.) as usize;
                    source.qpdf_object(number,raw_stream_data,filtered_stream_data)
                } else {
                    match source.qpdf_attachments(show_att.as_deref()) {
                        Some(None) => return err_out(&format!("qpdf: attachment {} not found\n",show_att.as_deref().unwrap_or("")),2),
                        result => result.flatten(),
                    }
                };
            return match out { Some(out)=>ok_out(&out), None=>err_out(&format!("qpdf: {input}: invalid PDF object or stream\n"),2) };
            }
        }
    }
    if show_enc {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        if let Some(ref enc_pw) = doc.encrypted {
            let supplied = password.as_deref().unwrap_or("");
            if !enc_pw.is_empty() && supplied != enc_pw {
                return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
            }
            return ok_out("R = 6\nV = 5\nLength = 256\nprint: allowed\nmodify: allowed\nextract for accessibility: allowed\n");
        }
        return ok_out("File is not encrypted\n");
    }
    if show_lin {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        if doc.linearized {
            return ok_out(&format!("{f}: linearized\nno linearization errors\n"));
        }
        return ok_out(&format!("{f}: not linearized\n"));
    }
    if show_npages || check_mode {
        let f = primary_arg.as_deref().unwrap_or("empty");
        let doc = if empty_input { PdfDoc {version:"1.7".into(), ..PdfDoc::new()} } else {
            if primary_arg.is_none() { return err_out("qpdf: an input file is required\n",2); }
            match load_input(f) { Ok(d) => d, Err(e) => return e }
        };
        if !check_mode { return ok_out(&format!("{}\n",doc.pages.len())); }
        if let Some(ref enc_pw) = doc.encrypted {
            let supplied = password.as_deref().unwrap_or("");
            if !enc_pw.is_empty() && supplied != enc_pw {
                return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
            }
        }
        let lines = vec![
            format!("checking {f}"),
            format!("PDF Version: {}", doc.version),
            if doc.encrypted.is_some() {
                "File is encrypted".to_string()
            } else {
                "File is not encrypted".to_string()
            },
            if doc.pages.is_empty() { "File is empty".to_string() } else if doc.linearized {
                "File is linearized".to_string()
            } else {
                "File is not linearized".to_string()
            },
            "No syntax or stream encoding errors found; the file may still contain".to_string(),
            "errors that qpdf cannot detect".to_string(),
        ];
        return ok_out(&format!("{}\n", lines.join("\n")));
    }
    if show_xref {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let mut lines = vec![
            "1/0: uncompressed; offset = 15".to_string(),
            "2/0: uncompressed; offset = 64".to_string(),
        ];
        for p in 0..doc.pages.len() {
            let obj_id = 3 + p * 2;
            lines.push(format!("{obj_id}/0: uncompressed; offset = {}", 120 + p * 120));
            lines.push(format!("{}/0: uncompressed; offset = {}", obj_id + 1, 180 + p * 120));
        }
        return ok_out(&format!("{}\n", lines.join("\n")));
    }
    if show_pages {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let mut lines = Vec::new();
        for (p, pg) in doc.pages.iter().enumerate() {
            let content_obj = 4 + p * 4;
            let page_obj = 5 + p * 4;
            lines.push(format!("page {}: {page_obj} 0 R", p + 1));
            if with_images {
                lines.push("  images:".to_string());
                for (im_idx, (w, h, _)) in pg.images.iter().enumerate() {
                    let im_obj = 8 + p * 4 + im_idx;
                    lines.push(format!("    /Im{}: {im_obj} 0 R ({w} x {h})", im_idx + 1));
                }
            }
            lines.push("  content:".to_string());
            lines.push(format!("    {content_obj} 0 R"));
        }
        return ok_out(&format!("{}\n", lines.join("\n")));
    }
    if let Some(ref obj_spec) = show_object {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let obj_num: usize = obj_spec
            .split([',', ' '])
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if obj_num == 1 {
            return ok_out("<< /Type /Catalog /Pages 2 0 R >>\n");
        }
        if obj_num == 2 {
            let kids: Vec<String> = (0..doc.pages.len())
                .map(|p| format!("{} 0 R", 5 + p * 4))
                .collect();
            return ok_out(&format!("<< /Type /Pages /Count {} /Kids [ {} ] >>\n", doc.pages.len(), kids.join(" ")));
        }
        if obj_num == 3 {
            return ok_out(&format!("<< /Producer (@poe-code/pdf-ast) /Title ({}) /Creator (wkhtmltopdf (pdf-ast-static)) >>\n", doc.title));
        }
        if obj_num >= 4 {
            let rem = obj_num - 4;
            let page_idx = rem / 4;
            let slot = rem % 4;
            if let Some(pg) = doc.pages.get(page_idx) {
                if slot == 0 {
                    let stream_str = format!("BT /F1 12 Tf 72 720 Td ({}) Tj ET\n", pg.text);
                    if raw_stream_data || filtered_stream_data {
                        return ok_out(&stream_str);
                    }
                    return ok_out(&format!("<< /Filter /FlateDecode /Length {} >>\n", stream_str.len()));
                } else if slot == 1 {
                    let (pw, ph) = doc
                        .page_media
                        .get(&(page_idx + 1))
                        .map(|(w, h, _)| (*w, *h))
                        .unwrap_or((doc.page_w, doc.page_h));
                    return ok_out(&format!(
                        "<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 {pw} {ph} ] /Rotate {} /Contents {} 0 R >>\n",
                        pg.rot,
                        obj_num - 1
                    ));
                }
            }
        }
        return ok_out("null\n");
    }
    if list_att || show_att.is_some() {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let bytes = if f == "-" { crate::vfs::stream_string_to_bytes(stdin) }
            else { match fs.read_file(&resolve_posix_path(cwd,f)) {
                Ok(b) => b, Err(_) => return err_out(&format!("qpdf: cannot open {f}\n"),2),
            }};
        let show = show_att.as_deref();
        if pdf_reader::header_version(&bytes).is_none() { return err_out(&format!("qpdf: {f}: Invalid PDF header: missing %PDF- signature\n"), 2); }
        let doc = PdfDoc::parse(&bytes);
        let mut out = String::new();
        for (k, fname, _, data) in doc.attachments {
            if let Some(key) = show {
                if k == key || fname == key { return ok_out(&crate::vfs::bytes_to_stream_string(&data)); }
            } else { out.push_str(&format!("{k} -> {fname}\n")); }
        }
        if show.is_none() { return ok_out(&out); }
        return err_out(&format!("qpdf: attachment {} not found\n", show.unwrap()), 2);
    }
    if let Some(jv) = json_version {
        let out_file = if !empty_input && pos_files.len() >= 2 {
            Some(pos_files[1].clone())
        } else if empty_input && !pos_files.is_empty() {
            Some(pos_files[0].clone())
        } else {
            None
        };
        let input=match primary(){Some(bytes)=>bytes,None=>return if let Some(name)=&primary_arg{err_out(&format!("qpdf: cannot open {name}\n"),2)}else{err_out("qpdf: an input file is required\n",2)}};
        if pdf_reader::header_version(&input).is_none() {
            return err_out(&format!("qpdf: {}: Invalid PDF header: missing %PDF- signature\n",primary_arg.as_deref().unwrap_or("empty")),2);
        }
        let source = pdf_reader::PageSource::open(&input,password.as_deref().unwrap_or(""));
        if let Err(e) = source && !is_legacy_pdf(&input) {
            return err_out(&format!("qpdf: {}: {e}\n",primary_arg.as_deref().unwrap_or("empty")),2);
        }
        for k in &json_keys {
            if jv == 1 && k == "qpdf" {return err_out("qpdf: json-key=qpdf is not valid for json=1\n",2);}
            if jv == 2 && matches!(k.as_str(),"objects"|"objectinfo") {
                return err_out(&format!("qpdf: json-key={k} is only valid for json=1\n"),2);
            }
        }
        let stream_prefix = json_stream_prefix.or_else(|| out_file.as_ref().filter(|of| *of != "-").map(|of| format!("{of}-"))).unwrap_or_default();
        if json_stream_data == "file" && stream_prefix.is_empty() {
            return err_out("qpdf: --json-stream-data=file requires --json-stream-prefix or an output file\n",2);
        }
        if let Ok(mut source) = source {
            let (json,files) = match source.qpdf_json(jv,edits.inline_images,json_keys.iter().any(|k| k == "pages"),
                &json_objects,&json_stream_data,(&stream_prefix,out_file.as_deref()),fs.shell_limits().max_output_bytes) {
                Ok(result) => result,
                Err(e) => return err_out(e,1),
            };
            let destination = out_file.as_deref().filter(|of| *of != "-");
            let mut published = false;
            for (name,data) in files {
                let bytes = if destination == Some(&name) {
                    published = true;
                    json.as_bytes()
                } else { &data };
                if let Err(e) = publish(&name,bytes) { return e; }
            }
            if let Some(of) = destination {
                if !published && let Err(e) = publish(of,json.as_bytes()) { return e; }
                return ok_out("");
            }
            return ok_out(&json);
        }
        let doc = PdfDoc::parse(&input);
        let esc_json = |s: &str| -> String {
            let mut out = String::new();
            for ch in s.chars() {
                match ch {
                    '"' => out.push_str("\\\""),
                    '\\' => out.push_str("\\\\"),
                    '\n' => out.push_str("\\n"),
                    '\r' => out.push_str("\\r"),
                    '\t' => out.push_str("\\t"),
                    c => out.push(c),
                }
            }
            out
        };
        let include_obj = |id: usize| -> bool {
            if json_objects.is_empty() {
                return true;
            }
            json_objects.contains(&Some((id,0)))
        };
        let keep_objs = json_keys.is_empty() || json_keys.iter().any(|k| k == "objects" || k == "qpdf");
        let mut obj_entries: Vec<String> = Vec::new();
        if keep_objs {
            if include_obj(1) {
                obj_entries.push("      \"obj:1 0 R\": {\n        \"value\": {\n          \"/Type\": \"/Catalog\",\n          \"/Pages\": \"2 0 R\"\n        }\n      }".to_string());
            }
            if include_obj(2) {
                let kids: Vec<String> = (0..doc.pages.len()).map(|p| format!("\"{} 0 R\"", 5 + p * 4)).collect();
                obj_entries.push(format!(
                    "      \"obj:2 0 R\": {{\n        \"value\": {{\n          \"/Type\": \"/Pages\",\n          \"/Count\": {},\n          \"/Kids\": [ {} ]\n        }}\n      }}",
                    doc.pages.len(),
                    kids.join(", ")
                ));
            }
            if include_obj(3) {
                obj_entries.push(format!(
                    "      \"obj:3 0 R\": {{\n        \"value\": {{\n          \"/Producer\": \"u:@poe-code/pdf-ast\",\n          \"/Title\": \"u:{}\"\n        }}\n      }}",
                    esc_json(&doc.title)
                ));
            }
            for (p, pg) in doc.pages.iter().enumerate() {
                let content_obj = 4 + p * 4;
                let page_obj = 5 + p * 4;
                let (pw, ph) = doc
                    .page_media
                    .get(&(p + 1))
                    .map(|(w, h, _)| (*w, *h))
                    .unwrap_or((doc.page_w, doc.page_h));
                if include_obj(content_obj) {
                    let raw_str = pg.text.clone();
                    let mut stream_fields = vec![format!("          \"dict\": {{ \"/Filter\": \"/FlateDecode\", \"/Length\": {} }}", raw_str.len())];
                    if json_stream_data == "inline" {
                        let b64 = base64_encode(raw_str.as_bytes());
                        stream_fields.push(format!("          \"data\": \"{b64}\""));
                    } else if json_stream_data == "file" {
                        let sf_rel = format!("{stream_prefix}{content_obj}");
                        if let Err(e) = publish(&sf_rel, raw_str.as_bytes()) { return e; }
                        stream_fields.push(format!("          \"datafile\": \"{}\"", esc_json(&sf_rel)));
                    }
                    obj_entries.push(format!(
                        "      \"obj:{content_obj} 0 R\": {{\n        \"stream\": {{\n{}\n        }}\n      }}",
                        stream_fields.join(",\n")
                    ));
                }
                if include_obj(page_obj) {
                    obj_entries.push(format!(
                        "      \"obj:{page_obj} 0 R\": {{\n        \"value\": {{\n          \"/Type\": \"/Page\",\n          \"/Parent\": \"2 0 R\",\n          \"/MediaBox\": [ 0, 0, {pw}, {ph} ],\n          \"/Rotate\": {},\n          \"/Contents\": \"{content_obj} 0 R\"\n        }}\n      }}",
                        pg.rot
                    ));
                }
            }
            obj_entries.push(format!(
                "      \"trailer\": {{\n        \"value\": {{\n          \"/Root\": \"1 0 R\",\n          \"/Info\": \"3 0 R\",\n          \"/Size\": {}\n        }}\n      }}",
                4 + doc.pages.len() * 4
            ));
        }
        let objs_block = if obj_entries.is_empty() {
            "    {}".to_string()
        } else {
            format!("    {{\n{}\n    }}", obj_entries.join(",\n"))
        };
        let max_obj = 3 + doc.pages.len() * 4;
        let rendered = format!(
            "{{\n  \"version\": {jv},\n  \"qpdf\": [\n    {{\n      \"jsonversion\": {jv},\n      \"pdfversion\": \"{}\",\n      \"maxobjectid\": {max_obj}\n    }},\n{objs_block}\n  ]\n}}\n",
            doc.version
        );
        if let Some(of) = out_file
            && of != "-"
        {
            if let Err(e) = publish(&of, rendered.as_bytes()) { return e; }
            return ok_out("");
        }
        return ok_out(&rendered);
    }

    let out_arg = pos_files.get(usize::from(!replace_input && !empty_input)).cloned();
    edits.password=password.as_deref().unwrap_or("");
    if let Some(dst_arg) = out_arg.as_deref() {
        let input = primary();
        if let Some(bytes) = input && pdf_reader::header_version(&bytes).is_some() && !is_legacy_pdf(&bytes) {
            let limit = fs.shell_limits().max_output_bytes;
            if !edits.layers.is_empty() {
                let mut remaining = fs.shell_limits().max_input_bytes;
                let mut seen = std::collections::BTreeSet::new();
                for name in primary_arg
                    .iter()
                    .map(String::as_str)
                    .chain(edits.selections.iter().map(|s| s.0.as_str()))
                    .chain(add_atts.iter().map(|a| a.path.as_str()))
                    .chain(copy_atts.iter().map(|a| a.path.as_str()))
                    .chain(edits.layers.iter().map(|l| l.path))
                {
                    if name == "." || !seen.insert(name) {
                        continue;
                    }
                    let size = if Some(name) == primary_arg.as_deref() {
                        bytes.len()
                    } else if name == "-" {
                        crate::vfs::stream_byte_len(stdin)
                    } else {
                        fs.stat(&resolve_posix_path(cwd, name)).map_or(0, |st| st.size)
                    };
                    let Some(left) = remaining.checked_sub(size) else {
                        return err_out("qpdf: input byte limit exceeded\n", 2);
                    };
                    remaining = left;
                }
            }
            let selected = if edits.selections.is_empty() { Some(bytes) } else {
                match pdf_reader::PageOutput::select(&bytes,primary_arg.as_deref(),base_is_input,&edits,collate_group,read,&fs.shell_limits()) {
                    Ok(bytes) => bytes,
                    Err(e) if e == "invalid page selection" => return err_out("shell: line 1: internal error\n",1),
                    Err(e) => return err_out(&format!("qpdf: {e}\n"),2)
                }
            };
            if let Some(bytes) = selected {
                if !replace_input && dst_arg != "-" && primary_arg.as_deref() == Some(dst_arg) {
                    return err_out("qpdf: output file may not be the same as the input file (use --replace-input)\n",2);
                }
                let rewrite = || pdf_reader::rewrite(&bytes,&edits,&remove_atts,&add_atts,&copy_atts,read,limit)
                    .map_err(|e| if matches!(e.as_str(), "invalid inline-image minimum size" | "invalid page rotation" | "invalid page label" | "invalid PDF resource stream" | "invalid layer source" | "invalid layer page range" | pdf_reader::attachments::INVALID_SOURCE) { err_out("shell: line 1: internal error\n",1) }
                        else if matches!(e.as_str(),pdf_reader::NO_CATALOG|pdf_reader::PASSWORD|pdf_reader::UNSUPPORTED) { err_out(&format!("qpdf: {}: {e}\n",primary_arg.as_deref().unwrap_or("empty")),2) }
                        else {err_out(&format!("qpdf: {e}\n"),2)});
                if let Some(group) = edits.split_pages {
                    let edited = edits.inline_images.is_some() || edits.prune_resources || edits.flatten_annotations.is_some() || edits.generate_appearances || !edits.label_specs.is_empty() || !edits.layers.is_empty() || edits.flatten_rotation || edits.info || edits.metadata || edits.structure || edits.acroform || edits.page_labels
                        || !remove_atts.is_empty() || !add_atts.is_empty() || !copy_atts.is_empty();
                    let graph;
                    let data = if edited {
                        graph = match rewrite() { Ok(v) => v, Err(e) => return e };
                        &graph
                    } else { &bytes };
                    let mut source = match pdf_reader::PageSource::open(data,edits.password) {
                        Ok(source)=>source,
                        Err(e)=>return err_out(&format!("qpdf: {}: {e}\n",primary_arg.as_deref().unwrap_or("empty")),2),
                    };
                    let count = source.len();
                    let Some(rotations) = pdf_reader::rotations(if edited { &[] } else { &edits.rotations }, count) else {
                        return err_out("shell: line 1: internal error\n",1);
                    };
                    let mut outputs = vec![];
                    let mut remaining = limit;
                    for start in (0..count).step_by(group) {
                        let end = start.saturating_add(group).min(count);
                        let Some(name) = format_qpdf_split_name(dst_arg,count,group,start+1,end) else {
                            return err_out("qpdf: filename width limit exceeded\n",2);
                        };
                        let Some(part) = pdf_reader::PageOutput::split(&mut source,start..end,&rotations,remaining) else {
                            return err_out("qpdf: could not copy pages within output limits\n",2);
                        };
                        remaining -= part.len();
                        outputs.push((name,part));
                    }
                    for (name,part) in outputs { if let Err(e) = publish(&name,&part) { return e; } }
                    return ok_out("");
                }
                let mut output = match rewrite() { Ok(v) => v, Err(e) => return e };
                if let Some((user,owner,mask)) = encryption && !edits.decrypt {
                    output = match pdf_reader::encrypt_document(&output,user,owner,mask,limit) {
                        Ok(v) => v, Err(e) => return err_out(&format!("qpdf: {e}\n"),2),
                    };
                }
                if dst_arg == "-" {return ok_out(&crate::vfs::bytes_to_stream_string(&output));}
                return publish(dst_arg, &output).map_or_else(|e| e, |()| ok_out(""));
            }
        }
    }

    if let Some(group_sz) = edits.split_pages {
        let Some(f) = primary_arg.as_deref() else {
            return err_out("qpdf: an input file is required\n", 2);
        };
        let doc = match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        };
        let Some(pat) = out_arg.as_deref() else { return err_out("qpdf: an output file is required\n",2); };
        if !replace_input && pat != "-" && pat == f {
            return err_out("qpdf: output file may not be the same as the input file (use --replace-input)\n",2);
        }
        let total = doc.pages.len();
        let mut start = 1usize;
        while start <= total {
            let end = start.saturating_add(group_sz - 1).min(total);
            let mut sub = PdfDoc::new();
            sub.version = doc.version.clone();
            sub.title = doc.title.clone();
            sub.author = doc.author.clone();
            sub.page_w = doc.page_w;
            sub.page_h = doc.page_h;
            sub.pages = doc.pages[(start - 1)..end].to_vec();
            let Some(fname) = format_qpdf_split_name(pat, total, group_sz, start, end) else { return err_out("qpdf: filename width limit exceeded\n", 2); };
            if let Err(e) = publish(&fname, &sub.serialize()) { return e; }
            start = end + 1;
        }
        return ok_out("");
    }

    let mut doc = if empty_input {
        PdfDoc::new()
    } else if let Some(f) = primary_arg.as_deref() {
        match load_input(f) {
            Ok(d) => d,
            Err(e) => return e,
        }
    } else {
        return err_out("qpdf: an input file is required\n", 2);
    };
    let Some(dst_arg) = out_arg else {
        return err_out("qpdf: an output file is required\n", 2);
    };
    if !replace_input
        && !empty_input
        && dst_arg != "-"
        && primary_arg.as_deref() == Some(dst_arg.as_str())
    {
        return err_out(
            "qpdf: output file may not be the same as the input file (use --replace-input)\n",
            2,
        );
    }

    if let Some(ref enc_pw) = doc.encrypted {
        let supplied = password.as_deref().unwrap_or("");
        if !enc_pw.is_empty() && supplied != enc_pw {
            let f = primary_arg.as_deref().unwrap_or("input");
            return err_out(&format!("qpdf: {f}: invalid password\n"), 2);
        }
    }

    if !edits.selections.is_empty() {
        let mut groups: Vec<Vec<PdfPage>> = Vec::new();
        for (sf, rng, _) in &edits.selections {
            let sdoc = if sf == "." {
                doc.clone()
            } else {
                match load_input(sf) {
                    Ok(d) => d,
                    Err(e) => return e,
                }
            };
            if doc.title.is_empty() && !sdoc.title.is_empty() {
                doc.title = sdoc.title.clone();
            }
            let mut group_pages = Vec::new();
            for pno in parse_qpdf_page_spec(rng, sdoc.pages.len()) {
                if let Some(pg) = sdoc.pages.get(pno - 1) {
                    group_pages.push(pg.clone());
                }
            }
            groups.push(group_pages);
        }
        let mut new_pages = Vec::new();
        if let Some(cg) = collate_group {
            let mut offsets = vec![0usize; groups.len()];
            loop {
                let mut any = false;
                for (gi, g) in groups.iter().enumerate() {
                    let start = offsets[gi];
                    if start < g.len() {
                        any = true;
                        let end = (start + cg).min(g.len());
                        new_pages.extend_from_slice(&g[start..end]);
                        offsets[gi] = end;
                    }
                }
                if !any {
                    break;
                }
            }
        } else {
            for g in groups {
                new_pages.extend(g);
            }
        }
        doc.pages = new_pages;
    }

    let Some(rotations) = pdf_reader::rotations(&edits.rotations, doc.pages.len()) else {
        return err_out("shell: line 1: internal error\n",1);
    };
    for (pg, edit) in doc.pages.iter_mut().zip(rotations) {
        if let Some(rotation) = edit { pg.rot = rotation.apply(f64::from(pg.rot)); }
    }

    if edits.flatten_rotation {
        for (idx, pg) in doc.pages.iter_mut().enumerate() {
            if pg.rot == 90 || pg.rot == 270 {
                let pno = idx + 1;
                let (w, h, crop) = doc
                    .page_media
                    .get(&pno)
                    .copied()
                    .unwrap_or((doc.page_w, doc.page_h, None));
                doc.page_media.insert(pno, (h, w, crop));
            }
            pg.rot = 0;
        }
    }

    for spec in &edits.layers {
        let odoc = if spec.path == "." {
            doc.clone()
        } else {
            match load_input(spec.path) {
                Ok(d) => d,
                Err(e) => return e,
            }
        };
        let to_pages = parse_qpdf_page_spec(spec.to, doc.pages.len());
        let from_pages = parse_qpdf_page_spec(spec.from, odoc.pages.len());
        let rep_pages = if spec.repeat.is_empty() {
            Vec::new()
        } else {
            parse_qpdf_page_spec(spec.repeat, from_pages.len())
        };
        if !from_pages.is_empty() {
            for (idx, dst_pno) in to_pages.into_iter().enumerate() {
                let src_pno = if idx < from_pages.len() {
                    from_pages[idx]
                } else if !rep_pages.is_empty() {
                    let r_idx = (idx - from_pages.len()) % rep_pages.len();
                    from_pages[rep_pages[r_idx] - 1]
                } else {
                    *from_pages.last().unwrap()
                };
                if let Some(src_pg) = odoc.pages.get(src_pno - 1)
                    && let Some(dst_pg) = doc.pages.get_mut(dst_pno - 1)
                {
                    if spec.overlay {
                        dst_pg.text = format!("{}\n{}", dst_pg.text, src_pg.text);
                    } else {
                        dst_pg.text = format!("{}\n{}", src_pg.text, dst_pg.text);
                    }
                }
            }
        }
    }

    for key in &remove_atts {
        doc.attachments.retain(|(k, fname, _, _)| k != key && fname != key);
    }
    for pdf_reader::attachments::AddAttachment {path:att_p,key,filename:fname,replace,..} in add_atts {
        let afull = resolve_posix_path(cwd, &att_p);
        let Ok(ab) = fs.read_file(&afull) else {
            return err_out(&format!("qpdf: {att_p}: No such file or directory\n"), 2);
        };
        if let Some(pos) = doc.attachments.iter().position(|(k, _, _, _)| k == &key) {
            if !replace {
                return err_out(&format!("qpdf: attachment key {key} already exists (use --replace)\n"), 2);
            }
            doc.attachments.remove(pos);
        }
        doc.attachments.push((key, fname, String::new(), ab));
    }
    for source in copy_atts {
        let bytes = if source.path == "-" { Some(crate::vfs::stream_string_to_bytes(stdin)) }
            else { fs.read_file(&resolve_posix_path(cwd, &source.path)).ok() };
        let Some(bytes) = bytes else {
            return err_out(&format!("qpdf: cannot open {}\n", source.path), 2);
        };
        if is_legacy_pdf(&bytes) {
            let src = PdfDoc::parse(&bytes);
            if src.encrypted.as_ref().is_some_and(|pw| pw != &source.password) {
                return err_out("shell: line 1: internal error\n",1);
            }
            for (k, fname, mime, data) in src.attachments {
                let key = format!("{}{k}", source.prefix);
                doc.attachments.retain(|(ek, _, _, _)| ek != &key);
                doc.attachments.push((key, fname, mime, data));
            }
        } else if let Err(e) = source.visit(&bytes, |key, filename, data| {
            if doc.attachments.iter().any(|(k,_,_,_)| k == &key) {
                return Err(format!("duplicate attachment key {key}"));
            }
            doc.attachments.push((key, filename, String::new(), data.to_vec()));
            Ok(())
        }) {
            return if e == pdf_reader::attachments::INVALID_SOURCE {err_out("shell: line 1: internal error\n",1)}
                else {err_out(&format!("qpdf: {e}\n"),2)};
        }
    }

    if edits.page_labels {
        doc.page_labels.clear();
    }
    if !edits.label_specs.is_empty() {
        doc.page_labels.clear();
        for spec in &edits.label_specs {
            if let Some((pno_s, rest)) = spec.split_once(':') {
                let pno = pno_s.parse::<usize>().unwrap_or(1).to_string();
                let mut style_code = "D";
                let mut start_num = "1".to_string();
                let mut prefix = String::new();
                let parts: Vec<&str> = rest.split('/').collect();
                if let Some(first) = parts.first()
                    && matches!(*first, "D" | "r" | "R" | "a" | "A" | "n" | "none")
                {
                    style_code = first;
                }
                for (t_idx, token) in parts.iter().enumerate().skip(1) {
                    if let Some(st) = token.strip_prefix("st=") {
                        start_num = st.to_string();
                    } else if let Some(pr) = token.strip_prefix("pr=") {
                        prefix = pr.to_string();
                    } else if t_idx == 1 && token.chars().all(|c| c.is_ascii_digit()) && !token.is_empty() {
                        start_num = token.to_string();
                    } else if !token.is_empty() {
                        prefix = token.to_string();
                    }
                }
                let pdftk_style = match style_code {
                    "D" => "DecimalArabicNumerals",
                    "R" => "UppercaseRomanNumerals",
                    "r" => "LowercaseRomanNumerals",
                    "A" => "UppercaseLetters",
                    "a" => "LowercaseLetters",
                    _ => "NoNumber",
                };
                doc.page_labels.push((pno, start_num, prefix, pdftk_style.to_string()));
            }
        }
    }

    if edits.info {
        doc.title.clear();
        doc.author.clear();
        doc.info.clear();
    }
    if edits.metadata {
        doc.exif.clear();
    }
    if encryption.is_some() && !edits.decrypt {
        return err_out("qpdf: cannot encrypt a nonstandard PDF output\n",2);
    }
    if edits.decrypt {
        doc.encrypted = None;
    }
    if edits.linearize {
        doc.linearized = true;
    }
    let serialized = doc.serialize();
    if dst_arg == "-" {
        ok_out(&crate::vfs::bytes_to_stream_string(&serialized))
    } else {
        publish(&dst_arg, &serialized).map_or_else(|e| e, |()| ok_out(""))
    }
}

fn cmd_pdftk(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h" || a == "-help") {
        return ok_out("Usage: pdftk <input PDF files | [handle]=filename ...> [<operation> <operation arguments>] [output <output filename>] [flatten]\n");
    }
    if args.iter().any(|a| a == "--version" || a == "-v" || a == "-version") {
        return ok_out("pdftk port to Java 3.3.3 (safe-bash @poe-code/pdf-ast)\n");
    }
    let ops = [
        "cat",
        "shuffle",
        "burst",
        "dump_data",
        "dump_data_utf8",
        "dump_data_fields",
        "dump_data_fields_utf8",
        "dump_data_annots",
        "dump_data_annots_utf8",
        "update_info",
        "update_info_utf8",
        "attach_files",
        "unpack_files",
        "background",
        "multibackground",
        "stamp",
        "multistamp",
        "fill_form",
        "generate_fdf",
        "flatten",
        "rotate",
    ];
    let mut handles: BTreeMap<String, PdfDoc> = BTreeMap::new();
    let mut inputs = BTreeMap::new();
    let mut input_order = Vec::new();
    let mut source_sizes=BTreeMap::new();
    let mut auto = 65;
    let mut passwords = BTreeMap::new();
    let mut default_password = "";
    let operation=|s:&str| ops.iter().copied().find(|name|s.eq_ignore_ascii_case(name));
    let keyword=|s:&str| operation(s).is_some() || s.eq_ignore_ascii_case("input_pw") || s.eq_ignore_ascii_case("output");
    for pos in args.iter().enumerate().filter_map(|(i,x)|x.eq_ignore_ascii_case("input_pw").then_some(i)) {
        for arg in args[pos+1..].iter().take_while(|x| !keyword(x)) {
            if let Some((handle,pw)) = arg.split_once('=') { passwords.insert(handle,pw); }
            else {default_password = arg;}
        }
    }
    let mut op = String::new();
    let mut op_idx = args.len();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if let Some(name)=operation(a) {
            op = name.to_owned();
            op_idx = i;
            break;
        }
        if a.eq_ignore_ascii_case("output") {
            op = "passthrough".to_string();
            op_idx = i;
            break;
        }
        if a.eq_ignore_ascii_case("input_pw") {
            i += 1;
            while i < args.len() && !keyword(&args[i]) {
                i += 1;
            }
            continue;
        }
        let (handle,path) = match a.split_once('=') {
            Some((h,path)) if !h.is_empty() => (h.to_owned(),path),
            _ => {
                let h = char::from_u32(auto).unwrap_or('?').to_string();
                auto += 1;
                (h,a)
            }
        };
        let bytes = if path == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let Ok(b) = fs.read_file(&resolve_posix_path(cwd,path)) else {
                return err_out(&format!("Error: Unable to find file '{path}'\n"),1);
            };
            b
        };
        if !bytes.starts_with(b"%PDF-") {
            return err_out(&format!("Error: Failed to open PDF '{path}': Invalid PDF header: missing %PDF- signature\n"),1);
        }
        let pw = passwords.get(handle.as_str()).copied().unwrap_or(default_password);
        let doc = match pdf_reader::read(&bytes,pw) {
            Ok((doc,_)) => doc,
            Err(e @ (pdf_reader::PASSWORD | pdf_reader::UNSUPPORTED)) => return err_out(&format!("Error: Failed to open PDF '{path}': {e}\n"),1),
            Err(_) => PdfDoc::parse(&bytes),
        };
        handles.insert(handle.clone(),doc);
        source_sizes.insert(path,bytes.len());
        inputs.insert(handle.clone(),(bytes,pw));
        input_order.push(handle);
        i += 1;
    }
    if input_order.is_empty() {
        return err_out("Error: No input PDF files specified.\n", 1);
    }
    if op.is_empty() {
        op = "cat".to_string();
    }

    let format_dump = |doc: &PdfDoc, utf8: bool| -> String {
        let mut out = String::new();
        let fields = doc.info.iter().map(|(k, v)| (k.as_str(), v.as_str()));
        let standard = ["Title", "Author", "Subject", "Keywords", "Creator", "Producer"];
        let mut emitted = std::collections::BTreeSet::new();
        for (k, v) in standard.into_iter().filter_map(|key| {
            match key {
                "Title" if !doc.title.is_empty() => Some((key, doc.title.as_str())),
                "Author" if !doc.author.is_empty() => Some((key, doc.author.as_str())),
                _ => fields.clone().find(|(k, _)| *k == key),
            }
        }).chain(fields.clone()) {
            if !v.is_empty() && emitted.insert(k) {
                out.push_str(&format!(
                    "InfoBegin\nInfoKey: {}\nInfoValue: {}\n",
                    encode_pdftk_text(k, utf8), encode_pdftk_text(v, utf8)
                ));
            }
        }
        out.push_str(&format!("PdfID0: {}\n", doc.pdf_id0));
        out.push_str(&format!("PdfID1: {}\n", doc.pdf_id1));
        out.push_str(&format!("NumberOfPages: {}\n", doc.pages.len()));
        for (t, l, p) in &doc.bookmarks {
            out.push_str(&format!(
                "BookmarkBegin\nBookmarkTitle: {}\nBookmarkLevel: {l}\nBookmarkPageNumber: {p}\n",
                encode_pdftk_text(t, utf8)
            ));
        }
        for (idx, pg) in doc.pages.iter().enumerate() {
            let pno = idx + 1;
            let (pw, ph, crop_opt) = doc
                .page_media
                .get(&pno)
                .copied()
                .unwrap_or((doc.page_w, doc.page_h, None));
            let [x0,y0,x1,y1]=doc.direct_media.get(&pno).copied().unwrap_or([0.,0.,pw.abs(),ph.abs()]);
            out.push_str(&format!(
                "PageMediaBegin\nPageMediaNumber: {pno}\nPageMediaRotation: {}\nPageMediaRect: {x0} {y0} {x1} {y1}\nPageMediaDimensions: {aw} {ah}\n",
                pg.rot, aw=pw.abs(),ah=ph.abs()
            ));
            if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
                out.push_str(&format!(
                    "PageMediaCropBox: {cx0} {cy0} {cx1} {cy1}\nPageMediaCropRect: {cx0} {cy0} {cx1} {cy1}\n"
                ));
            }
        }
        for (ni, st, pf, sy) in &doc.page_labels {
            out.push_str(&format!("PageLabelBegin\nPageLabelNewIndex: {ni}\nPageLabelStart: {st}\n"));
            if !pf.is_empty() {
                out.push_str(&format!("PageLabelPrefix: {}\n", encode_pdftk_text(pf, utf8)));
            }
            out.push_str(&format!("PageLabelNumStyle: {sy}\n"));
        }
        out
    };

    let (mut user,mut owner) = (None,None);
    let mut grants = 0;
    let mut keep_final_id=false;
    let mut replacement_font=None;
    let mut flatten=false;
    let mut compress_streams=None;
    let (mut drop_xfa,mut drop_xmp,mut need_appearances)=(false,false,false);
    let mut operands=Vec::new();
    let mut tail=args.get(op_idx+1..).unwrap_or_default().iter().peekable();
    let mut output=if op=="passthrough" {tail.next().map(String::as_str)} else {None};
    while let Some(arg) = tail.next() {
        match arg.to_ascii_lowercase().as_str() {
            "output" => output=tail.next().map(String::as_str),
            "keep_first_id" => (),
            "keep_final_id" => keep_final_id=true,
            "flatten" => flatten=true,
            "replacement_font" => replacement_font=tail.next().map(String::as_str).filter(|s|!s.is_empty()),
            "drop_xfa" => drop_xfa=true,
            "drop_xmp" => drop_xmp=true,
            "need_appearances" => need_appearances=true,
            "compress"|"uncompress" if matches!(op.as_str(),"burst"|"flatten"|"fill_form"|"update_info"|"update_info_utf8"|"passthrough"|"rotate"|"attach_files"|"cat"|"shuffle"|"stamp"|"multistamp"|"background"|"multibackground")=>{
                compress_streams=Some(compress_streams.unwrap_or(true) && arg.eq_ignore_ascii_case("compress"));
            }
            "user_pw" => user = tail.next().map(String::as_str),
            "owner_pw" => owner = tail.next().map(String::as_str),
            "allow" => while let Some(grant) = tail.peek() {
                grants |= match grant.to_ascii_lowercase().as_str() {
                    "printing" => 4|2048, "degradedprinting" => 4, "copycontents" => 16,
                    "modifycontents" => 8|1024, "assembly" => 1024,
                    "modifyannotations" => 32|256, "fillin" => 256, "screenreaders" => 512,
                    "allfeatures" => 4|8|16|32|256|512|1024|2048, _ => break,
                };
                tail.next();
            },
            "encrypt_128bit" | "encrypt_40bit" | "dont_ask" | "do_ask" | "verbose" => (),
            _ => operands.push(arg.clone()),
        }
    }

    let limit = fs.shell_limits().max_output_bytes;
    let primary_handle=&input_order[0];
    let id_handle=if keep_final_id {input_order.last().unwrap_or(primary_handle)} else {primary_handle};
    // An edit of the primary PDF already carries its (possibly updated) ID.
    // Assembly creates a new trailer, so copy the chosen input ID explicitly.
    let trailer_id=if id_handle!=primary_handle || matches!(op.as_str(),"cat"|"shuffle") {
        handles[id_handle].trailer_id.as_deref()
    } else {None};
    let flatten_forms=op=="flatten" || flatten && matches!(op.as_str(),"burst"|"passthrough"|"fill_form"|"cat"|"shuffle"|"stamp"|"multistamp"|"background"|"multibackground");
    let need_appearances=need_appearances && !flatten;
    let output_edits=pdf_reader::PageEdits {flatten_forms,trailer_id,compress_streams,drop_xfa,metadata:drop_xmp,need_appearances,..Default::default()};
    let write_pdftk_output = |mut bytes: Vec<u8>| -> BuiltinOutcome {
        let of=output.filter(|s|!s.is_empty()).unwrap_or("-");
        if user.is_some_and(|s|!s.is_empty()) || owner.is_some_and(|s|!s.is_empty()) {
            if is_legacy_pdf(&bytes) {
                return err_out("Error: Cannot encrypt a nonstandard PDF output\n",1);
            }
            let mask = !0xfff | 192 | if grants==0 {4|32|256|512|2048} else {grants};
            bytes = match pdf_reader::encrypt_document(&bytes,user.unwrap_or(""),owner.or(user).unwrap_or("owner"),mask,limit) {
                Ok(bytes) => bytes,
                Err(e) => return err_out(&format!("Error: {e}\n"),1),
            };
        }
        if of == "-" {ok_out(&crate::vfs::bytes_to_stream_string(&bytes))}
        else {write_copied_pdf(fs,cwd,of,&bytes,1)}
    };

    let primary = handles[&input_order[0]].clone();
    match op.as_str() {
        "fill_form" => {
            let path=operands.first().map_or("-",String::as_str);
            let data=if path=="-"{crate::vfs::stream_string_to_bytes(stdin)}else{
                let Ok(b)=fs.read_file(&resolve_posix_path(cwd,path))else{return err_out(&format!("Error: Unable to open form data file '{path}'\n"),1)};
                b
            };
            source_sizes.insert(path,data.len());
            if source_sizes.values().try_fold(fs.max_input_bytes(),|n,&size|n.checked_sub(size)).is_none(){
                return err_out("pdftk: input byte limit exceeded\n",1);
            }
            let (bytes,password)=&inputs[primary_handle];
            let edits=pdf_reader::PageEdits{form_data:Some(&data),replacement_font,password,..output_edits};
            match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],|_|None,limit){
                Ok(bytes)=>write_pdftk_output(bytes),Err(e)=>err_out(&format!("Error: {e}\n"),1)
            }
        }
        "passthrough" | "flatten" => {
            let (bytes,password) = &inputs[&input_order[0]];
            let bytes = if !is_legacy_pdf(bytes) {
                let edits = pdf_reader::PageEdits {password,..output_edits};
                match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],|_|None,limit) {
                    Ok(bytes)=>bytes, Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                }
            } else {primary.serialize()};
            write_pdftk_output(bytes)
        }
        "dump_data" | "dump_data_utf8" | "dump_data_fields" | "dump_data_fields_utf8" | "generate_fdf" | "dump_data_annots" | "dump_data_annots_utf8" => {
            let utf8 = op.ends_with("_utf8");
            let report = if op.starts_with("dump_data_fields") || op=="generate_fdf" {
                let (bytes,password)=&inputs[&input_order[0]];
                match pdf_reader::field_report(bytes,password,&op,limit){
                    Ok(v)=>v,Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                }
            } else if op.starts_with("dump_data_annots") {
                let mut report=format!("PdfID0: {}\nPdfID1: {}\nNumberOfPages: {}\n",primary.pdf_id0,primary.pdf_id1,primary.pages.len());
                let (bytes,password)=&inputs[&input_order[0]];
                if !is_legacy_pdf(bytes) && let Err(e)=pdf_reader::PageSource::open(bytes,password).and_then(|mut s|s.annotation_report(utf8,limit,&mut report)){return err_out(&format!("Error: {e}\n"),1);}
                report
            } else {format_dump(&primary,utf8)};
            if let Some(path)=output.filter(|s|!s.is_empty() && *s!="-") {
                write_copied_pdf(fs,cwd,path,report.as_bytes(),1)
            }else{ok_out(&report)}
        }
        "update_info" | "update_info_utf8" => {
            let info_src=operands.first().map_or("-",String::as_str);
            let txt = if info_src == "-" {
                stdin.to_string()
            } else {
                let info_full = resolve_posix_path(cwd, info_src);
                if fs.is_dir(&info_full) {
                    return err_out(&format!("Error: Unable to open info file '{info_src}'\n"), 1);
                }
                let Ok(ib) = fs.read_file(&info_full) else {
                    return err_out(&format!("Error: Unable to open info file '{info_src}'\n"), 1);
                };
                String::from_utf8_lossy(&ib).to_string()
            };
            let update=pdf_reader::Updates::parse(&txt);
            let (bytes,password)=&inputs[&input_order[0]];
            let out=if is_legacy_pdf(bytes) {
                let mut doc=primary;
                update.apply_legacy(&mut doc);
                doc.serialize()
            } else {
                let edits=pdf_reader::PageEdits {password,update:Some(&update),..output_edits};
                match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],|_|None,limit) {
                    Ok(bytes)=>bytes,
                    Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                }
            };
            write_pdftk_output(out)
        }
        "burst" => {
            let pat=output.unwrap_or("pg_%04d.pdf");
            let pat_full=resolve_posix_path(cwd,pat);
            let burst_dir = pat_full
                .rsplit_once('/')
                .map(|(d, _)| if d.is_empty() { "/" } else { d })
                .unwrap_or(cwd);
            let _ = fs.mkdir_all(burst_dir);
            let doc_data_p = format!("{}/doc_data.txt", burst_dir.trim_end_matches('/'));
            let (bytes,password) = &inputs[&input_order[0]];
            let mut source = if is_legacy_pdf(bytes) {None} else {
                match pdf_reader::PageSource::open(bytes,password) {
                    Ok(source) => Some(source), Err(e) => return err_out(&format!("Error: {e}\n"),1),
                }
            };
            let count = primary.pages.len();
            let start = if filename_number_spec(pat).is_none() {count.saturating_sub(1)} else {0};
            for idx in start..count {
                let Some(name) = format_printf_num(pat,idx+1,None) else { return err_out("pdftk: filename width limit exceeded\n",1); };
                if name == "-" || resolve_posix_path(cwd,&name)==doc_data_p {continue;}
                let bytes = if let Some(source) = &mut source {
                    let mut page = pdf_reader::PageOutput::new(limit);
                    let Some(bytes) = page.append(source,Some(idx)).and_then(|()|page.finish()) else {
                        return err_out("Error: Could not copy PDF page\n",1);
                    };
                    if flatten_forms || compress_streams.is_some(){
                        let edits=pdf_reader::PageEdits{flatten_forms,compress_streams,..Default::default()};
                        match pdf_reader::rewrite(&bytes,&edits,&[],&[],&[],|_|None,limit){
                            Ok(v)=>v,Err(e)=>return err_out(&format!("Error: {e}\n"),1)
                        }
                    }else{bytes}
                } else {
                    let mut single = PdfDoc::new();
                    single.version = primary.version.clone();
                    single.title = primary.title.clone();
                    single.author = primary.author.clone();
                    single.page_w = primary.page_w;
                    single.page_h = primary.page_h;
                    single.pages.push(primary.pages[idx].clone());
                    single.serialize()
                };
                let r = write_copied_pdf(fs,cwd,&name,&bytes,1);
                if r.exit_code!=0 {return r;}
            }
            write_copied_pdf(fs,cwd,&doc_data_p,format_dump(&primary,false).as_bytes(),1)
        }
        "attach_files" => {
            let mut operands=operands.iter();
            let mut paths=Vec::new();
            let mut page=None;
            while let Some(arg)=operands.next() {
                if arg.eq_ignore_ascii_case("to_page") {
                    page=operands.next().map(|s| {
                        if s.eq_ignore_ascii_case("end") {return usize::MAX;}
                        let s=s.trim_start().strip_prefix('+').unwrap_or(s.trim_start());
                        let digits=s.bytes().take_while(u8::is_ascii_digit).count();
                        if digits==0 {0} else {s[..digits].parse::<usize>().unwrap_or(usize::MAX).saturating_sub(1)}
                    });
                } else {paths.push(arg.clone());}
            }
            let read=|path:&str| if path=="-" {Some(crate::vfs::stream_string_to_bytes(stdin))} else {fs.read_file(&resolve_posix_path(cwd,path)).ok()};
            let (bytes,password)=&inputs[&input_order[0]];
            let out=if is_legacy_pdf(bytes) {
                let mut doc=primary;
                for path in paths {
                    if let Some(data)=read(&path) {
                        let name=path.rsplit('/').next().unwrap_or(&path).to_owned();
                        doc.attachments.push((name.clone(),name,String::new(),data));
                    }
                }
                doc.serialize()
            } else {
                let edits=pdf_reader::PageEdits { password, append_files:Some(&paths), attachment_page:page, ..output_edits };
                match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],read,limit) {
                    Ok(bytes)=>bytes,Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                }
            };
            write_pdftk_output(out)
        }
        "unpack_files" => {
            let directory=output.unwrap_or(".");
            let clean = directory.strip_suffix('/').unwrap_or(directory);
            let local = clean=="." || clean.is_empty();
            let out_dir = if local {cwd.to_owned()} else {resolve_posix_path(cwd,clean)};
            let (bytes,password) = &inputs[&input_order[0]];
            let files = if is_legacy_pdf(bytes) {
                let mut files = Vec::new();
                for (_,name,_,bytes) in primary.attachments {
                    let Some(leaf) = pdftk_attachment_leaf(&name) else {
                        return err_out("Error: Invalid embedded attachment filename\n",1);
                    };
                    files.push((leaf.to_owned(),bytes));
                }
                files
            } else {
                let Ok(mut source) = pdf_reader::PageSource::open(bytes,password) else {
                    return err_out("Error: Invalid attachment source\n",1);
                };
                let Some(files) = source.read_attachments(true) else {
                    return err_out("Error: Invalid embedded attachment\n",1);
                };
                files
            };
            let _ = fs.mkdir_all(&out_dir);
            for (name,bytes) in files {
                if name=="-" && local {continue;}
                let r = write_copied_pdf(fs,&out_dir,&name,&bytes,1);
                if r.exit_code!=0 {return r;}
            }
            ok_out("")
        }
        "stamp" | "multistamp" | "background" | "multibackground" => {
            let is_multi = op == "multistamp" || op == "multibackground";
            let is_stamp = op == "stamp" || op == "multistamp";
            let path=operands.first().map_or("-",String::as_str);
            let stamp=if path=="-" {crate::vfs::stream_string_to_bytes(stdin)} else {
                let Ok(bytes)=fs.read_file(&resolve_posix_path(cwd,path)) else {return err_out(&format!("Error: Unable to open '{path}'\n"),1);};
                bytes
            };
            if !stamp.windows(5).take(1024).any(|w|w==b"%PDF-") {return err_out("shell: line 1: internal error\n",1);}
            let (bytes,password)=&inputs[primary_handle];
            if !is_legacy_pdf(bytes) && !is_legacy_pdf(&stamp) {
                let edits=pdf_reader::PageEdits{password,stamp:Some((&stamp,is_multi,is_stamp)),..output_edits};
                return match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],|_|None,limit){
                    Ok(bytes)=>write_pdftk_output(bytes),
                    Err(e) if e=="PDF output byte limit exceeded"=>err_out(&format!("Error: {e}\n"),1),
                    Err(_)=>err_out("shell: line 1: internal error\n",1),
                };
            }
            let mut doc=primary;
            let sdoc=PdfDoc::parse(&stamp);
            if !sdoc.pages.is_empty() {
                for (p_idx, pg) in doc.pages.iter_mut().enumerate() {
                    let spg = if is_multi {
                        sdoc.pages.get(p_idx).unwrap_or_else(|| sdoc.pages.last().unwrap())
                    } else {
                        &sdoc.pages[0]
                    };
                    if is_stamp {
                        pg.text = format!("{}\n{}", pg.text, spg.text);
                    } else {
                        pg.text = format!("{}\n{}", spg.text, pg.text);
                    }
                }
            }
            write_pdftk_output(doc.serialize())
        }
        "cat" | "shuffle" | "rotate" => {
            let specs=&operands;
            let mut handle_keys: Vec<String> = handles.keys().cloned().collect();
            handle_keys.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));

            let eval_spec = |sp:&str| pdf_reader::pdftk_selection(sp,&handle_keys,&handles,&input_order[0]);
            if op=="rotate" {
                let mut rotations=vec![None;primary.pages.len()];
                for (_,n,r) in specs.iter().flat_map(|s|eval_spec(s)) {
                    if r.is_some() && let Some(slot)=rotations.get_mut(n-1){*slot=r;}
                }
                let (bytes,password)=&inputs[&input_order[0]];
                let out=if is_legacy_pdf(bytes) {
                    let mut doc=primary;
                    for (p,r) in doc.pages.iter_mut().zip(rotations){if let Some(r)=r{p.rot=r.apply(f64::from(p.rot));}}
                    doc.serialize()
                }else{
                    let edits=pdf_reader::PageEdits {password,page_rotations:&rotations,..output_edits};
                    match pdf_reader::rewrite(bytes,&edits,&[],&[],&[],|_|None,limit){
                        Ok(bytes)=>bytes, Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                    }
                };
                return write_pdftk_output(out);
            }
            let mut out_doc = PdfDoc::new();
            out_doc.version = primary.version.clone();
            out_doc.title = primary.title.clone();
            out_doc.author = primary.author.clone();
            out_doc.page_w = primary.page_w;
            out_doc.page_h = primary.page_h;
            out_doc.info = primary.info.clone();
            let mut chosen = Vec::new();
            if specs.is_empty() {
                for hk in &input_order {
                    let d = &handles[hk];
                    if out_doc.title.is_empty() {
                        out_doc.title = d.title.clone();
                    }
                    for pno in 1..=d.pages.len() {
                        chosen.push((hk.clone(), pno, None));
                    }
                }
            } else if op == "shuffle" {
                let lists: Vec<_> =
                    specs.iter().map(|s| eval_spec(s)).collect();
                let max_len = lists.iter().map(|l| l.len()).max().unwrap_or(0);
                for idx in 0..max_len {
                    for l in &lists {
                        if let Some(item) = l.get(idx) {
                            chosen.push(item.clone());
                        }
                    }
                }
            } else {
                for s in specs {
                    chosen.extend(eval_spec(s));
                }
            }
            if inputs.values().all(|(b,_)| !is_legacy_pdf(b))
            {
                let bytes = match pdf_reader::PageOutput::assemble_pdftk(&inputs,&input_order[0],&chosen,&handles,fs.shell_limits().max_output_bytes) {
                    Ok(bytes) => bytes,
                    Err(e) => return err_out(&format!("Error: {e}\n"),1),
                };
                let bytes=if flatten_forms || trailer_id.is_some() || drop_xfa || drop_xmp || need_appearances || compress_streams.is_some() {
                    match pdf_reader::rewrite(&bytes,&output_edits,&[],&[],&[],|_|None,limit) {
                        Ok(bytes)=>bytes,Err(e)=>return err_out(&format!("Error: {e}\n"),1),
                    }
                } else {bytes};
                return write_pdftk_output(bytes);
            }
            for (new_idx0, (hk, old_pno, rotation)) in chosen.iter().enumerate() {
                let new_pno = new_idx0 + 1;
                if let Some(src_doc) = handles.get(hk) {
                    if let Some(m) = src_doc.page_media.get(old_pno) {
                        out_doc.page_media.insert(new_pno, *m);
                    }
                    for (bt, bl, bp) in &src_doc.bookmarks {
                        if bp.parse::<usize>().ok() == Some(*old_pno) {
                            out_doc.bookmarks.push((bt.clone(), bl.clone(), new_pno.to_string()));
                        }
                    }
                    if let Some(mut pg) = src_doc.pages.get(old_pno - 1).cloned() {
                        if let Some(rot) = rotation { pg.rot = rot.apply(f64::from(pg.rot)); }
                        out_doc.pages.push(pg);
                    }
                }
            }
            write_pdftk_output(out_doc.serialize())
        }
        _ => ok_out(""),
    }
}

fn cmd_pdfdetach(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut list_mode = false;
    let mut save_all = false;
    let mut save_idx = 0.0;
    let mut save_file = "";
    let mut dest = "";
    let mut password = "";
    let mut pdf_file = None;
    let mut args = args.iter().map(String::as_str);
    while let Some(arg) = args.next() {
        match arg {
            "-v" | "--version" => return ok_out("pdfdetach version 24.08.0\n"),
            "-h" | "-help" | "--help" | "-?" => return ok_out("Usage: pdfdetach [options] <PDF-file>\n  -list / -save <int> / -savefile <name> / -saveall / -o <path>\n"),
            "-list" => list_mode = true,
            "-saveall" => save_all = true,
            "-save" => {
                let text = args.next().unwrap_or("").trim_start_matches(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}');
                let sign = usize::from(text.starts_with(['+', '-']));
                let digits = text[sign..].bytes().take_while(u8::is_ascii_digit).count();
                save_idx = text[..sign + digits].parse::<f64>().unwrap_or(0.0);
            }
            "-savefile" => save_file = args.next().unwrap_or(""),
            "-o" => dest = args.next().unwrap_or(""),
            "-upw" | "-opw" => password = args.next().unwrap_or(""),
            "-enc" => {
                let enc = args.next().unwrap_or("");
                if !matches!(enc, "UTF-8" | "Latin1" | "ASCII7" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                    return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                }
            }
            a if a == "-" || !a.starts_with('-') => { pdf_file.get_or_insert(a); }
            _ => {}
        }
    }
    let Some(f) = pdf_file.filter(|f| !f.is_empty()) else {
        return err_out("Usage: pdfdetach [options] <PDF-file>\n", 99);
    };
    if f == "-" && stdin.is_empty() { return err_out("I/O Error: Couldn't open file '-'\n", 1); }
    let b = if f == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let Ok(bytes) = fs.read_file(&resolve_posix_path(cwd,f)) else {
            return err_out(&format!("I/O Error: Couldn't open file '{f}'\n"), 1);
        };
        bytes
    };
    if !b.starts_with(b"%PDF-") {
        return err_out("PDF Error: Invalid PDF header: missing %PDF- signature\n", 1);
    }
    let source = pdf_reader::PageSource::open(&b,password);
    let attachments = if let Ok(mut source) = source {
        let Some(files) = source.read_attachments(false) else {
            return err_out("PDF Error: Invalid embedded file stream\n", 1);
        };
        files
    } else if let Err(e @ (pdf_reader::PASSWORD|pdf_reader::UNSUPPORTED)) = source {
        return err_out(&format!("PDF Error: {e}\n"), 1);
    } else {
        let doc = PdfDoc::parse(&b);
        if let Some(ref required) = doc.encrypted
            && !required.is_empty() && password != required {
            return err_out("PDF Error: Invalid PDF password\n", 1);
        }
        doc.attachments.into_iter().map(|(_,name,_,data)|(name,data)).collect()
    };
    if list_mode || (!save_all && save_idx == 0.0 && save_file.is_empty()) {
        let mut out = format!("{} embedded files\n", attachments.len());
        for (i, (name,_)) in attachments.iter().enumerate() {
            out.push_str(&format!("{}: {name}\n", i+1));
        }
        return ok_out(&out);
    }
    let directory = dest.ends_with('/') || !dest.is_empty() && fs.is_dir(&resolve_posix_path(cwd,dest));
    let mut outputs = Vec::new();
    for (i,(name,bytes)) in attachments.into_iter().enumerate() {
        let selected = if save_idx > 0.0 { (i + 1) as f64 == save_idx }
            else if !save_file.is_empty() { name == save_file } else { save_all };
        if !selected { continue; }
        let path = if !dest.is_empty() && !directory && (save_idx > 0.0 || !save_file.is_empty()) {
            dest.to_string()
        } else {
            let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
            if matches!(leaf, "" | "." | "..") || leaf.contains('\0') {
                return err_out("PDF Error: Invalid embedded attachment filename\n", 1);
            }
            if dest.is_empty() { leaf.into() } else { format!("{}/{leaf}",dest.trim_end_matches('/')) }
        };
        outputs.push((path,bytes));
    }
    if outputs.is_empty() {
        if save_idx > 0.0 { return err_out(&format!("Error: Invalid file index {}\n", mcp_protocol_rust::numbers::format(save_idx)),1); }
        if !save_file.is_empty() { return err_out(&format!("Error: Embedded file '{save_file}' not found\n"),1); }
    }
    for (path, bytes) in outputs {
        if !write_regular_output(fs,cwd,&path,&bytes) {
            return err_out(&format!("I/O Error: Error saving embedded file as '{path}'\n"), 2);
        }
    }
    ok_out("")
}

fn cmd_pdfinfo(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-v" || a == "--version") {
        return ok_out("pdfinfo version 26.09.90 (@poe-code/pdf-ast)\n");
    }
    if args
        .iter()
        .any(|a| matches!(a.as_str(), "-h" | "-help" | "--help" | "-?"))
    {
        return ok_out("Usage: pdfinfo [options] [PDF-file]\n  -f <int>       : first page to examine\n  -l <int>       : last page to examine\n  -box           : print the page bounding boxes\n  -meta          : print the document metadata (XML)\n  -custom        : print custom and standard metadata\n  -js            : print all JavaScript in the PDF\n  -struct        : print the logical document structure\n  -struct-text   : print logical structure and text\n  -isodates      : print the dates in ISO-8601 format\n  -rawdates      : print the undecoded date strings\n  -dests         : print all named destinations in the PDF\n  -url           : print all URLs in the PDF\n  -upw <string>  : user password\n  -opw <string>  : owner password\n");
    }
    if args.iter().any(|a| a == "-listenc") {
        return ok_out("Available encodings are:\nASCII7\nLatin1\nUTF-8\nUCS-2\nSymbol\nZapfDingbats\n");
    }
    let mut show_box = false;
    let mut show_url = false;
    let mut show_meta = false;
    let mut show_js = false;
    let mut show_struct = false;
    let mut show_struct_text = false;
    let mut show_dests = false;
    let mut show_custom = false;
    let mut date_mode = "normal";
    let mut first_p: Option<usize> = None;
    let mut last_p: Option<usize> = None;
    let mut pw_opt: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-box" => show_box = true,
            "-url" => show_url = true,
            "-meta" => show_meta = true,
            "-js" => show_js = true,
            "-struct" => show_struct = true,
            "-struct-text" => {
                show_struct = true;
                show_struct_text = true;
            }
            "-dests" => show_dests = true,
            "-custom" => show_custom = true,
            "-isodates" => date_mode = "iso",
            "-rawdates" => date_mode = "raw",
            "-f" => {
                let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                    return err_out("Invalid -f page number\n", 99);
                };
                first_p = Some(v);
                i += 1;
            }
            "-l" => {
                let Some(v) = args.get(i + 1).and_then(|s| s.parse::<usize>().ok()) else {
                    return err_out("Invalid -l page number\n", 99);
                };
                last_p = Some(v);
                i += 1;
            }
            "-upw" | "-opw" => {
                if let Some(v) = args.get(i + 1) {
                    pw_opt = Some(v.clone());
                    i += 1;
                }
            }
            "-enc" => {
                let enc = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                if !matches!(enc, "UTF-8" | "Latin1" | "ASCII7" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                    return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                }
                i += 1;
            }
            a if a == "-" || !a.starts_with('-') => files.push(a.to_string()),
            a => return err_out(&format!("Command Line Error: Unknown option '{a}'\n"), 99),
        }
        i += 1;
    }
    if files.len() > 1 {
        return err_out("Usage: pdfinfo [options] [PDF-file]\n", 99);
    }
    let target_file = files.first().map(|s| s.as_str()).unwrap_or("-");
    let b = if target_file == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, target_file);
        let Ok(bytes) = fs.read_file(&full) else {
            return err_out(
                &format!("I/O Error: Couldn't open file '{target_file}': No such file or directory.\n"),
                1,
            );
        };
        bytes
    };
    if b.is_empty() {
        return err_out("Syntax Error: Document stream is empty\n", 1);
    }
    if !b.starts_with(b"%PDF-") {
        return err_out("Syntax Error: Invalid PDF header: missing %PDF- signature\n", 1);
    }
    let supplied = pw_opt.as_deref().unwrap_or("");
    let (doc, encryption) = match pdf_reader::read(&b,supplied) {
        Ok((doc,security)) => (doc,security.map(|s| s.poppler_description())),
        Err(pdf_reader::PASSWORD) => return err_out("Command Line Error: Incorrect password\n",1),
        Err(_) => {
            let doc = PdfDoc::parse(&b);
            if doc.encrypted.as_deref().is_some_and(|p| !p.is_empty() && p != supplied) {
                return err_out("Command Line Error: Incorrect password\n",1);
            }
            let info = doc.encrypted.as_ref().map(|_| "yes (print:yes copy:yes change:yes addNotes:yes algorithm:AES-256)".to_owned());
            (doc,info)
        }
    };
    let page_count = doc.pages.len().max(1);
    let fp = first_p.unwrap_or(1).max(1);
    let lp = last_p.map(|v| if v == 0 { page_count } else { page_count.min(v) }).unwrap_or(1);
    if fp > page_count || (last_p.is_some() && fp > lp) {
        return err_out(
            &format!(
                "Command Line Error: Wrong page range given: the first page ({fp}) can not be after the last page ({lp}).\n"
            ),
            99,
        );
    }
    if show_url {
        let mut u_out = String::from("Page  Type          URL\n");
        let last = if last_p.is_none() { page_count } else { lp };
        if let Ok(mut source) = pdf_reader::PageSource::open(&b,supplied) {
            return if source.write_urls(fp,last.min(source.len()),&mut u_out,fs.shell_limits().max_output_bytes).is_some() {
                ok_out(&u_out)
            } else { err_out("PDF URL output limit exceeded\n",1) };
        }
        for (p_idx, pg) in doc.pages.iter().enumerate().take(last).skip(fp-1) {
            for u in &pg.urls {
                u_out.push_str(&format!("{:4}  {:<13} {u}\n", p_idx + 1, "Annotation"));
            }
        }
        return ok_out(&u_out);
    }
    let get_info_val = |key: &str| -> Option<String> {
        doc.exif
            .get(key)
            .cloned()
            .or_else(|| {
                doc.info
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(key))
                    .map(|(_, v)| v.clone())
            })
    };
    let mut out = String::new();
    if !doc.title.is_empty() {
        out.push_str(&format!("{:<17}{}\n", "Title:", doc.title));
    }
    if let Some(v) = get_info_val("Subject")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{v}\n", "Subject:"));
    }
    if let Some(v) = get_info_val("Keywords")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{v}\n", "Keywords:"));
    }
    if !doc.author.is_empty() {
        out.push_str(&format!("{:<17}{}\n", "Author:", doc.author));
    }
    if let Some(v) = get_info_val("Creator")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{v}\n", "Creator:"));
    }
    if let Some(v) = get_info_val("Producer")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{v}\n", "Producer:"));
    }
    if let Some(v) = get_info_val("CreationDate")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{}\n", "CreationDate:", format_pdf_date(&v, date_mode)));
    }
    if let Some(v) = get_info_val("ModDate")
        && !v.is_empty()
    {
        out.push_str(&format!("{:<17}{}\n", "ModDate:", format_pdf_date(&v, date_mode)));
    }
    let std_keys = [
        "title",
        "author",
        "subject",
        "keywords",
        "creator",
        "producer",
        "creationdate",
        "moddate",
        "trapped",
    ];
    let mut custom_map: BTreeMap<String, String> = BTreeMap::new();
    for (k, v) in &doc.info {
        if !std_keys.contains(&k.to_ascii_lowercase().as_str()) {
            custom_map.insert(k.clone(), v.clone());
        }
    }
    for (k, v) in &doc.exif {
        if !std_keys.contains(&k.to_ascii_lowercase().as_str()) {
            custom_map.insert(k.clone(), v.clone());
        }
    }
    if show_custom {
        for (k, v) in &custom_map {
            out.push_str(&format!("{:<17}{v}\n", format!("{k}:")));
        }
    }
    out.push_str(&format!(
        "{:<17}{}\n",
        "Custom Metadata:",
        if custom_map.is_empty() { "no" } else { "yes" }
    ));
    out.push_str(&format!("{:<17}no\n", "Metadata Stream:"));
    out.push_str(&format!("{:<17}no\n", "Tagged:"));
    out.push_str(&format!("{:<17}no\n", "UserProperties:"));
    out.push_str(&format!("{:<17}no\n", "Suspects:"));
    out.push_str(&format!("{:<17}none\n", "Form:"));
    out.push_str(&format!("{:<17}no\n", "JavaScript:"));
    let total_pages = doc.pages.len().max(1);
    out.push_str(&format!("{:<17}{total_pages}\n", "Pages:"));
    out.push_str(&format!(
        "{:<17}{}\n",
        "Encrypted:",
        encryption.as_deref().unwrap_or("no")
    ));
    let fmt_pt = |n: f64| -> String {
        let r = (n * 100.0).round() / 100.0;
        if (r - r.round()).abs() < 1e-9 {
            format!("{}", r.round() as i64)
        } else {
            format!("{r}")
        }
    };
    let multi_page = first_p.is_some() || last_p.is_some();
    let start_p = first_p.unwrap_or(1).max(1);
    let end_p = last_p.unwrap_or(if multi_page { start_p } else { 1 }).min(total_pages);
    for pno in start_p..=end_p {
        let (pw, ph, crop_opt) = doc
            .page_media
            .get(&pno)
            .copied()
            .unwrap_or((doc.page_w, doc.page_h, None));
        let (eff_w, eff_h) = if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
            ((cx1 - cx0).abs(), (cy1 - cy0).abs())
        } else {
            (pw, ph)
        };
        let paper = paper_size_label(eff_w, eff_h);
        let rot = doc.pages.get(pno - 1).map(|p| p.rot).unwrap_or(0);
        if multi_page {
            out.push_str(&format!(
                "{:<17}{} x {} pts{paper}\n",
                format!("Page {pno:4} size:"),
                fmt_pt(eff_w),
                fmt_pt(eff_h)
            ));
            out.push_str(&format!("{:<17}{rot}\n", format!("Page {pno:4} rot:")));
        } else {
            out.push_str(&format!(
                "{:<17}{} x {} pts{paper}\n",
                "Page size:",
                fmt_pt(eff_w),
                fmt_pt(eff_h)
            ));
            out.push_str(&format!("{:<17}{rot}\n", "Page rot:"));
        }
        if show_box {
            let mb = format!("{:8.2} {:8.2} {:8.2} {:8.2}", 0.0, 0.0, pw, ph);
            let cb = if let Some([cx0, cy0, cx1, cy1]) = crop_opt {
                format!("{cx0:8.2} {cy0:8.2} {cx1:8.2} {cy1:8.2}")
            } else {
                mb.clone()
            };
            let pfx = if multi_page {
                format!("Page {pno:4} ")
            } else {
                String::new()
            };
            out.push_str(&format!("{:<17}{mb}\n", format!("{pfx}MediaBox:")));
            out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}CropBox:")));
            out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}BleedBox:")));
            out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}TrimBox:")));
            out.push_str(&format!("{:<17}{cb}\n", format!("{pfx}ArtBox:")));
        }
    }
    out.push_str(&format!("{:<17}{} bytes\n", "File size:", b.len()));
    out.push_str(&format!("{:<17}{}\n", "Optimized:", if doc.linearized { "yes" } else { "no" }));
    out.push_str(&format!("{:<17}{}\n", "PDF version:", doc.version));
    let _ = (show_meta, show_js, show_struct, show_struct_text, show_dests);
    if show_url {
        out.push_str("\nPage  Type          URL\n");
        for (p_idx, pg) in doc.pages.iter().enumerate() {
            for u in &pg.urls {
                out.push_str(&format!("{:<5} {:<13} {u}\n", p_idx + 1, "Annotation"));
            }
        }
    }
    ok_out(&out)
}

fn cmd_pdffonts(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-v" || a == "--version") {
        return ok_out("pdffonts version 24.08.0\n");
    }
    if args
        .iter()
        .any(|a| matches!(a.as_str(), "-h" | "-help" | "--help" | "-?"))
    {
        return ok_out("Usage: pdffonts [options] <PDF-file>\n  -f <int> / -l <int> / -upw <string> / -opw <string>\n");
    }
    let mut show_subst = false;
    let mut show_loc = false;
    let mut show_loc_ps = false;
    let mut first_p = 1usize;
    let mut last_p = 0usize;
    let mut pw_opt: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-subst" => show_subst = true,
            "-loc" => show_loc = true,
            "-locPS" => show_loc_ps = true,
            "-f" | "-l" => {
                let is_first = args[i] == "-f";
                let raw = args.get(i+1).map(|s|s.trim_start()).unwrap_or("");
                let raw = raw.strip_prefix('+').unwrap_or(raw);
                let digits = raw.bytes().take_while(u8::is_ascii_digit).count();
                let v = if digits == 0 { 0 } else { raw[..digits].parse().unwrap_or(usize::MAX) };
                if is_first { first_p = v.max(1); } else { last_p = v; }
                i += 1;
            }
            "-upw" | "-opw" => {
                if let Some(v) = args.get(i + 1) {
                    pw_opt = Some(v.clone());
                    i += 1;
                }
            }
            a if a == "-" || !a.starts_with('-') => files.push(a.to_string()),
            _ => {}
        }
        i += 1;
    }
    if files.is_empty() {
        return err_out("Usage: pdffonts [options] <PDF-file>\n", 99);
    }
    let b = if files[0] == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, &files[0]);
        let Ok(bytes) = fs.read_file(&full) else {
            return err_out(&format!("I/O Error: Couldn't open file '{}'\n", files[0]), 1);
        };
        bytes
    };
    if !b.starts_with(b"%PDF-") {
        return err_out("PDF Error: Invalid PDF header: missing %PDF- signature\n", 1);
    }
    let source = pdf_reader::PageSource::open(&b,"").ok();
    let mut has_text = false;
    let page_count = if let Some(src) = &source {
        src.len()
    } else {
        let doc = PdfDoc::parse(&b);
        if let Some(ref password) = doc.encrypted
            && !password.is_empty() && pw_opt.as_deref() != Some(password) {
            return err_out("PDF Error: Invalid PDF password\n", 1);
        }
        has_text = doc.pages.iter().any(|p| !p.text.trim().is_empty());
        doc.pages.len().max(1)
    };
    let end_p = if last_p > 0 { page_count.min(last_p) } else { page_count };
    if first_p > page_count || (last_p > 0 && first_p > end_p) {
        return err_out(
            &format!(
                "Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n"
            ),
            99,
        );
    }
    let mut out = String::from(if show_subst {
        "name                                 object ID substitute font                      substitute font file\n------------------------------------ --------- ------------------------------------ ------------------------------------\n"
    } else if show_loc || show_loc_ps {
        "name                                 type              encoding         emb sub uni object ID location\n------------------------------------ ----------------- ---------------- --- --- --- --------- --------\n"
    } else {
        "name                                 type              encoding         emb sub uni object ID\n------------------------------------ ----------------- ---------------- --- --- --- ---------\n"
    });
    if let Some(mut src) = source {
        let Some(rows) = src.font_rows(first_p, end_p, show_loc || show_loc_ps, show_loc_ps, show_subst) else {
            return err_out("PDF Error: PDF font resource limit exceeded\n", 1);
        };
        out.push_str(&rows);
    } else if has_text {
        // Older internally generated documents have no PDF resource dictionaries.
        if show_subst {
            out.push_str("Helvetica                                 6  0 Nimbus Sans                          /usr/share/fonts/type1/urw-base35/NimbusSans.t1\n");
        } else if show_loc || show_loc_ps {
            let loc = if show_loc_ps { "Substitute (Helvetica)" } else { "Substitute" };
            out.push_str(&format!("Helvetica                            Type 1            WinAnsi          no  no  no       6  0 {loc}\n"));
        } else {
            out.push_str("Helvetica                            Type 1            WinAnsi          no  no  no       4  0\n");
        }
    }
    ok_out(&out)
}

fn cmd_pdftotext(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut password = "";
    let mut first_p = 1usize;
    let mut last_p = 0usize;
    let mut last_p_explicit = false;
    let mut bbox_mode = false;
    let mut bbox_layout = false;
    let mut tsv_mode = false;
    let mut htmlmeta = false;
    let mut rejoin = true;
    let mut urls_mode = false;
    let mut layout = false;
    let mut raw = false;
    let mut page_break = true;
    let mut eol_mode = "unix";
    let mut invalid_eol_warn = false;
    let mut colspacing = 0.7;
    let mut invalid_colspacing = false;
    let mut quiet = false;
    let mut listenc = false;
    let mut version = false;
    let mut help = false;
    let mut pos: Vec<String> = Vec::new();
    let mut after_dd = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if after_dd {
            pos.push(a.to_string());
            i += 1;
            continue;
        }
        if a == "--" {
            after_dd = true;
            i += 1;
            continue;
        }
        match a {
            "-f" => {
                if i + 1 >= args.len() {
                    return err_out("Invalid -f page number\n", 99);
                }
                if let Ok(v) = args[i + 1].parse::<usize>() {
                    first_p = v.max(1);
                } else {
                    return err_out("Invalid -f page number\n", 99);
                }
                i += 2;
            }
            "-l" => {
                if i + 1 >= args.len() {
                    return err_out("Invalid -l page number\n", 99);
                }
                if let Ok(v) = args[i + 1].parse::<usize>() {
                    last_p = v;
                    last_p_explicit = true;
                } else {
                    return err_out("Invalid -l page number\n", 99);
                }
                i += 2;
            }
            "-r" => {
                if i + 1 >= args.len() || args[i + 1].parse::<f64>().map(|v| v <= 0.0).unwrap_or(true) {
                    return err_out("Invalid -r resolution\n", 99);
                }
                i += 2;
            }
            "-x" | "-y" | "-W" | "-H" => {
                if i + 1 >= args.len() || args[i + 1].parse::<f64>().is_err() {
                    return err_out(&format!("Command Line Error: Invalid numeric argument for {a}\n"), 99);
                }
                i += 2;
            }
            "-upw" | "-opw" if i + 1 < args.len() => { password = &args[i+1]; i += 2; }
            "-fixed" | "-linespacing" if i + 1 < args.len() => {
                i += 2;
            }
            "-colspacing" => {
                let v = args.get(i + 1).and_then(|s| s.parse::<f64>().ok());
                if let Some(value) = v.filter(|x| *x > 0.0 && *x <= 10.) {
                    colspacing = value;
                } else {
                    invalid_colspacing = true;
                }
                i += 2;
            }
            "-enc" => {
                let enc = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                if !matches!(enc, "ASCII7" | "Latin1" | "UTF-8" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                    return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                }
                i += 2;
            }
            "-eol" => {
                let v = args.get(i + 1).map(|s| s.as_str()).unwrap_or("");
                match v {
                    "unix" => eol_mode = "unix",
                    "dos" => eol_mode = "dos",
                    "mac" => eol_mode = "mac",
                    _ => invalid_eol_warn = true,
                }
                i += 2;
            }
            "-remove-hyphens" => {
                if let Some(nxt) = args.get(i + 1) && !nxt.starts_with('-') {
                    rejoin = nxt != "no";
                    if !matches!(nxt.as_str(), "yes" | "no" | "auto") {
                        return err_out("Bad '-remove-hyphens' value on command line\n", 99);
                    }
                    i += 2;
                } else {
                    rejoin = true; i += 1;
                }
            }
            "-bbox" => {
                bbox_mode = true;
                i += 1;
            }
            "-bbox-layout" => {
                bbox_mode = true;
                bbox_layout = true;
                i += 1;
            }
            "-tsv" => {
                tsv_mode = true;
                i += 1;
            }
            "-htmlmeta" => {
                htmlmeta = true;
                i += 1;
            }
            "-urls" => {
                urls_mode = true;
                i += 1;
            }
            "-q" => {
                quiet = true;
                i += 1;
            }
            "-listenc" => {
                listenc = true;
                i += 1;
            }
            "-v" | "--version" => {
                version = true;
                i += 1;
            }
            "-h" | "-help" | "--help" | "-?" => {
                help = true;
                i += 1;
            }
            "-layout" | "-table" | "-lineprinter" => {
                layout = true;
                i += 1;
            }
            "-raw" => {
                raw = true;
                i += 1;
            }
            "-nopgbrk" => {
                page_break = false;
                i += 1;
            }
            "-nodiag" | "-cropbox" | "-clip" => {
                i += 1;
            }
            _ if a.starts_with('-') && a != "-" => {
                return err_out(&format!("Command Line Error: Unknown option '{a}'\n"), 99);
            }
            _ => {
                pos.push(a.to_string());
                i += 1;
            }
        }
    }
    let warn_prefix = if invalid_eol_warn { "Bad '-eol' value on command line\n" } else { "" };
    if invalid_colspacing {
        return err_out(&format!("{warn_prefix}Command Line Error: Invalid column spacing\n"), 99);
    }
    if urls_mode && (htmlmeta || bbox_mode || tsv_mode) {
        return err_out(&format!("{warn_prefix}Command Line Error: '-urls' is not supported with HTML or TSV output\n"), 99);
    }
    if pos.len() > 2 {
        return err_out(if quiet { warn_prefix.to_string() } else { format!("{warn_prefix}Usage: pdftotext [options] [PDF-file [text-file]]\n") }.as_str(), 99);
    }
    if listenc {
        return BuiltinOutcome {
            stdout: "Available encodings are:\nASCII7\nLatin1\nUTF-8\nUCS-2\nSymbol\nZapfDingbats\n".to_string(),
            stderr: warn_prefix.to_string(),
            exit_code: 0,
        };
    }
    if version {
        return BuiltinOutcome {
            stdout: "pdftotext version 26.09.90 (@poe-code/pdf-ast)\n".to_string(),
            stderr: warn_prefix.to_string(),
            exit_code: 0,
        };
    }
    if help {
        return BuiltinOutcome {
            stdout: "Usage: pdftotext [options] [PDF-file [text-file]]\n  -f <int>          : first page to convert\n  -l <int>          : last page to convert\n  -r <fp>           : resolution, in DPI (default is 72)\n  -x <int>          : x-coordinate of the crop area top left corner\n  -y <int>          : y-coordinate of the crop area top left corner\n  -W <int>          : width of crop area in pixels\n  -H <int>          : height of crop area in pixels\n  -layout           : maintain original physical layout\n  -raw              : keep strings in content stream order\n  -bbox             : output bounding box for each word and page size to html\n  -bbox-layout      : like -bbox but with extra layout bounding box data\n  -tsv              : output bounding box for each word and page size to tsv\n  -htmlmeta         : generate a simple HTML file, including the meta information\n  -nopgbrk          : don't insert page breaks between pages\n  -eol <string>     : output end-of-line convention (unix, dos, or mac)\n  -upw <string>     : user password\n  -opw <string>     : owner password\n".to_string(),
            stderr: warn_prefix.to_string(),
            exit_code: 0,
        };
    }
    let in_arg = pos.first().map(|s| s.as_str()).unwrap_or("-");
    let raw_bytes = if in_arg == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, in_arg);
        match fs.read_file(&full) {
            Ok(b) => b,
            Err(_) => {
                let msg = if quiet {
                    String::new()
                } else {
                    format!("{warn_prefix}I/O Error: Couldn't open file '{in_arg}': No such file or directory.\n")
                };
                return err_out(&msg, 1);
            }
        }
    };
    if raw_bytes.is_empty() {
        let msg = if quiet {
            String::new()
        } else {
            format!("{warn_prefix}Syntax Error: Document stream is empty\n")
        };
        return err_out(&msg, 1);
    }
    if !raw_bytes.starts_with(b"%PDF-") {
        let msg = if quiet {
            String::new()
        } else {
            format!("{warn_prefix}Syntax Error: Invalid PDF header: missing %PDF- signature\n")
        };
        return err_out(&msg, 1);
    }
    let doc = match pdf_reader::read(&raw_bytes,password) {
        Ok((doc,_)) => doc,
        Err(pdf_reader::PASSWORD) => return err_out(if quiet {""} else {"Command Line Error: Incorrect password\n"},1),
        Err(_) => PdfDoc::parse(&raw_bytes),
    };
    let page_count = doc.pages.len().max(1);
    let end_p = if !last_p_explicit || last_p == 0 || last_p > page_count {
        page_count
    } else {
        last_p
    };
    if first_p > page_count || first_p > end_p {
        let msg = if quiet {
            String::new()
        } else {
            format!("{warn_prefix}Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n")
        };
        return err_out(&msg, 99);
    }
    let mut selected_pages: Vec<(usize, &PdfPage)> = Vec::new();
    for pno in first_p..=end_p {
        if let Some(pg) = doc.pages.get(pno - 1) {
            selected_pages.push((pno, pg));
        }
    }
    let mut rendered = if bbox_mode {
        let mut pages_xml = String::new();
        for (_pno, pg) in &selected_pages {
            pages_xml.push_str(&format!("  <page width=\"{:.6}\" height=\"{:.6}\">\n", doc.page_w, doc.page_h));
            if bbox_layout {
                pages_xml.push_str("    <flow>\n      <block xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"100.000000\" yMax=\"20.000000\">\n        <line xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"100.000000\" yMax=\"20.000000\">\n");
            }
            for w in pg.text.split_whitespace() {
                pages_xml.push_str(&format!(
                    "          <word xMin=\"0.000000\" yMin=\"0.000000\" xMax=\"50.000000\" yMax=\"12.000000\">{}</word>\n",
                    html_escape_str(w)
                ));
            }
            if bbox_layout {
                pages_xml.push_str("        </line>\n      </block>\n    </flow>\n");
            }
            pages_xml.push_str("  </page>\n");
        }
        let author_meta = if doc.author.is_empty() {
            String::new()
        } else {
            format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
        };
        format!(
            "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<doc>\n{pages_xml}</doc>\n</body>\n</html>\n",
            html_escape_str(&doc.title)
        )
    } else if tsv_mode {
        let mut tsv = String::from(
            "level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n",
        );
        for (pno, pg) in &selected_pages {
            tsv.push_str(&format!(
                "1\t{pno}\t0\t0\t0\t0\t0.000000\t0.000000\t{:.6}\t{:.6}\t-1\t###PAGE###\n",
                doc.page_w, doc.page_h
            ));
            let non_empty_lines: Vec<&str> = pg.text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
            if !non_empty_lines.is_empty() {
                tsv.push_str(&format!(
                    "3\t{pno}\t0\t0\t0\t0\t0.000000\t0.000000\t100.000000\t20.000000\t-1\t###FLOW###\n"
                ));
                for (lidx, line_str) in non_empty_lines.iter().enumerate() {
                    tsv.push_str(&format!(
                        "4\t{pno}\t0\t0\t{lidx}\t0\t0.000000\t0.000000\t100.000000\t20.000000\t-1\t###LINE###\n"
                    ));
                    for (widx, w) in line_str.split_whitespace().enumerate() {
                        tsv.push_str(&format!(
                            "5\t{pno}\t0\t0\t{lidx}\t{widx}\t0.00\t0.00\t50.00\t12.00\t100\t{w}\n"
                        ));
                    }
                }
            }
        }
        if htmlmeta {
            let author_meta = if doc.author.is_empty() {
                String::new()
            } else {
                format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
            };
            format!(
                "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<pre>\n{}</pre>\n</body>\n</html>\n",
                html_escape_str(&doc.title),
                html_escape_str(&tsv)
            )
        } else {
            tsv
        }
    } else {
        let mut plain = String::new();
        let mut source = (urls_mode || raw || !layout).then(||pdf_reader::PageSource::open(&raw_bytes,password).ok()).flatten();
        for (pno, pg) in &selected_pages {
            let mut t = if layout && !raw {
                pg.text.replace("\n\n", "\n")
            } else {
                let width = doc.page_media.get(pno).map_or(doc.page_w, |m|m.0).abs();
                source.as_mut().and_then(|s| s.plain_text(*pno,(!raw).then_some(colspacing),width,!raw && rejoin)).unwrap_or_else(|| pg.text.clone())
            };
            if urls_mode {
                let mut extra = Vec::new();
                let links;
                let urls = if let Some(source) = &mut source {
                    let Some(found) = source.page_links(*pno, fs.shell_limits().max_input_bytes) else {return err_out("PDF link limit exceeded\n",1)};
                    links = found.into_iter().map(|(_,uri)|uri).collect::<Vec<_>>();
                    &links
                } else {&pg.urls};
                for u in urls {
                    if !t.contains(u) && !extra.contains(u) {
                        extra.push(u.clone());
                    }
                }
                if !extra.is_empty() {
                    if !t.is_empty() && !t.ends_with('\n') {
                        t.push('\n');
                    }
                    t.push_str(&extra.join("\n"));
                    t.push('\n');
                }
            }
            if !raw && !t.is_empty() {
                if !t.ends_with('\n') {
                    t.push('\n');
                }
                if !layout {
                    t.push('\n');
                }
            }
            plain.push_str(&t);
            if page_break {
                plain.push('\x0c');
            }
        }
        if eol_mode == "dos" {
            plain = plain.replace('\n', "\r\n");
        } else if eol_mode == "mac" {
            plain = plain.replace('\n', "\r");
        }
        if htmlmeta {
            let author_meta = if doc.author.is_empty() {
                String::new()
            } else {
                format!("<meta name=\"Author\" content=\"{}\"/>\n", html_escape_str(&doc.author))
            };
            format!(
                "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\"><html xmlns=\"http://www.w3.org/1999/xhtml\">\n<head>\n<title>{}</title>\n{author_meta}</head>\n<body>\n<pre>\n{}</pre>\n</body>\n</html>\n",
                html_escape_str(&doc.title),
                html_escape_str(&plain)
            )
        } else {
            plain
        }
    };
    if (bbox_mode || tsv_mode) && eol_mode == "dos" {
        rendered = rendered.replace('\n', "\r\n");
    }
    let out_target = if pos.len() >= 2 {
        pos[1].clone()
    } else if in_arg != "-" {
        let ext = if bbox_mode || htmlmeta {
            ".html"
        } else if tsv_mode {
            ".tsv"
        } else {
            ".txt"
        };
        let stem = if in_arg.to_ascii_lowercase().ends_with(".pdf") {
            &in_arg[..in_arg.len() - 4]
        } else {
            in_arg
        };
        format!("{stem}{ext}")
    } else {
        "-".to_string()
    };
    if out_target == "-" {
        BuiltinOutcome {
            stdout: rendered,
            stderr: warn_prefix.to_string(),
            exit_code: 0,
        }
    } else {
        let dst = resolve_posix_path(cwd, &out_target);
        let _ = fs.write_file(&dst, rendered.as_bytes());
        BuiltinOutcome {
            stdout: String::new(),
            stderr: warn_prefix.to_string(),
            exit_code: 0,
        }
    }
}

fn cmd_pdftohtml(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut xml_mode = false;
    let mut to_stdout = false;
    let mut ignore_images = false;
    let mut data_urls = false;
    let mut first_p = 1.0;
    let mut last_p = 0.0;
    let mut zoom = 1.0f64;
    let mut image_fmt = "png";
    let mut pos: Vec<String> = Vec::new();
    let mut after_dd = false;
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if after_dd {
            pos.push(a.to_string());
            i += 1;
            continue;
        }
        if a == "--" {
            after_dd = true;
            i += 1;
            continue;
        }
        if a == "-v" || a == "--version" {
            return ok_out("pdftohtml version 24.08.0\n");
        }
        if a == "-h" || a == "-help" || a == "--help" || a == "-?" {
            return ok_out("Usage: pdftohtml [options] <PDF-file> [<html-file>|<xml-file>]\n  -xml / -stdout / -s / -i / -noframes / -c / -f <int> / -l <int>\n");
        }
        match a {
            "-xml" => xml_mode = true,
            "-stdout" => to_stdout = true,
            "-i" => ignore_images = true,
            "-dataurls" => data_urls = true,
            "-f" => {
                i += 1;
                first_p = args.get(i).map_or(1.0, |s| js_number(s, 0.0).max(1.0));
            }
            "-l" => {
                i += 1;
                last_p = args.get(i).map_or(0.0, |s| js_number(s, 0.0).max(0.0));
            }
            "-zoom" => {
                i += 1;
                if let Some(z) = args.get(i).map(|s| parse_float_prefix(s)) && z.is_finite() && z > 0.0 {
                    zoom = z;
                }
            }
            "-fmt" => {
                i += 1;
                let fv = args.get(i).map(|s| s.to_ascii_lowercase()).unwrap_or_default();
                if fv == "png" {
                    image_fmt = "png";
                } else if fv == "jpg" || fv == "jpeg" {
                    image_fmt = "jpg";
                } else {
                    return err_out(&format!("Command Line Error: Invalid image format '{fv}'\n"), 99);
                }
            }
            "-enc" => {
                i += 1;
                let enc = args.get(i).map(|s| s.as_str()).unwrap_or("");
                if !matches!(enc, "ASCII7" | "Latin1" | "UTF-8" | "UCS-2" | "Symbol" | "ZapfDingbats") {
                    return err_out(&format!("Command Line Error: Unknown encoding '{enc}'\n"), 99);
                }
            }
            "-upw" | "-opw" => {
                i += 1;
            }
            "-s" | "-noframes" | "-c" | "-p" | "-q" | "-hidden" | "-nomerge" | "-nodrm" => {}
            _ if !a.starts_with('-') || a == "-" => {
                pos.push(a.to_string());
            }
            _ => {}
        }
        i += 1;
    }
    let input_path = pos.first().map_or("-", String::as_str);
    if input_path.is_empty() { return err_out("Usage: pdftohtml [options] <PDF-file> [<html-file>]\n", 99); }
    let explicit_out = pos.get(1).map(String::as_str).filter(|s| !s.is_empty());
    let stdout_output = to_stdout || explicit_out == Some("-") || (input_path == "-" && explicit_out.is_none());
    let default_ext = if xml_mode { ".xml" } else { ".html" };
    let input_stem = if input_path.to_ascii_lowercase().ends_with(".pdf") {
        &input_path[..input_path.len() - 4]
    } else {
        input_path
    };
    let out_path = match explicit_out {
        Some(eo) => {
            if eo.ends_with(".html") || eo.ends_with(".xml") {
                eo.to_string()
            } else {
                format!("{eo}{default_ext}")
            }
        }
        None => format!("{input_stem}{default_ext}"),
    };
    let image_dir = match out_path.rfind('/') {
        Some(idx) => &out_path[..=idx],
        None => "",
    };
    let raw_bytes = if input_path == "-" {
        let b = crate::vfs::stream_string_to_bytes(stdin);
        if b.is_empty() {
            return err_out("I/O Error: Couldn't open file '-'\n", 1);
        }
        b
    } else {
        let full = resolve_posix_path(cwd, input_path);
        if fs.is_dir(&full) {
            return err_out(&format!("I/O Error: Couldn't open file '{input_path}'\n"), 1);
        }
        match fs.read_file(&full) {
            Ok(b) => b,
            Err(_) => return err_out(&format!("I/O Error: Couldn't open file '{input_path}'\n"), 1),
        }
    };
    if !raw_bytes.starts_with(b"%PDF-") {
        return err_out("PDF Error: Invalid PDF header: missing %PDF- signature\n", 1);
    }
    let doc = PdfDoc::parse(&raw_bytes);
    let total_pages = doc.pages.len().max(1) as f64;
    let end_p = if last_p > 0.0 { total_pages.min(last_p) } else { total_pages };
    if first_p > end_p {
        return err_out(&format!("Command Line Error: Wrong page range given: the first page ({}) can not be after the last page ({}).\n",
            mcp_protocol_rust::numbers::format(first_p), mcp_protocol_rust::numbers::format(end_p)), 99);
    }
    let (first_p, end_p) = (first_p.ceil() as usize, end_p.floor() as usize);
    let mut source = pdf_reader::PageSource::open(&raw_bytes,"").ok();
    let dimensions = |pno| {
        let (w, h, _) = doc.page_media.get(&pno).copied().unwrap_or((doc.page_w, doc.page_h, None));
        (w.abs(), h.abs())
    };
    let mut image_files = Vec::new();
    let limit = fs.shell_limits().max_output_bytes;
    let mut remaining = limit;
    let mut page_content = |pno: usize| -> Result<_, &'static str> {
        let mut fonts = vec![("Helvetica".to_string(), (12.0 * zoom).round() as i64)];
        let mut markup = Vec::new();
        if !ignore_images {
            let mut idx = 0;
            let mut emit = |w: usize, h: usize, bytes: Vec<u8>| -> Option<()> {
                idx += 1;
                let name = format!("page{pno}_{idx}.{image_fmt}");
                let src = if data_urls {
                    remaining = remaining.checked_sub(bytes.len().div_ceil(3).checked_mul(4)?)?;
                    let mime = if image_fmt == "jpg" { "image/jpeg" } else { "image/png" };
                    format!("data:{mime};base64,{}", base64_encode(&bytes))
                } else {
                    if !stdout_output {
                        remaining = remaining.checked_sub(bytes.len())?;
                        image_files.push((format!("{image_dir}{name}"), bytes));
                    }
                    name
                };
                markup.push(if xml_mode {
                    format!(r#"    <image top="0" left="0" width="{w}" height="{h}" src="{src}"/>"#)
                } else {
                    format!(r#"  <img src="{src}" width="{w}" height="{h}"/>"#)
                });
                Some(())
            };
            if let Some(source) = source.as_mut() {
                source.images(pno, fs.max_input_bytes(), pdf_reader::ImageRead::Pixels, |im, _| {
                    let bytes = if image_fmt == "jpg" {
                        jpeg::encode(jpeg::Input::Pdf {width:im.width, height:im.height, pixels:&im.pixels},limit).ok()?
                    } else { im.encode("PNG", limit, false)? };
                    emit(im.width,im.height,bytes)
                }).ok_or("PDF Error: Invalid or oversized PDF image\n")?;
            } else if let Some(pg) = doc.pages.get(pno-1) {
                for &(w,h,_) in &pg.images {
                    let im = ImageMeta { fmt: if image_fmt=="jpg" {"JPEG"} else {"PNG"}.into(), w,h,cs:"sRGB".into(),exif:BTreeMap::new() };
                    emit(w as usize,h as usize,write_image_bytes(&im)).ok_or("PDF image limit exceeded\n")?;
                }
            }
        }
        if let Some(layout) = source.as_mut().and_then(|s| s.text_lines(pno,Some(0.7))) {
            let links = source.as_mut().and_then(|s| s.page_links(pno, fs.shell_limits().max_input_bytes)).ok_or("PDF link limit exceeded\n")?;
            let height = dimensions(pno).1;
            let mut font_ids = BTreeMap::from([(fonts[0].clone(), 0)]);
            for run in layout {
                let [x0, y0, x1, y1] = run.bounds;
                let left = (x0 * zoom).round().max(0.) as i64;
                let top = ((height - y1) * zoom).round().max(0.) as i64;
                let width = ((x1 - x0) * zoom).round().max(1.) as i64;
                let height = ((y1 - y0) * zoom).round().max(1.) as i64;
                let style = run.family.to_ascii_lowercase();
                let mut inner = html_escape_str(&run.text);
                if style.contains("italic") || style.contains("oblique") { inner = format!("<i>{inner}</i>"); }
                if style.contains("bold") { inner = format!("<b>{inner}</b>"); }
                if let Some((_,uri)) = links.iter().find(|([a,b,c,d],_)|
                    x1.min(a.max(*c)) > x0.max(a.min(*c)) && y1.min(b.max(*d)) > y0.max(b.min(*d))) {
                    inner = format!(r#"<a href="{}">{inner}</a>"#,html_escape_str(uri));
                }
                markup.push(if xml_mode {
                    let key = (run.family.to_string(), (run.size * zoom).round().max(1.) as i64);
                    let id = font_ids.entry(key.clone()).or_insert_with(|| { fonts.push(key); fonts.len()-1 });
                    format!(r#"    <text top="{top}" left="{left}" width="{width}" height="{height}" font="{id}">{inner}</text>"#)
                } else {
                    format!(r#"  <p style="position:absolute;top:{top}pt;left:{left}pt;margin:0;">{inner}</p>"#)
                });
            }
        } else if let Some(pg) = doc.pages.get(pno - 1) {
            for (i, line) in pg.text.lines().map(str::trim).filter(|s| !s.is_empty()).enumerate() {
                let mut inner = html_escape_str(line);
                if i == 0 && let Some(url) = pg.urls.first() {
                    inner = format!(r#"<a href="{}">{inner}</a>"#, html_escape_str(url));
                }
                let top = 50 + i * 20;
                markup.push(if xml_mode {
                    format!(r#"    <text top="{top}" left="50" width="200" height="20" font="0">{inner}</text>"#)
                } else {
                    format!(r#"  <p style="position:absolute;top:{top}pt;left:50pt;margin:0;">{inner}</p>"#)
                });
            }
        }
        Ok((fonts, markup))
    };
    let mut lines = if xml_mode {
        let mut lines = vec![
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
            "<!DOCTYPE pdf2xml SYSTEM \"pdf2xml.dtd\">".to_string(),
            "<pdf2xml producer=\"@poe-code/pdf-ast\" version=\"24.08.0\">".to_string(),
        ];
        for pno in first_p..=end_p {
            let (pw, ph) = dimensions(pno);
            let (pw, ph) = ((pw * zoom).round() as i64, (ph * zoom).round() as i64);
            let (fonts, markup) = match page_content(pno) { Ok(page)=>page, Err(e)=>return err_out(e,1) };
            lines.push(format!(
                "  <page number=\"{pno}\" position=\"absolute\" top=\"0\" left=\"0\" height=\"{ph}\" width=\"{pw}\">"
            ));
            for (id, (family, size)) in fonts.iter().enumerate() {
                lines.push(format!(r##"    <fontspec id="{id}" size="{size}" family="{}" color="#000000"/>"##, html_escape_str(family)));
            }
            lines.extend(markup);
            lines.push("  </page>".to_string());
        }
        lines
    } else {
        let title = if doc.title.is_empty() {
            html_escape_str(input_path)
        } else {
            html_escape_str(&doc.title)
        };
        let mut lines = vec![
            "<!DOCTYPE html>".to_string(),
            "<html>".to_string(),
            format!("<head><meta charset=\"utf-8\"/><title>{title}</title></head>"),
            "<body>".to_string(),
        ];
        for pno in first_p..=end_p {
            let (pw, ph) = dimensions(pno);
            let (pw, ph) = ((pw * zoom).round() as i64, (ph * zoom).round() as i64);
            let (_, markup) = match page_content(pno) { Ok(page)=>page, Err(e)=>return err_out(e,1) };
            lines.push(format!(
                "<div class=\"page\" id=\"page{pno}\" style=\"position:relative;width:{pw}pt;height:{ph}pt;\">"
            ));
            lines.extend(markup);
            lines.push("</div>".to_string());
        }
        lines
    };
    let mut depth = 0usize;
    let mut outline_budget = limit;
    let mut add_line = |indent: usize, text: &str| {
        let indent = if xml_mode { 2 * indent } else { 0 };
        outline_budget = outline_budget.checked_sub(indent + text.len() + 1)?;
        lines.push(format!("{}{text}", " ".repeat(indent)));
        Some(())
    };
    let outline = doc.bookmarks.iter().map(Some).chain(std::iter::once(None)).try_for_each(|item| {
        let level = item.map_or(0, |(_, level, _)| level.parse::<usize>().unwrap_or(1).clamp(1, depth+1));
        if depth == 0 {
            if item.is_none() { return Some(()); }
            add_line(1, if xml_mode { "<outline>" } else { "<hr/>\n<a name=\"outline\"></a><h1>Document Outline</h1>\n<ul>" })?;
        } else if level > depth {
            add_line(level, if xml_mode { "<outline>" } else { "<ul>" })?;
        } else {
            if !xml_mode { add_line(0, "</li>")?; }
            for at in (level+1..=depth).rev() {
                add_line(at, if xml_mode { "</outline>" } else if at > 1 { "</ul>\n</li>" } else { "</ul>" })?;
            }
        }
        depth = level;
        if let Some((title, _, page)) = item {
            let title = html_escape_str(title);
            let line = if xml_mode { format!(r#"<item page="{page}">{title}</item>"#) } else { format!(r##"<li><a href="#page{page}">{title}</a>"##) };
            add_line(depth+1,&line)?;
        }
        Some(())
    });
    if outline.is_none() { return err_out("PDF outline limit exceeded\n",1); }
    lines.push(if xml_mode { "</pdf2xml>" } else { "</body>\n</html>" }.into());
    let rendered = format!("{}\n",lines.join("\n"));
    if stdout_output {
        ok_out(&rendered)
    } else {
        image_files.push((out_path,rendered.into_bytes()));
        for (name, bytes) in image_files {
            let path=resolve_posix_path(cwd,&name);
            if fs.observe_publication(&path,fs.generation(),crate::vfs::PublicationMode::Write).and_then(|stamp| fs.publish_file(&path,&bytes,&[],stamp.version)).is_err() {
                return err_out(&format!("I/O Error: Couldn't open html file '{name}'\n"),0);
            }
        }
        ok_out("")
    }
}

fn cmd_pdftoppm(cmd: &str, args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let is_cairo = cmd == "pdftocairo";
    let mut jpeg_quality = 75;
    let mut tiff_compression = String::from("none");
    let mut ext = if is_cairo { "png" } else { "ppm" };
    let mut fmt = if is_cairo { "PNG" } else { "PPM" };
    let mut explicit_container = is_cairo;
    let mut singlefile = false;
    let mut first_p = 1usize;
    let mut last_p: Option<usize> = None;
    let mut odd_only = false;
    let mut even_only = false;
    let mut quiet = false;
    let mut sep = "-".to_string();
    let mut force_num = false;
    let mut set_pageno: Option<usize> = None;
    let mut progress = false;
    let mut dpi_x = 150.0f64;
    let mut dpi_y = 150.0f64;
    let mut scale_to: Option<i64> = None;
    let mut scale_to_x: Option<i64> = None;
    let mut scale_to_y: Option<i64> = None;
    let mut crop_x = 0.;
    let mut crop_y = 0.;
    let mut cropbox = false;
    let mut transparent = false;
    let mut antialias = true;
    let mut text_aa = true;
    let mut color_mode = "rgb";
    let mut crop_w: Option<f64> = None;
    let mut crop_h: Option<f64> = None;
    let mut pw_opt: Option<String> = None;
    let mut pos: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--" {
            for rest_arg in &args[i + 1..] {
                pos.push(rest_arg.clone());
            }
            break;
        }
        let is_val_flag = matches!(
            arg,
            "-r" | "-rx"
                | "-ry"
                | "-scale-to"
                | "-scale-to-x"
                | "-scale-to-y"
                | "-f"
                | "-l"
                | "-x"
                | "-y"
                | "-W"
                | "-H"
                | "-sz"
                | "-sep"
                | "-setpageno"
                | "-defaultgray"
                | "-defaultrgb"
                | "-defaultcmyk"
                | "-upw"
                | "-opw"
                | "-tiffcompression"
                | "-aa"
                | "-aaVector"
                | "-thinlinemode"
                | "-freetype"
                | "-jpegopt"
        ) || (is_cairo
            && matches!(arg, "-icc" | "-paper" | "-paperw" | "-paperh"));
        if is_val_flag {
            let Some(val) = args.get(i + 1) else {
                return err_out(&format!("Missing value for '{arg}'\n"), 99);
            };
            let is_int_flag = matches!(
                arg,
                "-scale-to"
                    | "-scale-to-x"
                    | "-scale-to-y"
                    | "-f"
                    | "-l"
                    | "-x"
                    | "-y"
                    | "-W"
                    | "-H"
                    | "-sz"
                    | "-setpageno"
            );
            let is_res_flag = matches!(arg, "-r" | "-rx" | "-ry");
            if is_int_flag {
                let unsigned = val.strip_prefix(['+', '-']).unwrap_or(val.as_str());
                if unsigned.is_empty() || !unsigned.chars().all(|c| c.is_ascii_digit()) {
                    return err_out(&format!("Bad '{arg}' value on command line\n"), 99);
                }
            } else if is_res_flag {
                let unsigned = val.strip_prefix(['+', '-']).unwrap_or(val.as_str());
                let valid_res = !unsigned.is_empty()
                    && unsigned
                        .chars()
                        .all(|c| "0123456789.eE+-".contains(c))
                    && val.parse::<f64>().map(|v| v.is_finite()).unwrap_or(false);
                if !valid_res {
                    return err_out(&format!("Bad '{arg}' value on command line\n"), 99);
                }
            }
        }
        if arg == "-v" || arg == "--version" {
            return ok_out(&format!("{cmd} version 24.08.0\n"));
        }
        if arg == "-h" || arg == "-help" || arg == "--help" || arg == "-?" {
            if is_cairo {
                return ok_out("Usage: pdftocairo [options] <PDF-file> [<output-file>]\n  -png / -jpeg / -tiff / -ps / -eps / -pdf / -svg\n");
            }
            return ok_out("Usage: pdftoppm [options] [PDF-file [PPM-root]]\n  -png / -gray / -mono / -svg / -r <fp> / -rx <fp> / -ry <fp> / -f <int> / -l <int> / -singlefile / -x <int> / -y <int> / -W <int> / -H <int> / -cropbox\n");
        }
        match arg {
            "-png" => {
                ext = "png";
                fmt = "PNG";
                explicit_container = true;
            }
            "-jpeg" | "-jpg" | "-jpegcmyk" => {
                ext = "jpg";
                fmt = "JPEG";
                explicit_container = true;
            }
            "-tiff" => {
                ext = "tif";
                fmt = "TIFF";
                explicit_container = true;
            }
            "-ppm" => {
                ext = "ppm";
                fmt = "PPM";
            }
            "-gray" => {
                color_mode = "gray";
                if !explicit_container && ext == "ppm" {
                    ext = "pgm";
                    fmt = "PGM";
                }
            }
            "-mono" => {
                color_mode = "mono";
                if !explicit_container && ext == "ppm" {
                    ext = "pbm";
                    fmt = "PBM";
                }
            }
            "-svg" => {
                ext = "svg";
                fmt = "SVG";
                explicit_container = true;
            }
            "-eps" => {
                ext = "eps";
                fmt = "EPS";
                explicit_container = true;
            }
            "-ps" => {
                ext = "ps";
                fmt = "PS";
                explicit_container = true;
            }
            "-pdf" => {
                ext = "pdf";
                fmt = "PDF";
                explicit_container = true;
            }
            "-singlefile" => singlefile = true,
            "-odd" | "-o" => odd_only = true,
            "-even" | "-e" => even_only = true,
            "-forcenum" => force_num = true,
            "-progress" => progress = true,
            "-q" => quiet = true,
            "-f" => {
                let v = args[i + 1].parse::<isize>().unwrap_or(1);
                first_p = v.max(1) as usize;
                i += 1;
            }
            "-l" => {
                let v = args[i + 1].parse::<isize>().unwrap_or(0).max(0) as usize;
                if v > 0 {
                    last_p = Some(v);
                }
                i += 1;
            }
            "-r" => {
                let v = args[i + 1].parse::<f64>().unwrap_or(150.0).max(1.0);
                dpi_x = v;
                dpi_y = v;
                i += 1;
            }
            "-rx" => {
                dpi_x = args[i + 1].parse::<f64>().unwrap_or(150.0).max(1.0);
                i += 1;
            }
            "-ry" => {
                dpi_y = args[i + 1].parse::<f64>().unwrap_or(150.0).max(1.0);
                i += 1;
            }
            "-scale-to" => {
                scale_to = args[i + 1].parse::<i64>().ok();
                i += 1;
            }
            "-scale-to-x" => {
                scale_to_x = args[i + 1].parse::<i64>().ok();
                i += 1;
            }
            "-scale-to-y" => {
                scale_to_y = args[i + 1].parse::<i64>().ok();
                i += 1;
            }
            "-W" => {
                crop_w = args[i + 1].parse::<f64>().ok();
                i += 1;
            }
            "-H" => {
                crop_h = args[i + 1].parse::<f64>().ok();
                i += 1;
            }
            "-sz" => {
                if let Ok(v) = args[i + 1].parse::<f64>() {
                    crop_w = Some(v);
                    crop_h = Some(v);
                }
                i += 1;
            }
            "-tiffcompression" => {
                let comp = args[i + 1].to_ascii_lowercase();
                if !matches!(comp.as_str(), "none" | "packbits" | "deflate" | "lzw" | "jpeg" | "ccittrle" | "ccittfax3" | "ccittt4" | "ccittfax4" | "ccittt6") {
                    return err_out(
                        if quiet { "" } else { "Bad '-tiffcompression' value on command line\n" },
                        99,
                    );
                }
                tiff_compression = comp;
                i += 1;
            }
            "-aa" | "-aaVector" => {
                let v = args[i + 1].to_ascii_lowercase();
                if v != "yes" && v != "no" {
                    let msg = if quiet {
                        String::new()
                    } else {
                        format!("Bad '{arg}' value on command line\n")
                    };
                    return err_out(&msg, 99);
                }
                if arg == "-aaVector" { antialias = v == "yes"; } else { text_aa = v == "yes"; }
                i += 1;
            }
            "-thinlinemode" => {
                let v = args[i + 1].to_ascii_lowercase();
                if !matches!(v.as_str(), "none" | "solid" | "shape") {
                    return err_out(
                        if quiet { "" } else { "Bad '-thinlinemode' value on command line\n" },
                        99,
                    );
                }
                i += 1;
            }
            "-antialias" if is_cairo => {
                let v = args
                    .get(i + 1)
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if !matches!(
                    v.as_str(),
                    "default" | "none" | "gray" | "subpixel" | "fast" | "good" | "best"
                ) {
                    return err_out(
                        if quiet { "" } else { "Bad '-antialias' value on command line\n" },
                        99,
                    );
                }
                antialias = v != "none";
                text_aa = antialias;
                i += 1;
            }
            "-x" | "-y" => {
                let v = args[i+1].parse().unwrap_or(0.);
                if arg == "-x" {crop_x = v;} else {crop_y = v;}
                i += 1;
            }
            "-jpegopt" => {
                for part in args[i+1].split(',') {
                    if let Some(value) = part.strip_prefix("quality=")
                        && let Ok(n) = value.parse::<u8>() && n <= 100 { jpeg_quality = n; }
                }
                i += 1;
            }
            "-paper" | "-paperw" | "-paperh" | "-icc"
            | "-freetype" | "-defaultgray" | "-defaultrgb" | "-defaultcmyk" => {
                i += 1;
            }
            "-sep" => {
                sep = args[i + 1].clone();
                i += 1;
            }
            "-setpageno" => {
                set_pageno = args[i + 1].parse::<usize>().ok();
                i += 1;
            }
            "-upw" | "-opw" => {
                pw_opt = Some(args[i + 1].clone());
                i += 1;
            }
            "-cropbox" => cropbox = true,
            "-transp" => transparent = true,
            "-hide-annotations" | "-overprint" | "-level2"
            | "-level3" | "-origpagesizes" | "-nocrop" | "-expand" | "-noshrink"
            | "-nocenter" | "-duplex" => {}
            a if a == "-" || !a.starts_with('-') => pos.push(a.to_string()),
            a => {
                return err_out(&format!("Unknown option '{a}'\n"), 99);
            }
        }
        i += 1;
    }
    if !is_cairo && pos.len() > 2 {
        return err_out("Usage: pdftoppm [options] [PDF-file [PPM-root]]\n", 99);
    }
    let src_arg = pos.first().map(|s| s.as_str()).unwrap_or("-");
    let prefix_arg = pos.get(1).map(|s| s.as_str());
    let b = if src_arg == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, src_arg);
        if fs.is_dir(&full) {
            return err_out(
                if quiet { String::new() } else { format!("I/O Error: Couldn't open file '{src_arg}'\n") }.as_str(),
                1,
            );
        }
        let Ok(bytes) = fs.read_file(&full) else {
            return err_out(
                if quiet { String::new() } else { format!("I/O Error: Couldn't open file '{src_arg}'\n") }.as_str(),
                1,
            );
        };
        bytes
    };
    if b.is_empty() && !(is_cairo && matches!(fmt, "PDF" | "PS" | "EPS")) {
        return err_out(
            if quiet { "" } else { "Syntax Error: Document stream is empty\n" },
            1,
        );
    }
    if !b.starts_with(b"%PDF-") {
        return err_out(
            if quiet { "" } else { "PDF Error: Invalid PDF header: missing %PDF- signature\n" },
            1,
        );
    }
    let doc = PdfDoc::parse(&b);
    if let Some(ref enc_pw) = doc.encrypted {
        let supplied = pw_opt.as_deref().unwrap_or("");
        if !enc_pw.is_empty() && supplied != enc_pw {
            return err_out(
                if quiet { "" } else { "PDF Error: Invalid PDF password\n" },
                1,
            );
        }
    }
    let total = doc.pages.len().max(1);
    let end_p = last_p.unwrap_or(total).min(total);
    if first_p > total || first_p > end_p {
        let msg = if quiet {
            String::new()
        } else {
            format!("Command Line Error: Wrong page range given: the first page ({first_p}) can not be after the last page ({end_p}).\n")
        };
        return err_out(&msg, 99);
    }
    if matches!(fmt, "SVG" | "EPS" | "PS" | "PDF") {
        let pfx = prefix_arg.unwrap_or("out");
        let dst_rel = if pfx.ends_with(&format!(".{ext}")) {
            pfx.to_string()
        } else {
            format!("{pfx}.{ext}")
        };
        if fmt == "SVG" {
            let txt = doc.pages.get(first_p - 1).map(|p| p.text.clone()).unwrap_or_default();
            let svg = format!(
                "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><text x=\"20\" y=\"40\">{}</text></svg>\n",
                doc.page_w as i64,
                doc.page_h as i64,
                doc.page_w as i64,
                doc.page_h as i64,
                html_escape_str(&txt)
            );
            if pfx == "-" {
                return ok_out(&svg);
            }
            let dst = resolve_posix_path(cwd, &dst_rel);
            let _ = fs.write_file(&dst, svg.as_bytes());
            return ok_out("");
        }
        if fmt == "EPS" || fmt == "PS" {
            let eps = format!(
                "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 {} {}\n%%EndComments\n",
                doc.page_w as i64, doc.page_h as i64
            );
            if pfx == "-" {
                return ok_out(&eps);
            }
            let dst = resolve_posix_path(cwd, &dst_rel);
            let _ = fs.write_file(&dst, eps.as_bytes());
            return ok_out("");
        }
        if fmt == "PDF" {
            let mut sub = doc.clone();
            sub.pages = doc.pages[(first_p - 1)..end_p].to_vec();
            let ser = sub.serialize();
            if pfx == "-" {
                return ok_out(&crate::vfs::bytes_to_stream_string(&ser));
            }
            let dst = resolve_posix_path(cwd, &dst_rel);
            let _ = fs.write_file(&dst, &ser);
            return ok_out("");
        }
    }

    let compute_dims = |pno: usize| -> (u32, u32) {
        let (mut pw, mut ph, _) = doc
            .page_media
            .get(&pno)
            .copied()
            .unwrap_or((doc.page_w, doc.page_h, None));
        let rot = doc.pages.get(pno - 1).map(|p| p.rot).unwrap_or(0);
        if rot == 90 || rot == 270 {
            std::mem::swap(&mut pw, &mut ph);
        }
        let mut w = ((pw * dpi_x) / 72.0).round().max(1.0);
        let mut h = ((ph * dpi_y) / 72.0).round().max(1.0);
        let sx = scale_to_x.or(scale_to);
        let sy = scale_to_y.or(scale_to);
        if let (Some(tx), Some(ty)) = (sx, sy) {
            if tx > 0 && ty > 0 {
                let ratio = ((tx as f64) / w).min((ty as f64) / h);
                w = (w * ratio).round().max(1.0);
                h = (h * ratio).round().max(1.0);
            } else if tx > 0 && ty < 0 {
                let ratio = (tx as f64) / w;
                w = tx as f64;
                h = (h * ratio).round().max(1.0);
            } else if ty > 0 && tx < 0 {
                let ratio = (ty as f64) / h;
                h = ty as f64;
                w = (w * ratio).round().max(1.0);
            }
        } else if let Some(tx) = sx
            && tx > 0
        {
            let ratio = (tx as f64) / w;
            w = tx as f64;
            h = (h * ratio).round().max(1.0);
        } else if let Some(ty) = sy
            && ty > 0
        {
            let ratio = (ty as f64) / h;
            h = ty as f64;
            w = (w * ratio).round().max(1.0);
        }
        if let Some(cw) = crop_w
            && cw > 0.0
        {
            w = cw.round().min(w).max(1.0);
        }
        if let Some(ch) = crop_h
            && ch > 0.0
        {
            h = ch.round().min(h).max(1.0);
        }
        (w as u32, h as u32)
    };

    let mut selected_pages: Vec<usize> = Vec::new();
    for pno in first_p..=end_p {
        if odd_only && pno % 2 == 0 {
            continue;
        }
        if even_only && pno % 2 == 1 {
            continue;
        }
        selected_pages.push(pno);
        if singlefile {
            break;
        }
    }
    let options = pdf_reader::RasterOptions {
        splash: !is_cairo,
        tiff: (fmt == "TIFF").then_some((&tiff_compression, !is_cairo)),
        jpeg: (fmt == "JPEG").then_some((jpeg_quality, is_cairo && color_mode == "gray")),
        format: fmt, color: color_mode, transparent, antialias, text_aa, dpi: [dpi_x,dpi_y],
        scale: [scale_to.unwrap_or(0), scale_to_x.unwrap_or(0), scale_to_y.unwrap_or(0)],
        crop: [crop_x,crop_y,crop_w.unwrap_or(0.),crop_h.unwrap_or(0.)], cropbox, limit: fs.max_input_bytes(),
    };
    let mut source = if matches!(fmt, "TIFF" | "JPEG" | "PNG" | "PPM" | "PGM" | "PBM") { pdf_reader::PageSource::open(&b,pw_opt.as_deref().unwrap_or("")).ok() } else { None };
    let mut render = |pno| {
        if let Some(source) = source.as_mut() { return source.raster(pno, &options); }
        if matches!(fmt, "JPEG" | "TIFF") { return None; }
        let (w, h) = compute_dims(pno);
        Some(write_image_bytes(&ImageMeta {
            fmt: fmt.to_string(), w, h,
            cs: if matches!(fmt, "PGM" | "PBM") { "Gray".into() } else { "sRGB".into() },
            exif: BTreeMap::new(),
        }))
    };
    if prefix_arg.is_none() || prefix_arg == Some("-") {
        let mut bytes = Vec::new();
        let mut status = ok_out("");
        for pno in selected_pages {
            let Some(page) = render(pno) else { return err_out("PDF raster limit or invalid content stream\n", 1); };
            if page.len() > fs.max_input_bytes().saturating_sub(bytes.len()) { return err_out("PDF raster output exceeds byte limit\n",1); }
            bytes.extend(page);
            if progress && !quiet { status.stderr.push_str(&format!("{pno} {end_p} -\n")); }
        }
        status.stdout = crate::vfs::bytes_to_stream_string(&bytes);
        return status;
    }
    let pfx_rel = prefix_arg.unwrap();
    let pfx_full = resolve_posix_path(cwd, pfx_rel);
    let digits = total.to_string().len();
    let mut stderr_progress = String::new();
    for pno in &selected_pages {
        let Some(bytes) = render(*pno) else { return err_out("PDF raster limit or invalid content stream\n", 1); };
        let (rel_dst, dst) = if singlefile && !force_num {
            (format!("{pfx_rel}.{ext}"), format!("{pfx_full}.{ext}"))
        } else {
            let out_num = set_pageno.map(|base| base + *pno - first_p).unwrap_or(*pno);
            let width = digits.max(out_num.to_string().len());
            let num_str = format!("{out_num:0width$}", width = width);
            (
                format!("{pfx_rel}{sep}{num_str}.{ext}"),
                format!("{pfx_full}{sep}{num_str}.{ext}"),
            )
        };
        if !fs.is_dir(&crate::vfs::dirname_posix_path(&dst)) || fs.write_file(&dst, &bytes).is_err() {
            let (code, message) = if is_cairo {
                (2, format!("Error opening output file {rel_dst}\n"))
            } else {
                (1, format!("Could not write image to {rel_dst}; exiting\n"))
            };
            stderr_progress.push_str(&message);
            return err_out(&stderr_progress, code);
        }
        if progress && !quiet {
            stderr_progress.push_str(&format!("{pno} {end_p} {rel_dst}\n"));
        }
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr: stderr_progress,
        exit_code: 0,
    }
}

fn cmd_pdfimages(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.iter().any(|a| a == "-v" || a == "--version") {
        return ok_out("pdfimages version 24.08.0\n");
    }
    if args
        .iter()
        .any(|a| matches!(a.as_str(), "-h" | "-help" | "--help" | "-?"))
    {
        return ok_out("Usage: pdfimages [options] <PDF-file> <image-root>\n       pdfimages -list [options] <PDF-file>\n  -list / -png / -j / -all / -f <int> / -l <int> / -p\n  -min-width <int> / -min-height <int> : ignore smaller images\n");
    }
    let mut quiet = false;
    let mut list_mode = false;
    let mut page_nums = false;
    let mut unique = false;
    let (mut min_width, mut min_height) = (0,0);
    let mut print_names = false;
    let mut png_mode = false;
    let mut tiff_mode = false;
    let mut ccitt_mode = false;
    let mut jpeg_mode = false;
    let mut all_mode = false;
    let mut first_p: Option<usize> = None;
    let mut last_p: Option<usize> = None;
    let mut pw_opt: Option<String> = None;
    let mut pos: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-list" => list_mode = true,
            "-p" => page_nums = true,
            "-print-filenames" => print_names = true,
            "-png" => png_mode = true,
            "-tiff" => tiff_mode = true,
            "-j" => jpeg_mode = true,
            "-all" => all_mode = true,
            "-u" => unique=true, "-q" => quiet = true,
            "-ccitt" => ccitt_mode = true,
            "-jp2" | "-jbig2" => {}
            "-f" => {
                let Some(raw) = args.get(i + 1) else {
                    return err_out("Missing value for '-f'\n", 99);
                };
                let Ok(v) = raw.parse::<isize>() else {
                    return err_out("Bad '-f' value on command line\n", 99);
                };
                first_p = Some(v.max(1) as usize);
                i += 1;
            }
            "-l" => {
                let Some(raw) = args.get(i + 1) else {
                    return err_out("Missing value for '-l'\n", 99);
                };
                let Ok(v) = raw.parse::<isize>() else {
                    return err_out("Bad '-l' value on command line\n", 99);
                };
                if v > 0 {
                    last_p = Some(v as usize);
                } else {
                    last_p = None;
                }
                i += 1;
            }
            "-min-width" | "-min-height" => {
                let flag = args[i].as_str();
                let Some(raw) = args.get(i + 1) else {
                    return err_out(&format!("Missing value for '{flag}'\n"), 99);
                };
                let Ok(value)=raw.parse::<isize>() else {return err_out(&format!("Bad '{flag}' value on command line\n"),99);};
                if flag=="-min-width" {min_width=value.max(0) as usize;} else {min_height=value.max(0) as usize;}
                i += 1;
            }
            "-upw" | "-opw" => {
                let flag = args[i].as_str();
                let Some(v) = args.get(i + 1) else {
                    return err_out(&format!("Missing value for '{flag}'\n"), 99);
                };
                pw_opt = Some(v.clone());
                i += 1;
            }
            a if a == "-" || !a.starts_with('-') => pos.push(a.to_string()),
            a => return err_out(&format!("Unknown option '{a}'\n"), 99),
        }
        i += 1;
    }
    if pos.is_empty() || pos.len() != (if list_mode { 1 } else { 2 }) {
        return err_out(
            if list_mode {
                "Usage: pdfimages -list [options] <PDF-file>\n"
            } else {
                "Usage: pdfimages [options] <PDF-file> <image-root>\n"
            },
            99,
        );
    }
    let b = if pos[0] == "-" {
        crate::vfs::stream_string_to_bytes(stdin)
    } else {
        let full = resolve_posix_path(cwd, &pos[0]);
        let Ok(bytes) = fs.read_file(&full) else {
            return err_out(&format!("I/O Error: Couldn't open file '{}'\n", pos[0]), 1);
        };
        bytes
    };
    if b.is_empty() {
        return err_out("Syntax Error: Document stream is empty\n", 1);
    }
    if !b.starts_with(b"%PDF-") {
        return err_out("PDF Error: Invalid PDF header: missing %PDF- signature\n", 1);
    }
    let password = pw_opt.as_deref().unwrap_or("");
    let incorrect_password = || err_out(if quiet { "" } else { "Command Line Error: Incorrect password\n" }, 1);
    let source = match pdf_reader::PageSource::open(&b, password) {
        Ok(source) => Ok(source),
        Err(pdf_reader::PASSWORD) => return incorrect_password(),
        Err(pdf_reader::UNSUPPORTED) => return err_out(if quiet { "" } else { "PDF Error: Unsupported PDF encryption\n" }, 1),
        Err(_) => {
            let doc = PdfDoc::parse(&b);
            if doc.encrypted.as_ref().is_some_and(|p| !p.is_empty() && p != password) {
                return incorrect_password();
            }
            Err(doc)
        }
    };
    let total_pages = match &source { Ok(s) => s.len(), Err(doc) => doc.pages.len() }.max(1);
    let start_p = first_p.unwrap_or(1);
    let end_p = last_p.unwrap_or(total_pages).min(total_pages);
    if start_p > end_p {
        return err_out(
            &format!(
                "Command Line Error: Wrong page range given: the first page ({start_p}) can not be after the last page ({end_p}).\n"
            ),
            99,
        );
    }
    let doc = match source { Err(doc) => doc, Ok(mut source) => {
        let mut idx = 0;
        let mut seen = std::collections::BTreeSet::new();
        let mut out = if list_mode {
            "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n".to_owned()
        } else {
            String::new()
        };
        let mut outputs = Vec::new();
        let mut remaining = fs.shell_limits().max_output_bytes;
        for page in start_p..=end_p {
            let mode = if list_mode { pdf_reader::ImageRead::List } else { pdf_reader::ImageRead::Extract { fax: ccitt_mode || all_mode, jpeg: jpeg_mode || all_mode, png: png_mode || all_mode, tiff: tiff_mode || all_mode } };
            let done = source.images(page, fs.max_input_bytes(), mode, |im, parent| {
                let (w, h) = (im.width, im.height);
                if w < min_width || h < min_height || unique && !seen.insert(im.id) {
                    return Some(());
                }
                if list_mode {
                    out.push_str(&im.listing(page, idx, parent));
                } else {
                    let root = &pos[1];
                    let base = if page_nums { format!("{root}-{page:03}-{idx:03}") } else { format!("{root}-{idx:03}") };
                    let mut stage = |ext: &str, bytes: Vec<u8>| {
                        remaining = remaining.checked_sub(bytes.len())?;
                        let name = format!("{base}.{ext}");
                        if print_names { out.push_str(&name); out.push('\n'); }
                        outputs.push((name, bytes));
                        Some(())
                    };
                    if let Some(native) = im.native {
                        match native {
                            pdf_reader::NativeImage::Jpeg(data) => stage("jpg",data)?,
                            pdf_reader::NativeImage::Pbm(data) => stage("pbm",data)?,
                            pdf_reader::NativeImage::Fax(data,params) => {
                                stage("ccitt", data)?;
                                stage("params", params.into_bytes())?;
                            }
                        }
                    } else {
                        let (ext, format) = match mode.format(im.components)? {
                            "TIFF" => ("tif", "TIFF"), "PNG" => ("png", "PNG"),
                            _ if im.bilevel() => ("pbm", "PBM"), _ => ("ppm", "PPM"),
                        };
                        stage(ext, im.encode(format, fs.max_input_bytes(), true)?)?;
                    }
                }
                idx += 1;
                Some(())
            });
            if done.is_none() {
                return err_out("PDF Error: Invalid or oversized PDF image\n", 1);
            }
        }
        for (name, data) in outputs {
            let path = resolve_posix_path(cwd, &name);
            let version = fs.generation();
            let result = fs.access_path(&path, true).and_then(|entry| {
                let parent = fs.stat(&crate::vfs::dirname_posix_path(&entry))?;
                if parent.mode & 0o300 != 0o300 {
                    return Err("EACCES".into());
                }
                let stamp=fs.observe_publication(&entry,version,crate::vfs::PublicationMode::Write)?;
                fs.publish_file(&entry, &data, &[], stamp.version)
            });
            if result.is_err() {
                return BuiltinOutcome {
                    stdout: out,
                    stderr: format!("I/O Error: Couldn't open image file '{name}'\n"),
                    exit_code: 2,
                };
            }
        }
        return ok_out(&out);
    }};
    let mut all_imgs: Vec<(usize, u32, u32, String)> = Vec::new();
    for (pidx, pg) in doc.pages.iter().enumerate() {
        let pno = pidx + 1;
        if pno < start_p || pno > end_p {
            continue;
        }
        for (w, h, im_fmt) in &pg.images {
            all_imgs.push((pno, *w, *h, im_fmt.clone()));
        }
    }
    if list_mode {
        let mut out = String::from(
            "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n",
        );
        for (idx, (pno, w, h, im_fmt)) in all_imgs.iter().enumerate() {
            let enc = if im_fmt.eq_ignore_ascii_case("JPEG") || im_fmt.eq_ignore_ascii_case("JPG") {
                "jpeg"
            } else {
                "image"
            };
            let obj_id = 5 + idx * 2;
            out.push_str(&format!(
                "{pno:4}  {idx:4} image  {w:5} {h:6} rgb     3   8  {enc:<5} no      {obj_id:4}  0    72    72 128B  10%\n"
            ));
        }
        return ok_out(&out);
    }
    let prefix = &pos[1];
    let mut out = String::new();
    for (idx, (pno, w, h, im_fmt)) in all_imgs.iter().enumerate() {
        let is_jpg = im_fmt.eq_ignore_ascii_case("JPEG") || im_fmt.eq_ignore_ascii_case("JPG");
        let (ext, fmt) = if tiff_mode {
            ("tif", "TIFF")
        } else if all_mode {
            if is_jpg { ("jpg", "JPEG") } else { ("png", "PNG") }
        } else if jpeg_mode && is_jpg {
            ("jpg", "JPEG")
        } else if png_mode {
            ("png", "PNG")
        } else {
            ("ppm", "PPM")
        };
        let rel_name = if page_nums {
            format!("{prefix}-{pno:03}-{idx:03}.{ext}")
        } else {
            format!("{prefix}-{idx:03}.{ext}")
        };
        let full_out = resolve_posix_path(cwd, &rel_name);
        let im = ImageMeta {
            fmt: fmt.to_string(),
            w: *w,
            h: *h,
            cs: "sRGB".to_string(),
            exif: BTreeMap::new(),
        };
        let _ = fs.write_file(&full_out, &write_image_bytes(&im));
        if print_names {
            out.push_str(&format!("{rel_name}\n"));
        }
    }
    ok_out(&out)
}

fn cmd_magick(cmd: &str, args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if (cmd == "magick" || cmd == "convert")
        && let Some(first) = args.first()
        && matches!(
            first.as_str(),
            "identify" | "mogrify" | "convert" | "composite" | "montage" | "compare"
        )
    {
        return cmd_media_doc(first, &args[1..], stdin, cwd, fs);
    }
    if let Some(list_out) = try_magick_list_option(args) {
        return list_out;
    }
    if cmd!="mogrify" && args.iter().any(|a| a=="-composite") && let Some(r)=magick_composite::run(cmd,args,cwd,fs) { return r; }
    let is_mogrify = cmd == "mogrify";
    if !is_mogrify && args.is_empty() {
        return ok_out("Usage: magick [input-options] input-file [operators] output-file\n");
    }
    for a in args {
        if a == "--" {
            break;
        }
        if !is_mogrify && (a == "-version" || a == "--version") {
            return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
        }
        if a == "-help" || a == "--help" || a == "-h" {
            if !is_mogrify {
                return ok_out("Usage: magick [input-options] input-file [operators] output-file\n");
            }
            return ok_out("");
        }
    }
    let mut size_opt: Option<(u32, u32)> = None;
    use magick_resize::Kernel;
    use magick_coordinates::{Geometry,Gravity};
    let mut gravity=Gravity::parse("northwest");
    let mut background=[255;4];
    let mut fill=[0,0,0,255];
    let mut border_color=[223,223,223,255];
    let mut fuzz=10.;
    let mut quality=92.;
    let mut adjoin=true;
    let (mut delay, mut repeat) = (None, None);
    enum PixelOp<'a> { Modulate([f64;3]), Tint([u8;4]), Replace([u8;4],Option<[u8;4]>,f64,bool), Linear(f64,f64), Sigmoid(&'a str), Level(&'a str,bool), Histogram(magick_histogram::Adjustment<'a>), Sepia(f64), Solarize(f64), Posterize(f64), Raise(Geometry,bool), Vignette([u8;4]), Shadow(Geometry,[u8;4]), Gamma(f64), Trim(f64), Clear, Morph(String,(usize,usize)), Convolve(Vec<f64>,f64), Blur(f64), Sharpen(f64), Alpha(String,[u8;4]), Roll(Geometry), Chop(Geometry,Gravity), Splice(Geometry,Gravity,[u8;4]), Shave(Geometry), Crop(Geometry,Gravity), Extent(Geometry,Gravity,[u8;4]), Border(Geometry,[u8;4]), Rotate(f64,[u8;4]), Resize(&'a str,Kernel), Negate([bool;4],bool), Threshold(f64), ClipThreshold(f64,bool), Gray, Flip, Flop, AutoOrient }
    let mut ops = Vec::new();
    let mut stack_steps=Vec::new();
    let mut kernel = Kernel::Lanczos3;
    let mut resize_spec: Option<String> = None;
    let mut crop_opt: Option<(u32, u32)> = None;
    let mut border_opt: Option<(u32, u32)> = None;
    let mut extent_opt: Option<(u32, u32)> = None;
    let mut rot_deg = 0i32;
    let mut transpose_swaps = 0usize;
    let mut channels = None;
    let mut append_mode: Option<bool> = None;
    let mut mogrify_format: Option<String> = None;
    let mut mogrify_path: Option<String> = None;
    let mut canvas = None;
    let mut has_pseudo_input = false;
    let mut pos_files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        let base=magick_stack::input_spec(arg).0;
        if i + 1 < args.len() && let Some(parsed) = Canvas::parse(base) {
            if !is_mogrify && pos_files.is_empty() && !has_pseudo_input { ops.clear();stack_steps.clear(); }
            let size=if base.eq_ignore_ascii_case("null:"){(1,1)}else{size_opt.unwrap_or((1,1))};
            canvas = Some((match parsed {
                Ok(c) => c,
                Err(e) => return err_out(&format!("magick: {e}\n"), 1),
            },size));
            stack_steps.push((ops.len(),magick_stack::Step::Input(arg,size,kernel)));
            has_pseudo_input = true;
            i += 1;
            continue;
        }
        match args[i].as_str() {
            "-size" if i + 1 < args.len() => {
                size_opt=Some(Geometry::canvas_size(&args[i+1]));
                i += 2;
            }
            "-resize" | "-scale" | "-sample" | "-thumbnail" if i + 1 < args.len() => {
                ops.push(PixelOp::Resize(&args[i+1], if arg=="-sample" {Kernel::Nearest} else {kernel}));
                resize_spec = Some(args[i + 1].clone());
                i += 2;
            }
            "-roll" | "-splice" | "-chop" | "-shave" if i+1<args.len() => {
                let g=Geometry::parse(&args[i+1]);
                ops.push(match arg.as_str() {
                    "-roll" => PixelOp::Roll(g),
                    "-splice" => PixelOp::Splice(g,gravity,background),
                    "-chop" => PixelOp::Chop(g,gravity),
                    _ => PixelOp::Shave(g),
                });
                i+=2;
            }
            "-crop" if i + 1 < args.len() => {
                ops.push(PixelOp::Crop(Geometry::parse(&args[i+1]), gravity));
                let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                if let Some((ws, hs)) = s.split_once('x') {
                    crop_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                }
                i += 2;
            }
            "-border" | "-frame" if i + 1 < args.len() => {
                ops.push(PixelOp::Border(Geometry::parse(&args[i+1]),border_color));
                let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                if let Some((ws, hs)) = s.split_once('x') {
                    border_opt = Some((ws.parse().unwrap_or(0), hs.parse().unwrap_or(0)));
                } else if let Ok(bw) = s.parse::<u32>() {
                    border_opt = Some((bw, bw));
                }
                i += 2;
            }
            "-extent" if i + 1 < args.len() => {
                ops.push(PixelOp::Extent(Geometry::parse(&args[i+1]),gravity,background));
                let s = args[i + 1].split(['+', '-']).next().unwrap_or("");
                if let Some((ws, hs)) = s.split_once('x') {
                    extent_opt = Some((ws.parse().unwrap_or(32), hs.parse().unwrap_or(32)));
                }
                i += 2;
            }
            "-rotate" if i + 1 < args.len() => {
                let angle=args[i+1].parse::<f64>().unwrap_or(f64::NAN);
                ops.push(PixelOp::Rotate(angle,background));
                rot_deg=(rot_deg+(angle%360.) as i32)%360;
                i += 2;
            }
            "-transpose" | "-transverse" => {
                ops.push(if arg=="-transpose" {PixelOp::Flip} else {PixelOp::Flop});
                ops.push(PixelOp::Rotate(90.,background));
                transpose_swaps += 1;
                i += 1;
            }
            "-filter" if i+1 < args.len() => {kernel=Kernel::parse(&args[i+1]);i+=2;}
            "-fuzz" => {
                let value=if i+1<args.len()-usize::from(!is_mogrify){i+=1;magick_fuzz(&args[i])}else{10.};
                fuzz=(value+0.5).floor();i+=1;
            }
            "-trim" => {ops.push(PixelOp::Trim(fuzz));i+=1;}
            "-gamma" => {
                let g=if i+1<args.len()-usize::from(!is_mogrify){i+=1;js_number(&args[i],0.)}else{1.};
                ops.push(PixelOp::Gamma(g));i+=1;
            }
            "-auto-orient" => {ops.push(PixelOp::AutoOrient);i+=1;}
            "-flip" | "-flop" => {ops.push(if arg=="-flip" {PixelOp::Flip}else{PixelOp::Flop});i+=1;}
            "-channel" if i+1<args.len() => { channels=Some(magick_color::channel_mask(&args[i+1]));i+=2; }
            "+channel" => { channels=None;i+=1; }
            "-negate" | "+negate" => {
                ops.push(PixelOp::Negate(channels.unwrap_or([true,true,true,false]),arg=="+negate"));
                i += 1;
            }
            "+clone"|"-clone"|"+duplicate"|"-duplicate"|"+delete"|"-delete"|"+swap"|"-swap"|"-reverse"|"+insert"|"-insert" => {
                let mut spec=match arg.as_str(){"+swap"|"-swap"=>"-2,-1","+insert"|"-insert"=>"0",_=>"-1"};
                let mut count=1;
                let has_value=i+1<args.len()-usize::from(!is_mogrify);
                if has_value && matches!(arg.as_str(),"-clone"|"-delete"|"-swap"|"-insert") {
                    i+=1;spec=&args[i];
                } else if has_value && arg=="-duplicate" && args[i+1].as_bytes().first().is_some_and(u8::is_ascii_digit) {
                    i+=1;
                    let value=&args[i];
                    let digits=value.bytes().take_while(u8::is_ascii_digit).count();
                    count=value[..digits].parse().unwrap_or(usize::MAX);
                    if let Some((_,s))=value.split_once(',') && !s.is_empty() {spec=s;}
                }
                stack_steps.push((ops.len(),magick_stack::Step::Edit(arg,spec,count)));
                i+=1;
            }
            "-append" => {
                stack_steps.push((ops.len(),magick_stack::Step::Append(true,gravity,background)));
                append_mode = Some(true);
                i += 1;
            }
            "+append" => {
                stack_steps.push((ops.len(),magick_stack::Step::Append(false,gravity,background)));
                append_mode = Some(false);
                i += 1;
            }
            "-format" if is_mogrify && i + 1 < args.len() => {
                mogrify_format = Some(args[i + 1].trim_start_matches('.').to_ascii_lowercase());
                i += 2;
            }
            "-path" if is_mogrify && i + 1 < args.len() => {
                mogrify_path = Some(args[i + 1].clone());
                i += 2;
            }
            "-colorspace" | "-grayscale" if i + 1 < args.len() => {
                let space = args[i + 1].to_ascii_lowercase();
                if space.contains("gray") || space.contains("grey") || matches!(space.as_str(), "rec709luma" | "rec601luma") {
                    ops.push(PixelOp::Gray);
                }
                i += 2;
            }
            "-gravity" if i+1 < args.len() => {gravity=Gravity::parse(&args[i+1]);i+=2;}
            "-fill" | "-background" | "-bordercolor" => {
                let color=if i+1<args.len()-usize::from(!is_mogrify){
                    i+=1;match parse_color(&args[i]){Ok(c)=>c,Err(e)=>return err_out(&format!("magick: {e}\n"),1)}
                }else{match arg.as_str(){"-fill"=>[0,0,0,255],"-bordercolor"=>[223,223,223,255],_=>[255;4]}};
                match arg.as_str(){"-fill"=>fill=color,"-background"=>background=color,_=>border_color=color};
                i+=1;
            }
            "-opaque" | "+opaque" | "-transparent" | "+transparent" => {
                let opaque=arg.ends_with("opaque");
                let color=if i+1<args.len()-usize::from(!is_mogrify){
                    i+=1;match parse_color(&args[i]){Ok(c)=>c,Err(e)=>return err_out(&format!("magick: {e}\n"),1)}
                }else if opaque{[0,0,0,255]}else{[255;4]};
                ops.push(PixelOp::Replace(color,opaque.then_some(fill),fuzz,arg.starts_with('+')));i+=1;
            }
            "-modulate" => {
                let spec=if i+1<args.len()-usize::from(!is_mogrify){i+=1;args[i].as_str()}else{"100"};
                let mut parts=spec.split(',');
                ops.push(PixelOp::Modulate(std::array::from_fn(|_|parts.next().map_or(100.,|s|js_number(s,0.)))));i+=1;
            }
            "-tint" | "-colorize" => {
                if i+1<args.len()-usize::from(!is_mogrify){i+=1;}
                ops.push(PixelOp::Tint(fill));i+=1;
            }
            "-quality" if i+1<args.len()=>{quality=js_number(&args[i+1],1.);i+=2;}
            "-write" | "+write" => {
                if i+1<args.len()-usize::from(!is_mogrify) {
                    i+=1;
                    stack_steps.push((ops.len(),magick_stack::Step::Write(&args[i],quality,adjoin)));
                }
                i+=1;
            }
            "-adjoin" | "+adjoin" => {adjoin=arg=="-adjoin";i+=1;}
            "-delay" | "-loop" if i+1<args.len() => {
                let n=js_number(&args[i+1],0.);
                if arg=="-delay" { delay=Some((n.round().max(0.) % 65536.) as u16); }
                else { repeat=Some(((n-1.).trunc().max(0.) % 65536.) as u16); }
                i+=2;
            }
            "-alpha" if i+1<args.len() => {ops.push(PixelOp::Alpha(args[i+1].to_ascii_lowercase(),background));i+=2;}
            "-threshold" | "-black-threshold" | "-white-threshold" => {
                let has_value=i+1<args.len()-usize::from(!is_mogrify);
                let raw=if has_value {i+=1;args[i].as_str()} else {"50%"};
                let value=magick_color::threshold_value(raw);
                ops.push(if arg=="-threshold" {PixelOp::Threshold(value.round())} else {PixelOp::ClipThreshold(value,arg=="-white-threshold")});
                i+=1;
            }
            "-monochrome" => {ops.push(PixelOp::Gray);ops.push(PixelOp::Threshold(128.));i+=1;}
            "-median" => {
                let size=if i+1<args.len()-usize::from(!is_mogrify){
                    i+=1;js_number(&args[i],0.)
                }else{3.};
                let r=(size.round()/2.).floor().max(1.) as usize;
                ops.push(if size.is_nan(){PixelOp::Clear}else{PixelOp::Morph("median".into(),(r,r))});i+=1;
            }
            "-morphology" | "-statistic" => {
                let end=args.len()-usize::from(!is_mogrify);
                let method=if i+1<end{i+=1;args[i].to_ascii_lowercase()}else if arg=="-statistic"{"median".into()}else{"dilate".into()};
                i+=1;
                let spec=if i<end && (arg=="-statistic" || !args[i].starts_with(['-','+'])){
                    i+=1;args[i-1].as_str()
                }else if arg=="-statistic"{"3x3"}else{""};
                if arg=="-morphology" && (method.contains("convolve") || method.contains("correlate")){
                    match magick_filter::kernel(spec,fs.max_input_bytes()) {
                        Ok(weights)=>ops.push(PixelOp::Convolve(weights,0.)),
                        Err(e)=>return err_out(&format!("magick: {e}\n"),1),
                    }
                }else{ops.push(PixelOp::Morph(method,magick_morphology::radii(spec)));}
            }
            "-contrast" | "+contrast" => {
                let slope=if arg=="-contrast"{1.15}else{0.87};
                ops.push(PixelOp::Linear(slope,128.*(1.-slope)));i+=1;
            }
            "-brightness-contrast" | "-sigmoidal-contrast" | "+sigmoidal-contrast" | "-level" | "+level" => {
                let spec=if i+1<args.len()-usize::from(!is_mogrify){i+=1;args[i].as_str()}else{match arg.as_str(){"-brightness-contrast"=>"0x0","-level"|"+level"=>"0,100%",_=>"3x50%"}};
                ops.push(match arg.as_str(){
                    "-brightness-contrast"=>{let (slope,offset)=Geometry::parse(spec).brightness_contrast();PixelOp::Linear(slope,offset)}
                    "-level"|"+level"=>PixelOp::Level(spec,arg=="+level"),
                    _=>PixelOp::Sigmoid(spec),
                });i+=1;
            }
            "-auto-level" | "-auto-gamma" | "-normalize" | "-equalize" | "-contrast-stretch" | "-linear-stretch" => {
                use magick_histogram::Adjustment;
                let op=match arg.as_str(){
                    "-auto-level"=>Adjustment::AutoLevel(channels),
                    "-auto-gamma"=>Adjustment::AutoGamma,
                    "-equalize"=>Adjustment::Equalize,
                    "-normalize"=>Adjustment::Stretch("2%x1%"),
                    _=>Adjustment::Stretch(if i+1<args.len()-usize::from(!is_mogrify){i+=1;&args[i]}else{"0%x0%"}),
                };
                ops.push(PixelOp::Histogram(op));i+=1;
            }
            "-sepia-tone" | "-solarize" | "-posterize" | "-colors" => {
                let value=if i+1<args.len()-usize::from(!is_mogrify){i+=1;args[i].as_str()}else{match arg.as_str(){"-sepia-tone"=>"80%","-solarize"=>"50%",_=>"8"}};
                ops.push(match arg.as_str(){
                    "-sepia-tone"=>{
                        let n=parse_float_prefix(value);
                        let strength=if value.ends_with('%'){n}else{n/255.}/100.;
                        PixelOp::Sepia(if strength.is_nan() || strength==0.{0.8}else{strength.clamp(0.,1.)})
                    }
                    "-solarize"=>PixelOp::Solarize(magick_fuzz(value)),
                    _=>PixelOp::Posterize(js_number(value,0.).round().clamp(2.,256.)),
                });i+=1;
            }
            "-raise" | "+raise" | "-vignette" | "-shadow" => {
                let spec=if i+1<args.len()-usize::from(!is_mogrify){i+=1;args[i].as_str()}else if arg=="-shadow"{"80x3+5+5"}else{"4"};
                ops.push(match arg.as_str(){
                    "-shadow"=>PixelOp::Shadow(Geometry::parse(spec),background),
                    "-vignette"=>PixelOp::Vignette(background),
                    _=>PixelOp::Raise(Geometry::parse(spec),arg=="-raise"),
                });i+=1;
            }
            "-convolve" | "-edge" | "-canny" | "-emboss" | "-charcoal" | "-sketch" => {
                let spec=if i+1<args.len()-usize::from(!is_mogrify) {i+=1;args[i].as_str()}else{"1"};
                let charcoal=matches!(arg.as_str(),"-charcoal"|"-sketch");
                let weights=match arg.as_str(){
                    "-convolve"=>match magick_filter::kernel(spec,fs.max_input_bytes()){
                        Ok(weights)=>weights,Err(e)=>return err_out(&format!("magick: {e}\n"),1),
                    },
                    "-emboss"=>vec![-2.,-1.,0.,-1.,1.,1.,0.,1.,2.],
                    _=>vec![-1.,-1.,-1.,-1.,8.,-1.,-1.,-1.,-1.],
                };
                if charcoal{ops.push(PixelOp::Blur(1.));}
                ops.push(PixelOp::Convolve(weights,if arg=="-emboss"{128.}else{0.}));
                if charcoal{ops.push(PixelOp::Negate([true,true,true,false],false));ops.push(PixelOp::Gray);}
                i+=1;
            }
            "-blur" | "-gaussian-blur" | "-sharpen" | "-unsharp" => {
                let has_value=i+1<args.len()-usize::from(!is_mogrify);
                let g=if has_value{i+=1;args[i].as_str()}else{"0x1"};
                let sigma=Geometry::parse(g).sigma();
                ops.push(if matches!(arg.as_str(),"-blur"|"-gaussian-blur"){PixelOp::Blur(sigma)}else{PixelOp::Sharpen(sigma)});i+=1;
            }
            "-depth"
            | "-density" | "-pointsize" | "-font" | "-stroke" | "-strokewidth"
            | "-draw" | "-annotate" | "-define"
                if i + 1 < args.len() =>
            {
                i += 2;
            }
            a if a == "rose:" || a == "logo:" || a == "wizard:" || a == "granite:" => {
                if size_opt.is_none() {
                    size_opt = Some((70, 46));
                }
                has_pseudo_input = true;
                i += 1;
            }
            a if !a.starts_with('-') && !a.starts_with('+') =>
            {
                if !is_mogrify && pos_files.is_empty() && !has_pseudo_input { ops.clear();stack_steps.clear(); }
                if i+1<args.len() {stack_steps.push((ops.len(),magick_stack::Step::Input(arg,size_opt.unwrap_or((1,1)),kernel)));}
                pos_files.push(a.to_string());
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }
    let has_writes=stack_steps.iter().any(|(_,s)|matches!(s,magick_stack::Step::Write(..)));
    let use_stack=has_writes || (!is_mogrify && (stack_steps.len()>1 || stack_steps.iter().any(|(_,s)|match s {
        magick_stack::Step::Input(token,_,_)=>magick_stack::tile_pattern(token).is_some() || !matches!(magick_stack::input_spec(token).1,magick_stack::Modifier::None),_=>false,
    }))) || stack_steps.iter().any(|(_,s)|matches!(s,magick_stack::Step::Edit(..)));
    let apply_pixels = |image: &mut png_pixels::Raster, range: std::ops::Range<usize>, gif_input: bool| {
        // GIFs decode to four channels even if they did not declare transparency.
        let mut channels = if gif_input { 4 } else { (if image.gray {1} else {3}) + u8::from(image.alpha) };
        for op in &ops[range] {
            if image.width==0 || image.height==0 {
                match op {
                    PixelOp::Extent(..) | PixelOp::Splice(..) | PixelOp::Roll(..) | PixelOp::Chop(..) | PixelOp::Negate(..) | PixelOp::Alpha(..) => {}
                    PixelOp::Crop(..) => return Err("internal error"),
                    _ => return Err("Invalid stored image dimensions"),
                }
            }
            match op {
                PixelOp::Modulate(values)=>{image.modulate(*values);channels=if image.alpha{4}else{3};},
                PixelOp::Tint(fill)=>{image.tint(*fill);channels=if image.alpha{4}else{3};},
                PixelOp::Replace(target,fill,fuzz,invert)=>image.replace_color(*target,*fill,*fuzz,*invert),
                PixelOp::Linear(slope,offset)=>image.linear(*slope,*offset,channels==2),
                PixelOp::Sigmoid(spec)=>image.sigmoidal_contrast(spec),
                PixelOp::Level(spec,inverse)=>image.level(spec,*inverse),
                PixelOp::Histogram(op)=>op.apply(image),
                PixelOp::Sepia(strength)=>image.sepia(*strength),
                PixelOp::Solarize(threshold)=>for p in &mut image.pixels {for c in &mut p[..3] {if f64::from(*c)>*threshold {*c=255-*c;}}},
                PixelOp::Posterize(levels)=>image.posterize(*levels),
                PixelOp::Raise(g,raised)=>image.raise(*g,*raised),
                PixelOp::Vignette(bg)=>image.vignette(*bg),
                PixelOp::Shadow(g,bg)=>image.shadow(*g,*bg,fs.max_input_bytes())?,
                PixelOp::Gamma(g)=>image.gamma(*g),
                PixelOp::Trim(fuzz)=>image.trim(*fuzz,fs.max_input_bytes())?,
                PixelOp::Clear=>image.pixels.fill([0;4]),
                PixelOp::Morph(method,radii)=>image.morphology(method,*radii,fs.max_input_bytes())?,
                PixelOp::Convolve(weights,bias)=>image.convolve_rgb(weights,*bias,fs.max_input_bytes())?,
                PixelOp::Sharpen(sigma)=>image.sharpen(*sigma,image.alpha || matches!(channels,2|4)),
                PixelOp::Blur(sigma)=>image.blur(*sigma,image.alpha || matches!(channels,2|4)),
                PixelOp::Alpha(mode,bg) => if !image.pixels.is_empty() {image.apply_alpha(mode,*bg,&mut channels);},
                PixelOp::Roll(g) => image.roll(*g),
                PixelOp::Splice(g,gravity,bg) => image.splice(*g,*gravity,*bg,fs.max_input_bytes())?,
                PixelOp::Chop(g,gravity) => image.chop(*g,*gravity),
                PixelOp::Shave(g) => image.shave(*g),
                PixelOp::Crop(g,gravity) => image.crop(*g,*gravity),
                PixelOp::Extent(g,gravity,bg) => {image.extent(*g,*gravity,*bg,fs.max_input_bytes())?;channels=4;},
                PixelOp::Border(g,bg) => image.border(*g,*bg,fs.max_input_bytes())?,
                PixelOp::Rotate(deg,bg) => {if !deg.is_finite() {return Err("Invalid rotation angle");}image.rotate(*deg,*bg,fs.max_input_bytes())?;},
                PixelOp::Resize(size,kernel) => image.resize(size,*kernel,fs.max_input_bytes())?,
                PixelOp::Negate(ch,only_gray) => for p in &mut image.pixels { magick_color::negate(p,*ch,*only_gray); },
                PixelOp::Threshold(value) => image.threshold(*value),
                PixelOp::ClipThreshold(value,white) => image.clip_threshold(*value,*white),
                PixelOp::Gray => {channels=1;image.gray=true; for p in &mut image.pixels {let v=magick_color::gray(p[0],p[1],p[2]);p[..3].fill(v);}},
                PixelOp::Flip => image.orient(4),
                PixelOp::Flop => image.orient(2),
                PixelOp::AutoOrient => {image.orient(image.orientation.unwrap_or(1));image.orientation=Some(1);},
            }
        }
        if image.width==0 || image.height==0 {return Err("internal error");}
        Ok(matches!(channels,2|4))
    };
    let raster_output = |input: &str, bytes: &[u8], dest: &str| -> Option<BuiltinOutcome> {
        let info=matches!(dest.to_ascii_lowercase().as_str(),"info:"|"info:-");
        let dest=png_pixels::destination(dest).or_else(||has_writes.then_some(("png",dest)))?;
        let fail = |e: &str| if e == "internal error" { err_out("shell: line 1: internal error\n",1) } else { err_out(&format!("magick: {e}\n"),1) };
        let timing=gif::Timing { delays:delay.as_slice(), repeat, explicit_delay:delay.is_some() };
        let gif_input = canvas.is_none() && gif::signature(bytes) && !bytes[6..].starts_with(b"\n__IMG__:");
        let transform=|image: &mut png_pixels::Raster| {
            let channel_alpha=apply_pixels(image,0..ops.len(),gif_input)?;
            if dest.0=="png" {image.alpha |= channel_alpha;}
            Ok(())
        };
        let scene_name=magick_stack::SceneName::parse(dest.1);
        let split=!adjoin || !matches!(scene_name,magick_stack::SceneName::Literal);
        if use_stack || split {
            let transform=|im:&mut png_pixels::Raster,range:std::ops::Range<usize>,gif| {
                let keep_timing=!ops[range.clone()].iter().any(|op| matches!(op,PixelOp::Extent(..)));
                let channel_alpha=apply_pixels(im,range,gif)?;
                Ok((keep_timing,channel_alpha))
            };
            let target;
            let steps=if is_mogrify {
                target=std::iter::once((0,magick_stack::Step::Input(input,(1,1),kernel))).chain(stack_steps.iter().copied().filter(|(_,s)|matches!(s,magick_stack::Step::Edit(..)|magick_stack::Step::Append(..)|magick_stack::Step::Write(..)))).collect::<Vec<_>>();
                &target[..]
            } else { &stack_steps[..] };
            let mut snapshots=magick_stack::Snapshots::default();
            let limit=fs.max_input_bytes();
            let mut images=match magick_stack::evaluate(steps,ops.len(),transform,limit,|path|fs.read_file(&resolve_posix_path(cwd,path)),&mut snapshots) {
                Ok(Some(images))=>images, Ok(None)=>return None,
                Err(e)=>{
                    let saved=snapshots.publish(cwd,fs);
                    return Some(if saved.exit_code==0 {fail(&e)} else {saved});
                }
            };
            if images.frames.is_empty() {
                let saved=snapshots.publish(cwd,fs);
                return Some(if saved.exit_code==0 {fail(&format!("no images defined '{}'",dest.1))} else {saved});
            }
            if info {
                let text=images.frames.iter().map(|s|format!("{}x{} sRGB 8-bit\n",s.image.width,s.image.height)).collect::<String>();
                let saved=snapshots.publish(cwd,fs);
                return Some(if saved.exit_code==0 {ok_out(&text)} else {saved});
            }
            if split && images.frames.len()>1 {
                if let Err(e)=images.stage_split(scene_name,dest,quality,limit,&mut snapshots) {return Some(fail(e));}
                return Some(snapshots.publish(cwd,fs));
            }
            let bytes=if dest.0=="gif" {images.gif(timing,kernel,limit)}
                else {images.frames.pop()?.encode(dest.0,quality,limit)};
            let bytes=match bytes {Ok(b)=>b,Err(e)=>return Some(fail(e))};
            if !has_writes {return Some(png_pixels::Raster::publish_bytes(&bytes,dest.1,cwd,fs));}
            if dest.1=="-" {
                let saved=snapshots.publish(cwd,fs);
                return Some(if saved.exit_code==0 {png_pixels::Raster::publish_bytes(&bytes,"-",cwd,fs)} else {saved});
            }
            if let Err(e)=snapshots.stage(dest.1.to_owned(),bytes,limit) {return Some(fail(e));}
            return Some(snapshots.publish(cwd,fs));
        }
        let mut image = if let Some((canvas,size)) = canvas {
            match canvas.raster(size,fs.max_input_bytes()) { Ok(im)=>im,Err(e)=>return Some(fail(e)) }
        } else if gif_input {
            if dest.0 == "gif" {
                // Extent composites each scene onto a new canvas with default timing.
                let inherit_timing = !ops.iter().any(|op| matches!(op,PixelOp::Extent(..)));
                match gif::edit_frames(bytes,fs.max_input_bytes(),inherit_timing,timing,transform) {
                    Ok(Some(data))=>return Some(png_pixels::Raster::publish_bytes(&data,dest.1,cwd,fs)),
                    Ok(None)=>{}, Err(e)=>return Some(fail(e)),
                }
            }
            match gif::decode(bytes,usize::MAX,fs.max_input_bytes(), |_,_| Ok(())) {
                Ok(im)=>im,
                Err(e)=>return Some(err_out(&format!("magick: {e}\n"),1)),
            }
        } else {
            match png_pixels::Raster::input(input,bytes,fs.max_input_bytes()) {
                Ok(im)=>im?, Err(e)=>return Some(err_out(&format!("magick: {e}\n"),1))
            }
        };
        if let Err(e)=transform(&mut image){return Some(fail(e));}
        if dest.0 == "gif" && (delay.is_some() || repeat.is_some()) {
            return Some(match gif::encode(image.width,image.height,&image.pixels,timing,fs.max_input_bytes()) {
                Ok(data)=>png_pixels::Raster::publish_bytes(&data,dest.1,cwd,fs),
                Err(e)=>fail(e),
            });
        }
        Some(image.publish(dest,quality,cwd,fs))
    };
    let apply_ops = |meta: &mut ImageMeta| {
        if let Some(ref rspec) = resize_spec {
            let (rw, rh) = apply_magick_resize_geom(meta.w, meta.h, rspec);
            meta.w = rw;
            meta.h = rh;
        }
        if rot_deg.rem_euclid(180) != 0 {
            std::mem::swap(&mut meta.w, &mut meta.h);
        }
        if transpose_swaps % 2 == 1 {
            std::mem::swap(&mut meta.w, &mut meta.h);
        }
        if let Some((cw, ch)) = crop_opt {
            meta.w = cw;
            meta.h = ch;
        }
        if let Some((bw, bh)) = border_opt {
            meta.w += bw * 2;
            meta.h += bh * 2;
        }
        if let Some((ew, eh)) = extent_opt {
            meta.w = ew;
            meta.h = eh;
        }
        if ops.iter().any(|op| matches!(op,PixelOp::Gray)) {
            meta.cs = "Gray".to_string();
        }
        if let Some((Canvas::Solid([r, g, b, _]),_)) = canvas {
            meta.exif
                .insert("__color".to_string(), format!("#{r:02x}{g:02x}{b:02x}"));
        }
        for op in &ops {
            if let PixelOp::Negate(ch,only_gray)=op {
                let mut pixel=meta.exif.get("__color").and_then(|c|parse_color(c).ok()).unwrap_or([255;4]);
                magick_color::negate(&mut pixel,*ch,*only_gray);
                let [r,g,b,_]=pixel;
                meta.exif.insert("__color".into(),format!("#{r:02x}{g:02x}{b:02x}"));
            }
        }
    };
    if is_mogrify {
        for f in &pos_files {
            let full = resolve_posix_path(cwd, f);
            let Ok(bytes) = fs.read_file(&full) else {
                return err_out(
                    &format!("mogrify: unable to open image '{f}': No such file or directory\n"),
                    1,
                );
            };
            let mut meta = read_image_meta(&bytes, &full);
            apply_ops(&mut meta);
            let dest = if mogrify_format.is_some() || mogrify_path.is_some() {
                let (parent, name)=f.rsplit_once('/').unwrap_or(("",f));
                let (stem, extension)=name.rsplit_once('.').unwrap_or((name,"png"));
                let extension=mogrify_format.as_deref().unwrap_or(extension);
                let dir=mogrify_path.as_deref().unwrap_or(parent).trim_end_matches('/');
                if dir.is_empty() {format!("{stem}.{extension}")} else {format!("{dir}/{stem}.{extension}")}
            } else { f.clone() };
            let dst_full=resolve_posix_path(cwd,&dest);
            if mogrify_format.is_some() {
                meta.fmt = format_from_path(&dest).to_string();
            }
            if let Some(out) = raster_output(&full, &bytes, &dest) {
                if out.exit_code!=0 {return out;}
                continue;
            }
            let _ = fs.write_file(&dst_full, &write_image_bytes(&meta));
        }
        return ok_out("");
    }
    if pos_files.is_empty() && !has_pseudo_input {
        let last_arg = args.last().map(|s| s.as_str()).unwrap_or("");
        return err_out(&format!("magick: no images defined '{last_arg}'\n"), 1);
    }
    if pos_files.len() == 1 && !has_pseudo_input {
        return err_out(&format!("magick: no images defined '{}'\n", pos_files[0]), 1);
    }
    if let Some(out_rel) = pos_files.last() {
        let out_full = resolve_posix_path(cwd, out_rel);
        if use_stack || canvas.is_some() && pos_files.len()==1 {
            if let Some(out)=raster_output("", &[], out_rel) {return out;}
        } else if !has_pseudo_input && pos_files.len()==2 {
            let path=png_pixels::destination(&pos_files[0]).map_or(pos_files[0].as_str(), |(_, path)| path);
            if let Ok(bytes)=fs.read_file(&resolve_posix_path(cwd,path)) && let Some(out)=raster_output(path,&bytes,out_rel) {return out;}
        }
        for in_rel in &pos_files[..pos_files.len() - 1] {
            if in_rel != "-" && !in_rel.contains(':') {
                let clean_in = magick_stack::input_spec(in_rel).0;
                let in_full = resolve_posix_path(cwd, clean_in);
                if fs.is_dir(&in_full) || fs.read_file(&in_full).is_err() {
                    return err_out(&format!("magick: no images defined '{out_rel}'\n"), 1);
                }
            }
        }
        let mut meta = if let Some(vertical) = append_mode
            && pos_files.len() >= 2
        {
            let mut total_w = 0u32;
            let mut total_h = 0u32;
            let mut first_meta: Option<ImageMeta> = None;
            for in_rel in &pos_files[..pos_files.len() - 1] {
                let in_full = resolve_posix_path(cwd, in_rel);
                let im = fs
                    .read_file(&in_full)
                    .map(|b| read_image_meta(&b, &in_full))
                    .unwrap_or_else(|_| read_image_meta(&[], &in_full));
                if vertical {
                    total_w = total_w.max(im.w);
                    total_h += im.h;
                } else {
                    total_w += im.w;
                    total_h = total_h.max(im.h);
                }
                if first_meta.is_none() {
                    first_meta = Some(im);
                }
            }
            let mut base = first_meta.unwrap_or_else(|| read_image_meta(&[], &out_full));
            base.w = total_w.max(1);
            base.h = total_h.max(1);
            base
        } else if pos_files.len() >= 2 {
            let in_full = resolve_posix_path(cwd, &pos_files[0]);
            fs.read_file(&in_full)
                .map(|b| read_image_meta(&b, &in_full))
                .unwrap_or_else(|_| read_image_meta(&[], &in_full))
        } else {
            let (w, h) = size_opt.unwrap_or(if canvas.is_some() { (1, 1) } else { (32, 32) });
            ImageMeta {
                fmt: format_from_path(&out_full).to_string(),
                w,
                h,
                cs: "sRGB".to_string(),
                exif: BTreeMap::new(),
            }
        };
        apply_ops(&mut meta);
        if out_full.to_ascii_lowercase().ends_with(".pdf") {
            let mut pdf = PdfDoc::new();
            pdf.pages.push(PdfPage {
                rot: 0,
                text: String::new(),
                html: String::new(),
                images: vec![(meta.w, meta.h, meta.fmt.clone())],
                urls: Vec::new(),
            });
            let _ = fs.write_file(&out_full, &pdf.serialize());
        } else {
            meta.fmt = format_from_path(&out_full).to_string();
            let _ = fs.write_file(&out_full, &write_image_bytes(&meta));
        }
    }
    ok_out("")
}

fn cmd_composite(cmd: &str, args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if let Some(r)=magick_composite::run(cmd,args,cwd,fs) { return r; }
    if let Some(list_out) = try_magick_list_option(args) {
        return list_out;
    }
    let mut operands: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-gravity" | "-geometry" | "-compose" | "-background" | "-quality"
            | "-define" | "-dissolve" | "-blend" | "-watermark"
                if i + 1 < args.len() =>
            {
                i += 2;
            }
            a if a.starts_with('-') => {
                i += 1;
            }
            a => {
                operands.push(a.to_string());
                i += 1;
            }
        }
    }
    if operands.len() < 3 {
        return err_out("composite: missing an image filename\n", 1);
    }
    let overlay_rel = &operands[0];
    let base_rel = &operands[1];
    let out_rel = operands.last().unwrap();
    for src_rel in [overlay_rel, base_rel] {
        if !src_rel.contains(':') {
            let src_full = resolve_posix_path(cwd, src_rel);
            if fs.read_file(&src_full).is_err() {
                return err_out(
                    &format!("magick: no images defined '{out_rel}'\n"),
                    1,
                );
            }
        }
    }
    let base_full = resolve_posix_path(cwd, base_rel);
    let mut base_meta = fs
        .read_file(&base_full)
        .map(|b| read_image_meta(&b, &base_full))
        .unwrap_or_else(|_| read_image_meta(&[], &base_full));
    let out_full = resolve_posix_path(cwd, out_rel);
    base_meta.fmt = format_from_path(&out_full).to_string();
    base_meta
        .exif
        .insert("__COMPOSITE__".to_string(), format!("{overlay_rel}:{}", args.join(",")));
    let _ = fs.write_file(&out_full, &write_image_bytes(&base_meta));
    ok_out("")
}

fn cmd_montage(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if let Some(list_out) = try_magick_list_option(args) {
        return list_out;
    }
    let mut quality=92.;
    let mut tile_cols: Option<usize> = None;
    let mut tile_rows: Option<usize> = None;
    let mut cell_w: Option<u32> = None;
    let mut cell_h: Option<u32> = None;
    let mut pad_x = 2u32;
    let mut pad_y = 2u32;
    let mut border_w = 0u32;
    let mut background = [255;4];
    let mut border_color = [223,223,223,255];
    let mut gravity = String::from("northwest");
    let mut operands: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-tile" if i + 1 < args.len() => {
                let t = &args[i + 1];
                if let Some((cs, rs)) = t.split_once('x') {
                    if !cs.is_empty() {
                        tile_cols = cs.parse().ok();
                    }
                    if !rs.is_empty() {
                        tile_rows = rs.parse().ok();
                    }
                } else {
                    tile_cols = t.parse().ok();
                }
                i += 2;
            }
            "-geometry" | "-thumbnail" if i + 1 < args.len() => {
                let g = &args[i + 1];
                let mut parts = g.split('+');
                let dim_part = parts.next().unwrap_or("");
                if let Some(px_s) = parts.next() {
                    pad_x = px_s.parse().unwrap_or(2);
                    if let Some(py_s) = parts.next() {
                        pad_y = py_s.parse().unwrap_or(2);
                    }
                }
                let clean_dim = dim_part.trim_end_matches(['!', '^', '>', '<']);
                if let Some((ws, hs)) = clean_dim.split_once('x') {
                    if !ws.is_empty() {
                        cell_w = ws.parse().ok();
                    }
                    if !hs.is_empty() {
                        cell_h = hs.parse().ok();
                    }
                } else if !clean_dim.is_empty() {
                    cell_w = clean_dim.parse().ok();
                }
                i += 2;
            }
            "-border" | "-frame" if i + 1 < args.len() => {
                let b = args[i + 1].split('x').next().unwrap_or("0");
                border_w = b.parse().unwrap_or(0);
                i += 2;
            }
            "-background" | "-bordercolor" if i+1 < args.len() => {
                let c=match parse_color(&args[i+1]) {Ok(c)=>c,Err(e)=>return err_out(&format!("montage: {e}\n"),1)};
                if args[i]=="-background" {background=c;} else {border_color=c;}
                i+=2;
            }
            "-gravity" if i+1 < args.len() => {gravity=args[i+1].to_ascii_lowercase().replace(['-','_',' '],"");i+=2;}
            "-quality" if i+1<args.len()=>{quality=js_number(&args[i+1],1.);i+=2;}
            "-fill" | "-label" | "-title" | "-font" | "-pointsize" | "-mode"
                if i + 1 < args.len() => {i+=2;}
            a if a.starts_with('-') => {
                i += 1;
            }
            a => {
                operands.push(a.to_string());
                i += 1;
            }
        }
    }
    if operands.len() < 2 {
        return err_out("montage: missing an image filename\n", 1);
    }
    let in_paths = &operands[..operands.len() - 1];
    let out_rel = operands.last().unwrap();
    let mut thumb_dims = Vec::new();
    let mut tiles=Vec::new();
    let limit=fs.max_input_bytes();
    let mut retained=0;
    let spec=format!("{}x{}",cell_w.map(|v|v.to_string()).unwrap_or_default(),cell_h.map(|v|v.to_string()).unwrap_or_default());
    let destination=png_pixels::destination(out_rel);
    for p in in_paths {
        let kernel=magick_resize::Kernel::Lanczos3;
        let base=magick_stack::input_spec(magick_stack::tile_pattern(p).unwrap_or(p)).0;
        let path=png_pixels::destination(base).map_or(base,|(_,path)|path);
        let full=resolve_posix_path(cwd,path);
        if destination.is_some() {
            let step=magick_stack::Step::Input(p,(1,1),kernel);
            match magick_stack::evaluate(&[(0,step)],0,|im,_,_|{
                im.resize(&spec,kernel,limit)?;
                Ok((false,false))
            },limit,|_|fs.read_file(&full),&mut Default::default()) {
                Ok(Some(images)) if images.frames.is_empty()=>return err_out(&format!("montage: unable to open image '{p}': No such file or directory\n"),1),
                Ok(Some(images))=>{
                    for scene in images.frames {
                        let image=scene.image;
                        if image.pixels.len()>limit/4-retained{return err_out("montage: image exceeds memory budget\n",1);}
                        retained+=image.pixels.len();
                        thumb_dims.push(((image.width as u32).saturating_add(border_w.saturating_mul(2)),(image.height as u32).saturating_add(border_w.saturating_mul(2))));
                        tiles.push(image);
                    }
                    continue;
                }
                Err(e)=>return err_out(&format!("montage: improper image header '{p}': {e}\n"),1),
                Ok(None)=>{}
            }
        }
        let bytes=if Canvas::parse(base).is_some(){Vec::new()}else{
            match fs.read_file(&full){Ok(bytes)=>bytes,Err(_)=>return err_out(&format!("montage: unable to open image '{p}': No such file or directory\n"),1)}
        };
        let meta=read_image_meta(&bytes,&full);
        let (w,h)=apply_magick_resize_geom(meta.w,meta.h,&spec);
        thumb_dims.push((w.saturating_add(border_w.saturating_mul(2)),h.saturating_add(border_w.saturating_mul(2))));
    }
    let n = thumb_dims.len();
    let cols = tile_cols.unwrap_or_else(|| {
        if let Some(tr) = tile_rows {
            n.div_ceil(tr.max(1))
        } else {
            (n as f64).sqrt().ceil() as usize
        }
    });
    let rows = tile_rows.unwrap_or_else(|| n.div_ceil(cols.max(1)));
    let max_thumb_w = thumb_dims
        .iter()
        .map(|(w, _)| *w)
        .fold(cell_w.unwrap_or(0), u32::max);
    let max_thumb_h = thumb_dims
        .iter()
        .map(|(_, h)| *h)
        .fold(cell_h.unwrap_or(0), u32::max);
    let slot_w = max_thumb_w.saturating_add(pad_x.saturating_mul(2));
    let slot_h = max_thumb_h.saturating_add(pad_y.saturating_mul(2));
    let canvas_w = cols.saturating_mul(slot_w as usize).max(1);
    let canvas_h = rows.saturating_mul(slot_h as usize).max(1);
    if canvas_w.saturating_mul(canvas_h)>limit/4 {return err_out("montage: image exceeds memory budget\n",1);}
    if tiles.len()==n && let Some(dest)=destination {
        let mut sheet=png_pixels::Raster {width:canvas_w,height:canvas_h,density:72,orientation:None,gray:false,alpha:background[3]<255 || (border_w>0 && border_color[3]<255),pixels:vec![background;canvas_w*canvas_h]};
        for (i,(tile,(tw,th))) in tiles.iter().zip(thumb_dims).enumerate() {
            if cols==0 || i/cols>=rows {break;}
            let dx=max_thumb_w-tw;let dy=max_thumb_h-th;
            let ox=match gravity.as_str() {"northwest"|"west"|"southwest"=>0,"northeast"|"east"|"southeast"=>dx,_=>dx/2};
            let oy=match gravity.as_str() {"northwest"|"north"|"northeast"=>0,"southwest"|"south"|"southeast"=>dy,_=>dy/2};
            let left=(i%cols)*slot_w as usize+(pad_x+ox) as usize;
            let top=(i/cols)*slot_h as usize+(pad_y+oy) as usize;
            for y in 0..th {for x in 0..tw {
                let src=if y>=border_w && y<th-border_w && x>=border_w && x<tw-border_w {
                    tile.pixels[(y-border_w) as usize*tile.width+(x-border_w) as usize]
                }else{border_color};
                sheet.alpha |= src[3]<255;
                let d=&mut sheet.pixels[(top+y as usize)*canvas_w+left+x as usize];
                *d=magick_composite::blend(src,*d,"over",1.,1.);
            }}
        }
        return sheet.publish(dest,quality,cwd,fs);
    }
    let out_full = resolve_posix_path(cwd, out_rel);
    let out_meta = ImageMeta {
        fmt: format_from_path(&out_full).to_string(),
        w: canvas_w as u32,
        h: canvas_h as u32,
        cs: "sRGB".to_string(),
        exif: BTreeMap::new(),
    };
    let _ = fs.write_file(&out_full, &write_image_bytes(&out_meta));
    ok_out("")
}

fn cmd_compare(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if let Some(list_out) = try_magick_list_option(args) {
        return list_out;
    }
    let mut metric = "rmse".to_string();
    let mut options = magick_compare::Options {
        fuzz: 0., highlight: [241,0,30,255], lowlight: None, compose_src: false, threshold: None, density: 72, quality:92.,
    };
    let mut operands: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-help" | "--help" | "-h" => {
                return ok_out("Usage: compare [-metric AE|MAE|MSE|RMSE|PSNR|SSIM|PAE|NCC] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n");
            }
            "-metric" if i + 1 < args.len() => {
                metric = args[i + 1].to_ascii_lowercase();
                i += 2;
            }
            "-fuzz" if i + 1 < args.len() => {
                let value = &args[i+1];
                options.fuzz = magick_fuzz(value);
                i+=2;
            }
            "-highlight-color" | "-lowlight-color" if i + 1 < args.len() => {
                let color = match parse_color(&args[i+1]) { Ok(color) => color, Err(e) => return err_out(&format!("compare: {e}\n"), 2) };
                if args[i]=="-highlight-color" { options.highlight=color; } else { options.lowlight=Some(color); }
                i+=2;
            }
            "-compose" | "-dissimilarity-threshold" | "-density" | "-quality" | "-format" | "-alpha" | "-channel" if i+1 < args.len() => {
                let value=&args[i+1];
                match args[i].as_str() {
                    "-quality" => options.quality=js_number(value,1.),
                    "-compose" => options.compose_src |= matches!(value.to_ascii_lowercase().as_str(),"src"|"source"|"copy"),
                    "-density" => options.density=value.split('x').next().and_then(|v|v.parse::<f64>().ok()).unwrap_or(72.).round().max(1.) as u32,
                    "-dissimilarity-threshold" => options.threshold=Some(value.parse().unwrap_or(f64::NAN)), _=>{}
                }
                i+=2;
            }
            a if a.starts_with('-') && a != "-" => {
                i += 1;
            }
            a => {
                operands.push(a.to_string());
                i += 1;
            }
        }
    }
    if operands.len() < 2 {
        return err_out("compare: missing an image filename\n", 2);
    }
    let load_cmp_img = |spec: &str| -> Result<(ImageMeta, Vec<u8>), String> {
        let base=magick_stack::tile_operand(spec).0;
        if let Some(canvas)=Canvas::parse(base) {
            let [r,g,b,_]=canvas.map_err(|e|format!("compare: {e}\n"))?.pixel(0,0,1,1);
            let mut ex = BTreeMap::new();
            ex.insert("__color".to_string(), format!("#{r:02x}{g:02x}{b:02x}"));
            let m = ImageMeta {
                fmt: "PNG".to_string(),
                w: 1,
                h: 1,
                cs: "sRGB".to_string(),
                exif: ex,
            };
            let bytes = write_image_bytes(&m);
            return Ok((m, bytes));
        }
        let path=png_pixels::destination(base).map_or(base,|(_,path)|path);
        let full = resolve_posix_path(cwd,path);
        match fs.read_file(&full) {
            Ok(bytes) => {
                if bytes.is_empty() {
                    return Err(format!("compare: improper image header '{spec}'\n"));
                }
                Ok((read_image_meta(&bytes, &full), bytes))
            }
            Err(_) => Err(format!(
                "compare: unable to open image '{spec}': No such file or directory\n"
            )),
        }
    };
    let (meta_a, bytes_a) = match load_cmp_img(&operands[0]) {
        Ok(v) => v,
        Err(e) => return err_out(&e, 2),
    };
    let (meta_b, bytes_b) = match load_cmp_img(&operands[1]) {
        Ok(v) => v,
        Err(e) => return err_out(&e, 2),
    };
    let default_null = "null:".to_string();
    let out_spec = operands.get(2).unwrap_or(&default_null);
    let raster = |spec: &str, bytes: &[u8]| -> Result<Option<png_pixels::Raster>,String>{
        let (base,modifier,tiles)=magick_stack::tile_operand(spec);
        let limit=fs.max_input_bytes();
        let mut im=if let magick_stack::Modifier::Pages(pages)=modifier
            && png_pixels::still_format(bytes)==Some("gif") {
            let mut count=0;
            let _=gif::packets(bytes,|_,_|{count+=1;Ok(())});
            gif::decode(bytes,magick_stack::first_page(pages,count)+1,limit,|_,_|Ok(()))?
        }else if let Some(im)=png_pixels::Raster::input(base,bytes,limit)? {im}else{return Ok(None)};
        modifier.geometry(&mut im,magick_resize::Kernel::Lanczos3,limit)?;
        im.apply_tiles(&tiles,(1,1),magick_resize::Kernel::Lanczos3,limit)?;
        Ok(Some(im))
    };
    let dest=png_pixels::destination(out_spec);
    if out_spec.eq_ignore_ascii_case("null:") || dest.is_some() {
        match (raster(&operands[0], &bytes_a),raster(&operands[1], &bytes_b)) {
            (Ok(Some(a)), Ok(Some(b))) => return magick_compare::compare([&a,&b],&metric,&options,dest,cwd,fs),
            (Err(e),_) | (_,Err(e)) => return err_out(&format!("compare: improper image header: {e}\n"),2),
            _ => {}
        }
    }
    let width = meta_a.w.max(meta_b.w);
    let height = meta_a.h.max(meta_b.h);
    let color_a = meta_a.exif.get("__color").map(|s| s.as_str()).unwrap_or("");
    let color_b = meta_b.exif.get("__color").map(|s| s.as_str()).unwrap_or("");
    let [ra,ga,ba,_] = parse_color(color_a).unwrap_or([255;4]);
    let [rb,gb,bb,_] = parse_color(color_b).unwrap_or([255;4]);
    let max_ch_diff = (ra as i32 - rb as i32)
        .abs()
        .max((ga as i32 - gb as i32).abs())
        .max((ba as i32 - bb as i32).abs()) as f64;
    let fuzz_abs = options.fuzz;
    let same_pixels = (bytes_a == bytes_b)
        || (meta_a.w == meta_b.w
            && meta_a.h == meta_b.h
            && (!color_a.is_empty() || !color_b.is_empty())
            && max_ch_diff <= fuzz_abs);
    let total_pixels = (width as u64) * (height as u64);
    let (metric_str, exit_code) = if same_pixels {
        let s = match metric.as_str() {
            "ae" => "0".to_string(),
            "psnr" => "inf".to_string(),
            "ncc" | "ssim" => "1".to_string(),
            "dssim" => "0".to_string(),
            _ => "0 (0)".to_string(),
        };
        (s, 0)
    } else {
        let dr = (ra as f64 - rb as f64).abs();
        let dg = (ga as f64 - gb as f64).abs();
        let db = (ba as f64 - bb as f64).abs();
        let mae_norm = if dr + dg + db > 0.0 {
            (dr + dg + db) / (3.0 * 255.0)
        } else {
            1.0
        };
        let mse_norm = if dr + dg + db > 0.0 {
            (dr * dr + dg * dg + db * db) / (3.0 * 255.0 * 255.0)
        } else {
            1.0
        };
        let rmse_norm = mse_norm.sqrt();
        let pae_norm = if max_ch_diff > 0.0 { max_ch_diff / 255.0 } else { 1.0 };
        let fmt_num = |n: f64| -> String {
            if !n.is_finite() {
                return "inf".to_string();
            }
            if n.abs() < 1e-9 {
                return "0".to_string();
            }
            let s = format!("{n:.6}");
            let s = s.trim_end_matches('0').trim_end_matches('.');
            if s == "-0" || s.is_empty() { "0".to_string() } else { s.to_string() }
        };
        let s = match metric.as_str() {
            "ae" => total_pixels.to_string(),
            "mae" => format!("{} ({})", fmt_num(mae_norm * 65535.0), fmt_num(mae_norm)),
            "mse" => format!("{} ({})", fmt_num(mse_norm * 65535.0), fmt_num(mse_norm)),
            "pae" => format!("{} ({})", fmt_num(pae_norm * 65535.0), fmt_num(pae_norm)),
            "psnr" => fmt_num(10.0 * (1.0 / mse_norm).log10()),
            "ncc" | "ssim" => "0".to_string(),
            "dssim" => "0.5".to_string(),
            _ => format!("{} ({})", fmt_num(rmse_norm * 65535.0), fmt_num(rmse_norm)),
        };
        (s, 1)
    };
    if !out_spec.eq_ignore_ascii_case("null:") {
        let clean_out = out_spec
            .split_once(':')
            .map(|(_, r)| r)
            .unwrap_or(out_spec.as_str());
        let diff_meta = ImageMeta {
            fmt: format_from_path(clean_out).to_string(),
            w: width,
            h: height,
            cs: "sRGB".to_string(),
            exif: BTreeMap::new(),
        };
        let encoded = write_image_bytes(&diff_meta);
        if clean_out == "-" {
            return BuiltinOutcome {
                stdout: crate::vfs::bytes_to_stream_string(&encoded),
                stderr: format!("{metric_str}\n"),
                exit_code,
            };
        }
        let out_full = resolve_posix_path(cwd, clean_out);
        let _ = fs.write_file(&out_full, &encoded);
    }
    BuiltinOutcome {
        stdout: String::new(),
        stderr: format!("{metric_str}\n"),
        exit_code,
    }
}

fn cmd_identify(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if let Some(list_out) = try_magick_list_option(args) {
        return list_out;
    }
    let mut fmt_opt: Option<String> = None;
    let mut verbose = false;
    let mut files: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "-version" || a == "--version" {
            return ok_out("Version: ImageMagick 7.1.1-safe-bash (@poe-code/image-ast)\n");
        }
        if a == "-help" || a == "--help" || a == "-h" {
            return ok_out("Usage: identify [-ping] [-verbose] [-format FORMAT] file...\n");
        }
        if (a == "-format" || a == "--format") && i + 1 < args.len() {
            fmt_opt = Some(args[i + 1].clone());
            i += 2;
            continue;
        }
        if a == "-verbose" || a == "--verbose" {
            verbose = true;
            i += 1;
            continue;
        }
        if a == "-ping" || a == "--ping" {
            i += 1;
            continue;
        }
        if !a.starts_with('-') || a == "-" {
            files.push(args[i].clone());
        }
        i += 1;
    }
    if files.is_empty() {
        return err_out("identify: missing an image filename\n", 1);
    }
    let mut out = String::new();
    let mut err_buf = String::new();
    let mut exit_code = 0;
    for f in &files {
        let operand = identify::operand(f);
        let full = resolve_posix_path(cwd, operand.0);
        let data = if operand.0 == "-" { Ok(crate::vfs::stream_string_to_bytes(stdin)) } else { fs.read_file(&full) };
        let Ok(bytes) = data else {
            err_buf.push_str(&format!(
                "identify: unable to open image '{f}': No such file or directory\n"
            ));
            exit_code = 1;
            continue;
        };
        let (meta, depth, channels, dpi) = match inspect_raster(&bytes, &full, fs.max_input_bytes()) {
            Ok(info) => info,
            Err(reason) => {
                err_buf.push_str(&format!("identify: improper image header '{f}': {reason}\n"));
                exit_code = 1;
                continue;
            }
        };
        let display_depth = if depth < 8 { 1 } else { depth };
        let space = if depth == 16 && matches!(meta.fmt.as_str(),"PNG" | "TIFF") { "sRGB" } else { &meta.cs };
        if let Some(ref fmt_str) = fmt_opt {
            if let Err(e) = identify::format(fmt_str, operand, (&meta, depth, channels, dpi), bytes.len(), &mut out, fs.shell_limits().max_output_bytes) {
                return err_out(&format!("identify: {e}\n"), 1);
            }
        } else if verbose {
            let details = if png_pixels::still_format(&bytes).is_some() {
                match png_pixels::Raster::decode(&bytes, fs.max_input_bytes()) {
                    Ok(image) => {
                        let alpha = if meta.has_alpha(channels) { "True" } else { "False" };
                        format!("  Channels: {channels}\n  Alpha: {alpha}\n  Filesize: {}B\n  Entropy: {:.4}\n", bytes.len(), image.entropy())
                    }
                    Err(reason) => {
                        err_buf.push_str(&format!("identify: improper image header '{f}': {reason}\n"));
                        exit_code = 1;
                        continue;
                    }
                }
            } else { format!("  Filesize: {}B\n", bytes.len()) };
            out.push_str(&format!(
                "Image: {f}\n  Format: {}\n  Geometry: {}x{}+0+0\n  Resolution: {dpi}x{dpi}\n  Colorspace: {}\n  Depth: {display_depth}-bit\n{details}",
                meta.fmt, meta.w, meta.h, space
            ));
        } else {
            out.push_str(&format!(
                "{f} {} {}x{} {}x{}+0+0 {display_depth}-bit {} {}B 0.000u 0:00.000\n",
                meta.fmt, meta.w, meta.h, meta.w, meta.h, space, bytes.len()
            ));
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_buf,
        exit_code,
    }
}

fn cmd_sips(args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.is_empty() {
        return err_out(
            "sips: no arguments specified. Try 'sips --help' for help.\n",
            1,
        );
    }
    let mut get_props: Vec<String> = Vec::new();
    let mut one_line = false;
    let mut has_mod = false;
    let mut verify_mode = false;
    let mut out_path: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut ops: Vec<(&str, String, String)> = Vec::new();
    let mut i = 0usize;
    while i < args.len() {
        match args[i].as_str() {
            "-h" | "--help" => {
                return ok_out(
                    "sips - scriptable image processing system\nUsage: sips [options] file ...\n  -g, --getProperty <key>\n  -s, --setProperty <key> <value>\n  -Z, --resampleHeightWidthMax <size>\n  -z, --resampleHeightWidth <height> <width>\n  --resampleWidth <width>\n  --resampleHeight <height>\n  -c, --cropToHeightWidth <height> <width>\n  --cropOffset <offsetY> <offsetX>\n  -p, --padToHeightWidth <height> <width>\n  --padColor <hexColor>\n  -r, --rotate <degrees>\n  -f, --flip horizontal|vertical\n  -o, --out <file-or-directory>\n",
                );
            }
            "-v" | "--version" => {
                return ok_out("sips 10.4.4\n");
            }
            "-H" | "--helpProperties" => {
                return ok_out(
                    "pixelWidth\npixelHeight\ntypeIdentifier\nformat\nformatOptions\ndpiWidth\ndpiHeight\nsamplesPerPixel\nbitsPerSample\nhasAlpha\nspace\nall\nallxml\n",
                );
            }
            "--formats" => {
                return ok_out(
                    "Supported Formats:\n-------------------------------------------\ncom.adobe.pdf                pdf   Writable\ncom.compuserve.gif           gif   Writable\ncom.microsoft.bmp            bmp   Writable\norg.webmproject.webp         webp  Writable\npublic.avif                  avif  Writable\npublic.heic                  heic  Writable\npublic.heif                  heif  Writable\npublic.jpeg                  jpeg  Writable\npublic.png                   png   Writable\npublic.tiff                  tiff  Writable\n",
                );
            }
            "--verify" => {
                verify_mode = true;
                i += 1;
            }
            "-1" | "--oneLine" => {
                one_line = true;
                i += 1;
            }
            "-g" | "--getProperty" => {
                if i + 1 >= args.len() {
                    return err_out("sips: missing argument for -g\n", 1);
                }
                get_props.push(args[i + 1].clone());
                i += 2;
            }
            "-d" | "--deleteProperty" => {
                if i + 1 >= args.len() {
                    return err_out("sips: missing argument for -d\n", 1);
                }
                has_mod = true;
                ops.push(("d", args[i + 1].clone(), String::new()));
                i += 2;
            }
            "-z" | "--resampleHeightWidth" => {
                let h = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                let w = args.get(i + 2).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !h.is_finite() || !w.is_finite() || h <= 0.0 || w <= 0.0 {
                    return err_out("sips: invalid dimensions for -z\n", 1);
                }
                has_mod = true;
                ops.push(("z", args[i + 1].clone(), args[i + 2].clone()));
                i += 3;
            }
            "-Z" | "--resampleHeightWidthMax" => {
                let max_dim = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !max_dim.is_finite() || max_dim <= 0.0 {
                    return err_out("sips: invalid size for -Z\n", 1);
                }
                has_mod = true;
                ops.push(("Z", args[i + 1].clone(), String::new()));
                i += 2;
            }
            "--resampleWidth" => {
                let w = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !w.is_finite() || w <= 0.0 {
                    return err_out("sips: invalid width for --resampleWidth\n", 1);
                }
                has_mod = true;
                ops.push(("rw", args[i + 1].clone(), String::new()));
                i += 2;
            }
            "--resampleHeight" => {
                let h = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !h.is_finite() || h <= 0.0 {
                    return err_out("sips: invalid height for --resampleHeight\n", 1);
                }
                has_mod = true;
                ops.push(("rh", args[i + 1].clone(), String::new()));
                i += 2;
            }
            "-r" | "--rotate" => {
                if i + 1 >= args.len()
                    || args[i + 1]
                        .parse::<f64>()
                        .map(|v| !v.is_finite())
                        .unwrap_or(true)
                {
                    return err_out("sips: invalid degrees for -r\n", 1);
                }
                has_mod = true;
                ops.push(("r", args[i + 1].clone(), String::new()));
                i += 2;
            }
            "-f" | "--flip" => {
                let dir = args
                    .get(i + 1)
                    .map(|s| s.to_ascii_lowercase())
                    .unwrap_or_default();
                if dir != "horizontal" && dir != "vertical" {
                    return err_out(
                        "sips: flip direction must be 'horizontal' or 'vertical'\n",
                        1,
                    );
                }
                has_mod = true;
                ops.push(("f", dir, String::new()));
                i += 2;
            }
            "-c" | "--cropToHeightWidth" => {
                let h = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                let w = args.get(i + 2).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !h.is_finite() || !w.is_finite() || h <= 0.0 || w <= 0.0 {
                    return err_out("sips: invalid dimensions for -c\n", 1);
                }
                has_mod = true;
                ops.push(("c", args[i + 1].clone(), args[i + 2].clone()));
                i += 3;
            }
            "--cropOffset" => {
                let oy = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::NAN);
                let ox = args.get(i + 2).and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::NAN);
                if !oy.is_finite() || !ox.is_finite() {
                    return err_out("sips: invalid offset for --cropOffset\n", 1);
                }
                ops.push(("offset", args[i+1].clone(), args[i+2].clone()));
                i += 3;
            }
            "-p" | "--padToHeightWidth" => {
                let h = args.get(i + 1).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                let w = args.get(i + 2).and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
                if !h.is_finite() || !w.is_finite() || h <= 0.0 || w <= 0.0 {
                    return err_out("sips: invalid dimensions for -p\n", 1);
                }
                has_mod = true;
                ops.push(("p", args[i + 1].clone(), args[i + 2].clone()));
                i += 3;
            }
            "--padColor" => {
                ops.push(("color", args.get(i+1).cloned().unwrap_or_else(|| "000000".into()), String::new()));
                i += 2;
            }
            "-s" | "--setProperty" => {
                if i + 2 >= args.len() {
                    return err_out("sips: missing argument for -s\n", 1);
                }
                if args[i + 1] == "format" {
                    let lower = args[i + 2].trim().to_ascii_lowercase();
                    if !matches!(
                        lower.as_str(),
                        "png"
                            | "public.png"
                            | "jpeg"
                            | "jpg"
                            | "public.jpeg"
                            | "webp"
                            | "org.webmproject.webp"
                            | "heic"
                            | "public.heic"
                            | "heif"
                            | "public.heif"
                            | "avif"
                            | "public.avif"
                            | "gif"
                            | "com.compuserve.gif"
                            | "ppm"
                            | "public.ppm"
                            | "pgm"
                            | "pbm"
                            | "public.pbm"
                            | "bmp"
                            | "com.microsoft.bmp"
                            | "tiff"
                            | "tif"
                            | "public.tiff"
                            | "pdf"
                            | "com.adobe.pdf"
                    ) {
                        return err_out(
                            &format!("Error:Unsupported format: {}\n", args[i + 2]),
                            1,
                        );
                    }
                }
                has_mod = true;
                ops.push(("s", args[i + 1].clone(), args[i + 2].clone()));
                i += 3;
            }
            "--deleteColorManagementProperties"
            | "--optimizeColorForSharing"
            | "-i"
            | "--addIcon"
            | "--repair"
            | "--debug" => {
                if args[i] == "--deleteColorManagementProperties" {
                    ops.push(("s", "profile".into(), "sRGB IEC61966-2.1".into()));
                }
                has_mod = true;
                i += 1;
            }
            "-x" | "--extractProfile" => {
                if i + 1 >= args.len() {
                    return err_out(&format!("sips: missing argument for {}\n", args[i]), 1);
                }
                verify_mode = true;
                i += 2;
            }
            "-m" | "--matchTo" | "-e" | "--embedProfile" | "-E"
            | "--embedProfileIfNone" | "--deleteTag" => {
                if i + 1 >= args.len() {
                    return err_out(&format!("sips: missing argument for {}\n", args[i]), 1);
                }
                has_mod = true;
                i += 2;
            }
            "-M" | "--matchToWithIntent" | "-X" | "--extractTag" | "--copyTag"
            | "--loadTag" => {
                if i + 2 >= args.len() {
                    return err_out(&format!("sips: missing arguments for {}\n", args[i]), 1);
                }
                has_mod = true;
                i += 3;
            }
            "--out" | "-o" => {
                if i + 1 >= args.len() {
                    return err_out("sips: missing argument for --out\n", 1);
                }
                out_path = Some(args[i + 1].clone());
                i += 2;
            }
            a if !a.starts_with('-') => {
                files.push(a.to_string());
                i += 1;
            }
            a => {
                return err_out(&format!("sips: unknown option: {a}\n"), 1);
            }
        }
    }
    if files.is_empty() {
        return err_out("sips: no input files specified\n", 1);
    }
    if !get_props.is_empty() && (has_mod || out_path.is_some()) {
        return err_out(
            "Error 6: cannot get properties and modify file in the same invocation\nTry 'sips --help' for help using this tool\n",
            6,
        );
    }
    let type_id_for_fmt = |fmt_lower: &str| -> String {
        match fmt_lower {
            "webp" => "org.webmproject.webp".to_string(),
            "gif" => "com.compuserve.gif".to_string(),
            "bmp" => "com.microsoft.bmp".to_string(),
            "pdf" => "com.adobe.pdf".to_string(),
            "ppm" | "pgm" | "pbm" => "public.pbm".to_string(),
            other => format!("public.{other}"),
        }
    };
    if !has_mod && out_path.is_none() {
        let mut out = String::new();
        let mut err_out_str = String::new();
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            if !fs.exists(&full) {
                err_out_str.push_str(&format!("Error: {f}: file does not exist\n"));
                continue;
            }
            let bytes = fs.read_file(&full).unwrap_or_default();
            let ((meta, depth, channels, dpi), props) = match inspect_raster(&bytes, &full, fs.max_input_bytes())
                .and_then(|info| Ok((info, sips_properties::read(&bytes)?))) {
                Ok(pair) => pair,
                Err(reason) => { err_out_str.push_str(&format!("Error: {f}: {reason}\n")); continue; }
            };
            if get_props.is_empty() {
                if verify_mode { out.push_str(f); out.push('\n'); }
                continue;
            }
            let fmt_lower = meta.fmt.to_ascii_lowercase();
            let xml = get_props.iter().any(|p| p == "allxml");
            let mut expanded_props = Vec::new();
            for p in &get_props {
                if xml || p == "all" {
                    expanded_props.extend(["pixelWidth", "pixelHeight", "typeIdentifier", "format",
                        "formatOptions", "dpiWidth", "dpiHeight", "samplesPerPixel", "bitsPerSample",
                        "hasAlpha", "space"]);
                    if xml {
                        expanded_props.push("path");
                        break;
                    }
                } else {
                    expanded_props.push(p.as_str());
                }
            }
            let mut kvs = Vec::new();
            for p in expanded_props {
                let val = if let Some((_, value)) = props.get(p).filter(|_| !xml || !matches!(p, "hasAlpha" | "path")) {
                    value.clone().unwrap_or_else(|| match (xml, p) {
                        (false, _) => "<nil>".into(),
                        (true, "dpiWidth" | "dpiHeight") => dpi.to_string(),
                        (true, "pixelWidth" | "pixelHeight" | "samplesPerPixel" | "bitsPerSample") => "0".into(),
                        _ => String::new(),
                    })
                } else { match p {
                    "path" => f.to_string(),
                    "pixelWidth" => meta.w.to_string(),
                    "pixelHeight" => meta.h.to_string(),
                    "format" => fmt_lower.clone(),
                    "typeIdentifier" => type_id_for_fmt(&fmt_lower),
                    "formatOptions" => "default".to_string(),
                    "dpiWidth" | "dpiHeight" => meta.exif.get(p).cloned().unwrap_or_else(|| format!("{dpi}.000")),
                    "samplesPerPixel" => channels.to_string(),
                    "bitsPerSample" => (if depth < 8 { 1 } else { depth }).to_string(),
                    "hasAlpha" => if meta.has_alpha(channels) { "yes" } else { "no" }.into(),
                    "space" => match meta.cs.as_str() { "CMYK" => "CMYK", "Gray" if !(matches!(meta.fmt.as_str(),"PNG" | "TIFF") && depth == 16) => "Gray", _ => "RGB" }.into(),
                    other => meta
                        .exif
                        .get(other)
                        .cloned()
                        .unwrap_or_else(|| "<nil>".to_string()),
                }};
                kvs.push((p, val));
            }
            if xml {
                out.push_str(concat!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
                    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
                    "<plist version=\"1.0\">\n<dict>\n"));
                for (k, v) in kvs {
                    out.push_str(&format!("  <key>{k}</key>\n  "));
                    match k {
                        "pixelWidth" | "pixelHeight" | "samplesPerPixel" | "bitsPerSample" =>
                            out.push_str(&format!("<integer>{v}</integer>\n")),
                        "dpiWidth" | "dpiHeight" => {
                            let n = v.parse::<f64>().unwrap_or(f64::NAN);
                            let dpi = if n.fract() == 0. { n.to_string() } else { format!("{n:.3}") };
                            out.push_str(&format!("<real>{dpi}</real>\n"));
                        }
                        "hasAlpha" => out.push_str(if v == "yes" { "<true/>\n" } else { "<false/>\n" }),
                        _ => out.push_str(&format!("<string>{}</string>\n", html_escape_str(&v).replace('\'', "&apos;"))),
                    }
                }
                out.push_str("</dict>\n</plist>\n");
            } else if one_line {
                out.push_str(f);
                out.push('|');
                for (k, v) in kvs {
                    out.push_str(&format!("{k}: {v}|"));
                }
                out.push('\n');
            } else {
                out.push_str(&format!("{f}\n"));
                for (k, v) in kvs {
                    out.push_str(&format!("  {k}: {v}\n"));
                }
            }
        }
        return BuiltinOutcome {
            stdout: out,
            stderr: err_out_str.clone(),
            exit_code: if err_out_str.is_empty() { 0 } else { 1 },
        };
    }
    let mut out = String::new();
    let mut err_out_str = String::new();
    for f in &files {
        let in_full = resolve_posix_path(cwd, f);
        if !fs.exists(&in_full) {
            err_out_str.push_str(&format!("Error: {f}: file does not exist\n"));
            continue;
        }
        let bytes = fs.read_file(&in_full).unwrap_or_default();
        let mut meta = match inspect_raster(&bytes, &in_full, fs.max_input_bytes()) {
            Ok((meta, ..)) => meta,
            Err(reason) => { err_out_str.push_str(&format!("Error: {f}: {reason}\n")); continue; }
        };
        for (op, a1, a2) in &ops {
            match *op {
                "z" | "c" | "p" => {
                    meta.h = a1.parse().unwrap_or(meta.h);
                    meta.w = a2.parse().unwrap_or(meta.w);
                }
                "Z" => {
                    let max_d: f64 = a1.parse().unwrap_or(meta.w as f64);
                    let w = meta.w.max(1) as f64;
                    let h = meta.h.max(1) as f64;
                    if w >= h {
                        meta.w = max_d.round() as u32;
                        meta.h = (h * max_d / w).round().max(1.0) as u32;
                    } else {
                        meta.h = max_d.round() as u32;
                        meta.w = (w * max_d / h).round().max(1.0) as u32;
                    }
                }
                "rw" => {
                    let nw: f64 = a1.parse().unwrap_or(meta.w as f64);
                    let w = meta.w.max(1) as f64;
                    let h = meta.h.max(1) as f64;
                    meta.h = (h * nw / w).round().max(1.0) as u32;
                    meta.w = nw.round() as u32;
                }
                "rh" => {
                    let nh: f64 = a1.parse().unwrap_or(meta.h as f64);
                    let w = meta.w.max(1) as f64;
                    let h = meta.h.max(1) as f64;
                    meta.w = (w * nh / h).round().max(1.0) as u32;
                    meta.h = nh.round() as u32;
                }
                "r" => {
                    let deg: i32 = a1.parse().unwrap_or(0);
                    if deg.rem_euclid(180) != 0 {
                        std::mem::swap(&mut meta.w, &mut meta.h);
                    }
                }
                "s" => {
                    if a1 == "format" {
                        let norm_fmt = match a2.trim().to_ascii_lowercase().as_str() {
                            "png" | "public.png" => Some("PNG"),
                            "jpeg" | "jpg" | "public.jpeg" => Some("JPEG"),
                            "webp" | "org.webmproject.webp" => Some("WEBP"),
                            "gif" | "com.compuserve.gif" => Some("GIF"),
                            "bmp" | "com.microsoft.bmp" => Some("BMP"),
                            "tiff" | "tif" | "public.tiff" => Some("TIFF"),
                            "ppm" => Some("PPM"),
                            "pgm" => Some("PGM"),
                            "pbm" | "public.pbm" => Some("PBM"),
                            "pdf" | "com.adobe.pdf" => Some("PDF"),
                            "heic" | "public.heic" => Some("HEIC"),
                            "heif" | "public.heif" => Some("HEIF"),
                            "avif" | "public.avif" => Some("AVIF"),
                            _ => None,
                        };
                        if let Some(nf) = norm_fmt {
                            meta.fmt = nf.to_string();
                        } else {
                            return err_out(&format!("Error:Unsupported format: {a2}\n"), 1);
                        }
                    } else if a1 == "dpiWidth" || a1 == "dpiHeight" {
                        if let Ok(num) = a2.parse::<f64>()
                            && num > 0.0
                        {
                            meta.exif.insert(a1.clone(), format!("{num:.3}"));
                        }
                    } else if a1 != "formatOptions" {
                        meta.exif.insert(a1.clone(), a2.clone());
                    }
                }
                "d" => {
                    meta.exif.remove(a1);
                }
                _ => {}
            }
        }
        let target_format = ops.iter().any(|(op, key, _)| *op == "s" && key == "format");
        let dst = if let Some(opath) = &out_path {
            if files.len() > 1 || opath.ends_with('/') || fs.is_dir(&resolve_posix_path(cwd, opath)) {
                let mut name = f.rsplit('/').next().unwrap_or(f).to_string();
                if target_format {
                    let stem = name.rfind('.').filter(|&i| i > 0).map_or(name.as_str(), |i| &name[..i]);
                    let ext = match meta.fmt.as_str() { "JPEG" => "jpg".into(), "TIFF" => "tif".into(), fmt => fmt.to_ascii_lowercase() };
                    name = format!("{stem}.{ext}");
                }
                format!("{}/{name}", opath.trim_end_matches('/'))
            } else { opath.clone() }
        } else { f.clone() };
        let encoded = if matches!(meta.fmt.as_str(), "PNG" | "JPEG" | "TIFF" | "BMP" | "PPM" | "PGM" | "PBM" | "WEBP" | "GIF" | "HEIC" | "HEIF" | "AVIF") && png_pixels::still_format(&bytes).is_some() {
            match sips_properties::edit(&meta.fmt.to_ascii_lowercase(), &bytes, &ops, fs.max_input_bytes()) {
                Ok(encoded) => encoded,
                Err(reason) => { err_out_str.push_str(&format!("Error: {f}: {reason}\n")); continue; }
            }
        } else { write_image_bytes(&meta) };
        match fs.write_file(&resolve_posix_path(cwd, &dst), &encoded) {
            Ok(()) => out.push_str(&format!("{f}\n  {dst}\n")),
            Err(reason) => err_out_str.push_str(&format!("Error: {f}: {reason}\n")),
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: err_out_str.clone(),
        exit_code: if err_out_str.is_empty() { 0 } else { 1 },
    }
}

fn cmd_exiftool(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.len() == 1 && (args[0] == "-ver" || args[0] == "--version") {
        return ok_out("13.59\n");
    }
    if args.len() == 1 && matches!(args[0].as_str(), "--help" | "-help" | "-?") {
        return ok_out(include_str!("help/exiftool.txt"));
    }
    let expanded_args = match exiftool_argfiles::expand(args, cwd, fs) {
        Ok(args) => args,
        Err(e) => return err_out(&format!("Error: {e}\n"), 1),
    };
    let known = |name: &str| EXIF_TAGS.iter().copied().find(|t| t.eq_ignore_ascii_case(name));
    let (mut json_mode, mut bin_mode, mut tab_mode, mut csv_mode, mut xml_mode) = (false, false, false, false, false);
    let (mut group, mut short) = (0, 0usize);
    let (mut value_conv, mut overwrite_orig, mut in_place) = (false, false, false);
    let (mut numeric_size, mut missing) = (false, false);
    let mut print_fmt = None;
    let mut updates = Vec::new();
    let mut requested_tags = Vec::new();
    let (mut duplicates, mut quote_scalars) = (false, false);
    let mut files = Vec::new();
    let mut out_path = None;
    let mut tags_from_file = None;
    let mut literal = false;
    let mut parsed = expanded_args.iter();
    while let Some(a) = parsed.next() {
        if literal || !a.starts_with('-') || a == "-" { files.push(a.clone()); continue; }
        if a == "--" { literal = true; continue; }
        let option = a.to_ascii_lowercase();
        match option.as_str() {
            "-config" | "-charset" | "-api" | "-p" | "-o" | "-tagsfromfile" => {
                if option == "-tagsfromfile" && tags_from_file.is_some() { return err_out("Error: Multiple tagsFromFile sources are not yet supported\n", 1); }
                let Some(value) = parsed.next() else { return err_out(&format!("Error: Missing argument for {a}\n"), 1); };
                match option.as_str() {
                    "-config" if !value.is_empty() => return err_out("Error: User configuration modules are not supported\n", 1),
                    "-charset" if !value.eq_ignore_ascii_case("filename=utf8") => return err_out("Error: Only UTF-8 filename charset is currently supported\n", 1),
                    "-api" if !value.eq_ignore_ascii_case("structformat=jsonq") => return err_out("Error: API option not yet supported\n", 1),
                    "-api" => quote_scalars = true,
                    "-p" => print_fmt = Some(value.clone()),
                    "-o" => out_path = Some(value.clone()),
                    "-tagsfromfile" if value == "-" || value.contains('%') => return err_out("Error: tagsFromFile stdin and path templates are not yet supported\n", 1),
                    "-tagsfromfile" => tags_from_file = Some(value.clone()),
                    _ => {}
                }
            }
            "-j" | "-json" => json_mode = true, "-b" => bin_mode = true, "-csv" => csv_mode = true,
            "-x" => xml_mode = true, _ if a == "-T" => tab_mode = true,
            _ if a == "-G1" => group = 1, _ if a == "-G4" => group = 4,
            "-s" | "-ss" | "-sss" | "-s1" | "-s2" | "-s3" => {
                short = if a == "-S" || option == "-s2" {2} else if option == "-s1" {1}
                    else if option == "-s3" {3} else {(short + a.len() - 1).min(3)};
            }
            "-overwrite_original" | "-overwrite_original_in_place" => { overwrite_orig = true; in_place = option.ends_with("_in_place"); }
            "-f" => missing = true, "-n" => numeric_size = true, "-a" => duplicates = true,
            "-if" | "-stay_open" | "-@" | "-common_args" => return err_out(&format!("Error: ExifTool option not yet supported (no code evaluation or ambient polling): {a}\n"), 1),
            _ if option.starts_with("-execute") => return err_out(&format!("Error: ExifTool option not yet supported (no code evaluation or ambient polling): {a}\n"), 1),
            _ => {
                let (raw, value) = a[1..].split_once('=').map_or((&a[1..], None), |(k,v)| (k,Some(v)));
                let name = raw.strip_suffix(['+','-']).unwrap_or(raw);
                let operation = &raw[name.len()..];
                let selector = name.strip_suffix('#').unwrap_or(name);
                if let Some(v) = value {
                    updates.push((format!("{}{operation}", known(selector).unwrap_or(selector)), v.to_owned()));
                } else if let Some(tag) = known(selector).or_else(|| (selector == "MissingTag").then_some(selector)) {
                    value_conv |= selector != name;
                    numeric_size |= selector != name && tag == "FileSize";
                    requested_tags.push(tag.to_owned());
                } else { return err_out(&format!("Error: ExifTool option/tag not yet supported: {a}\n"), 1); }
            }
        }
    }
    let (s3_mode, s2_mode, group_mode) = (short == 3, short == 2, group == 1);
    if tags_from_file.is_some() && !updates.is_empty() {
        return err_out("Error: Combining tagsFromFile with assignments is not yet supported\n", 1);
    }
    let writing_mode = !updates.is_empty() || tags_from_file.is_some();
    if files.is_empty() {
        return err_out("Error: No file specified\n", 1);
    }
    if files.iter().filter(|f| f.as_str() == "-").count() > 1 {
        return err_out("Error: Repeated stdin operands are not supported\n", 1);
    }
    if files.iter().any(|f| f == "-") && writing_mode {
        return err_out("Error: Writing stdin metadata is not yet supported\n", 1);
    }
    if out_path.is_some() && (files.len() != 1 || !writing_mode) {
        return err_out("Error: -o requires a single file with tag assignments in this profile\n", 1);
    }
    if json_mode && bin_mode {
        return err_out("Error: JSON binary policy not yet supported\n", 1);
    }
    if csv_mode && (json_mode || bin_mode || writing_mode) {
        return err_out("Error: CSV combined output/import policy not yet supported\n", 1);
    }
    if csv_mode && value_conv { return err_out("Error: CSV ValueConv-qualified headers not yet supported\n", 1); }
    if group == 4 && (!json_mode || writing_mode) { return err_out("Error: Group-family qualification outside JSON not yet supported\n", 1); }
    if group == 1 && (json_mode || csv_mode || bin_mode || xml_mode || tab_mode || print_fmt.is_some() || writing_mode) {
        return err_out("Error: -G1 requires text extraction in this profile\n", 1);
    }
    let mode_count = [json_mode, csv_mode, bin_mode, xml_mode, tab_mode, print_fmt.is_some()]
        .into_iter()
        .filter(|x| *x)
        .count();
    if mode_count > 1 {
        return err_out("Error: Conflicting ExifTool output modes\n", 1);
    }
    if (xml_mode || tab_mode || print_fmt.is_some()) && writing_mode {
        return err_out("Error: Presentation modes require extraction\n", 1);
    }
    let mut substitutions = Vec::new();
    let template_prefix = if let Some(template) = &print_fmt {
        let mut parts = template.split('$');
        let prefix = parts.next().unwrap_or("");
        for suffix in parts {
            let (name, literal) = suffix.split_at(suffix.bytes().take_while(u8::is_ascii_alphabetic).count());
            let Some(tag) = known(name) else { return err_out("Error: Only literal $Tag template substitutions are supported\n", 1); };
            substitutions.push((tag, literal));
        }
        Some(prefix)
    } else { None };
    if let [(key, value)] = updates.as_slice()
        && let Some(error) = exiftool_shift_error(key, value)
    {
        return err_out(&format!("Warning: {error}\nNothing to do.\n"), 1);
    }
    let acquire = |path: &str| {
        let (entry, stat) = fs.inspect_command_entry(path, false, "lstat").map_err(|e| {
            if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") { "File not found".to_owned() } else { e }
        })?;
        if stat.kind != crate::vfs::VfsEntryKind::File || stat.mode & 0o170000 != 0o100000 {
            return Err("Only regular VFS files are admitted".into());
        }
        if stat.mode & 0o400 == 0 { return Err(format!("EACCES: permission denied, readStream '{path}'")); }
        let bytes = fs.read_file(&entry)?;
        Ok((stat, bytes))
    };
    let mut tags_from_file_err = None;
    if let Some(ref src_tag_file) = tags_from_file {
        let src_full = resolve_posix_path(cwd, src_tag_file);
        match acquire(&src_full) {
            Err(e) => tags_from_file_err = Some(e),
            Ok((_, src_bytes)) if src_bytes.is_empty() => tags_from_file_err = Some("Not a PNG file".into()),
            Ok((_, src_bytes)) => {
                let mut src_tags = BTreeMap::new();
                let mut order = Vec::new();
                let mut collect = |k: &str, v: String| {
                    if src_tags.insert(k.to_owned(), v).is_none() {order.push(k.to_owned());}
                };
                if src_full.to_ascii_lowercase().ends_with(".pdf")
                    || src_bytes.starts_with(b"%PDF-")
                {
                    let pdf = PdfDoc::parse(&src_bytes);
                    if !pdf.title.is_empty() {
                        collect("Title", pdf.title);
                    }
                    if !pdf.author.is_empty() {
                        collect("Author", pdf.author);
                    }
                    for (k, v) in pdf.info {
                        collect(&k, v);
                    }
                    for (k, v) in pdf.exif {
                        collect(&k, v);
                    }
                } else if exiftool_png::candidate(&src_bytes) {
                    if let Err(e) = exiftool_png::inspect(&src_bytes, |k,v,_| collect(k,v)) { tags_from_file_err = Some(e.into()); }
                } else {
                    let src_meta = read_image_meta(&src_bytes, &src_full);
                    for (k, v) in src_meta.exif {
                        if !k.starts_with("__") {
                            collect(&k, v);
                        }
                    }
                }
                for k in if requested_tags.is_empty() { &order } else { &requested_tags } {
                    if let Some(v) = src_tags.get(k) { updates.push((k.clone(), v.clone())); }
                }
            }
        }
    }
    if writing_mode {
        let mut created = 0usize;
        let mut serial = 0usize;
        let mut create = |path: &str, bytes: &[u8]| -> Result<(), String> {
            if path == "/" { return Err("EISDIR: illegal operation on a directory, capabilitiesFor '/'".into()); }
            let parent = crate::vfs::dirname_posix_path(path);
            let not_found = |e: &str| e.starts_with("ENOENT:") || e.ends_with("(os error 2)");
            let (_, st) = fs.inspect_command_entry(&parent, true, "stat")
                .map_err(|e| if not_found(&e) { "File not found".into() } else { e })?;
            serial += 1;
            if st.kind != crate::vfs::VfsEntryKind::Directory || st.mode & 0o300 != 0o300 {
                let mut stage = format!("{}/.exiftool-{serial}", parent.trim_end_matches('/'));
                if st.kind != crate::vfs::VfsEntryKind::Directory { return Err(format!("ENOTDIR: not a directory '{stage}'")); }
                while fs.lstat(&stage).is_ok() {
                    serial += 1;
                    stage = format!("{}/.exiftool-{serial}", parent.trim_end_matches('/'));
                }
                return Err(format!("EACCES: permission denied, createStagedFile '{stage}'"));
            }
            let entry = fs.access_path(path, false)?;
            fs.create_file(&entry, bytes, 0o666).map_err(|e| {
                if e.starts_with("EEXIST:") { format!("EAGAIN: resource temporarily unavailable, fileStaging '{path}'") }
                else { e }
            })
        };
        let mut updated = 0usize;
        let mut unchanged = 0usize;
        let mut err_out = String::new();
        for f in &files {
            let full = resolve_posix_path(cwd, f);
            let (original, data) = match acquire(&full) {
                Ok(file) => file,
                Err(e) => { err_out.push_str(&format!("Error: {e} - {f}\n")); continue; }
            };
            if data.is_empty() {
                err_out.push_str(&format!("Error: File is empty - {f}\n"));
                continue;
            }
            let extension = f.rsplit('.').next().unwrap_or("").to_ascii_uppercase();
            if matches!(extension.as_str(), "DOCX" | "PPTX" | "XLSX") {
                err_out.push_str(&format!("Error: Writing of {extension} files is not yet supported - {f}\n"));
                continue;
            }
            let is_pdf = extension == "PDF" || data.starts_with(b"%PDF-");
            if is_pdf && updates.iter().any(|(k, _)| k.eq_ignore_ascii_case("all")) {
                err_out.push_str(&format!(
                    "Error: PDF parser/writer not yet supported; metadata deletion retains historical revisions and never guarantees redaction - {f}\n"
                ));
                continue;
            }
            if !is_pdf && !data.starts_with(b"\xff\xd8") && !(data.len() >= 8 && data.starts_with(b"\x89PNG")) {
                err_out.push_str(&format!("Error: Format writer not yet supported - {f}\n")); continue;
            }
            if let Some(src_err) = &tags_from_file_err {
                err_out.push_str(&format!("Error: {src_err} - {f}\n")); continue;
            }
            let copied;
            let updates = if tags_from_file.is_some() && (is_pdf || exiftool_png::candidate(&data)) {
                copied = updates.iter().filter(|(k, _)| if is_pdf { pdf_reader::INFO_TAGS.contains(&k.as_str()) } else { exiftool_png::writable(k) }).cloned().collect::<Vec<_>>();
                &copied
            } else { &updates };
            let edited = if !is_pdf && exiftool_png::candidate(&data) {
                exiftool_png::edit(&data, updates, fs)
            } else if is_pdf && data.split(|&b| b == b'\n').nth(1) != Some(b"%%SAFE_PDF_V2%%") {
                pdf_reader::edit_info(&data, updates, tags_from_file.is_some()).map(|suffix| [data.as_slice(), &suffix].concat())
            } else {
                let mut edited = data.clone();
                for (k, v) in updates {
                    let k = k.trim_end_matches(['+', '-']);
                    edited.extend_from_slice(format!("\n__EXIF__:{k}={v}").as_bytes());
                }
                Ok(edited)
            };
            let edited = match edited {
                Ok(bytes) if out_path.is_none() && bytes == data && !updates.iter().any(|(k,v)| !v.is_empty() && !k.ends_with(['+', '-'])) => {
                    unchanged += 1;
                    continue;
                }
                Ok(bytes) => bytes,
                Err(e) => { err_out.push_str(&format!("Error: {e} - {f}\n")); continue; }
            };
            if out_path.is_none() {
                if original.mode & 0o200 == 0 {
                    err_out.push_str(&format!("Error: EACCES: permission denied, access '{full}' - {f}\n")); continue;
                }
                if !in_place && original.nlink != Some(1) {
                    err_out.push_str(&format!("Error: VFS hardlink replacement is not yet supported - {f}\n")); continue;
                }
            }
            if !overwrite_orig && out_path.is_none() {
                let orig_path = format!("{full}_original");
                match fs.lstat(&orig_path) {
                    Ok(_) => {}
                    Err(e) if e.starts_with("ENOENT:") || e.ends_with("(os error 2)") => {
                        if let Err(e) = create(&orig_path, &data) {
                            err_out.push_str(&format!("Error: {e} - {f}\n")); continue;
                        }
                    }
                    Err(e) => { err_out.push_str(&format!("Error: {e} - {f}\n")); continue; }
                }
            }
            if let Some(path) = &out_path {
                if path == "-" || path.contains('\0') {
                    err_out.push_str(&format!("Error: Invalid or unsupported ExifTool file path - {f}\n")); continue;
                }
                match create(&resolve_posix_path(cwd, path), &edited) {
                    Ok(()) => created += 1,
                    Err(e) => err_out.push_str(&format!("Error: {e} - {f}\n")),
                }
            } else {
                match fs.commit_file_edit(&full, &original, &data, &edited, in_place) {
                    Ok(()) => updated += 1,
                    Err(e) => err_out.push_str(&format!("Error: {e} - {f}\n")),
                }
            }
        }
        let mut stdout_str = if updated > 0 || unchanged > 0 {
            format!("{updated:>5} image files updated\n")
        } else {
            String::new()
        };
        if created > 0 { stdout_str.push_str(&format!("{created:>5} image files created\n")); }
        if unchanged > 0 { stdout_str.push_str(&format!("{unchanged:>5} image files unchanged\n")); }
        return BuiltinOutcome {
            stdout: stdout_str,
            stderr: err_out.clone(),
            exit_code: if err_out.is_empty() { 0 } else { 1 },
        };
    }
    let read_all_tags = |f: &str, data: &[u8]| {
        let full = resolve_posix_path(cwd, f);
        let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut order = Vec::new();
        let mut store = |name: &str, value: String, raw: Option<&[u8]>| {
            let values = map.entry(name.to_owned()).or_default();
            if values.is_empty() { order.push(name.to_owned()); }
            if !duplicates && group != 4 { values.clear(); }
            values.push(if bin_mode {
                crate::vfs::bytes_to_stream_string(raw.unwrap_or(value.as_bytes()))
            } else { value });
        };
        let mut insert = |name: &str, value: String| store(name, value, None);
        if f != "-" {
            let (dir, name) = f.rsplit_once('/').unwrap_or((".", f));
            insert("FileName", name.to_owned());
            insert("Directory", if dir.is_empty() { "/" } else { dir }.to_owned());
        }
        let size = data.len();
        insert("FileSize", if bin_mode || numeric_size { size.to_string() }
            else if size < 1000 { format!("{size} bytes") }
            else {
                let exp = (size.ilog10() as usize / 3).min(5);
                let scaled = size as f64 / 1000f64.powi(exp as i32);
                let places = 2usize.saturating_sub(scaled.log10().floor() as usize);
                // toPrecision rounds exact decimal ties upward; Rust formatting uses ties-to-even.
                let halfway = (scaled * (1 << places) as f64).fract() == 0.5;
                let display = if halfway { scaled.next_up() } else { scaled };
                let rounded = format!("{display:.places$}");
                let number = if places == 0 { &rounded } else { rounded.trim_end_matches('0').trim_end_matches('.') };
                format!("{number} {}", ["kB", "MB", "GB", "TB", "PB"][exp - 1])
            });
        if full.to_ascii_lowercase().ends_with(".pdf") || data.starts_with(b"%PDF-") {
            let pdf = PdfDoc::parse(data);
            insert("FileTypeExtension", "pdf".into());
            insert("PDFVersion", pdf.version);
            insert("PageCount", pdf.pages.len().to_string());
            let mut info: BTreeMap<_,_> = pdf.info.into_iter().collect();
            if !pdf.title.is_empty() { info.insert("Title".into(), pdf.title); }
            if !pdf.author.is_empty() { info.insert("Author".into(), pdf.author); }
            info.extend(pdf.exif);
            for &name in pdf_reader::INFO_TAGS {
                if let Some(value) = info.remove(name) && !value.is_empty() { insert(name, value); }
            }
        } else if exiftool_png::candidate(data) {
            insert("FileTypeExtension", "png".into());
            exiftool_png::inspect(data, store)?;
        } else {
            let im = read_image_meta(data, &full);
            let ext = if im.fmt == "JPEG" { "jpg".into() } else { im.fmt.to_ascii_lowercase() };
            insert("FileTypeExtension", ext);
            insert("ImageWidth", im.w.to_string());
            insert("ImageHeight", im.h.to_string());
            insert("BitDepth", "8".into());
            insert("ColorType", "RGB".into());
            let mime = format!("image/{}", im.fmt.to_ascii_lowercase());
            insert("FileType", im.fmt);
            insert("MIMEType", mime);
            insert("ImageSize", format!("{}x{}", im.w, im.h));
            for (k, v) in im.exif {
                if !k.starts_with("__") { insert(&k, v); }
            }
        }
        Ok::<_, &str>((map, order))
    };
    let mut records = Vec::new();
    let mut read_err_buf = String::new();
    for f in files {
        let data = if f == "-" { Ok(crate::vfs::stream_string_to_bytes(stdin)) }
            else { acquire(&resolve_posix_path(cwd, &f)).map(|(_, bytes)| bytes) };
        match data {
            Err(e) => read_err_buf.push_str(&format!("Error: {e} - {f}\n")),
            Ok(bytes) if bytes.is_empty() => read_err_buf.push_str(&format!("Error: File is empty - {f}\n")),
            Ok(bytes) => match read_all_tags(&f, &bytes) {
                Ok((tags, order)) => records.push((f, tags, order)),
                Err(e) => read_err_buf.push_str(&format!("Error: {e} - {f}\n")),
            }
        }
    }
    let finalize_exif_out = |stdout: String| BuiltinOutcome {
        stdout, stderr: read_err_buf.clone(), exit_code: i32::from(!read_err_buf.is_empty()),
    };
    if let Some(prefix) = template_prefix {
        let mut out = String::new();
        for (_, map, _) in &records {
            out.push_str(prefix);
            for &(tag, literal) in &substitutions {
                exif_printable(&mut out, map.get(tag).and_then(|vs| vs.last()).map(String::as_str).unwrap_or("-"));
                out.push_str(literal);
            }
            out.push('\n');
        }
        return finalize_exif_out(out);
    }
    if json_mode {
        let items = records.iter().map(|(file, map, order)| {
            let keys = if requested_tags.is_empty() { order } else { &requested_tags };
            exiftool_json::record(file, map, keys, group == 4, missing, quote_scalars)
        }).collect::<Vec<_>>();
        return finalize_exif_out(format!("[{}]\n", items.join(",\n")));
    }
    if csv_mode {
        let mut hdr = vec!["SourceFile".to_string()];
        for t in &requested_tags {
            hdr.push(t.clone());
        }
        let mut out = format!("{}\n", hdr.join(","));
        for (f, map, _) in &records {
            let mut row = vec![f.clone()];
            for t in &requested_tags {
                row.push(map.get(t).and_then(|v| v.last()).cloned().unwrap_or_else(|| "-".to_string()));
            }
            out.push_str(&format!("{}\n", row.join(",")));
        }
        return finalize_exif_out(if records.is_empty() && !read_err_buf.is_empty() { String::new() } else { out });
    }
    if xml_mode {
        let mut out = String::from("<?xml version='1.0' encoding='UTF-8'?>\n<rdf:RDF>\n");
        for (_, map, _) in &records {
            for (k, values) in map {
                let v = values.last().unwrap();
                out.push_str(&format!("  <PNG:{k}>{}</PNG:{k}>\n", html_escape_str(v)));
            }
        }
        out.push_str("</rdf:RDF>\n");
        return finalize_exif_out(out);
    }
    if tab_mode {
        let mut lines = Vec::new();
        for (_, map, order) in &records {
            let mut vals = Vec::new();
            let keys = if requested_tags.is_empty() { order } else { &requested_tags };
            for rt in keys {
                let values = map.get(rt);
                let first = values.and_then(|v| v.first()).map_or("-", String::as_str);
                let repeat = if requested_tags.is_empty() { values.map_or(1, Vec::len) } else { 1 };
                for _ in 0..repeat {
                    let mut value = String::new();
                    exif_printable(&mut value, first);
                    vals.push(value);
                }
            }
            lines.push(vals.join("\t"));
        }
        return finalize_exif_out(if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) });
    }
    let mut out = String::new();
    for (_, map, order) in &records {
        let keys = if requested_tags.is_empty() { order } else { &requested_tags };
        for absent in [false, true] {
            if absent && (!missing || bin_mode) { break; }
            for k in keys {
                let value = map.get(k);
                if value.is_none() != absent { continue; }
                for value in value.into_iter().flatten().map(String::as_str).chain(absent.then_some("-")) {
                    if bin_mode { out.push_str(value); continue; }
                    if group_mode && !absent {
                        let group = match k.as_str() {
                            "FileName" | "Directory" | "FileSize" => "System",
                            "FileTypeExtension" => "File",
                            _ => map.get("FileType").and_then(|v| v.last()).map_or("PDF", String::as_str),
                        };
                        out.push_str(&format!("{:<16}", format!("[{group}]")));
                    }
                    if s2_mode { out.push_str(&format!("{k}: ")); }
                    else if !s3_mode { out.push_str(&format!("{k:<32}: ")); }
                    exif_printable(&mut out, value);
                    out.push('\n');
                }
            }
        }
    }
    finalize_exif_out(out)
}

fn cmd_diffpdf(cmd: &str, args: &[String], cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut mode = "text";
    let mut files: Vec<String> = Vec::new();
    let mut positional = false;
    for arg in args {
        if !positional && arg == "--" {
            positional = true;
            continue;
        }
        if !positional && (arg == "--text" || arg == "--layout") {
            mode = if arg == "--text" { "text" } else { "layout" };
            continue;
        }
        if !positional && arg == "--help" {
            return ok_out("Usage: diffpdf [--text|--layout] OLD.pdf NEW.pdf\nExit 0: equal, 1: different, 2: invalid invocation.\n");
        }
        if !positional && arg.starts_with('-') {
            return err_out(&format!("diffpdf: unsupported option {arg}\n"), 2);
        }
        files.push(arg.clone());
    }
    if files.len() != 2 {
        return err_out("diffpdf: expected two PDF files\n", 2);
    }
    let mut docs: Vec<PdfDoc> = Vec::new();
    for f in &files {
        let full = resolve_posix_path(cwd, f);
        let Ok(bytes) = fs.read_file(&full) else {
            if fs.is_dir(&full) {
                return err_out(
                    &format!("{cmd}: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                    1,
                );
            }
            return err_out(
                &format!("{cmd}: ENOENT: no such file or directory, readFile '{full}'\n"),
                1,
            );
        };
        if !bytes.starts_with(b"%PDF-") {
            return err_out(
                &format!("diffpdf: {f}: Invalid PDF header: missing %PDF- signature\n"),
                2,
            );
        }
        docs.push(PdfDoc::parse(&bytes));
    }
    let a = &docs[0];
    let b = &docs[1];
    let max_p = a.pages.len().max(b.pages.len());
    let mut changed = false;
    let mut out = String::new();
    let page_sig = |doc: &PdfDoc, idx: usize| -> Option<String> {
        let pg = doc.pages.get(idx)?;
        let lines: Vec<&str> = pg
            .text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        if mode == "text" {
            Some(format!("{lines:?}"))
        } else {
            let (pw, ph) = doc
                .page_media
                .get(&(idx + 1))
                .map(|(w, h, _)| (*w, *h))
                .unwrap_or((doc.page_w, doc.page_h));
            Some(format!(
                "{:.2}:{:.2}:{}:{lines:?}:{:?}",
                pw, ph, pg.rot, pg.images
            ))
        }
    };
    for idx in 0..max_p {
        if page_sig(a, idx) != page_sig(b, idx) {
            changed = true;
            out.push_str(&format!("Page {} differs ({mode})\n", idx + 1));
        }
    }
    BuiltinOutcome {
        stdout: out,
        stderr: String::new(),
        exit_code: if changed { 1 } else { 0 },
    }
}

fn cmd_svgo(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut input_opt: Option<String> = None;
    let mut literal_opt: Option<String> = None;
    let mut outfile_opt: Option<String> = None;
    let mut precision = 3usize;
    let mut indent = 2usize;
    let mut pretty = false;
    let mut multipass = false;
    let mut end = false;
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !end && arg == "--" {
            end = true;
            i += 1;
            continue;
        }
        if !end && (arg == "--help" || arg == "-h") {
            return ok_out("Usage: svgo [INPUT|-] [-i INPUT] [-s STRING] [-o OUTPUT|-]\n            [--multipass] [-p PRECISION] [--pretty] [--indent N] [-q|--quiet]\nFile input is optimized in place unless -o is supplied. Stdin and strings default to stdout.\n");
        }
        if !end && matches!(arg, "--multipass" | "--pretty" | "-q" | "--quiet") {
            if arg == "--multipass" {
                multipass = true;
            }
            if arg == "--pretty" {
                pretty = true;
            }
            i += 1;
            continue;
        }
        if !end && arg != "-" && arg.starts_with('-') {
            if !matches!(
                arg,
                "-i" | "--input" | "-s" | "--string" | "-o" | "--output" | "-p" | "--precision" | "--indent"
            ) {
                return err_out(&format!("svgo: unknown option: {arg}\n"), 1);
            }
            if i + 1 >= args.len() {
                return err_out(&format!("svgo: missing value for {arg}\n"), 1);
            }
            i += 1;
            let val = &args[i];
            if arg == "-i" || arg == "--input" {
                if input_opt.is_some() {
                    return err_out("svgo: multiple inputs\n", 1);
                }
                input_opt = Some(val.clone());
            } else if arg == "-s" || arg == "--string" {
                if literal_opt.is_some() {
                    return err_out("svgo: multiple strings\n", 1);
                }
                literal_opt = Some(val.clone());
            } else if arg == "-o" || arg == "--output" {
                outfile_opt = Some(val.clone());
            } else {
                let max_v = if arg == "--indent" { 16usize } else { 15usize };
                let Ok(n) = val.trim().parse::<usize>() else {
                    return err_out(&format!("svgo: invalid {arg}\n"), 1);
                };
                if n > max_v {
                    return err_out(&format!("svgo: invalid {arg}\n"), 1);
                }
                if arg == "--indent" {
                    indent = n;
                } else {
                    precision = n;
                }
            }
        } else {
            if input_opt.is_some() {
                return err_out("svgo: multiple inputs\n", 1);
            }
            input_opt = Some(arg.to_string());
        }
        i += 1;
    }
    if input_opt.is_some() && literal_opt.is_some() {
        return err_out("svgo: choose input or string\n", 1);
    }
    let source = if let Some(ref lit) = literal_opt {
        lit.clone()
    } else if let Some(ref inp) = input_opt && inp != "-" {
        let full = resolve_posix_path(cwd, inp);
        if fs.is_dir(&full) {
            return err_out(
                &format!("svgo: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                1,
            );
        }
        let Ok(b) = fs.read_file(&full) else {
            return err_out(
                &format!("svgo: ENOENT: no such file or directory, readFile '{full}'\n"),
                1,
            );
        };
        String::from_utf8_lossy(&b).to_string()
    } else {
        stdin.to_string()
    };
    let mut result = source;
    let passes = if multipass { 10 } else { 1 };
    for _ in 0..passes {
        match optimize_svg_str(&result, precision, false, indent) {
            Ok(next) => {
                if next == result {
                    break;
                }
                result = next;
            }
            Err(e) => return err_out(&format!("svgo: {e}\n"), 1),
        }
    }
    if pretty {
        match optimize_svg_str(&result, precision, true, indent) {
            Ok(next) => result = next,
            Err(e) => return err_out(&format!("svgo: {e}\n"), 1),
        }
    }
    let target = outfile_opt.unwrap_or_else(|| {
        if literal_opt.is_some() {
            "-".to_string()
        } else {
            input_opt.unwrap_or_else(|| "-".to_string())
        }
    });
    if target == "-" {
        ok_out(&result)
    } else {
        let full = resolve_posix_path(cwd, &target);
        let _ = fs.write_file(&full, result.as_bytes());
        ok_out("")
    }
}

fn cmd_rsvg_convert(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    let mut format = "png".to_string();
    let mut output_opt: Option<String> = None;
    let mut input_opt: Option<String> = None;
    let mut positional = false;
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !positional && arg == "--" {
            positional = true;
            i += 1;
            continue;
        }
        if !positional && arg == "--help" {
            return ok_out("Usage: rsvg-convert [-f pdf|png] [-o OUTPUT] [INPUT]\n");
        }
        if !positional && (arg == "-f" || arg == "--format") {
            i += 1;
            format = args.get(i).cloned().unwrap_or_default();
            i += 1;
            continue;
        }
        if !positional && (arg == "-o" || arg == "--output") {
            i += 1;
            let Some(o) = args.get(i) else {
                return err_out("rsvg-convert: missing output path\n", 1);
            };
            output_opt = Some(o.clone());
            i += 1;
            continue;
        }
        if !positional && arg.starts_with('-') && arg != "-" {
            return err_out(&format!("rsvg-convert: unsupported option {arg}\n"), 1);
        }
        if input_opt.is_some() {
            return err_out("rsvg-convert: expected at most one input\n", 1);
        }
        input_opt = Some(arg.to_string());
        i += 1;
    }
    if format != "pdf" && format != "png" {
        return err_out(&format!("rsvg-convert: unsupported format {format}\n"), 1);
    }
    let src = if let Some(ref inp) = input_opt && inp != "-" {
        let full = resolve_posix_path(cwd, inp);
        let Ok(b) = fs.read_file(&full) else {
            if fs.is_dir(&full) {
                return err_out(
                    &format!("rsvg-convert: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                    1,
                );
            }
            return err_out(
                &format!("rsvg-convert: ENOENT: no such file or directory, readFile '{full}'\n"),
                1,
            );
        };
        String::from_utf8_lossy(&b).to_string()
    } else {
        stdin.to_string()
    };
    let rendered = match pdf_reader::render_svg(&src, &format, fs.max_input_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => return err_out(&format!("rsvg-convert: {e}\n"), 1),
    };
    if let Some(ref out_p) = output_opt && out_p != "-" {
        let full = resolve_posix_path(cwd, out_p);
        let _ = fs.write_file(&full, &rendered);
        ok_out("")
    } else {
        ok_out(&crate::vfs::bytes_to_stream_string(&rendered))
    }
}

fn cmd_soxi(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return ok_out("Usage: soxi [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE...\n");
    }
    run_audio_info("soxi", args, stdin, cwd, fs)
}

fn cmd_sox(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return ok_out("Usage: sox [FORMAT] INPUT... [FORMAT] OUTPUT [trim|pad|norm|gain -n|rate|channels|remix|fade|reverse|stat|stats|synth ...]\n       sox --i [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE\nFORMAT: -r RATE -c CHANNELS -b BITS -e ENCODING; -n is the null device. PCM processing reads and writes WAV.\n");
    }
    if args.first().map(|s| s.as_str()) == Some("--i") {
        return run_audio_info("sox", &args[1..], stdin, cwd, fs);
    }
    #[derive(Default, Clone)]
    struct SoxFmt {
        rate: Option<u32>,
        channels: Option<usize>,
        bits: Option<u32>,
        encoding: Option<String>,
        ftype: Option<String>,
    }
    impl SoxFmt {
        fn is_empty(&self) -> bool {
            self.rate.is_none()
                && self.channels.is_none()
                && self.bits.is_none()
                && self.encoding.is_none()
                && self.ftype.is_none()
        }
    }
    let is_effect = |s: &str| {
        matches!(
            s,
            "trim"
                | "pad"
                | "norm"
                | "gain"
                | "rate"
                | "channels"
                | "remix"
                | "fade"
                | "reverse"
                | "stat"
                | "stats"
                | "synth"
        )
    };
    let mut files: Vec<(String, SoxFmt)> = Vec::new();
    let mut pending = SoxFmt::default();
    let mut index = 0usize;
    while index < args.len() {
        let arg = args[index].as_str();
        if is_effect(arg) {
            break;
        }
        if matches!(arg, "-r" | "-c" | "-b" | "-e" | "-t") {
            index += 1;
            let Some(val) = args.get(index) else {
                return err_out(&format!("sox: Missing {arg}\n"), 1);
            };
            if arg == "-e" {
                pending.encoding = Some(val.clone());
            } else if arg == "-t" {
                if val != "wav" {
                    return err_out("sox: Only WAV PCM format is supported\n", 1);
                }
                pending.ftype = Some("wav".to_string());
            } else {
                let Ok(num) = sox_numeric(Some(val), arg) else {
                    return err_out(&format!("sox: Invalid {arg}: {val}\n"), 1);
                };
                if num.fract() != 0.0 || num < 1.0 {
                    return err_out(&format!("sox: Invalid {arg}\n"), 1);
                }
                let n = num as u32;
                if arg == "-r" {
                    pending.rate = Some(n);
                } else if arg == "-c" {
                    if n > 64 {
                        return err_out("sox: Channel limit exceeded\n", 1);
                    }
                    pending.channels = Some(n as usize);
                } else {
                    pending.bits = Some(n);
                }
            }
        } else {
            if arg.starts_with('-') && arg != "-" && arg != "-n" {
                return err_out(&format!("sox: Unknown option {arg}\n"), 1);
            }
            files.push((arg.to_string(), pending));
            pending = SoxFmt::default();
        }
        index += 1;
    }
    if !pending.is_empty() {
        return err_out("sox: Format options require a file\n", 1);
    }
    if files.len() < 2 || files.len() > 65 {
        return err_out("sox: Expected input and output files\n", 1);
    }
    let output = files.pop().unwrap();
    let mut buffers: Vec<PcmAudio> = Vec::new();
    for (inp_name, inp_opts) in &files {
        if inp_name == "-n" {
            if files.len() != 1 {
                return err_out("sox: Null input must stand alone\n", 1);
            }
            continue;
        }
        let data = if inp_name == "-" {
            crate::vfs::stream_string_to_bytes(stdin)
        } else {
            let full = resolve_posix_path(cwd, inp_name);
            if fs.is_dir(&full) {
                return err_out(
                    &format!("sox: EISDIR: illegal operation on a directory, readFile '{full}'\n"),
                    1,
                );
            }
            let Ok(b) = fs.read_file(&full) else {
                return err_out(
                    &format!("sox: ENOENT: no such file or directory, readFile '{full}'\n"),
                    1,
                );
            };
            b
        };
        let (mut pcm, info) = match decode_wav_pcm(&data) {
            Ok(v) => v,
            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
        };
        if let Some(ref enc) = inp_opts.encoding {
            let actual = if info.codec == "pcm_float" {
                "floating-point"
            } else if info.bits_per_sample == 8 {
                "unsigned-integer"
            } else {
                "signed-integer"
            };
            if enc != actual {
                return err_out("sox: Input encoding override disagrees with WAV header\n", 1);
            }
        }
        if let Some(r) = inp_opts.rate {
            pcm.sample_rate = r;
        }
        if let Some(ch) = inp_opts.channels && ch != pcm.channels.len() {
            return err_out("sox: Input channel override disagrees with WAV header\n", 1);
        }
        if let Some(b) = inp_opts.bits && b != info.bits_per_sample {
            return err_out("sox: Input precision override disagrees with WAV header\n", 1);
        }
        buffers.push(pcm);
    }
    let null_opts = if files.first().map(|f| f.0.as_str()) == Some("-n") {
        files[0].1.clone()
    } else {
        SoxFmt::default()
    };
    let out_opts = SoxFmt {
        rate: output.1.rate.or(null_opts.rate),
        channels: output.1.channels.or(null_opts.channels),
        bits: output.1.bits.or(null_opts.bits),
        encoding: output.1.encoding.clone().or(null_opts.encoding),
        ftype: output.1.ftype.clone().or(null_opts.ftype),
    };
    let mut pcm = if buffers.is_empty() {
        PcmAudio {
            sample_rate: out_opts.rate.unwrap_or(48000),
            channels: vec![Vec::new(); out_opts.channels.unwrap_or(1)],
        }
    } else {
        let first_sr = buffers[0].sample_rate;
        let first_ch = buffers[0].channels.len();
        if buffers.iter().any(|b| b.sample_rate != first_sr || b.channels.len() != first_ch) {
            return err_out("sox: Concatenation requires matching sample rates and channels\n", 1);
        }
        let mut chs = vec![Vec::new(); first_ch];
        for b in buffers {
            for (ci, cvec) in b.channels.into_iter().enumerate() {
                chs[ci].extend(cvec);
            }
        }
        PcmAudio {
            sample_rate: first_sr,
            channels: chs,
        }
    };
    let eff_args = &args[index..];
    let mut ei = 0usize;
    let mut stderr = String::new();
    while ei < eff_args.len() {
        let eff = eff_args[ei].as_str();
        let is_opt = |idx: usize| idx < eff_args.len() && !is_effect(&eff_args[idx]);
        match eff {
            "trim" => {
                ei += 1;
                let start = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                let dur = if is_opt(ei + 1) {
                    ei += 1;
                    match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                        Ok(v) => Some(v),
                        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                    }
                } else {
                    None
                };
                let st_idx = js_math_round(start * (pcm.sample_rate as f64)) as usize;
                let end_idx = dur.map(|d| st_idx + js_math_round(d * (pcm.sample_rate as f64)) as usize);
                for ch in &mut pcm.channels {
                    let s = st_idx.min(ch.len());
                    let e = end_idx.unwrap_or(ch.len()).min(ch.len()).max(s);
                    *ch = ch[s..e].to_vec();
                }
            }
            "pad" => {
                ei += 1;
                let lead = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                let trail = if is_opt(ei + 1) {
                    ei += 1;
                    match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                        Ok(v) => v,
                        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                    }
                } else {
                    0.0
                };
                let lead_n = js_math_round(lead * (pcm.sample_rate as f64)) as usize;
                let trail_n = js_math_round(trail * (pcm.sample_rate as f64)) as usize;
                for ch in &mut pcm.channels {
                    let mut out = vec![0.0f64; lead_n + ch.len() + trail_n];
                    out[lead_n..lead_n + ch.len()].copy_from_slice(ch);
                    *ch = out;
                }
            }
            "norm" | "gain" => {
                if eff == "gain" {
                    ei += 1;
                    if eff_args.get(ei).map(|s| s.as_str()) != Some("-n") {
                        return err_out("sox: Only gain -n is supported\n", 1);
                    }
                }
                let target_db = if is_opt(ei + 1) {
                    ei += 1;
                    match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "gain") {
                        Ok(v) => v,
                        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                    }
                } else {
                    0.0
                };
                let (peak, _, _, _, _, _) = sox_stats(&pcm);
                let gain = if peak > 0.0 {
                    10f64.powf(target_db / 20.0) / peak
                } else {
                    1.0
                };
                for ch in &mut pcm.channels {
                    for v in ch.iter_mut() {
                        *v *= gain;
                    }
                }
            }
            "rate" => {
                ei += 1;
                let r = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "sample rate") {
                    Ok(v) if v.fract() == 0.0 && v > 0.0 => v as u32,
                    Ok(_) => return err_out("sox: Invalid sample rate\n", 1),
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                pcm = sox_resample(&pcm, r);
            }
            "channels" => {
                ei += 1;
                let cnt = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "channels") {
                    Ok(v) if v.fract() == 0.0 && v >= 1.0 && v <= 64.0 => v as usize,
                    Ok(_) => return err_out("sox: Audio sample limit exceeded\n", 1),
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                pcm = match sox_remix(&pcm, cnt, None) {
                    Ok(p) => p,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
            }
            "remix" => {
                let mut matrix: Vec<Vec<f64>> = Vec::new();
                while is_opt(ei + 1) {
                    ei += 1;
                    let spec = &eff_args[ei];
                    let list: Vec<&str> = spec.split(',').collect();
                    let mut row = vec![0.0f64; pcm.channels.len()];
                    for item in &list {
                        let ch_num = match sox_numeric(Some(item), "channel") {
                            Ok(v) => v,
                            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                        };
                        if ch_num == 0.0 && list.len() == 1 {
                            continue;
                        }
                        if ch_num.fract() != 0.0 || ch_num < 1.0 || (ch_num as usize) > row.len() {
                            return err_out("sox: Invalid remix channel\n", 1);
                        }
                        row[(ch_num as usize) - 1] = 1.0 / (list.len() as f64);
                    }
                    matrix.push(row);
                }
                if matrix.is_empty() {
                    return err_out("sox: Audio sample limit exceeded\n", 1);
                }
                let mlen = matrix.len();
                pcm = match sox_remix(&pcm, mlen, Some(matrix)) {
                    Ok(p) => p,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
            }
            "reverse" => {
                for ch in &mut pcm.channels {
                    ch.reverse();
                }
            }
            "fade" => {
                let mut shape = "l";
                if let Some(nx) = eff_args.get(ei + 1).map(|s| s.as_str())
                    && matches!(nx, "q" | "h" | "t" | "l" | "p")
                {
                    ei += 1;
                    shape = nx;
                }
                ei += 1;
                let fade_in = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                let cur_frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                let has_stop = is_opt(ei + 1);
                let stop = if has_stop {
                    ei += 1;
                    match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                        Ok(v) => v,
                        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                    }
                } else {
                    (cur_frames as f64) / (pcm.sample_rate as f64)
                };
                let fade_out = if is_opt(ei + 1) {
                    ei += 1;
                    match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                        Ok(v) => v,
                        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                    }
                } else if has_stop {
                    fade_in
                } else {
                    0.0
                };
                if stop > 0.0 {
                    let target_len = js_math_round(stop * (pcm.sample_rate as f64)) as usize;
                    for ch in &mut pcm.channels {
                        ch.resize(target_len, 0.0);
                    }
                }
                let lead = js_math_round(fade_in * (pcm.sample_rate as f64)) as usize;
                let trail = js_math_round(fade_out * (pcm.sample_rate as f64)) as usize;
                let length = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                let curve = |v: f64| -> f64 {
                    match shape {
                        "q" => (v * std::f64::consts::PI / 2.0).sin(),
                        "h" => (1.0 - (v * std::f64::consts::PI).cos()) / 2.0,
                        "p" => (1.0 + 9.0 * v).log10(),
                        "t" => 10f64.powf(5.0 * (v - 1.0)),
                        _ => v,
                    }
                };
                for ch in &mut pcm.channels {
                    for (idx, val) in ch.iter_mut().enumerate() {
                        let c_in = curve(if lead > 0 { ((idx as f64) / (lead as f64)).min(1.0) } else { 1.0 });
                        let c_out = curve(if trail > 0 { (((length - 1 - idx) as f64) / (trail as f64)).min(1.0) } else { 1.0 });
                        *val *= c_in * c_out;
                    }
                }
            }
            "synth" => {
                ei += 1;
                let dur = match sox_seconds(eff_args.get(ei).map(|s| s.as_str()), pcm.sample_rate) {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                ei += 1;
                let kind = eff_args.get(ei).map(|s| s.as_str()).unwrap_or("");
                ei += 1;
                let freq = match sox_numeric(eff_args.get(ei).map(|s| s.as_str()), "frequency") {
                    Ok(v) => v,
                    Err(e) => return err_out(&format!("sox: {e}\n"), 1),
                };
                if freq < 0.0 || freq > (pcm.sample_rate as f64) / 2.0 {
                    return err_out("sox: Frequency exceeds Nyquist limit\n", 1);
                }
                if !matches!(kind, "sine" | "square" | "triangle" | "sawtooth") {
                    return err_out("sox: Unsupported synth waveform\n", 1);
                }
                let length = js_math_round(dur * (pcm.sample_rate as f64)) as usize;
                let wave: Vec<f64> = (0..length)
                    .map(|idx| {
                        let phase = (idx as f64) * freq / (pcm.sample_rate as f64);
                        match kind {
                            "sine" => (2.0 * std::f64::consts::PI * phase).sin(),
                            "square" => if phase % 1.0 < 0.5 { 1.0 } else { -1.0 },
                            "triangle" => 1.0 - 4.0 * (js_math_round(phase) - phase).abs(),
                            _ => 2.0 * (phase - (phase + 0.5).floor()),
                        }
                    })
                    .collect();
                for ch in &mut pcm.channels {
                    *ch = wave.clone();
                }
            }
            "stat" | "stats" => {
                let frames = pcm.channels.first().map(|c| c.len()).unwrap_or(0);
                let (peak, rms, peak_db, rms_db, dc, crest) = sox_stats(&pcm);
                let len_s = (frames as f64) / (pcm.sample_rate as f64);
                if eff == "stat" {
                    stderr.push_str(&format!(
                        "Samples read:      {}\nLength (seconds): {:.6}\nMaximum amplitude: {:.6}\nRMS amplitude:     {:.6}\nMean amplitude:    {:.6}\n",
                        frames * pcm.channels.len(),
                        len_s,
                        peak,
                        rms,
                        dc
                    ));
                } else {
                    let fmt_db = |v: f64| if v == f64::NEG_INFINITY { "-Infinity".to_string() } else { format!("{v:.2}") };
                    stderr.push_str(&format!(
                        "DC offset   {:.6}\nPk lev dB   {}\nRMS lev dB  {}\nCrest factor {:.2}\nNum samples {}\nLength s    {:.6}\n",
                        dc,
                        fmt_db(peak_db),
                        fmt_db(rms_db),
                        crest,
                        frames,
                        len_s
                    ));
                }
            }
            _ => return err_out(&format!("sox: Unsupported effect {eff}\n"), 1),
        }
        ei += 1;
    }
    if let Some(r) = out_opts.rate && r != pcm.sample_rate {
        pcm = sox_resample(&pcm, r);
    }
    if let Some(ch) = out_opts.channels && ch != pcm.channels.len() {
        pcm = match sox_remix(&pcm, ch, None) {
            Ok(p) => p,
            Err(e) => return err_out(&format!("sox: {e}\n"), 1),
        };
    }
    let floating = out_opts.encoding.as_deref() == Some("floating-point");
    let bits = out_opts.bits.unwrap_or(if floating {
        32
    } else if out_opts.encoding.as_deref() == Some("unsigned-integer") {
        8
    } else {
        16
    });
    if let Some(ref enc) = out_opts.encoding {
        if !matches!(enc.as_str(), "signed-integer" | "unsigned-integer" | "floating-point") {
            return err_out("sox: Unsupported encoding\n", 1);
        }
        if (enc == "unsigned-integer" && bits != 8) || (enc == "signed-integer" && bits == 8) {
            return err_out("sox: WAV uses unsigned 8-bit and signed 16/24/32-bit PCM\n", 1);
        }
    }
    let wav_bytes = match encode_wav_pcm(&pcm, bits, floating) {
        Ok(b) => b,
        Err(e) => return err_out(&format!("sox: {e}\n"), 1),
    };
    let mut stdout = String::new();
    if output.0 == "-" {
        stdout = crate::vfs::bytes_to_stream_string(&wav_bytes);
    } else if output.0 != "-n" {
        if out_opts.ftype.as_deref() != Some("wav") && !output.0.to_ascii_lowercase().ends_with(".wav") {
            return err_out("sox: Output must be WAV (.wav)\n", 1);
        }
        let full = resolve_posix_path(cwd, &output.0);
        let _ = fs.write_file(&full, &wav_bytes);
    }
    BuiltinOutcome {
        stdout,
        stderr,
        exit_code: 0,
    }
}

fn cmd_qrencode(args: &[String], stdin: &str, cwd: &str, fs: &dyn SafeBashFs) -> BuiltinOutcome {
    const QR_HELP: &str = "Usage: qrencode [OPTION]... [STRING]\nGenerate QR codes from a string, stdin, or a virtual file.\n  -o, --output FILE       Virtual output file (- for stdout)\n  -r, --read-from FILE    Read input from a virtual file\n  -t, --type TYPE         PNG, PNG32, SVG, EPS, ASCII, ASCIIi,\n                         UTF8, UTF8i, ANSI, ANSI256, ANSIUTF8, ANSIUTF8i, ANSI256UTF8\n  -s, --size N            Module pixel size (default 3)\n  -m, --margin N          Quiet zone (default 4, Micro QR 2)\n  -l, --level L|M|Q|H     Error correction (default L)\n  -v, --symversion N      Minimum version (0 auto, QR 1..40, Micro 1..4)\n  -d, --dpi N            PNG resolution (default 72)\n  -8, --8bit             Encode raw bytes\n  -k, --kanji            Interpret Shift-JIS pairs as Kanji\n  -i, --ignorecase       Fold ASCII lowercase to uppercase\n  -S, --structured       Structured append (requires -v and -o)\n  -M, --micro            Generate Micro QR\n      --strict-version   Fail instead of increasing version\n      --foreground=RRGGBB[AA]  Foreground color\n      --background=RRGGBB[AA]  Background color\n  -h, --help             Show help\n";
    if args.is_empty() { return err_out(QR_HELP, 1); }
    // Linux atoi saturates at long bounds before narrowing to int.
    let integer = |val: &str| -> i32 {
        let val = val.trim_start_matches([' ', '\t', '\r', '\n', '\x0b', '\x0c']);
        let digits = val.strip_prefix(['-', '+']).unwrap_or(val);
        let mut number = 0i64;
        for byte in digits.bytes().take_while(u8::is_ascii_digit) {
            let digit = (byte - b'0') as i64;
            number = number.saturating_mul(10).saturating_add(if val.starts_with('-') { -digit } else { digit });
        }
        number as i32
    };
    let parse_color = |val: &str| -> Result<[u8; 4], String> {
        if (val.len() != 6 && val.len() != 8) || !val.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Colors must be RRGGBB or RRGGBBAA".to_string());
        }
        let r = u8::from_str_radix(&val[0..2], 16).unwrap();
        let g = u8::from_str_radix(&val[2..4], 16).unwrap();
        let b = u8::from_str_radix(&val[4..6], 16).unwrap();
        let a = if val.len() == 8 { u8::from_str_radix(&val[6..8], 16).unwrap() } else { 255 };
        Ok([r, g, b, a])
    };
    let mut output_opt: Option<String> = None;
    let mut input_opt: Option<String> = None;
    let mut operand_opt: Option<String> = None;
    let mut rtype = "PNG".to_string();
    let mut size = 3usize;
    let mut dpi = 72;
    let mut margin_opt: Option<usize> = None;
    let mut level = 0usize; // L=0, M=1, Q=2, H=3
    let mut version = 0usize;
    let mut byte_mode = false;
    let mut kanji = false;
    let mut ignorecase = false;
    let mut structured = false;
    let mut micro = false;
    let mut strict = false;
    let mut fg = [0u8, 0, 0, 255];
    let mut bg = [255u8, 255, 255, 255];
    let mut short_offset = 1usize;
    let mut end = false;
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !end && arg == "--" {
            end = true;
            i += 1;
            continue;
        }
        if end || !arg.starts_with('-') || arg == "-" {
            operand_opt.get_or_insert_with(|| arg.to_string());
            i += 1;
            continue;
        }
        let is_long = arg.starts_with("--");
        let eq = if is_long { arg.find('=') } else { None };
        let raw_name = if is_long {
            match eq {
                Some(pos) => &arg[2..pos],
                None => &arg[2..],
            }
        } else {
            arg.get(short_offset..short_offset + 1).unwrap_or("")
        };
        let key = match raw_name {
            "output" => "o",
            "read-from" => "r",
            "type" => "t",
            "size" => "s",
            "margin" => "m",
            "dpi" => "d",
            "level" => "l",
            "symversion" => "v",
            "structured" => "S",
            "kanji" => "k",
            "casesensitive" => "c",
            "ignorecase" => "i",
            "8bit" => "8",
            "micro" => "M",
            "help" => "h",
            "version" => "V",
            other => other,
        };
        let attached = if is_long { eq.map(|pos| &arg[pos + 1..]) }
            else { arg.get(short_offset + 1..).filter(|v| !v.is_empty()) };
        if !matches!(key, "o" | "r" | "t" | "s" | "m" | "d" | "l" | "v" | "foreground" | "background") {
            if is_long && attached.is_some() {
                return err_out(&format!("qrencode: Unexpected option value: {arg}\n"), 1);
            }
            match key {
                "h" => return ok_out(QR_HELP),
                "V" => return ok_out("qrencode version 4.1.1\nCopyright (C) 2006-2017 Kentaro Fukuchi\n"),
                "8" => byte_mode = true,
                "k" => kanji = true,
                "i" => ignorecase = true,
                "c" => ignorecase = false,
                "S" => structured = true,
                "M" => micro = true,
                "strict-version" => strict = true,
                _ if !is_long => {
                    let bytes = crate::vfs::stream_string_to_bytes(arg);
                    let ch = crate::vfs::bytes_to_stream_string(&bytes[short_offset..short_offset + 1]);
                    return err_out(&format!("qrencode: invalid option -- '{ch}'\nTry \"qrencode --help\" for more information.\n"), 1);
                }
                _ => return err_out(&format!("qrencode: Unknown option: {arg}\n"), 1),
            }
            if !is_long && short_offset + 1 < arg.len() { short_offset += 1; }
            else { short_offset = 1; i += 1; }
            continue;
        }
        short_offset = 1;
        let val = match attached {
            Some(v) => v.to_owned(),
            None => {
                i += 1;
                let Some(v) = args.get(i) else { return err_out(&format!("qrencode: Missing value for {arg}\n"), 1); };
                v.clone()
            }
        };
        match key {
            "o" => output_opt = Some(val),
            "r" => input_opt = Some(val),
            "t" => {
                let Some(format) = ["PNG", "PNG32", "SVG", "EPS", "ASCII", "ASCIIi", "UTF8", "UTF8i", "ANSI", "ANSI256", "ANSIUTF8", "ANSIUTF8i", "ANSI256UTF8"]
                    .into_iter().find(|name| val.eq_ignore_ascii_case(name)) else {
                    return err_out(&format!("Invalid image type: {val}\n"), 1);
                };
                rtype = format.to_string();
            }
            "s" | "m" | "d" | "v" => {
                let number = integer(&val);
                if number < i32::from(key == "s") {
                    let label = match key { "s" => "size", "m" => "margin", "d" => "DPI", _ => "version" };
                    return err_out(&format!("Invalid {label}: {number}\n"), 1);
                }
                match key {
                    "s" => size = number as usize,
                    "m" => margin_opt = Some(number as usize),
                    "d" => dpi = number as u32,
                    _ => version = number as usize,
                }
            }
            "l" => match val.as_bytes().first().map(u8::to_ascii_uppercase) {
                Some(b'L') => level = 0,
                Some(b'M') => level = 1,
                Some(b'Q') => level = 2,
                Some(b'H') => level = 3,
                _ => return err_out(&format!("Invalid level: {val}\n"), 1),
            },
            "foreground" => match parse_color(&val) {
                Ok(c) => fg = c,
                Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
            },
            "background" => match parse_color(&val) {
                Ok(c) => bg = c,
                Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
            },
            _ => {}
        }
        i += 1;
    }
    if output_opt.is_none() && matches!(rtype.as_str(), "PNG" | "PNG32") {
        return err_out("No output filename is given.\n", 1);
    }
    let input_limit = if structured { 113_424usize } else { 7089usize };
    let mut data = if let Some(op) = &operand_opt {
        if crate::vfs::stream_byte_len(op) > input_limit { return err_out("qrencode: Input exceeds byte limit\n", 1); }
        crate::vfs::stream_string_to_bytes(op)
    } else if let Some(inp) = input_opt {
        if inp.is_empty() { return err_out("Cannot read input file .\n", 1); }
        let full = resolve_posix_path(cwd, &inp);
        if fs.is_dir(&full) { return err_out("No input data.\n", 1); }
        match fs.read_file(&full) {
            Ok(bytes) => bytes,
            Err(e) if matches!(e.split(':').next(), Some("ENOENT" | "ENOTDIR" | "EACCES")) =>
                return err_out(&format!("Cannot read input file {inp}.\n"), 1),
            Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
        }
    } else {
        crate::vfs::stream_string_to_bytes(stdin)
    };
    if data.len() > input_limit {
        return err_out("qrencode: Input exceeds byte limit\n", 1);
    }
    if data.is_empty() && operand_opt.is_none() { return err_out("No input data.\n", 1); }
    let max_version = if micro { 4 } else { 40 };
    if version > max_version { return err_out(&format!("Version number should be less or equal to {max_version}.\n"), 1); }
    if micro && structured { return err_out("Micro QR Code does not support structured symbols.\n", 1); }
    if micro && level == 3 { return err_out("Failed to encode the input data: Invalid argument\n", 1); }
    if !byte_mode && let Some(nul) = data.iter().position(|&b| b == 0) { data.truncate(nul); }
    if data.is_empty() { return err_out("Failed to encode the input data: Invalid argument\n", 1); }
    if structured {
        if version == 0 { return err_out("Version number must be specified to encode structured symbols.\n", 1); }
        if output_opt.is_none() { return err_out("An output filename must be specified to store the structured images.\n", 1); }
        if matches!(rtype.as_str(), "PNG32" | "ASCIIi" | "ANSI256UTF8") { return err_out("Unknown image type.\n", 1); }
    }
    if ignorecase && !byte_mode {
        let mut idx = 0usize;
        while idx < data.len() {
            if kanji && qr_kanji_value(&data, idx) >= 0 {
                idx += 2;
                continue;
            }
            if data[idx].is_ascii_lowercase() {
                data[idx] -= 32;
            }
            idx += 1;
        }
    }
    let opts = QrEncodeOpts {
        version,
        level,
        byte_mode,
        kanji,
        micro,
        strict,
        append: None,
    };
    let syms = match qr_encode_symbols(&data, opts, structured) {
        Ok(s) => s,
        Err(e) => return err_out(&format!("qrencode: {e}\n"), 1),
    };
    let margin = margin_opt.unwrap_or(if micro { 2 } else { 4 });
    let mut stdout_bytes = Vec::new();
    for (idx, sym) in syms.iter().enumerate() {
        let n = sym.len();
        let width = n.saturating_add(margin.saturating_mul(2));
        let pixels = width.saturating_mul(size);
        let raster = rtype == "PNG" || rtype == "PNG32";
        let vector = rtype == "SVG" || rtype == "EPS";
        let estimate = if raster {
            pixels.saturating_mul(pixels).saturating_mul(24).saturating_add(1_048_576)
        } else if vector {
            n.saturating_mul(n).saturating_mul(240).saturating_add(4096)
        } else {
            width.saturating_mul(width).saturating_mul(48).saturating_add(4096)
        };
        let max_mem = (64 * 1024 * 1024usize)
            .saturating_sub(data.len().saturating_mul(64))
            .saturating_sub(n.saturating_mul(n).saturating_mul(16));
        if (raster || vector) && pixels > 0x7fff_ffff || estimate > max_mem {
            return err_out("qrencode: QR output exceeds memory budget\n", 1);
        }
        let rendered = qr_render(sym, &rtype, size, margin, dpi, fg, bg);
        if let Some(ref out_p) = output_opt && (structured || out_p != "-") {
            let mut name = out_p.clone();
            if structured {
                let ext = match rtype.as_str() { "PNG" => ".png", "SVG" => ".svg", "EPS" => ".eps", _ => ".txt" };
                let dot = name.len().checked_sub(ext.len()).filter(|&pos| pos > 0 && name.get(pos..).is_some_and(|s| s.eq_ignore_ascii_case(ext))).unwrap_or(name.len());
                name.insert_str(dot, &format!("-{:02}", idx + 1));
            }
            if name.is_empty() { return err_out("Failed to create file: \nNo such file or directory\n", 1); }
            let full = resolve_posix_path(cwd, &name);
            if let Err(error) = fs.write_file(&full, &rendered) {
                let message = match error.split_once(':').map(|(code,_)| code) {
                    Some("EISDIR") => format!("EISDIR: illegal operation on a directory, writeFile '{full}'"),
                    Some("ENOTDIR") => format!("ENOTDIR: not a directory, writeFile '{full}'"),
                    _ => error,
                };
                return err_out(&format!("qrencode: {message}\n"), 1);
            }
        } else {
            stdout_bytes.extend_from_slice(&rendered);
        }
    }
    ok_out(&crate::vfs::bytes_to_stream_string(&stdout_bytes))
}


#[cfg(test)]
mod media_unit_tests {
    use super::*;
    use crate::vfs::MemoryVfs;

    fn media_args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn ffmpeg_decodes_avc_without_configuration_and_rejects_bad_packets() {
        let fs = MemoryVfs::new();
        let original = include_bytes!("../../tests/fixtures/av.mp4");
        let at = original.windows(4).position(|s| s == b"avcC").unwrap();
        let args = media_args(&["-i", "av.mp4", "-vf", "scale=10:8", "-f", "yuv4mpegpipe", "-"]);
        for case in ["absent", "length", "missing-sps", "truncated-slice"] {
            let mut input = original.to_vec();
            match case {
                "absent" => input[at..at+4].copy_from_slice(b"junk"),
                "length" => input[at+8] = 0xfc,
                "missing-sps" => input[at+9] = 0xe0,
                _ => {
                    let stco = input.windows(4).position(|s| s == b"stco").unwrap();
                    let offset = u32::from_be_bytes(input[stco+12..stco+16].try_into().unwrap()) as usize;
                    let size = u32::from_be_bytes(input[offset..offset+4].try_into().unwrap());
                    input[offset..offset+4].copy_from_slice(&(size-1).to_be_bytes());
                }
            }
            fs.write_file("/av.mp4", &input).unwrap();
            let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            if case == "absent" {
                assert_eq!(r.exit_code, 0, "{}", r.stderr);
                let bytes = crate::vfs::stream_string_to_bytes(&r.stdout);
                assert_eq!(hex_enc(&sha256_bytes(&bytes)), "251fc7740d37be3594b4e3ebdd004dab395848294b18addbb3d3d8371ef008ea");
            } else {
                assert_eq!(r.exit_code, 1);
                assert_eq!(r.stderr, "ffmpeg: H.264 packet decode failed (-1094995529)\n");
            }
        }
    }

    #[test]
    fn ffmpeg_preserves_avi_descriptions_and_packet_flags_across_containers() {
        let fs = MemoryVfs::new();
        let args = media_args(&["-y", "-i", "clip.avi", "out.webm"]);
        for (mode, hash) in [
            ("signed", "cca4790b31eb6e864e5a0249de8b7bebe6c6e4830df52e78340e7789d0c58e61"),
            ("mjpeg", "21e2468d08517427c3b0e03466310f227e66b62fd3aed0e48882f18271ef9990"),
            ("audio-key", "96718773e959b9d6bffb782f5b4298a34f71b52a6d9130d52496f709dc7c05ba"),
        ] {
            let mut bytes = include_bytes!("../../tests/fixtures/av.avi").to_vec();
            let fmt = bytes.windows(4).position(|s| s == b"strf").unwrap() + 8;
            match mode {
                "signed" => bytes[fmt+4..fmt+8].copy_from_slice(&(-7i32).to_le_bytes()),
                "mjpeg" => bytes[fmt+16..fmt+20].copy_from_slice(b"MJPG"),
                _ => {
                    let second = bytes.windows(4).enumerate().filter(|(_, s)| *s == b"01wb").nth(1).unwrap().0;
                    bytes[second..second+4].copy_from_slice(b"01dc");
                }
            }
            fs.write_file("/clip.avi", &bytes).unwrap();
            let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{mode}: {}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.webm").unwrap())), hash, "{mode}");
        }
    }

    #[test]
    fn ffmpeg_converts_avi_input_packets_and_rejects_invalid_headers() {
        let fs = MemoryVfs::new();
        let args = media_args(&["-y", "-i", "clip.avi", "-c", "copy", "out.mp4"]);
        fs.write_file("/clip.avi", include_bytes!("../../tests/fixtures/av.avi")).unwrap();
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.mp4").unwrap())),
            "9c4938cd04f8dd1919fa292343182383adae702683cc7917b90e1f01c956f323");
        fs.write_file("/clip.avi", b"RIFF").unwrap();
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 1);
        assert_eq!(r.stderr, "ffmpeg: Invalid AVI file: missing RIFF AVI header\n");
    }

    #[test]
    fn ffmpeg_filters_avi_video_using_its_original_descriptor() {
        let fs = MemoryVfs::new();
        let mut bytes = include_bytes!("../../tests/fixtures/av.avi").to_vec();
        let fmt = bytes.windows(4).position(|s| s == b"strf").unwrap() + 8;
        bytes[fmt+16..fmt+20].copy_from_slice(b"MJPG");
        let args = media_args(&["-y","-i","clip.avi","-vf","scale=8:8","out.ts"]);
        fs.write_file("/clip.avi", &bytes).unwrap();
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.ts").unwrap())), "367596a649bb2afd46e97217d2ca82442f0704ca4b2da3ce9f87796b7134b656");
        bytes[fmt+4..fmt+8].copy_from_slice(&(-7i32).to_le_bytes());
        fs.write_file("/clip.avi", &bytes).unwrap();
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.stderr, "ffmpeg: Invalid H.264 pixel limit\n");
    }

    #[test]
    fn ffmpeg_retains_discontinuous_transport_timestamps() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i","av.mp4","-c","copy","out.ts"]), "", "/", &fs);
        assert_eq!(r.exit_code,0);
        let mut bytes = fs.read_file("/out.ts").unwrap();
        let mut stamps = [0u32,22500,8000].into_iter();
        for p in bytes.chunks_exact_mut(188) {
            if p[1] & 0x5f == 0x41 && p[2] == 0 {
                let n=stamps.next().unwrap();
                let at=4+if p[3]&32!=0 {1+usize::from(p[4])} else {0};
                p[at+9..at+14].copy_from_slice(&[33,0,1,(n>>7) as u8,(n as u8)<<1|1]);
            }
        }
        fs.write_file("/changed.ts",&bytes).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i","changed.ts","copy.ts"]), "", "/", &fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/copy.ts").unwrap())), "ecd90cd055941caf7b083ae29c317b154fcb97601e552cbbfa598e1403872d69");
    }

    #[test]
    fn ffmpeg_copies_transport_streams_into_mp4() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        for args in [["-i","av.mp4","-c","copy","out.ts"], ["-i","out.ts","-c","copy","copy.mp4"]] {
            let r = cmd_media_doc("ffmpeg", &media_args(&args), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
        }
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/copy.mp4").unwrap())), "25157f452eb0572942c2da1767c9f0766d9f73555b8144cbcaf3f52c2802af65");
    }

    #[test]
    fn ffprobe_reads_transport_stream_pes_packets_and_m2ts_framing() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "out.ts"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code, 0);
        let ts = fs.read_file("/out.ts").unwrap();
        let mut m2ts = Vec::new();
        for pkt in ts.chunks_exact(188) {m2ts.extend_from_slice(&[0;4]);m2ts.extend_from_slice(pkt);}
        fs.write_file("/out.m2ts", &m2ts).unwrap();
        for name in ["out.ts", "out.m2ts"] {
            let args = media_args(&["-show_entries","stream=codec_name,width,height,duration_ts,nb_frames","-of","csv=p=0",name]);
            let r = cmd_media_doc("ffprobe",&args,"","/",&fs);
            assert_eq!(r.stdout, "h264,6,4,67500,3\naac,33792,33\n");
        }
    }

    #[test]
    fn ffprobe_reads_hls_packets_and_measures_the_playlist() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "-hls_time", "0.25", "streams/list.m3u8"]);
        assert_eq!(cmd_media_doc("ffmpeg", &args, "", "/", &fs).exit_code, 0);
        let args = media_args(&["-count_packets","-show_entries","stream=codec_name,nb_read_packets:format=format_name,size,duration","-of","csv=p=0","streams/list.m3u8"]);
        let r = cmd_media_doc("ffprobe", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(r.stdout, "aac,35\nh264,3\nhls,0.750000,175\n");
    }

    #[test]
    fn ffmpeg_concat_url_appends_real_sample_tables() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i","concat:clip.mp4|clip.mp4","-c","copy","joined.mp4"]);
        let r = cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/joined.mp4").unwrap())), "99eda334b9cdfcd6aa43479e2eb015bd03a244060aaf4688135231ccebd654a2");
    }

    #[test]
    fn ffmpeg_concat_list_resolves_relative_paths_and_cuts_each_clip() {
        let fs = MemoryVfs::new();
        fs.mkdir("/lists", true, 0o755).unwrap();
        fs.write_file("/clip.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        fs.write_file("/lists/cut", b"file '../clip.mp4'\ninpoint 0.1\noutpoint 0.5\nfile '../clip.mp4'\nduration 0.2\n").unwrap();
        let args = media_args(&["-f","concat","-i","lists/cut","-c","copy","joined.mp4"]);
        let r = cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/joined.mp4").unwrap())), "e66c62877cd3437672fed8fce8b4398f9acceeee209d70ce7806fb988c2a2b10");
    }

    #[test]
    fn ffmpeg_seeks_joined_pcm_with_different_sample_rates() {
        let fs = MemoryVfs::new();
        for args in [
            media_args(&["-f","lavfi","-i","sine=r=8000:d=0.2","s.wav"]),
            media_args(&["-f","lavfi","-i","sine=r=12000:d=0.31","t.wav"]),
            media_args(&["-ss",".1","-i","concat:s.wav|t.wav","joined.wav"]),
        ] {
            let r = cmd_media_doc("ffmpeg",&args,"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
        }
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/joined.wav").unwrap())), "038d4980a8cc5a31861786af377e6740f01cb5c2446040377731b19e584f06a3");
    }

    #[test]
    fn ffmpeg_rejoins_dash_audio_and_video_representations() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "streams/list.mpd"]);
        assert_eq!(cmd_media_doc("ffmpeg", &args, "", "/", &fs).exit_code, 0);
        let args = media_args(&["-i", "streams/list.mpd", "-c", "copy", "copy.mp4"]);
        let result = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/copy.mp4").unwrap())), "4d95bb88547f6ec16bff0d20007f9b45a3357ff2f82c48ef58dc3cbccaa0d406");
    }

    #[test]
    fn ffmpeg_rejoins_hls_segment_files_without_padding_tracks() {
        for (format, expected) in [
            ("mpegts", "fc1d255e4dff2651fa455a2fd0bde4e91344acb51c212019b949a4547afe1ba5"),
            ("fmp4", "dd4e067e8d0709a23ce68853c910b85c812ea96a7e8036a30a4ff662cdbcf798"),
        ] {
            let fs = MemoryVfs::new();
            fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
            let args = media_args(&["-i","av.mp4","-hls_time","0.2","-hls_segment_type",format,"media/list.m3u8"]);
            assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
            let args = media_args(&["-i","media/list.m3u8","-c","copy","copy.mp4"]);
            let result = cmd_media_doc("ffmpeg",&args,"","/",&fs);
            assert_eq!(result.exit_code,0,"{}",result.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/copy.mp4").unwrap())),expected,"{format}");
        }
    }

    #[test]
    fn ffmpeg_keeps_fragment_timestamps_when_hls_uses_a_shared_init() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i","av.mp4","-hls_time","0.2","-hls_segment_type","fmp4","list.m3u8"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
        let mut playlist = String::from("#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n");
        for i in 0..3 {
            let bytes = fs.read_file(&format!("/seg_{i:03}.m4s")).unwrap();
            let moof = bytes.windows(4).position(|w|w==b"moof").unwrap()-4;
            if i==0 {fs.write_file("/init.mp4",&bytes[..moof]).unwrap();}
            fs.write_file(&format!("/part{i}"),&bytes[moof..]).unwrap();
            playlist.push_str(&format!("#EXTINF:0.25,\npart{i}\n"));
        }
        fs.write_file("/segments.m3u8",playlist.as_bytes()).unwrap();
        let args=media_args(&["-i","segments.m3u8","-c","copy","rejoined.ts"]);
        let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/rejoined.ts").unwrap())), "28c195337e4be2a125174dc70fe9e6c167820150f13916c3b180b14d227afeac");
    }

    #[test]
    fn ffmpeg_segments_hls_on_keyframes_and_names_nested_files() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "-hls_time", "0.2", "-hls_segment_filename", "out/nested/chunk%02d.ts", "out/a.m3u"]);
        let result = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        for (name, digest) in [
            ("/out/a.m3u", "e8306a2d8ae46734c44812d1299c5ed07b4a6669328369ab111dcd1448a2ebf9"),
            ("/out/nested/chunk00.ts", "5c2fe77d97b49b5e8f05a51576549918340723a3cb4e1c7a1fb8e1ab9f65a4a9"),
            ("/out/nested/chunk01.ts", "d11007c297b9ca05f1dd43285cb28efcd89ee9604badfd41780c960de611c1fe"),
            ("/out/nested/chunk02.ts", "c421bcdfdfc94d8d013229278bb8ee75a5aa12fdff69730a2c15484f1d6ca872"),
        ] {
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(name).unwrap())), digest, "{name}");
        }
    }

    #[test]
    fn ffmpeg_writes_dash_manifest_and_fragments() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "out/movie.mpd"]);
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        for (name, digest) in [
            ("/out/chunk-stream0-00001.m4s", "f65e08bdcdfec2d2cf18091b7bde5a1bf56a412ae450c2690b44a509568057f0"),
            ("/out/chunk-stream1-00001.m4s", "20d8664b5a401ae3eac3abb8133cc460cd02a7626b9d93f0092c38ca74ca85c8"),
            ("/out/init-stream0.m4s", "f97411f4ef8e90a54797ff9dfc14ea912e9224375f0a1849afbddbfa3d8b04cf"),
            ("/out/init-stream1.m4s", "f2c76a9378b2dce960cf54a1316c16b9854d78ec5bae2f41a8d122902de68e19"),
            ("/out/movie.mpd", "e48b6fcfd294cf2d4b325818cc23b1ee4f8f6992932e05121f5fa7ac10a2eb56"),
        ] {
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(name).unwrap())), digest, "{name}");
        }
    }

    #[test]
    fn ffmpeg_dash_keeps_movie_duration_when_limiting_video_frames() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-frames:v", "1", "-f", "dash", "manifest"]);
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        let xml = String::from_utf8(fs.read_file("/manifest").unwrap()).unwrap();
        assert!(xml.contains("mediaPresentationDuration=\"PT0.750000S\""));
        assert!(xml.contains("<S t=\"0\" d=\"22500\"/>"));
    }

    #[test]
    fn ffmpeg_writes_transport_packets_with_audio_and_video() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i", "av.mp4", "-c", "copy", "out.ts"]);
        let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        let bytes = fs.read_file("/out.ts").unwrap();
        assert_eq!(hex_enc(&sha256_bytes(&bytes)), "5eb3a0bde1ba145e9021d948246cb5cecd8773d68c55b93fc7da67dd818c366a");
    }

    #[test]
    fn ffmpeg_writes_avi_streams_and_packet_index() {
        let fs=MemoryVfs::new();
        fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","av.mp4","-c","copy","clip.avi"]),"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(fs.read_file("/clip.avi").unwrap().as_slice(),include_bytes!("../../tests/fixtures/av.avi"));
    }

    #[test]
    fn ffmpeg_writes_matroska_and_webm_tracks_blocks_and_tags() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        fs.write_file("/a.srt", b"1\n00:00:00,000 --> 00:00:01,000\nhello\n").unwrap();
        for (source, format, expected) in [
            ("-i av.mp4 -c copy", "mkv", "5e45cc5bc8fd2fc06cdde7b641ddfbe6b5b273cd8b16f5acad8a0b3a8483c1fc"),
            ("-i av.mp4 -c copy", "webm", "c4afbbb95430f5938f97a5b1dadae5bdcef1b20027f6484ae8d3394ef4eb2193"),
            ("-i a.srt", "mkv", "9e5c170feb33994639ccd0d77193964a0f7e49287d241bf2c1d2aeb52b8094cf"),
            ("-i av.mp4 -metadata title=hello -metadata artist=Sample", "mkv", "26de4a6aff2be480ddf8a7433482badb587a90a37c13614248c8dd62011b63c7"),
            ("-f lavfi -i color=s=4x4:r=4:d=1", "webm", "84e24f10ae7396bd549c4861762a5722d26928a2433f25f5e3a9d37e1aed0da1"),
        ] {
            let args = format!("-y {source} out.{format}").split_whitespace().map(str::to_owned).collect::<Vec<_>>();
            let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            let bytes = fs.read_file(&format!("/out.{format}")).unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&bytes)), expected, "{source} -> {format}");
        }
    }

    #[test]
    fn ffmpeg_copies_flv_input_packets_to_mp4_and_flv() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "av.mp4", "clip.flv"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        for (flags, dst, expected) in [
            ("-c copy", "out.mp4", "b45122766b1cf2cfda34124538b32613b675ead1cf75913037c8244e0a062688"),
            ("-c copy", "out.flv", "5d6e959ddafd2e9f482bfcb40370215b2e110b94c65840831349285e769f6155"),
            ("-ac 1 -f flv", "mono.flv", "a9620f7b0e94a84972d94b22c9e936aaa3259f992c71fef4848c1304e9deb3b2"),
            ("-f yuv4mpegpipe", "decoded.y4m", "eb4ebcc962ed654a081dd282c60dfd23a77f1c49fad8d1a2130843eac017a0f5"),
            ("-ss 0.05 -t 0.3", "cut.mp4", "7e93d48cde577e82327c4ef94a2655409f531186cae83229642680642405fe2c"),
        ] {
            let args = format!("-i clip.flv {flags} {dst}").split_whitespace().map(str::to_owned).collect::<Vec<_>>();
            let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            let bytes = fs.read_file(&format!("/{dst}")).unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&bytes)), expected, "{dst}");
        }
    }

    #[test]
    fn ffmpeg_remuxes_matroska_input_tracks() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4"))
            .unwrap();
        let r = cmd_media_doc(
            "ffmpeg",
            &media_args(&["-i", "av.mp4", "-c", "copy", "clip.mkv"]),
            "",
            "/",
            &fs,
        );
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        for (flags, dst, digest) in [
            (
                "-c copy",
                "out.mp4",
                "efaa4493317d68546f95b58bbc17096a79f5c3e7905839d205fae6950e6cfcc6",
            ),
            (
                "-c copy",
                "out.flv",
                "a5f66d489a0c2b1ac7ad2114e811076903836d46881d77bfccc44a8e8ea24416",
            ),
            (
                "-c copy",
                "out.y4m",
                "eb4ebcc962ed654a081dd282c60dfd23a77f1c49fad8d1a2130843eac017a0f5",
            ),
            (
                "-frames:v 1",
                "out.mkv",
                "8d12b9b981abe08b0e15909f66c13a7cce7e4323c04914269e63dde9f59f23ce",
            ),
        ] {
            let args = format!("-i clip.mkv {flags} {dst}")
                .split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let r = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(
                hex_enc(&sha256_bytes(&fs.read_file(&format!("/{dst}")).unwrap())),
                digest,
                "{dst}"
            );
        }
    }

    #[test]
    fn matroska_subtitle_export_keeps_cue_text_and_gaps() {
        let fs = MemoryVfs::new();
        let text =
            "1\n00:00:01,000 --> 00:00:01,750\nfirst\n\n2\n00:00:03,000 --> 00:00:03,500\nsecond\n";
        fs.write_file("/a.srt", text.as_bytes()).unwrap();
        for (src, dst) in [("a.srt", "s.mkv"), ("s.mkv", "out.srt")] {
            let r = cmd_media_doc("ffmpeg", &media_args(&["-i", src, dst]), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
        }
        assert_eq!(fs.read_file("/out.srt").unwrap(), text.as_bytes());
    }

    #[test]
    fn ffmpeg_rejects_invalid_matroska_before_writing_output() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip.webm", &[0x1a, 0x45]).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "clip.webm", "out.mp4"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stderr.as_str()), (1, "ffmpeg: Invalid Matroska/WebM file: missing EBML header signature\n"));
        assert!(!fs.exists("/out.mp4"));
    }

    #[test]
    fn ffprobe_reads_avi_stream_headers_and_movie_chunks() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip.avi", include_bytes!("../../tests/fixtures/av.avi")).unwrap();
        let r = cmd_media_doc("ffprobe", &media_args(&["-show_entries", "stream=codec_name,width,height,duration_ts,nb_frames", "-of", "csv=p=0", "clip.avi"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "h264,6,4,67500,3\naac,33792,33\n", ""));
    }

    #[test]
    fn avi_empty_video_chunk_extends_the_preceding_packet() {
        let fs=MemoryVfs::new();
        let mut clip=include_bytes!("../../tests/fixtures/av.avi").to_vec();
        clip.extend_from_slice(b"00dc\0\0\0\0");
        fs.write_file("/clip.avi",&clip).unwrap();
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_packets","-show_entries","packet=stream_index,duration,size,pos,flags","-of","csv=p=0","clip.avi"]),"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(r.stdout.lines().take(3).collect::<Vec<_>>(), ["0,22500,395,0,K_", "0,22500,394,395,__","0,45000,394,789,__"]);
    }

    #[test]
    fn ffprobe_reads_matroska_tracks_and_blocks() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "av.mp4", "-c", "copy", "clip.mkv"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        let r = cmd_media_doc("ffprobe", &media_args(&["-show_entries", "stream=codec_name,width,height,nb_frames,duration_ts",
            "-of", "csv=p=0", "clip.mkv"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "h264,6,4,750,3\naac,766,33\n", ""));
    }

    #[test]
    fn ffprobe_reads_both_flv_tracks_from_their_tags() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "av.mp4", "-c", "copy", "clip.flv"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        let r = cmd_media_doc("ffprobe", &media_args(&["-show_entries", "stream=codec_name,width,height,nb_frames,duration_ts",
            "-of", "csv=p=0", "clip.flv"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stdout.as_str(), r.stderr.as_str()), (0, "h264,6,4,533,3\naac,759,33\n", ""));
    }

    #[test]
    fn ffmpeg_writes_flv_tags_for_copied_tracks_and_generated_frames() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        for (source, digest) in [
            ("-i av.mp4 -ac 1", "4eabee78b39daa46272a04f116fdfb9218e97e0c2052dfd953b30b9001cee9af"),
            ("-f lavfi -i color=s=4x4:r=29.97:d=4 -vf trim=start=0.3:end=1", "813aa5d02caaa52182e43dec263556e9db9184d159050d127e262ec2886fe493"),
            ("-i av.mp4 -c copy", "74c32c137488ebbc18a9a6bc205f79146d1e5813821518806b96d274af661e94"),
            ("-f lavfi -i color=c=red:s=4x4:r=2:d=1", "af594745a1a177d991d07d9254bf5f78b451b851435219dc422c7a6245f01782"),
            ("-f lavfi -i sine=f=440:r=8000:d=0.1", "0fb79724d44245e7daf6d0fa0b30a2f37c06efeb704b846e5ca6300ed3b7f352"),
        ] {
            let args = format!("-y {source} out.flv").split_whitespace().map(str::to_owned).collect::<Vec<_>>();
            let result = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let bytes = fs.read_file("/out.flv").unwrap();
            assert_eq!(bytes.get(..4), Some(b"FLV\x01".as_slice()), "{source}");
            assert_eq!(hex_enc(&sha256_bytes(&bytes)), digest, "{source}");
        }
    }

    #[test]
    fn ffmpeg_pulls_only_from_selected_pipe_operands_in_order() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for script in ["ffmpeg -filters >/dev/null", "ffmpeg -i missing -i - -f null - 2>/dev/null",
            "ffmpeg -i 'concat:missing|-' -f null - 2>/dev/null", "printf bad >unknown; ffmpeg -i unknown -i - -f null - 2>/dev/null"] {
            let result = shell.exec_with_stream(&format!("{script}; cat"), [Err("source failed".into())].into_iter()).unwrap();
            assert_eq!((result.exit_code, result.stderr.as_str()), (1, "cat: source failed\n"), "{script}");
        }
        for (script, data, error) in [
            ("ffmpeg -i /dev/stdin -f null -", "invalid", "ffmpeg: /dev/stdin: Unsupported input format (AST not registered)\n"),
            ("ffmpeg -i - out.mkv", "invalid", "ffmpeg: -: Unsupported input format (AST not registered)\n"),
            ("ffmpeg -i pipe:0 -i - -f null -", "WEBVTT\n", "ffmpeg: -: Unsupported input format (AST not registered)\n"),
        ] {
            let result = shell.exec_with_stream(&format!("{script}; cat"), [Ok(data.as_bytes().to_vec())].into_iter()).unwrap();
            assert_eq!((result.stdout.as_str(), result.stderr.as_str()), ("", error), "{script}");
        }
    }

    #[test]
    fn ffprobe_reads_stdin_only_for_a_pipe_operand() {
        let (mut shell, _) = crate::shell::Shell::with_memory_fs();
        for script in ["ffprobe -version >/dev/null", "ffprobe missing 2>/dev/null"] {
            let result = shell.exec_with_stream(&format!("{script}; cat"), [Err("source failed".into())].into_iter()).unwrap();
            assert_eq!((result.exit_code, result.stderr.as_str()), (1, "cat: source failed\n"), "{script}");
        }
        let result = shell.exec_with_stream("ffprobe -; cat", [Ok(b"invalid".to_vec())].into_iter()).unwrap();
        assert_eq!((result.exit_code, result.stdout.as_str(), result.stderr.as_str()),
            (0, "", "ffprobe: -: Invalid data found when processing input or format AST not registered\n"));
        shell.set_limits(crate::budget::ShellLimits { max_input_bytes: 5, ..Default::default() });
        let error = shell.exec_with_stream("ffprobe -v quiet -", [Ok(b"abcdef".to_vec())].into_iter()).unwrap_err();
        assert!(error.contains("maxInputBytes"), "{error}");
    }

    #[test]
    fn ffprobe_rejects_unknown_inputs_and_honors_an_explicit_demuxer() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip", b"YUV4MPEG2 W1 H1\n").unwrap();
        fs.write_file("/input", b"not a video").unwrap();
        let run = |opts: &[&str]| cmd_media_doc("ffprobe", &media_args(opts), "", "/", &fs);
        for (args, reason) in [
            (vec!["-f","wav","clip"], "Invalid WAV file: missing RIFF WAVE signature"),
            (vec!["-f","bogus","input"], "Unknown input format: 'bogus' (AST not registered)"),
            (vec!["input"], "input: Invalid data found when processing input or format AST not registered"),
        ] {
            let result=run(&args);
            assert_eq!((result.exit_code,result.stdout,result.stderr),(1,String::new(),format!("ffprobe: {reason}\n")));
        }
        let quiet=run(&["-v","quiet","input"]);
        assert_eq!((quiet.exit_code,quiet.stderr),(1,String::new()));
    }

    #[test]
    fn ffprobe_accepts_standard_input_aliases_and_preserves_the_spelling() {
        let fs = MemoryVfs::new();
        for path in ["pipe:", "/dev/fd/0", "/dev/stdin", "-", "pipe:0"] {
            let args = media_args(&["-show_entries","format=filename:stream=nb_frames","-of","csv=p=0","-i",path]);
            let r = cmd_media_doc("ffprobe",&args,"YUV4MPEG2 W2 H2 F25:1\nFRAME\n111111","/",&fs);
            assert_eq!((r.exit_code,r.stdout,r.stderr),(0,format!("1\n{path}\n"),String::new()));
        }
    }

    #[test]
    fn ffprobe_replays_fragment_offsets_flags_and_decode_times() {
        fn atom(name:&[u8;4],payload:&[u8])->Vec<u8>{
            [((8+payload.len()) as u32).to_be_bytes().as_slice(),name,payload].concat()
        }
        let words=|values:&[u32]|values.iter().flat_map(|v|v.to_be_bytes()).collect::<Vec<_>>();
        let mvex=atom(b"mvex",&atom(b"trex",&words(&[0,1,1,20,3,0])));
        let moov=atom(b"moov",&[atom(b"trak",&[]),mvex].concat());
        let traf=atom(b"traf",&[atom(b"tfhd",&words(&[0,1])),atom(b"tfdt",&words(&[1<<24,1,0])),
            atom(b"trun",&words(&[(1<<24)|0xc00,2,0x02000000,(-2i32) as u32,0x01010000,4]))].concat());
        let fs=MemoryVfs::new();fs.write_file("/frag.mp4",&[moov,atom(b"moof",&traf)].concat()).unwrap();
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_packets","-show_entries","packet=pts,dts,duration,size,pos,flags","-of","csv=p=0","frag.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stdout,r.stderr),(0,"4294967294,4294967296,20,3,0,K_\n4294967320,4294967316,20,3,3,__\n".into(),String::new()));
    }

    #[test]
    fn ffprobe_mp4_chapters_use_the_next_start_or_the_movie_duration() {
        // moov/udta/chpl, two titles with start times in 100-nanosecond ticks.
        let mut clip=b"\0\0\0\0moov\0\0\0\0udta\0\0\0\0chpl".to_vec();
        clip.extend_from_slice(&[0,0,0,0,0,0,0,0,2]);
        for (start,title) in [(0u64,"Start"),(2_500_000,"Déjà")]{
            clip.extend_from_slice(&start.to_be_bytes());
            clip.push(title.len() as u8);clip.extend_from_slice(title.as_bytes());
        }
        let fs=MemoryVfs::new();fs.write_file("/chapters.mp4",&clip).unwrap();
        let run=|writer|cmd_media_doc("ffprobe",&media_args(&["-show_entries","chapter=id","-of",writer,"chapters.mp4"]),"","/",&fs).stdout;
        assert_eq!(run("default=nw=1"), "id=0\ntime_base=1/1000\nstart=0\nstart_time=0.000000\nend=250\nend_time=0.250000\nTAG:title=Start\nid=1\ntime_base=1/1000\nstart=250\nstart_time=0.250000\nend=250\nend_time=0.250000\nTAG:title=Déjà\n");
        assert_eq!(run("csv"),"");
    }

    #[test]
    fn ffprobe_reads_mp4_tracks_and_samples() {
        // Three 6x4 AVC frames at 4 fps and a stereo AAC track, from createSyntheticMp4.
        let fs=MemoryVfs::new();
        fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let run=|args:&[&str]| cmd_media_doc("ffprobe",&media_args(args),"","/",&fs);
        let probe=run(&["-count_frames","-show_entries","stream=index,codec_name,width,height,duration,nb_frames,nb_read_frames:format=size,format_name","-of","csv=p=0","av.mp4"]);
        assert_eq!((probe.exit_code,probe.stdout,probe.stderr),(0,"0,h264,6,4,0.750000,3,3\n1,aac,0.750000,33,33\n\"mov,mp4,m4a,3gp,3g2,mj2\",2883\n".into(),String::new()));
        let packets=run(&["-show_packets","-show_entries","packet=stream_index,pts,size,pos","-of","csv=p=0","av.mp4"]);
        assert_eq!(packets.stdout.lines().take(4).collect::<Vec<_>>(), ["0,0,395,0","0,22500,394,395","0,45000,394,789","1,0,6,0"]);
        assert_eq!(packets.stdout.lines().count(),36);
    }

    #[test]
    fn ffprobe_requires_a_top_level_mp4_movie_atom() {
        let fs=MemoryVfs::new();
        for bytes in [b"not media".as_slice(), b"\0\0\0\0mdat\0\0\0\x08moov",b"\0\0\0\x01moov"] {
            fs.write_file("/bad.mp4",bytes).unwrap();
            let r=cmd_media_doc("ffprobe",&media_args(&["bad.mp4"]),"","/",&fs);
            assert_eq!((r.exit_code,r.stdout,r.stderr),(1,String::new(),"ffprobe: Invalid MP4/ISOBMFF file: missing 'moov' atom\n".into()));
        }
    }

    #[test]
    fn ffprobe_empty_file_sniffing_differs_from_explicit_format_and_stdin() {
        let fs = MemoryVfs::new();
        fs.write_file("/empty.aac", b"").unwrap();
        let run = |args: &[&str]| cmd_media_doc("ffprobe", &media_args(args), "", "/", &fs);
        assert_eq!(run(&["empty.aac"]).stderr, "ffprobe: EINVAL: invalid argument, read '/empty.aac'\n");
        for name in ["empty.aac","-"] {
            assert_eq!(run(&["-f","aac","-show_entries","stream=sample_rate,channels,nb_frames","-of","csv=p=0",name]).stdout, "44100,2,0\n");
        }
    }

    #[test]
    fn ffmpeg_duration_uses_a_numeric_prefix_or_zero() {
        let fs = MemoryVfs::new();
        for (spec, frames) in [("invalid", 0), ("", 0), ("0.5tail", 2), ("00:00.5junk", 2),
            ("1e-1tail", 1), ("500xms", 2), ("500000us", 2)] {
            let args = media_args(&["-f", "lavfi", "-i", "testsrc=s=4x4:r=4:d=1", "-t", spec, "-f", "y4m", "-"]);
            let result = cmd_media_doc("ffmpeg", &args, "", "/", &fs);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            assert_eq!(result.stdout.matches("FRAME\n").count(), frames, "{spec}");
        }
    }

    #[test]
    fn ffmpeg_empty_mp4_interval_inside_a_frame_does_not_emit_that_frame() {
        let fs=MemoryVfs::new();fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-ss","0.2","-i","av.mp4","-t","0","-f","y4m","-"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stdout,r.stderr),(0,"YUV4MPEG2 W6 H4 F30:1 Ip A1:1 C420jpeg\n".into(),String::new()));
    }

    #[test]
    fn ffmpeg_decodes_mp4_pcm_macroblocks_to_y4m() {
        let fs=MemoryVfs::new();fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","av.mp4","-frames:v","1","-f","y4m","-"]),"","/",&fs);
        let expected=[&b"YUV4MPEG2 W6 H4 F1:1 Ip A1:1 C420jpeg\nFRAME\n"[..],&[116,116,116,116,117,117,116,116,117,117,118,118,117,117,118,118,119,119,118,118,119,119,120,120,86,85,84,84,84,83,191,192,194,189,190,193]].concat();
        assert_eq!((r.exit_code,crate::vfs::stream_string_to_bytes(&r.stdout),r.stderr),(0,expected,String::new()));
    }

    #[test]
    fn fragmented_track_headers_keep_the_duration_before_temporal_filters() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4", include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        for (source, ticks) in [
            (vec!["-i", "av.mp4", "-vf", "fps=50"], 750u32),
            (vec!["-i", "av.mp4", "-frames:v", "2", "-vf", "scale=2:4"], 500),
            (vec!["-f", "lavfi", "-i", "testsrc=s=6x4:r=6:d=1", "-frames:v", "1"], 1000),
        ] {
            let args = [source.as_slice(), &["-y", "-movflags", "frag_keyframe", "out.mp4"]].concat();
            let r = cmd_media_doc("ffmpeg", &media_args(&args), "", "/", &fs);
            assert_eq!((r.exit_code,r.stderr),(0,String::new()));
            let data = fs.read_file("/out.mp4").unwrap();
            let at = data.windows(4).position(|b| b == b"tkhd").unwrap() + 24;
            assert_eq!(&data[at..at+4], &ticks.to_be_bytes());
        }
    }

    #[test]
    fn ffprobe_uses_cropped_h264_dimensions_when_track_header_has_none() {
        let fs=MemoryVfs::new();let mut mp4=include_bytes!("../../tests/fixtures/av.mp4").to_vec();
        let tk=mp4.windows(4).position(|s|s==b"tkhd").unwrap()+4;
        mp4[tk+76..tk+84].fill(0);
        let avc=tk+mp4[tk..].windows(4).position(|s|s==b"avc1").unwrap()+4;
        mp4[avc+24..avc+28].copy_from_slice(&[0,32,0,48]);
        fs.write_file("/av.mp4",&mp4).unwrap();
        let r=cmd_media_doc("ffprobe",&media_args(&["-select_streams","v","-show_entries","stream=width,height,sample_aspect_ratio,pix_fmt","-of","csv=p=0","av.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"6,4,1:1,yuv420p\n");
    }

    #[test]
    fn ffprobe_and_ffmpeg_use_the_mp4_decoder_specific_audio_config() {
        let fs=MemoryVfs::new();let mut mp4=include_bytes!("../../tests/fixtures/av.mp4").to_vec();
        // Change the AAC AudioSpecificConfig to HE-AAC, 48 kHz, mono; leave stsd stereo.
        let at=mp4.windows(4).position(|s|s==[5,2,18,16]).unwrap();
        mp4[at+2..at+4].copy_from_slice(&[0x29,0x88]);
        fs.write_file("/av.mp4",&mp4).unwrap();
        let r=cmd_media_doc("ffprobe",&media_args(&["-select_streams","a","-show_entries","stream=codec_name,profile,sample_rate,channels","-of","csv=p=0","av.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"aac,HE-AAC,48000,1\n");
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","av.mp4","-c:a","copy","-f","aac","-"]),"","/",&fs);
        assert_eq!(&crate::vfs::stream_string_to_bytes(&r.stdout)[..4],&[255,241,76,64]);
    }

    #[test]
    fn ffmpeg_rewrites_mp4_audio_sample_rate_channels_and_duration() {
        let fs=MemoryVfs::new();
        fs.write_file("/movie.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        let r=run("ffmpeg",&["-i","movie.mp4","-vn","-ar","48000","-ac","1","audio.mp4"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        assert_eq!(run("ffprobe",&["-show_entries","stream=sample_rate,channels,duration,nb_frames","-of","csv=p=0","audio.mp4"]).stdout,"48000,1,0.750000,36\n");
    }

    #[test]
    fn ffmpeg_maps_external_aac_into_mp4_and_back_to_adts() {
        let fs=MemoryVfs::new();
        fs.write_file("/video.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let audio=[255,241,80,128,1,191,252,33,16,99,96,140,28].repeat(3);
        fs.write_file("/audio.aac",&audio).unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        assert_eq!(run("ffmpeg",&["-i","video.mp4","-i","audio.aac","-map","0:v","-map","1:a","-c","copy","movie.mp4"]).exit_code,0);
        assert_eq!(run("ffprobe",&["-select_streams","a","-show_entries","stream=codec_name,nb_frames","-of","csv=p=0","movie.mp4"]).stdout,"aac,3\n");
        for source in ["movie.mp4","audio.aac"] {
            let r=run("ffmpeg",&["-i","video.mp4","-i",source,"-map","1:a","-c","copy","-f","aac","-"]);
            assert_eq!(crate::vfs::stream_string_to_bytes(&r.stdout),audio);
        }
    }

    #[test]
    fn ffmpeg_maps_a_subtitle_file_alongside_an_mp4_video() {
        let fs=MemoryVfs::new();
        fs.write_file("/video.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        fs.write_file("/captions",b"7\n00:00:01,000 --> 00:00:02,000\nCaption text\n").unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        let r=run("ffmpeg",&["-i","video.mp4","-f","srt","-i","captions","-map","1:s","-map","0:v","out.mp4"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        assert_eq!(run("ffprobe",&["-show_entries","stream=index,codec_name","-of","csv=p=0","out.mp4"]).stdout,"0,mov_text\n1,h264\n");
        assert_eq!(run("ffmpeg",&["-i","out.mp4","-f","srt","-"]).stdout,"1\n00:00:01,000 --> 00:00:02,000\nCaption text\n");
    }

    #[test]
    fn ffmpeg_muxes_subrip_cues_with_lengths_and_gap_samples() {
        let fs=MemoryVfs::new();
        fs.write_file("/input.srt",b"1\n00:00:01,250 --> 00:00:03,500\nHello\n").unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","input.srt","-c","copy","caption.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let output=fs.read_file("/caption.mp4").unwrap();
        assert!(output.ends_with(b"mdat\0\0\0\x05Hello"));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=codec_name,duration,nb_frames","-of","csv=p=0","caption.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"mov_text,2.250000,2\n");
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","caption.mp4","-f","webvtt","-"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stdout),(0,"WEBVTT\n\n00:00:01.250 --> 00:00:03.500\nHello\n".into()));
    }

    #[test]
    fn ffprobe_reports_timed_text_packets_including_gaps() {
        let fs = MemoryVfs::new();
        fs.write_file("/captions.srt",b"1\n00:00:01,250 --> 00:00:03,500\nHello\n").unwrap();
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_packets","-show_entries","packet=pts,duration,size,pos","-of","csv=p=0","captions.srt"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stdout),(0,"0,1250,2,0\n1250,2250,7,2\n".into()));
    }

    #[test]
    fn ffmpeg_converts_subtitle_cues_without_changing_dialogue() {
        let fs = MemoryVfs::new();
        fs.write_file("/captions.vtt", b"WEBVTT\n\nNOTE ignore\n\nid\n00:01.250 --> 00:03.5 align:left\nHello, world.  \nAgain!\n").unwrap();
        let r = cmd_media_doc("ffmpeg",&media_args(&["-i","captions.vtt","-f","srt","-"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stdout),(0,"1\n00:00:01,250 --> 00:00:03,500\nHello, world.\nAgain!\n".into()));
        assert!(!fs.exists("/-"));
    }

    #[test]
    fn ffmpeg_exports_mp4_metadata_to_stdout_with_overrides() {
        let fs = MemoryVfs::new();
        fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let args = media_args(&["-i","av.mp4","-metadata","year=1997","-metadata","title=The clip","-f","ffmetadata","-"]);
        let r = cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!((r.exit_code,r.stdout),(0,";FFMETADATA1\ntitle=The clip\ndate=1997\nencoder=@poe-code/mp4-ast\n".to_owned()));
        assert!(!fs.exists("/-"));
    }

    #[test]
    fn ffmpeg_explicit_mov_alias_and_filename_select_different_muxers() {
        let fs=MemoryVfs::new();fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        for (args,brand) in [(vec!["-i","av.mp4","named.mov"],b"qt  "),(vec!["-i","av.mp4","-f","mov","explicit.mov"],b"isom"),(vec!["-i","av.mp4","sample.M4V"],b"isom"),(vec!["-i","av.mp4","-f","qt","explicit.mp4"],b"qt  "),(vec!["-i","av.mp4","-f","mj2","explicit.mj2"],b"isom")] {
            let r=cmd_media_doc("ffmpeg",&media_args(&args),"","/",&fs);
            assert_eq!((r.exit_code,r.stderr),(0,String::new()));
            assert_eq!(&fs.read_file(&format!("/{}",args.last().unwrap())).unwrap()[8..12],brand);
        }
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","av.mp4","named.mj2"]),"","/",&fs);
        assert_eq!(r.exit_code,1);
        assert_eq!(r.stderr,"ffmpeg: Unable to find a suitable output format for 'named.mj2' (format AST not registered)\n");
        assert!(!fs.exists("/named.mj2"));
    }

    #[test]
    fn ffmpeg_trim_promotes_the_first_predictive_mp4_sample_to_an_idr() {
        let fs=MemoryVfs::new();fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-ss","0.25","-i","av.mp4","-t","0.5","-an","-c","copy","cut.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let data=fs.read_file("/cut.mp4").unwrap();
        let start=data.windows(4).position(|s|s==b"mdat").unwrap()+4;
        assert_eq!(data[start+4]&31,5);
    }

    #[test]
    fn ffmpeg_maps_tracks_across_mp4_inputs_in_argument_order() {
        let fs=MemoryVfs::new();let a=include_bytes!("../../tests/fixtures/av.mp4");
        fs.write_file("/first.mp4",a).unwrap();
        let mut b=a.to_vec();let at=b.windows(6).position(|s|s==[33,16,4,96,140,28]).unwrap();b[at+2]=77;
        fs.write_file("/second.mp4",&b).unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        let r=run("ffmpeg",&["-i","first.mp4","-i","second.mp4","-map","1:a","-map","0:v","-c","copy","out.mp4"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        assert_eq!(run("ffprobe",&["-show_entries","stream=index,codec_name","-of","csv=p=0","out.mp4"]).stdout,"0,aac\n1,h264\n");
        assert_eq!(run("ffmpeg",&["-i","out.mp4","out.aac"]).exit_code,0);
        assert_eq!(fs.read_file("/out.aac").unwrap()[9],77);
    }

    #[test]
    fn ffmpeg_remuxes_mp4_and_rebuilds_offsets_after_track_selection() {
        let fs=MemoryVfs::new();let av=include_bytes!("../../tests/fixtures/av.mp4");
        fs.write_file("/av.mp4",av).unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        assert_eq!(run("ffmpeg",&["-i","av.mp4","-c","copy","copy.mp4"]).exit_code,0);
        let copy=fs.read_file("/copy.mp4").unwrap();
        assert_eq!(copy.len(),av.len());assert_eq!(copy,av.as_slice());
        assert_eq!(run("ffmpeg",&["-i","av.mp4","-vn","audio.mp4"]).exit_code,0);
        assert_eq!(run("ffprobe",&["-show_entries","stream=index,codec_name,nb_frames","-of","csv=p=0","audio.mp4"]).stdout,"0,aac,33\n");
        for input in ["av.mp4","audio.mp4"] {
            let r=run("ffmpeg",&["-i",input,"-c:a","copy","-f","aac","-"]);
            assert_eq!((r.exit_code,crate::vfs::stream_string_to_bytes(&r.stdout)),(0,[255,241,80,128,1,191,252,33,16,4,96,140,28].repeat(33)));
        }
    }

    #[test]
    fn ffmpeg_muxes_adts_into_a_playable_mp4_with_real_chunk_offsets() {
        let fs=MemoryVfs::new();let payload=[33,16,4,96,140,28];
        let frame=[&[255,241,80,128,1,191,252][..],&payload].concat();
        fs.write_file("/c.aac",&frame.repeat(3)).unwrap();
        let run=|cmd,args:&[&str]| cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        assert_eq!(run("ffmpeg",&["-i","c.aac","-c:a","copy","out.mp4"]).exit_code,0);
        let movie=fs.read_file("/out.mp4").unwrap();
        assert_eq!(movie.len(),630);
        assert_eq!(run("ffprobe",&["-show_entries","stream=codec_name,sample_rate,nb_frames","-of","csv=p=0","out.mp4"]).stdout,"aac,44100,3\n");
        assert_eq!(run("ffmpeg",&["-i","out.mp4","-c:a","copy","out.aac"]).exit_code,0);
        assert_eq!(fs.read_file("/out.aac").unwrap(),frame.repeat(3));
    }

    #[test]
    fn ffmpeg_extracts_mp4_audio_payloads_and_applies_the_requested_time_range() {
        let fs=MemoryVfs::new();
        let mut mp4=include_bytes!("../../tests/fixtures/av.mp4").to_vec();
        let payload=[33,16,4,96,140,28];
        let first=mp4.windows(payload.len()).position(|s|s==payload).unwrap();
        mp4[first+2]=97;
        fs.write_file("/av.mp4",&mp4).unwrap();
        let run=|args:&[&str]|cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        let r=run(&["-i","av.mp4","-c:a","copy","out.aac"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let data=fs.read_file("/out.aac").unwrap();
        assert_eq!(data.len(),33*13);
        assert_eq!(&data[..13],&[255,241,80,128,1,191,252,33,16,97,96,140,28]);
        let r=run(&["-ss","0.2","-i","av.mp4","-t","0.12","-f","aac","-"]);
        assert_eq!(crate::vfs::stream_string_to_bytes(&r.stdout),[&data[13..26];6].concat());
    }

    #[test]
    fn ffmpeg_adts_supports_binary_streams_and_fails_on_missing_parent() {
        let fs = MemoryVfs::new();
        let bytes = [255,241,76,64,1,63,252,12,13];
        let stdin = crate::vfs::bytes_to_stream_string(&bytes);
        for dest in ["-", "pipe:1"] {
            let args = media_args(&["-i","-","-f","aac","-ar","0","-ac","0",dest]);
            let result = cmd_media_doc("ffmpeg",&args,&stdin,"/",&fs);
            assert_eq!((result.exit_code,result.stdout,result.stderr),(0,stdin.clone(),String::new()));
            assert!(!fs.exists(&format!("/{dest}")));
        }
        let result = cmd_media_doc("ffmpeg",&media_args(&["-i","-","absent/out.aac"]),&stdin,"/",&fs);
        assert_eq!(result.stderr,"ffmpeg: ENOENT: no such file or directory, writeFile '/absent/out.aac'\n");
        assert!(!fs.exists("/absent"));
    }

    #[test]
    fn ffmpeg_requires_y_before_replacing_an_existing_file() {
        let fs = MemoryVfs::new();
        fs.write_file("/out.aac",b"valuable").unwrap();
        let input = crate::vfs::bytes_to_stream_string(&[255,241,76,64,1,63,252,12,13]);
        for flags in [vec![],vec!["-y","-n"]] {
            let args = [flags.as_slice(), &["-i","-","out.aac"]].concat();
            let result = cmd_media_doc("ffmpeg",&media_args(&args),&input,"/",&fs);
            assert_eq!((result.exit_code,result.stderr),(1,"File 'out.aac' already exists. Exiting.\n".into()));
            assert_eq!(fs.read_file("/out.aac").unwrap(),b"valuable");
        }
        let null = media_args(&["-i","-","-f","null","out.aac"]);
        assert_eq!(cmd_media_doc("ffmpeg",&null,&input,"/",&fs).exit_code,0);
        assert_eq!(fs.read_file("/out.aac").unwrap(),b"valuable");
        let args = media_args(&["-n","-y","-i","-","out.aac"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,&input,"/",&fs).exit_code,0);
        assert_eq!(fs.read_file("/out.aac").unwrap(),crate::vfs::stream_string_to_bytes(&input));
    }

    #[test]
    fn ffmpeg_tiles_partial_batches_in_filter_order() {
        let fs=MemoryVfs::new();
        let mut clip=b"YUV4MPEG2 W1 H1 F4:1\n".to_vec();
        for y in [30,50,70,90,110]{clip.extend(b"FRAME\n");clip.extend([y,128,128]);}
        fs.write_file("/in",&clip).unwrap();
        let args=media_args(&["-i","in","-vf","tile=2x1,hflip,tile=1x2,reverse","out.y4m"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
        let expected=[b"YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C420jpeg\nFRAME\n".as_slice(),&[16,110,16,16,128,128],b"FRAME\n",&[50,30,90,70,128,128]].concat();
        assert_eq!(fs.read_file("/out.y4m").unwrap(),expected);
    }

    #[test]
    fn ffmpeg_retains_frame_times_across_trims_and_rate_changes() {
        let fs=MemoryVfs::new();
        let mut clip=b"YUV4MPEG2 W1 H1 F4:1\n".to_vec();
        for y in [30,50,70,90,110]{ clip.extend(b"FRAME\n");clip.extend([y,128,128]); }
        fs.write_file("/in",&clip).unwrap();
        for (args,rate,luma) in [
            (vec!["-i","in","-r","2.5"],3,vec![30,50,90]),
            (vec!["-i","in","-vf","setpts=PTS/2,fps=4"],4,vec![30,50,90]),
            (vec!["-i","in","-vf","trim=start=0.2:duration=0.5,trim=start=0.47:end=0.6"],4,vec![70]),
            (vec!["-r","2.5","-i","in"],4,vec![30,50,70,90,110]),
        ] {
            let cmd=[&["-y"][..],args.as_slice(),&["o.y4m"]].concat();
            assert_eq!(cmd_media_doc("ffmpeg",&media_args(&cmd),"","/",&fs).exit_code,0);
            let mut expected=format!("YUV4MPEG2 W1 H1 F{rate}:1 Ip A1:1 C420jpeg\n").into_bytes();
            for y in luma {expected.extend(b"FRAME\n");expected.extend([y,128,128]);}
            assert_eq!(fs.read_file("/o.y4m").unwrap(),expected,"{args:?}");
        }
    }

    #[test]
    fn ffmpeg_composes_drawbox_crop_and_pad_on_frame_pixels() {
        let fs=MemoryVfs::new();
        let mut clip=b"YUV4MPEG2 W5 H3 F4:1\nFRAME\n".to_vec();
        clip.extend((0..27).map(|j|(j*23+81) as u8));
        fs.write_file("/in",&clip).unwrap();
        let args=media_args(&["-i","in","-vf","drawbox=2:1:3:1:purple,crop=4:3:1:0,pad=8:4:2:0:lime","out.y4m"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
        let frame=fs.read_file("/out.y4m").unwrap();
        assert_eq!(frame.strip_prefix(b"YUV4MPEG2 W8 H4 F4:1 Ip A1:1 C420jpeg\nFRAME\n"),Some([144,144,109,127,147,163,144,144,144,144,199,62,62,62,144,144,144,144,74,116,136,152,144,144,144,144,144,144,144,144,144,144,54,168,170,54,54,100,55,54,34,94,133,34,34,82,92,34].as_slice()));
    }

    #[test]
    fn ffmpeg_encodes_lavfi_video_that_can_be_decoded_again() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]|cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        let r=run(&["-f","lavfi","-i","color=c=red:s=16x16:r=3:d=1","red.mp4"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let data=fs.read_file("/red.mp4").unwrap();
        assert!(data.windows(4).any(|b|b==b"avcC"));
        let r=run(&["-i","red.mp4","frames.y4m"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let planes=fs.read_file("/frames.y4m").unwrap();
        assert_eq!(planes.windows(6).filter(|b|*b==b"FRAME\n").count(),3);
        assert_eq!(planes.last(),Some(&239));
    }

    #[test]
    fn ffmpeg_resamples_lavfi_before_consuming_each_avc_frame_buffer() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]|cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        for (filter,expected) in [("fps=4",16),("fps=4,hflip",82)] {
            let r=run(&["-y","-f","lavfi","-i","color=c=red:s=16x16:r=3:d=1","-vf",filter,"v.mp4"]);
            assert_eq!((r.exit_code,r.stderr),(0,String::new()));
            let r=run(&["-i","v.mp4","-f","yuv4mpegpipe","pipe:1"]);
            let raw=crate::vfs::stream_string_to_bytes(&r.stdout);
            let ys:Vec<_>=raw.windows(7).filter(|s|&s[..6]==b"FRAME\n").map(|s|s[6]).collect();
            assert_eq!(ys,[82,expected,82,82]);
        }
    }

    #[test]
    fn ffmpeg_empty_lavfi_filter_retains_the_original_track_description() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=16x16:r=4:d=1","-vf","trim=start=9","v.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=codec_name,width,height,duration,nb_frames","-of","csv=p=0","v.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"h264,16,16,1.000000,0\n");
    }

    #[test]
    fn ffmpeg_filters_mp4_video_and_retains_the_other_tracks() {
        let fs=MemoryVfs::new();
        fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let run=|args:&[&str]|cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        let r=run(&["-i","av.mp4","-s","12x8","out.mp4"]);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=codec_name,width,height,nb_frames","-of","csv=p=0","out.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"h264,12,8,3\naac,33\n");
        let r=run(&["-i","out.mp4","-frames:v","1","-f","yuv4mpegpipe","pipe:1"]);
        assert!(crate::vfs::stream_string_to_bytes(&r.stdout).starts_with(b"YUV4MPEG2 W12 H8"));
    }

    #[test]
    fn ffmpeg_input_duration_only_trims_the_following_input() {
        let fs=MemoryVfs::new();
        fs.write_file("/av.mp4",include_bytes!("../../tests/fixtures/av.mp4")).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-t","0.25","-i","av.mp4","-f","lavfi","-i","sine=r=16000:d=0.37","-map","0:v","-map","1:a","out.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=codec_name,duration,nb_frames","-of","csv=p=0","out.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"h264,0.250000,1\naac,0.400000,7\n");
    }

    #[test]
    fn ffmpeg_maps_generated_audio_and_video_into_one_playable_mp4() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=34x30:r=6:d=1","-f","lavfi","-i","sine=r=16000:d=0.37","-map","1:a","-map","0:v","out.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=index,codec_name,width,height,nb_frames","-of","csv=p=0","out.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"0,aac,7\n1,h264,34,30,6\n");
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","out.mp4","-frames:v","1","-f","yuv4mpegpipe","pipe:1"]),"","/",&fs);
        assert!(crate::vfs::stream_string_to_bytes(&r.stdout).starts_with(b"YUV4MPEG2 W34 H30"));
    }

    #[test]
    fn ffmpeg_muxes_lavfi_audio_as_aac_packets_with_a_partial_last_packet() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","sine=f=880:r=8000:d=0.17","v.m4a"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_packets","-show_entries","packet=pts,duration,size","-of","csv=p=0","v.m4a"]),"","/",&fs);
        assert_eq!(r.stdout,"0,1024,7\n1024,576,7\n");
    }

    #[test]
    fn ffmpeg_sequence_does_not_create_missing_directories() {
        let fs=MemoryVfs::new();
        let args=media_args(&["-f","lavfi","-i","color=s=2x2","missing/im%d.png"]);
        let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(1,"ffmpeg: ENOENT: no such file or directory, writeFile '/missing/im1.png'\n".to_string()));
        assert!(!fs.exists("/missing"));
    }

    #[test]
    fn ffmpeg_maps_two_image_sequences_with_independent_numbering_and_rates() {
        let fs=MemoryVfs::new();
        for (prefix,start,n,w) in [("x",0,2,2),("y",7,3,4)] {
            for i in start..start+n {
                fs.write_file(&format!("/{prefix}{i}.png"),&pixel_png(w,2,PngEncoding::Density(72),|_,_|[i as u8,100,0,255])).unwrap();
            }
        }
        let r=cmd_media_doc("ffmpeg",&media_args(&["-framerate","4","-i","x%d.png","-framerate","2","-start_number","7","-i","y%d.png","-map","1:v","-map","0:v","mixed.mp4"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let r=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=width,height,duration,nb_frames","-of","csv=p=0","mixed.mp4"]),"","/",&fs);
        assert_eq!(r.stdout,"4,2,1.500000,3\n2,2,0.500000,2\n");
    }

    #[test]
    fn ffmpeg_renders_raw_pixels_from_the_first_mapped_video() {
        let fs = MemoryVfs::new();
        for (name, red) in [("a0", 7), ("b0", 211), ("b1", 139)] {
            fs.write_file(&format!("/{name}.png"), &pixel_png(1, 1, PngEncoding::Density(72), |_, _| [red, 13, 3, 255])).unwrap();
        }
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "a%d.png", "-i", "b%d.png", "-map", "1:v", "-map", "0:v", "out%d.ppm"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stderr), (0, String::new()));
        for (name, red) in [("/out1.ppm", 211), ("/out2.ppm", 139)] {
            assert_eq!(fs.read_file(name).unwrap(), [b"P6\n1 1\n255\n".as_slice(), &[red, 13, 3]].concat());
        }
        assert!(!fs.exists("/out3.ppm"));
    }

    #[test]
    fn ffmpeg_decodes_ascii_and_binary_portable_pixmaps_and_copies_the_still_packet() {
        let fs = MemoryVfs::new();
        let ascii = b"P3\n# size\n2 1\n15 # max\r\n15 0 0  0 0 15";
        fs.write_file("/in0.ppm", ascii).unwrap();
        fs.write_file("/in1.ppm", b"P6\n2 1\n1023\n\0\0\x03\xff\0\0\x03\xff\x03\xff\0\0").unwrap();
        let run = |args: &[&str]| cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs);
        let result = run(&["-i", "in%d.ppm", "-vf", "hflip", "frame%d.ppm"]);
        assert_eq!((result.exit_code, result.stderr), (0, String::new()));
        assert_eq!(fs.read_file("/frame1.ppm").unwrap(), b"P6\n2 1\n255\n\0\0\xff\xff\0\0");
        assert_eq!(fs.read_file("/frame2.ppm").unwrap(), b"P6\n2 1\n255\n\xff\xff\0\0\xff\0");
        assert_eq!(run(&["-i", "in0.ppm", "copy.mp4"]).exit_code, 0);
        let movie = fs.read_file("/copy.mp4").unwrap();
        assert!(movie.ends_with(ascii));
        assert!(movie.windows(4).any(|b| b == b"ppm "));
    }

    #[test]
    fn ffmpeg_reads_indexed_bmp_rows_in_display_order() {
        let fs = MemoryVfs::new();
        let mut bmp = vec![0u8; 62];
        bmp[..2].copy_from_slice(b"BM");
        bmp[10] = 62; bmp[14] = 40; bmp[18] = 3; bmp[22] = 2; bmp[26] = 1; bmp[28] = 1;
        bmp[56] = 255; bmp[58] = 255; // palette: red, blue
        bmp.extend_from_slice(&[0x60, 0, 0, 0, 0x80, 0, 0, 0]);
        fs.write_file("/in1.bmp", &bmp).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i", "in%d.bmp", "frame%d.ppm"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stderr), (0, String::new()));
        let red = [255, 0, 0]; let blue = [0, 0, 255];
        assert_eq!(fs.read_file("/frame1.ppm").unwrap(), [b"P6\n3 2\n255\n".as_slice(), &[blue,red,red,red,blue,blue].concat()].concat());
        let r = cmd_media_doc("ffprobe", &media_args(&["-show_entries","stream=codec_name,width,height","-of","csv=p=0","in1.bmp"]), "", "/", &fs);
        assert_eq!(r.stdout, "bmp,3,2\n");
    }

    #[test]
    fn ffmpeg_reads_numbered_png_inputs_until_the_first_gap() {
        let fs=MemoryVfs::new();
        for (n,c) in [(7,30),(8,150),(10,210)] {
            fs.write_file(&format!("/in{n:02}.png"),&pixel_png(2,1,PngEncoding::Density(72),|_,_|[c,0,0,255])).unwrap();
        }
        let run=|out:&str|cmd_media_doc("ffmpeg",&media_args(&["-start_number","7","-framerate","2","-i","in%02d.png",out]),"","/",&fs);
        assert_eq!(run("out%d.ppm").exit_code,0);
        for (n,c) in [(1,30),(2,150)] {
            assert_eq!(fs.read_file(&format!("/out{n}.ppm")).unwrap(),[b"P6\n2 1\n255\n".as_slice(),&[c,0,0,c,0,0]].concat());
        }
        assert!(!fs.exists("/out3.ppm"));
        assert_eq!(run("out.mp4").exit_code,0);
        let probe=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=width,height,nb_frames,duration","-of","csv=p=0","out.mp4"]),"","/",&fs);
        assert_eq!(probe.stdout,"2,1,1.000000,2\n");
    }

    #[test]
    fn ffmpeg_muxes_a_png_packet_without_reencoding_it() {
        let fs = MemoryVfs::new();
        let png = pixel_png(3, 2, PngEncoding::Density(72), |x,y| [x as u8, y as u8, 99, 255]);
        fs.write_file("/still.png", &png).unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i","still.png","-f","lavfi","-i","sine=d=0.2","still.mov"]), "", "/", &fs);
        assert_eq!((r.exit_code, r.stderr), (0, String::new()));
        let r = cmd_media_doc("ffprobe", &media_args(&["-select_streams","v","-show_entries","stream=codec_name,width,height,time_base,nb_frames","-of","csv=p=0","still.mov"]), "", "/", &fs);
        assert_eq!(r.stdout, "png,3,2,1/25,1\n");
        assert!(fs.read_file("/still.mov").unwrap().windows(png.len()).any(|sample| sample == png));
    }

    #[test]
    fn ffmpeg_transforms_pixels_from_a_png_input() {
        let fs=MemoryVfs::new();
        let png=pixel_png(2,1,PngEncoding::Density(72),|x,_|if x==0{[251,3,7,128]}else{[5,11,199,255]});
        fs.write_file("/still.png",&png).unwrap();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","still.png","-vf","hflip","out.ppm"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        assert_eq!(fs.read_file("/out.ppm").unwrap(),b"P6\n2 1\n255\n\x05\x0b\xc7\xfb\x03\x07".as_slice());
    }

    #[test]
    fn ffmpeg_tiff_contains_a_single_rgba_strip_and_an_image_directory() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","color=c=red:s=2x1","still.tif"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let bytes=fs.read_file("/still.tif").unwrap();
        assert_eq!(bytes.get(..18), Some(b"II\x2a\x00\x10\x00\x00\x00\xff\x00\x00\xff\xff\x00\x00\xff\x0f\x00".as_slice()));
    }

    #[test]
    fn ffmpeg_explicit_image_format_applies_only_to_single_images() {
        let fs=MemoryVfs::new();
        let render=|path:&str|cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","color=c=red:s=1x1:r=1:d=1","-f","ppm",path]),"","/",&fs);
        assert_eq!(render("out.bmp").exit_code,0);
        assert_eq!(fs.read_file("/out.bmp").unwrap(),b"P6\n1 1\n255\n\xff\x00\x00");
        assert_eq!(render("out%d.bmp").exit_code,0);
        assert!(fs.read_file("/out1.bmp").unwrap().starts_with(b"BM"));
    }

    #[test]
    fn ffmpeg_encodes_the_jpeg_scan_for_an_odd_sized_red_frame() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","color=c=red:s=7x5:r=3:d=1","-frames:v","1","frame%d.jpg"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        let bytes=fs.read_file("/frame1.jpg").unwrap();
        assert!(bytes.starts_with(b"\xff\xd8\xff\xe0"));
        assert!(bytes.ends_with(b"\x3f\x00\xf2\xca\xfc\xe8\xfe\xcc\x3f\xff\xd9"));
    }

    #[test]
    fn sips_decodes_jpeg_samples_across_mcu_boundaries() {
        let fs = MemoryVfs::new();
        let run = |name, args: &[&str]| cmd_media_doc(name, &media_args(args), "", "/", &fs);
        assert_eq!(run("ffmpeg", &["-f","lavfi","-i","testsrc=s=19x15","-frames:v","1","src.jpg"]).exit_code, 0);
        assert_eq!(run("sips", &["-s","format","ppm","src.jpg","--out","out.ppm"]).exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.ppm").unwrap())), "2df0453f1d45a7b01b3f6566d8e51791f618f97985a8c00e0048e019a39bfc66");
    }

    #[test]
    fn sips_decodes_progressive_subsampled_jpeg_with_restarts() {
        let fs = MemoryVfs::new();
        fs.write_file("/src.jpg", include_bytes!("../../tests/fixtures/subsampled-progressive.jpg")).unwrap();
        let result=cmd_media_doc("sips", &media_args(&["-s","format","ppm","src.jpg","--out","out.ppm"]), "", "/", &fs);
        assert_eq!((result.exit_code,result.stderr),(0,String::new()));
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.ppm").unwrap())), "1cb420ac977b4837ae7fbd6e12a3802087ebf72575788c274f5de45e67878cd0");
    }

    #[test]
    fn sips_preserves_jpeg_rounding_between_geometry_operations() {
        let fs=MemoryVfs::new();
        fs.write_file("/src.jpg", include_bytes!("../../tests/fixtures/subsampled-progressive.jpg")).unwrap();
        let args=media_args(&["-r","90","-p","9","19","-Z","8","-s","format","png","src.jpg","--out","out.png"]);
        assert_eq!(cmd_media_doc("sips",&args,"","/",&fs).exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())), "dbf41ea98710cede4c2280ddc3bf314e1f041df84c192664f409ced9b29d4917");
    }

    #[test]
    fn ffmpeg_reports_packet_failure_for_a_copied_still_track_without_overwriting_output() {
        let fs=MemoryVfs::new();
        fs.write_file("/src.jpg",include_bytes!("../../tests/fixtures/subsampled-progressive.jpg")).unwrap();
        let run=|args:&[&str]|cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        assert_eq!(run(&["-i","src.jpg","-c","copy","copied.mp4"]).exit_code,0);
        fs.write_file("/frame.png",b"previous output").unwrap();
        let result=run(&["-y","-i","copied.mp4","-frames:v","1","frame.png"]);
        assert_eq!((result.exit_code,result.stderr),(1,"ffmpeg: H.264 packet decode failed (-1094995529)\n".into()));
        assert_eq!(fs.read_file("/frame.png").unwrap(), b"previous output");
    }

    #[test]
    fn ffmpeg_decodes_numbered_jpeg_inputs_from_the_requested_start_number() {
        let fs=MemoryVfs::new();
        let jpeg=include_bytes!("../../tests/fixtures/subsampled-progressive.jpg");
        for name in ["/im3.jpeg","/im4.jpeg"] {fs.write_file(name,jpeg).unwrap();}
        let args=media_args(&["-start_number","3","-framerate","4","-i","im%d.jpeg","-frames:v","2","numbered%02d.png"]);
        let result=cmd_media_doc("ffmpeg",&args,"","/",&fs);
        assert_eq!((result.exit_code,result.stderr),(0,String::new()));
        for name in ["/numbered01.png","/numbered02.png"] {
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(name).unwrap())), "ac6885753036dea41ff2ec15e046d26294322000e8056aa30d35fa17a68ef5a5");
        }
    }

    #[test]
    fn ffmpeg_writes_numbered_pngs_with_decodable_frame_pixels() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=16x32:r=2:d=1","-start_number","7","frame%02d.png"]),"","/",&fs);
        assert_eq!((r.exit_code,r.stderr),(0,String::new()));
        for (name,pixel) in [("/frame07.png",[127,127,127,255]),("/frame08.png",[255,255,255,255])] {
            let frame=fs.read_file(name).unwrap();
            let im=png_pixels::Raster::decode(&frame,fs.max_input_bytes()).unwrap();
            assert_eq!((im.width,im.height,im.pixels[0]),(16,32,pixel));
        }
    }

    #[test]
    fn ffmpeg_generates_y4m_pixels_from_lavfi_sources() {
        let fs = MemoryVfs::new();
        let run = |spec: &str, filters: &[&str]| {
            let args = [&["-y","-f","lavfi","-i",spec][..],filters,&["-f","yuv4mpegpipe","pipe:1"]].concat();
            let r=cmd_media_doc("ffmpeg",&media_args(&args),"","/",&fs);
            assert_eq!((r.exit_code,r.stderr),(0,String::new()));
            crate::vfs::stream_string_to_bytes(&r.stdout)
        };
        let head=b"YUV4MPEG2 W3 H1 F10:1 Ip A1:1 C420jpeg\nFRAME\n".as_slice();
        assert_eq!(run("color=c=red:s=3x1:r=10:d=0.2",&["-frames:v","1"]),[head,&[82,82,82,90,90,240,240]].concat());
        assert_eq!(run("color=c=red:s=3x1:r=10:d=0.2",&["-t","0.1"]),[head,&[82,82,82,90,90,239,239]].concat());
        let sliced = run("smptebars=s=7x5:r=10:d=0.3",&["-t","0.05"]);
        assert_eq!(sliced.strip_prefix(b"YUV4MPEG2 W7 H5 F20:1 Ip A1:1 C420jpeg\nFRAME\n"), Some([180,161,131,115,84,71,35,35,180,161,131,115,84,71,35,35,180,161,131,115,84,71,35,35,180,161,131,115,84,71,35,35,40,40,229,118,108,134,175,193,118,108,128,140,212,152,132,130,73,167,158,137,130,73,130,203,115,111,133].as_slice()));
        let head=b"YUV4MPEG2 W3 H3 F5:1 Ip A1:1 C420jpeg\nFRAME\n".as_slice();
        assert_eq!(run("smptebars=s=3x3:r=5:d=0.2",&[]),[head,&[180,131,84,180,131,84,35,84,131,142,183,197,156,86,198,157,44]].concat());
        assert_eq!(run("testsrc=s=3x3:r=5:d=0.2",&["-vf","hflip"]),[head,&[126,125,125,126,125,125,126,125,125,128,128,128,128,128,128,128,128]].concat());
    }

    #[test]
    fn ffmpeg_writes_y4m_frames_from_real_planes() {
        let fs = MemoryVfs::new();
        let clip = [b"YUV4MPEG2 W3 H1 F10:1\nFRAME Xtag\n".as_slice(), &[0,100,210,128,77,220,130], b"FRAME\n", &[25,30,42,33,22,88,99]].concat();
        fs.write_file("/movie", &clip).unwrap();
        let run = |options: &[&str]| {
            let args = [&["-y","-i","movie"][..], options, &["o.y4m"]].concat();
            let result = cmd_media_doc("ffmpeg",&media_args(&args),"","/",&fs);
            assert_eq!((result.exit_code,result.stderr),(0,String::new()));
            fs.read_file("/o.y4m").unwrap()
        };
        let header = b"YUV4MPEG2 W3 H1 F10:1 Ip A1:1 C420jpeg\nFRAME\n";
        assert_eq!(run(&["-c","copy"]), [header.as_slice(), &[54,100,210,117,77,206,130],b"FRAME\n",&[56,59,64,104,101,98,93]].concat());
        assert_eq!(run(&["-vf","hflip","-frames:v","1"]),[header.as_slice(), &[210,100,54,103,106,175,192]].concat());
        assert_eq!(run(&["-s","2x2","-frames:v","1"]),[b"YUV4MPEG2 W2 H2 F10:1 Ip A1:1 C420jpeg\nFRAME\n".as_slice(), &[64,122,64,122,109,193]].concat());
    }

    #[test]
    fn ffmpeg_remuxes_adts_payloads_and_slices_on_sample_boundaries() {
        let fs = MemoryVfs::new();
        fs.write_file("/sound", &[255,241,76,64,1,63,252,12,13,0,255,240,76,64,1,159,252,0,0,14,15,16]).unwrap();
        let run = |options: &[&str]| {
            let args = [&["-y","-i","sound"][..],options,&["out.aac"]].concat();
            assert_eq!(cmd_media_doc("ffmpeg", &media_args(&args), "", "/", &fs).exit_code, 0);
            fs.read_file("/out.aac").unwrap()
        };
        let first = [255,241,76,64,1,63,252,12,13];
        let second = [255,241,76,64,1,95,252,14,15,16];
        assert_eq!(run(&["-c","copy"]), [first.as_slice(), second.as_slice()].concat());
        assert_eq!(run(&["-t","0.020"]), first);
        assert_eq!(run(&["-ss","0.022"]), second);
        assert_eq!(run(&["-ac","2"]), [255,241,76,128,1,191,252,33,16,4,96,140,28]);
    }

    #[test]
    fn ffprobe_adts_uses_header_rate_and_raw_payload_offsets() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip", &[255,241,76,64,1,63,252,12,13,0,255,240,76,64,1,159,252,0,0,14,15,16]).unwrap();
        let run = |args: &[&str]| cmd_media_doc("ffprobe", &media_args(args), "", "/", &fs).stdout;
        assert_eq!(run(&["-show_packets","-show_entries","packet=pts,size,pos:stream=codec_name,sample_rate,channels,bit_rate:format=bit_rate","-of","csv=p=0","clip"]),
            "0,2,0\n1024,3,2\naac,48000,1,938\n4125\n");
        assert_eq!(run(&["-show_frames","-show_entries","frame=pkt_size,nb_samples,channels","-of","csv=p=0","clip"]), "2,1024,1\n3,1024,1\n");
        assert_eq!(run(&["-show_streams","-select_streams","v","-of","json=c=1","clip"]), "{\"streams\":[]}\n");
    }

    #[test]
    fn ffprobe_reads_standalone_image_dimensions_and_packet_timing() {
        let fs = MemoryVfs::new();
        fs.write_file("/still.ppm", b"P3\n2 1\n15\n15 0 0 0 15 0").unwrap();
        let run = |opts: &[&str]| cmd_media_doc("ffprobe", &media_args(opts), "", "/", &fs).stdout;
        assert_eq!(run(&["-show_entries", "stream=codec_name,width,height,pix_fmt,time_base:format=format_name,duration", "-of", "csv=p=0", "still.ppm"]),
            "ppm,2,1,rgb24,1/25\nimage2,0.040000\n");
        assert_eq!(run(&["-show_packets", "-show_frames", "-show_entries", "frame=pkt_duration,pkt_size,width,height,pix_fmt:packet=pts,duration,size,pos", "-of", "csv=p=0", "still.ppm"]),
            "0,1,23,0\n1,23,2,1,rgb24\n");
    }

    #[test]
    fn ffprobe_y4m_counts_complete_odd_sized_frames_at_the_header_rate() {
        let fs = MemoryVfs::new();
        fs.write_file("/clip", b"YUV4MPEG2 W3 H1 F30000:1001\nFRAME\n1234567FRAME Xtag\n1234567FRAME\n0").unwrap();
        let run = |opts: &[&str]| cmd_media_doc("ffprobe", &media_args(opts), "", "/", &fs);
        assert_eq!(run(&["-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration", "-of", "csv=p=0", "clip"]).stdout,
            "rawvideo,3,1,30000/1001,2\n0.066733\n");
        assert_eq!(run(&["-show_packets", "-show_entries", "packet=size,pos,pts", "-of", "json=c=1", "clip"]).stdout,
            "{\"packets\":[{\"pts\":0,\"size\":\"7\",\"pos\":\"0\"},{\"pts\":3003,\"size\":\"7\",\"pos\":\"7\"}]}\n");
        assert_eq!(run(&["-select_streams", "a", "-show_streams", "-of", "json=c=1", "clip"]).stdout, "{\"streams\":[]}\n");
        fs.write_file("/bad.y4m", b"no").unwrap();
        assert_eq!(run(&["bad.y4m"]).stderr, "ffprobe: Invalid YUV4MPEG2 stream: missing 'YUV4MPEG2 ' magic\n");
    }

    #[test]
    fn ffmpeg_renders_sine_samples_and_filters_into_a_standard_wav() {
        let fs=MemoryVfs::new();
        let args=media_args(&["-f","lavfi","-i","sine=f=631:r=8000:d=0.25","-af","volume=0.3,atempo=2,areverse","out.wav"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.wav").unwrap())), "901bc772d9fcf2f3c29c9ad19986a7d11b42d29fad0a3a3df79b377770cd7265");
    }

    #[test]
    fn ffmpeg_muxes_trimmed_repeated_wav_packets() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs);
        assert_eq!(run(&["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=0.25", "x.wav"]).exit_code, 0);
        assert_eq!(run(&["-ss", "0.125", "-t", "0.125", "-stream_loop", "2", "-i", "x.wav", "out.mp4"]).exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.mp4").unwrap())), "e328d1819a18bdc070d732d89491698429a669c9794c0a35c7965016fef34ba0");
    }

    #[test]
    fn ffmpeg_selects_encoded_audio_from_a_second_input_for_wav_filters() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs);
        assert_eq!(run(&["-f", "lavfi", "-i", "sine=f=631:r=8000:d=0.25", "audio.mp4"]).exit_code, 0);
        assert_eq!(run(&["-f", "lavfi", "-i", "testsrc=s=8x6:r=4:d=1", "-i", "audio.mp4", "-map", "1:a", "-af", "volume=0.3,atempo=2,areverse", "-ar", "11025", "-ac", "2", "out.wav"]).exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.wav").unwrap())), "30e61cbf00936a82b3c286a4790128481a8b36398b43fb77f071f3e553fbfbfe");
    }

    #[test]
    fn ffmpeg_repeats_trimmed_movie_packets_and_aligns_audio_at_loop_boundaries() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs).exit_code, 0);
        run(&["-f", "lavfi", "-i", "testsrc=s=8x6:r=4:d=1", "v.mp4"]);
        run(&["-f", "lavfi", "-i", "sine=f=631:r=8000:d=0.25", "a.mp4"]);
        run(&["-i", "a.mp4", "-i", "v.mp4", "av.mp4"]);
        for (seek, expected) in [
            (vec![], "7da559ead5b263707e8e664b4bff17653bc5eb0eefb781ee0adf5cfb0a9eda97"),
            (vec!["-ss","0.125","-t","0.125"], "d0d909b3b4808f3f9595b097f8ea9275f81f6ff6c48ea1ac1a022d78096b3ce1"),
        ] {
            let mut args = vec!["-y"];
            args.extend(seek);
            args.extend(["-stream_loop", "2", "-i", "av.mp4", "out.mp4"]);
            run(&args);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.mp4").unwrap())), expected);
        }
    }

    #[test]
    fn ffmpeg_rounds_each_loop_boundary_on_the_audio_tracks_own_clock() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs).exit_code, 0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=7:d=0.85","v.mp4"]);
        run(&["-f","lavfi","-i","sine=f=631:r=11025:d=0.75","a.mp4"]);
        run(&["-i","a.mp4","-i","v.mp4","av.mp4"]);
        run(&["-stream_loop","8","-i","av.mp4","out.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.mp4").unwrap())), "82a63090736b3ac011807f2d450d659e9fbfb1abc78e4027bc44fa3244a271ca");
    }

    #[test]
    fn ffmpeg_repeats_decoded_y4m_frames_after_input_trim() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs).exit_code, 0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","x.y4m"]);
        run(&["-ss","0.015","-t","0.336","-stream_loop","2","-i","x.y4m","out.y4m"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.y4m").unwrap())), "c8b19eac74872afdea63584ae3126ddd3ef5f16027e53f8347940ded900be5f2");
    }

    #[test]
    fn ffmpeg_muxes_y4m_pixels_and_encodes_filtered_frames() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs).exit_code, 0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","x.y4m"]);
        for (opts, expected) in [
            (&[][..], "61fee2af5f2dc1a0212b59b4c96e31e2d82c75bd90c0be59085142213622279e"),
            (&["-vf","hflip"][..], "89d02c52270f1a1a76aed5e6d4e20d49fa3cfdd9892b48aedcd95cfb341e839b"),
            (&["-ss","0.012","-t","0.234"][..], "7f04cf2a76cb66746be976c4406be2bfc1f6cb206acbab6b4960e31a0a5b47dd"),
        ] {
            let mut args=vec!["-y","-i","x.y4m"];
            args.extend_from_slice(opts);
            args.push("out.mp4");
            run(&args);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.mp4").unwrap())), expected);
        }
    }

    #[test]
    fn ffmpeg_reports_packet_promotion_failure_when_slicing_raw_video() {
        let fs = MemoryVfs::new();
        fs.write_file("/raw.y4m", b"YUV4MPEG2 W2 H1 F25:1\nFRAME\n\x11\x11\x80\x80").unwrap();
        for output in ["v.mp4","v.y4m","a.wav","a.aac","tags.ffmetadata","null.bin"] {
            let mut args=media_args(&["-i","raw.y4m","-t","0.02"]);
            if output=="null.bin" {args.extend(media_args(&["-f","null"]));}
            args.push(output.into());
            let r=cmd_media_doc("ffmpeg",&args,"","/",&fs);
            assert_eq!((r.exit_code,r.stderr),(1,"ffmpeg: H.264 packet decode failed (-1094995529)\n".into()));
            assert!(!fs.exists(&format!("/{output}")));
        }
    }

    #[test]
    fn ffmpeg_loops_still_image_packets_and_reuses_the_decoded_frame() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs).exit_code, 0);
        run(&["-f","lavfi","-i","testsrc=s=8x6","-frames:v","1","x.jpg"]);
        for (extra, path, expected) in [
            (&[][..], "out.mp4", "fe1f710b3fdf9043aaf06cd7560413e3919f19756fc23d6d29035654281e3e5a"),
            (&["-frames:v","2"][..], "out.mp4", "9318460ff964178e4cbbc19b3b18c80169c5a70cb7eb7b731fc9a9cb6a853e3d"),
            (&[][..], "out.y4m", "120ccb72bc939fbf72ed7c747fad1fc5ad4cf97097ce7be72ab59b7c5390b7b7"),
        ] {
            let mut args=vec!["-y","-stream_loop","2","-i","x.jpg"];
            args.extend_from_slice(extra); args.push(path); run(&args);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&format!("/{path}")).unwrap())),expected);
        }
    }

    #[test]
    fn ffmpeg_repeats_generated_video_packets_before_rendering_frames() {
        let fs = MemoryVfs::new();
        let args=media_args(&["-stream_loop","2","-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","out.y4m"]);
        assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.y4m").unwrap())), "6483151e5fcb0024067c3bb3aabe4af99aa301a6ec5a4b42663a92939c6d1e58");
    }

    #[test]
    fn ffmpeg_repeats_generated_audio_at_trimmed_packet_boundaries() {
        let fs = MemoryVfs::new();
        for (path,expected) in [("o.mp4","7218c339dd6c954d7adb65e35df8c6a7d56c63eb720df1ab013b48cd2d19fcf8"),("o.wav","edbe6c2001622de4171a8a7f705c8585a8009a54f103679d9a295353c69487de"),("o.aac","185f0df366bab9262df176c878177cdfb65d013dacdfe2b795b08336a74227e6")] {
            let args=media_args(&["-ss","0.107","-to","0.242","-stream_loop","2","-f","lavfi","-i","sine=f=631:r=11025:d=0.24",path]);
            assert_eq!(cmd_media_doc("ffmpeg",&args,"","/",&fs).exit_code,0);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&format!("/{path}")).unwrap())),expected);
        }
    }

    #[test]
    fn ffmpeg_applies_a_labelled_complex_filter_to_the_movie() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-i","a.mp4","-filter_complex","[0:v]hflip[out]","-map","[out]","o.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())), "207ab56e4e0b34a6d1668f4a3b111492b985d6da9d160af4a47579ffefe800ac");
    }

    #[test]
    fn ffmpeg_stacks_decoded_frames_of_different_sizes() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-i","b.y4m","-filter_complex","[0:v][1:v]hstack=inputs=2[out]","-map","[out]","o.y4m"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.y4m").unwrap())), "455fceafb72d7c7c16aceb672849fba46b644378d77678908436a29b3f8b4aec");
    }

    #[test]
    fn ffmpeg_reuses_the_last_overlay_frame_at_the_requested_offset() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-i","b.y4m","-filter_complex","[0:v][1:v]overlay=2:1[out]","o.y4m"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.y4m").unwrap())), "1cea2fa505daf06b5c7f03d6603d376bad6510eb1ae9c9583c34740d76590c81");
    }

    #[test]
    fn ffmpeg_concat_keeps_packets_with_different_video_descriptions() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-i","b.y4m","-filter_complex","concat=n=2:v=1:a=0","-map","[out]","o.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())), "803d19f01b3fec5c05cd7df3b53461c487929f3c6f0b6ffaba8088e346acd9c0");
    }

    #[test]
    fn ffmpeg_concat_exports_decoded_frames_from_the_raw_segment() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-i","b.y4m","-filter_complex","concat=n=2:v=1:a=0","o.y4m"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.y4m").unwrap())), "b5e04cd714a2e692a3170253e1b815057bad55ddf37a2ff59e18163897d65b79");
    }

    #[test]
    fn ffmpeg_composes_raw_frames_from_a_concat_input() {
        let fs = MemoryVfs::new();
        for args in [
            media_args(&["-f","lavfi","-i","testsrc=s=6x4:r=3:d=1","a.y4m"]),
            media_args(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]),
            media_args(&["-i","concat:a.y4m|b.y4m","-i","a.y4m","-filter_complex","hstack","stack.y4m"]),
        ] {
            let r = cmd_media_doc("ffmpeg",&args,"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
        }
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/stack.y4m").unwrap())), "91bba8d100eb6b4a8e723239d37869430473c2b76b062ca08d68f84bd5895765");
    }

    #[test]
    fn image2_preserves_empty_geometry_in_a_readable_tiff_directory() {
        let fs=MemoryVfs::new();
        fs.write_file("/b.tif",b"II*\0\x08\0\0\0\0\0").unwrap();
        let run=|cmd:&str,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        assert_eq!(run("ffprobe",&["-show_entries","stream=codec_name,width,height,coded_width,display_aspect_ratio","-of","csv=p=0","b.tif"]).stdout,"tiff,0,0\n");
        assert_eq!(run("ffmpeg",&["-i","b.tif","-vf","hflip","o.ppm"]).exit_code,0);
        assert_eq!(fs.read_file("/o.ppm").unwrap(),b"P6\n0 0\n255\n");
        assert_eq!(run("ffmpeg",&["-i","b.tif","-vf","crop=1:1","o.png"]).stderr,"ffmpeg: extract_area: bad extract area (left=0, top=0, width=0, height=0 on 0x0)\n");
        assert_eq!(run("ffmpeg",&["-i","b.tif","-vf","scale=2:2","o.png"]).stderr,"ffmpeg: offset is out of bounds\n");
        assert_eq!(run("ffmpeg",&["-i","b.tif","-vf","hflip","o.mp4"]).exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())),"c42372af188eb8d660d9bd4bfc82842d39ff70b2f9bb0eaa7cd158f973bccb7c");
        assert_eq!(run("identify",&["b.tif"]).stderr,"identify: improper image header 'b.tif': Invalid TIFF dimensions\n");
    }

    #[test]
    fn image2_uses_the_default_frame_for_a_truncated_tiff_directory() {
        let fs=MemoryVfs::new();
        for bytes in [b"II*\0".as_slice(),b"MM\0*\xff\xff\xff\xff"] {
            fs.write_file("/b.tif",bytes).unwrap();
            let run=|cmd:&str,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
            assert_eq!(run("ffprobe",&["-show_entries","stream=codec_name,width,height","-of","csv=p=0","b.tif"]).stdout,"png,64,64\n");
            assert_eq!(run("ffmpeg",&["-y","-i","b.tif","b.ppm"]).exit_code,0);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/b.ppm").unwrap())),"8e533b23db363eb341303a0516a07ce1043a7c09f30521044a49d9a48f0479fa");
            assert_eq!(run("identify",&["b.tif"]).exit_code,1);
        }
    }

    #[test]
    fn tiff_still_roundtrips_pixels_dimensions_and_codec() {
        let fs=MemoryVfs::new();
        let run=|cmd:&str,args:&[&str]| {
            let r=cmd_media_doc(cmd,&media_args(args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            r.stdout
        };
        run("ffmpeg",&["-f","lavfi","-i","testsrc=s=7x5:r=1:d=1","image.tiff"]);
        run("ffmpeg",&["-i","image.tiff","image.ppm"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/image.ppm").unwrap())),"1690dfbe21c99b6868c58965186eda9958ee04ec3c7970c43b5ebdcbe37a3e47");
        assert_eq!(run("ffprobe",&["-show_entries","stream=codec_name,width,height","-of","csv=p=0","image.tiff"]),"tiff,7,5\n");
        assert_eq!(run("identify",&["-format","%m %wx%h","image.tiff"]),"TIFF 7x5");
    }

    #[test]
    fn ffmpeg_concat_keeps_shared_still_frames_for_export_and_encoding() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-i","a.mp4","a.png"]);
        for (opts, expected) in [
            (vec!["o.y4m"], "120ccb72bc939fbf72ed7c747fad1fc5ad4cf97097ce7be72ab59b7c5390b7b7"),
            (vec!["-frames:v","2","o.mp4"], "9318460ff964178e4cbbc19b3b18c80169c5a70cb7eb7b731fc9a9cb6a853e3d"),
            (vec!["-vf","hflip","-frames:v","2","o.mp4"], "1b15d5b0a8c07da551ff7fb760262024582ce48889e1cd004071ee1d1e8a71c0"),
        ] {
            run(&[&["-y","-stream_loop","2","-i","a.png","-i","a.mp4","-filter_complex","concat=n=2"][..],&opts].concat());
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&format!("/{}",opts.last().unwrap())).unwrap())),expected);
        }
    }

    #[test]
    fn ffmpeg_reports_the_movie_tick_duration_of_a_partial_video_sample() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-i","a.mp4","a.png"]);
        run(&["-ss","0.02","-stream_loop","2","-i","a.png","-i","a.png","-filter_complex","concat=n=2","-ss","0.045","-t","0.05","o.y4m"]);
        assert!(fs.read_file("/o.y4m").unwrap().starts_with(b"YUV4MPEG2 W8 H6 F50:1 "));
    }

    #[test]
    fn ffmpeg_exports_materialized_subtitle_packets_after_concat_or_loop() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        let cue=b"1\n00:00:00,000 --> 00:00:00,350\nhello\n";
        fs.write_file("/s.srt",cue).unwrap();
        run(&["-i","s.srt","sub.mp4"]);
        run(&["-i","sub.mp4","-filter_complex","concat=n=1","one.srt"]);
        assert_eq!(fs.read_file("/one.srt").unwrap(),cue);
        run(&["-i","s.srt","-i","sub.mp4","-filter_complex","concat=n=2","joined.srt"]);
        let packed=b"1\n00:00:00,000 --> 00:00:00,350\n\0\x05hello\n\n2\n00:00:00,350 --> 00:00:00,700\n\0\x05hello\n";
        assert_eq!(fs.read_file("/joined.srt").unwrap(),packed);
        run(&["-stream_loop","1","-i","sub.mp4","loop.srt"]);
        assert_eq!(fs.read_file("/loop.srt").unwrap(),packed);
        run(&["-i","s.srt","-i","sub.mp4","-filter_complex","concat=n=2","-ss","0.035","-t","0.39","cut.vtt"]);
        assert_eq!(fs.read_file("/cut.vtt").unwrap(),b"WEBVTT\n\n00:00:00.000 --> 00:00:00.350\n\0\x05hello\n\n00:00:00.350 --> 00:00:00.425\n\0\x05hello\n");
    }

    #[test]
    fn ffmpeg_concat_resamples_pcm_segments_into_the_first_audio_format() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","sine=r=8000:d=0.2","s.wav"]);
        run(&["-f","lavfi","-i","sine=r=12000:d=0.31","s2.wav"]);
        run(&["-i","s2.wav","-ac","2","s3.wav"]);
        run(&["-i","s.wav","-i","s3.wav","-filter_complex","concat=n=2","o.wav"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.wav").unwrap())), "3e3ef2ca4ef15ad24420095c5aaa6b749aec883f3cd6f6b08f9b64d2d4e386f8");
        run(&["-i","concat:s.wav|s2.wav","-i","s.wav","-filter_complex","concat=n=2","nested.wav"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/nested.wav").unwrap())), "17915442de8ca11f1b21604bae40ebf82e869f4ff88f51e69020dd616e0325a5");
        run(&["-i","concat:s.wav|s2.wav","-i","s.wav","-filter_complex","concat=n=2","-c","copy","nested.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/nested.mp4").unwrap())), "0718799c4ab81da09a80c0b80bdea426dfe40deee8b6ec04e0c3c7928f602bc3");
        run(&["-stream_loop","1","-f","lavfi","-i","sine=r=11025:d=0.17","-i","s.wav","-filter_complex","concat=n=2","loop.wav"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/loop.wav").unwrap())), "50458d1380abdffc8d6be359177bb38f6348e4bb23d83567b0fdd5540b5b56c1");
    }

    #[test]
    fn ffmpeg_concat_preserves_the_id_of_a_retained_audio_track() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","-f","lavfi","-i","sine=r=8000:d=0.2","av.mp4"]);
        run(&["-i","av.mp4","-i","av.mp4","-filter_complex","concat=n=2:v=0","audio.mp4"]);
        let out=cmd_media_doc("ffprobe",&media_args(&["-show_entries","stream=id","-of","csv=p=0","audio.mp4"]),"","/",&fs);
        assert_eq!(out.stdout,"0x2\n");
    }

    #[test]
    fn ffmpeg_decodes_changes_in_the_avc_sample_description() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=blue:s=6x4:r=3:d=0.7","b.mp4"]);
        run(&["-i","a.mp4","-i","b.mp4","-filter_complex","concat=n=2","movie.mp4"]);
        run(&["-i","movie.mp4","o.y4m"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.y4m").unwrap())), "ba374aad064bdc024ab006a52957ed152ca586f6e6abd2fbddb1b7a91a9f2b9e");
        run(&["-i","movie.mp4","-ss","1.1","-t","0.4","o.png"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())), "758ee94ae4fcee4af9f38d987abfdf734910f344ae205701579917a6ca3c66d9");
    }

    #[test]
    fn ffmpeg_crossfades_frames_across_different_frame_rates() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-i","b.y4m","-filter_complex","xfade=duration=0.25:offset=0.25","o.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())), "39c4d028da2c317348c89e3c75549349b5adf46aecf046f1d0e69ecbba370388");
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","-i","b.y4m","-filter_complex","xfade","-ss","0.1","-t","0.22","cut.mp4"]);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/cut.mp4").unwrap())), "3c95a744a43ed6359e834c0832cc6e3ecb96021192d8078bbc5517011b26d083");
    }

    #[test]
    fn ffmpeg_uses_movie_audio_defaults_for_an_unknown_sample_entry() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","sine=r=8000:d=0.2","s.wav"]);
        run(&["-i","s.wav","a.mp4"]);
        run(&["-i","a.mp4","o.wav"]);
        let bytes=fs.read_file("/o.wav").unwrap();
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()),2);
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()),8000);
        run(&["-i","a.mp4","o.aac"]);
        // ADTS defaults to 44100 Hz if the description omits a sample rate.
        assert_eq!((fs.read_file("/o.aac").unwrap()[2]>>2)&15,4);
    }

    #[test]
    fn ffmpeg_clamps_a_cut_to_the_last_available_packet() {
        let fs = MemoryVfs::new();
        let run = |args: &[&str]| assert_eq!(cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-f","lavfi","-i","testsrc=s=8x6:r=4:d=1","a.mp4"]);
        run(&["-f","lavfi","-i","color=c=red:s=6x4:r=3:d=0.7","b.y4m"]);
        run(&["-i","a.mp4","-ss","0.2","-t","0.65","edit.mp4"]);
        run(&["-i","edit.mp4","-i","b.y4m","-filter_complex","hstack","stack.mp4"]);
        run(&["-i","stack.mp4","-ss","0.1","-t","0.22","cut.wav"]);
        assert_eq!(fs.read_file("/cut.wav").unwrap().len(), 35324);
    }

    #[test]
    fn ffprobe_wave_reads_pcm_and_filters_requested_rows() {
        let fs = MemoryVfs::new();
        let pcm = PcmAudio { sample_rate: 8000, channels: vec![vec![0.0; 80]] };
        let bytes = encode_wav_pcm(&pcm, 24, false).unwrap();
        fs.write_file("/tone", &bytes).unwrap();
        let probe = |args: &[&str]| cmd_media_doc("ffprobe", &media_args(args), "", "/", &fs).stdout;
        assert_eq!(probe(&["-show_format", "./tone"]), format!(
            "[FORMAT]\nfilename=./tone\nnb_streams=1\nformat_name=wav\nduration=0.010000\nsize={}\nbit_rate={}\n[/FORMAT]\n",
            bytes.len(), bytes.len() * 800
        ));
        assert_eq!(probe(&["-show_entries", "format=size:stream=channels,codec_name", "-of", "csv:p=0", "tone"]),
            format!("pcm_s24le,1\n{}\n", bytes.len()));
        assert_eq!(probe(&["-of", "json", "tone"]), "{}\n");
    }

    #[test]
    fn magick_png_output_honors_parent_and_existing_file_mode() {
        let fs = MemoryVfs::new();
        let write = |path: &str| cmd_media_doc("magick", &media_args(&["xc:red", path]), "", "/", &fs);
        assert_eq!(write("missing/im.png").stderr, "shell: line 1: ENOENT: no such file or directory, stat '/missing'\n");
        assert!(!fs.exists("/missing"));
        fs.mkdir_all("/dir.png").unwrap();
        assert_eq!(write("dir.png").exit_code, 1);
        fs.symlink("/new.png", "/link.png").unwrap();
        assert_eq!(write("link.png").exit_code,0);
        assert_eq!(fs.stat("/new.png").unwrap().mode & 0o777, 0o666);
        fs.chmod("/new.png", 0o600).unwrap();
        assert_eq!(write("link.png").exit_code,0);
        assert_eq!(fs.stat("/new.png").unwrap().mode & 0o777, 0o600);
        assert_eq!(fs.readlink("/link.png").unwrap(), "/new.png");
        fs.chmod("/dir.png", 0o555).unwrap();
        assert_eq!(write("dir.png/nested.png").exit_code,1);
        assert!(!fs.exists("/dir.png/nested.png"));
    }

    fn gradient_png_pair() -> MemoryVfs {
        let fs = MemoryVfs::new();
        fs.write_file("/a.png", &hex_dec("89504e470d0a1a0a0000000d494844520000000d000000090806000000e97aa66a000000097048597300000b1300000b1301009a9c180000000249444154789c62a4912b0000003b4944415463945170facf40226034b3f2235d53404814e99ab2f25249d7d4da5148baa6f98b6a49d7b4734f27e99a2e5f9b42baa6b71f1690ac0900dff8166cd748a1f90000000049454e44ae426082")).unwrap();
        fs.write_file("/b.png", &hex_dec("89504e470d0a1a0a0000000d4948445200000007000000050806000000899af6d8000000097048597300000b1300000b1301009a9c180000000249444154789c62a4912b0000006149444154639c51a6f4ff2d37cbe34f9c4c2f7f33337d67fdfb8f93effb3f71e1af7f64197b6b54debde263b9fb9687e5e13736a68f5cbffef10b7ff9232ff6e98f326357bdea8b177cacb75ef0b3dc06d1129f7eab497cfca30aa2f1ebc4672700f4c246b0d78da95f0000000049454e44ae426082")).unwrap();
        fs
    }

    #[test]
    fn png_records_the_blocks_emitted_by_the_streaming_encoder() {
        for (shift,expected) in [(24,"90f18eff25a25feead75ae0293890be6f680b58ca03c97982f2f2d59e0ac233c"),(28,"fec26eeb37ad20e8c5156b33178abe95ead5ecc984ca3b3a1afbc625d2a71755")] {
            let mut state=628u32;
            let pixels:Vec<[u8;3]>=(0..257*129).map(|_|std::array::from_fn(|_|{
                state=state.wrapping_mul(1664525).wrapping_add(1013904223);
                (state >> shift) as u8
            })).collect();
            let png=pixel_png(257,129,PngEncoding::SplitDensity(72,None),|x,y|pixels[y*257+x]);
            assert_eq!(hex_enc(&sha256_bytes(&png)),expected);
        }
    }

    #[test]
    fn image2_defaults_to_a_gray_frame_when_a_webp_has_no_dimensions() {
        let fs = MemoryVfs::new();
        fs.write_file("/damaged", b"RIFF\x04\0\0\0WEBP").unwrap();
        let r = cmd_media_doc("ffmpeg", &media_args(&["-i","damaged","out.ppm"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.ppm").unwrap())), "8e533b23db363eb341303a0516a07ce1043a7c09f30521044a49d9a48f0479fa");
    }

    #[test]
    fn png_preserves_webp_pixel_alpha_even_when_the_header_claims_opacity() {
        let fs = MemoryVfs::new();
        fs.write_file("/damaged", &hex_dec("5249464612000000574542505650384c050000002f0100000000")).unwrap();
        let r = cmd_media_doc("convert", &media_args(&["damaged","-flop","out.png"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())), "b93a1b6c3fdb5effa5718380af38c23439f98cb4521b69b2feeff515f73bc05f");
    }

    #[test]
    fn webp_pixels_survive_image2_input_and_output() {
        let fs = MemoryVfs::new();
        fs.write_file("/picture", &hex_dec("524946462a000000574542505650384c1e0000002f024000002f3002133003f31f28252550c836021cbad7e3142ea2ffb1bc")).unwrap();
        let run = |args: &[&str]| cmd_media_doc("ffmpeg", &media_args(args), "", "/", &fs);
        assert_eq!(cmd_media_doc("ffprobe", &media_args(&["-show_entries","stream=codec_long_name","-of","csv=p=0","picture"]),"","/",&fs).stdout,"WebP image\n");
        assert_eq!(run(&["-i", "picture", "o.ppm"]).exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.ppm").unwrap())), "c6213c31b8dc8aa74e5163435f70b978d406d919f0f33e7d0bcb65bab89fd010");
        assert_eq!(run(&["-f", "lavfi", "-i", "testsrc=s=7x5:r=2:d=1", "%02d.webp"]).exit_code, 0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/02.webp").unwrap())), "517792c6879004136e9ae816f1abd8dd522ee686f54368e84350bc2ec8f256ce");
    }

    #[test]
    fn ffmpeg_writes_animated_gifs_with_cumulative_centisecond_rounding() {
        let fs=MemoryVfs::new();
        let r=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=7x5:r=8:d=0.5","anim.gif"]),"","/",&fs);
        assert_eq!(r.exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/anim.gif").unwrap())),"bd8d1a4587654c101657be4956df225a44963874fbe8f4f780581bec1b153156");
        let cut=cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=7x5:r=8:d=0.5","-ss","0.2","-t","0.2","cut.gif"]),"","/",&fs);
        assert_eq!(cut.stderr,"ffmpeg: offset is out of bounds\n");
        assert!(!fs.exists("/cut.gif"));
        let r=cmd_media_doc("ffmpeg",&media_args(&["-i","anim.gif","-vf","scale=6:4","o.mp4"]),"","/",&fs);
        assert_eq!(r.exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())),"d0093422a204d7de969a319aadb35c4b4ddd17a7cc6dba52a298e4161bd2f525");
    }

    #[test]
    fn zero_sized_gifs_can_be_padded_but_not_flipped_or_written_as_png() {
        let fs=MemoryVfs::new();
        fs.write_file("/empty.gif",&hex_dec("474946383961000000000000003b")).unwrap();
        let run=|cmd,args:&[&str]|cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        assert_eq!(run("convert",&["empty.gif","-flop","out.png"]).stderr,"magick: Invalid stored image dimensions\n");
        assert_eq!(run("convert",&["empty.gif","out.png"]).stderr,"shell: line 1: internal error\n");
        assert_eq!(run("sips",&["-s","format","png","empty.gif","--out","out.png"]).stderr,"Error: empty.gif: Invalid PNG dimensions: 0x0\n");
        assert_eq!(run("sips",&["-f","horizontal","empty.gif","--out","out.gif"]).stderr,"Error: empty.gif: Invalid stored image dimensions\n");
        assert!(!fs.exists("/out.png"));
        assert_eq!(run("convert",&["empty.gif","-extent","2x2","out.png"]).exit_code,0);
    }
    #[test]
    fn gif_frame_cap_keeps_the_decoded_mp4_sample_delay() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]| cmd_media_doc("ffmpeg",&media_args(args),"","/",&fs);
        assert_eq!(run(&["-f","lavfi","-i","testsrc=s=16x16:r=8:d=0.5","b.mp4"]).exit_code,0);
        assert_eq!(run(&["-i","b.mp4","-frames:v","1","cap.gif"]).exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/cap.gif").unwrap())),"a56a108ae7f2c43ba9f1f4ede312a864735442f3ca153672f54782e75303e843");
    }

    #[test]
    fn ffmpeg_keeps_gif_packets_for_input_edits_and_loops() {
        let fs=MemoryVfs::new();
        fs.write_file("/input",&hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021f904000a0000002c0000000003000200000809000108201060408180003b")).unwrap();
        for (prefix,hash) in [(["-ss","0.05"],"aaa8d30613d219a7e508ca4bb3cad4a6cddad3bb6c4018775d47d6476b66088c"),(["-stream_loop","1"],"85de061c86f72926504b7b4507333b9286fbdc7199020912b7a61b253ff92910")] {
            let r=cmd_media_doc("ffmpeg",&media_args(&["-y",prefix[0],prefix[1],"-i","input","o.mp4"]),"","/",&fs);
            assert_eq!(r.exit_code,0);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.mp4").unwrap())),hash);
        }
    }
    #[test]
    fn ffprobe_reads_gif_packet_boundaries_and_individual_frame_delays() {
        let fs=MemoryVfs::new();
        let mut data=b"GIF89a\x01\0\x01\0\0\0\0".to_vec();
        for delay in [5,20,0] {
            data.extend_from_slice(&[33,249,4,0,delay,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0]);
        }
        data.push(59);
        fs.write_file("/anim",&data).unwrap();
        let probe=|show,entries| cmd_media_doc("ffprobe",&media_args(&[show,"-show_entries",entries,"-of","csv=p=0","anim"]),"","/",&fs).stdout;
        assert_eq!(probe("-show_packets","packet=pts,duration,size,pos,flags"),"0,5,36,0,K_\n5,20,23,36,__\n25,0,24,59,__\n");
        assert_eq!(probe("-show_streams","stream=codec_name,avg_frame_rate,time_base,duration_ts,nb_frames"),"gif,12/1,1/100,25,3\n");
    }

    #[test]
    fn convert_uses_the_last_composited_gif_frame_for_a_single_png() {
        let fs=MemoryVfs::new();
        fs.write_file("/anim",&hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021ff0b4e45545343415045322e30030103000021f904000a0000002c00000000030002000008090001082010604081800021f904010a0006002c01000000020002008200458a11569bee3378ff4489dc2166ed32770000000000000807000510185020200021f904010a0006002c01000000020002008200458a11569bff448910559afe43880f5499000000000000080700051018502020003b")).unwrap();
        let r=cmd_media_doc("convert",&media_args(&["anim","-flop","out.png"]),"","/",&fs);
        assert_eq!(r.exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),"b42039e70d78d673a4a66b520cd59e36f16ccf0a8480bd415b0f0c9d249f3f91");
    }

    #[test]
    fn gif_image_editors_preserve_animation_metadata() {
        let fs=MemoryVfs::new();
        fs.write_file("/anim.gif",&hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021ff0b4e45545343415045322e30030103000021f904000a0000002c00000000030002000008090001082010604081800021f904010a0006002c01000000020002008200458a11569bee3378ff4489dc2166ed32770000000000000807000510185020200021f904010a0006002c01000000020002008200458a11569bff448910559afe43880f5499000000000000080700051018502020003b")).unwrap();
        for (cmd,args,hash) in [
            ("sips",vec!["-s","format","gif","anim.gif","--out","out.gif"],"58f9772e13c45a3da958489535d23412f3aa67024bb335c6bb6ea32a4e72a2f5"),
            ("convert",vec!["anim.gif","-extent","6x5","out.gif"],"f7dd76b57f7abf8ae9eab47449f69bcace8267825d9fbc326f2993aa91f047d9"),
            ("convert",vec!["anim.gif","-flop","out.gif"],"075222b27dd5f3d4d9167ac87faf0879288270b94628d5f43b86dd2113dcef23"),
        ] {
            let r=cmd_media_doc(cmd,&media_args(&args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.gif").unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_roll_chop_splice_and_shave_match_reference_pixels() {
        let fs=MemoryVfs::new();
        fs.write_file("/a.gif",&hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021f904000a0000002c0000000003000200000809000108201060408180003b")).unwrap();
        fs.write_file("/empty.gif",&hex_dec("474946383961000000000000003b")).unwrap();
        let empty=cmd_media_doc("convert",&media_args(&["empty.gif","-splice","2x0","o.gif"]),"","/",&fs);
        assert_eq!(empty.stderr,"magick: Invalid generated resource dimensions\n");
        for (options,hash) in [
            (&["-roll","+1-1"][..],"f5f90ed4df8bf8982a40fdcd3dc330236d625368440d19b62f3e589511d70bbf"),
            (&["-roll","4x6"][..],"ad77504d196739dd029118b3ce323c8c14724787c08da41ee27af2ecd1bd6e5d"),
            (&["-roll","-99+87"][..],"014aa657a9c715e094c1d90ac07fec8e3ddab0f6a0e13d2ff2e232e8b56769ad"),
            (&["-chop","1x1+1+1"][..],"bea0b6d8e95340b4d508aab4bfff1e5cb04984902a3a4b8c106963d7d1590085"),
            (&["-chop","99x99"][..],"2ce935acf66fdc26782ab4e64e63a56d40ac1086ffd82b861df8e9b1d6e65ab7"),
            (&["-gravity","center","-chop","1x1"][..],"310df51af872e370e2e04c1a2a5a35de2ab01a3eceb7edd1578c9cd590777802"),
            (&["-background","red","-splice","2x1+1+1"][..],"af86cc8e5d0630e69b16624f29e5221b7df75b38696b5e18a81810b5b7b21667"),
            (&["-gravity","southeast","-splice","1x2"][..],"4229f8d332cbfd1769bb5b996123a582213db351a7f2da34654d81d5d60ccd80"),
            (&["-shave","2x1"][..],"0fab25070a4ac01d74730097e550160510e5ce758c365a1f6969dc94ed1d308b")
        ] {
            let args=[&["a.gif"][..],options,&["o.gif"]].concat();
            let r=cmd_media_doc("convert",&media_args(&args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{options:?}: {}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.gif").unwrap())),hash,"{options:?}");
        }
    }

    #[test]
    fn sips_reopens_gif_after_rotation_before_export() {
        let fs=MemoryVfs::new();
        let input=media_args(&["-size","4x2","xc:red","gradient:blue-yellow","xc:green","-delay","9","-loop","5","a.gif"]);
        assert_eq!(cmd_media_doc("convert",&input,"","/",&fs).exit_code,0);
        for (angle,format,hash) in [
            ("90","heic","4ad8782c5dc449b82f121c7fbb2c0908cf1257f592b61a354f174ce2ec7ce36a"),
            ("30","png","8e51896831f7867b5374849279b54bbdd14575ca7f381bcad54dcde9be0f6727"),
        ] {
            let r=cmd_media_doc("sips",&media_args(&["-s","format",format,"-r",angle,"a.gif","--out","turned"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/turned").unwrap())),hash);
        }
        let r=cmd_media_doc("sips",&media_args(&["-s","format","gif","-r","37","-f","horizontal","a.gif","--out","turned.gif"]),"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/turned.gif").unwrap())),"0b27f8a0a9bb8f715c4803743a4cd3999915231610cfc2b1ce983083e2af50bc");
    }

    #[test]
    fn reads_image_ast_heif_by_content() {
        let im=png_pixels::Raster {
            width:4, height:5, gray:false, alpha:true, density:240, orientation:Some(6),
            pixels:(0..20).map(|i|std::array::from_fn(|j|((i*4+j)*43) as u8)).collect(),
        };
        let bytes=heif::encode(&im,"heic",240,4096).unwrap();
        let (meta,depth,channels,density)=inspect_raster(&bytes,"wrong.png",4).unwrap();
        assert_eq!((meta.fmt.as_str(),meta.w,meta.h,depth,channels,density),("HEIC",4,5,8,4,240));
        assert_eq!(heif::header(&bytes).orientation,Some(6));
        let decoded=png_pixels::Raster::decode(&bytes,4096).unwrap();
        assert_eq!((decoded.orientation,decoded.pixels),(Some(6),im.pixels.clone()));
        assert!(png_pixels::Raster::decode(&bytes,16).is_err());
        let mut corrupt=bytes;
        let start=corrupt.windows(8).position(|b|b==b"POEHEIF1").unwrap()+8;
        corrupt[start]=0;
        assert_eq!(png_pixels::Raster::decode(&corrupt,4096).unwrap().pixels,vec![[0,0,0,255];20]);
        corrupt.extend(im.png());
        assert_eq!(png_pixels::Raster::decode(&corrupt,4096).unwrap().pixels,im.pixels);
    }

    #[test]
    fn composite_preserves_remaining_gif_scenes() {
        let fs=MemoryVfs::new();
        let run=|cmd,argv:&str|cmd_media_doc(cmd,&media_args(&argv.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 4x2 xc:red gradient:blue-yellow xc:green -delay 9 -loop 5 a.gif").exit_code,0);
        assert_eq!(run("convert","-size 3x2 gradient:red-blue p.png").exit_code,0);
        for (args,hash) in [
            ("p.png a.gif o.gif","02ba1727c618a1d8d6a12f25f0279519be059a6751f63c8f6c70374eaa18dbde"),
            ("a.gif p.png o.png","febcfcf1c65dbbf0c59e4d219f5d411fd857192d0a8ac7f1b01b8884cab50243"),
            ("a.gif[-1] p.png o.png","f6f8d3bbce8bc3be3c608ba3ae4588ab80afea1ac12be3a2e595a1b77e7613c8"),
        ]{
            let r=run("composite",args);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            let name=args.split_whitespace().last().unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&format!("/{name}")).unwrap())),hash,"{args}");
        }
        let r=run("composite","p.png a.gif frame-%02d.png");
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/frame-00.png").unwrap())),"9fbef3cccab335666b189a5c410bc1a15a30a4ef6b753e46f73b5835175b018f");
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/frame-02.png").unwrap())),"862e92446a2e54553c1ccd96f66a2d90c7b3ec002fc0c59b89d58f6a725c2960");
    }

    #[test]
    fn convert_gamma_quantizes_each_stage_without_changing_alpha() {
        let fs=MemoryVfs::new();
        let im=png_pixels::Raster{width:9,height:7,gray:false,alpha:true,density:96,orientation:Some(1),
            pixels:(0..63).map(|i|std::array::from_fn(|j|((i*4+j)*43) as u8)).collect()};
        fs.write_file("/in.png",&im.png()).unwrap();
        for (gamma,hash) in [
            ("2.2","6ebb33294c60ce318daec288ca5e10dd4b628dcdff9f3a7d0bf0569cb1284486"),
            ("garbage","f06336f3721851cb6e53a9063080b494cd84c541275f98fad3da408823a514ab"),
        ]{
            let r=cmd_media_doc("convert",&media_args(&["in.png","-gamma",gamma,"o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash);
        }
    }

    #[test]
    fn convert_trims_using_filtered_pixels_and_fuzz() {
        let fs=MemoryVfs::new();
        let im=png_pixels::Raster{width:9,height:7,gray:false,alpha:true,density:72,orientation:None,
            pixels:(0..63).map(|i|{let v=if (2..7).contains(&(i%9)) && (2..5).contains(&(i/9)){12}else{0};[v,v,v,255]}).collect()};
        fs.write_file("/faint.png",&im.png()).unwrap();
        for (fuzz,w,h) in [("10",5,3),("10units",5,3),("8%",9,7)]{
            let r=cmd_media_doc("convert",&media_args(&["faint.png","-fuzz",fuzz,"-trim","o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            let out=png_pixels::Raster::decode(&fs.read_file("/o.png").unwrap(),4096).unwrap();
            assert_eq!((out.width,out.height),(w,h));
        }
    }

    #[test]
    fn convert_auto_orients_mirrored_and_rotated_inputs_once() {
        let fs=MemoryVfs::new();
        for (orientation,hash) in [
            (5,"b8510795a39265aabce24dc2cd1f1ee6a31190834e4598cb33ebdfe20e4345de"),
            (7,"8f1d8899dbc563ef0e81103c6d32c5a028f0e6bf199eb79bbb0162ee7e5b7c3b"),
        ] {
            let im=png_pixels::Raster{width:9,height:7,gray:false,alpha:true,density:96,orientation:Some(orientation),
                pixels:(0..63).map(|i|std::array::from_fn(|j|((i*4+j)*43) as u8)).collect()};
            fs.write_file("/in.png",&im.png()).unwrap();
            let r=cmd_media_doc("convert",&media_args(&["in.png","-auto-orient","-auto-orient","o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash);
        }
    }

    #[test]
    fn convert_replaces_only_pixels_inside_the_color_tolerance() {
        let fs=MemoryVfs::new();
        let im=png_pixels::Raster{width:3,height:1,gray:false,alpha:true,density:72,orientation:None,
            pixels:vec![[20,22,24,1],[21,22,25,111],[23,22,24,255]]};
        fs.write_file("/colors.png",&im.png()).unwrap();
        for (op,expected) in [
            ("-opaque", vec![[0,0,255,255],[0,0,255,255],[23,22,24,255]]),
            ("+opaque", vec![[20,22,24,1],[21,22,25,111],[0,0,255,255]]),
            ("-transparent", vec![[20,22,24,0],[21,22,25,0],[23,22,24,255]]),
            ("+transparent", vec![[20,22,24,1],[21,22,25,111],[23,22,24,0]]),
        ] {
            let r=cmd_media_doc("convert",&media_args(&["colors.png","-fill","blue","-fuzz","1",op,"#141618","out.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            let output=png_pixels::Raster::decode(&fs.read_file("/out.png").unwrap(),fs.max_input_bytes()).unwrap();
            assert_eq!(output.pixels,expected,"{op}");
        }
    }

    #[test]
    fn convert_applies_tone_curves_to_translucent_pixels() {
        let fs=MemoryVfs::new();
        let im=png_pixels::Raster{width:9,height:7,gray:false,alpha:true,density:240,orientation:Some(6),
            pixels:(0..63).map(|i|std::array::from_fn(|c|((if c==3 {73}else{32})+((i*4+c)*43%99)) as u8)).collect()};
        fs.write_file("/rgba.png",&im.png()).unwrap();
        for (args,hash) in [
            ("-normalize","aef438d4da4e968d2ffd8865fc76081d65aba9da9ca45bc311ddc8b0ee761377"),
            ("-contrast-stretch 20%x10%","4c9cd3a4b690b330e31de2090649a867189b545482b47372fe76d3b12dba62cb"),
            ("-linear-stretch 2x4","7e4ecfb25bbe472bad7005d59aab21ea3010377163802cc6acaa0290ed3361db"),
            ("-auto-level","a2f8f6676159e9e87bbb3fdb1abf4f6491557a1795b9764f53043b5641ec9633"),
            ("-channel RGBA -auto-level","7915f4b5b9f198ab14880d9f436ee229e225576c51ea7cf3c60a99a75c968417"),
            ("-channel red -auto-level","eaf2fa6385971f700a99fc12e767638ed271e96af299fc6dfcf01fcd4c4c72d4"),
            ("-channel blue +channel -auto-level","a2f8f6676159e9e87bbb3fdb1abf4f6491557a1795b9764f53043b5641ec9633"),
            ("-auto-gamma","23d4e49eeac4f562fefdff76b82739aac602fb1c0a987b16e761ae8d984884a8"),
            ("-equalize","4f38eccf4faa7ee785a8155126f122cb4c71aa7843e2ccdcb4f2d5388e2b5350"),
            ("-alpha off -auto-gamma","ea82651c0b9953be4ed17e2d0d91eeede01a47d08ba208d6f3d10e620ef9add4"),
            ("-auto-level -auto-gamma -equalize","dd1f320253009e0bfe31560920bb80c695cb8f02ebb329447e15c084946154f4"),
            ("-contrast","6fffafb7ca8cffa7b4f5e270c92255b4f3d12effa46ee66d8d170959adc37524"),
            ("+contrast","119fe95616ed3681e78937071528cae6bddc7cbb5fc6b89cfa38286370a1cf8f"),
            ("-brightness-contrast 20x30","2970a31154a11c7c00d90a29b7f3e06c500462b77c679a8bc39db88f29a3cea5"),
            ("-sigmoidal-contrast 3x50%","4592bbba2d2e2bc360ce306a129df7edecb4fdc07cb8fc335cc1f510e6f76c70"),
            ("+sigmoidal-contrast 5x128","38c0d41e2c9821d10f0527cf564141b60f2471f6e29765be11316f7658c88208"),
            ("-sigmoidal-contrast bad","8cf3c95de2c53f35ddf36b2bd76af68df7481fc33be603f895aaa12789e95df3"),
            ("-level 10%,90%,1.2","a88e81ef5c9f83a80c26e6843890ec3202502e742a9c0c30a95ec21cf2b0966b"),
            ("+level 23,210,2","ac28c0367f1a112b26bea4098f3f7fba8b0c52634ea18bcc5071a3bdd83094c4"),
            ("-level 80%,20%","8cf3c95de2c53f35ddf36b2bd76af68df7481fc33be603f895aaa12789e95df3"),
            ("-level bad","8cf3c95de2c53f35ddf36b2bd76af68df7481fc33be603f895aaa12789e95df3"),
            ("-level 0,255,bad","8cf3c95de2c53f35ddf36b2bd76af68df7481fc33be603f895aaa12789e95df3"),
            ("-fill red -tint 50%","be38665ffa9ddbcb8b93fc392cc8a959fa7f6d86e2687b6a707ba8b66d90cd92"),
            ("-fill orange -colorize 10","8f6acef886915c7c4d198adaa1d147605fd4981cf76e6d890948037aadb7f280"),
            ("-tint 50","fd7962c819885a3b7c43f804220fe541c61a502aa0d4c583e9b12fa590e8eef0"),
            ("-modulate 120,60,80","27e531f3f93da888c60239c8c81123a2d9fa5edfc5e4499ebaa2dd362238a206"),
            ("-modulate 50,-30","7445043b7de7a28e89dcf69dc7d409d6a52abe20aa033f8d7080f5c8eaa6ee3b"),
            ("-modulate bad","8cf3c95de2c53f35ddf36b2bd76af68df7481fc33be603f895aaa12789e95df3"),
        ] {
            let argv=format!("rgba.png {args} out.png");
            let r=cmd_media_doc("convert",&media_args(&argv.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),hash,"{args}");
        }
    }

    #[test]
    fn convert_filters_translucent_pixels_with_clamped_edges() {
        let fs=MemoryVfs::new();
        let im=png_pixels::Raster{width:9,height:7,gray:false,alpha:true,density:240,orientation:Some(6),
            pixels:(0..63).map(|i|std::array::from_fn(|j|((i*4+j)*43) as u8)).collect()};
        fs.write_file("/rgba.png",&im.png()).unwrap();
        for (op,geometry,hash) in [
            ("-blur","1","e504e5a46010a2c9a344bd2aba123d9ea9473cdc71089ed28fcd0ae610fd0532"),
            ("-gaussian-blur","100x1.7","c27301fc3cf15b6a78bf8e2561602b789c084f3c8a0647349d584faa37eb33ec"),
            ("-blur","9999","043d2e2033dccfbe2d9104cff923019ee250297e7d47c35909c1e61de16659fb"),
            ("-sharpen","1","3a598893d74a2a3c01d2f56c247489456b25b9af433166153e0db27e3d1a5e01"),
            ("-unsharp","2x2","754638fe5429215b20dcb64ba4994cbe400db343d5b7906abc808d24b87f933b"),
            ("-convolve","kernel:0,-0.5,0,-0.5,3,-0.5,0,-0.5,0","2e62f1aebc90a1384747d5d11643829d951a75bacae551f161b2f8962706b9a5"),
            ("-emboss","1","620e3e4fdb5d3f0f1dcabd7c8a517b3f97e900cc8e54c7aebe9c526ae182d480"),
            ("-charcoal","3","378d4c7520d098dc90c714142245a54109df0809766c5486765174934cb05ff8"),
            ("-sepia-tone","80%","70e9f61563137eaaebc2958c9a87a823bdcd1d4cade137619fa5ab52f4952019"),
            ("-sepia-tone","190","e089eee3743a2f46ecc58d191e9dffc4b8bcf8e855c6750cbff74f67d9a27c18"),
            ("-solarize","50%","09fa21cd3f6a7c8dcddf1cb17d3a6dae01db436059b0ecaaa0f559ce86b09624"),
            ("-posterize","3","acd5345b38116fc1a526b35ae7bfed9b13165f2652556fc52a010504f36fd10f"),
            ("-posterize","bad","f3fadea3f6ef18ff4b1544e6150c1a6ef2014371d81fe4822dbfd91ccf1db68d"),
            ("-colors","8","27ba1f83a8b7044cfda8a5bf53394aa624e648d2cddbcfe74e10cb5f0749043b"),
            ("+raise","2x1","8012345993a65f6bcb4396a6a59a68a567585f618c79c1687e6a566245054171"),
            ("-vignette","1","d0e5348280feaace8faf4c12e32b52b0574912228d0ab593318f466847576dcd"),
            ("-shadow","80x3+5+5","df41baa05f418a316cf74fae882386ac0e10e3377e53b8d85fd7195306c4e4c3"),
            ("-median","2","3e7a1534daa9c9114d4503a50766b5821dcd54fccaa1fa1fd0bf08403a37faa0"),
            ("-median","bad","e63ece18c92a810a89cd79ac67055f4d2a2583f92cb39680858bac575f910ad7"),
        ]{
            let r=cmd_media_doc("convert",&media_args(&["rgba.png",op,geometry,"o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{op} {geometry}");
        }
        for (op,method,size,hash) in [
            ("-statistic","Median","3x5","b74bad518028e20896fb9100971250e3c2b7ddf19e4fb4e64f99d9abcc394434"),
            ("-morphology","TopHat","2x3","98d92062449ba65b6a2fb14976c75abf3c7635782655d344e5e6febaaa52dbfd"),
        ] {
            let r=cmd_media_doc("convert",&media_args(&["rgba.png",op,method,size,"o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{op} {method} {size}");
        }
    }

    #[test]
    fn convert_parses_canvas_geometry_and_keeps_size_after_null_input() {
        let fs=MemoryVfs::new();
        for (spec,hash) in [
            ("7","fe218f8383d33875f400f19d02adcd25dcb25b1fb136352e266c1e05adf4bdb7"),
            ("3x2%","c7d9a5bb159a0f5a8505ee116290c0aee6ab2da9c138c1889e829912f1437da9"),
        ]{
            let r=cmd_media_doc("convert",&media_args(&["-size",spec,"null:","gradient:red-blue","-append","o.png"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash);
        }
    }

    #[test]
    fn magick_repeats_tile_pixels_at_the_requested_size() {
        let fs=MemoryVfs::new();
        let run=|cmd,args:&str|cmd_media_doc(cmd,&media_args(&args.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 3x2 gradient:red-blue p.png").exit_code,0);
        assert_eq!(run("convert","-size 4x2 xc:red gradient:blue-yellow xc:green -delay 9 -loop 5 a.gif").exit_code,0);
        for (cmd,args,status,hash) in [
            ("convert","-size 7x5 tile:p.png o.png",0,"8e548929f9b9391e7ba19dc648c1010229807fef7ef2a3838f2872a6c5b2906d"),
            ("composite","tile:a.gif[1] p.png o.png",0,"bafda54ae84735948fb7ac6038380ca6846364f94a09961008aae0539c075473"),
            ("montage","tile:gradient:red-blue p.png -geometry +0+0 o.png",0,"5337e60ecd803fe42b8f64d67aeca061e2bf343d3d42701fbf0d6c7874a11905"),
            ("compare","-metric AE tile:xc:green p.png o.png",1,"5f99cae78d1a192b037a48b96865b85b7f990584f46f44351d573c720d446c37"),
        ] {
            let r=run(cmd,args);
            assert_eq!(r.exit_code,status,"{cmd} {args}: {}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{cmd} {args}");
        }
    }

    #[test]
    fn compare_reads_first_selected_page_and_inline_geometry() {
        let fs=MemoryVfs::new();
        let run=|cmd,argv:&str|cmd_media_doc(cmd,&media_args(&argv.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 4x2 xc:red gradient:blue-yellow xc:green -delay 9 -loop 5 a.gif").exit_code,0);
        assert_eq!(run("convert","-size 3x2 gradient:red-blue p.png").exit_code,0);
        for (src,metric,hash) in [
            ("gif:a.gif[2,0]","8\n","3f008045e26b6582e28757f85362fdc7f341398f2ec81676a9c93e6c0083e7a1"),
            ("p.png[2x1+1+0]","4\n","934ace654a8d0e6e3d848aba0e5f8ea4942de180689b4d5aae88796127cebb31"),
        ]{
            let r=run("compare",&format!("-metric AE {src} p.png o.png"));
            assert_eq!((r.exit_code,r.stderr.as_str()),(1,metric));
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash);
        }
    }

    #[test]
    fn montage_lays_out_selected_gif_scenes() {
        let fs=MemoryVfs::new();
        let run=|cmd,argv:&str|cmd_media_doc(cmd,&media_args(&argv.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 4x2 xc:red gradient:blue-yellow xc:green -delay 9 -loop 5 a.gif").exit_code,0);
        assert_eq!(run("convert","-size 3x2 gradient:red-blue p.png").exit_code,0);
        for (input,hash) in [
            ("a.gif","0105e1037f6a1804c883639012d292fff7658579bc5e2915398519e610dc8d0b"),
            ("a.gif[-1]","91aef1971810b01088d54a5e628e6b37a0670af405cc7bd101ccb2db256fc535"),
        ]{
            let r=run("montage",&format!("{input} p.png -tile 2x1 -geometry +0+0 o.png"));
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash);
        }
    }

    #[test]
    fn convert_encodes_image_ast_heif_containers() {
        let fs=MemoryVfs::new();
        for (args,hash) in [
            ("-size 7x5 xc:red o.heic","6e6a825a34efe157a8f38e8e63695ca34c56b5f7d84bef3b428150f573dd004c"),
            ("-size 7x5 xc:red -alpha off o.heic","fa1978e12fb293b65c3b970c666baf38ea11b20f3d7803a47517aa44aa629fdc"),
            ("-size 7x5 xc:red -grayscale Rec709Luma o.heif","9953e3164cdc5c24016f7cca768c681a75299771dec67a5a08114d636f031125"),
            ("-size 7x5 gradient:none-red o.avif","9300b892d2408067db6c2e040fa8449b0000d4bc6a2bf0b916a9887dab90182c"),
            ("-size 7x5 gradient:none-red -extent 9x5 o.avif","98c7d60fffecd3c7c6251ec702cf35c58c6b7d5f0ca609f0f3117e804acfae6b"),
        ] {
            let argv=media_args(&args.split_whitespace().collect::<Vec<_>>());
            let r=cmd_media_doc("convert",&argv,"","/",&fs);
            assert_eq!(r.exit_code,0,"{args}: {}",r.stderr);
            let bytes=fs.read_file(&format!("/{}",argv.last().unwrap())).unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&bytes)),hash,"{args}");
        }
        assert_eq!(cmd_media_doc("convert",&media_args(&["-size","3x2","gradient:red-blue","input.png"]),"","/",&fs).exit_code,0);
        let r=cmd_media_doc("sips",&media_args(&["-s","format","heic","-r","90","input.png","--out","turned.heic"]),"","/",&fs);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/turned.heic").unwrap())),"90223b6f0ffcd837c5f901689974f35f879689ed810db2e1c3bab2a6f512b018");
    }

    #[test]
    fn convert_writes_snapshots_in_pipeline_order() {
        let fs=MemoryVfs::new();
        let run=|args:&str|cmd_media_doc("convert",&media_args(&args.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        let hash=|path:&str|hex_enc(&sha256_bytes(&fs.read_file(path).unwrap()));
        let result=run("-size 7x5 xc:red xc:blue -write frame-%02d.png -reverse out.gif");
        assert_eq!(result.exit_code,0,"{}",result.stderr);
        assert_eq!(hash("/frame-00.png"),"00b2733061ffe79bb54fe2e07369acee92196844febc9530ae1b0307b9e01bfe");
        assert_eq!(hash("/frame-01.png"),"80c5c8dd9940360daa7102624640cfb92ab313ed804f6ffc8c7468a78ade6e16");
        assert_eq!(hash("/out.gif"),"2af26716fcf566bcd8bb6cb14afd5a9bc077e36c47d2cc2ddd30847ea682c65e");
        let result=run("-size 7x5 xc:red xc:blue +write middle.png middle.png -append out.gif");
        assert_eq!(result.exit_code,0,"{}",result.stderr);
        assert_eq!(hash("/out.gif"),"4a4866c47f48d441e7e85f045bfdd2a8a22831550694ec47075f6c4eafb27de1");
        let result=run("-size 7x5 xc:red xc:blue -write saved.png -rotate bad failed.gif");
        assert_eq!(result.stderr,"magick: Invalid rotation angle\n");
        assert_eq!(hash("/saved.png"),hash("/frame-01.png"));
        assert!(fs.read_file("/failed.gif").is_err());
    }

    #[test]
    fn convert_applies_thresholds_to_colors_and_transparency() {
        let fs=MemoryVfs::new();
        for (args,hash) in [
            ("-size 7x5 gradient:red-blue -threshold 50% o.gif","56206e287d8b5298062282f8ded729fe597e32434177714de8516e45b63eaae5"),
            ("-size 7x5 gradient:none-yellow -threshold 50% o.png","bed20f91dad8866ed6da78da74c8d989fb173567fabe5379c1afafd0d2747f38"),
            ("-size 7x5 gradient:red-blue -white-threshold 90 o.png","3dc549885d319f3c242fa73a7153c26a8b711cc5f19afd1bb56378cc363d6e17"),
            ("-size 7x5 gradient:none-yellow -black-threshold 100 o.gif","7596af3593465855735d6c0f0c623c29b15f57513b717b57a45b455a73adebd0"),
            ("-size 7x5 gradient:red-blue -threshold bad o.gif","fb98fba606685be10c9ed93dd0d1146cc1b8e1166f198596afee22f2fdcc4db8"),
            ("-size 7x5 gradient:red-blue -threshold 50x o.png","df32b0ad2f982cf60451fa1d0b0ab4e5374768414193333e8d8b26a92bab0063"),
            ("-size 7x5 gradient:none-yellow -monochrome o.gif","fb4e01ee0299286b1bd3060fb57a8e120bb111965207ba73ce5210468bf9c94f"),
            ("-size 7x5 gradient:none-yellow -threshold 300 o.gif","fb98fba606685be10c9ed93dd0d1146cc1b8e1166f198596afee22f2fdcc4db8"),
            ("-size 7x5 gradient:none-yellow -threshold 12.3e1 o.gif","45ae48c7d9de55d644ed1d6ec15f4502c17300ccfcd8fd47d4e9a41358d08ba0"),
        ] {
            let argv=media_args(&args.split_whitespace().collect::<Vec<_>>());
            let result=cmd_media_doc("convert",&argv,"","/",&fs);
            assert_eq!(result.exit_code,0,"{args}: {}",result.stderr);
            let path=format!("/{}",argv.last().unwrap());
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&path).unwrap())),hash,"{args}");
        }
    }

    #[test]
    fn magick_resize_resolves_missing_axes_and_geometry_modifiers() {
        for (spec, expected) in [
            ("8!", (8,2)), ("x5!", (3,5)), ("2X6", (2,1)),
            ("8>", (3,2)), ("x1<", (3,2)), ("2x7<", (2,1)),
            ("2x7^<", (11,7)), ("x1^", (3,2)), ("12@", (4,3)),
            ("3@", (2,1)), ("4@<", (3,2)), ("24@>", (3,2)),
            ("50x150%", (2,3)), ("25%x75%", (1,2)), ("x50%", (2,1)),
            ("5.5x7.5", (6,4)), ("50%>", (2,1)), ("35xno%", (1,2)),
        ] {
            assert_eq!(apply_magick_resize_geom(3,2,spec),expected,"{spec}");
        }
    }

    #[test]
    fn convert_selects_input_pages_and_reads_inline_geometry() {
        let fs=MemoryVfs::new();
        let run=|s:&str|cmd_media_doc("convert",&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("-size 4x2 xc:red gradient:blue-yellow xc:green -delay 9 -loop 5 a.gif").exit_code,0);
        assert_eq!(run("-size 3x2 gradient:red-blue p.png").exit_code,0);
        let mut damaged=fs.read_file("/a.gif").unwrap();
        let second=damaged.windows(3).enumerate().filter(|(_,b)|*b==[33,249,4]).nth(1).unwrap().0+8;
        assert_eq!(damaged[second],44);
        damaged[second+5..second+9].fill(255);
        fs.write_file("/damaged.gif",&damaged).unwrap();
        assert_eq!(run("damaged.gif[0] first.png").exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/first.png").unwrap())),"0c1aae4c7011704567265408c11d2accff112c26fec421bf02b597daa89c9e7e");
        for (cmd,hash) in [
            ("-size 3x4 png:p.png[4x2-bad] -flop o.png","a9acd9e978a30667d3ebed0f0634311fe6b6fe79de439bd9cbff09ef371ca25b"),
            ("-size 3x4 png:p.png[4x2+3+bad] -flop o.png","a9acd9e978a30667d3ebed0f0634311fe6b6fe79de439bd9cbff09ef371ca25b"),
            ("-size 3x4 png:p.png[bad-2x3] -flop o.png","66813b21c84d48497037317cda10390000b72674aa460edbe3ab2944450685bd"),
            ("-size 3x4 gif:a.gif o.gif","11611e7ab6edbcf8fd62c9faa3720674f716851e801645ad78bc76a82f4944bb"),
            ("-size 3x4 tiff:p.png o.gif","29d84a2fa01b009e125f6bccd882266c141497ebe987ca2a67fe3af3c638fb48"),
            ("-size 3x4 a.gif[0] o.gif","ced756a47d160c581e57027bd62459333177d44f7f2dbaff5994103112e25bc1"),
            ("-size 3x4 a.gif[1] -flop o.png","9fbef3cccab335666b189a5c410bc1a15a30a4ef6b753e46f73b5835175b018f"),
            ("-size 3x4 a.gif[-1] o.gif","5bd9b0d504dc721ebce2253ff1ae91f8a5ec74bc4b6950f1c5a4a93253da9903"),
            ("-size 3x4 a.gif[1,0,1] -flop o.png","9fbef3cccab335666b189a5c410bc1a15a30a4ef6b753e46f73b5835175b018f"),
            ("-size 3x4 a.gif[2-0] o.gif","f24e76fd844e5ce005439e725b20077d5ffbcb8e6aef0924588d617b886e216c"),
            ("-size 3x4 a.gif[2x3!] -flop o.png","63abc1ecd3aae1b97d2603457f9801a1f3e5ae1e01deb9749ef2d3590c7c9f6d"),
            ("-size 3x4 a.gif[2x1+1+1] o.gif","60386cd6868c95d289159314b46a71ba4f24e67ae43fcc6269d51cad8a3568f5"),
            ("-size 3x4 a.gif[2x1-1-2] o.gif","3244649848df61f135a2d0b6b636393693987b002cd1edb1c787bfb415293b76"),
            ("-size 3x4 p.png[1,0,1] o.gif","f381ef1094235814ef68ee557f1bff625d5530810deef146d59ce01ab4453eef"),
            ("-size 3x4 xc:red[2x3!] -flop o.png","5113afd9d08da0b2e993d8ea14ee3076d32483bac1edaea9519dce2f96cba92c"),
            ("-size 3x4 gradient:blue-yellow[1,0,1] -flop o.png","23ddd41c6210ed93851ddad4660d88cdcd203ed41eb1dd54ae429d39d162e3ee"),
            ("-size 3x4 gradient:blue-yellow[notgeometry] o.gif","af0a0013d43b114cc729612902b3bb4c7f73189a7d14db417d6121bfd7b21b16")
        ] {
            assert_eq!(run(cmd).exit_code,0,"{cmd}");
            let path=format!("/{}",cmd.split_whitespace().last().unwrap());
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&path).unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn convert_edits_the_scene_stack_in_argument_order() {
        let fs=MemoryVfs::new();
        let run=|s:&str|cmd_media_doc("convert",&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        for (cmd,hash) in [
            ("xc:red xc:blue xc:none -reverse out.gif","76d364b242a76a192d4c032e4b18d970cea29e063e73c1c84405b41437bd1e15"),
            ("xc:red xc:blue xc:none +swap out.gif","b661f8b79f076a2939962d5b257427bc7258f288563bed2bb066e1d01d016172"),
            ("xc:red xc:blue xc:none -swap 0.5,0 out.gif","3ea7e266185e58e9ec3952f8dea3311aa230a569e836eb0faf755280277c336d"),
            ("xc:red xc:blue xc:none +insert out.gif","e23a48348e6bdd927ad16cc14cb242437f77a7edac8681ec8f349f2fb27e431c"),
            ("xc:red xc:blue xc:none +delete out.gif","d5244bf69a2dd7254775dd7d967592d7beec04b27faa276089a2b5aaaaf15a1a"),
            ("xc:red xc:blue xc:none -delete 0-1 out.gif","32038505046f36ef2cebc3ecbaef19a522149ed17824089949d0aec2d980e22d"),
            ("xc:red xc:blue xc:none -clone 2-0,-1,99 out.gif","d040605bbc5a6ec603f327cbb91ebd185fbbb59276303659ecffbf1fd65843cc"),
            ("xc:red xc:blue xc:none -duplicate 2,1-0 out.gif","e8f6dec8f2d39c80a704bb3d0e0e1f9bc966c6bb9e1b4662a7a13eb9e7ed84f4"),
            ("xc:red xc:blue xc:none -reverse -append out.gif","d26b8392994d6f81213dccbf73f2c846f475e7969851eba1af2d6e3137ae13b4")
        ] {
            assert_eq!(run(cmd).exit_code,0,"{cmd}");
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.gif").unwrap())),hash,"{cmd}");
        }
        let invalid=run("xc:white -rotate bad +delete xc:red bad.gif");
        assert_eq!(invalid.stderr,"magick: Invalid rotation angle\n");
        assert!(!fs.exists("/bad.gif"));
        let empty=run("xc:red +delete empty.gif");
        assert_eq!(empty.stderr,"magick: no images defined 'empty.gif'\n");
        assert!(!fs.exists("/empty.gif"));
    }

    #[test]
    fn convert_splits_images_into_numbered_outputs_and_preserves_existing_files() {
        let fs=MemoryVfs::new();
        let run=|s:&str|cmd_media_doc("convert",&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        fs.write_file("/scene.png",b"keep").unwrap();
        assert_eq!(run("xc:red xc:blue +adjoin scene.png").exit_code,0);
        assert_eq!(fs.read_file("/scene.png").unwrap(),b"keep");
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/scene-1.png").unwrap())),"1ea0744618f48e903fd693d5638c86fb07181cdb4ac46c90067aa5285740dbc8");
        assert_eq!(run("xc:red xc:blue o%d-%02d.png").exit_code,0);
        assert!(fs.exists("/o%d-00.png"));
        assert!(!fs.exists("/o%d-%02d.png"));
        assert_eq!(run("xc:red only%02d.png").exit_code,0);
        assert!(fs.exists("/only%02d.png"));
        assert_eq!(cmd_media_doc("ffmpeg",&media_args(&["-f","lavfi","-i","testsrc=s=3x2:r=5:d=0.5","a.gif"]),"","/",&fs).exit_code,0);
        let before=fs.read_file("/a.gif").unwrap();
        assert_eq!(cmd_media_doc("mogrify",&media_args(&["+adjoin","a.gif"]),"","/",&fs).exit_code,0);
        assert_eq!(fs.read_file("/a.gif").unwrap(),before);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/a-2.gif").unwrap())),"807103500cec4195ebd528d763644a27a6b56702a3700953874e1153293bf74e");

    }

    #[test]
    fn magick_joins_mixed_gif_scenes_and_keeps_first_image_timing() {
        let fs=MemoryVfs::new();
        let run=|cmd,s:&str|cmd_media_doc(cmd,&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 4x2 gradient:red-blue in.png").exit_code,0);
        assert_eq!(run("ffmpeg","-f lavfi -i testsrc=s=3x2:r=5:d=0.5 a.gif").exit_code,0);
        for (cmd,hash) in [
            ("xc:red xc:blue o.gif","d5244bf69a2dd7254775dd7d967592d7beec04b27faa276089a2b5aaaaf15a1a"),
            ("in.png -negate -size 2x3 gradient:red-blue o.gif","95802f2cf6725fbe9d6765b4e652cb7a5f174e5b5e2155947a9845ed40a9b552"),
            ("in.png -negate -size 2x3 gradient:red-blue o.png","3735f381d92ce01060f71e1eab0f90e7c5e8afd684178a2ac565009916a3ba7d"),
            ("a.gif in.png o.gif","7119221bfa97dec29789e5be0444037148e0a24508907a567db321b59bdaa2a2"),
            ("in.png a.gif o.gif","961d9812234bb771f31611a9131b5aa188c8a533fbfe765fb415db202f51a964"),
            ("-append a.gif -loop 3 -delay 19 o.gif","069970519fb9d0901e3a41114979712ec26c2b84e927dbd3aff32efad55584ca"),
            ("a.gif +append in.png o.gif","56f422fd1e57e58e167ca29cefda01e767defd71c5cd866fb820c83134167323"),
            ("in.png -append a.gif o.gif","961d9812234bb771f31611a9131b5aa188c8a533fbfe765fb415db202f51a964"),
            ("a.gif -extent 4x3 in.png o.gif","15875119fbfaea252ba08ee117d2471c75cedad66a05be191c0de08d3565f938")
        ] {
            assert_eq!(run("convert",cmd).exit_code,0,"{cmd}");
            let path=format!("/{}",cmd.split_whitespace().last().unwrap());
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&path).unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_appends_real_canvas_file_and_animated_pixels_in_stack_order() {
        let fs=MemoryVfs::new();
        let run=|cmd,s:&str|cmd_media_doc(cmd,&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("convert","-size 4x2 gradient:red-blue in.png").exit_code,0);
        assert_eq!(run("ffmpeg","-f lavfi -i testsrc=s=3x2:r=5:d=0.5 a.gif").exit_code,0);
        for (cmd,hash) in [
            ("-size 3x2 xc:red -size 2x3 xc:blue -append o.png","7a7ac43a8ba70f3290a3ecae96b5c3e432ef0142979836e1f235ec99c613f3df"),
            ("-size 3x2 xc:red -size 2x3 xc:blue -background none -gravity southeast +append o.png","c83d1712b27d2df86ccdf3248f04e8da36a957626ec21543d26a71546196aa50"),
            ("-size 3x2 xc:red -size 2x3 xc:blue -append -negate o.png","30317c9b82302058a2042ac3efe7cb287952917de88b9dd58381fa3d9c5a48eb"),
            ("xc:none in.png -background #12345670 -gravity center -append o.png","a7b7ea0dd9dd9cf6f49202b97933e8f0372df811bc3fcb184594a66124e6c892"),
            ("in.png -negate -size 2x3 gradient:red-blue -append o.png","e18d6f4bd8e504025d6d50325629d49220b0939db3d77c9866e78f84b28fc421"),
            ("in.png -negate -size 2x3 gradient:red-blue +append -resize 6x4! o.png","4d5c4f76ca92bc8cfd4135f3035db1959b8bf75a1726f3aff3e480f33d405e8f"),
            ("a.gif -append o.png","fc0cdabed6390fdc8721ebb31913a46e790085df3ffa6707580b9d55748c0aa9"),
            ("a.gif in.png -background none -gravity southeast +append o.png","4936c4e11d7a23d545e22f68e2c360d4d4779ed83fd4916c4d4b473828c45db8")
        ] {
            assert_eq!(run("convert",cmd).exit_code,0,"{cmd}");
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_applies_operators_to_existing_images_and_captures_canvas_size_at_read() {
        let fs=MemoryVfs::new();
        let run=|s:&str|cmd_media_doc("convert",&media_args(&s.split_whitespace().collect::<Vec<_>>()),"","/",&fs);
        assert_eq!(run("-size 4x2 gradient:red-blue in.png").exit_code,0);
        for (cmd,hash) in [
            ("-size 4x2 -negate in.png o.png","bfe8879ddb668559f4e7cfb6223d6940a4b9bbb590a6eb84caefaaa03049a0da"),
            ("-size 4x2 -negate in.png -negate o.png","ced44570a1eb54979d0c53837a2e9214c38840c2b5077ffa45a93574349dd816"),
            ("-size 3x2 xc:red -size 7x5 o.png","a7b4a29bcf61c9ede4a3eb7bfb3025b9adc96ace01098f5a091467d0a6e1e334")
        ] {
            assert_eq!(run(cmd).exit_code,0);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_writes_requested_gif_delay_and_loop_count() {
        let fs=MemoryVfs::new();
        let gen_cmd=media_args(&["-f","lavfi","-i","testsrc=s=4x3:r=8:d=0.5","a.gif"]);
        assert_eq!(cmd_media_doc("ffmpeg",&gen_cmd,"","/",&fs).exit_code,0);
        for (cmd,hash) in [
            ("-size 2x1 xc:red -delay 4 out.gif","f5ab99e0bed21fe23859175a9582c3ffdac56b5486d7487131c9e8f42d334d06"),
            ("-size 2x1 xc:red -loop 3 out.gif","bd06d5d7c7e4496386f7f7cb1a2e983f831eff59d06e2ad50b0114cf29b7d4ee"),
            ("a.gif -delay 4 out.gif","c328850d111bfaeb0a5425cfe64920ad59967185646eee1073edca6afec40b78"),
            ("a.gif -loop 0 -delay 1.5 out.gif","fa63f21bb31dabfeda2a8eaf2ba76cdc1845f0e89aeb7660e98901cc151b118f"),
            ("a.gif -delay 12.7 -loop 3.9 out.gif","a1e162e2ddc0dfa2bdeb1e33fc77ddaf7a4250d6f8b97e281c458da5b67c6bea"),
            ("a.gif -loop 65537 -delay 65537 out.gif","a2400d80bc4a5d6a8f3060b8e3b7c23cbcf014f3407a2b6e9c54381ac28c8e21"),
            ("a.gif -loop 2 -loop 1 out.gif","2ea300b9420b4a02d4ebc5bb83a45ebdbf430bf4a5d1cfe52dd4b64cd4e2d48f"),
            ("a.gif -extent 6x3 -delay 4 out.gif","490733a7edb2f2f8d2c29bb1e3ed474f169c20ba97901373276b0995c9e75071"),
            ("-size 2x2 xc:none -loop 3 out.gif","ffe3ae903db1ee5b57d5fce93ffbec0db3e24846bbfa012e5d9753035e3d9782")
        ] {
            let args:Vec<_>=cmd.split_whitespace().collect();
            let r=cmd_media_doc("convert",&media_args(&args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{cmd}: {}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.gif").unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_alpha_modes_preserve_pixels_and_channel_layout() {
        let fs=MemoryVfs::new();
        fs.write_file("/input.ppm",b"P6\n2 1\n255\n\x12\x34\x56\x78\x99\x01").unwrap();
        for (src,mode,hash) in [
            ("input.ppm","off -extent 3x3 -alpha off","bd7d4469623f8e870a38bf300a9bf8209ed60c18f3aeff9741a9ebb84acebcae"),
            ("-size 2x1 xc:#12345678","remove","c8eca70711f16eab12e1a6da3c86e922de9620435e9a460aafd5ba9c685f43c6"),
            ("-size 2x1 xc:#12345678","off","0c238e60da2ad42895d2886473b18ae67526492d250bb2adf3ce7293e48d41cc"),
            ("-size 2x1 xc:#12345678","copy","647fb7ea3f3f9ef8bbff73498deda0c82c53bacd12565e471cf26bd691068ced"),
            ("-size 2x1 xc:#12345678","shape","5559648b1cfa69c24fb8190bf72fca05416329b9d183cc7521a4010e3052b277"),
            ("-size 2x1 xc:#12345678","extract","f161a406a4c6d64456c4f9c5aedb75dae31c8a6de02d9d582d42fdf44a90edf9"),
            ("-size 2x1 xc:#12345678","off -channel A -negate -alpha on","0c238e60da2ad42895d2886473b18ae67526492d250bb2adf3ce7293e48d41cc"),
            ("-size 2x1 xc:#12345678","copy -alpha extract","5cf67c847bc269ba3dc6c81e04c9f8985bb45cdeede2e2971d13581985510dc6"),
            ("input.ppm","shape","3e2010ca64903f06ecf50591899acaf9144bd8b75941f63fa3d83be99ec714e7"),
            ("-size 2x1 xc:#abc5 -colorspace gray","off","d73825746839179b7accc8259a5e4ffcc2f1d7d045b14a4f53ef66cd1d47d8b6")
        ] {
            let cmd=format!("{src} -background #38a4e080 -alpha {mode} out.png");
            let args:Vec<_>=cmd.split_whitespace().collect();
            let r=cmd_media_doc("convert",&media_args(&args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{cmd}: {}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),hash,"{cmd}");
        }
    }

    #[test]
    fn magick_negate_honors_channels_and_gray_only_selection() {
        let fs=MemoryVfs::new();
        fs.write_file("/a.gif",&hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021f904000a0000002c0000000003000200000809000108201060408180003b")).unwrap();
        for (options,hash) in [
            (&["-channel","R","-negate"][..],"795cc9a024e6a08a668d8b15ef1d990814ac3c216f05b74e7215a88c83ad0a45"),
            (&["-channel","Alpha","-negate"][..],"4b78289d6b1e3982e7220ee7be36e4d23d26d99023767451055efed4e3129040"),
            (&["-channel","R","-negate","+channel","-negate"][..],"169eede7a6cebfc4a6660c19047a1b1285354bea16a7d72fb61cde8ae85ebfb7"),
            (&["-colorspace","gray","+negate"][..],"3970752a1ed3680060c7c23da907715b2c1f50fd61ab0b2d5aae83a333def392"),
            (&["-channel","B","-negate","-colorspace","gray"][..],"8f696b0e910716fb831e32c29e952b28d36b04588bbe49250016c7edb8b56efb")
        ] {
            let args=[&["a.gif"][..],options,&["o.png"]].concat();
            let r=cmd_media_doc("convert",&media_args(&args),"","/",&fs);
            assert_eq!(r.exit_code,0,"{options:?}: {}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.png").unwrap())),hash,"{options:?}");
        }
    }

    #[test]
    fn magick_flops_the_decoded_pixels_of_a_paletted_gif() {
        let fs = MemoryVfs::new();
        fs.write_file("/input", &hex_dec("4749463839610300020082000000458a11569bdd2267ee3378baff44cb105500000000000021f904000a0000002c0000000003000200000809000108201060408180003b")).unwrap();
        let run=cmd_media_doc("convert",&media_args(&["input","-flop","out.png"]),"","/",&fs);
        assert_eq!(run.exit_code,0);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())), "a9813cc45c00b08d82c43b3bfd46883a4bba33db871d7f1488bcf5183dd9cf19");
    }

    #[test]
    fn magick_encodes_gif_palette_transparency_and_lzw_subblocks() {
        let fs = MemoryVfs::new();
        for (size, canvas, digest) in [
            ("65x33","gradient:red-blue","0a9f5db6b62bd223ef7f65f7c72676fbaeacc7597df72ca1d8b65b36e56b6098"),
            ("4x3","xc:transparent","9f3e30cb67a4fe96b1f40aba568af529972cadc19212b4646b234b28dcad59ff"),
        ] {
            let run=|name,args:&[&str]|cmd_media_doc(name,&media_args(args),"","/",&fs);
            assert_eq!(run("convert",&["-size",size,canvas,"GIF:frame"]).exit_code,0);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/frame").unwrap())),digest);
            assert_eq!(run("identify",&["-format","%m %wx%h %[channels]","frame"]).stdout,format!("GIF {size} srgba"));
        }
    }

    #[test]
    fn magick_encodes_webp_pixels_and_reads_their_geometry_without_an_extension() {
        let fs = MemoryVfs::new();
        for (size, canvas, info, digest) in [
            ("7x5", "xc:red", "WEBP 7 5 srgb", "6d45b06fdf7d4e1595e9bc9aa46e4b3bcf82d98a3b29cd67ee3732eeb5d3492b"),
            ("4x3", "xc:transparent", "WEBP 4 3 srgba", "e0217f06f68d64558b20b47efea87689e9697ee430027d039c8a193190e36a1b"),
        ] {
            let cmd = |name, args: &[&str]| cmd_media_doc(name, &media_args(args), "", "/", &fs);
            assert_eq!(cmd("convert", &["-size", size, canvas, "WEBP:frame"]).exit_code, 0);
            let bytes = fs.read_file("/frame").unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&bytes)), digest);
            assert_eq!(cmd("identify", &["-format", "%m %w %h %[channels]", "frame"]).stdout, info);
        }
    }

    #[test]
    fn magick_encodes_jpeg_with_the_requested_quality() {
        let fs=MemoryVfs::new();
        let run=|args:&[&str]| assert_eq!(cmd_media_doc("convert",&media_args(args),"","/",&fs).exit_code,0);
        run(&["-size","7x5","xc:red","a.png"]);
        for (quality,expected) in [("35","deb751e6dfd9dea608baf38cec494084985eebe96c29538c3eb7c3dc64ba3950"),("66.7","e6c41ddca922d73758fc5906eed10150bf01165466a2e0bcd123ea009e65e2d7"),("bogus","dae4ecf44407349b6baa0d480eaf26487334a07b55219525530d03e57a004f94")] {
            run(&["a.png","-flop","-quality",quality,"JPEG:o.bin"]);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/o.bin").unwrap())),expected);
        }
    }

    #[test]
    fn magick_publishes_transformed_pixels_in_the_requested_image_format() {
        let fs=MemoryVfs::new();
        let run=|dest:&str| cmd_media_doc("convert",&media_args(&["-size","7x5","xc:red","-negate",dest]),"","/",&fs);
        let out = run("ppm:-");
        let expected=[b"P6\n7 5\n255\n".as_slice(),&[0u8,255,255].repeat(35)].concat();
        assert_eq!(crate::vfs::stream_string_to_bytes(&out.stdout),expected);
        for (dest,head) in [("PBM:bits",b"P4\n7 5\n".as_slice()),("photo.pgm",b"P5\n7 5\n255\n"),("photo.bmp",b"BM"),("photo.tiff",b"II*\0")] {
            assert_eq!(run(dest).exit_code,0);
            assert!(fs.read_file(&format!("/{}",dest.split(':').next_back().unwrap())).unwrap().starts_with(head));
        }
        assert_eq!(fs.read_file("/bits").unwrap(),[b"P4\n7 5\n".as_slice(),&[0;5]].concat());
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/photo.tiff").unwrap())),"cfa9769ebaf020dcc1d7af99f9e1714f806b875e9bd406451011c9c54a65ec4d");
    }

    #[test]
    fn convert_flops_the_actual_pixels_from_a_portable_pixmap() {
        let fs = MemoryVfs::new();
        fs.write_file("/a.ppm", b"P3\n2 1\n1\n1 0 0 0 1 0").unwrap();
        let result = cmd_media_doc("convert", &media_args(&["a.ppm","-flop","out.png"]), "", "/", &fs);
        assert_eq!((result.exit_code, result.stderr), (0, String::new()));
        let bytes = fs.read_file("/out.png").unwrap();
        assert_eq!(hex_enc(&sha256_bytes(&bytes)), "187fb90a90256b4e020a3bb214c4cac818695c75c1b1d161ef5efc7c40d20264");
    }

    #[test]
    fn sips_inspection_without_a_requested_edit_never_rewrites_the_file() {
        let fs = MemoryVfs::new();
        let png = pixel_png(2, 1, PngEncoding::Density(72), |x,_| [x as u8, 2, 3]);
        fs.write_file("/photo.png", &png).unwrap();
        let run = |args: &[&str]| cmd_media_doc("sips", &media_args(args), "", "/", &fs);
        assert_eq!(run(&["photo.png"]).exit_code, 0);
        assert_eq!(fs.read_file("/photo.png").unwrap(), png);
        fs.write_file("/broken", b"broken").unwrap();
        let result = run(&["--verify", "broken", "photo.png"]);
        assert_eq!(result.exit_code, 1);
        assert_eq!(result.stdout, "photo.png\n");
        assert_eq!(result.stderr, "Error: broken: Input buffer contains unsupported image format\n");
        assert_eq!(fs.read_file("/broken").unwrap(), b"broken");
    }

    #[test]
    fn sips_property_edits_preserve_pixels_and_store_deletions_in_the_png() {
        let fs = MemoryVfs::new();
        let png = pixel_png(2, 1, PngEncoding::Density(72), |x,_| [10 + x as u8, 20, 30]);
        fs.write_file("/photo.png", &png).unwrap();
        let run = |args: &[&str]| cmd_media_doc("sips", &media_args(args), "", "/", &fs);
        let result = run(&["-s", "artist", "Ada", "-s", "dpiWidth", "144.2", "--out", "tagged", "photo.png"]);
        assert_eq!(result.stdout, "photo.png\n  tagged\n");
        assert_eq!(fs.read_file("/photo.png").unwrap(), png);
        let result = run(&["-d", "artist", "tagged"]);
        assert_eq!(result.exit_code, 0);
        let tagged = fs.read_file("/tagged").unwrap();
        let raster = png_pixels::Raster::decode(&tagged, 1024).unwrap();
        assert_eq!(raster.pixels, [[10, 20, 30, 255], [11, 20, 30, 255]]);
        assert_eq!(raster.density, 144);
        let payload = br#"[["artist",null],["dpiWidth","144.200"]]"#;
        assert!(tagged.windows(payload.len()).any(|w| w == payload));
    }

    #[test]
    fn sips_applies_resize_before_rotation_and_only_keeps_the_last_crop_or_pad() {
        let fs = MemoryVfs::new();
        let png = pixel_png(2, 1, PngEncoding::Density(72), |x, _| [if x==0 {0} else {255}, 0, 0]);
        fs.write_file("/photo.png", &png).unwrap();
        let result = cmd_media_doc("sips", &media_args(&["-p", "20", "20", "-r", "90", "-z", "1", "2", "-c", "2", "1", "photo.png"]), "", "/", &fs);
        assert_eq!(result.exit_code, 0);
        let bytes = fs.read_file("/photo.png").unwrap();
        let image = png_pixels::Raster::decode(&bytes, 1024).unwrap();
        assert_eq!((image.width, image.height), (1, 2));
        assert_eq!(image.pixels, [[0,0,0,255], [255,0,0,255]]);
    }

    #[test]
    fn sips_exports_the_rgb_samples_and_rejects_properties_that_cannot_be_stored() {
        let fs = MemoryVfs::new();
        let png = pixel_png(2, 1, PngEncoding::Density(72), |x,_| [10+x as u8,20,30]);
        fs.write_file("/photo.png", &png).unwrap();
        let run = |args: &[&str]| cmd_media_doc("sips", &media_args(args), "", "/", &fs);
        let failed = run(&["-s","format","ppm","-s","artist","Ada","photo.png"]);
        assert_eq!(failed.exit_code, 1);
        assert_eq!(fs.read_file("/photo.png").unwrap(), png);
        assert_eq!(run(&["-s","format","ppm","photo.png"]).exit_code, 0);
        assert_eq!(fs.read_file("/photo.png").unwrap(), b"P6\n2 1\n255\n\x0a\x14\x1e\x0b\x14\x1e");
    }

    #[test]
    fn sips_reads_embedded_itxt_properties_and_rejects_a_truncated_chunk() {
        let fs = MemoryVfs::new();
        let mut png = pixel_png(1, 1, PngEncoding::Density(72), |_, _| [1,2,3]);
        let data = b"safe-bash-sips\0\0\0\0\0[[\"artist\",\"Ada\"],[\"dpiWidth\",\"145.000\"]]";
        let mut chunk = (data.len() as u32).to_be_bytes().to_vec();
        chunk.extend_from_slice(b"iTXt");
        chunk.extend_from_slice(data);
        chunk.extend_from_slice(&[0;4]);
        png.splice(33..33, chunk);
        fs.write_file("/tag.png", &png).unwrap();
        let run = || cmd_media_doc("sips", &media_args(&["-1","-g","artist","-g","dpiWidth","tag.png"]), "", "/", &fs);
        assert_eq!(run().stdout, "tag.png|artist: Ada|dpiWidth: 145.000|\n");
        fs.write_file("/tag.png", &png[..35+data.len()]).unwrap();
        assert_eq!(run().stderr, "Error: tag.png: Invalid PNG metadata chunk\n");
    }

    #[test]
    fn identify_and_sips_read_cmyk_jpeg_dimensions_and_jfif_density() {
        let fs = MemoryVfs::new();
        let jpeg = b"\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\x02\0\x76\0\x76\0\0\xff\xc2\0\x14\x08\0\x05\0\x08\x04\0\0\0\0\0\0\0\0\0\0\0\0\xff\xd9";
        fs.write_file("/x", jpeg).unwrap();
        let r = cmd_media_doc("identify", &media_args(&["-format","%m %wx%h %x %[channels]","x"]), "", "/", &fs);
        assert_eq!(r.stdout, "JPEG 8x5 300 cmyk");
        let r = cmd_media_doc("sips", &media_args(&["-1","-g","space","-g","hasAlpha","-g","samplesPerPixel","x"]), "", "/", &fs);
        assert_eq!(r.stdout, "x|space: CMYK|hasAlpha: no|samplesPerPixel: 4|\n");
    }

    #[test]
    fn sips_carries_exif_orientation_across_png_and_jpeg_without_rotating_pixels() {
        let fs=MemoryVfs::new();
        let mut png=pixel_png(2,1,PngEncoding::Density(72),|_,_|[12,56,78]);
        let tiff=b"MM\x00\x2a\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01\0\x06\0\0\0\0\0\0";
        let mut chunk=(tiff.len() as u32).to_be_bytes().to_vec();
        chunk.extend_from_slice(b"eXIf");chunk.extend_from_slice(tiff);
        chunk.extend_from_slice(&crc32_ieee(&chunk[4..]).to_be_bytes());
        png.splice(33..33,chunk);
        fs.write_file("/source.png",&png).unwrap();
        let run=|args:&[&str]|cmd_media_doc("sips",&media_args(args),"","/",&fs);
        assert_eq!(run(&["-s","format","jpeg","source.png","--out","out.jpg"]).exit_code,0);
        let jpeg=fs.read_file("/out.jpg").unwrap();
        assert!(jpeg.windows(6).any(|b| b==b"Exif\0\0"));
        assert_eq!(run(&["-s","format","png","out.jpg","--out","out.png"]).exit_code,0);
        let bytes=fs.read_file("/out.png").unwrap();
        let offset=bytes.windows(4).position(|b| b==b"eXIf").unwrap()+4;
        assert_eq!(&bytes[offset+18..offset+20], &[6,0]);
        let raster=png_pixels::Raster::decode(&bytes,1024).unwrap();
        assert_eq!((raster.width,raster.height),(2,1));
    }

    #[test]
    fn identify_and_sips_read_png_density_channels_and_transparency() {
        let fs = MemoryVfs::new();
        let png = pixel_png(2, 1, PngEncoding::Density(300), |x, _| if x == 0 { [0,0,0,255] } else { [255,255,255,0] });
        fs.write_file("/x.png", &png).unwrap();
        let r = cmd_media_doc("sips", &media_args(&["-1","-g","dpiWidth","-g","hasAlpha","-g","samplesPerPixel","x.png"]), "", "/", &fs);
        assert_eq!(r.stdout, "x.png|dpiWidth: 300.000|hasAlpha: yes|samplesPerPixel: 4|\n");
        let r = cmd_media_doc("identify", &media_args(&["-verbose","x.png"]), "", "/", &fs);
        assert!(r.stdout.contains("  Resolution: 300x300\n"));
        assert!(r.stdout.contains("  Channels: 4\n  Alpha: True\n"));
        assert!(r.stdout.ends_with("  Entropy: 1.0000\n"));
    }

    #[test]
    fn identify_reads_piped_pixels_and_normalizes_prefixed_scene_names() {
        let fs = MemoryVfs::new();
        let ppm = "P3\n2 1\n1\n1 0 0 0 1 0";
        fs.write_file("/a.bin", ppm.as_bytes()).unwrap();
        let run = |name: &str, input: &str| cmd_media_doc("identify", &media_args(&["-format","%i|%s|%m|%wx%h",name]), input, "/", &fs);
        assert_eq!(run("png:a.bin[04]", "").stdout, "a.bin|4|PPM|2x1");
        assert_eq!(run("ppm:-", ppm).stdout, "-|0|PPM|2x1");
        let unknown = run("-", "junk");
        assert_eq!((unknown.exit_code, unknown.stderr.as_str()), (1,"identify: improper image header '-': Input buffer contains unsupported image format\n"));
    }

    #[test]
    fn identify_only_expands_properties_in_the_original_format() {
        let fs = MemoryVfs::new();
        fs.write_file("/%[depth]%b.ppm", b"P3\n1 1\n1\n1 0 0").unwrap();
        let r = cmd_media_doc("identify", &media_args(&["-format", r"%i|%[WIDTH]|\%w|%[missing:%m]|%[unclosed %w", "%[depth]%b.ppm"]), "", "/", &fs);
        assert_eq!(r.stdout, "%[depth]%b.ppm|1|%w|%[missing:%m]|%[unclosed %w");
    }

    #[test]
    fn identify_reads_pixmap_geometry_and_entropy_from_the_image() {
        let fs = MemoryVfs::new();
        fs.write_file("/in.bin", b"P3\n2 1\n1\n1 0 0 0 1 0").unwrap();
        let run = |args: &[&str]| cmd_media_doc("identify", &media_args(args), "", "/", &fs).stdout;
        assert_eq!(run(&["in.bin"]), "in.bin PPM 2x1 2x1+0+0 8-bit sRGB 20B 0.000u 0:00.000\n");
        assert_eq!(run(&["-format", "%m %wx%h %[channels]", "in.bin"]), "PPM 2x1 srgb");
        assert!(run(&["-verbose", "in.bin"]).ends_with("  Channels: 3\n  Alpha: False\n  Filesize: 20B\n  Entropy: 1.0000\n"));
    }

    #[test]
    fn sips_reports_precision_and_color_space_from_graymap_data() {
        let fs = MemoryVfs::new();
        fs.write_file("/gray.bin", b"P5\n# size\n3 2\n4095\n").unwrap();
        let r = cmd_media_doc("sips", &media_args(&["-1","-g","pixelWidth","-g","pixelHeight","-g","format","-g","space","-g","bitsPerSample","-g","samplesPerPixel","gray.bin"]), "", "/", &fs);
        assert_eq!(r.stdout, "gray.bin|pixelWidth: 3|pixelHeight: 2|format: pgm|space: Gray|bitsPerSample: 16|samplesPerPixel: 1|\n");
    }

    #[test]
    fn sips_allxml_emits_typed_properties_and_escapes_the_filename() {
        let fs = MemoryVfs::new();
        fs.write_file("/a&b.png", &pixel_png(2, 1, PngEncoding::Density(72), |_, _| [1,2,3])).unwrap();
        let r = cmd_media_doc("sips", &media_args(&["-g","allxml","a&b.png"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0);
        assert!(r.stdout.contains("  <key>samplesPerPixel</key>\n  <integer>3</integer>"));
        assert!(r.stdout.contains("  <key>dpiHeight</key>\n  <real>72</real>"));
        assert!(r.stdout.contains("  <key>hasAlpha</key>\n  <false/>"));
        assert!(r.stdout.ends_with("  <key>path</key>\n  <string>a&amp;b.png</string>\n</dict>\n</plist>\n"));
    }

    #[test]
    fn magick_transforms_pixel_coordinates_in_command_order() {
        let fs = gradient_png_pair();
        for (args, hash) in [
            ("b.png -rotate 90 out.png", "51ebe18206eb94fa0fa5b0a4b20b107e6bd4bd62010b89a5e1c510a88843cdbd"),
            ("b.png -rotate -14.5 out.png", "c9f1f602e785df26b922e3f36fb170a307151736c87f3a28bec140fafb57c56e"),
            ("b.png -gravity southeast -crop 4x3+1+1 out.png", "3e6a462e99e8f5e2425629205afc249dd4aded17a37532ac0a20da254e3290fe"),
            ("b.png -transpose -flop -crop 4x5+1+2 out.png", "6203eddc365430d502982e5334fe284500156ae92c2dd630f5599ed981baf4a0"),
            ("b.png -extent 16x20+2+4 out.png", "58af486ceb9bf473dd1293630c55a2ffb6ce474766b7893b567a664c637012db"),
            ("b.png -border 3x2 out.png", "9b380fbec70784cdd79168a12361faf7862cb219f0a7d9778e5501497760ec19"),
        ] {
            let args = media_args(&args.split_whitespace().collect::<Vec<_>>());
            let r = cmd_media_doc("magick", &args, "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())), hash, "{args:?}");
        }
    }

    #[test]
    fn resizing_pngs_resamples_pixels_with_the_selected_filter() {
        let fs = gradient_png_pair();
        for (name, kernel, size, hash) in [
            ("b.png", "nearest", "5x12!", "593b235eb2325999fbd54734fb3cedd8ff3f8928398b4acf1777537bc2cca9fa"),
            ("a.png", "mitchell", "7x2!", "b20c852161e64ea390ad05d6e97d965f061844191f6a0e007381cbb4fc0accd9"),
            ("b.png", "lanczos2", "23x17!", "ee3b14631a4c2e90c2b5a490d96aab0fffd626673148667bc6686f6a9899a8f2"),
            ("a.png", "lanczos3", "2x2", "c55a20582ed5b3a3eedcfe1e71a64b74af7665dc2bb318cc67bf087464d3ab14"),
        ] {
            let r = cmd_media_doc("magick", &media_args(&[name,"-filter",kernel,"-resize",size,"out.png"]), "", "/", &fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),hash,"{name} {kernel} {size}");
        }
    }

    #[test]
    fn montage_paints_png_tiles_with_borders_padding_and_transparency() {
        let fs = gradient_png_pair();
        for (args, hash) in [
            ("-geometry 6x7+2+1 a.png b.png out.png", "d541dddcb9fd5423bc0d7f7c77c5925b6310831308cf3166313da223fa3dcf78"),
            ("-tile x2 -border 2 -bordercolor none a.png b.png out.png", "062c8a936d7623b73a9be16b149bdd83ce3f19b67d56a435aedc2e512117dba6"),
            ("-gravity southeast -background none a.png b.png out.png", "ffb04487e1d64cd93fec6dc9d6c95ee57971861e830b59175f4463edb5ba29d1"),
        ] {
            let r = cmd_media_doc("montage", &media_args(&args.split_whitespace().collect::<Vec<_>>()), "", "/", &fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),hash,"{args}");
        }
    }

    #[test]
    fn composite_blends_and_clips_pixels_from_both_pngs() {
        let fs = gradient_png_pair();
        for (args, hash) in [
            ("-gravity center -geometry -3+2 b.png a.png out.png", "9d35ea3fc54e963c55bcfde93e5187845d75c76b8181e8caac93c9fd444ad8ec"),
            ("-dissolve 36x71 a.png b.png out.png", "cc5798df115b8f32c269be09cf2d9f12455be0605ef32ab344ff82f2030728b3"),
            ("-compose multiply b.png a.png out.png", "a046abb52bfd314a17e4158433aae2d73c0c69788b42a8e5b22bd946d715e52e"),
        ] {
            let r = cmd_media_doc("composite", &media_args(&args.split_whitespace().collect::<Vec<_>>()), "", "/", &fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())),hash,"{args}");
        }
    }

    #[test]
    fn compare_measures_alpha_and_missing_pixels_in_production_pngs() {
        let fs = gradient_png_pair();
        let r = cmd_media_doc("compare", &media_args(&["-metric", "MAE", "a.png", "b.png", "diff.png"]), "", "/", &fs);
        assert_eq!(r.exit_code, 1);
        assert_eq!(r.stderr, "34700.969532 (0.529503)\n");
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/diff.png").unwrap())), "9e143216e78f79c42afa796024db6ace525dd2a37723ea9dfc258754066f253f");
    }

    #[test]
    fn grayscale_png_preserves_alpha_and_operator_order() {
        let fs = MemoryVfs::new();
        for (operators, hash) in [
            ("-colorspace gray", "ade7f1024157bb0d84bc2e5d7902327897f1d83d628dced156782ff208e68f45"),
            ("-colorspace grey", "ade7f1024157bb0d84bc2e5d7902327897f1d83d628dced156782ff208e68f45"),
            ("-negate -colorspace gray", "4927c66dbc586ff2a0a3b40ad74eeb167cfa56941336a8aa2ee0e95bfb818c68"),
            ("-colorspace gray -negate", "958d93800f6bf3aef244645798eef9b3b06777b7908ba583d3a156869742e8f3"),
        ] {
            let mut args = vec!["-size", "12x8", "xc:#27881e66"];
            args.extend(operators.split_whitespace());
            args.push("gray.png");
            let r = cmd_media_doc("magick", &media_args(&args), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/gray.png").unwrap())), hash, "{operators}");
        }
    }

    #[test]
    fn magick_renders_gradients_patterns_and_null_pixels() {
        let fs = MemoryVfs::new();
        for (size, source, hash) in [
            ("4x3", "gradient:red-blue", "f8f2fd4b2f29cc6859667d77812130d85c838fa393ed6a4911fb7d3248fb7378"),
            ("19x17", "radial-gradient:red-blue", "aa8f49a87097068e50627b7860fc9588709ce7082dc9de3ef94250e47a6214c6"),
            ("33x5", "pattern:checkerboard", "d3abdb6d739a01fef321f8de5eb116f1ddf3d64398a99b5e04905e4987cd8c08"),
            ("33x5", "plasma:", "d3abdb6d739a01fef321f8de5eb116f1ddf3d64398a99b5e04905e4987cd8c08"),
            ("4x3", "null:", "41674c6de947204678be16c5a89b95251a6a23c438836b20d0e6d23112c9d7e9"),
        ] {
            let r = cmd_media_doc("magick", &media_args(&["-size", size, source, "image.png"]), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/image.png").unwrap())), hash, "{source}");
        }
    }

    #[test]
    fn magick_writes_rgba_canvas_png_and_rejects_bad_colors() {
        let fs = MemoryVfs::new();
        for command in ["convert", "magick"] {
            let run = |args: &[&str]| cmd_media_doc(command, &media_args(args), "", "/", &fs);
            let result = run(&["-size", "5x7", "canvas:#12345678", "canvas.png"]);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let png = fs.read_file("/canvas.png").unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&png)), "2f470f13880056e4a01b56979c0aefaaa893897ffb15ee40d5d52268209d8645");
            let result = run(&["xc:notacolor", "canvas.png"]);
            assert_eq!(result.exit_code, 1);
            assert_eq!(result.stderr, "magick: Unable to parse color from string: notacolor\n");
            assert_eq!(fs.read_file("/canvas.png").unwrap(), png);
        }
    }

    #[test]
    fn qr_structured_append_stops_at_failed_output() {
        let fs = MemoryVfs::new();
        fs.mkdir_all("/block-02.png").unwrap();
        let data = "0123456789".repeat(10);
        let args = media_args(&["-S","-v","1","-l","H","-o","block.png",&data]);
        let result = cmd_media_doc("qrencode", &args, "", "/", &fs);
        assert_eq!((result.exit_code,result.stderr.as_str()),(1,"qrencode: EISDIR: illegal operation on a directory, writeFile '/block-02.png'\n"));
        assert!(fs.read_file("/block-01.png").unwrap().starts_with(b"\x89PNG"));
        assert!(fs.is_dir("/block-02.png"));
        assert!(!fs.exists("/block-03.png"));
    }

    #[test]
    fn qr_png_carries_colored_modules_and_physical_resolution() {
        let fs = MemoryVfs::new();
        let args = media_args(&["-t", "PNG32", "-m", "0", "-s", "1", "-d", "300", "--foreground=10203040", "--background=ffeecc99", "-o", "qr.png", "Hello"]);
        assert_eq!(cmd_media_doc("qrencode", &args, "", "/", &fs).exit_code, 0);
        let png = fs.read_file("/qr.png").unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let mut chunks = BTreeMap::new();
        let mut rest = &png[8..];
        while !rest.is_empty() {
            let len = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
            assert_eq!(crc32_ieee(&rest[4..8+len]), u32::from_be_bytes(rest[8+len..12+len].try_into().unwrap()));
            chunks.insert(&rest[4..8], &rest[8..8+len]);
            rest = &rest[12+len..];
        }
        assert_eq!(chunks[b"pHYs".as_slice()], &[0,0,46,35,0,0,46,35,1]);
        let (scanlines, _) = crate::commands::codecs::inflate_raw(&chunks[b"IDAT".as_slice()][2..]).unwrap();
        assert_eq!(hex_enc(&sha256_bytes(&scanlines)), "195c11634fdb5b6c77a09adbd17c51cceae73da5e70ee27164c290067a199b1f");
    }

    #[test]
    fn unit_media_qrencode_svgo_and_rsvg_convert() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/media").unwrap();

        let qr_ascii = cmd_media_doc(
            "qrencode",
            &media_args(&["-t", "ASCII", "-o", "-", "SAFE-BASH-QR"]),
            "",
            "/media",
            &vfs,
        );
        assert_eq!(qr_ascii.exit_code, 0);
        assert!(qr_ascii.stdout.contains("#"));

        let qr_svg = cmd_media_doc(
            "qrencode",
            &media_args(&["-t", "SVG", "-o", "/media/code.svg", "https://example.com"]),
            "",
            "/media",
            &vfs,
        );
        assert_eq!(qr_svg.exit_code, 0);
        assert!(vfs.exists("/media/code.svg"));

        let svgo = cmd_media_doc(
            "svgo",
            &media_args(&["/media/code.svg", "-o", "/media/min.svg"]),
            "",
            "/media",
            &vfs,
        );
        assert_eq!(svgo.exit_code, 0);
        assert!(vfs.exists("/media/min.svg"));

        let rsvg = cmd_media_doc(
            "rsvg-convert",
            &media_args(&["-f", "png", "-o", "/media/code.png", "/media/min.svg"]),
            "",
            "/media",
            &vfs,
        );
        assert_eq!(rsvg.exit_code, 0);
        assert!(vfs.read_file("/media/code.png").unwrap().starts_with(b"\x89PNG"));
    }

    fn classic_pdf(objects: &[&str], extra: &str) -> String {
        let mut pdf = String::from("%PDF-1.4\n");
        let mut xref = format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1);
        for (i, object) in objects.iter().enumerate() {
            xref.push_str(&format!("{:010} 00000 n \n", pdf.len()));
            pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
        }
        let offset = pdf.len();
        pdf.push_str(&xref);
        pdf.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R {extra} >>\nstartxref\n{offset}\n%%EOF", objects.len() + 1));
        pdf
    }

    #[test]
    fn exiftool_appends_pdf_info_without_losing_pages_or_previous_metadata() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 40 80] >>",
            "<< /Type /Page /Parent 2 0 R >>",
            "<< /Author (Ada) /Title (Original) >>",
        ], "/Info 4 0 R");
        fs.write_file("/doc.pdf", pdf.as_bytes()).unwrap();
        for title in ["New (title)", "日本語"] {
            let r = cmd_media_doc("exiftool", &media_args(&[&format!("-Title={title}"), "-overwrite_original", "doc.pdf"]), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            let updated = fs.read_file("/doc.pdf").unwrap();
            assert!(updated.starts_with(pdf.as_bytes()));
            let parsed = pdf_reader::read(&updated,"").unwrap().0;
            assert_eq!(parsed.title, title);
            assert_eq!(parsed.author, "Ada");
            assert_eq!(parsed.pages.len(), 1);
        }
    }

    #[test]
    fn pdffonts_lists_inherited_font_objects_on_selected_pages_without_text() {
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 300 400] /Resources << /Font << /A 5 0 R /Alias 5 0 R >> >> >>",
            "<< /Type /Page /Parent 2 0 R >>",
            "<< /Type /Page /Parent 2 0 R /Resources << /Font << /B 6 0 R >> >> >>",
            "<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+Arial /Encoding /WinAnsiEncoding /FontDescriptor << /FontFile2 8 0 R >> /ToUnicode 7 0 R >>",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        ], "");
        let fs = MemoryVfs::new();
        fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        let result = cmd_media_doc("pdffonts", &media_args(&["-loc", "-l", "1", "in.pdf"]), "", "/", &fs);
        assert_eq!(result.exit_code, 0);
        assert_eq!(result.stdout.lines().skip(2).collect::<Vec<_>>(), [
            "ABCDEF+Arial                         TrueType          WinAnsi          yes yes yes      5  0 Embedded"
        ]);
        let subst = cmd_media_doc("pdffonts", &media_args(&["-subst", "in.pdf"]), "", "/", &fs);
        assert_eq!(subst.stdout.lines().count(), 3);
        assert!(subst.stdout.ends_with("/NimbusMonoPS.t1\n"));
    }

    #[test]
    fn pdf_page_names_preserve_text_and_bound_numeric_padding() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 20 20] >>",
        ], "");
        fs.write_file("/test.pdf", pdf.as_bytes()).unwrap();
        let run = |cmd, args: &[&str]| cmd_media_doc(cmd, &media_args(args), "", "/", &fs);
        for pattern in ["%04097d.pdf", "%099999999999999999999999d.pdf"] {
            let r = run("pdfseparate", &["test.pdf", pattern]);
            assert_eq!((r.exit_code, r.stderr.as_str()), (1, "shell: line 1: internal error\n"));
        }
        assert_eq!(run("pdftk", &["test.pdf", "burst", "output", "p%4d.pdf"]).exit_code, 0);
        assert!(fs.exists("/p1.pdf"));
        assert_eq!(run("qpdf", &["--split-pages", "test.pdf", "é%%-%04d.pdf"]).exit_code, 0);
        assert!(fs.exists("/é%-0001.pdf"));
    }

    #[test]
    fn pdfseparate_copies_page_objects_and_excludes_unselected_content() {
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [4 0 R 3 0 R] /Count 2 /MediaBox [0 0 300 410] /Resources << /Font << /F1 7 0 R >> >> /Rotate 90 >>",
            "<< /Type /Page /Parent 2 0 R /Contents 6 0 R >>",
            "<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Annots [8 0 R] >>",
            "<< /Length 19 >>\nstream\nBT (selected) Tj ET\nendstream",
            "<< /Length 24 >>\nstream\nBT (excluded-page) Tj ET\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
            "<< /Type /Annot /Subtype /Link /P 4 0 R /Dest [3 0 R /Fit] >>",
        ], "");
        let fs = MemoryVfs::new();
        fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        let res = cmd_media_doc("pdfseparate", &media_args(&["-l", "1", "/in.pdf", "/page.pdf"]), "", "/", &fs);
        assert_eq!(res.exit_code, 0, "{}", res.stderr);
        let output = fs.read_file("/page.pdf").unwrap();
        let doc = pdf_reader::read(&output,"").expect("a standalone PDF with a working xref").0;
        assert_eq!(doc.pages.len(), 1);
        assert_eq!(doc.pages[0].text, "selected");
        assert_eq!(doc.pages[0].rot, 90);
        assert_eq!((doc.page_w, doc.page_h), (300., 410.));
        let raw = String::from_utf8_lossy(&output);
        assert!(raw.contains("/Courier") && raw.contains("/Annots"));
        assert!(!raw.contains("excluded-page"));
    }

    #[test]
    fn pdfunite_keeps_colliding_object_ids_separate_across_sources() {
        let fs = MemoryVfs::new();
        for (name, word) in [("a", "first"), ("b", "other")] {
            let stream = format!("<< /Length 16 >>\nstream\nBT ({word}) Tj ET\nendstream");
            let pdf = classic_pdf(&[
                "<< /Type /Catalog /Pages 2 0 R >>",
                "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 300 410] >>",
                "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
                "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
                &stream,
            ], "");
            fs.write_file(&format!("/{name}.pdf"), pdf.as_bytes()).unwrap();
        }
        let result = cmd_media_doc("pdfunite", &media_args(&["a.pdf", "b.pdf", "merged.pdf"]), "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/merged.pdf").unwrap();
        let doc = pdf_reader::read(&bytes,"").expect("merged PDF has a valid xref and page tree").0;
        assert_eq!(doc.pages.iter().map(|p| p.text.as_str()).collect::<Vec<_>>(), ["first", "first", "other", "other"]);
        assert_eq!(String::from_utf8_lossy(&bytes).matches("\nstream\n").count(), 2);
    }

    #[test]
    fn page_copy_commands_do_not_follow_output_symlinks() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>", "<< /Type /Page /Parent 2 0 R >>"], "");
        fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        fs.write_file("/existing", b"original").unwrap();
        fs.symlink("existing", "/link").unwrap();
        for (cmd, args, status) in [
            ("pdfseparate", media_args(&["in.pdf", "link"]), 99),
            ("pdfunite", media_args(&["in.pdf", "in.pdf", "link"]), 255),
        ] {
            let r = cmd_media_doc(cmd, &args, "", "/", &fs);
            assert_eq!((r.exit_code, r.stderr.as_str()), (status, "I/O Error: Couldn't open file 'link'\n"));
            assert_eq!(fs.read_file("/existing").unwrap(), b"original");
            assert_eq!(fs.readlink("/link").unwrap(), "existing");
        }
    }

    #[test]
    fn merge_wide_page_tree_with_shared_inherited_geometry() {
        let count = 1024;
        let kids = (3..count+3).map(|n| format!("{n} 0 R")).collect::<Vec<_>>().join(" ");
        let tree = format!("<< /Type /Pages /Count {count} /Kids [{kids}] /MediaBox [4 6 304 416] >>");
        let mut objects = vec!["<< /Type /Catalog /Pages 2 0 R >>", &tree];
        objects.resize(count + 2, "<< /Type /Page /Parent 2 0 R >>");
        let pdf = classic_pdf(&objects, "");
        let mut source = pdf_reader::PageSource::open(pdf.as_bytes(),"").unwrap();
        let mut dest = pdf_reader::PageOutput::new(1024*1024);
        dest.append(&mut source, None).expect("copy every page");
        let bytes = dest.finish().unwrap();
        let merged = pdf_reader::read(&bytes,"").unwrap().0;
        assert_eq!(merged.pages.len(), count);
        assert_eq!(merged.page_media[&count], (300., 410., Some([4., 6., 304., 416.])));
    }

    #[test]
    fn pdfunite_shifts_page_labels_from_indirect_number_trees() {
        let fs = MemoryVfs::new();
        for prefix in ["front", "back"] {
            let label = format!("<< /P ({prefix}) /St 4 /S /r >>");
            let pdf = classic_pdf(&[
                "<< /Type /Catalog /Pages 2 0 R /PageLabels 4 0 R >>",
                "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R >>",
                "<< /Kids [5 0 R] >>",
                "<< /Nums [0 6 0 R] >>",
                &label,
            ], "");
            fs.write_file(&format!("/{prefix}.pdf"), pdf.as_bytes()).unwrap();
        }
        let r = cmd_media_doc("pdfunite", &media_args(&["front.pdf", "back.pdf", "book.pdf"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0);
        let dump = cmd_media_doc("pdftk", &media_args(&["book.pdf", "dump_data_utf8"]), "", "/", &fs);
        for (index,prefix) in [(1,"front"),(2,"back")] {
            assert!(dump.stdout.contains(&format!("PageLabelNewIndex: {index}\nPageLabelStart: 4\nPageLabelPrefix: {prefix}\nPageLabelNumStyle: LowercaseRomanNumerals\n")), "{}", dump.stdout);
        }
    }

    #[test]
    fn pdfunite_preserves_embedded_files_and_keeps_the_first_duplicate() {
        let fs = MemoryVfs::new();
        for (path, name, data) in [("a","note.bin","first"),("b","more.bin","extra"),("c","note.bin","other")] {
            let spec = format!("<< /Type /Filespec /UF ({name}) /EF << /F 7 0 R >> >>");
            let stream = format!("<< /Type /EmbeddedFile /Length 5 >>\nstream\n{data}\nendstream");
            let pdf = classic_pdf(&[
                "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 4 0 R >> >>",
                "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R >>",
                "<< /Kids [5 0 R] >>",
                "<< /Names [(key) 6 0 R] >>",
                &spec,&stream,
            ], "");
            fs.write_file(&format!("/{path}.pdf"), pdf.as_bytes()).unwrap();
        }
        let r = cmd_media_doc("pdfunite", &media_args(&["a.pdf","b.pdf","c.pdf","book.pdf"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0);
        let bytes = fs.read_file("/book.pdf").unwrap();
        let raw = String::from_utf8_lossy(&bytes);
        assert!(raw.contains("/EmbeddedFiles"), "attachment name tree is missing");
        assert_eq!(raw.matches("/Type /EmbeddedFile\n").count(), 2);
        let list = cmd_media_doc("pdfdetach", &media_args(&["-list", "book.pdf"]), "", "/", &fs);
        assert_eq!(list.stdout, "2 embedded files\n1: note.bin\n2: more.bin\n");
        fs.mkdir_all("/saved").unwrap();
        let save = cmd_media_doc("pdfdetach", &media_args(&["-saveall", "-o", "/saved", "book.pdf"]), "", "/", &fs);
        assert_eq!(save.exit_code, 0, "{}", save.stderr);
        assert_eq!(fs.read_file("/saved/note.bin").unwrap(), b"first");
        assert_eq!(fs.read_file("/saved/more.bin").unwrap(), b"extra");
        fs.symlink("/book.pdf", "/dest").unwrap();
        let save = cmd_media_doc("pdfdetach", &media_args(&["-save", "1", "-o", "/dest", "book.pdf"]), "", "/", &fs);
        assert_eq!((save.exit_code,save.stderr.as_str()), (2,"I/O Error: Error saving embedded file as '/dest'\n"));
        assert_eq!(fs.read_file("/book.pdf").unwrap(), bytes);
    }

    #[test]
    fn rsvg_convert_draws_paths_and_groups_in_both_formats() {
        let fs=MemoryVfs::new();
        for (body,pdf,png) in [
            (r#"<g transform="translate(2 3)" fill="red"><rect width="5" height="8"/><circle cx="5" cy="2" r="2"/></g>"#, "4ef7756b1c9169ce3864c1b523413360e661921f68c6aba079e0be34fe098095", "78335fc300d788c0d3f6d34bb6999719c00840a17cb4623a3c0bb10ca74b92f5"),
            (r#"<path d="M1 1 l6 3 q3 2 6 -1 Z" fill="green"/>"#, "e443034b529547f27c871c024036a89752528b40713e7d9dd518fb89d751f72b","d6559b5a215ca50677f4783c8325eb738fd96dd1a6597136cd60757ef960a096"),
            (r#"<text x="3" y="9" font-size="8">Hi</text>"#,"20d11261d64abd6ffa687bdf1d31d61e070456a780fd4a483483000a40fb571e","a94b66200c4108a248ade8d56e1f942a991655357b4413a0c2426369dfbc65b8"),
        ] {
            let svg=format!(r#"<svg width="20" height="12">{body}</svg>"#);
            for (ext,expected) in [("pdf",pdf),("png",png)] {
                let r=cmd_media_doc("rsvg-convert",&media_args(&["-f",ext,"-o","out"]),&svg,"/",&fs);
                assert_eq!(r.exit_code,0,"{}",r.stderr);
                assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out").unwrap())),expected,"{ext}: {body}");
            }
        }
    }

    #[test]
    fn pdf_raster_paints_standard_font_glyphs() {
        let stream = "BT /F1 6 Tf 2 3 Td (Hello) Tj ET";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 16 12] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", &contents,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], "");
        let fs = MemoryVfs::new();
        fs.write_file("/page.pdf", pdf.as_bytes()).unwrap();
        let r = cmd_media_doc("pdftoppm", &media_args(&["-r","72","-png","-singlefile","page.pdf","out"]), "", "/", &fs);
        assert_eq!(r.exit_code, 0, "{}", r.stderr);
        assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.png").unwrap())), "31d6b4bdfef2aff4d60bf2edd5b07ce9cf724ce1ea601327491795b3d63dbc35");
    }

    #[test]
    fn pdf_page_jpeg_contains_rendered_pixels_and_resolution() {
        let fs = MemoryVfs::new();
        let stream = "1 0 0 rg 0 0 16 16 re f 0 0 1 rg 16 0 16 16 re f";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 32 16] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", &contents], "");
        fs.write_file("/page.pdf", pdf.as_bytes()).unwrap();
        for (cmd, gray, quality, luma_quantizer) in [
            ("pdftoppm", false, None, 8), ("pdftocairo", true, Some("quality=90"), 3)
        ] {
            let mut args = vec!["-jpeg", "-singlefile", "-rx", "72", "-ry", "144"];
            if let Some(q) = quality { args.extend(["-jpegopt", q]); }
            if gray { args.push("-gray"); }
            args.extend(["page.pdf", "out"]);
            let result = cmd_media_doc(cmd, &media_args(&args), "", "/", &fs);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let jpg = fs.read_file("/out.jpg").unwrap();
            let im = jpeg_decode::decode(&jpg, 1 << 20).expect("a decodable JPEG");
            assert_eq!((im.width, im.height, im.gray), (32, 32, gray));
            assert_eq!(&jpg[14..18], &[0, 72, 0, 144]);
            let dqt = jpg.windows(2).position(|tag| tag == [255, 219]).unwrap();
            assert_eq!(jpg[dqt+5], luma_quantizer);
            for (x, expected) in [(6, if gray { [77;3] } else { [254,0,0] }),
                                  (24, if gray { [28;3] } else { [0,0,254] })] {
                let pixel = im.pixels[6 * im.width + x];
                assert!(pixel[..3].iter().zip(expected).all(|(a,b)| a.abs_diff(b) <= 2), "{cmd}: {pixel:?}");
            }
        }
    }

    #[test]
    fn pdfimages_authenticates_before_listing_or_extracting() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>",
            "<< /Type /Page /Parent 2 0 R >>", "<< /Type /Page /Parent 2 0 R >>",
            // Standard revision 3 credentials for reader/owner and the fixed file ID below.
            "<< /Filter /Standard /V 2 /R 3 /Length 128 /P -1052 /U <94A57277391CA32F87E903F479F2A13A28BF4E5E4E758A4164004E56FFFA0108> /O <0CB58749C5346569E765906CAF64E4429A4C20D6E996FDEF963E9B5080F9E083> >>"],
            "/Encrypt 5 0 R /ID [<BC0F227BE410D486C2F262EF0840C151> <BC0F227BE410D486C2F262EF0840C151>]");
        fs.write_file("/locked.pdf", pdf.as_bytes()).unwrap();
        for (args, code, msg) in [
            (vec!["-list", "locked.pdf"], 1, "Command Line Error: Incorrect password\n"),
            (vec!["-upw", "wrong", "locked.pdf", "out"], 1, "Command Line Error: Incorrect password\n"),
            (vec!["-q", "-list", "locked.pdf"], 1, ""),
            (vec!["-f","2","-opw","owner","-list","locked.pdf"], 0, ""),
        ] {
            let r = cmd_media_doc("pdfimages", &media_args(&args), "", "/", &fs);
            assert_eq!((r.exit_code, r.stderr.as_str()), (code, msg));
            if code != 0 { assert!(r.stdout.is_empty()); }
        }
    }

    #[test]
    fn pdftoppm_transforms_the_image_and_its_soft_mask_together() {
        let fs = MemoryVfs::new();
        // Poppler 24.02: rotations, reflections, shears, clipped and subpixel draws.
        for (matrix, dpi, expected) in [
            ("0 5 -3 0 5 1", "72", "db992da7ed934c1a6f1a54610bc921039cd0318939b7f3c8f1299c7c302209d3"),
            ("-6 0 0 4 7 1", "72", "08e0ebf404cc3e21b075af1917f0acb7a4e68507136653684ef46f45eec42737"),
            ("6 0 0 -4 1 6", "72", "e7934873191b0cc115d26d2b82a50923d26ea268a8f963a1f15b0f16b3d83826"),
            ("4 3 -2 4 4 1", "72", "3ed30633bdb7d28dff973832b70c4b00961520504fd60d0621560c6f51876cae"),
            ("4 -2 3 3 -2 3", "72", "97cde93f55cf3457d3b797a66e967d1ad17ea5d1bf2f9283d6183cccd65b96b8"),
            ("0.3 0.1 0.2 0.4 2.1 3.2", "72", "b4836883224a7b4b6d18cc60ae800dbb7748f6c3e8a239db4ac32e27f86e68fa"),
            ("2 5 -3 -2 5 2", "72", "4fb8833288029632543fc2c0a456cfa02f9bfc5135a2f243874bebe0d02b00f0"),
            ("-0.3 -2.7 -5.8 -2.8 6.7 7.9", "144", "4f74d9b6852ee625d151629e54ed10b5532fc0154487a8a27b986caa838241e5"),
            ("0.3 0.1 0.2 0.4 2.1 3.2", "360", "0777fd1169ddf8fb930a3075f91525d832660580e8a0e9b51e9daf91e2cbc6c7"),
        ] {
            let draw = format!("q {matrix} cm /A Do Q");
            let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 9 7] /Resources << /XObject << /A 5 0 R >> >> /Contents 4 0 R >>",
                &format!("<< /Length {} >>\nstream\n{draw}\nendstream", draw.len()),
                "<< /Type /XObject /Subtype /Image /Width 4 /Height 3 /BitsPerComponent 8 /ColorSpace /DeviceRGB /SMask 6 0 R /Length 36 >>\nstream\nABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\nendstream",
                "<< /Type /XObject /Subtype /Image /Width 7 /Height 5 /BitsPerComponent 8 /ColorSpace /DeviceGray /Interpolate true /Length 35 >>\nstream\nABCDEFGHIJKLMNOPQRSTUVWXYZ123456789\nendstream"], "");
            fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
            let r = cmd_media_doc("pdftoppm", &media_args(&["-r",dpi,"-singlefile","in.pdf","out"]), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{matrix}: {}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file("/out.ppm").unwrap())), expected, "{matrix}");
        }
    }

    #[test]
    fn pdfimages_soft_mask_uses_its_own_size_and_the_parent_object_id() {
        let fs = MemoryVfs::new();
        let draw = "q 4 0 0 2 0 0 cm /A Do /A Do Q";
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8 4] /Resources << /XObject << /A 5 0 R >> >> /Contents 4 0 R >>",
            &format!("<< /Length {} >>\nstream\n{draw}\nendstream", draw.len()),
            "<< /Type /XObject /Subtype /Image /Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /SMask 6 0 R /Length 6 >>\nstream\nABCxyz\nendstream",
            "<< /Type /XObject /Subtype /Image /Width 3 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray /Interpolate true /Length 3 >>\nstream\nAz~\nendstream",
        ], "");
        fs.write_file("/mask.pdf", pdf.as_bytes()).unwrap();
        let run = |args: &[&str]| cmd_media_doc("pdfimages", &media_args(args), "", "/", &fs);
        let list = run(&["-list", "mask.pdf"]);
        assert_eq!(list.exit_code, 0, "{}", list.stderr);
        assert_eq!(list.stdout.lines().skip(2).collect::<Vec<_>>(), [
            "   1     0 image       2     1  rgb     3   8  image  no         5  0    36    36    6B 100%",
            "   1     1 smask       3     1  gray    1   8  image  yes        5  0    54    36    3B 100%",
            "   1     2 image       2     1  rgb     3   8  image  no         5  0    36    36    6B 100%",
            "   1     3 smask       3     1  gray    1   8  image  yes        5  0    54    36    3B 100%",
        ]);
        let out = run(&["mask.pdf", "out"]);
        assert_eq!(out.exit_code, 0, "{}", out.stderr);
        assert_eq!(fs.read_file("/out-002.ppm").unwrap(), b"P6\n2 1\n255\nABCxyz");
        assert_eq!(fs.read_file("/out-003.ppm").unwrap(), b"P6\n3 1\n255\nAAAzzz~~~");
    }

    #[test]
    fn pdf_sampled_images_apply_predictors_and_decode_ranges() {
        let fs = MemoryVfs::new();
        let draw = "q 7 0 0 5 0 0 cm /A Do Q";
        // PNG Up predictor inside ASCIIHex and Flate. Digests cover the full Poppler 24.02 PPMs.
        for (color, bits, components, decode, bytes, extract, page) in [
            ("Gray", 8, 1, "1 0", "789c63b29df0d8acf38e3e932b04e0a201f6ec0b11>",
             "32f0e590a7c860375eb591131dd20d28b0c4c26cf6865aeb2771b904b2ced3ab", "b20102b19b6581b90025619f3788b596cfa6efdf3185d789bf0247d503a018b5"),
            ("RGB", 8, 3, "0.2 0.8 0.2 0.8 0.2 0.8", "789c63b29df0d8acf38e7ed3558dea738a25c7a5720f08a7ed643a8f0d502e0a0099b24e0e>",
             "ad590cb03b9ce0d23b38a9c1f8ac921fa252d3ff695be19b345e2b5004369ac6", "e1ffe9598959a5acbea0509e0b7a4c2d45674e2a82be7b5e4ea81bb353f9fa19"),
            ("Gray", 1, 1, "1 0", "789c63b2650a864000079b0194>",
             "780bbda7e943497931f4a423c4926226f9ef24f9b7efff988c5562686cba5ee2", "b46d5ad93db9ed87e658aef266196b2e8e4be73f4a2f6d691db9241781db80a5"),
            ("RGB", 1, 3, "0.2 0.8 0.2 0.8 0.2 0.8", "789c63b29df098e9e7cf9fc818007ba60d67>",
             "29bbc57391bbc6d75122fbe9466e124b6d86fe6aab076a83bc90682220cb6f4e", "5438c100d9e544392dbe2cf041244c803ef408c58e436b36690c9c0f2cf4b3bc"),
            ("Gray", 2, 1, "1 0", "789c63b29dc0b46c191c01002a2f0608>",
             "28d6e3328f29a51cf5ba7defc69a70c384de751fe22060054d1646c7166b86ee", "2193ea0b5f6a312323b4366dfa9e9da6553723f83d90f70971c155de961838cc"),
            ("RGB", 4, 3, "0.2 0.8 0.2 0.8 0.2 0.8", "789c63b29df0d8acf38e7ed3558d6aa68908400c1b007ebf1e6b>",
             "1f087cd871a3253f96325f39d6342938f57b919e361a89a7191402a7dd2353ed", "243c01db52968e6bfd3f8a0c85f016e520d29d2043f53ad11aa9c91a2c2cc8ea"),
            ("Gray", 16, 1, "0.2 0.8", "789c63b29df0d8acf38e7ed3558dea738a254c5d2880242e005ae62512>",
             "e12b70cee559b8d164a42b4401947c3213e38fecb6ad94d951233bde97166f3a", "d28c899851863d916a196610d78459e78d5c2488962df9c5447a65a36c4ca948"),
            ("CMYK", 2, 4, "0 1 0 1 0 1 0 1", "789c63b29df0d8acf38e3e932b04e0a201f6ec0b11>",
             "c67a702ff08259729a6feb3987b7a79b8e89ac69cf8f14b11b67dca4cd8c3b1e", "be33906bbee73023a4a51bb0e5474a8c963d0a1dc9a05855ed04a0eb786a74d9"),
            ("CMYK", 8, 4, "0.2 0.8 0.2 0.8 0.2 0.8 0.2 0.8", "789c63b29df0d8acf38e7ed3558dea738a25c7a5720f08a7ede489dfc41ab1fa1f93081e40234900bfa71605>",
             "1cf37296b59cc1103b14f542c9e84251acabb3dd33012377b017ef2f24b45a46", "12820ff49ef01c43a63cb669fa69520df1f767a5114a3fb5415f8fceba79749d"),
            ("CMYK", 16, 4, "1 0 1 0 1 0 1 0", "789c63b29df0d8acf38e7ed3558dea738a25c7a5720f08a7ede489dfc41ab1fa5fe092ef5e733f384f7b69d3ffc8b4e3b65ee315f5aab30ac5c72473f60b316990098690460052503eaf>",
             "ac1843c38f4f299fccfe0fac2a273aed72c904466362ae60f9a84a443c83908d", "d10ce37922d16b4393147c1a9627d6693713db7fedd81f2e2f3cbf5587a912b8"),
        ] {
            let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 7 5] /Resources << /XObject << /A 5 0 R >> >> /Contents 4 0 R >>",
                &format!("<< /Length {} >>\nstream\n{draw}\nendstream", draw.len()),
                &format!("<< /Type /XObject /Subtype /Image /Width 7 /Height 5 /ColorSpace /Device{color} /BitsPerComponent {bits} /Decode [{decode}] /Filter [/ASCIIHexDecode /FlateDecode] /DecodeParms [null << /Predictor 12 /Columns 7 /Colors {components} /BitsPerComponent {bits} >>] /Length {} >>\nstream\n{bytes}\nendstream", bytes.len())], "");
            fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
            for (cmd, args, path, expected) in [
                ("pdfimages", &["in.pdf","out"][..], if bits == 1 && components == 1 { "/out-000.pbm" } else { "/out-000.ppm" }, extract),
                ("pdftoppm", &["-r","72","-singlefile","in.pdf","out"][..], "/out.ppm", page),
            ] {
                let r = cmd_media_doc(cmd, &media_args(args), "", "/", &fs);
                assert_eq!(r.exit_code, 0, "{}", r.stderr);
                assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(path).unwrap())), expected, "{color} {cmd}");
            }
            let want = if components == 4 { "tif" } else { "png" };
            for flags in [&["-all"][..], &["-png","-tiff"][..]] {
                let mut args = flags.to_vec();
                args.extend(["-print-filenames","in.pdf","auto"]);
                let r = cmd_media_doc("pdfimages", &media_args(&args), "", "/", &fs);
                assert_eq!(r.stdout, format!("auto-000.{want}\n"));
            }

        }
    }

    fn embedded_jpeg_pdf(jpeg: &[u8], color: &str, filters: &str, hex: bool) -> Vec<u8> {
        let bytes = if hex { [hex_enc(jpeg).as_bytes(), b">"].concat() } else { jpeg.to_vec() };
        let info = image_header::jpeg(jpeg).unwrap();
        let (w,h)=(info.width,info.height);
        let draw = format!("q {w} 0 0 {h} 0 0 cm /Photo Do Q");
        let placeholder = "X".repeat(bytes.len());
        let mut pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            &format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << /XObject << /Photo 5 0 R >> >> /Contents 4 0 R >>"),
            &format!("<< /Length {} >>\nstream\n{draw}\nendstream",draw.len()),
            &format!("<< /Type /XObject /Subtype /Image /Width {w} /Height {h} /BitsPerComponent 8 /ColorSpace /{color} {filters} /Length {} >>\nstream\n{placeholder}\nendstream",bytes.len())], "").into_bytes();
        let at = pdf.windows(bytes.len()).position(|chunk| chunk == placeholder.as_bytes()).unwrap();
        pdf[at..at+bytes.len()].copy_from_slice(&bytes);
        pdf
    }

    #[test]
    fn pdfimages_decodes_jpeg_sample_channels() {
        let fs = MemoryVfs::new();
        // Digests of the complete PPM files produced by Poppler 24.02.
        for (jpeg, cs, digest) in [
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-rgb-direct.jpg").as_slice(),"DeviceRGB","c98d601a22feb7377593f654d92e1c9cc463b526fb17e784a8a3b9f8be220dfc"),
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-RGB-0-0-17.jpg").as_slice(),"DeviceRGB","2a79d5233267a1a6f790f12fcca7bc106e87045f89e2fa0987e0232a57fc908a"),
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-L-1-0-17.jpg").as_slice(),"DeviceGray","468fc9af35bc3ee45e962d9722dc140b3791ef809c41e2c1b8043b63c2cc8c3e"),
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-CMYK-0-0-17.jpg").as_slice(),"DeviceCMYK","ba30edc4545abc23c76955fae1937ce0617add09e0bc2f69a7cde7ada4bff00b"),
            (include_bytes!("../../tests/fixtures/subsampled-progressive.jpg").as_slice(),"DeviceRGB","eabcd543e1d1f4d5f95df6703a5f3102de5d9a4f5589304a03e711c661381f73"),
        ] {
            fs.write_file("/photo.pdf",&embedded_jpeg_pdf(jpeg,cs,"/Filter /DCTDecode",false)).unwrap();
            let r = cmd_media_doc("pdfimages",&media_args(&["photo.pdf","photo"]),"","/",&fs);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            let data = fs.read_file("/photo-000.ppm").unwrap();
            assert_eq!(hex_enc(&sha256_bytes(&data)),digest,"{cs}");
            if jpeg == include_bytes!("../../../pdf-ast/src/fixtures/jpeg-rgb-direct.jpg") {
                let page = cmd_media_doc("pdftoppm",&media_args(&["-r","72","-singlefile","photo.pdf","page"]),"","/",&fs);
                assert_eq!(page.exit_code,0);
                let ppm = fs.read_file("/page.ppm").unwrap();
                let at = b"P6\n17 13\n255\n".len() + (4 * 17 + 3) * 3;
                assert_eq!(&ppm[at..at+3], &[31,63,58]);
            }

        }
    }

    #[test]
    fn pdfimages_preserves_embedded_jpegs() {
        let fs = MemoryVfs::new();
        for (bytes, color, filters, hex, listing) in [
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-RGB-0-0-17.jpg").as_slice(), "DeviceRGB", "/Filter /DCTDecode", false,
                "   1     0 image      17    13  rgb     3   8  jpeg   no         5  0    72    72  754B 114%"),
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-L-1-0-17.jpg").as_slice(), "DeviceGray", "/Filter [/ASCIIHexDecode /DCTDecode] /DecodeParms [null null]", true,
                "   1     0 image      17    13  gray    1   8  jpeg   no         5  0    72    72  669B 303%"),
            (include_bytes!("../../../pdf-ast/src/fixtures/jpeg-CMYK-0-0-17.jpg").as_slice(), "DeviceCMYK", "/Decode [1 0 1 0 1 0 1 0] /Filter /DCTDecode", false,
                "   1     0 image      17    13  cmyk    4   8  jpeg   no         5  0    72    72  515B  58%"),
        ] {
            fs.write_file("/photo.pdf",&embedded_jpeg_pdf(bytes,color,filters,hex)).unwrap();
            let run = |args: &[&str]| cmd_media_doc("pdfimages",&media_args(args),"","/",&fs);
            assert_eq!(run(&["-list","photo.pdf"]).stdout.lines().last(),Some(listing));
            for flag in ["-j", "-all"] {
                let r = run(&[flag,"photo.pdf","photo"]);
                assert_eq!(r.exit_code,0,"{}",r.stderr);
                assert_eq!(fs.read_file("/photo-000.jpg").unwrap(), bytes);
            }
        }
    }

    #[test]
    fn embedded_group4_scan_can_be_listed_rendered_and_extracted() {
        let scan = hex_dec("935cdc6ed249622466a0cd66ba492a4925001001");
        let draw = "q 19 0 0 7 0 0 cm /Scan Do Q";
        let fs = MemoryVfs::new();
        let mut pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 19 7] /Resources << /XObject << /Scan 5 0 R >> >> /Contents 4 0 R >>",
            &format!("<< /Length {} >>\nstream\n{draw}\nendstream",draw.len()),
            "<< /Type /XObject /Subtype /Image /Width 19 /Height 7 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 19 /Rows 7 /BlackIs1 true >> /Length 20 >>\nstream\nXXXXXXXXXXXXXXXXXXXX\nendstream"], "").into_bytes();
        let at = pdf.windows(scan.len()).position(|v| v == b"XXXXXXXXXXXXXXXXXXXX").unwrap();
        pdf[at..at+scan.len()].copy_from_slice(&scan);
        fs.write_file("/scan.pdf",&pdf).unwrap();
        let run = |cmd, args: &[&str]| cmd_media_doc(cmd,&media_args(args),"","/",&fs);
        let list = run("pdfimages",&["-list","scan.pdf"]);
        assert_eq!(list.stdout.lines().last(),Some("   1     0 image      19     7  gray    1   1  ccitt  no         5  0    72    72   20B 125%"));
        for flag in ["-all","-ccitt"] {
            let r = run("pdfimages",&[flag,"scan.pdf",flag.trim_start_matches('-')]);
            assert_eq!(r.exit_code,0,"{}",r.stderr);
            assert_eq!(fs.read_file(&format!("/{}-000.ccitt",&flag[1..])).unwrap(),scan);
            assert_eq!(fs.read_file(&format!("/{}-000.params",&flag[1..])).unwrap(),b"-4 -P -X 19 -W -M\n");
        }
        assert_eq!(run("pdfimages",&["scan.pdf","scan"]).exit_code,0);
        assert_eq!(fs.read_file("/scan-000.pbm").unwrap(),hex_dec("50340a313920370affffe03c78e078f1e0000000e3c780c78f008f1e20"));
        let r = run("pdftoppm",&["-gray","-r","72","-singlefile","scan.pdf","page"]);
        assert_eq!(r.exit_code,0,"{}",r.stderr);
        let px = fs.read_file("/page.pgm").unwrap();
        // Poppler pdftoppm 24.02 at 72 dpi, including its scanline interpolation.
        assert_eq!(px, hex_dec(concat!(
            "50350a313920370a3235350a00000000000000000000000000000000000000df",
            "df150000009bdfdf630000004ddfdfb20000ff480600008febff8b1c00004bd5",
            "ffcf330000ffa39f9f9fe7ffffc59f9f9fc5ffffe79f9f9f7f7f7febffffa57f",
            "7f7fbfffffd27f7f7f92ff000055e6ffb72f000034afffd86700001277ff003c",
            "ebffcc2f000026a8ffe27200000f65fff8",
        )));
    }

    #[test]
    fn pdf_page_rasters_cover_partial_pixels_and_report_scaled_density() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 32 16] >>",
            "<< /Type /Page /Parent 2 0 R >>"], "");
        fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        for (cmd, format, ext) in [("pdftoppm","-tiff","tif"), ("pdftocairo","-jpeg","jpg"), ("pdftoppm","-png","png")] {
            for (flags, dims) in [(vec!["-rx","72.5","-ry","144.25"], (33,33)), (vec!["-scale-to","35"], (35,18))] {
                let mut args = vec![format,"-singlefile"]; args.extend(flags); args.extend(["in.pdf","out"]);
                let result = cmd_media_doc(cmd, &media_args(&args), "", "/", &fs);
                assert_eq!(result.exit_code,0,"{}",result.stderr);
                let bytes = fs.read_file(&format!("/out.{ext}")).unwrap();
                let im = png_pixels::Raster::decode(&bytes, 1 << 20).unwrap();
                assert_eq!((im.width,im.height),dims,"{cmd} {format}");
                if ext == "png" {
                    let offset = bytes.windows(4).position(|tag| tag == b"pHYs").expect("PNG physical resolution") + 4;
                    let phys = if dims.0 == 33 { [2854u32,5679] } else { [3100,3100] };
                    assert_eq!(&bytes[offset..offset + 9], &[phys[0].to_be_bytes().as_slice(), &phys[1].to_be_bytes(), &[1]].concat());
                }
                if ext == "jpg" && dims.0 == 35 { assert_eq!(&bytes[14..18], &[0,78,0,78]); }
            }
        }
    }

    #[test]
    fn pdf_tiff_writes_ccitt_compressed_bilevel_pages() {
        let stream = "0 g 0 0 3 17 re f 9 3 8 11 re f 25 3 7 4 re f";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 33 17] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", &contents], "");
        let fs = MemoryVfs::new();
        fs.write_file("/in.pdf",pdf.as_bytes()).unwrap();
        for cmd in ["pdftoppm","pdftocairo"] {
            for (name, tag) in [("ccittrle",2),("ccittfax3",3),("ccittt4",3),("ccittfax4",4),("ccittt6",4)] {
                let args = media_args(&["-r","72","-tiff","-singlefile","-mono","-tiffcompression",name,"in.pdf","out"]);
                let r = cmd_media_doc(cmd,&args,"","/",&fs);
                assert_eq!((r.exit_code,r.stderr.as_str()),(0,""),"{cmd} {name}");
                let bytes = fs.read_file("/out.tif").unwrap();
                let ifd = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
                let compression = bytes[ifd+2..].chunks_exact(12).find(|e| e[..2] == 259u16.to_le_bytes()).unwrap();
                assert_eq!(u16::from_le_bytes(compression[8..10].try_into().unwrap()),tag);
                let raster = tiff::Tiff::parse(&bytes,1<<20).unwrap().decode().unwrap();
                for (i, pixel) in raster.pixels.iter().enumerate() {
                    let (x,y) = (i%33,16-i/33);
                    let v = if x<3 || (9..17).contains(&x) && (3..14).contains(&y)
                        || (25..32).contains(&x) && (3..7).contains(&y) {0} else {255};
                    assert_eq!(*pixel,[v,v,v,255],"{cmd} {name} {x},{y}");
                }
            }
        }
    }

    #[test]
    fn pdf_tiff_contains_decodable_page_pixels_in_each_compression() {
        let stream = "1 0 0 rg 0 0 16 16 re f 0 0 1 rg 16 0 16 16 re f";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 32 16] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", &contents], "");
        fs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        for compression in ["none", "packbits", "deflate", "lzw", "jpeg"] {
            for cmd in ["pdftoppm", "pdftocairo"] {
                let mut args = vec!["-tiff", "-singlefile", "-tiffcompression", compression, "-rx", "72", "-ry", "144"];
                let gray = cmd == "pdftocairo";
                if gray { args.push("-gray"); }
                args.extend(["in.pdf", "out"]);
                let result = cmd_media_doc(cmd, &media_args(&args), "", "/", &fs);
                assert_eq!(result.exit_code, 0, "{cmd} {compression}: {}", result.stderr);
                let bytes = fs.read_file("/out.tif").unwrap();
                let tiff = tiff::Tiff::parse(&bytes, 1 << 20).expect("decodable TIFF");
                assert_eq!((tiff.width, tiff.height, tiff.samples, tiff.density), (32, 32, if gray {1} else {3}, 72));
                let image = tiff.decode().unwrap();
                for (x, rgb) in [(5, if gray {[77;3]} else {[255,0,0]}), (27, if gray {[28;3]} else {[0,0,255]})] {
                    assert!(image.pixels[5 * 32 + x][..3].iter().zip(rgb).all(|(v,w)| v.abs_diff(w) <= 2), "{cmd} {compression}");
                }
            }
        }
    }

    #[test]
    fn pdf_raster_reports_unwritable_output_even_in_quiet_mode() {
        let fs = MemoryVfs::new();
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 8 8] >>",
            "<< /Type /Page /Parent 2 0 R >>"], "");
        fs.write_file("/page.pdf", pdf.as_bytes()).unwrap();
        for (cmd, code, message) in [
            ("pdftoppm", 1, "Could not write image to missing/out.jpg; exiting\n"),
            ("pdftocairo", 2, "Error opening output file missing/out.jpg\n"),
        ] {
            let args = media_args(&["-q", "-jpeg", "-singlefile", "page.pdf", "missing/out"]);
            let result = cmd_media_doc(cmd, &args, "", "/", &fs);
            assert_eq!((result.exit_code, result.stderr.as_str()), (code, message));
        }
    }

    #[test]
    fn render_pdf_vector_fills_to_png_and_portable_bitmaps() {
        let fs = MemoryVfs::new();
        let stream = "0 0.5 1 rg 1 1 m 12 2 l 6 10 l h f";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let pdf = classic_pdf(&["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 1 /Kids [3 0 R] /MediaBox [0 0 16 12] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", &contents], "");
        fs.write_file("/page.pdf", pdf.as_bytes()).unwrap();
        for (cmd, flags, ext, hash) in [
            ("pdftoppm", "-png", "png", "e2586112dde6f3fb2b7153cf37394aa5fd35262aa0abde87ba100c0bfd988380"),
            ("pdftocairo", "-png -transp", "png", "5f54f1dad6524f167764171dd17c0154abe0c58b541dadd448a508f1bb055eba"),
            ("pdftoppm", "-gray", "pgm", "2996700b20eab9ff7c18de60f81d342f810d447ce56fc5bdcd011256e7c3734d"),
            ("pdftoppm", "-mono", "pbm", "72d971a340d3f55d32aa340fe87503c8994e4e8d207ac687557e9792b0f35362"),
        ] {
            let args = format!("{flags} -singlefile -r 72 page.pdf out");
            let r = cmd_media_doc(cmd, &media_args(&args.split_whitespace().collect::<Vec<_>>()), "", "/", &fs);
            assert_eq!(r.exit_code, 0, "{}", r.stderr);
            assert_eq!(hex_enc(&sha256_bytes(&fs.read_file(&format!("/out.{ext}")).unwrap())), hash, "{cmd} {flags}");
        }
    }

    #[test]
    fn pdftohtml_uses_pdf_text_positions_and_font_metrics_at_each_zoom() {
        let stream = "BT /F1 11 Tf 1 0 0 1 28.346457 795 Tm (Hello) Tj 0 -20 Td (World) Tj ET";
        let contents = format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len());
        let pdf = classic_pdf(&[
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> >>",
            "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>", &contents,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ], "");
        let fs = MemoryVfs::new();
        fs.write_file("/page.pdf", pdf.as_bytes()).unwrap();
        let html = cmd_media_doc("pdftohtml", &media_args(&["-stdout", "-zoom", "2", "page.pdf"]), "", "/", &fs);
        assert!(html.stdout.contains("top:76pt;left:57pt;margin:0;\">Hello</p>"), "{}", html.stdout);
        let xml = cmd_media_doc("pdftohtml", &media_args(&["-stdout", "-xml", "page.pdf"]), "", "/", &fs);
        assert!(xml.stdout.contains(r#"<fontspec id="1" size="11" family="Helvetica""#), "{}", xml.stdout);
        assert!(xml.stdout.contains(r#"<text top="38" left="28" width="25" height="11" font="1">Hello</text>"#));
        assert!(xml.stdout.contains(r#"<text top="58" left="28" width="29" height="11" font="1">World</text>"#));
    }

    #[test]
    fn reads_page_tree_and_text_from_classic_pdf_objects() {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count 2 /Kids [4 0 R 3 0 R] /MediaBox [0 0 300.25 400.5] /CropBox [5 6 205 306] /Rotate 90 >>",
            "<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Rotate 0 /CropBox [0 0 10 20] >>",
            "<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>",
            "<< /Length 25 >>\nstream\nBT (first \\(page\\)) Tj ET\nendstream",
            "<< /Length 24 >>\nstream\nBT [(sec) 0 (ond)] TJ ET\nendstream",
            "<< /Zebra (last) /Producer (writer) /Title (example) /Subject (testing) /Alpha (first) >>",
        ];
        let pdf = classic_pdf(&objects, "/Info 7 0 R /ID [<f123> <cdef>]");
        let doc = PdfDoc::parse(pdf.as_bytes());
        assert_eq!(doc.title, "example");
        assert_eq!((doc.page_w, doc.page_h), (300.25, 400.5));
        assert_eq!(doc.pages.len(), 2);
        assert_eq!(doc.pages[0].text, "first (page)");
        assert_eq!(doc.pages[1].text, "second");
        assert_eq!(doc.pages[0].rot, 90);
        assert_eq!(doc.pages[1].rot, 0);
        assert_eq!(doc.page_media[&1].2, Some([5., 6., 205., 306.]));
        assert_eq!(doc.page_media[&2].2, Some([0., 0., 10., 20.]));
        let vfs = MemoryVfs::new();
        vfs.write_file("/in.pdf", pdf.as_bytes()).unwrap();
        let dump = cmd_media_doc("pdftk", &media_args(&["/in.pdf", "dump_data"]), "", "/", &vfs);
        assert_eq!(dump.exit_code, 0);
        let keys: Vec<_> = dump.stdout.lines().filter_map(|l| l.strip_prefix("InfoKey: ")).collect();
        assert_eq!(keys, ["Title", "Subject", "Producer", "Zebra", "Alpha"]);
        assert!(dump.stdout.contains("PdfID0: f123\nPdfID1: cdef\n"));
        assert!(dump.stdout.contains("PageMediaDimensions: 300.25 400.5\n"));
    }

    #[test]
    fn pdftotext_formats_each_page_including_empty_pages() {
        let vfs = MemoryVfs::new();
        let mut doc = PdfDoc::new();
        for text in ["one", "", "three"] {
            doc.pages.push(PdfPage { text: text.into(), ..Default::default() });
        }
        vfs.write_file("/in.pdf", &doc.serialize()).unwrap();
        for (flags, expected) in [
            (vec![], "one\n\n\x0c\x0cthree\n\n\x0c"),
            (vec!["-layout", "-eol", "dos"], "one\r\n\x0c\x0cthree\r\n\x0c"),
            (vec!["-raw"], "one\x0c\x0cthree\x0c"),
            (vec!["-nopgbrk", "-eol", "mac"], "one\r\rthree\r\r"),
            (vec!["-f", "2", "-l", "2"], "\x0c"),
        ] {
            let mut args = media_args(&flags);
            args.extend(media_args(&["/in.pdf", "-"]));
            let result = cmd_media_doc("pdftotext", &args, "", "/", &vfs);
            assert_eq!(result.exit_code, 0, "{flags:?}");
            assert_eq!(result.stdout, expected, "{flags:?}");
        }
    }

    #[test]
    fn wkhtmltopdf_batch_inherits_options_and_stops_after_first_error() {
        let fs = MemoryVfs::new();
        fs.write_file("/my doc", b"<p>one</p>").unwrap();
        let run = |jobs| cmd_media_doc("wkhtmltopdf", &media_args(&["--read-args-from-stdin", "--title", "Batch"]), jobs, "/", &fs);
        let result = run("'/my doc' /first.pdf\n/my\\ doc /missing/out\n'/my doc' /later.pdf\n");
        assert_eq!(result.exit_code, 1);
        assert!(result.stderr.contains("realpath '/missing'"));
        let first = fs.read_file("/first.pdf").unwrap();
        assert_eq!(pdf_reader::read(&first,"").unwrap().0.title, "Batch");
        assert!(!fs.exists("/later.pdf"));
        let stream = run("'/my doc' -\n- /bad.pdf");
        assert_eq!(stream.stdout, crate::vfs::bytes_to_stream_string(&first));
        assert!(stream.stderr.contains("Batch conversion cannot share stdin"));
        assert_eq!(stream.exit_code, 1);
    }

    #[test]
    fn wkhtmltopdf_only_publishes_to_distinct_regular_files() {
        let fs = MemoryVfs::new();
        fs.write_file("/source", b"<p>original</p>").unwrap();
        fs.symlink("/source", "/alias").unwrap();
        fs.hard_link("/source", "/hard").unwrap();
        let run = |src, dst| cmd_media_doc("wkhtmltopdf", &media_args(&[src, dst]), "", "/", &fs);
        for (src, dst) in [("/source","/alias"),("/alias","/source"),("/hard","/source"),("/source","/hard"),
                            ("/source","/source"),("/source","/"),("/source","/missing/output")] {
            assert_eq!(run(src,dst).exit_code, 1, "{src} -> {dst}");
            assert_eq!(fs.read_file("/source").unwrap(), b"<p>original</p>");
        }
        assert!(!fs.exists("/missing"));
        assert_eq!(run("/source", "/new").exit_code, 0);
        assert_eq!(fs.stat("/new").unwrap().mode & 0o777, 0o666);
        let version = fs.generation();
        fs.write_file("/new", b"another writer").unwrap();
        assert!(fs.publish_file("/new", b"stale output", &[], version).is_err());
        assert_eq!(fs.read_file("/new").unwrap(), b"another writer");
        fs.chmod("/new", 0o600).unwrap();
        assert_eq!(run("/source", "/new").exit_code, 0);
        assert_eq!(fs.stat("/new").unwrap().mode & 0o777, 0o600);
    }

    #[test]
    fn soffice_writes_production_word_and_spreadsheet_packages() {
        let fs = MemoryVfs::new();
        for (input, bytes, ext, expected) in [
            ("d.rtf", br"{\rtf1\ansi Project Titan Architecture\par Body text.\par}".as_slice(), "docx",
             "2bfb2063907fbb4f95bd73859e2cbc9d73d29f3cbcb7f5368e1198027d28fbeb"),
            ("d.csv", b"name,value\nA,4\nB,9\n", "xlsx",
             "8fcd5d476cdd59a9032813ff2e7a0e8c4e393542b21391f419cc367fe8bb932e"),
        ] {
            fs.write_file(&format!("/{input}"), bytes).unwrap();
            let result = cmd_media_doc("soffice", &media_args(&["--convert-to", ext, input]), "", "/", &fs);
            assert_eq!(result.exit_code, 0, "{}", result.stderr);
            let output = fs.read_file(&format!("/d.{ext}")).unwrap();
            assert_eq!(crate::commands::archive::sha256_bytes(&output).iter().map(|b|format!("{b:02x}")).collect::<String>(), expected);
        }
    }

    #[test]
    fn soffice_writes_standard_pdf_objects_for_html() {
        let fs = MemoryVfs::new();
        fs.write_file("/page.html", b"<p>alpha</p>").unwrap();
        let result = cmd_media_doc("soffice", &media_args(&["--convert-to", "pdf", "page.html"]), "", "/", &fs);
        assert_eq!(result.exit_code, 0, "{}", result.stderr);
        let bytes = fs.read_file("/page.pdf").unwrap();
        assert_eq!(crate::commands::archive::sha256_bytes(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>(),
                   "035035a4cc7f3bed1d8cca27139e7f1f7712abb2879c24976818b4808fed53db");
    }

    #[test]
    fn wkhtmltopdf_paragraphs_produce_readable_pdf_objects() {
        let fs = MemoryVfs::new();
        let result = cmd_media_doc("wkhtmltopdf", &media_args(&["--page-size", "Letter", "-", "/doc.pdf"]),
            "<title>Budget</title><p>alpha (one)</p><p>bêta</p>", "/", &fs);
        assert_eq!(result.exit_code, 0);
        let bytes = fs.read_file("/doc.pdf").unwrap();
        let doc = pdf_reader::read(&bytes,"").expect("standard PDF page tree and xref").0;
        assert_eq!(doc.title, "Budget");
        assert_eq!((doc.page_w, doc.page_h), (612., 792.));
        assert_eq!(doc.pages[0].text, "alpha (one)\n\nbêta");
    }

    #[test]
    fn unit_media_wkhtmltopdf_pdfinfo_pdftotext_and_identify() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/docs").unwrap();
        vfs.write_file(
            "/docs/page.html",
            b"<html><head><title>SpecDoc</title></head><body><h1>Hello PDF World</h1></body></html>",
        )
        .unwrap();

        let wk = cmd_media_doc(
            "wkhtmltopdf",
            &media_args(&["/docs/page.html", "/docs/out.pdf"]),
            "",
            "/docs",
            &vfs,
        );
        assert_eq!(wk.exit_code, 0, "stderr: {}", wk.stderr);

        let info = cmd_media_doc("pdfinfo", &media_args(&["/docs/out.pdf"]), "", "/docs", &vfs);
        assert_eq!(info.exit_code, 0);
        assert!(info.stdout.contains("Pages:"));

        let txt = cmd_media_doc(
            "pdftotext",
            &media_args(&["/docs/out.pdf", "-"]),
            "",
            "/docs",
            &vfs,
        );
        assert_eq!(txt.exit_code, 0);
        assert!(txt.stdout.contains("Hello PDF World"));

        let ppm_png = cmd_media_doc(
            "pdftoppm",
            &media_args(&["-png", "-singlefile", "-gray", "-r", "72", "-f", "1", "-l", "1", "/docs/out.pdf", "/docs/single_gray"]),
            "",
            "/docs",
            &vfs,
        );
        assert_eq!(ppm_png.exit_code, 0);
        assert!(vfs.exists("/docs/single_gray.png"));
    }

    #[test]
    fn unit_media_exiftool_sips_and_diffpdf() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/img").unwrap();
        let mk = cmd_media_doc(
            "magick",
            &media_args(&["-size", "32x24", "xc:blue", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(mk.exit_code, 0);
        let ex = cmd_media_doc(
            "exiftool",
            &media_args(&["-Artist=RustBot", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(ex.exit_code, 0);
        let ex_read = cmd_media_doc(
            "exiftool",
            &media_args(&["-s3", "-Artist", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(ex_read.stdout.trim(), "RustBot");

        let sips_get = cmd_media_doc(
            "sips",
            &media_args(&["-g", "pixelWidth", "-g", "pixelHeight", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(sips_get.exit_code, 0);
        assert_eq!(
            sips_get.stdout,
            "/img/a.png\n  pixelWidth: 32\n  pixelHeight: 24\n"
        );

        let sips_err6 = cmd_media_doc(
            "sips",
            &media_args(&["-g", "pixelWidth", "-z", "16", "16", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(sips_err6.exit_code, 6);
        assert_eq!(
            sips_err6.stderr,
            "Error 6: cannot get properties and modify file in the same invocation\nTry 'sips --help' for help using this tool\n"
        );

        let sips_flip_err = cmd_media_doc(
            "sips",
            &media_args(&["-f", "diagonal", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(sips_flip_err.exit_code, 1);
        assert_eq!(
            sips_flip_err.stderr,
            "sips: flip direction must be 'horizontal' or 'vertical'\n"
        );

        let sips_bad_fmt = cmd_media_doc(
            "sips",
            &media_args(&["-s", "format", "ico", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(sips_bad_fmt.exit_code, 1);
        assert_eq!(sips_bad_fmt.stderr, "Error:Unsupported format: ico\n");

        let sips_unknown = cmd_media_doc(
            "sips",
            &media_args(&["--bogus", "/img/a.png"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(sips_unknown.exit_code, 1);
        assert_eq!(sips_unknown.stderr, "sips: unknown option: --bogus\n");

        vfs.write_file("/img/notpdf.txt", b"hello").unwrap();
        let dp_err = cmd_media_doc(
            "diffpdf",
            &media_args(&["/img/notpdf.txt", "/img/notpdf.txt"]),
            "",
            "/img",
            &vfs,
        );
        assert_eq!(dp_err.exit_code, 2);
        assert_eq!(
            dp_err.stderr,
            "diffpdf: /img/notpdf.txt: Invalid PDF header: missing %PDF- signature\n"
        );
    }

    #[test]
    fn unit_media_ffmpeg_ffprobe_soffice_svgo_sox_qrencode_diagnostics() {
        let vfs = MemoryVfs::new();
        vfs.mkdir_all("/work/dir").unwrap();

        let ff_empty = cmd_media_doc("ffmpeg", &[], "", "/work", &vfs);
        assert_eq!(ff_empty.exit_code, 1);
        assert!(ff_empty.stderr.contains("usage: ffmpeg"));

        let ff_no_in = cmd_media_doc("ffmpeg", &media_args(&["/work/out.mp4"]), "", "/work", &vfs);
        assert_eq!(ff_no_in.exit_code, 1);
        assert_eq!(ff_no_in.stderr, "ffmpeg: must specify at least one input (-i)\n");

        let ff_no_out = cmd_media_doc(
            "ffmpeg",
            &media_args(&["-i", "/work/in.mp4"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(ff_no_out.exit_code, 1);
        assert_eq!(ff_no_out.stderr, "ffmpeg: must specify an output file\n");

        let ff_missing = cmd_media_doc(
            "ffmpeg",
            &media_args(&["-i", "missing.mp4", "out.mp4"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(ff_missing.exit_code, 1);
        assert_eq!(
            ff_missing.stderr,
            "ffmpeg: ENOENT: no such file or directory, readFile '/work/missing.mp4'\n"
        );

        let fp_empty = cmd_media_doc("ffprobe", &[], "", "/work", &vfs);
        assert_eq!(fp_empty.exit_code, 1);
        assert_eq!(
            fp_empty.stderr,
            "Simple multimedia streams analyzer\nusage: ffprobe [OPTIONS] INPUT_FILE\n"
        );

        let fp_unknown = cmd_media_doc("ffprobe", &media_args(&["-bogus", "a.mp4"]), "", "/work", &vfs);
        assert_eq!(fp_unknown.exit_code, 1);
        assert_eq!(fp_unknown.stderr, "ffprobe: Unknown option -bogus\n");

        let fp_writer = cmd_media_doc("ffprobe", &media_args(&["-of", "xml", "a.mp4"]), "", "/work", &vfs);
        assert_eq!(fp_writer.exit_code, 1);
        assert_eq!(fp_writer.stderr, "ffprobe: Unknown output format xml\n");

        let fp_missing = cmd_media_doc("ffprobe", &media_args(&["missing.mp4"]), "", "/work", &vfs);
        assert_eq!(fp_missing.exit_code, 1);
        assert_eq!(
            fp_missing.stderr,
            "ffprobe: ENOENT: no such file or directory, openReadFile '/work/missing.mp4'\n"
        );

        let soffice_err = cmd_media_doc(
            "soffice",
            &media_args(&["--headless", "--convert-to", "pdf", "missing.docx"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(soffice_err.exit_code, 1);
        assert_eq!(
            soffice_err.stderr,
            "Error: source file could not be loaded: missing.docx\n"
        );

        let svgo_err = cmd_media_doc("svgo", &media_args(&["missing.svg"]), "", "/work", &vfs);
        assert_eq!(svgo_err.exit_code, 1);
        assert_eq!(
            svgo_err.stderr,
            "svgo: ENOENT: no such file or directory, readFile '/work/missing.svg'\n"
        );

        let soxi_err = cmd_media_doc("soxi", &media_args(&["missing.wav"]), "", "/work", &vfs);
        assert_eq!(soxi_err.exit_code, 1);
        assert_eq!(
            soxi_err.stderr,
            "soxi: ENOENT: no such file or directory, readFile '/work/missing.wav'\n"
        );

        let qr_err = cmd_media_doc(
            "qrencode",
            &media_args(&["-r", "missing.txt", "-o", "-"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(qr_err.exit_code, 1);
        assert_eq!(
            qr_err.stderr,
            "Cannot read input file missing.txt.\n"
        );

        let wk_err = cmd_media_doc("wkhtmltopdf", &media_args(&["only_one.html"]), "", "/work", &vfs);
        assert_eq!(wk_err.exit_code, 1);
        assert_eq!(
            wk_err.stderr,
            "wkhtmltopdf: MISSING_OBJECT: Expected at least one input object and exactly one output\n"
        );

        let qpdf_err = cmd_media_doc("qpdf", &media_args(&["--check"]), "", "/work", &vfs);
        assert_eq!(qpdf_err.exit_code, 2);
        assert_eq!(qpdf_err.stderr, "qpdf: an input file is required\n");

        let rsvg_err = cmd_media_doc(
            "rsvg-convert",
            &media_args(&["-f", "webp"]),
            "<svg width=\"10\" height=\"10\"/>",
            "/work",
            &vfs,
        );
        assert_eq!(rsvg_err.exit_code, 1);
        assert_eq!(rsvg_err.stderr, "rsvg-convert: unsupported format webp\n");
    }

    #[test]
    fn unit_pdftk_pdftoppm_pdftocairo_pdftotext_pdftohtml_magick_and_exiftool_diagnostics() {
        let vfs = MemoryVfs::new();
        let _ = vfs.mkdir_all("/work");
        let _ = vfs.write_file("/work/bad.pdf", b"not a pdf");

        let pdftk_help = cmd_media_doc("pdftk", &media_args(&["--help"]), "", "/work", &vfs);
        assert_eq!(pdftk_help.exit_code, 0);
        assert_eq!(
            pdftk_help.stdout,
            "Usage: pdftk <input PDF files | [handle]=filename ...> [<operation> <operation arguments>] [output <output filename>] [flatten]\n"
        );

        let pdftk_ver = cmd_media_doc("pdftk", &media_args(&["--version"]), "", "/work", &vfs);
        assert_eq!(pdftk_ver.exit_code, 0);
        assert_eq!(
            pdftk_ver.stdout,
            "pdftk port to Java 3.3.3 (safe-bash @poe-code/pdf-ast)\n"
        );

        let pdftk_missing = cmd_media_doc(
            "pdftk",
            &media_args(&["missing.pdf", "cat", "output", "out.pdf"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(pdftk_missing.exit_code, 1);
        assert_eq!(
            pdftk_missing.stderr,
            "Error: Unable to find file 'missing.pdf'\n"
        );

        let pdftk_bad = cmd_media_doc(
            "pdftk",
            &media_args(&["bad.pdf", "cat", "output", "out.pdf"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(pdftk_bad.exit_code, 1);
        assert_eq!(
            pdftk_bad.stderr,
            "Error: Failed to open PDF 'bad.pdf': Invalid PDF header: missing %PDF- signature\n"
        );

        let pdftotext_bad = cmd_media_doc(
            "pdftotext",
            &media_args(&["bad.pdf", "-"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(pdftotext_bad.exit_code, 1);
        assert_eq!(
            pdftotext_bad.stderr,
            "Syntax Error: Invalid PDF header: missing %PDF- signature\n"
        );

        let pdftohtml_bad = cmd_media_doc(
            "pdftohtml",
            &media_args(&["-stdout", "bad.pdf"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(pdftohtml_bad.exit_code, 1);
        assert_eq!(
            pdftohtml_bad.stderr,
            "PDF Error: Invalid PDF header: missing %PDF- signature\n"
        );

        let ppm_ver = cmd_media_doc("pdftoppm", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(ppm_ver.exit_code, 0);
        assert_eq!(ppm_ver.stdout, "pdftoppm version 24.08.0\n");

        let ppm_unknown = cmd_media_doc(
            "pdftoppm",
            &media_args(&["-bogus", "bad.pdf"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(ppm_unknown.exit_code, 99);
        assert_eq!(ppm_unknown.stderr, "Unknown option '-bogus'\n");

        let ppm_missing_val = cmd_media_doc("pdftoppm", &media_args(&["-r"]), "", "/work", &vfs);
        assert_eq!(ppm_missing_val.exit_code, 99);
        assert_eq!(ppm_missing_val.stderr, "Missing value for '-r'\n");

        let cairo_bad_aa = cmd_media_doc(
            "pdftocairo",
            &media_args(&["-png", "-antialias", "bogus", "bad.pdf"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(cairo_bad_aa.exit_code, 99);
        assert_eq!(cairo_bad_aa.stderr, "Bad '-antialias' value on command line\n");

        let magick_help = cmd_media_doc("magick", &media_args(&["-help"]), "", "/work", &vfs);
        assert_eq!(magick_help.exit_code, 0);
        assert_eq!(
            magick_help.stdout,
            "Usage: magick [input-options] input-file [operators] output-file\n"
        );

        let magick_no_img = cmd_media_doc("magick", &media_args(&["only_out.png"]), "", "/work", &vfs);
        assert_eq!(magick_no_img.exit_code, 1);
        assert_eq!(magick_no_img.stderr, "magick: no images defined 'only_out.png'\n");

        let exif_if = cmd_media_doc(
            "exiftool",
            &media_args(&["-if", "$ImageWidth > 10", "a.png"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(exif_if.exit_code, 1);
        assert_eq!(
            exif_if.stderr,
            "Error: ExifTool option not yet supported (no code evaluation or ambient polling): -if\n"
        );

        let exif_conflict = cmd_media_doc(
            "exiftool",
            &media_args(&["-X", "-T", "a.png"]),
            "",
            "/work",
            &vfs,
        );
        assert_eq!(exif_conflict.exit_code, 1);
        assert_eq!(exif_conflict.stderr, "Error: Conflicting ExifTool output modes\n");

        let unite_ver = cmd_media_doc("pdfunite", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(unite_ver.exit_code, 0);
        assert_eq!(unite_ver.stderr, "pdfunite version 24.08.0\n");

        let sep_ver = cmd_media_doc("pdfseparate", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(sep_ver.exit_code, 0);
        assert_eq!(sep_ver.stderr, "pdfseparate version 24.08.0\n");

        let detach_ver = cmd_media_doc("pdfdetach", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(detach_ver.exit_code, 0);
        assert_eq!(detach_ver.stdout, "pdfdetach version 24.08.0\n");

        let info_ver = cmd_media_doc("pdfinfo", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(info_ver.exit_code, 0);
        assert_eq!(info_ver.stdout, "pdfinfo version 26.09.90 (@poe-code/pdf-ast)\n");

        let fonts_ver = cmd_media_doc("pdffonts", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(fonts_ver.exit_code, 0);
        assert_eq!(fonts_ver.stdout, "pdffonts version 24.08.0\n");

        let imgs_ver = cmd_media_doc("pdfimages", &media_args(&["-v"]), "", "/work", &vfs);
        assert_eq!(imgs_ver.exit_code, 0);
        assert_eq!(imgs_ver.stdout, "pdfimages version 24.08.0\n");

        let cmp_help = cmd_media_doc("compare", &media_args(&["-help"]), "", "/work", &vfs);
        assert_eq!(cmp_help.exit_code, 0);
        assert_eq!(
            cmp_help.stdout,
            "Usage: compare [-metric AE|MAE|MSE|RMSE|PSNR|SSIM|PAE|NCC] [-fuzz value%] [-highlight-color color] [-lowlight-color color] reference.png candidate.png diff.png\n"
        );
    }
}
