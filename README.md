# Fourier Studio

A browser-based Fourier drawing studio. Upload a vector or raster image, extract a contour, calculate Fourier coefficients, and watch rotating epicycles reconstruct the curve.

## Features

- Browser-only processing; source files are not uploaded to a server.
- SVG path sampling plus raster silhouette extraction.
- Radix-2 FFT Fourier coefficient calculation.
- Adjustable number of Fourier terms and animation speed.
- Toggles for rotating circles, vectors, and reconstructed trace.
- Export coefficients as JSON and reconstructed curve as SVG.
- No Python backend, paid API key, or database required.

## Stack

- Next.js App Router
- React and TypeScript
- Canvas 2D
- Custom FFT implementation
- Vercel deployment compatible

## Run locally

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

1. The app extracts ordered 2D points from an SVG path or raster silhouette.
2. The contour is resampled approximately uniformly by arc length.
3. A radix-2 FFT computes normalized complex Fourier coefficients.
4. The coefficients are ranked by magnitude for term selection.
5. Canvas renders each rotating vector and circle, while the final vector endpoint traces the reconstruction.

For a coefficient (c_k) at frequency (k), its radius is (|c_k|), its starting phase is (arg(c_k)), and its angle evolves as (2pi kt+arg(c_k)).

## Image extraction notes

SVG input is preferred for detailed line art because paths can be sampled through browser SVG geometry APIs. Raster processing currently thresholds the image and keeps the largest foreground connected component. Its boundary ordering is a centroid-angle approximation, which works best for compact, nearly convex silhouettes. It may not correctly trace intricate concave shapes, multi-stroke drawings, or photographs with busy backgrounds. These are good candidates for future contour-following and user-assisted path selection features.

## Error metric

The UI reports normalized RMS positional error between the resampled original contour and the Fourier reconstruction. This is the project's defined metric and is not necessarily the same as error percentages reported by other Fourier visualization tools.

## Deploy

Import the repository into Vercel and use the default Next.js settings. No environment variables are needed.

The GitHub Actions workflow runs dependency installation, TypeScript checks and a production build for pushes and pull requests.
