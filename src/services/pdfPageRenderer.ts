import * as pdfjsLib from 'pdfjs-dist';

let _workerSetup = false;

function ensureWorker(): void {
  if (!_workerSetup) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    _workerSetup = true;
  }
}

/** Returns number of pages in a PDF File. Returns 0 on error. */
export async function getPDFPageCount(file: File): Promise<number> {
  ensureWorker();
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const buffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    return pdf.numPages;
  } catch {
    return 0;
  } finally {
    pdf?.destroy();
  }
}

/**
 * Render each page of a PDF to a PNG File.
 * scale=2.0 produces ~144 DPI which is sufficient for Gemini OCR.
 * Returns [] on any error (caller should fall back to whole-PDF path).
 */
export async function renderPDFToPageFiles(file: File, scale = 2.0): Promise<File[]> {
  ensureWorker();
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;
  try {
    const buffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const baseName = file.name.replace(/\.pdf$/i, '');
    const pages: File[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        continue;
      }

      await page.render({ canvas, viewport }).promise;

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (blob) {
        pages.push(new File([blob], `${baseName}_p${pageNum}.png`, { type: 'image/png' }));
      }
      page.cleanup();
    }

    return pages;
  } catch {
    return [];
  } finally {
    pdf?.destroy();
  }
}
