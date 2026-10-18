# Fourier Studio

A browser-based Fourier drawing studio. Upload an SVG, PNG, or JPG, extract a contour, compute Fourier coefficients, and watch epicycles reconstruct the curve.

## Features

- Browser-only image processing; uploaded images are not sent to a server.
- SVG path sampling and raster contour extraction.
- FFT-based Fourier coefficient calculation.
- Adjustable frequency count, animation speed, and visual overlays.
- Export reconstructed curve as SVG and coefficients as JSON.

## Getting started

Requirements: Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How it works

1. Raster images are thresholded and their boundary is traced with a browser-side contour follower. SVG files use a browser SVG path sampler.
2. The contour is resampled to approximately uniform arc-length spacing.
3. A radix-2 FFT computes complex Fourier coefficients. Coefficients are ordered by magnitude for the best approximation at a given term budget.
4. Canvas draws the rotating vectors and circles while the final vector endpoint traces the reconstruction.

## Notes and limitations

- The first version traces one selected/primary contour. Images with multiple disconnected strokes work best when supplied as SVG paths or simplified to a single contour.
- A raster image with low contrast or a busy background may need threshold adjustment.
- The displayed normalized RMS error is a project-defined metric and may differ from error figures shown by other Fourier visualization tools.
- There is no Python server, database, or external API key required.

## Deploying

Import this repository into Vercel and use the default Next.js build settings. No environment variables are required.
