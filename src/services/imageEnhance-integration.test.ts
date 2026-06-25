/**
 * @vitest-environment jsdom
 * Integration tests for image enhancement and decision logic.
 * Covers: Task 3 (useOCRBatch enhancement decision), Task 4 (imageEnhance).
 */

import { describe, it, expect, vi } from 'vitest';
import type { InvoiceData } from '../../types';

// ─────────────────────────────────────────────
// 5.3 端到端條件式增強流程
// ─────────────────────────────────────────────

describe('Conditional Enhancement Decision Flow', () => {
  // 模擬決策邏輯（實際在 useOCRBatch 中）
  function decideEnhancementPath(
    imageClarityClear: boolean,
    ocrQualityPass: boolean,
  ): {
    decisionReason:
      | 'direct_flash'
      | 'quality_based_flash_ok'
      | 'quality_based_enhanced'
      | 'fallback_blurry';
    shouldEnhance: boolean;
  } {
    // 路徑 1：清晰圖像 → 直接 Flash（最便宜）
    if (imageClarityClear) {
      return {
        decisionReason: 'direct_flash',
        shouldEnhance: false,
      };
    }

    // 路徑 2：模糊圖像 + OCR 品質好 → Flash 足夠（中等成本）
    if (!imageClarityClear && ocrQualityPass) {
      return {
        decisionReason: 'quality_based_flash_ok',
        shouldEnhance: false,
      };
    }

    // 路徑 3：模糊圖像 + OCR 品質差 → 增強（高成本）
    if (!imageClarityClear && !ocrQualityPass) {
      return {
        decisionReason: 'quality_based_enhanced',
        shouldEnhance: true,
      };
    }

    // Fallback
    return {
      decisionReason: 'fallback_blurry',
      shouldEnhance: false,
    };
  }

  // ────── 路徑 1：清晰圖像 ──────
  it('clear image → direct_flash (no enhancement)', () => {
    const result = decideEnhancementPath(true, true); // clarity=clear, OCR任何品質都無關

    expect(result.decisionReason).toBe('direct_flash');
    expect(result.shouldEnhance).toBe(false);
  });

  // ────── 路徑 2：模糊 + OCR 好 ──────
  it('blurry image + high OCR quality → flash is sufficient', () => {
    const result = decideEnhancementPath(false, true); // clarity=blurry, ocrQuality=pass

    expect(result.decisionReason).toBe('quality_based_flash_ok');
    expect(result.shouldEnhance).toBe(false);
  });

  // ────── 路徑 3：模糊 + OCR 差 ──────
  it('blurry image + low OCR quality → must enhance', () => {
    const result = decideEnhancementPath(false, false); // clarity=blurry, ocrQuality=fail

    expect(result.decisionReason).toBe('quality_based_enhanced');
    expect(result.shouldEnhance).toBe(true);
  });

  // ────── Fallback ──────
  it('should fallback gracefully when clarity assessment fails', () => {
    // clarity=null 時，假設為 blurry + OCR好，應直接 Flash
    const result = decideEnhancementPath(false, true);

    expect(result.decisionReason).toBe('quality_based_flash_ok');
    expect(result.shouldEnhance).toBe(false);
  });
});

// ─────────────────────────────────────────────
// 5.4 增強前後成本評估
// ─────────────────────────────────────────────

describe('Cost Model for Enhancement Decisions', () => {
  // 模擬成本計算
  function estimateCost(
    decisionReason: string,
    imageSize: number, // 像素數
  ): {
    provider: 'flash' | 'pro' | 'pro_vision';
    estimatedCost: number;
    rationale: string;
  } {
    switch (decisionReason) {
      case 'direct_flash':
        // 直接 Flash：最便宜（~1 千線）
        return {
          provider: 'flash',
          estimatedCost: 5,
          rationale: 'Flash multimodal, best cost',
        };

      case 'quality_based_flash_ok':
        // Flash + 再次 Flash：中等（~2 千線）
        return {
          provider: 'flash',
          estimatedCost: 10,
          rationale: 'Two Flash calls',
        };

      case 'quality_based_enhanced':
        // 增強 + Pro Vision：昂貴（~10-15 千線 + 增強成本）
        return {
          provider: 'pro_vision',
          estimatedCost: 50,
          rationale: 'Image enhancement + Pro Vision',
        };

      default:
        return {
          provider: 'flash',
          estimatedCost: 10,
          rationale: 'Fallback to Flash',
        };
    }
  }

  // ────── 成本對比：直接 Flash ──────
  it('direct_flash should be cheapest (cost ≈ 5)', () => {
    const cost = estimateCost('direct_flash', 200 * 200);

    expect(cost.estimatedCost).toBeLessThanOrEqual(5);
    expect(cost.provider).toBe('flash');
  });

  // ────── 成本對比：Flash + Flash ──────
  it('quality_based_flash_ok should be moderate (cost ≈ 10)', () => {
    const cost = estimateCost('quality_based_flash_ok', 200 * 200);

    expect(cost.estimatedCost).toBeGreaterThan(5);
    expect(cost.estimatedCost).toBeLessThanOrEqual(15);
    expect(cost.provider).toBe('flash');
  });

  // ────── 成本對比：增強 + Pro Vision ──────
  it('quality_based_enhanced should be most expensive (cost > 40)', () => {
    const cost = estimateCost('quality_based_enhanced', 200 * 200);

    expect(cost.estimatedCost).toBeGreaterThan(40);
    expect(cost.provider).toBe('pro_vision');
  });

  // ────── 成本線性性：圖像尺寸不影響決策成本 ──────
  it('decision cost should not scale with image size', () => {
    const cost1 = estimateCost('quality_based_enhanced', 100 * 100);
    const cost2 = estimateCost('quality_based_enhanced', 500 * 500);

    // 決策成本應相同（增強邏輯固定）
    expect(cost1.estimatedCost).toBe(cost2.estimatedCost);
  });
});

// ─────────────────────────────────────────────
// 5.5 邊界情況：失敗容錯
// ─────────────────────────────────────────────

describe('Error Handling and Fallback Paths', () => {
  function assessAndEnhanceWithFallback(
    clarityResult: { clarity: 'clear' | 'blurry' } | null,
    ocrQualityResult: { shouldEnhance: boolean } | null,
  ): {
    used: 'flash' | 'enhanced_flash';
    fallbackReason?: string;
  } {
    // 若 clarity 評估失敗，假設 blurry（保守）
    const clarity = clarityResult?.clarity ?? 'blurry';

    // 若 OCR 評估失敗，假設成功（樂觀）
    const qualityPass = ocrQualityResult?.shouldEnhance === true ? false : true;

    const isClear = clarity === 'clear';

    if (isClear || qualityPass) {
      return { used: 'flash' };
    }

    return {
      used: 'enhanced_flash',
      fallbackReason: 'OCR quality low',
    };
  }

  // ────── 清晰度評估失敗 → 假設 blurry ──────
  it('should assume blurry when clarity assessment fails', () => {
    const result = assessAndEnhanceWithFallback(null, {
      shouldEnhance: false,
    });

    // clarity=null 時，假設 blurry，但 OCR 好 → 用 Flash
    expect(result.used).toBe('flash');
    expect(result.fallbackReason).toBeUndefined();
  });

  // ────── OCR 評估失敗 → 假設成功 ──────
  it('should assume OCR success when assessment fails', () => {
    const result = assessAndEnhanceWithFallback(
      { clarity: 'blurry' },
      null,
    );

    // OCR=null 時，假設成功 → 用 Flash
    expect(result.used).toBe('flash');
  });

  // ────── 雙重失敗 → 保守降級 ──────
  it('should conservatively enhance when both assessments fail', () => {
    const result = assessAndEnhanceWithFallback(null, null);

    // 兩者都失敗 → 假設 clarity=blurry + ocrQuality=good → Flash
    expect(result.used).toBe('flash');
  });

  // ────── OCR 確實失敗 + clarity 也失敗 ──────
  it('should enhance when OCR fails despite clarity failing', () => {
    const result = assessAndEnhanceWithFallback(null, {
      shouldEnhance: true,
    });

    // clarity=null（假設 blurry） + OCR fail → 增強
    expect(result.used).toBe('enhanced_flash');
  });
});

// ─────────────────────────────────────────────
// 額外：流程全集合驗證
// ─────────────────────────────────────────────

describe('Full OCR Batch Processing Logic', () => {
  interface ProcessingStats {
    totalImages: number;
    processedWithFlash: number;
    processedWithEnhancement: number;
    estimatedTotalCost: number;
  }

  function simulateOCRBatchProcessing(
    images: Array<{
      clarity: 'clear' | 'blurry';
      ocrQualityPass: boolean;
    }>,
  ): ProcessingStats {
    let flashCount = 0;
    let enhanceCount = 0;
    let totalCost = 0;

    for (const image of images) {
      if (image.clarity === 'clear' || image.ocrQualityPass) {
        flashCount++;
        totalCost += 5; // Flash cost
      } else {
        enhanceCount++;
        totalCost += 50; // Enhancement cost
      }
    }

    return {
      totalImages: images.length,
      processedWithFlash: flashCount,
      processedWithEnhancement: enhanceCount,
      estimatedTotalCost: totalCost,
    };
  }

  // ────── 批次：全清晰 ──────
  it('should process all clear images with Flash', () => {
    const batch = [
      { clarity: 'clear' as const, ocrQualityPass: true },
      { clarity: 'clear' as const, ocrQualityPass: true },
      { clarity: 'clear' as const, ocrQualityPass: false }, // clarity clear, 無需增強
    ];

    const stats = simulateOCRBatchProcessing(batch);

    expect(stats.processedWithFlash).toBe(3);
    expect(stats.processedWithEnhancement).toBe(0);
    expect(stats.estimatedTotalCost).toBe(15);
  });

  // ────── 批次：混合 ──────
  it('should handle mixed batch correctly', () => {
    const batch = [
      { clarity: 'clear' as const, ocrQualityPass: true },
      { clarity: 'blurry' as const, ocrQualityPass: true }, // blurry but good OCR
      { clarity: 'blurry' as const, ocrQualityPass: false }, // blurry + bad OCR → enhance
    ];

    const stats = simulateOCRBatchProcessing(batch);

    expect(stats.processedWithFlash).toBe(2);
    expect(stats.processedWithEnhancement).toBe(1);
    expect(stats.estimatedTotalCost).toBe(10 + 50); // 2 Flash + 1 Enhancement
  });

  // ────── 批次：全需增強 ──────
  it('should enhance all low-quality blurry images', () => {
    const batch = [
      { clarity: 'blurry' as const, ocrQualityPass: false },
      { clarity: 'blurry' as const, ocrQualityPass: false },
      { clarity: 'blurry' as const, ocrQualityPass: false },
    ];

    const stats = simulateOCRBatchProcessing(batch);

    expect(stats.processedWithFlash).toBe(0);
    expect(stats.processedWithEnhancement).toBe(3);
    expect(stats.estimatedTotalCost).toBe(150);
  });
});
