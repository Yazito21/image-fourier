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
  // Preserve alpha so transparent logos can be segmented by their visible pixels.
  // Opaque photos/illustrations fall back to luminance thresholding below.
  context.drawImage(image, 0, 0, width, height);
  let pixels: ImageData;
  try { pixels = context.getImageData(0, 0, width, height); }
  catch { throw new Error("The image could not be read by the browser."); }

  const binary = new Uint8Array(width * height);
  let transparentPixels = 0;
  for (let i = 0; i < binary.length; i++) {
    if (pixels.data[i * 4 + 3] < 250) transparentPixels++;
  }
  const hasTransparency = transparentPixels > binary.length * 0.001;
  let foreground = 0;
  for (let i = 0; i < binary.length; i++) {
    const offset = i * 4;
    const grey = pixels.data[offset] * 0.299 + pixels.data[offset + 1] * 0.587 + pixels.data[offset + 2] * 0.114;
    const selected = hasTransparency
      ? pixels.data[offset + 3] > 20
      : (options.invert ? grey >= options.threshold : grey < options.threshold);
    binary[i] = selected ? 1 : 0;
    if (selected) foreground++;
  }
  if (foreground < 10 || foreground > binary.length * 0.98) {
    throw new Error("The threshold did not isolate a useful shape. Adjust the threshold or invert the foreground/background setting.");
  }

  // For opaque line drawings, flood-fill the background from the image edges.
  // Any background pixels unreachable from the edges are enclosed by the drawing;
  // filling them turns outlines such as leaves into a solid silhouette.
  if (!hasTransparency) {
    const exterior = new Uint8Array(binary.length);
    const flood = new Int32Array(binary.length);
    let head = 0, tail = 0;
    const enqueueBackground = (index: number) => {
      if (!binary[index] && !exterior[index]) {
        exterior[index] = 1;
        flood[tail++] = index;
      }
    };
    for (let x = 0; x < width; x++) {
      enqueueBackground(x);
      enqueueBackground((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      enqueueBackground(y * width);
      enqueueBackground(y * width + width - 1);
    }
    while (head < tail) {
      const index = flood[head++];
      const x = index % width, y = Math.floor(index / width);
      if (x > 0) enqueueBackground(index - 1);
      if (x + 1 < width) enqueueBackground(index + 1);
      if (y > 0) enqueueBackground(index - width);
      if (y + 1 < height) enqueueBackground(index + width);
    }
    for (let i = 0; i < binary.length; i++) {
      if (!binary[i] && !exterior[i]) binary[i] = 1;
    }
  }

  // Find connected foreground components. Opaque drawings typically become one
  // filled silhouette above; transparent logos may legitimately have many pieces.
  const seen = new Uint8Array(binary.length);
  const queue = new Int32Array(binary.length);
  const components: number[][] = [];
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
    if (component.length >= 10) components.push(component);
  }
  if (!components.length) throw new Error("No sufficiently large shape was found. Try a darker outline or another threshold.");

  // Keep the primary silhouette for opaque drawings. For transparent artwork,
  // retain the other pieces and join their ordered outlines by nearest endpoints.
  const details = components.map((pixels) => {
    let sumX = 0, sumY = 0;
    for (const index of pixels) { sumX += index % width; sumY += Math.floor(index / width); }
    return { pixels, cx: sumX / pixels.length, cy: sumY / pixels.length };
  }).sort((a, b) => b.pixels.length - a.pixels.length);
  const selected = hasTransparency ? details : details.slice(0, 1);
  const componentContours: Point[][] = [];

  // Moore-neighbour tracing follows adjacent boundary pixels in their actual
  // perimeter order. Sorting boundary pixels by polar angle scrambles concave shapes.
  const directions = [
    { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
  ];
  for (const component of selected) {
    const mask = new Uint8Array(binary.length);
    for (const index of component.pixels) mask[index] = 1;
    let startIndex = component.pixels[0];
    for (const index of component.pixels) {
      const x = index % width, y = Math.floor(index / width);
      const sx = startIndex % width, sy = Math.floor(startIndex / width);
      if (y < sy || (y === sy && x < sx)) startIndex = index;
    }
    let current = startIndex;
    let backX = current % width - 1;
    let backY = Math.floor(current / width);
    let firstNext = -1;
    const contour: Point[] = [];
    const maxSteps = Math.max(100, component.pixels.length * 8);
    for (let step = 0; step < maxSteps; step++) {
      const cx = current % width, cy = Math.floor(current / width);
      contour.push({ x: cx, y: cy });
      let backDirection = 6;
      const dxBack = backX - cx, dyBack = backY - cy;
      for (let d = 0; d < 8; d++) {
        if (directions[d].x === dxBack && directions[d].y === dyBack) { backDirection = d; break; }
      }
      let next = -1, preceding = backDirection;
      for (let offset = 1; offset <= 8; offset++) {
        const d = (backDirection + offset) % 8;
        const nx = cx + directions[d].x, ny = cy + directions[d].y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const candidate = ny * width + nx;
        if (mask[candidate]) {
          next = candidate;
          preceding = (d + 7) % 8;
          break;
        }
      }
      if (next < 0) break;
      if (firstNext < 0) firstNext = next;
      else if (current === startIndex && next === firstNext) { contour.pop(); break; }
      backX = cx + directions[preceding].x;
      backY = cy + directions[preceding].y;
      current = next;
      if (current === startIndex && firstNext >= 0) break;
    }
    if (contour.length >= 3) componentContours.push(contour);
  }
  if (!componentContours.length) throw new Error("Could not trace a continuous outline. Try adjusting the threshold or using a cleaner image.");

  // Multiple disconnected logo pieces must be joined in spatial order, not by
  // component size. Start each contour at the point nearest the current endpoint,
  // and choose the next component by its nearest boundary point to avoid long jumps.
  const remaining = componentContours.map((points) => points.slice());
  const ordered: Point[][] = [];
  if (remaining.length) {
    // Start at the leftmost point for a stable, predictable traversal.
    let startContour = 0, startPoint = 0, minX = Infinity;
    remaining.forEach((contour, ci) => contour.forEach((p, pi) => {
      if (p.x < minX) { minX = p.x; startContour = ci; startPoint = pi; }
    }));
    const first = remaining.splice(startContour, 1)[0];
    ordered.push(first.slice(startPoint).concat(first.slice(0, startPoint)));

    while (remaining.length) {
      const previous = ordered[ordered.length - 1];
      const endPoint = previous[previous.length - 1];
      let bestContour = 0, bestPoint = 0, bestDistance = Infinity;
      for (let ci = 0; ci < remaining.length; ci++) {
        for (let pi = 0; pi < remaining[ci].length; pi++) {
          const p = remaining[ci][pi];
          const distance = (p.x - endPoint.x) ** 2 + (p.y - endPoint.y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            bestContour = ci;
            bestPoint = pi;
          }
        }
      }
      const next = remaining.splice(bestContour, 1)[0];
      const forward = next.slice(bestPoint).concat(next.slice(0, bestPoint));
      const reverse = [next[bestPoint], ...next.slice(0, bestPoint).reverse(), ...next.slice(bestPoint + 1).reverse()];
      const distanceTo = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
      const currentEnd = ordered[ordered.length - 1][ordered[ordered.length - 1].length - 1];
      const forwardNext = forward[1] ?? forward[0];
      const reverseNext = reverse[1] ?? reverse[0];
      ordered.push(distanceTo(currentEnd, forwardNext) <= distanceTo(currentEnd, reverseNext) ? forward : reverse);
    }
  }

  // Use one shared scale for x and y. Dividing by width and height independently
  // distorts wide logos and can make the reconstructed wordmark look squashed.
  const unit = Math.max(width, height);
  const result: Point[] = [];
  for (const contour of ordered) {
    for (const p of contour) {
      const normalized = {
        x: 0.5 + (p.x - width / 2) / unit,
        y: 0.5 + (p.y - height / 2) / unit,
      };
      const previous = result[result.length - 1];
      if (!previous || Math.hypot(previous.x - normalized.x, previous.y - normalized.y) > 1e-5) result.push(normalized);
    }
  }
  return result;
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
