import XLSX from 'xlsx';

const files = [
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202604進項檢核/進項發票-4.xls',
  '/Users/doubleapro/Projects/HSCL-TUIOCR/Test Data/202605進項檢核/2605進項發票.xls'
];

for (const filepath of files) {
  console.log(`\n=== ${filepath.split('/').pop()} ===`);
  try {
    const workbook = XLSX.readFile(filepath);
    const sheetNames = workbook.SheetNames;
    console.log(`Sheets: ${sheetNames.join(', ')}`);
    
    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      
      console.log(`\n  [${sheetName}] ${data.length} rows`);
      if (data.length > 0) {
        console.log(`  Headers: ${Object.keys(data[0]).join(', ')}`);
        console.log(`  First row:`, JSON.stringify(data[0], null, 2));
      }
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
  }
}
