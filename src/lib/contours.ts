import type { Point } from "./fourier";

export type RasterOptions = { threshold: number; invert: boolean; maxDimension?: number };

export async function decodeImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be opened. Try a PNG, JPG or SVG file.")); };
    image.src = url;
  });
}

/** Read SVG path geometry with native browser APIs. Scripts and external assets are never executed. */
export async function extractSvgContour(file: File, maxPoints = 12000): Promise<Point[]> {
  const text = await file.text();
  const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("The SVG file is invalid.");
  const root = parsed.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
  const width = Number.parseFloat(root.getAttribute("width") ?? "1000");
  const height = Number.parseFloat(root.getAttribute("height") ?? "1000");
  const vb = viewBox && viewBox.length === 4 && viewBox.every(Number.isFinite) ? viewBox : [0, 0, width || 1000, height || 1000];
  const temp = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  temp.setAttribute("viewBox", vb.join(" "));
  temp.setAttribute("width", "1000");
  temp.setAttribute("height", "1000");
  temp.style.position = "fixed";
  temp.style.left = "-10000px";
  temp.style.top = "0";
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const shapes = Array.from(parsed.querySelectorAll("path,polyline,polygon,line,rect,circle,ellipse"));
  for (const el of shapes) {
    const clone = document.importNode(el, true);
    clone.removeAttribute("style");
    clone.setAttribute("fill", "none");
    clone.setAttribute("stroke", "#000");
    clone.setAttribute("stroke-width", "1");
    group.appendChild(clone);
  }
  if (!group.childElementCount) throw new Error("No SVG paths or basic shapes were found in this file.");
  temp.appendChild(group);
  document.body.appendChild(temp);
  try {
    const candidates: Array<{ points: Point[]; length: number }> = [];
    for (const element of Array.from(group.children)) {
      const path = element as SVGGeometryElement;
      if (typeof path.getTotalLength !== "function") continue;
      try {
        const length = path.getTotalLength();
        if (!Number.isFinite(length) || length < 1) continue;
        const count = Math.max(32, Math.min(maxPoints, Math.ceil(length / Math.max(0.5, length / 1200))));
        const points: Point[] = [];
        for (let i = 0; i < count; i++) {
          const p = path.getPointAtLength((i / count) * length);
          points.push({ x: (p.x - vb[0]) / vb[2], y: (p.y - vb[1]) / vb[3] });
        }
        candidates.push({ points, length });
      } catch { /* Ignore geometry unsupported by this browser. */ }
    }
    candidates.sort((a, b) => b.length - a.length);
    if (!candidates.length) throw new Error("No measurable SVG path was found.");
    return candidates[0].points;
  } finally {
    temp.remove();
  }
}

/** Threshold an image, keep its largest connected foreground component, and trace the boundary. */
export async function extractRasterContour(file: File, options: RasterOptions): Promise<Point[]> {
  const image = await decodeImage(file);
  const maxDimension = options.maxDimension ?? 420;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser does not support the required canvas operations.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  let pixels: ImageData;
  try { pixels = context.getImageData(0, 0, width, height); }
  catch { throw new Error("The image could not be read by the browser."); }

  const binary = new Uint8Array(width * height);
  let foreground = 0;
  for (let i = 0; i < binary.length; i++) {
    const grey = pixels.data[i * 4] * 0.299 + pixels.data[i * 4 + 1] * 0.587 + pixels.data[i * 4 + 2] * 0.114;
    const selected = options.invert ? grey >= options.threshold : grey < options.threshold;
    binary[i] = selected ? 1 : 0;
    if (selected) foreground++;
  }
  if (foreground < 10 || foreground > binary.length * 0.98) {
    throw new Error("The threshold did not isolate a useful shape. Adjust the threshold or invert the foreground/background setting.");
  }

  // Find the largest 8-connected component using an iterative flood fill.
  const seen = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  let best: number[] = [];
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || seen[i]) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    const component: number[] = [];
    while (head < tail) {
      const index = queue[head++];
      component.push(index);
      const x = index % width, y = Math.floor(index / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (binary[next] && !seen[next]) { seen[next] = 1; queue[tail++] = next; }
      }
    }
    if (component.length > best.length) best = component;
  }
  if (best.length < 10) throw new Error("No sufficiently large shape was found. Try a darker outline or another threshold.");
  const mask = new Uint8Array(binary.length);
  for (const index of best) mask[index] = 1;
  const boundary: Point[] = [];
  for (const index of best) {
    const x = index % width, y = Math.floor(index / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width]) {
      boundary.push({ x, y });
    }
  }
  if (boundary.length < 3) throw new Error("Could not find a closed boundary for this image.");
  // Sort by polar angle around the centroid. This is a fast approximation suitable for compact,
  // near-convex silhouettes; use an SVG path for highly concave shapes.
  const cx = boundary.reduce((sum, p) => sum + p.x, 0) / boundary.length;
  const cy = boundary.reduce((sum, p) => sum + p.y, 0) / boundary.length;
  boundary.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  return boundary.map((p) => ({ x: p.x / width, y: p.y / height }));
}

export function makeDemoContour(count = 700): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * 2 * Math.PI;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    points.push({ x: 0.5 + x / 36, y: 0.5 - y / 34 });
  }
  return points;
}
