
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.resolve(__dirname, '../System Debug Log/Taiwan Invoice OCR Audit Pro_HSCL - 錯誤分析表.csv');

// Categories from the Summary
const CAT_PROCESS = "流程與歸檔錯誤";
const CAT_COMPLEX = "複雜憑證邏輯誤判";
const CAT_OCR = "影像辨識與手寫困難";
const CAT_OTHER = "其他";

function categorize(row: Record<string, string>): string {
    const id = row['傳票編號'];
    const reason = row['錯誤原因'] || '';
    const note = row['備註'] || '';
    const statusFlash = row['Flash'];
    const statusPro = row['Pro'];

    const unitedText = (reason + note).toLowerCase();

    // 1. Explicit ID Overrides (from Summary)
    if (['G61-PC0001', 'G61-PC0049', 'G61-PC0080', 'G61-PC0083'].some(k => id.includes(k))) return CAT_COMPLEX;
    if (['G61-PC0066', 'G61-PC0074', 'G61-PC0082', 'G61-PC0009', 'G61-PC0100', 'G61-PC0105', 'G61-PC0129', 'G61-PC0132'].some(k => id.includes(k))) return CAT_OCR;
    if (['G61-PC0008', 'G61-PC0014', 'G61-PC0050', 'G61-PC0051', 'G61-PC0098', 'G61-PC0111', 'G61-PC0139', 'G61-PC0110'].some(k => id.includes(k))) return CAT_PROCESS;

    // 2. Keyword Rules
    if (unitedText.includes('檔名') || unitedText.includes('對齊') || unitedText.includes('缺件') || unitedText.includes('多餘')) return CAT_PROCESS;
    if (unitedText.includes('進口報單') || unitedText.includes('美金') || unitedText.includes('幻覺') || unitedText.includes('重複解析')) return CAT_COMPLEX;
    if (unitedText.includes('格線') || unitedText.includes('污漬') || unitedText.includes('字跡') || unitedText.includes('蓋章') || unitedText.includes('模糊')) return CAT_OCR;

    // 3. Fallback: If Status is Abnormal but no category found
    if ((statusFlash === '異常' || statusPro === '異常') && !id.includes('-1')) {
        return CAT_OCR; // Default to OCR if reason is vague
    }

    return '';
}

function parseCSV(content: string): any[] {
    const lines = content.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Handle quoted fields logic (simple version)
        const values: string[] = [];
        let inQuote = false;
        let currentVal = '';
        for (let char of line) {
            if (char === '"') {
                inQuote = !inQuote;
            } else if (char === ',' && !inQuote) {
                values.push(currentVal);
                currentVal = '';
            } else {
                currentVal += char;
            }
        }
        values.push(currentVal);

        const obj: any = {};
        headers.forEach((h, index) => {
            obj[h] = values[index]?.trim() || '';
        });
        result.push(obj);
    }
    return result;
}

function convertToCSV(data: any[]): string {
    const headers = ['傳票編號', 'Flash', 'Pro', '錯誤分類', '類型', '錯誤原因', '備註']; // Reordered
    const headerLine = headers.join(',');

    const lines = data.map(row => {
        return headers.map(h => {
            let val = row[h] || '';
            if (val.includes(',') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(',');
    });

    return [headerLine, ...lines].join('\n');
}

async function run() {
    console.log(`Reading CSV from: ${csvPath}`);
    if (!fs.existsSync(csvPath)) {
        console.error('File not found!');
        return;
    }
    const content = fs.readFileSync(csvPath, 'utf-8');
    const data = parseCSV(content);

    console.log(`Parsed ${data.length} rows.`);

    let updatedCount = 0;
    const updatedData = data.map(row => {
        const category = categorize(row);
        if (category) updatedCount++;
        return {
            ...row,
            '錯誤分類': category
        };
    });

    console.log(`Categorized ${updatedCount} rows.`);

    const newCsvContent = convertToCSV(updatedData);
    fs.writeFileSync(csvPath, newCsvContent, 'utf-8');
    console.log(`Updated CSV written to: ${csvPath}`);
}

run();
