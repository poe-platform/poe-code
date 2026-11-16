// Export the existing PDF paint events as SVG vectors and embedded image samples.
use super::{
    BlendMode, Draw, Image, ImageStream, PageSource, Point, RasterBackend, RasterOptions, Value,
    device_cmyk, pdf_glyph, pdf_group, pdf_stroke,
};
use std::collections::BTreeMap;

fn number(n: f64) -> String {
    crate::commands::archive::svg_format_num(n, 6)
}
fn matrix(m: [f64; 6]) -> String {
    m.map(number).join(" ")
}
fn color(rgb: [f64; 3]) -> String {
    let [r, g, b] = rgb.map(|v| (v.clamp(0., 1.) * 255.).round() as u8);
    format!("rgb({r},{g},{b})")
}
fn blend(mode: BlendMode) -> &'static str {
    match mode {
        BlendMode::Normal => "normal",
        BlendMode::Multiply => "multiply",
        BlendMode::Screen => "screen",
        BlendMode::Overlay => "overlay",
        BlendMode::Darken => "darken",
        BlendMode::Lighten => "lighten",
        BlendMode::ColorDodge => "color-dodge",
        BlendMode::ColorBurn => "color-burn",
        BlendMode::HardLight => "hard-light",
        BlendMode::SoftLight => "soft-light",
        BlendMode::Difference => "difference",
        BlendMode::Exclusion => "exclusion",
        BlendMode::Hue => "hue",
        BlendMode::Saturation => "saturation",
        BlendMode::Color => "color",
        BlendMode::Luminosity => "luminosity",
    }
}
struct Writer {
    xml: String,
    limit: usize,
    work: usize,
    next: usize,
}
impl Writer {
    fn push(&mut self, s: &str) -> Option<()> {
        if s.len() > self.limit.checked_sub(self.xml.len())? {
            return None;
        }
        self.xml.push_str(s);
        Some(())
    }
    fn id(&mut self) -> usize {
        let id = self.next;
        self.next += 1;
        id
    }
    fn gradient_stops(&mut self, shading: &super::pdf_axial_shading::Axial) -> Option<()> {
        let mut intervals: Vec<_> = (0..256)
            .rev()
            .map(|i| (f64::from(i) / 256., f64::from(i + 1) / 256., 0u8))
            .collect();
        let start = shading.color(0.)?.map(|v| f64::from(v) / 255.);
        self.push(&format!(
            "<stop offset=\"0\" stop-color=\"{}\"/>",
            color(start)
        ))?;
        while let Some((a, b, depth)) = intervals.pop() {
            self.work = self.work.checked_sub(5)?;
            let ca = shading.color(a)?;
            let cb = shading.color(b)?;
            let mut split = false;
            for t in [0.25, 0.5, 0.75] {
                let sampled = shading.color(a + (b - a) * t)?;
                split |= (0..3).any(|i| {
                    (f64::from(sampled[i]) - (f64::from(ca[i]) * (1. - t) + f64::from(cb[i]) * t))
                        .abs()
                        > 1.
                });
            }
            // Refine sharp exponential functions without allocating an unbounded table.
            if split && depth < 32 {
                let middle = (a + b) / 2.;
                intervals.push((middle, b, depth + 1));
                intervals.push((a, middle, depth + 1));
            } else {
                self.push(&format!(
                    "<stop offset=\"{b}\" stop-color=\"{}\"/>",
                    color(cb.map(|v| f64::from(v) / 255.))
                ))?;
            }
        }
        Some(())
    }
    fn open(&mut self, state: &State) -> Option<usize> {
        for id in &state.clips {
            self.push(&format!("<g clip-path=\"url(#c{id})\">"))?;
        }
        if let Some(id) = state.mask {
            self.push(&format!("<g mask=\"url(#m{id})\">"))?;
        }
        if state.blend != BlendMode::Normal {
            self.push(&format!(
                "<g style=\"mix-blend-mode:{}\">",
                blend(state.blend)
            ))?;
        }
        Some(
            state.clips.len()
                + usize::from(state.mask.is_some())
                + usize::from(state.blend != BlendMode::Normal),
        )
    }
    fn close(&mut self, count: usize) -> Option<()> {
        for _ in 0..count {
            self.push("</g>")?;
        }
        Some(())
    }
    fn paint(&mut self, state: &State, body: &str) -> Option<()> {
        let n = self.open(state)?;
        self.push(body)?;
        self.close(n)
    }
    fn clip(&mut self, path: &str, even: bool) -> Option<usize> {
        let id = self.id();
        self.push(&format!("<defs><clipPath id=\"c{id}\" clipPathUnits=\"userSpaceOnUse\"><path d=\"{path}\" clip-rule=\"{}\"/></clipPath></defs>",if even {"evenodd"}else{"nonzero"}))?;
        Some(id)
    }
}
#[derive(Clone)]
struct State {
    fill: [f64; 3],
    stroke: [f64; 3],
    fill_space: usize,
    stroke_space: usize,
    fill_alpha: f64,
    stroke_alpha: f64,
    style: pdf_stroke::Stroke,
    clips: Vec<usize>,
    mask: Option<usize>,
    blend: BlendMode,
}
impl Default for State {
    fn default() -> Self {
        Self {
            fill: [0.; 3],
            stroke: [0.; 3],
            fill_space: 1,
            stroke_space: 1,
            fill_alpha: 1.,
            stroke_alpha: 1.,
            style: pdf_stroke::Stroke::default(),
            clips: vec![],
            mask: None,
            blend: BlendMode::Normal,
        }
    }
}
#[derive(Default)]
struct Path {
    data: String,
    contours: Vec<Vec<Point>>,
}
impl Path {
    fn point(&mut self, op: char, p: Point, out: &mut Writer) -> Option<()> {
        if !p.iter().all(|v| v.is_finite()) {
            return None;
        }
        out.work = out.work.checked_sub(1)?;
        if self.data.len() > out.limit.saturating_sub(64) {
            return None;
        }
        self.data
            .push_str(&format!("{op}{} {} ", number(p[0]), number(p[1])));
        if op == 'M' {
            self.contours.push(vec![p]);
        } else {
            self.contours.last_mut()?.push(p);
        }
        Some(())
    }
    fn close(&mut self) -> Option<()> {
        self.data.push_str("Z ");
        let path = self.contours.last_mut()?;
        path.push(*path.first()?);
        Some(())
    }
    fn curve(&mut self, a: Point, b: Point, end: Point, out: &mut Writer) -> Option<()> {
        if !a
            .iter()
            .chain(b.iter())
            .chain(end.iter())
            .all(|v| v.is_finite())
        {
            return None;
        }
        if self.data.len() > out.limit.saturating_sub(200) {
            return None;
        }
        self.data.push_str(&format!(
            "C{} {} {} {} {} {} ",
            number(a[0]),
            number(a[1]),
            number(b[0]),
            number(b[1]),
            number(end[0]),
            number(end[1])
        ));
        let path = self.contours.last_mut()?;
        pdf_glyph::cubic(path, *path.last()?, a, b, end, &mut out.work)
    }
}
fn contours(paths: &[Vec<Point>], out: &mut Writer) -> Option<String> {
    let mut result = String::new();
    for path in paths {
        for (i, p) in path.iter().enumerate() {
            out.work = out.work.checked_sub(1)?;
            if result.len() > out.limit.saturating_sub(64) {
                return None;
            }
            result.push_str(&format!(
                "{}{} {} ",
                if i == 0 { 'M' } else { 'L' },
                number(p[0]),
                number(p[1])
            ));
        }
        result.push_str("Z ");
    }
    Some(result)
}
fn fill(
    out: &mut Writer,
    state: &State,
    data: &str,
    rgb: [f64; 3],
    alpha: f64,
    even: bool,
) -> Option<()> {
    if data.is_empty() {
        return Some(());
    }
    out.paint(
        state,
        &format!(
            "<path d=\"{data}\" fill=\"{}\" fill-opacity=\"{}\" fill-rule=\"{}\"/>",
            color(rgb),
            number(alpha),
            if even { "evenodd" } else { "nonzero" }
        ),
    )
}
struct Form {
    state: State,
    path: Path,
    stack: Vec<State>,
    pending: Option<bool>,
    text: Option<String>,
    wrappers: usize,
    group: bool,
    mask: Option<usize>,
    nonisolated: bool,
}
impl PageSource<'_> {
    pub(in crate::commands::archive) fn svg(
        &mut self,
        pno: usize,
        opt: &RasterOptions<'_>,
    ) -> Option<Vec<u8>> {
        let page = self
            .objects
            .page_dict(*self.pages.get(pno.checked_sub(1)?)?, &self.tree)?;
        let (mut media, mut crop, mut rotation) = (None, None, None);
        let mut node = &page;
        for _ in 0..128 {
            for (key, target) in [
                (b"MediaBox".as_slice(), &mut media),
                (b"CropBox", &mut crop),
            ] {
                if target.is_none() {
                    *target = node
                        .get(key)
                        .and_then(|v| self.objects.resolve(v))
                        .and_then(|v| v.rectangle(Value::poppler_number));
                }
            }
            if rotation.is_none() {
                rotation = node
                    .get(b"Rotate")
                    .and_then(|v| self.objects.resolve(v))
                    .and_then(|v| v.number());
            }
            let Some(parent) = node
                .get(b"Parent")
                .and_then(Value::reference)
                .and_then(|id| self.tree.get(&id))
                .and_then(Option::as_ref)
            else {
                break;
            };
            node = parent;
        }
        let [x0, y0, x1, y1] = media.unwrap_or([0., 0., 612., 792.]);
        let (ox, oy, pw, ph) = (x0.min(x1), y0.min(y1), (x1 - x0).abs(), (y1 - y0).abs());
        if ![ox, oy, pw, ph].iter().all(|n| n.is_finite()) || pw <= 0. || ph <= 0. {
            return None;
        }
        let rotation = (rotation.unwrap_or(0.) as i32).rem_euclid(360);
        let quarter = matches!(rotation, 90 | 270);
        let viewport = match rotation {
            90 => [0., 1., 1., 0., -oy, -ox],
            180 => [-1., 0., 0., 1., ox + pw, -oy],
            270 => [0., -1., -1., 0., oy + ph, ox + pw],
            _ => [1., 0., 0., -1., -ox, oy + ph],
        };
        let point = |x: f64, y: f64| {
            [
                viewport[0] * x + viewport[2] * y + viewport[4],
                viewport[1] * x + viewport[3] * y + viewport[5],
            ]
        };
        let boxpt = if opt.cropbox {
            let [a, b, c, d] = crop.unwrap_or([ox, oy, ox + pw, oy + ph]);
            [
                a.min(c).clamp(ox, ox + pw),
                b.min(d).clamp(oy, oy + ph),
                a.max(c).clamp(ox, ox + pw),
                b.max(d).clamp(oy, oy + ph),
            ]
        } else {
            [ox, oy, ox + pw, oy + ph]
        };
        let mut scale = opt.dpi.map(|v| v / 72.);
        let [maximum, mut tx, mut ty] = opt.scale;
        if quarter && (opt.scale_before_rotation || opt.backend == RasterBackend::Cairo) {
            std::mem::swap(&mut tx, &mut ty);
        }
        let size = [boxpt[2] - boxpt[0], boxpt[3] - boxpt[1]];
        if maximum > 0 {
            scale = [maximum as f64 / size[0].max(size[1]); 2];
        } else {
            if tx > 0 {
                scale[0] = tx as f64 / size[0];
                if ty < 0 {
                    scale[1] = scale[0];
                }
            }
            if ty > 0 {
                scale[1] = ty as f64 / size[1];
                if tx < 0 {
                    scale[0] = scale[1];
                }
            }
        }
        if quarter {
            scale.swap(0, 1);
        }
        if !scale.iter().all(|s| s.is_finite() && *s > 0.) {
            return None;
        }
        let a = point(boxpt[0], boxpt[1]);
        let b = point(boxpt[2], boxpt[3]);
        let [cx, cy, cw, ch] = opt.crop;
        let vx = a[0].min(b[0]) + cx / scale[0];
        let vy = a[1].min(b[1]) + cy / scale[1];
        let vw = if cw > 0. {
            cw / scale[0]
        } else {
            ((b[0] - a[0]).abs() - cx / scale[0]).max(1.)
        };
        let vh = if ch > 0. {
            ch / scale[1]
        } else {
            ((b[1] - a[1]).abs() - cy / scale[1]).max(1.)
        };
        let width = if opt.backend == RasterBackend::Cairo {
            format!("{}pt", number(vw))
        } else {
            number((vw * scale[0]).round())
        };
        let height = if opt.backend == RasterBackend::Cairo {
            format!("{}pt", number(vh))
        } else {
            number((vh * scale[1]).round())
        };
        let mut out = Writer {
            xml: String::new(),
            limit: opt.limit,
            work: opt.limit.saturating_mul(4),
            next: 0,
        };
        out.push(&format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"{} {} {} {}\">",number(vx),number(vy),number(vw),number(vh)))?;
        if !opt.transparent {
            out.push(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"white\"/>",
                number(vx),
                number(vy),
                number(vw),
                number(vh)
            ))?;
        }
        out.push(&format!(
            "<g style=\"isolation:isolate\" transform=\"matrix({})\">",
            matrix(viewport)
        ))?;
        let (mut state, mut path, mut stack, mut forms, mut pending, mut text_clip) = (
            State::default(),
            Path::default(),
            vec![],
            Vec::<Form>::new(),
            None,
            None::<String>,
        );
        let mut faces = BTreeMap::new();
        let mut backdrop = false;
        self.draw_page(&page,!opt.hide_annotations,|event,objects|{
            out.work=out.work.checked_sub(1)?;
            let (op,args,ctm)=match event{
                Draw::Transparency{fill,stroke,blend}=>{
                    if let Some(v)=fill{state.fill_alpha=v;}
                    if let Some(v)=stroke{state.stroke_alpha=v;}
                    if let Some(v)=blend{state.blend=v;}
                    if forms.iter().any(|f|f.nonisolated)&&(state.blend!=BlendMode::Normal||state.fill_alpha<1.||state.stroke_alpha<1.){backdrop=true;}
                    return Some(());
                }
                Draw::ClearMask=>{state.mask=None;return Some(());}
                Draw::BeginForm(bounds,ctm,group,mask)=>{
                    if forms.len()>=128{return None;}
                    let isolated=match group {Some(v)=>Some(pdf_group::read(objects,&v)?),None=>None};
                    let id=mask.as_ref().map(|_|out.id());let mut wrappers=0;
                    if let Some(id)=id{
                        let mask=mask.as_ref()?;
                        out.push(&format!("<defs><mask id=\"m{id}\" maskUnits=\"userSpaceOnUse\" maskContentUnits=\"userSpaceOnUse\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" style=\"mask-type:{}\">",number(ox),number(oy),number(pw),number(ph),if mask.luminosity{"luminance"}else{"alpha"}))?;
                        if mask.luminosity {
                            out.push(&format!("<filter id=\"l{id}\" color-interpolation-filters=\"sRGB\"><feColorMatrix type=\"matrix\" values=\"0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0.3 0.59 0.11 0 0 0 0 0 1 0\"/></filter><g filter=\"url(#l{id})\">"))?;
                        } else {out.push("<g>")?;}
                        if mask.luminosity {out.push(&format!("<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>",number(ox),number(oy),number(pw),number(ph),color(mask.backdrop)))?;}
                    }else if isolated.is_some(){wrappers=out.open(&state)?;out.push(&format!("<g opacity=\"{}\" style=\"isolation:{}\">",number(state.fill_alpha),if isolated==Some(true){"isolate"}else{"auto"}))?;}
                    out.work=out.work.checked_sub(state.clips.len()+state.style.dash.len())?;
                    forms.push(Form{state:state.clone(),path:std::mem::take(&mut path),stack:std::mem::take(&mut stack),pending:pending.take(),text:text_clip.take(),wrappers,group:isolated.is_some(),mask:id,nonisolated:isolated==Some(false)});
                    if isolated.is_some()||id.is_some(){state.fill_alpha=1.;state.stroke_alpha=1.;state.blend=BlendMode::Normal;state.mask=None;state.clips.clear();}
                    let [x0,y0,x1,y1]=bounds;let p=|x,y|[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]];
                    let bounds=contours(&[vec![p(x0,y0),p(x1,y0),p(x1,y1),p(x0,y1)]],&mut out)?;state.clips.push(out.clip(&bounds,false)?);return Some(());
                }
                Draw::EndForm=>{
                    if pending.is_some()||text_clip.is_some(){return None;}
                    let form=forms.pop()?;
                    if form.mask.is_some(){out.push("</g></mask></defs>")?;}else if form.group{out.push("</g>")?;}
                    state=form.state;path=form.path;stack=form.stack;pending=form.pending;text_clip=form.text;
                    if let Some(id)=form.mask{state.mask=Some(id);}else {out.close(form.wrappers)?;}
                    return Some(());
                }
                Draw::Image(stream,ctm,colors)=>{
                    let mut image=Image::read(objects,stream,ctm,opt.limit,super::super::ImageRead::Raster,colors)??;
                    if image.stencil {let rgb=state.fill.map(|v|(v.clamp(0.,1.)*255.).round()as u8);for p in &mut image.pixels{*p=[rgb[0],rgb[1],rgb[2],255-p[0]];}}
                    if let Some(id)=image.mask{
                        let mask=Image::read(objects,ImageStream::Object(id),ctm,opt.limit,super::super::ImageRead::Raster,colors)??;
                        if mask.components!=1{return None;}
                        for(y,row)in image.pixels.chunks_exact_mut(image.width).enumerate(){for(x,p)in row.iter_mut().enumerate(){let v=mask.pixels[(y*mask.height/image.height)*mask.width+x*mask.width/image.width][0];p[3]=if mask.stencil{255-v}else{v};}}
                    }
                    if forms.iter().any(|f|f.nonisolated)&&image.pixels.iter().any(|p|p[3]!=255){backdrop=true;}
                    let png=super::encode(image.width,image.height,&image.pixels,"RGBA","rgb",None)?;
                    if png.len()>out.limit/4*3{return None;}
                    let encoded=crate::commands::archive::base64_encode(&png);let[a,b,c,d,e,f]=ctm;
                    out.paint(&state,&format!("<image width=\"1\" height=\"1\" preserveAspectRatio=\"none\" opacity=\"{}\" transform=\"matrix({})\" href=\"data:image/png;base64,{encoded}\"/>",number(state.fill_alpha),matrix([a,b,-c,-d,e+c,f+d])))?;return Some(());
                }
                Draw::Glyph{code,family,program,matrix:tm,ctm,mode,..}=>{
                    if mode==3{return Some(());}
                    let outline=pdf_glyph::outline(&mut faces,family,program,code,&mut out.work,|x,y|[x*tm[0]+y*tm[2]+tm[4],x*tm[1]+y*tm[3]+tm[5]])?;
                    let data=contours(&outline,&mut out)?;
                    if mode>=4{let text=text_clip.get_or_insert_with(String::new);if data.len()>out.limit.checked_sub(text.len())?{return None;}text.push_str(&data);}
                    if matches!(mode,0|2|4|6){fill(&mut out,&state,&data,state.fill,state.fill_alpha,false)?;}
                    if matches!(mode,1|2|5|6){let stroke=super::pdf_text_stroke::outline(&outline,&state.style,[ctm[0],ctm[1],ctm[2],ctm[3]],&mut out.work)?;let data=contours(&stroke,&mut out)?;fill(&mut out,&state,&data,state.stroke,state.stroke_alpha,false)?;}
                    return Some(());
                }
                Draw::Shading(value,ctm)=>{
                    let shading=super::pdf_axial_shading::Axial::read(objects,&value)?;
                    let[a,b,c,d,e,f]=ctm;let det=a*d-b*c;
                    if !det.is_finite()||det==0.{return None;}
                    let inverse=|x:f64,y:f64|[(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det];
                    let [x0,y0,x1,y1]=shading.coords;let(dx,dy)=(x1-x0,y1-y0);let length=dx*dx+dy*dy;
                    let mut along=[f64::INFINITY,f64::NEG_INFINITY];let mut across=along;
                    for p in [inverse(ox,oy),inverse(ox+pw,oy),inverse(ox+pw,oy+ph),inverse(ox,oy+ph)]{
                        let u=((p[0]-x0)*dx+(p[1]-y0)*dy)/length;let v=(-(p[0]-x0)*dy+(p[1]-y0)*dx)/length;
                        along=[along[0].min(u),along[1].max(u)];across=[across[0].min(v),across[1].max(v)];
                    }
                    if !shading.extend[0]{along[0]=along[0].max(0.);}
                    if !shading.extend[1]{along[1]=along[1].min(1.);}
                    if along[0]>=along[1]{return Some(());}
                    let id=out.id();out.push(&format!("<defs><linearGradient id=\"g{id}\" gradientUnits=\"userSpaceOnUse\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" gradientTransform=\"matrix({})\">",number(x0),number(y0),number(x1),number(y1),matrix(ctm)))?;
                    out.gradient_stops(&shading)?;
                    out.push("</linearGradient></defs>")?;
                    let p=|u:f64,v:f64|{let x=x0+u*dx-v*dy;let y=y0+u*dy+v*dx;[a*x+c*y+e,b*x+d*y+f]};
                    let data=contours(&[vec![p(along[0],across[0]),p(along[1],across[0]),p(along[1],across[1]),p(along[0],across[1])]],&mut out)?;
                    let prior=state.clips.len();
                    if let Some([x0,y0,x1,y1])=shading.bbox{let p=|x,y|[a*x+c*y+e,b*x+d*y+f];let data=contours(&[vec![p(x0,y0),p(x1,y0),p(x1,y1),p(x0,y1)]],&mut out)?;state.clips.push(out.clip(&data,false)?);}
                    out.paint(&state,&format!("<path d=\"{data}\" fill=\"url(#g{id})\" fill-opacity=\"{}\"/>",number(state.fill_alpha)))?;state.clips.truncate(prior);return Some(());
                }
                Draw::Operator(op,args,ctm)=>(op,args,ctm),
            };
            let n=|i:usize|{let v=args.get(i)?.poppler_number()?;v.is_finite().then_some(v)};
            let pt=|x,y|[x*ctm[0]+y*ctm[2]+ctm[4],x*ctm[1]+y*ctm[3]+ctm[5]];
            match op{
                b"q"=>{if stack.len()>=256{return None;}out.work=out.work.checked_sub(state.clips.len()+state.style.dash.len())?;stack.push(state.clone());}
                b"Q"=>{if let Some(v)=stack.pop(){state=v;}}
                b"BT"=>{if text_clip.is_some(){return None;}}
                b"ET"=>{if let Some(data)=text_clip.take(){state.clips.push(out.clip(&data,false)?);}}
                b"cs"|b"CS"=>{let space=match args.first()?.word()?{b"/DeviceGray"=>1,b"/DeviceRGB"=>3,b"/DeviceCMYK"=>4,_=>return None};let color=if space==4{device_cmyk([0.,0.,0.,1.])}else{[0.;3]};if op==b"cs"{state.fill_space=space;state.fill=color;}else{state.stroke_space=space;state.stroke=color;}}
                b"rg"|b"RG"|b"g"|b"G"|b"k"|b"K"|b"sc"|b"SC"|b"scn"|b"SCN"=>{
                    let lower=op[0].is_ascii_lowercase();let space=match op{b"g"|b"G"=>1,b"rg"|b"RG"=>3,b"k"|b"K"=>4,_=>if lower{state.fill_space}else{state.stroke_space}};
                    let rgb=match space{4=>device_cmyk([n(0)?,n(1)?,n(2)?,n(3)?]),3=>[n(0)?,n(1)?,n(2)?],_=>[n(0)?;3]};if lower{state.fill=rgb;state.fill_space=space;}else{state.stroke=rgb;state.stroke_space=space;}
                }
                b"w"=>state.style.width=n(0)?,b"J"=>state.style.cap=n(0)?as i32,b"j"=>state.style.join=n(0)?as i32,b"M"=>state.style.miter=n(0)?,b"d"=>state.style.set_dash(args,&mut out.work)?,
                b"m"=>path.point('M',pt(n(0)?,n(1)?),&mut out)?,b"l"=>path.point('L',pt(n(0)?,n(1)?),&mut out)?,
                b"re"=>{let(x,y,w,h)=(n(0)?,n(1)?,n(2)?,n(3)?);for(i,p)in [pt(x,y),pt(x+w,y),pt(x+w,y+h),pt(x,y+h)].into_iter().enumerate(){path.point(if i==0{'M'}else{'L'},p,&mut out)?;}path.close()?;}
                b"h"=>{if !path.contours.is_empty(){path.close()?;}}
                b"c"|b"v"|b"y"=>{let start=*path.contours.last()?.last()?;let(a,b,end)=match op{b"c"=>(pt(n(0)?,n(1)?),pt(n(2)?,n(3)?),pt(n(4)?,n(5)?)),b"v"=>(start,pt(n(0)?,n(1)?),pt(n(2)?,n(3)?)),_=>(pt(n(0)?,n(1)?),pt(n(2)?,n(3)?),pt(n(2)?,n(3)?))};path.curve(a,b,end,&mut out)?;}
                b"W"|b"W*"=>pending=Some(op==b"W*"),
                b"n"|b"f"|b"F"|b"f*"|b"B"|b"B*"|b"b"|b"b*"|b"S"|b"s"=>{
                    if matches!(op,b"s"|b"b"|b"b*")&&!path.contours.is_empty(){path.close()?;}
                    if !matches!(op,b"n"|b"S"|b"s"){fill(&mut out,&state,&path.data,state.fill,state.fill_alpha,op.ends_with(b"*"))?;}
                    if matches!(op,b"S"|b"s"|b"B"|b"B*"|b"b"|b"b*"){
                        let stroke=state.style.outlines(&path.contours,[ctm[0],ctm[1],ctm[2],ctm[3]],false,&mut out.work)?;let data=contours(&stroke,&mut out)?;fill(&mut out,&state,&data,state.stroke,state.stroke_alpha,false)?;
                    }
                    if let Some(even)=pending.take(){state.clips.push(out.clip(&path.data,even)?);}
                    path=Path::default();
                }
                _=>{}
            }
            Some(())
        })?;
        if pending.is_some() || text_clip.is_some() || !forms.is_empty() {
            return None;
        }
        out.push("</g></svg>\n")?;
        if backdrop {
            let options = RasterOptions {
                format: "RGBA",
                backend: RasterBackend::Splash,
                dpi: scale.map(|v| v * 72.),
                scale: [0; 3],
                scale_before_rotation: true,
                ..*opt
            };
            let png = self.raster(pno, &options)?;
            let w = u32::from_be_bytes(png.get(16..20)?.try_into().ok()?);
            let h = u32::from_be_bytes(png.get(20..24)?.try_into().ok()?);
            let encoded = crate::commands::archive::base64_encode(&png);
            out.xml.clear();
            out.push(&format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {w} {h}\"><image width=\"{w}\" height=\"{h}\" href=\"data:image/png;base64,{encoded}\"/></svg>\n"))?;
        }
        Some(out.xml.into_bytes())
    }
}
