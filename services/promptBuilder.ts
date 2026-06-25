import { ExpectedERP } from '../types';
import { PROMPT_BASE } from './prompts/base';
import { buildUnknownTypePrompt } from './prompts/unknown';
import { getRegistry } from './documentRegistry';
import { getTypeSpecificPrompt } from './geminiSchema';

export function buildPromptText(expectedERP?: ExpectedERP, validationRetryCount = 0): string {
  let promptText = `Extract all invoice data from this document.

**MULTI-INVOICE PAGES — CRITICAL ISOLATION RULE**:
If the document image contains MULTIPLE physical invoices (e.g. two invoices side-by-side, top/bottom halves, or multiple stapled pages scanned together):
1. FIRST, visually identify and mentally draw a boundary around EACH separate invoice form.
2. For EACH invoice boundary, extract data ONLY from within that boundary. Never mix fields across boundaries.
3. Return one separate JSON object per invoice, in left-to-right or top-to-bottom order.
4. Each object MUST have its own unique invoice_number, invoice_date, and amounts. If two objects end up with the same invoice_number — you made an error: re-examine the image carefully.
5. Common layouts: two invoices side by side (左右兩張), same paper vertically split, or physically stacked/stapled scans.

**SPECIAL CASE — NARROW THERMAL RECEIPT (二聯收銀) NEXT TO ANOTHER INVOICE**:
A very common layout in expense reports: a narrow thermal strip receipt (長條型二聯收銀, T500, e.g. from parking lots, shoe stores, gas stations) is placed or taped NEXT TO a larger invoice (e.g. 電子發票證明聯 or 三聯手寫). In this layout:
- The narrow strip on the LEFT (or RIGHT) is a SEPARATE invoice — extract it independently with its own invoice_number and amounts (合計/總計 printed on the strip).
- Do NOT let the larger invoice's amounts bleed into the narrow strip's fields.
- Even if the narrow strip's text is small or compressed, zoom in and read the 合計 or 總計 line carefully.
- Return TWO separate JSON objects: one for each physical document.

**DATA INTEGRITY CHECK**: Before returning, verify:
- Do all returned invoice_numbers look distinct from each other? If not, re-read that invoice area.
- Does each object's amount_total match what is printed in ITS OWN 總計 cell?

**MULTI-PAGE PDF RULE**: This document may contain multiple pages. Even if page 1 is a delivery note (訂單出貨憑證 / 出貨通知單), you MUST check every subsequent page for a 統一發票. Extract the invoice from whichever page it appears on. Only output NOT_INVOICE if NO page in the entire document contains a 統一發票 form.

**EMBEDDED INVOICE IMAGES / PHOTOCOPIED STUBS (CRITICAL)**: A page may contain photocopied, scanned, or printed-as-image invoice stubs — typically 收銀機統一發票 (cash register / 三聯式) thumbnails pasted or scanned alongside a delivery note. These are NOT decoration, NOT thumbnails, NOT illustrations. They ARE real, independent invoices that MUST be extracted as their own JSON objects with their own invoice_number, invoice_date, seller_name, seller_tax_id, amount_sales, amount_tax, amount_total. Indicators that a region is an embedded real invoice (not decoration):
- Contains a readable 發票號碼 (e.g. XW17220651 format: 2 letters + 8 digits)
- Contains 統一編號 / 統一發票 / 收銀機統一發票 wording
- Contains 總計 / 應稅銷售額 / 營業稅 fields with numbers
If you see N embedded invoice stubs on a page, the output array MUST include N corresponding objects — never collapse them into one, never skip them because they look small or low-res.

If the ENTIRE document (all pages) contains only generic unbillable documents (Packing List, delivery note with no invoice anywhere), set 'error_code' to 'NOT_INVOICE' and output 0 for all amounts. If image is blurry, set 'error_code' accordingly.`;

  if (expectedERP && (expectedERP.amount_total !== undefined || expectedERP.amount_sales !== undefined || expectedERP.amount_tax !== undefined)) {
    promptText += `\n\n[CROSS-CHECK REQUIRED]: The ERP system expects the following totals for this document:\n`;
    if (expectedERP.amount_total !== undefined) promptText += `- 總金額 (Total Amount): ${expectedERP.amount_total}\n`;
    if (expectedERP.amount_sales !== undefined) promptText += `- 銷售額合計 (Sales Amount): ${expectedERP.amount_sales}\n`;
    if (expectedERP.amount_tax !== undefined) promptText += `- 營業稅 (Tax Amount): ${expectedERP.amount_tax}\n`;
    promptText += `\nCRITICAL ANTI-HALLUCINATION RULE: You MUST visually verify these numbers are printed on the document.`;
    promptText += `\nIf your initial extraction DOES NOT match these expected ERP totals, you MUST re-examine the image carefully to see if you missed them.\n`;
    promptText += `HOWEVER, if you CANNOT see the number on the image, YOU MUST OUTPUT 0. DO NOT under any circumstances return the ERP number just because it was listed here if it is not printed on the document itself. DO NOT calculate difference to fill in "Tax".\n`;

    if (validationRetryCount > 0) {
      promptText += `\nNOTE: This is retry attempt ${validationRetryCount}/3. Previous extraction failed ERP validation. Look closer!\n`;
    }
  }

  return promptText;
}

export function buildSystemPrompt(expectedERP?: ExpectedERP, validationRetryCount = 0): string {
  let systemPrompt = PROMPT_BASE;

  if (validationRetryCount > 0 && expectedERP?.tax_code) {
    const typePrompt = getTypeSpecificPrompt(expectedERP.tax_code);
    if (typePrompt) systemPrompt += '\n\n' + typePrompt;
  }

  if (!expectedERP?.tax_code) {
    const registry = getRegistry();
    const unknownPrompt = buildUnknownTypePrompt(registry);
    systemPrompt += '\n\n' + unknownPrompt;
  }

  return systemPrompt;
}
