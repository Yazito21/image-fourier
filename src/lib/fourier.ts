export type Point = { x: number; y: number };
export type FourierTerm = { frequency: number; re: number; im: number; amplitude: number; phase: number };
export type Complex = { re: number; im: number };

/** Radix-2 Cooley–Tukey FFT. Input length must be a power of two. */
export function fft(input: Complex[]): Complex[] {
  const n = input.length;
  if (n < 1 || (n & (n - 1)) !== 0) throw new Error("FFT input length must be a positive power of two.");
  const out = input.map((v) => ({ re: v.re, im: v.im }));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [out[i], out[j]] = [out[j], out[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr0 = Math.cos(angle), wi0 = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = out[i + j], v = out[i + j + len / 2];
        const vr = v.re * wr - v.im * wi, vi = v.re * wi + v.im * wr;
        out[i + j] = { re: u.re + vr, im: u.im + vi };
        out[i + j + len / 2] = { re: u.re - vr, im: u.im - vi };
        const nextWr = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nextWr;
      }
    }
  }
  return out;
}

export function nextPowerOfTwo(value: number): number {
  let n = 1;
  while (n < value) n <<= 1;
  return n;
}

/** Resample a closed contour at approximately equal arc-length intervals. */
export function resampleClosedContour(points: Point[], count: number): Point[] {
  if (points.length < 3) throw new Error("At least three contour points are required.");
  const compact: Point[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = compact[compact.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 1e-4) compact.push(p);
  }
  if (compact.length < 3) throw new Error("The selected contour contains too few unique points.");
  if (Math.hypot(compact[0].x - compact[compact.length - 1].x, compact[0].y - compact[compact.length - 1].y) < 1e-4) compact.pop();

  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < compact.length; i++) {
    const a = compact[i], b = compact[(i + 1) % compact.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
    cumulative.push(total);
  }
  if (total <= 0) throw new Error("The contour has zero length.");

  const out: Point[] = [];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const target = (i / count) * total;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment++;
    const startDistance = segment === 0 ? 0 : cumulative[segment - 1];
    const segmentLength = cumulative[segment] - startDistance;
    const ratio = segmentLength > 0 ? (target - startDistance) / segmentLength : 0;
    const a = compact[segment], b = compact[(segment + 1) % compact.length];
    out.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio });
  }
  return out;
}

/** Calculate normalized DFT coefficients and sort by visual importance (radius). */
export function calculateFourier(points: Point[], sampleCount = 1024): FourierTerm[] {
  const size = Math.min(4096, Math.max(64, nextPowerOfTwo(sampleCount)));
  const sampled = resampleClosedContour(points, size);
  const meanX = sampled.reduce((sum, p) => sum + p.x, 0) / size;
  const meanY = sampled.reduce((sum, p) => sum + p.y, 0) / size;
  // Image y is downwards. Map it to a Cartesian complex plane.
  const transformed = fft(sampled.map((p) => ({ re: p.x - meanX, im: -(p.y - meanY) })));
  const terms: FourierTerm[] = transformed.map((c, index) => {
    const frequency = index <= size / 2 ? index : index - size;
    const re = c.re / size;
    const im = -c.im / size;
    return { frequency, re, im, amplitude: Math.hypot(re, im), phase: Math.atan2(im, re) };
  });
  return terms.sort((a, b) => b.amplitude - a.amplitude);
}

export function endpoint(terms: FourierTerm[], t: number, count: number) {
  let x = 0, y = 0;
  const chain: Array<{ x: number; y: number; radius: number; frequency: number }> = [];
  for (const term of terms.slice(0, count)) {
    chain.push({ x, y, radius: term.amplitude, frequency: term.frequency });
    const angle = 2 * Math.PI * term.frequency * t + term.phase;
    x += term.amplitude * Math.cos(angle);
    y += term.amplitude * Math.sin(angle);
  }
  return { x, y, chain };
}

export function reconstruct(terms: FourierTerm[], count: number, pointCount = 1024): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    const p = endpoint(terms, i / pointCount, count);
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

/** Percentage of Fourier signal energy discarded by keeping only the strongest coefficients.
 * Parseval's theorem makes this a stable truncation-error estimate independent of contour ordering.
 */
export function fourierEnergyError(terms: FourierTerm[], count: number): number {
  const total = terms.reduce((sum, term) => sum + term.amplitude * term.amplitude, 0);
  if (total <= 0) return 0;
  const kept = terms.slice(0, Math.max(0, count)).reduce((sum, term) => sum + term.amplitude * term.amplitude, 0);
  return 100 * Math.sqrt(Math.max(0, total - kept) / total);
}

/** Normalized RMS pointwise reconstruction error, expressed as a percentage. */
export function normalizedRmsError(original: Point[], reconstructed: Point[]): number {
  const n = Math.min(original.length, reconstructed.length);
  if (!n) return 0;
  const mx = original.slice(0, n).reduce((s, p) => s + p.x, 0) / n;
  const my = original.slice(0, n).reduce((s, p) => s + p.y, 0) / n;
  let residual = 0, variance = 0;
  for (let i = 0; i < n; i++) {
    residual += (original[i].x - mx - reconstructed[i].x) ** 2 + (original[i].y - my - reconstructed[i].y) ** 2;
    variance += (original[i].x - mx) ** 2 + (original[i].y - my) ** 2;
  }
  return variance > 0 ? 100 * Math.sqrt(residual / variance) : 0;
}
