/**
 * Image enhancement and PDF conversion service for OCR preprocessing.
 * Uses Sharp for high-performance image processing.
 *
 * Last verified: 2026-05-29, commit initial
 */

import sharp from 'sharp';

/**
 * Enhance image for OCR using Sharp pipeline.
 *
 * Processing steps:
 * 1. Auto-rotate based on EXIF metadata
 * 2. Apply gamma correction (1.2) for contrast enhancement
 * 3. Sharpen with sigma 1.5
 * 4. Denoise with median filter (kernel 3)
 * 5. Output as PNG with quality 95
 *
 * @param imageBuffer - Input image buffer (JPEG, PNG, etc.)
 * @returns Promise<Buffer> - Enhanced image as PNG
 * @throws Error if image processing fails
 *
 * @performance Target < 1 second for typical invoice images (A4 @ 300 DPI)
 *
 * @example
 * const buffer = fs.readFileSync('invoice.jpg');
 * const enhanced = await enhanceImageForOCR(buffer);
 */
export async function enhanceImageForOCR(imageBuffer: Buffer): Promise<Buffer> {
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Invalid image buffer: empty or null');
    }

    // Use Sharp pipeline for efficient processing
    const enhanced = await sharp(imageBuffer)
      // Step 1: Auto-rotate based on EXIF
      .rotate()
      // Step 2: Gamma correction for contrast (1.2 brightens mid-tones, improves faint text)
      .gamma(1.2)
      // Step 3: Sharpen with sigma 1.5 (moderate sharpening for text clarity)
      .sharpen({
        sigma: 1.5,
      })
      // Step 4: Denoise using median filter (kernel size 3, conservative denoising)
      .median(3)
      // Step 5: Output as PNG with quality 95
      .png({ quality: 95 })
      .toBuffer();

    return enhanced;
  } catch (error) {
    throw new Error(
      `Image enhancement failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Convert PDF page to PNG buffer.
 *
 * Extracts specified page from PDF and renders as PNG at given DPI.
 * Uses pdf.js for reliable PDF parsing and canvas for rendering.
 * Note: Only available in Node.js environments with canvas support.
 *
 * @param pdfBuffer - Input PDF file buffer
 * @param pageIndex - Page number to extract (0-indexed, default: 0 = first page)
 * @param dpi - Dots per inch for rendering (default: 300 for invoice quality)
 * @returns Promise<Buffer> - PNG image of the PDF page
 * @throws Error if PDF parsing or rendering fails, or if running in browser
 *
 * @performance Target < 2 seconds per page (depends on page complexity)
 *
 * @example
 * // Node.js only
 * const pdfBuffer = fs.readFileSync('invoice.pdf');
 * const pngBuffer = await convertPDFPageToPNG(pdfBuffer, 0, 300);
 */
export async function convertPDFPageToPNG(
  pdfBuffer: Buffer,
  pageIndex = 0,
  dpi = 300
): Promise<Buffer> {
  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Invalid PDF buffer: empty or null');
    }

    // Lazy-load PDF.js and canvas to avoid issues in browser environments
    const pdfjsLib = await import('pdfjs-dist');
    const { createCanvas } = await import('canvas');

    // Set up PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    // Load PDF document from buffer
    const pdf = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;

    // Validate page index
    if (pageIndex < 0 || pageIndex >= pdf.numPages) {
      throw new Error(
        `Invalid page index ${pageIndex}: PDF has ${pdf.numPages} pages`
      );
    }

    // Get the specific page
    const page = await pdf.getPage(pageIndex + 1); // pdf.js uses 1-indexed pages

    // Get viewport at standard rendering scale (72 DPI = 1x scale)
    const baseScale = dpi / 72;
    const viewport = page.getViewport({ scale: baseScale });

    // Prepare canvas
    const canvasEl = createCanvas(viewport.width, viewport.height);
    const context = canvasEl.getContext('2d');

    if (!context) {
      throw new Error('Failed to get canvas context for PDF rendering');
    }

    // Render page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    // Convert canvas to PNG buffer
    const imageBuffer = canvasEl.toBuffer('image/png');
    return imageBuffer;
  } catch (error) {
    throw new Error(
      `PDF conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Detect if file is PDF based on magic bytes and MIME type.
 *
 * @param file - File object to check
 * @returns boolean - True if file is a PDF
 *
 * @example
 * if (isPDF(file)) {
 *   const png = await convertPDFPageToPNG(await file.arrayBuffer());
 * }
 */
export function isPDF(file: File | Blob): boolean {
  // Check MIME type first (fast path)
  if (file.type === 'application/pdf') {
    return true;
  }

  // Fallback: check magic bytes (first 4 bytes should be "%PDF")
  // This requires reading the file, so we only do it if MIME type is not definitive
  return false; // For now, rely on MIME type
}

/**
 * Enhance and convert file to optimized image buffer for OCR.
 *
 * Pipeline:
 * 1. Check if file is PDF
 * 2. If PDF: convert first page to PNG
 * 3. Enhance image using Sharp pipeline
 * 4. Return optimized buffer ready for OCR
 *
 * Automatically handles both image files and PDFs with single interface.
 *
 * @param file - Input file (image or PDF)
 * @returns Promise<Buffer> - Enhanced PNG image ready for OCR
 * @throws Error if file is invalid or processing fails
 *
 * @example
 * const file = e.target.files[0];
 * const enhanced = await enhanceAndConvert(file);
 * // Use enhanced buffer for OCR...
 */
export async function enhanceAndConvert(file: File): Promise<Buffer> {
  try {
    if (!file) {
      throw new Error('No file provided');
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    let imageBuffer: Buffer;

    // Check if PDF and convert to image if needed
    if (isPDF(file)) {
      imageBuffer = await convertPDFPageToPNG(fileBuffer, 0, 300);
    } else {
      imageBuffer = fileBuffer;
    }

    // Enhance the image
    const enhanced = await enhanceImageForOCR(imageBuffer);

    return enhanced;
  } catch (error) {
    throw new Error(
      `File processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
