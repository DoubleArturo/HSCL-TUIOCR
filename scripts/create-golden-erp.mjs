import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const files = {
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202604進項檢核/進項發票-4.xls': '202604',
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202605進項檢核/2605進項發票.xls': '202605'
};

const allRecords = [];

for (const [filepath, period] of Object.entries(files)) {
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets['發票明細'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 跳過 header row
  const dataRows = rows.slice(1);
  
  dataRows.forEach((row) => {
    if (row[0] && String(row[0]).startsWith('G')) { // 帳款單號 non-empty & starts with G
      let invoiceDateIdx = 7;
      let invoiceNumberIdx = 8;
      
      // 202605 的欄位順序不同
      if (period === '202605') {
        invoiceDateIdx = 8;
        invoiceNumberIdx = 7;
      }
      
      const record = {
        voucher_id: String(row[0]).trim(),
        tax_code: String(row[1] || '').trim() || null,
        vendor_name: String(row[4] || '').trim(),
        vendor_tax_id: row[5] ? String(row[5]).trim() || null : null,
        currency: String(row[6] || 'NTD').trim(),
        invoice_date: String(row[invoiceDateIdx] || '').trim(),
        invoice_numbers: row[invoiceNumberIdx] ? String(row[invoiceNumberIdx]).split(/[,，]/).map(s => s.trim()).filter(Boolean) : [],
        amount_sales: Number(row[9]) || 0,
        amount_tax: Number(row[10]) || 0,
        amount_total: Number(row[11]) || 0,
        period
      };
      allRecords.push(record);
    }
  });
}

// 找出 Golden Test Sample 的 vouchers
const goldenVouchers = new Set([
  'G61-Q40001', 'G61-Q40002', 'G61-Q40003', 'G61-Q40004', 'G61-Q40005',
  'G61-Q40006', 'G61-Q40007', 'G61-Q40008', 'G61-Q40009', 'G61-Q40010',
  'G61-Q40011', 'G61-Q40012', 'G61-Q40013', 'G61-Q40014', 'G61-Q40015',
  'G61-Q40016', 'G61-Q40017', 'G61-Q40018', 'G61-Q40019', 'G61-Q40020',
  'G61-Q40021', 'G61-Q40022', 'G61-Q40023', 'G61-Q40024', 'G61-Q40025',
  'G61-Q40026', 'G61-Q40027', 'G61-Q40028', 'G61-Q40029', 'G61-Q40030',
  'G61-Q40031', 'G61-Q40032'
]);

const goldenErpRecords = allRecords.filter(r => goldenVouchers.has(r.voucher_id));

// 按 voucher_id 分組（因為同一 voucher 可能有多筆 ERP 記錄）
const erpByVoucher = {};
goldenErpRecords.forEach(record => {
  if (!erpByVoucher[record.voucher_id]) {
    erpByVoucher[record.voucher_id] = [];
  }
  erpByVoucher[record.voucher_id].push(record);
});

// 輸出為 JSON
const outputPath = '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/Golden Test Sample/erp-data.json';
fs.writeFileSync(outputPath, JSON.stringify(erpByVoucher, null, 2), 'utf-8');

console.log(`✅ Created ${outputPath}`);
console.log(`📊 ${Object.keys(erpByVoucher).length} vouchers, ${goldenErpRecords.length} ERP records`);
console.log('\nSample ERP data:');
const sample = Object.entries(erpByVoucher).slice(0, 3);
sample.forEach(([vId, records]) => {
  console.log(`\n${vId}:`);
  records.forEach(r => {
    console.log(`  - ${r.vendor_name} (${r.currency}) ${r.amount_total}`);
  });
});
