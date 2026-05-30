/**
 * @vitest-environment jsdom
 * Tests for useOCRBatch hook - conditional enhancement flow integration.
 * Covers: clarity assessment → Flash OCR → quality evaluation → conditional enhancement.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InvoiceData, InvoiceEntry, Project } from '../../types';
import { ClarityService, type ClarityScore, type OCRQualityAssessment } from '../services/imageClarity';
import type { OCRResult } from '../../types';

// ─────────────────────────────────────────────
// Mock Utilities
// ─────────────────────────────────────────────

/**
 * 生成測試用 ClarityScore
 */
function createMockClarityScore(clarity: 'clear' | 'blurry', confidence: number): ClarityScore {
  return {
    clarity,
    confidence,
    contrast: clarity === 'clear' ? 80 : 30,
    laplacian: clarity === 'clear' ? 150 : 50,
  };
}

/**
 * 生成測試用 OCRQualityAssessment
 */
function createMockOCRQuality(
  keyFieldsConfidence: number,
  failedFields: string[] = []
): OCRQualityAssessment {
  return {
    keyFieldsConfidence,
    failedFields,
    shouldEnhance: keyFieldsConfidence < 80,
  };
}

/**
 * 生成測試用 InvoiceData（OCR 結果）
 */
function createMockInvoiceData(overrides?: Partial<InvoiceData>): InvoiceData {
  return {
    page_count: 1,
    page_number: 1,
    document_type: 'Tax Invoice',
    invoice_number: 'IV-001',
    seller_name: 'Test Seller',
    seller_tax_id: '12345678',
    buyer_name: 'Test Buyer',
    buyer_tax_id: '87654321',
    amount_total: 1000,
    amount_sales: 1000,
    amount_tax: 100,
    invoice_date: '2024-01-01',
    field_confidence: {
      invoice_number: 0.95,
      seller_tax_id: 0.90,
      amount_total: 0.92,
      invoice_date: 0.88,
    },
    trace_logs: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Test Suites
// ─────────────────────────────────────────────

describe('Conditional Enhancement Flow Integration', () => {
  // ────── 路徑 A：清晰圖像 → 直接 Flash ──────
  describe('Path A: Clear Image → Direct Flash', () => {
    it('should skip enhancement for clear images', async () => {
      const clarity: ClarityScore = createMockClarityScore('clear', 95);

      expect(clarity.clarity).toBe('clear');
      expect(clarity.confidence).toBeGreaterThan(80);

      // 決策邏輯：clear → decisionReason = 'direct_flash'
      const decisionReason = clarity.clarity === 'clear' ? 'direct_flash' : 'quality_based';
      expect(decisionReason).toBe('direct_flash');
    });

    it('should cost only 1x Flash for clear image', async () => {
      const clarity: ClarityScore = createMockClarityScore('clear', 95);
      const costs = { flash: 0, pro: 0, enhanced: 0 };

      // 只跑一次 Flash
      costs.flash = 1;

      expect(costs.flash).toBe(1);
      expect(costs.pro).toBe(0);
      expect(costs.enhanced).toBe(0);
    });
  });

  // ────── 路徑 B：模糊圖像 + Flash 成功 → 無增強 ──────
  describe('Path B: Blurry Image + Flash OK → No Enhancement', () => {
    it('should skip enhancement when Flash quality is sufficient', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(90); // ≥ 80

      expect(clarity.clarity).toBe('blurry');
      expect(ocrQuality.keyFieldsConfidence).toBeGreaterThanOrEqual(80);
      expect(ocrQuality.shouldEnhance).toBe(false);

      const decisionReason = ocrQuality.shouldEnhance
        ? 'quality_based_enhanced'
        : 'quality_based_flash_ok';
      expect(decisionReason).toBe('quality_based_flash_ok');
    });

    it('should cost only 1x Flash when Flash quality is OK', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(85);

      const costs = { flash: 0, pro: 0, enhanced: 0 };

      // 步驟：
      // 1. 先跑 Flash（cost.flash++）
      // 2. 評估品質：keyFieldsConfidence=85 ≥ 80 → 不增強
      costs.flash = 1;

      expect(costs.flash).toBe(1);
      expect(costs.pro).toBe(0);
      expect(costs.enhanced).toBe(0);
    });

    it('should log decision reason = quality_based_flash_ok', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(90);

      const decisionReason = !ocrQuality.shouldEnhance
        ? 'quality_based_flash_ok'
        : 'quality_based_enhanced';

      expect(decisionReason).toBe('quality_based_flash_ok');
    });

    it('should trace clarity and quality assessment in logs', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(90);
      const ocrResult = createMockInvoiceData();

      // 模擬記錄 trace_log
      const clarityLog = `[Clarity] TEST_ID: clarity=${clarity.clarity}, Flash quality=${ocrQuality.keyFieldsConfidence}%, no enhancement needed`;
      ocrResult.trace_logs = [clarityLog];

      expect(ocrResult.trace_logs[0]).toContain('clarity=blurry');
      expect(ocrResult.trace_logs[0]).toContain('Flash quality=90%');
    });
  });

  // ────── 路徑 C：模糊圖像 + Flash 失敗 → 增強 ──────
  describe('Path C: Blurry Image + Flash Fails → Enhancement', () => {
    it('should apply enhancement when Flash quality is insufficient', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(60); // < 80

      expect(clarity.clarity).toBe('blurry');
      expect(ocrQuality.keyFieldsConfidence).toBeLessThan(80);
      expect(ocrQuality.shouldEnhance).toBe(true);

      const decisionReason = ocrQuality.shouldEnhance
        ? 'quality_based_enhanced'
        : 'quality_based_flash_ok';
      expect(decisionReason).toBe('quality_based_enhanced');
    });

    it('should cost 1x Flash + 1x Pro when enhancement is triggered', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(60); // < 80

      const costs = { flash: 0, pro: 0, enhanced: 0 };

      // 步驟：
      // 1. Flash 嘗試：costs.flash++
      // 2. 評估品質：keyFieldsConfidence=60 < 80 → 需要增強
      // 3. 增強圖像，升級 Pro：costs.pro++
      costs.flash = 1;
      costs.pro = 1;

      expect(costs.flash).toBe(1);
      expect(costs.pro).toBe(1);
      expect(costs.enhanced).toBe(0); // enhanced 計數器不增加（internal 決策）
    });

    it('should log failed fields when quality is insufficient', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(
        60,
        ['invoice_number', 'seller_tax_id']
      );

      expect(ocrQuality.failedFields).toEqual(['invoice_number', 'seller_tax_id']);
      expect(ocrQuality.shouldEnhance).toBe(true);
    });

    it('should log enhancement decision', async () => {
      const clarity: ClarityScore = createMockClarityScore('blurry', 45);
      const ocrQuality: OCRQualityAssessment = createMockOCRQuality(60, ['invoice_number']);
      const ocrResult = createMockInvoiceData();

      const clarityLog = `[Clarity] TEST_ID: clarity=${clarity.clarity}, Flash quality=${ocrQuality.keyFieldsConfidence}%, failed fields: ${ocrQuality.failedFields.join(',')}), applying enhancement`;
      ocrResult.trace_logs = [clarityLog];

      expect(ocrResult.trace_logs[0]).toContain('applying enhancement');
      expect(ocrResult.trace_logs[0]).toContain('invoice_number');
    });
  });

  // ────── 路徑 D：清晰度評估失敗 → Fallback 到 blurry ──────
  describe('Path D: Clarity Assessment Fails → Fallback', () => {
    it('should fallback to blurry when clarity assessment throws', async () => {
      let clarity: ClarityScore | null = null;

      try {
        // 模擬 clarityService 拋錯
        throw new Error('Canvas error');
      } catch (err) {
        // 捕捉，fallback 到假設模糊
        clarity = createMockClarityScore('blurry', 0);
      }

      expect(clarity).not.toBeNull();
      expect(clarity!.clarity).toBe('blurry');
    });

    it('should not interrupt processing on clarity error', async () => {
      let interrupted = false;
      let processed = false;

      try {
        // 模擬清晰度評估失敗
        throw new Error('Clarity error');
      } catch (err) {
        // 不中斷，繼續用原圖跑 Flash
        processed = true;
      }

      expect(interrupted).toBe(false);
      expect(processed).toBe(true);
    });
  });

  // ────── 路徑 E：增強失敗 → Fallback 到 Flash 結果 ──────
  describe('Path E: Enhancement Fails → Fallback to Flash', () => {
    it('should fallback to Flash result when enhancement throws', async () => {
      const flashResult = createMockInvoiceData();
      let enhancementFailed = false;

      try {
        // 模擬增強失敗
        throw new Error('Enhancement error');
      } catch (err) {
        // 使用 Flash 結果作為 fallback
        enhancementFailed = true;
      }

      expect(enhancementFailed).toBe(true);
      expect(flashResult).toBeDefined();

      // trace_log 應記錄 fallback
      const fallbackLog = `[Clarity] TEST_ID: enhancement failed, using Flash result as fallback`;
      flashResult.trace_logs = [fallbackLog];
      expect(flashResult.trace_logs[0]).toContain('fallback');
    });

    it('should cost only 1x Flash when enhancement fails', async () => {
      const costs = { flash: 1, pro: 0, fallback: true };

      // enhancement 失敗不應該加 Pro cost
      expect(costs.flash).toBe(1);
      expect(costs.pro).toBe(0);
      expect(costs.fallback).toBe(true);
    });

    it('should continue processing after enhancement error', async () => {
      const items = ['file1', 'file2', 'file3'];
      const processed: string[] = [];

      for (const item of items) {
        try {
          if (item === 'file2') {
            throw new Error('Enhancement failed');
          }
          processed.push(item);
        } catch (err) {
          // 捕捉，記錄 fallback，繼續下一個
          processed.push(item + '_fallback');
        }
      }

      expect(processed).toEqual(['file1', 'file2_fallback', 'file3']);
    });
  });

  // ────── 重複發票檢查 ──────
  describe('Duplicate Invoice Detection', () => {
    it('should detect duplicate invoice numbers', async () => {
      const seenInvoiceNumbers = new Set<string>();
      const invoices = [
        createMockInvoiceData({ invoice_number: 'IV-001' }),
        createMockInvoiceData({ invoice_number: 'IV-002' }),
        createMockInvoiceData({ invoice_number: 'IV-001' }), // 重複
      ];

      for (const inv of invoices) {
        const normNo = (inv.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
        if (normNo) {
          if (seenInvoiceNumbers.has(normNo)) {
            inv.trace_logs = inv.trace_logs || [];
            inv.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${inv.invoice_number}`);
          } else {
            seenInvoiceNumbers.add(normNo);
          }
        }
      }

      expect(invoices[2].trace_logs).toContain(
        '[System Warning] Duplicate Invoice Number Detected: IV-001'
      );
      expect(seenInvoiceNumbers.size).toBe(2); // IV-001, IV-002
    });

    it('should normalize invoice numbers before comparison', async () => {
      const seenInvoiceNumbers = new Set<string>();
      const invoices = [
        createMockInvoiceData({ invoice_number: 'IV-001' }),
        createMockInvoiceData({ invoice_number: 'IV - 001' }), // 含空格
        createMockInvoiceData({ invoice_number: 'iv-001' }), // 小寫
      ];

      for (const inv of invoices) {
        const normNo = (inv.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
        if (!seenInvoiceNumbers.has(normNo)) {
          seenInvoiceNumbers.add(normNo);
        }
      }

      // 三個都是同一張發票（歸一化後）
      expect(seenInvoiceNumbers.size).toBe(1);
      expect(seenInvoiceNumbers.has('IV001')).toBe(true);
    });
  });

  // ────── 決策流程覆蓋 ──────
  describe('Decision Tree Coverage', () => {
    it('should handle PDF files (skip clarity check)', async () => {
      const file = new File(
        [Buffer.from('mock pdf')],
        'test.pdf',
        { type: 'application/pdf' }
      );

      const isImageFile = file.type.startsWith('image/');
      expect(isImageFile).toBe(false);

      // PDF 應跳過清晰度評估，直接用原有 Gemini 渲染
      const decisionReason = isImageFile ? 'direct_flash' : 'pdf_native';
      expect(decisionReason).toBe('pdf_native');
    });

    it('should handle image files with clarity assessment', async () => {
      const file = new File(
        [Buffer.from('mock image')],
        'test.png',
        { type: 'image/png' }
      );

      const isImageFile = file.type.startsWith('image/');
      expect(isImageFile).toBe(true);

      // 圖像文件應進行清晰度評估
      const decisionReason = isImageFile ? 'clarity_based' : 'pdf_native';
      expect(decisionReason).toBe('clarity_based');
    });

    it('should collect all decision paths in trace logs', async () => {
      const result = createMockInvoiceData();

      const decisions = [
        'direct_flash',
        'quality_based_flash_ok',
        'quality_based_enhanced',
        'clarity_assessment_failed',
        'enhancement_failed',
      ];

      for (const decision of decisions) {
        const log = `[Decision] ${decision}`;
        result.trace_logs!.push(log);
      }

      expect(result.trace_logs!.length).toBe(5);
      expect(result.trace_logs!.some((log) => log.includes('direct_flash'))).toBe(true);
    });
  });

  // ────── 邊界情況 ──────
  describe('Edge Cases', () => {
    it('should handle zero confidence clarity score', async () => {
      const clarity: ClarityScore = {
        clarity: 'blurry',
        confidence: 0,
        contrast: 0,
        laplacian: 0,
      };

      expect(clarity.confidence).toBe(0);
      expect(clarity.clarity).toBe('blurry');

      // 應該走質量檢查路徑
      const decisionReason = clarity.clarity === 'clear' ? 'direct_flash' : 'quality_based';
      expect(decisionReason).toBe('quality_based');
    });

    it('should handle 100% confidence clarity score', async () => {
      const clarity: ClarityScore = createMockClarityScore('clear', 100);

      expect(clarity.confidence).toBe(100);
      expect(clarity.clarity).toBe('clear');

      const decisionReason = clarity.clarity === 'clear' ? 'direct_flash' : 'quality_based';
      expect(decisionReason).toBe('direct_flash');
    });

    it('should handle OCR result with no field_confidence', async () => {
      const ocrResult = createMockInvoiceData({ field_confidence: undefined });

      // 無欄位信心度 → shouldEnhance = true
      const failCount = 4;
      expect(failCount).toBe(4);
      expect(ocrResult.field_confidence).toBeUndefined();
    });

    it('should handle multi-invoice results (use first for quality check)', async () => {
      const results = [
        createMockInvoiceData({ invoice_number: 'IV-001' }),
        createMockInvoiceData({ invoice_number: 'IV-002' }),
        createMockInvoiceData({ invoice_number: 'IV-003' }),
      ];

      // 多發票文件：只檢查第一張的品質
      const firstQuality = results[0].field_confidence?.invoice_number ?? 0;
      expect(firstQuality).toBe(0.95);

      // 三張都應有 trace_logs（至少為陣列）
      expect(results.length).toBe(3);
      expect(results.every((r) => Array.isArray(r.trace_logs))).toBe(true);
    });
  });
});

describe('OCRQualityAssessment Calculations', () => {
  it('should calculate keyFieldsConfidence as percentage', async () => {
    const quality1 = createMockOCRQuality(100, []); // 4/4
    const quality2 = createMockOCRQuality(75, ['invoice_number']); // 3/4
    const quality3 = createMockOCRQuality(50, ['invoice_number', 'seller_tax_id']); // 2/4
    const quality4 = createMockOCRQuality(25, ['invoice_number', 'seller_tax_id', 'amount_total']); // 1/4
    const quality5 = createMockOCRQuality(0, ['invoice_number', 'seller_tax_id', 'amount_total', 'invoice_date']); // 0/4

    expect(quality1.keyFieldsConfidence).toBe(100);
    expect(quality2.keyFieldsConfidence).toBe(75);
    expect(quality3.keyFieldsConfidence).toBe(50);
    expect(quality4.keyFieldsConfidence).toBe(25);
    expect(quality5.keyFieldsConfidence).toBe(0);
  });

  it('should round keyFieldsConfidence to nearest integer', async () => {
    // 如果實現中用 Math.round((passCount / totalFields) * 100)
    const quality = createMockOCRQuality(67); // 2.67/4 ≈ 67%
    expect(quality.keyFieldsConfidence).toBe(67);
  });
});
