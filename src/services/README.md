# Services

High-performance, task-specific services for OCR preprocessing and document handling.

## `imageEnhance.ts` — Image Enhancement & PDF Conversion

High-performance image enhancement using Sharp pipeline + PDF rendering.

### Features

- **Sharp Image Enhancement Pipeline** (< 1 second)
  - Auto-rotate via EXIF
  - Gamma correction (1.2) for faint text visibility
  - Sharpening (sigma 1.5) for text clarity
  - Median filter denoise (kernel 3)
  - PNG output (quality 95)

- **PDF to PNG Conversion** (< 2 seconds per page)
  - PDF.js-powered parsing
  - Canvas rendering at 300 DPI
  - Full support for multi-page PDFs
  - Extracted pages ready for OCR

### API

#### `enhanceImageForOCR(imageBuffer: Buffer): Promise<Buffer>`

Enhance image using Sharp pipeline for OCR.

```typescript
const enhanced = await enhanceImageForOCR(imageBuffer);
```

#### `convertPDFPageToPNG(pdfBuffer: Buffer, pageIndex?: number, dpi?: number): Promise<Buffer>`

Convert PDF page to PNG (Node.js only, requires canvas).

```typescript
const png = await convertPDFPageToPNG(pdfBuffer, 0, 300);
```

#### `enhanceAndConvert(file: File): Promise<Buffer>`

All-in-one pipeline: detect PDF, convert if needed, enhance image.

```typescript
const enhanced = await enhanceAndConvert(file);
```

#### `isPDF(file: File | Blob): boolean`

Quick check if file is PDF by MIME type.

```typescript
if (isPDF(file)) {
  // PDF-specific handling
}
```

### Usage Example

```typescript
import { enhanceAndConvert } from '@/services/imageEnhance';

// User selects file (image or PDF)
const file = event.target.files[0];

// Automatically handles both images and PDFs
const enhanced = await enhanceAndConvert(file);

// Send to Gemini API for OCR
const result = await geminiOCR(enhanced);
```

### Performance

| Operation | Target | Notes |
|-----------|--------|-------|
| Single image enhancement | < 1 sec | A4 @ 300 DPI |
| PDF page conversion | < 2 sec | Depends on page complexity |
| Full pipeline | < 3 sec | PDF page + enhancement |

### Technical Details

**Sharp Pipeline Parameters:**
- Gamma: 1.2 (brightens mid-tones, reveals faint text)
- Sharpen sigma: 1.5 (moderate, prevents over-sharpening artifacts)
- Median kernel: 3 (conservative denoising)
- PNG quality: 95 (minimal artifacts, good compression)

**PDF Rendering:**
- Scale: 300 DPI (300 / 72 base DPI = 4.17x zoom)
- Rendering: DOM canvas (browser-compatible when using node-canvas)
- Output: PNG format compatible with OCR services

### Dependencies

- `sharp` — Image processing
- `pdfjs-dist` — PDF parsing and rendering
- `canvas` — Server-side canvas rendering (Node.js)

### Testing

```bash
npm test -- imageEnhance.test.ts
```

Tests cover:
- Valid image enhancement
- Empty/null buffer handling
- Dimension preservation
- Format validation
- PDF MIME type detection

## `imageClarity.ts` — Image Quality Assessment

Evaluate image clarity and OCR readiness using Laplacian sharpness + contrast analysis.

See file header for details.
