import * as React from 'react';
import { useState, useRef } from 'react';
import UTIF from 'utif';
import { analyzeInvoice } from '../../services/geminiService';
import { enhanceImageForOCR } from '../lib/imageEnhancement';
import { fileStorageService } from '../../services/fileStorageService';
import { logger } from '../../services/loggerService';
import { AppStatus, InvoiceEntry, Project, ProcessingState } from '../../types';

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
        let processedFile = item.file;
        if (item.file.type.startsWith('image/')) {
          try {
            processedFile = await enhanceImageForOCR(item.file);
            logger.info('PREPROCESSING', `Enhanced image: ${item.id}`);
          } catch (err) {
            logger.warn('PREPROCESSING', `Failed to preprocess ${item.id}, using original`, err);
          }
        }

        const base64 = await fileToBase64(processedFile);
        const startTime = Date.now();

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

        const results = await analyzeInvoice(base64, processedFile.type, selectedModel, 0, knownSellersFromExcel, expectedERP);

        if (results && results.length > 0) {
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
          logger.info('API', `Success: ${item.id}`, { duration, invoiceCount: results.length });
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
