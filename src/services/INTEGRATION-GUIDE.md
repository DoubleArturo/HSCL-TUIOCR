# Integration Guide: imageEnhance Service

## Quick Start

### 1. Basic Image Enhancement

```typescript
import { enhanceImageForOCR } from '@/services/imageEnhance';
import fs from 'fs';

// Read image file
const imageBuffer = fs.readFileSync('invoice.jpg');

// Enhance for OCR
const enhanced = await enhanceImageForOCR(imageBuffer);

// Use with Gemini API
const result = await geminiOCR(enhanced);
```

### 2. PDF Processing

```typescript
import { convertPDFPageToPNG } from '@/services/imageEnhance';
import fs from 'fs';

// Read PDF file
const pdfBuffer = fs.readFileSync('invoice.pdf');

// Convert first page to PNG
const pngBuffer = await convertPDFPageToPNG(pdfBuffer, 0, 300);

// Enhance the PNG
const enhanced = await enhanceImageForOCR(pngBuffer);
```

### 3. Universal File Handler

```typescript
import { enhanceAndConvert } from '@/services/imageEnhance';

// Works with both image and PDF files
const file = event.target.files[0];

// Automatic detection + processing
const enhanced = await enhanceAndConvert(file);

// Send to OCR
const result = await geminiOCR(enhanced);
```

## Integration with Existing Code

### With Gemini OCR Pipeline

```typescript
import { enhanceAndConvert } from '@/services/imageEnhance';
import { extractInvoiceData } from '@/lib/geminiService';

async function processInvoiceFile(file: File) {
  try {
    // Step 1: Enhance image (handles PDF auto-conversion)
    const enhanced = await enhanceAndConvert(file);

    // Step 2: Send to Gemini for OCR
    const invoiceData = await extractInvoiceData(enhanced);

    // Step 3: Return result
    return invoiceData;
  } catch (error) {
    console.error('Processing failed:', error);
    throw error;
  }
}
```

### With Quality Assessment

```typescript
import { enhanceAndConvert } from '@/services/imageEnhance';
import { assessImageClarity } from '@/services/imageClarity';

async function processWithQualityCheck(file: File) {
  const enhanced = await enhanceAndConvert(file);

  // Check if enhanced image meets quality threshold
  const clarity = await assessImageClarity(enhanced);

  if (clarity.shouldEnhance) {
    console.warn('Image quality is low, consider manual review');
  }

  return enhanced;
}
```

## React Component Example

```typescript
import React, { useState } from 'react';
import { enhanceAndConvert } from '@/services/imageEnhance';

export function InvoiceUploader() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      // Enhance image
      const enhanced = await enhanceAndConvert(file);

      // Send to OCR API
      const response = await fetch('/api/ocr', {
        method: 'POST',
        body: enhanced,
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="file"
        accept="image/*,.pdf"
        onChange={handleFileSelect}
        disabled={loading}
      />
      {loading && <p>Processing...</p>}
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
```

## API Endpoint Example

```typescript
// pages/api/ocr.ts (Next.js example)
import type { NextApiRequest, NextApiResponse } from 'next';
import { enhanceImageForOCR } from '@/services/imageEnhance';
import { extractInvoiceData } from '@/lib/geminiService';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Req body is raw image buffer
    const imageBuffer = req.body;

    // Enhance
    const enhanced = await enhanceImageForOCR(imageBuffer);

    // OCR
    const result = await extractInvoiceData(enhanced);

    return res.status(200).json(result);
  } catch (error) {
    console.error('API error:', error);
    return res.status(500).json({ error: 'OCR processing failed' });
  }
}
```

## Error Handling

```typescript
import { enhanceAndConvert } from '@/services/imageEnhance';

async function processFile(file: File) {
  try {
    const enhanced = await enhanceAndConvert(file);
    return enhanced;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Invalid file')) {
        console.error('File is corrupted or not supported');
      } else if (error.message.includes('PDF conversion')) {
        console.error('PDF processing failed - unsupported format?');
      } else if (error.message.includes('Image enhancement')) {
        console.error('Image processing failed');
      } else {
        console.error('Unknown error:', error.message);
      }
    }
    throw error;
  }
}
```

## Performance Tuning

### For Batch Processing

```typescript
import { enhanceImageForOCR } from '@/services/imageEnhance';

// Process multiple images with concurrency limit
async function processBatch(files: File[], concurrency = 3) {
  const results = [];
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const enhanced = await Promise.all(
      batch.map((f) => enhanceAndConvert(f))
    );
    results.push(...enhanced);
  }
  return results;
}
```

### For Large PDFs

```typescript
import { convertPDFPageToPNG } from '@/services/imageEnhance';

// Process specific pages, not all
async function processPDFPages(
  pdfBuffer: Buffer,
  pageIndices: number[]
) {
  const results = await Promise.all(
    pageIndices.map((idx) => convertPDFPageToPNG(pdfBuffer, idx, 300))
  );
  return results;
}
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid image buffer: empty or null" | Check file.arrayBuffer() succeeds |
| "PDF conversion failed: DOMMatrix is not defined" | Running in browser? Use Node.js environment |
| "Canvas context is null" | Very large PDF page? Try lower DPI (200 instead of 300) |
| Slow processing on high-resolution images | Normal behavior; consider downsampling before enhancement |
| "Module not found: canvas" | Run `npm install canvas` |

## Testing

```bash
# Run service tests
npm test -- imageEnhance.test.ts

# Manual integration test
node -e "
const { enhanceImageForOCR } = require('./src/services/imageEnhance.ts');
const fs = require('fs');

const buffer = fs.readFileSync('test-invoice.jpg');
enhanceImageForOCR(buffer).then(enhanced => {
  console.log('Enhanced:', enhanced.length, 'bytes');
}).catch(console.error);
"
```
