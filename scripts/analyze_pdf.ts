
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const defaultFile = path.join(process.cwd(), '2025.12 TUI/G61-PC0001.pdf');
const filePath = process.argv[2] ? path.resolve(process.argv[2]) : defaultFile;

async function analyzePdf() {
    try {
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return;
        }

        const dataBuffer = fs.readFileSync(filePath);
        // @ts-ignore
        const parser = new pdf.PDFParse({ data: dataBuffer });
        const textData = await parser.getText();
        const infoData = await parser.getInfo({ parsePageInfo: true });

        console.log('--- PDF Analysis Report ---');
        console.log(`File: ${path.basename(filePath)}`);
        console.log(`Total Pages: ${infoData.total}`);
        if (infoData.pages && infoData.pages.length > 0) {
            const p1 = infoData.pages[0];
            console.log(`Page 1 Size: ${p1.width} x ${p1.height}`);
            console.log(`Page 1 Rotation: ${p1.rotation || 0}`);
        }
        console.log(`Text Length: ${textData.text.length} characters`);

        await parser.destroy();

    } catch (err) {
        console.error("Error parsing PDF:", err);
    }
}

analyzePdf();
