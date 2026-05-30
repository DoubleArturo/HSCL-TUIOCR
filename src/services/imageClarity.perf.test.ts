/**
 * @vitest-environment jsdom
 * Performance baseline tests for imageClarity service (simplified).
 * 完整的性能測試需要在實際瀏覽器環境中運行。
 */

import { describe, it, expect } from 'vitest';
import { assessOCRQuality } from './imageClarity';
import type { InvoiceData } from '../../types';

// ─────────────────────────────────────────────
// 5.4 性能基準（簡化版，不依賴真實圖像）
// ─────────────────────────────────────────────

describe('Performance Baselines - Simplified', () => {
  // ────── assessOCRQuality 應快速 ──────
  it('assessOCRQuality should complete < 1ms per call', () => {
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

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      assessOCRQuality(mockOCR);
    }
    const elapsed = performance.now() - start;

    // 1000 次呼叫應 < 100ms
    expect(elapsed).toBeLessThan(100);
    console.log(`1000 calls to assessOCRQuality: ${elapsed.toFixed(2)}ms`);
  });

  // ────── 不同輸入的一致性 ──────
  it('should have consistent performance across different inputs', () => {
    const cases: InvoiceData[] = [
      {
        page_count: 1,
        page_number: 1,
        document_type: 'Tax Invoice',
        invoice_number: '12345',
        seller_name: 'A',
        seller_tax_id: '12345678',
        amount_total: 1000,
        invoice_date: '2024-01-01',
        field_confidence: {
          invoice_number: 0.95,
          seller_tax_id: 0.90,
          amount_total: 0.92,
          invoice_date: 0.88,
        },
      },
      {
        page_count: 1,
        page_number: 1,
        document_type: 'Invoice',
        invoice_number: '54321',
        seller_name: 'B Corp',
        seller_tax_id: '87654321',
        amount_total: 5000,
        invoice_date: '2024-01-02',
        field_confidence: {
          invoice_number: 0.70,
          seller_tax_id: 0.75,
          amount_total: 0.80,
          invoice_date: 0.85,
        },
      },
    ];

    const durations: number[] = [];
    for (const ocr of cases) {
      const start = performance.now();
      assessOCRQuality(ocr);
      durations.push(performance.now() - start);
    }

    // 所有呼叫應在 1ms 以內
    const allFast = durations.every((d) => d < 1);
    expect(allFast).toBe(true);
  });

  // ────── 邊界情況性能 ──────
  it('should handle edge cases efficiently', () => {
    const edgeCases: InvoiceData[] = [
      {
        page_count: 1,
        page_number: 1,
        document_type: 'Tax Invoice',
        invoice_number: '12345',
        seller_name: 'Seller Inc',
        seller_tax_id: '12345678',
        amount_total: 1000,
        invoice_date: '2024-01-01',
        field_confidence: undefined, // 缺失
      },
      {
        page_count: 1,
        page_number: 1,
        document_type: 'Tax Invoice',
        invoice_number: '12345',
        seller_name: 'Seller Inc',
        seller_tax_id: '12345678',
        amount_total: 1000,
        invoice_date: '2024-01-01',
        field_confidence: {
          invoice_number: 0,
          seller_tax_id: 0,
          amount_total: 0,
          invoice_date: 0,
        },
      },
    ];

    const start = performance.now();
    for (const ocr of edgeCases) {
      assessOCRQuality(ocr);
    }
    const elapsed = performance.now() - start;

    // 邊界情況應該同樣快
    expect(elapsed).toBeLessThan(10);
  });

  // ────── 批次處理模擬 ──────
  it('should handle batch processing efficiently', () => {
    const batch = Array.from({ length: 100 }, (_, i) => ({
      page_count: 1,
      page_number: 1,
      document_type: 'Tax Invoice' as const,
      invoice_number: `INV${i}`,
      seller_name: `Seller ${i}`,
      seller_tax_id: `${10000000 + i}`,
      amount_total: 1000 + i * 100,
      invoice_date: '2024-01-01',
      field_confidence: {
        invoice_number: 0.80 + Math.random() * 0.2,
        seller_tax_id: 0.75 + Math.random() * 0.2,
        amount_total: 0.85 + Math.random() * 0.15,
        invoice_date: 0.88 + Math.random() * 0.12,
      },
    }));

    const start = performance.now();
    for (const ocr of batch) {
      assessOCRQuality(ocr);
    }
    const elapsed = performance.now() - start;

    // 100 筆應 < 10ms
    expect(elapsed).toBeLessThan(10);
    console.log(`100-item batch assessment: ${elapsed.toFixed(2)}ms`);
  });
});

// ─────────────────────────────────────────────
// 注意
// ─────────────────────────────────────────────
// Canvas-based 圖像清晰度評估的完整性能測試（includin g
// image file I/O，Canvas rendering，FileReader 異步操作）
// 需要在真實瀏覽器環境中進行，因為 jsdom 不完全支援這些操作。
//
// 當前測試涵蓋 assessOCRQuality 的性能（該函式為純同步邏輯）。
// imageClarity 的完整評估應在集成測試或 E2E 測試中驗證。
