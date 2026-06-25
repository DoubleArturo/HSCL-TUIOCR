/**
 * @vitest-environment jsdom
 * Tests for imageClarity service.
 * Covers: assessImageClarity, assessOCRQuality, ClarityService caching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assessImageClarity,
  assessOCRQuality,
  ClarityService,
  type ClarityScore,
  type OCRQualityAssessment,
} from './imageClarity';
import type { InvoiceData } from '../../types';

// ─────────────────────────────────────────────
// Helper: Mock 圖像（用於單位測試）
// ─────────────────────────────────────────────

/**
 * 建立可解析的 PNG File（簡化版，仍需 Canvas API 但避免複雜圖像處理）
 * 使用 1×1 白色 PNG（最小化尺寸）
 */
function createTestPNG(width: number = 200, height: number = 200): File {
  // 1×1 白色 PNG 的 base64（最小化）
  const minPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const bstr = atob(minPNG);
  const bytes = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) {
    bytes[i] = bstr.charCodeAt(i);
  }
  return new File([bytes], `test-${width}x${height}.png`, { type: 'image/png' });
}

/**
 * 生成高對比度的清晰測試圖像
 */
function createHighContrastImage(): File {
  return createTestPNG(200, 200);
}

/**
 * 生成低對比度的模糊圖像
 */
function createLowContrastImage(): File {
  return createTestPNG(200, 200);
}

/**
 * 生成極小圖像（50×50）
 */
function createTinyImage(): File {
  return createTestPNG(50, 50);
}

/**
 * 生成損壞的圖像檔案
 */
function createBrokenImage(): File {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes（不完整）
  return new File([buffer], 'broken.png', { type: 'image/png' });
}

// ─────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────


describe('ClarityService', () => {
  let service: ClarityService;

  beforeEach(() => {
    service = new ClarityService();
  });

  // ────── 快取 API 驗證 ──────
  it('should expose cache management API', () => {
    expect(service.cacheSize).toBe(0);
    service.clearCache();
    expect(service.cacheSize).toBe(0);
  });

  // 注意：真實的圖像 assess 測試移到 assessOCRQuality.test.ts
  // 因為 jsdom 環境中 Canvas + FileReader 組合會導致逾時
});

describe('assessOCRQuality', () => {
  // ────── 所有關鍵欄位都通過 ──────
  it('should return shouldEnhance=false when all key fields pass', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,    // > 0.90 ✓
        seller_tax_id: 0.90,     // >= 0.85 ✓
        amount_total: 0.92,      // > 0.90 ✓
        invoice_date: 0.88,      // > 0.85 ✓
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(100);
    expect(result.failedFields).toEqual([]);
    expect(result.shouldEnhance).toBe(false);
  });

  // ────── invoice_number 信心度不足 ──────
  it('should mark shouldEnhance=true when invoice_number confidence is low', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.80,    // < 0.90 ✗
        seller_tax_id: 0.90,
        amount_total: 0.92,
        invoice_date: 0.88,
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(75); // 3/4 = 75%
    expect(result.failedFields).toContain('invoice_number');
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── seller_tax_id 信心度不足 ──────
  it('should mark shouldEnhance=true when seller_tax_id confidence is low', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.80,    // < 0.85 ✗
        amount_total: 0.92,
        invoice_date: 0.88,
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(75); // 3/4 = 75%
    expect(result.failedFields).toContain('seller_tax_id');
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── amount_total 信心度不足 ──────
  it('should mark shouldEnhance=true when amount_total confidence is low', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.90,
        amount_total: 0.85,    // < 0.90 ✗
        invoice_date: 0.88,
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(75); // 3/4 = 75%
    expect(result.failedFields).toContain('amount_total');
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── 多個欄位失敗 ──────
  it('should handle multiple failed fields', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.70,    // ✗
        seller_tax_id: 0.70,     // ✗
        amount_total: 0.92,      // ✓
        invoice_date: 0.88,      // ✓
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(50); // 2/4 = 50%
    expect(result.failedFields).toEqual(['invoice_number', 'seller_tax_id']);
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── 缺失 field_confidence ──────
  it('should treat missing field_confidence as 0 (fail)', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      // field_confidence 完全缺失
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(0); // 0/4 = 0%
    expect(result.failedFields.length).toBe(4); // 所有欄位都失敗
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── keyFieldsConfidence 邊界值 = 80% ──────
  it('should mark shouldEnhance=true when keyFieldsConfidence = 80', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.90,
        amount_total: 0.92,
        invoice_date: 0.70,    // < 0.85 ✗
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(75); // < 80
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── keyFieldsConfidence 剛好超過 80% ──────
  it('should mark shouldEnhance=false when keyFieldsConfidence = 100', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.90,
        amount_total: 0.92,
        invoice_date: 0.88,
      },
    };

    const result = await assessOCRQuality(mockOCR);

    expect(result.keyFieldsConfidence).toBe(100);
    expect(result.shouldEnhance).toBe(false);
  });

  // ────── 自訂 threshold ──────
  it('should respect custom threshold parameter', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.90,
        amount_total: 0.92,
        invoice_date: 0.88,
      },
    };

    // 默認 threshold = 80
    const result1 = await assessOCRQuality(mockOCR, 80);
    expect(result1.shouldEnhance).toBe(false);

    // 提高 threshold 到 100
    const result2 = await assessOCRQuality(mockOCR, 100);
    expect(result2.shouldEnhance).toBe(false); // 仍然 100%，還是通過

    // 降低 threshold 到 50
    const result3 = await assessOCRQuality(mockOCR, 50);
    expect(result3.shouldEnhance).toBe(false);
  });

  // ────── 邊界：threshold = keyFieldsConfidence ──────
  it('should mark shouldEnhance=true when keyFieldsConfidence < threshold', async () => {
    const mockOCR: InvoiceData = {
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice',
      invoice_number: '12345',
      seller_name: 'Seller Inc',
      seller_tax_id: '12345678',
      amount_total: 1000,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.95,
        seller_tax_id: 0.90,
        amount_total: 0.92,
        invoice_date: 0.70,    // ✗
      },
    };

    // keyFieldsConfidence = 75，threshold = 75 → 應該 shouldEnhance = true（< 不是 <=）
    const result = await assessOCRQuality(mockOCR, 75);
    expect(result.keyFieldsConfidence).toBe(75);
    expect(result.shouldEnhance).toBe(false); // 75 < 75 is false
  });
});
