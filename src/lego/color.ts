/**
 * Color science for the mosaic pipeline.
 *
 * Two things here are load-bearing and easy to get subtly wrong:
 *
 * 1. The sRGB transfer function is the real piecewise IEC 61966-2-1 curve,
 *    not `pow(c, 2.2)`. Downsampling averages in linear light (see frame.ts),
 *    and the approximation biases every average.
 * 2. `deltaE2000` is CIEDE2000, verified against the Sharma/Wu/Dalal reference
 *    dataset in color.ciede2000.test.ts. A wrong implementation still returns
 *    plausible-looking numbers, so that test is the only thing standing
 *    between us and quietly bad color matching.
 */

/** Non-linear sRGB, 0-255 per channel. */
export type Rgb = readonly [number, number, number];
/** Linear-light RGB, 0-1 per channel. */
export type LinearRgb = readonly [number, number, number];
/** CIE XYZ, D65, Y normalized to 1. */
export type Xyz = readonly [number, number, number];
/** CIE L*a*b*, D65. */
export type Lab = readonly [number, number, number];

/** D65 white point, 2-degree observer. */
const WHITE_D65: Xyz = [0.95047, 1.0, 1.08883];

const DEG = Math.PI / 180;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

// ---------------------------------------------------------------------------
// Transfer function
// ---------------------------------------------------------------------------

/** sRGB (0-1) to linear light (0-1). */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear light (0-1) to sRGB (0-1). */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** 0-255 sRGB to linear-light 0-1. */
export function rgb255ToLinear(rgb: Rgb): LinearRgb {
  return [
    srgbToLinear(rgb[0] / 255),
    srgbToLinear(rgb[1] / 255),
    srgbToLinear(rgb[2] / 255),
  ];
}

/** Linear-light 0-1 to 0-255 sRGB, clamped and rounded. */
export function linearToRgb255(lin: LinearRgb): Rgb {
  return [
    Math.round(clamp(linearToSrgb(lin[0]), 0, 1) * 255),
    Math.round(clamp(linearToSrgb(lin[1]), 0, 1) * 255),
    Math.round(clamp(linearToSrgb(lin[2]), 0, 1) * 255),
  ];
}

// ---------------------------------------------------------------------------
// Lab
// ---------------------------------------------------------------------------

export function linearRgbToXyz(lin: LinearRgb): Xyz {
  const [r, g, b] = lin;
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

export function xyzToLinearRgb(xyz: Xyz): LinearRgb {
  const [x, y, z] = xyz;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const LAB_EPS = 216 / 24389; // (6/29)^3
const LAB_KAPPA = 24389 / 27; // (29/3)^3

export function xyzToLab(xyz: Xyz): Lab {
  const f = (t: number): number =>
    t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;

  const fx = f(xyz[0] / WHITE_D65[0]);
  const fy = f(xyz[1] / WHITE_D65[1]);
  const fz = f(xyz[2] / WHITE_D65[2]);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToXyz(lab: Lab): Xyz {
  const [l, a, b] = lab;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const inv = (t: number): number => {
    const t3 = t * t * t;
    return t3 > LAB_EPS ? t3 : (116 * t - 16) / LAB_KAPPA;
  };

  return [
    inv(fx) * WHITE_D65[0],
    (l > 8 ? Math.pow(fy, 3) : l / LAB_KAPPA) * WHITE_D65[1],
    inv(fz) * WHITE_D65[2],
  ];
}

/** 0-255 sRGB to Lab. */
export function rgbToLab(rgb: Rgb): Lab {
  return xyzToLab(linearRgbToXyz(rgb255ToLinear(rgb)));
}

/** Lab to 0-255 sRGB, clamped into gamut. */
export function labToRgb(lab: Lab): Rgb {
  return linearToRgb255(xyzToLinearRgb(labToXyz(lab)));
}

/** Linear-light RGB straight to Lab, skipping the 0-255 round trip. */
export function linearRgbToLab(lin: LinearRgb): Lab {
  return xyzToLab(linearRgbToXyz(lin));
}

// ---------------------------------------------------------------------------
// CIEDE2000
// ---------------------------------------------------------------------------

/**
 * CIEDE2000 color difference.
 *
 * Preferred over the plain Euclidean ΔE*76 because mosaics are dominated by
 * near-neutral colors — skin, sky, concrete, shadow — which is exactly the
 * region where ΔE76 misjudges distance and picks visibly wrong bricks.
 *
 * Implements Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference
 * Formula: Implementation Notes, Supplementary Test Data, and Mathematical
 * Observations", including its hue-angle discontinuity handling.
 */
export function deltaE2000(lab1: Lab, lab2: Lab, kL = 1, kC = 1, kH = 1): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar = (c1 + c2) / 2;

  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 6103515625))); // 25^7

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;

  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);

  // Hue angle in degrees, [0, 360). Undefined (taken as 0) for achromatic
  // colors; guarded explicitly because atan2(-0, -0) is not 0.
  const hue = (ap: number, bp: number): number => {
    if (ap === 0 && bp === 0) return 0;
    const h = Math.atan2(bp, ap) / DEG;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;

  const cProduct = c1p * c2p;

  let dhp: number;
  if (cProduct === 0) {
    dhp = 0;
  } else {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) dhp = diff;
    else if (diff > 180) dhp = diff - 360;
    else dhp = diff + 360;
  }
  const dHp = 2 * Math.sqrt(cProduct) * Math.sin((dhp / 2) * DEG);

  const lBarP = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBarP: number;
  if (cProduct === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * DEG) +
    0.24 * Math.cos(2 * hBarP * DEG) +
    0.32 * Math.cos((3 * hBarP + 6) * DEG) -
    0.2 * Math.cos((4 * hBarP - 63) * DEG);

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rC = 2 * Math.sqrt(cBarP7 / (cBarP7 + 6103515625));
  const rT = -Math.sin(2 * dTheta * DEG) * rC;

  const lBarP50 = Math.pow(lBarP - 50, 2);
  const sL = 1 + (0.015 * lBarP50) / Math.sqrt(20 + lBarP50);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;

  const termL = dLp / (kL * sL);
  const termC = dCp / (kC * sC);
  const termH = dHp / (kH * sH);

  return Math.sqrt(termL * termL + termC * termC + termH * termH + rT * termC * termH);
}

// ---------------------------------------------------------------------------
// Hex and shading
// ---------------------------------------------------------------------------

const HEX_RE = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(hex: string): boolean {
  return HEX_RE.test(hex);
}

export function hexToRgb(hex: string): Rgb {
  if (!isValidHex(hex)) throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const full =
    h.length === 3 ? `${h[0]!}${h[0]!}${h[1]!}${h[1]!}${h[2]!}${h[2]!}` : h.toLowerCase();
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex(rgb: Rgb): string {
  const hex = (v: number): string =>
    clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`.toUpperCase();
}

/**
 * Darken a color by interpolating it toward black in Lab. Used by the renderer
 * for brick outlines and course seams, where the shade must stay recognisably
 * the same color — scaling RGB channels instead shifts hue on saturated bricks.
 *
 * L, a, and b are all scaled, rather than lightness alone. Holding chroma
 * fixed while dropping lightness walks straight out of the sRGB gamut, and the
 * clamp back in produces a color that is neither dark nor the right hue: a full
 * darken of #C91A09 lands on #4E0000 rather than black. Scaling together keeps
 * the hue angle (a/b ratio) exact and stays in gamut throughout.
 *
 * @param amount 0 leaves the color alone, 1 takes it to black.
 */
export function darkenLab(rgb: Rgb, amount: number): Rgb {
  if (amount <= 0) return rgb;
  if (amount >= 1) return [0, 0, 0];
  const t = 1 - amount;
  const [l, a, b] = rgbToLab(rgb);
  return labToRgb([l * t, a * t, b * t]);
}
