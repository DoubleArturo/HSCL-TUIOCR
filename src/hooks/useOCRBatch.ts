import * as React from 'react';
import { useState, useRef } from 'react';
import UTIF from 'utif';
import { analyzeInvoice } from '../../services/geminiService';
import { enhanceImageForOCR } from '../lib/imageEnhancement';
import { fileStorageService } from '../../services/fileStorageService';
import { logger } from '../../services/loggerService';
import { AppStatus, InvoiceEntry, Project, ProcessingState, InvoiceData } from '../../types';
import { clarityService, assessOCRQuality, ClarityScore, OCRQualityAssessment } from '../services/imageClarity';

interface UseOCRBatchOptions {
  project: Project | null;
  selectedModel: string;
  updateProjectInvoices: (updater: (prev: InvoiceEntry[]) => InvoiceEntry[]) => void;
}

interface UseOCRBatchReturn {
  status: AppStatus;
  progress: ProcessingState;
  batchStats: { startTime: number; endTime: number; totalDuration: number };
  cancelProcessingRef: React.MutableRefObject<boolean>;
  handleFiles: (files: FileList | File[]) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function useOCRBatch(options: UseOCRBatchOptions): UseOCRBatchReturn {
  const { project, selectedModel, updateProjectInvoices } = options;

  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [progress, setProgress] = useState<ProcessingState>({ current: 0, total: 0, status: 'IDLE' });
  const [batchStats, setBatchStats] = useState({ startTime: 0, endTime: 0, totalDuration: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelProcessingRef = useRef(false);

  const handleFiles = async (files: FileList | File[]) => {
    if (!project) return;

    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setStatus(AppStatus.PROCESSING);
    cancelProcessingRef.current = false;

    const batchStart = Date.now();
    setBatchStats({ startTime: batchStart, endTime: 0, totalDuration: 0 });

    const newProcessQueue: InvoiceEntry[] = [];

    const currentInvoices = project.invoices;
    const existingMap = new Map(currentInvoices.map(p => [p.id, p]));

    const seenInvoiceNumbers = new Set<string>();
    currentInvoices.forEach(inv => inv.data.forEach(d => {
      if (d.invoice_number) seenInvoiceNumbers.add(d.invoice_number.replace(/[\s-]/g, '').toUpperCase());
    }));

    // Helper: Convert ALL pages of a TIF to one tall PNG (pages stacked vertically)
    const convertTifToPng = async (file: File): Promise<File> => {
      const buffer = await file.arrayBuffer();
      const ifds = UTIF.decode(buffer);

      ifds.forEach((ifd: any) => UTIF.decodeImage(buffer, ifd));

      const totalWidth = Math.max(...ifds.map((p: any) => p.width as number));
      const totalHeight = ifds.reduce((sum: number, p: any) => sum + (p.height as number), 0);

      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, totalWidth, totalHeight);

      let yOffset = 0;
      for (const page of ifds) {
        const rgba = UTIF.toRGBA8(page);
        const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height);
        const offscreen = document.createElement('canvas');
        offscreen.width = page.width;
        offscreen.height = page.height;
        offscreen.getContext('2d')!.putImageData(imgData, 0, 0);
        ctx.drawImage(offscreen, 0, yOffset);
        yOffset += page.height;
      }

      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (!blob) throw new Error("Canvas toBlob failed");
          resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".png", { type: "image/png" }));
        }, 'image/png');
      });
    };

    let nextInvoices = [...currentInvoices];

    const shouldGeneratePreview = fileArray.length < 800;
    if (!shouldGeneratePreview) {
      logger.warn('SYSTEM', `Batch size (${fileArray.length}) is large. Auto-previews disabled to save memory.`);
    }

    for (const file of fileArray) {
      if (cancelProcessingRef.current) break;
      let processedFile = file;
      const isTif = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');

      if (isTif) {
        try {
          logger.info('IMAGE', `Converting TIF to PNG: ${file.name}`);
          processedFile = await convertTifToPng(file);
        } catch (err) {
          logger.error('IMAGE', `Failed to convert TIF: ${file.name}`, err);
        }
      }

      // 圖像增強只對 bitmap 圖片有效（JPG/PNG/BMP），PDF 無法用 canvas 處理。
      // Gemini 本身對 PDF 有自己的渲染能力，不需要預處理。
      if (processedFile.type.startsWith('image/')) {
        try {
          logger.info('IMAGE', `Enhancing for OCR: ${processedFile.name}`);
          processedFile = await enhanceImageForOCR(processedFile);
        } catch (err) {
          logger.warn('IMAGE', `Image enhancement failed (using original): ${processedFile.name}`, err);
        }
      }

      const filename = processedFile.name;
      let id = filename.substring(0, filename.lastIndexOf('.')) || filename;

      if (existingMap.has(id) || nextInvoices.some(n => n.id === id && n.file.name !== processedFile.name)) {
        const existing = existingMap.get(id) || nextInvoices.find(n => n.id === id);
        if (existing && existing.file.name !== processedFile.name) {
          const ext = filename.split('.').pop()?.toLowerCase() || '';
          id = `${id}-${ext}`;
        }
      }

      const sanitizedId = id.replace(/[^\w-]/g, '_');

      try {
        await fileStorageService.saveFile(sanitizedId, processedFile);
      } catch (err: any) {
        logger.error('FILE', `IndexedDB Save Failed for ${sanitizedId}`, err);
        alert(`儲存檔案至瀏覽器失敗 (${sanitizedId}): ${err?.name || 'Error'} - ${err?.message || '未知儲存空間錯誤。您的磁碟可能已滿，或是處於無痕模式。'}`);
      }

      const previewUrl = shouldGeneratePreview ? URL.createObjectURL(processedFile) : '';

      if (existingMap.has(sanitizedId) || nextInvoices.some(n => n.id === sanitizedId)) {
        const existing = existingMap.get(sanitizedId) || nextInvoices.find(n => n.id === sanitizedId)!;

        if (existing.status === 'SUCCESS' && existing.data.length > 0) {
          const entry: InvoiceEntry = {
            ...existing,
            file: processedFile,
            previewUrl: previewUrl,
            status: 'SUCCESS'
          };
          nextInvoices = nextInvoices.map(inv => inv.id === sanitizedId ? entry : inv);
        } else {
          const entry: InvoiceEntry = { id: sanitizedId, file: processedFile, previewUrl, status: 'PENDING', data: [] };
          nextInvoices = nextInvoices.map(inv => inv.id === sanitizedId ? entry : inv);
          newProcessQueue.push(entry);
        }
      } else {
        const entry: InvoiceEntry = { id: sanitizedId, file: processedFile, previewUrl, status: 'PENDING', data: [] };
        nextInvoices.push(entry);
        newProcessQueue.push(entry);
      }
    }

    if (cancelProcessingRef.current) {
      setStatus(AppStatus.IDLE);
      setProgress({ current: 0, total: 0, status: 'IDLE' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    updateProjectInvoices(() => nextInvoices);

    if (newProcessQueue.length === 0) {
      setStatus(AppStatus.IDLE);
      alert("所有檔案皆已處理過。若需重新辨識，請先刪除舊資料。");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const totalItems = newProcessQueue.length;
    logger.info('QUEUE', `Batch started with ${totalItems} new items using model: ${selectedModel}`, { fileNames: newProcessQueue.map(i => i.id) });
    setProgress({ current: 0, total: totalItems, status: 'PROCESSING' });

    const CONCURRENCY_LIMIT = 5;
    const changesMap = new Map<string, Partial<InvoiceEntry>>();

    const flushInterval = setInterval(() => {
      if (changesMap.size > 0) {
        const changesSnapshot = new Map(changesMap);
        changesMap.clear();

        updateProjectInvoices(prev => prev.map(inv => {
          const change = changesSnapshot.get(inv.id);
          return change ? { ...inv, ...change } : inv;
        }));
      }
    }, 500);

    let completedCount = 0;

    const knownSellersFromExcel: Record<string, string> = {};
    if (project && project.erpData) {
      project.erpData.forEach(erp => {
        if (erp.seller_name && erp.seller_tax_id && /^\d{8}$/.test(erp.seller_tax_id.trim())) {
          knownSellersFromExcel[erp.seller_name.trim()] = erp.seller_tax_id.trim();
        }
      });
      logger.info('QUEUE', `Generated ${Object.keys(knownSellersFromExcel).length} seller mappings from Excel.`);
    }

    const processItem = async (item: InvoiceEntry) => {
      if (cancelProcessingRef.current) return;

      changesMap.set(item.id, { status: 'PROCESSING' });
      logger.info('QUEUE', `Processing item: ${item.id}`);

      try {
        // ── PDF Per-Page Routing ──────────────────────────────────────────────
        // Multi-page PDFs: render each page to an image so future per-page
        // clarity assessment can apply. Falls back to whole-PDF on any error.
        const isPDF = item.file.type === 'application/pdf' ||
          item.file.name.toLowerCase().endsWith('.pdf');

        if (isPDF) {
          try {
            const { renderPDFToPageFiles } = await import('../services/pdfPageRenderer');
            const pageFiles = await renderPDFToPageFiles(item.file);

            if (pageFiles.length > 1) {
              logger.info('PDF', `${item.id}: rendering ${pageFiles.length} pages for per-page OCR`);
              const pdfStartTime = Date.now();

              // Build a simplified ERP hint for the PDF path
              let pdfExpectedERP = undefined;
              if (project && project.erpData) {
                const matchingErp = project.erpData.find(erp =>
                  item.id === erp.voucher_id ||
                  item.id.startsWith(erp.voucher_id + '-') ||
                  item.id.startsWith(erp.voucher_id + '_'),
                );
                if (matchingErp) {
                  pdfExpectedERP = {
                    amount_total: matchingErp.amount_total,
                    amount_sales: matchingErp.amount_sales,
                    amount_tax: matchingErp.amount_tax,
                    invoice_numbers: matchingErp.invoice_numbers,
                  };
                }
              }

              const allPageResults: InvoiceData[] = [];
              for (const pageFile of pageFiles) {
                if (cancelProcessingRef.current) break;
                try {
                  const pageBase64 = await fileToBase64(pageFile);
                  const pageResults = await analyzeInvoice(
                    pageBase64, 'image/png', selectedModel, 0, knownSellersFromExcel, pdfExpectedERP,
                  );
                  if (pageResults) allPageResults.push(...pageResults);
                } catch (pageErr) {
                  logger.warn('PDF', `Page OCR failed for ${pageFile.name}`, pageErr);
                }
              }

              if (allPageResults.length > 0) {
                // Cross-page dedup: keep first occurrence of each invoice_number
                const seenNos = new Set<string>();
                const results = allPageResults.filter(inv => {
                  if (!inv.invoice_number) return true;
                  const norm = inv.invoice_number.replace(/[\s-]/g, '').toUpperCase();
                  if (seenNos.has(norm)) return false;
                  seenNos.add(norm);
                  return true;
                });

                const pdfLog = `[PDF] Per-page OCR: ${pageFiles.length} pages → ${results.length} invoices`;
                results.forEach(r => { r.trace_logs = [pdfLog, ...(r.trace_logs || [])]; });
                results.forEach(r => {
                  const normNo = (r.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
                  if (normNo) {
                    if (seenInvoiceNumbers.has(normNo)) {
                      r.trace_logs = r.trace_logs || [];
                      r.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${r.invoice_number}`);
                    } else {
                      seenInvoiceNumbers.add(normNo);
                    }
                  }
                });

                const duration = Date.now() - pdfStartTime;
                logger.info('API', `Success (pdf-per-page): ${item.id}`, {
                  duration, invoiceCount: results.length, pageCount: pageFiles.length,
                });
                changesMap.set(item.id, { status: 'SUCCESS', data: results });
                return;
              }
              // allPageResults empty: fall through to whole-PDF path
            }
            // Single-page PDF or zero pages returned: fall through
          } catch (pdfErr) {
            logger.warn('PDF', `Per-page routing failed for ${item.id}, falling back to whole-PDF`, pdfErr);
          }
        }
        // ── End PDF Per-Page Routing ─────────────────────────────────────────

        // ── Step 1：圖像清晰度評估（僅限 bitmap，PDF 跳過）──────────────────
        // PDF 由 Gemini 自行渲染，canvas-based 清晰度評估無法處理 PDF。
        let clarityScore: ClarityScore | null = null;
        const isImageFile = item.file.type.startsWith('image/');

        if (isImageFile) {
          try {
            clarityScore = await clarityService.assess(item.file);
            logger.info('CLARITY', `${item.id}: clarity=${clarityScore?.clarity ?? 'null'}, confidence=${clarityScore?.confidence ?? 'N/A'}`);
          } catch (err) {
            logger.warn('CLARITY', `Clarity assessment failed for ${item.id}, assuming blurry`, err);
            clarityScore = { clarity: 'blurry', contrast: 0, laplacian: 0, confidence: 0 };
          }
        }

        // ── Step 2：預處理（條件式增強）────────────────────────────────────
        // 清晰圖像直接送 Gemini，模糊圖像先做一次 Flash OCR 評估再決定。
        // PDF 走原有流程（不增強）。
        let processedFile = item.file;
        let enhancementApplied = false;
        let decisionReason = 'direct_flash';

        if (isImageFile && clarityScore?.clarity === 'clear') {
          // 清晰圖像：跳過增強，直接走後續流程
          decisionReason = 'direct_flash';
          logger.info('PREPROCESSING', `${item.id}: clear image, skip enhancement`);
        } else if (isImageFile) {
          // 模糊或無法評估：先用原圖跑 Flash，評估 OCR 質量，再決定要不要增強
          decisionReason = 'quality_based';
          // 實際增強與否在取得 Flash 結果後決定（見 Step 4）
        }
        // PDF 走原有 Gemini 自行渲染路徑，不做 canvas 增強

        const startTime = Date.now();

        // ── Step 3：準備 ERP 期望值 ────────────────────────────────────────
        let expectedERP = undefined;
        if (project && project.erpData) {
          // 取出此憑證的「所有」ERP 行（同一個 voucher_id 可能有多行）
          const allMatchingErp = project.erpData.filter(erp =>
            item.id === erp.voucher_id || item.id.startsWith(erp.voucher_id + '-') || item.id.startsWith(erp.voucher_id + '_')
          );
          if (allMatchingErp.length > 0) {
            const allInvNos = allMatchingErp.flatMap(e => e.invoice_numbers || []);

            // tax_code：只有全部 ERP 行的稅別相同時才傳（混合稅別不傳，避免誤導 prompt）
            const uniqueTaxCodes = [...new Set(allMatchingErp.map(e => (e.tax_code || '').toUpperCase()).filter(Boolean))];
            const sharedTaxCode  = uniqueTaxCodes.length === 1 ? uniqueTaxCodes[0] : undefined;

            // T500/TXXX/T400：這些稅別不需要金額 cross-check（交通票券、收據、海關文件各有特殊格式），
            // 也不需要發票號碼格式驗證，傳 expectedERP 只會觸發無意義的 Pro 升級。
            const noValidationTypes = new Set(['T500', 'TXXX', 'T400']);
            const allNoValidation = allMatchingErp.every(e => noValidationTypes.has((e.tax_code || '').toUpperCase()));

            // 多檔案憑證（ID 結尾 -N，例如 G12-Q50057-3）：
            // 每個檔案只含部分發票，聚合金額必然和單一檔案 OCR 不符，
            // 傳金額只會觸發無意義的 Pro 升級。只傳 invoice_numbers + tax_code 作 prompt hint。
            const isMultiFileVoucher = /-\d+$/.test(item.id);

            // 不傳金額的條件：全為免驗證稅別 OR 多檔案憑證
            const skipAmountCheck = allNoValidation || isMultiFileVoucher;

            // invoice_numbers 的傳法：
            // - 免驗證稅別（T500/TXXX/T400）：不傳（完全不需要 cross-check）
            // - 多檔案憑證（-N 結尾）：不傳（每個檔案只含部分發票，傳完整清單會觸發
            //   count_mismatch 升 Pro，導致 7 個 PDF 各升一次 Pro，結果延遲回來覆蓋 Flash 結果，
            //   使用者看到「完成」後結果又跳動）。只傳 tax_code 作 prompt hint。
            // - 單檔案憑證：傳完整清單（正常 count_mismatch 有意義）
            const skipInvNos = allNoValidation || isMultiFileVoucher;

            expectedERP = {
              amount_total: skipAmountCheck ? undefined : allMatchingErp.reduce((s, e) => s + (e.amount_total || 0), 0),
              amount_sales: skipAmountCheck ? undefined : allMatchingErp.reduce((s, e) => s + (e.amount_sales || 0), 0),
              amount_tax:   skipAmountCheck ? undefined : allMatchingErp.reduce((s, e) => s + (e.amount_tax || 0), 0),
              invoice_numbers: skipInvNos ? undefined : allInvNos,
              tax_code: sharedTaxCode,
            };
          }
        }

        // ── Step 4：Flash OCR → 評估品質 → 條件增強重跑 ──────────────────
        // 模糊圖像策略：先跑 Flash 取得初步結果，評估 field_confidence 是否足夠。
        // 若品質不足（shouldEnhance=true），增強原圖後重送（仍由 analyzeInvoice 內部決定升 Pro）。
        // 注意：analyzeInvoice 內部已有 validation retry 和 auto-escalation，
        // 這裡的增強是預處理層，不影響 Gemini 升級路徑，兩者不衝突。
        let ocrQuality: OCRQualityAssessment | null = null;

        if (isImageFile && clarityScore?.clarity !== 'clear') {
          // 先用原圖跑 Flash（若模型是 Pro，就直接送 Pro；Flash 語意在此指「不做增強的初始嘗試」）
          const base64Flash = await fileToBase64(item.file);
          const flashResults = await analyzeInvoice(base64Flash, item.file.type, selectedModel, 0, knownSellersFromExcel, expectedERP);

          if (flashResults && flashResults.length > 0) {
            // 評估第一筆結果的 OCR 質量（multi-invoice 文件以第一筆為代表）
            try {
              ocrQuality = await assessOCRQuality(flashResults[0]);
            } catch (err) {
              logger.warn('QUALITY', `OCR quality assessment failed for ${item.id}`, err);
            }

            if (!ocrQuality?.shouldEnhance) {
              // Flash 質量足夠，直接用
              logger.info('CLARITY', `${item.id}: Flash quality OK (${ocrQuality?.keyFieldsConfidence ?? '?'}%), skip enhancement`);
              decisionReason = 'quality_based_flash_ok';

              // 記錄決策到 trace_logs
              const clarityLog = `[Clarity] ${item.id}: clarity=${clarityScore?.clarity ?? 'unknown'}, Flash quality=${ocrQuality?.keyFieldsConfidence ?? '?'}%, no enhancement needed`;
              flashResults.forEach(res => {
                res.trace_logs = [clarityLog, ...(res.trace_logs || [])];
              });

              // 進入重複發票檢查
              flashResults.forEach(res => {
                const normNo = (res.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
                if (normNo) {
                  if (seenInvoiceNumbers.has(normNo)) {
                    res.trace_logs = res.trace_logs || [];
                    res.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${res.invoice_number}`);
                  } else {
                    seenInvoiceNumbers.add(normNo);
                  }
                }
              });

              const duration = Date.now() - startTime;
              logger.info('API', `Success (clarity-flash): ${item.id}`, { duration, invoiceCount: flashResults.length, clarityScore, ocrQuality });
              changesMap.set(item.id, { status: 'SUCCESS', data: flashResults });
              return; // 跳出 try，進入 finally
            }

            // Flash 質量不足，增強後重跑
            logger.info('CLARITY', `${item.id}: Flash quality insufficient (${ocrQuality?.keyFieldsConfidence ?? '?'}%, failed: ${ocrQuality?.failedFields?.join(',') ?? '-'}), applying enhancement`);
            decisionReason = 'quality_based_enhanced';

            try {
              processedFile = await enhanceImageForOCR(item.file);
              enhancementApplied = true;
              logger.info('PREPROCESSING', `Enhanced image for retry: ${item.id}`);
            } catch (enhErr) {
              logger.warn('PREPROCESSING', `Enhancement failed for ${item.id}, falling back to Flash result`, enhErr);
              // 增強失敗：用原始 Flash 結果作為 fallback
              const fallbackLog = `[Clarity] ${item.id}: enhancement failed, using Flash result as fallback`;
              flashResults.forEach(res => {
                res.trace_logs = [fallbackLog, ...(res.trace_logs || [])];
              });
              flashResults.forEach(res => {
                const normNo = (res.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
                if (normNo) {
                  if (seenInvoiceNumbers.has(normNo)) {
                    res.trace_logs = res.trace_logs || [];
                    res.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${res.invoice_number}`);
                  } else {
                    seenInvoiceNumbers.add(normNo);
                  }
                }
              });
              const duration = Date.now() - startTime;
              logger.info('API', `Success (clarity-flash-fallback): ${item.id}`, { duration, invoiceCount: flashResults.length });
              changesMap.set(item.id, { status: 'SUCCESS', data: flashResults });
              return;
            }
          }
          // flashResults 為空：繼續往下走，用增強後圖像重跑（processedFile 還是 item.file）
        } else if (!isImageFile) {
          // PDF 或其他非圖像：原有流程，不做清晰度增強
          processedFile = item.file;
        }
        // else: 清晰圖像，processedFile = item.file（直接送）

        const base64 = await fileToBase64(processedFile);

        const results = await analyzeInvoice(base64, processedFile.type, selectedModel, 0, knownSellersFromExcel, expectedERP);

        if (results && results.length > 0) {
          // 記錄清晰度決策到 trace_logs
          if (clarityScore !== null || enhancementApplied) {
            const clarityLog = `[Clarity] decision=${decisionReason}, clarity=${clarityScore?.clarity ?? 'N/A'}, confidence=${clarityScore?.confidence ?? 'N/A'}, enhanced=${enhancementApplied}`;
            results.forEach(res => {
              res.trace_logs = [clarityLog, ...(res.trace_logs || [])];
            });
          }

          results.forEach(res => {
            const normNo = (res.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
            if (normNo) {
              if (seenInvoiceNumbers.has(normNo)) {
                res.trace_logs = res.trace_logs || [];
                res.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${res.invoice_number}`);
              } else {
                seenInvoiceNumbers.add(normNo);
              }
            }
          });

          const duration = Date.now() - startTime;
          logger.info('API', `Success: ${item.id}`, { duration, invoiceCount: results.length, clarityScore, enhancementApplied, decisionReason });
          changesMap.set(item.id, { status: 'SUCCESS', data: results });
        } else {
          logger.warn('API', `Empty Result: ${item.id}`, { duration: Date.now() - startTime });
          changesMap.set(item.id, { status: 'ERROR', error: '無法辨識發票內容', data: [] });
        }
      } catch (err: any) {
        const errorMsg = err?.message?.includes('429') ? 'API 額度已滿' : (err.message || '辨識失敗');
        logger.error('API', `Failed: ${item.id}`, { error: errorMsg, details: err });
        changesMap.set(item.id, { status: 'ERROR', error: errorMsg, data: [] });
      } finally {
        completedCount++;
        setProgress({ current: completedCount, total: totalItems, status: 'PROCESSING' });
      }
    };

    const queue = [...newProcessQueue];

    const processNext = async () => {
      if (cancelProcessingRef.current) return;
      if (queue.length === 0) return;
      const item = queue.shift();
      if (item) {
        await processItem(item);

        await new Promise(resolve => setTimeout(resolve, 500));

        if (queue.length > 0 && !cancelProcessingRef.current) await processNext();
      }
    };

    const initialBatch = Array(Math.min(CONCURRENCY_LIMIT, queue.length)).fill(null).map(() => processNext());
    await Promise.all(initialBatch);

    clearInterval(flushInterval);

    if (changesMap.size > 0) {
      updateProjectInvoices(prev => prev.map(inv => {
        const change = changesMap.get(inv.id);
        return change ? { ...inv, ...change } : inv;
      }));
    }

    const batchEnd = Date.now();
    setBatchStats({ startTime: batchStart, endTime: batchEnd, totalDuration: batchEnd - batchStart });

    setStatus(AppStatus.IDLE);
    setProgress({ current: completedCount, total: totalItems, status: 'COMPLETED' });
    logger.info('QUEUE', `Batch completed. Processed ${completedCount}/${totalItems} items.`);

    setTimeout(() => {
      setProgress(p => ({ ...p, status: 'IDLE' }));
    }, 3000);

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return {
    status,
    progress,
    batchStats,
    cancelProcessingRef,
    handleFiles,
    fileInputRef,
  };
}
