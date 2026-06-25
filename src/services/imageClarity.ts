/**
 * imageClarity.ts
 * 圖像清晰度評估服務：Laplacian 銳度 + 對比度評估。
 * 執行環境：瀏覽器（Canvas API），不依賴 sharp 或 Node.js。
 */

import type { InvoiceData } from '../../types';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ClarityScore {
  /** 像素標準差，0–255。> 50 視為對比度足夠 */
  contrast: number;
  /** Laplacian 濾波後的方差。> 100 視為銳利 */
  laplacian: number;
  clarity: 'clear' | 'blurry';
  /** 綜合信心度，0–100 */
  confidence: number;
}

export interface OCRQualityAssessment {
  /** 關鍵欄位通過率，0–100 */
  keyFieldsConfidence: number;
  /** 信心度不足的欄位名稱 */
  failedFields: string[];
  /** keyFieldsConfidence < 80 時為 true */
  shouldEnhance: boolean;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MIN_DIMENSION = 100;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CONTRAST_CLEAR_THRESHOLD = 50;
const LAPLACIAN_CLEAR_THRESHOLD = 100;
const ENHANCE_THRESHOLD = 80;

/** Laplacian 3×3 卷積核（離散近似拉普拉斯算子） */
const LAPLACIAN_KERNEL = [0, -1, 0, -1, 4, -1, 0, -1, 0] as const;

/** OCR 關鍵欄位及各自的信心度閾值 */
const KEY_FIELD_THRESHOLDS: ReadonlyMap<keyof NonNullable<InvoiceData['field_confidence']>, number> = new Map([
  ['invoice_number', 0.90],
  ['seller_tax_id', 0.85],
  ['amount_total', 0.90],
  ['invoice_date', 0.85],
]);

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

/**
 * 用 Canvas API 將 File 解碼為 ImageData。
 * 若圖像尺寸不足 MIN_DIMENSION × MIN_DIMENSION，返回 null。
 */
async function fileToImageData(file: File): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) {
          resolve(null);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = () => resolve(null);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * 將 RGBA ImageData 轉為灰階 Uint8Array（Rec.601 加權）。
 */
function toGrayscale(data: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const off = i * 4;
    gray[i] = Math.round(0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2]);
  }
  return gray;
}

/**
 * 計算像素標準差（contrast proxy）。
 */
function computeStdDev(gray: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const mean = sum / gray.length;
  let variance = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - mean;
    variance += d * d;
  }
  return Math.sqrt(variance / gray.length);
}

/**
 * 對灰階圖應用 Laplacian 卷積（邊界像素跳過），
 * 返回濾波結果的方差。
 */
function computeLaplacianVariance(gray: Uint8Array, width: number, height: number): number {
  const filtered: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // 3×3 鄰域
      const tl = gray[(y - 1) * width + (x - 1)];
      const tc = gray[(y - 1) * width + x];
      const tr = gray[(y - 1) * width + (x + 1)];
      const ml = gray[y * width + (x - 1)];
      const mc = gray[y * width + x];
      const mr = gray[y * width + (x + 1)];
      const bl = gray[(y + 1) * width + (x - 1)];
      const bc = gray[(y + 1) * width + x];
      const br = gray[(y + 1) * width + (x + 1)];

      const neighborhood = [tl, tc, tr, ml, mc, mr, bl, bc, br];
      let val = 0;
      for (let k = 0; k < 9; k++) {
        val += LAPLACIAN_KERNEL[k] * neighborhood[k];
      }
      filtered.push(val);
    }
  }

  if (filtered.length === 0) return 0;

  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance = filtered.reduce((sum, v) => sum + (v - mean) ** 2, 0) / filtered.length;
  return variance;
}

/**
 * 計算 8 位元 hash（djb2），供快取 key 使用。
 * 不用 crypto（避免 async 開銷），對 64KB 取樣即可。
 */
function fastHash(file: File): string {
  // 用檔案名稱 + 大小 + lastModified 作為 key，
  // 這對同一檔案是穩定的，且不需要讀取 buffer。
  return `${file.name}|${file.size}|${file.lastModified}`;
}

// ─────────────────────────────────────────────
// Core functions (standalone exports)
// ─────────────────────────────────────────────

/**
 * 評估圖像清晰度。
 * @param file - 要分析的圖像 File 物件
 * @returns ClarityScore，或在圖像過小/損壞時返回 null
 */
export async function assessImageClarity(file: File): Promise<ClarityScore | null> {
  try {
    const imageData = await fileToImageData(file);
    if (!imageData) return null; // 過小或損壞

    const gray = toGrayscale(imageData.data);
    const contrast = computeStdDev(gray);
    const laplacian = computeLaplacianVariance(gray, imageData.width, imageData.height);

    const contrastOk = contrast > CONTRAST_CLEAR_THRESHOLD;
    const sharpnessOk = laplacian > LAPLACIAN_CLEAR_THRESHOLD;

    // 信心度：兩個指標各占 50%，線性映射
    const contrastScore = Math.min(100, (contrast / CONTRAST_CLEAR_THRESHOLD) * 50);
    const sharpnessScore = Math.min(100, (laplacian / LAPLACIAN_CLEAR_THRESHOLD) * 50);
    const confidence = Math.round(contrastScore + sharpnessScore);

    return {
      contrast: Math.round(contrast * 10) / 10,
      laplacian: Math.round(laplacian * 10) / 10,
      clarity: contrastOk && sharpnessOk ? 'clear' : 'blurry',
      confidence,
    };
  } catch {
    return null; // 保守 fallback
  }
}

/**
 * 根據 InvoiceData 的 field_confidence 評估 OCR 關鍵欄位品質。
 * @param ocrResult - 單張 OCR 結果
 * @param threshold - 整體通過門檻（預設 80）
 */
export async function assessOCRQuality(
  ocrResult: InvoiceData,
  threshold = ENHANCE_THRESHOLD,
): Promise<OCRQualityAssessment> {
  const fc = ocrResult.field_confidence;
  const failedFields: string[] = [];
  let passCount = 0;
  const totalFields = KEY_FIELD_THRESHOLDS.size;

  for (const [field, minConf] of KEY_FIELD_THRESHOLDS) {
    const actual = fc?.[field] ?? 0;
    if (actual >= minConf) {
      passCount++;
    } else {
      failedFields.push(field);
    }
  }

  const keyFieldsConfidence = Math.round((passCount / totalFields) * 100);

  return {
    keyFieldsConfidence,
    failedFields,
    shouldEnhance: keyFieldsConfidence < threshold,
  };
}

// ─────────────────────────────────────────────
// ClarityService（快取包裝）
// ─────────────────────────────────────────────

interface CacheEntry {
  score: ClarityScore;
  timestamp: number;
}

/**
 * 帶快取的清晰度評估服務。
 * 用檔名 + 大小 + lastModified 作為快取 key（TTL 1 小時）。
 */
export class ClarityService {
  private cache = new Map<string, CacheEntry>();

  /**
   * 評估圖像清晰度，結果快取 1 小時。
   * @param file - 要分析的圖像 File 物件
   * @returns ClarityScore，或在圖像無效時返回 null
   */
  async assess(file: File): Promise<ClarityScore | null> {
    const key = fastHash(file);
    const now = Date.now();

    const cached = this.cache.get(key);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.score;
    }

    const score = await assessImageClarity(file);
    if (score) {
      this.cache.set(key, { score, timestamp: now });
    }
    return score;
  }

  /** 手動清除所有快取（測試或記憶體釋放用） */
  clearCache(): void {
    this.cache.clear();
  }

  /** 回傳目前快取條目數 */
  get cacheSize(): number {
    return this.cache.size;
  }
}

/** 模組層級單例，供大多數使用情境直接 import */
export const clarityService = new ClarityService();
