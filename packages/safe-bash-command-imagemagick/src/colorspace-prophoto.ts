export function convertProPhoto(red: number, green: number, blue: number, inverse: boolean): [number, number, number] {
    // ImageMagick uses the sRGB transfer curve for ProPhoto in both directions.
    const [r, g, b] = [red, green, blue].map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) as [number, number, number];
    const [x, y, z] = inverse ? [
        0.7977604896723027 * r + 0.13518583717574031 * g + 0.03134934958152480 * b,
        0.2880711282292934 * r + 0.71184321781010140 * g + 0.00008565396060525902 * b,
        0.8251046025104601 * b,
    ] : [
        0.412395588967414 * r + 0.357583430763715 * g + 0.180492647381701 * b,
        0.212586230785596 * r + 0.715170303703411 * g + 0.0722004986433362 * b,
        0.0192972154917469 * r + 0.119183864580849 * g + 0.95049712513158 * b,
    ];
    const linear = inverse ? [
        3.24096994190452 * x! - 1.53738317757009 * y! - 0.498610760293003 * z!,
        -0.96924363628088 * x! + 1.87596750150772 * y! + 0.0415550574071756 * z!,
        0.0556300796969937 * x! - 0.203976958888977 * y! + 1.05697151424288 * z!,
    ] : [
        1.3457989731028281 * x! - 0.25558010007997534 * y! - 0.05110628506753401 * z!,
        -0.5446224939028347 * x! + 1.5082327413132781 * y! + 0.02053603239147973 * z!,
        1.2119675456389454 * z!,
    ];
    // Native XYZ-to-sRGB shifts negative channels together before gamma encoding.
    const minimum = inverse ? Math.min(0, ...linear) : 0;
    return linear.map(sample => {
        const value = sample - minimum;
        return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    }) as [number, number, number];
}
