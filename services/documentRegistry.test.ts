import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isKnownType,
  getRegistry,
  recordUnknownType,
  type UnknownDocumentType,
} from './documentRegistry';

describe('documentRegistry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00Z'));
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe('isKnownType()', () => {
    it('應認識所有已知類型', () => {
      const knownTypes = [
        '三聯手寫',
        '三聯收銀',
        '三聯電子',
        '二聯收銀',
        '收據',
        '交通票券',
        'Invoice',
        '其他',
      ];
      knownTypes.forEach(type => {
        expect(isKnownType(type)).toBe(true);
      });
    });

    it('應回傳 false 給未知的類型：旅行社代收轉付收據', () => {
      expect(isKnownType('旅行社代收轉付收據')).toBe(false);
    });

    it('應回傳 false 給未知的類型：計程車收據', () => {
      expect(isKnownType('計程車收據')).toBe(false);
    });

    it('應回傳 false 給空字串', () => {
      expect(isKnownType('')).toBe(false);
    });
  });

  describe('getRegistry()', () => {
    it('初始時 localStorage 為空應回傳空陣列', () => {
      const registry = getRegistry();
      expect(registry).toEqual([]);
    });

    it('localStorage 損毀（JSON parse 失敗）應回傳空陣列', () => {
      localStorage.setItem('hscl_document_registry', '{invalid json}');
      const registry = getRegistry();
      expect(registry).toEqual([]);
    });

    it('localStorage 有資料應正確 parse 回傳陣列', () => {
      const testData: UnknownDocumentType[] = [
        {
          document_type: '旅行社代收轉付收據',
          voucher_type: '收據',
          tax_code: 'TXXX',
          first_seen: '2024-01-15T10:00:00Z',
          last_seen: '2024-01-15T10:00:00Z',
          count: 1,
          sample_seller: '旅行社甲',
          has_invoice_number: false,
        },
      ];
      localStorage.setItem('hscl_document_registry', JSON.stringify(testData));
      const registry = getRegistry();
      expect(registry).toEqual(testData);
    });
  });

  describe('recordUnknownType()', () => {
    it('第一次記錄應新增一筆，count=1，first_seen 和 last_seen 相同', () => {
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      const registry = getRegistry();
      expect(registry).toHaveLength(1);
      const record = registry[0];
      expect(record.document_type).toBe('旅行社代收轉付收據');
      expect(record.voucher_type).toBe('收據');
      expect(record.tax_code).toBe('TXXX');
      expect(record.count).toBe(1);
      expect(record.first_seen).toBe('2024-01-15T10:30:00Z');
      expect(record.last_seen).toBe('2024-01-15T10:30:00Z');
      expect(record.sample_seller).toBe('旅行社甲');
      expect(record.has_invoice_number).toBe(false);
    });

    it('第二次記錄同 document_type 應增加 count 並更新 last_seen', () => {
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      vi.advanceTimersByTime(60000); // 進行 1 分鐘
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社乙', false);

      const registry = getRegistry();
      expect(registry).toHaveLength(1);
      const record = registry[0];
      expect(record.count).toBe(2);
      expect(record.first_seen).toBe('2024-01-15T10:30:00Z');
      expect(record.last_seen).toBe('2024-01-15T10:31:00Z');
      expect(record.sample_seller).toBe('旅行社甲'); // 保留第一次的 seller
    });

    it('已知類型不應記錄', () => {
      recordUnknownType('三聯手寫', '三聯手寫', null, '某公司', true);
      const registry = getRegistry();
      expect(registry).toHaveLength(0);
    });

    it('不同 document_type 應新增為不同筆記錄', () => {
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', false);

      const registry = getRegistry();
      expect(registry).toHaveLength(2);
      expect(registry[0].document_type).toBe('旅行社代收轉付收據');
      expect(registry[1].document_type).toBe('計程車收據');
    });

    it('多次記錄不同類型應分別計數', () => {
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', false);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', false);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', false);

      const registry = getRegistry();
      expect(registry).toHaveLength(2);
      const travelAgency = registry.find(r => r.document_type === '旅行社代收轉付收據');
      const taxi = registry.find(r => r.document_type === '計程車收據');
      expect(travelAgency?.count).toBe(2);
      expect(taxi?.count).toBe(3);
    });

    it('should handle null tax_code correctly', () => {
      recordUnknownType('計程車收據', '收據', null, '計程車公司', false);
      const registry = getRegistry();
      expect(registry[0].tax_code).toBeNull();
    });

    it('should update sample_seller only on first record', () => {
      recordUnknownType('新類型', '收據', null, '賣方甲', false);
      recordUnknownType('新類型', '收據', null, '賣方乙', false);
      recordUnknownType('新類型', '收據', null, '賣方丙', false);

      const registry = getRegistry();
      const record = registry[0];
      expect(record.sample_seller).toBe('賣方甲');
    });
  });

  describe('整合測試', () => {
    it('應在 localStorage 滿時保持 registry 狀態（silent fail）', () => {
      const mockSetItem = vi.spyOn(Storage.prototype, 'setItem');
      mockSetItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      });

      recordUnknownType('新類型', '收據', null, '某公司', false);
      // 儘管 localStorage 滿，但 registry 應被更新（只是沒存到 localStorage）
      // 由於 catch 在 recordUnknownType 內靜默忽略，我們驗證呼叫沒有拋錯
      expect(() =>
        recordUnknownType('新類型', '收據', null, '某公司', false),
      ).not.toThrow();

      mockSetItem.mockRestore();
    });

    it('複雜場景：多個類型、多次記錄、查詢', () => {
      // 建立 3 個不同的未知類型
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      recordUnknownType('旅行社代收轉付收據', '收據', 'TXXX', '旅行社甲', false);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', true);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', true);
      recordUnknownType('計程車收據', '收據', null, '計程車公司', true);
      recordUnknownType('快遞單', '其他', null, '快遞公司', false);

      const registry = getRegistry();
      expect(registry).toHaveLength(3);

      const travelAgency = registry.find(r => r.document_type === '旅行社代收轉付收據');
      const taxi = registry.find(r => r.document_type === '計程車收據');
      const delivery = registry.find(r => r.document_type === '快遞單');

      expect(travelAgency?.count).toBe(2);
      expect(taxi?.count).toBe(3);
      expect(delivery?.count).toBe(1);
      expect(delivery?.sample_seller).toBe('快遞公司');
    });
  });
});
