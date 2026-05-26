import XLSX from 'xlsx';
import fs from 'fs';

const files = {
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202604進項檢核/進項發票-4.xls': '202604',
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202605進項檢核/2605進項發票.xls': '202605'
};

const allRecords = [];

for (const [filepath, period] of Object.entries(files)) {
  const workbook = XLSX.readFile(filepath);
  const sheet = workbook.Sheets['發票明細'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  // 跳過 header row (row 0)
  const headers = rows[0];
  const dataRows = rows.slice(1);
  
  console.log(`\n=== ${period} - Total rows: ${dataRows.length} ===`);
  
  dataRows.forEach((row, idx) => {
    if (idx < 3) {
      console.log(`Row ${idx}:`, row);
    }
    
    if (row[0]) { // 帳款單號 non-empty
      const record = {
        voucher_id: row[0],
        tax_code: row[1],
        year_month: row[2],
        vendor_id: row[3],
        vendor_name: row[4],
        vendor_tax_id: row[5],
        currency: row[6],
        invoice_date: row[7],
        invoice_numbers: row[8] ? String(row[8]).split(/[,，]/).map(s => s.trim()) : [],
        amount_sales: row[9],
        amount_tax: row[10],
        amount_total: row[11],
        period
      };
      allRecords.push(record);
    }
  });
}

console.log(`\n\nTotal records extracted: ${allRecords.length}`);
console.log('\nSample records:');
allRecords.slice(0, 3).forEach(r => {
  console.log(JSON.stringify(r, null, 2));
});

// 找出出現在 Golden Test Sample 的 voucher IDs
const goldenVouchers = ['G61-Q40016', 'G61-Q40020', 'G61-Q40031', 'G61-Q40003', 'G61-Q40018', 
  'G61-Q40024', 'G61-Q40029', 'G61-Q40004', 'G61-Q40011', 'G61-Q40025', 'G61-Q40032', 
  'G61-Q40001', 'G61-Q40008', 'G61-Q40014', 'G61-Q40028', 'G61-Q40005', 'G61-Q40012', 
  'G61-Q40019', 'G61-Q40026', 'G61-Q40006', 'G61-Q40017', 'G61-Q40023', 'G61-Q40030', 
  'G61-Q40007', 'G61-Q40013', 'G61-Q40021', 'G61-Q40027', 'G61-Q40002', 'G61-Q40009', 
  'G61-Q40010', 'G61-Q40015', 'G61-Q40022'];

const goldenErpRecords = allRecords.filter(r => goldenVouchers.includes(r.voucher_id));
console.log(`\n\nGolden Test Sample ERP records found: ${goldenErpRecords.length}`);
goldenErpRecords.forEach(r => {
  console.log(`${r.voucher_id} (${r.period}): ${r.vendor_name} - ${r.amount_total}`);
});
