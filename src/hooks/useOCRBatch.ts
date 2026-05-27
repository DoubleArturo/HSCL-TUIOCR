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

      try {
        logger.info('IMAGE', `Enhancing for OCR: ${processedFile.name}`);
        processedFile = await enhanceImageForOCR(processedFile);
      } catch (err) {
        logger.warn('IMAGE', `Image enhancement failed (using original): ${processedFile.name}`, err);
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
          const matchingErp = project.erpData.find(erp =>
            item.id === erp.voucher_id || item.id.startsWith(erp.voucher_id + '-') || item.id.startsWith(erp.voucher_id + '_')
          );
          if (matchingErp) {
            expectedERP = {
              amount_total: matchingErp.amount_total,
              amount_sales: matchingErp.amount_sales,
              amount_tax: matchingErp.amount_tax,
              invoice_numbers: matchingErp.invoice_numbers
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
