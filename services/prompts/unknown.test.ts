import { describe, it, expect } from 'vitest';
import { buildUnknownTypePrompt } from './unknown';
import type { UnknownDocumentType } from '../documentRegistry';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<UnknownDocumentType> = {}): UnknownDocumentType {
  return {
    document_type: '旅行社代收轉付收據',
    voucher_type: '收據',
    tax_code: 'TXXX',
    count: 3,
    first_seen: '2026-05-01T00:00:00.000Z',
    last_seen: '2026-05-20T00:00:00.000Z',
    sample_seller: '旅行社甲',
    has_invoice_number: false,
    ...overrides,
  };
}

// ── 段落 1 / 4 / 5 常青驗證 ──────────────────────────────────────────────────

describe('1. 基本結構', () => {
  it('a) 兩個輸入都空 — 應包含段落 1、4、5，不含段落 2、3', () => {
    const out = buildUnknownTypePrompt([], undefined);

    expect(out).toContain('UNKNOWN DOCUMENT TYPE HANDLING');
    expect(out).toContain('EXTRACTION RULES FOR UNKNOWN TYPES');
    expect(out).toContain('OUTPUT REQUIREMENTS');

    expect(out).not.toContain('PREVIOUSLY ENCOUNTERED');
    expect(out).not.toContain('DOCUMENT TYPE HINT');
  });

  it('b) 有 registry 資料 — 應包含段落 2 及 registry 內容', () => {
    const registry: UnknownDocumentType[] = [makeRecord()];
    const out = buildUnknownTypePrompt(registry, undefined);

    expect(out).toContain('PREVIOUSLY ENCOUNTERED NON-STANDARD DOCUMENT TYPES');
    expect(out).toContain('旅行社代收轉付收據');
    expect(out).toContain('seen 3 times');
    expect(out).toContain('example seller: "旅行社甲"');
  });

  it('c) 有 detectedDocumentType — 應包含段落 3', () => {
    const out = buildUnknownTypePrompt([], '旅行社代收轉付收據');

    expect(out).toContain('DOCUMENT TYPE HINT');
    expect(out).toContain('旅行社代收轉付收據');
  });

  it('d) 兩個都有 — 應同時包含段落 2 和段落 3', () => {
    const registry: UnknownDocumentType[] = [makeRecord()];
    const out = buildUnknownTypePrompt(registry, '計程車收據');

    expect(out).toContain('PREVIOUSLY ENCOUNTERED NON-STANDARD DOCUMENT TYPES');
    expect(out).toContain('DOCUMENT TYPE HINT');
  });
});

// ── registry 內容驗證 ─────────────────────────────────────────────────────────

describe('2. Registry 內容驗證', () => {
  it('a) 多筆記錄 — 兩筆都列出，各自 count 與 seller 正確', () => {
    const registry: UnknownDocumentType[] = [
      makeRecord({ document_type: '計程車收據', count: 5, sample_seller: '台灣大車隊' }),
      makeRecord({ document_type: '保險費收據', count: 12, sample_seller: '國泰人壽' }),
    ];
    const out = buildUnknownTypePrompt(registry, undefined);

    expect(out).toContain('計程車收據');
    expect(out).toContain('seen 5 times');
    expect(out).toContain('example seller: "台灣大車隊"');

    expect(out).toContain('保險費收據');
    expect(out).toContain('seen 12 times');
    expect(out).toContain('example seller: "國泰人壽"');
  });

  it('b) tax_code 為 null — 應顯示 "tax_code: unknown"', () => {
    const registry: UnknownDocumentType[] = [makeRecord({ tax_code: null })];
    const out = buildUnknownTypePrompt(registry, undefined);

    expect(out).toContain('tax_code: unknown');
  });

  it('c) 特殊字符（含引號）— 不崩潰，內容正確出現', () => {
    const registry: UnknownDocumentType[] = [
      makeRecord({
        document_type: '商務收據（含"報價"）',
        sample_seller: '公司"X"有限',
      }),
    ];
    expect(() => buildUnknownTypePrompt(registry, undefined)).not.toThrow();

    const out = buildUnknownTypePrompt(registry, undefined);
    expect(out).toContain('商務收據（含"報價"）');
    expect(out).toContain('公司"X"有限');
  });
});

// ── Prompt 長度控制 ───────────────────────────────────────────────────────────

describe('3. Prompt 長度控制', () => {
  it('a) 即使 registry 有 10 筆，字數仍 < 600 英文字（約 800 tokens）', () => {
    const registry: UnknownDocumentType[] = Array.from({ length: 10 }, (_, i) =>
      makeRecord({
        document_type: `未知類型${i + 1}`,
        count: i + 1,
        sample_seller: `賣家${i + 1}`,
      }),
    );
    const out = buildUnknownTypePrompt(registry, '某類型');
    const wordCount = out.split(/\s+/).filter(Boolean).length;

    expect(wordCount).toBeLessThan(600);
  });
});

// ── 邏輯邊界 ──────────────────────────────────────────────────────────────────

describe('4. 邏輯邊界', () => {
  it('a) detectedDocumentType 全空白 — 不應包含段落 3', () => {
    const out = buildUnknownTypePrompt([], '   ');

    expect(out).not.toContain('DOCUMENT TYPE HINT');
  });

  it('b) registry 空陣列 — 無段落 2，但有段落 1/4/5', () => {
    const out = buildUnknownTypePrompt([], undefined);

    expect(out).not.toContain('PREVIOUSLY ENCOUNTERED');
    expect(out).toContain('UNKNOWN DOCUMENT TYPE HANDLING');
    expect(out).toContain('EXTRACTION RULES FOR UNKNOWN TYPES');
    expect(out).toContain('OUTPUT REQUIREMENTS');
  });
});
