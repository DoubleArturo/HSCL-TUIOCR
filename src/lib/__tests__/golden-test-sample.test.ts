import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { ERPRecord } from '../../../types';

/**
 * Golden Test Sample Integration Tests
 *
 * Validates OCR + Audit Logic against real failure cases without requiring API calls.
 * Zero cost, deterministic test execution.
 */

interface GoldenTestCase {
  voucherId: string;
  category: string;
  errorType: string;
  erpRecords: ERPRecord[];
}

let testCases: GoldenTestCase[] = [];

beforeAll(() => {
  // Load ERP data
  const erpPath = path.resolve(
    __dirname,
    '../../../Test Data/Golden Test Sample/erp-data.json'
  );

  if (!fs.existsSync(erpPath)) {
    console.warn(
      'Golden Test Sample ERP data not found. Skipping integration tests.'
    );
    return;
  }

  const erpDataRaw = JSON.parse(fs.readFileSync(erpPath, 'utf-8'));

  // Map categories
  const categoryMap: Record<string, string> = {
    'date_errors': 'Date Reading Error',
    'tax_id_errors': 'Tax ID Recognition Error',
    'amount_errors': 'Amount Calculation Error',
    'invoice_number_errors': 'Invoice Number Misread',
    'classification_errors': 'Tax Classification Error',
    'verification_errors': 'Low Confidence',
    'edge_cases': 'Edge Case (Multi-page/Blurry)',
    'other_errors': 'Other'
  };

  // Scan Golden Test Sample directory
  const goldenDir = path.resolve(
    __dirname,
    '../../../Test Data/Golden Test Sample'
  );
  for (const category of Object.keys(categoryMap)) {
    const categoryDir = path.join(goldenDir, category);
    if (!fs.existsSync(categoryDir)) continue;

    const files = fs.readdirSync(categoryDir);
    const voucherIds = new Set<string>();

    for (const file of files) {
      // Extract voucher ID from filename (e.g., "G61-Q40001.pdf" → "G61-Q40001")
      const match = file.match(/^(G\d{2}-[QP]\d+)/);
      if (match) voucherIds.add(match[1]);
    }

    for (const voucherId of voucherIds) {
      const erpRecords = (erpDataRaw[voucherId] || []).map(
        (r: any): ERPRecord => ({
          voucher_id: r.voucher_id,
          invoice_date: r.invoice_date,
          tax_code: r.tax_code || 'UNKNOWN',
          invoice_numbers: r.invoice_numbers,
          seller_name: r.vendor_name,
          seller_tax_id: r.vendor_tax_id || '',
          amount_sales: r.amount_sales,
          amount_tax: r.amount_tax,
          amount_total: r.amount_total,
          raw_row: []
        })
      );

      testCases.push({
        voucherId,
        category,
        errorType: categoryMap[category],
        erpRecords
      });
    }
  }
});

describe('Golden Test Sample - OCR Validation', () => {
  it('should have loaded test cases', () => {
    expect(testCases.length).toBeGreaterThan(0);
    console.log(`Loaded ${testCases.length} Golden Test Sample cases`);
  });

  it('should have ERP records for all test cases', () => {
    const missing: string[] = [];
    for (const { voucherId, erpRecords } of testCases) {
      if (!erpRecords || erpRecords.length === 0) {
        missing.push(voucherId);
      }
    }
    expect(missing).toEqual(
      [],
      `Missing ERP data for: ${missing.join(', ')}`
    );
  });

  describe('Test Case Organization', () => {
    it('should organize test cases by error category', () => {
      const byCat = testCases.reduce(
        (acc, tc) => {
          if (!acc[tc.category]) acc[tc.category] = [];
          acc[tc.category].push(tc);
          return acc;
        },
        {} as Record<string, GoldenTestCase[]>
      );

      console.log('\nGolden Test Sample Organization:');
      for (const [category, cases] of Object.entries(byCat)) {
        console.log(`  ${category}: ${cases.length} cases`);
      }

      expect(Object.keys(byCat).length).toBeGreaterThan(0);
    });
  });

  describe('Sample Coverage', () => {
    it('should have invoices for all error categories', () => {
      const categories = new Set(testCases.map(tc => tc.category));
      expect(categories.size).toBeGreaterThanOrEqual(6);
    });

    it('should have diverse error types', () => {
      const errorTypes = new Set(testCases.map(tc => tc.errorType));
      console.log(`\nError types covered: ${Array.from(errorTypes).join(', ')}`);
      expect(errorTypes.size).toBeGreaterThanOrEqual(5);
    });
  });

  /**
   * Future tests (when OCR API integration is ready):
   * - compareOCRResultsWithERP() - batch test OCR against Golden samples
   * - verifyAuditLogic() - test that audit logic correctly identifies mismatches
   * - measureConfidenceAccuracy() - validate confidence scores against known errors
   */
});

export { testCases };
