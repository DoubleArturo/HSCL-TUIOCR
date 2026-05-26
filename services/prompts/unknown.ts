// TODO: depends on ../documentRegistry which exposes `UnknownDocumentType`.
// That module is not yet implemented at the time this file was created
// (feature/smart-ocr-pipeline branch). Once documentRegistry.ts lands, the
// `import type` below will resolve without changes. Until then this file
// will not type-check standalone — that is expected.
import type { UnknownDocumentType } from '../documentRegistry';

/**
 * 為未知文件類型動態生成專屬 prompt 段落。
 * 這段文字會被 append 到 base prompt 後面，在 Gemini 呼叫時注入。
 *
 * @param registry 從 documentRegistry 取出的已知未知類型清單
 * @param detectedDocumentType 第一階段呼叫時 Gemini 回傳的 document_type（可能是空的）
 */
export function buildUnknownTypePrompt(
  registry: UnknownDocumentType[],
  detectedDocumentType?: string,
): string {
  const sections: string[] = [];

  // 段落 1：未知類型處理總指示
  sections.push(
    `### UNKNOWN DOCUMENT TYPE HANDLING
You are processing a document that does not match standard Taiwan GUI invoice categories.
Your task is to:
1. Identify what this document IS (its function/purpose in a business transaction)
2. Extract all financial data that is visibly printed
3. Propose a concise Chinese name for this document type (2-6 characters)`,
  );

  // 段落 2：過去見過的非標準類型（registry 非空才加）
  if (registry.length > 0) {
    const lines = registry
      .map(
        (r) =>
          `- "${r.document_type}" (voucher_type: "${r.voucher_type}", tax_code: ${r.tax_code || 'unknown'}, seen ${r.count} times, example seller: "${r.sample_seller}")`,
      )
      .join('\n');

    sections.push(
      `### PREVIOUSLY ENCOUNTERED NON-STANDARD DOCUMENT TYPES (for reference)
The system has previously processed these non-standard documents:
${lines}

If the current document resembles any of the above, use the same voucher_type classification.
If it is genuinely new, propose a new name following similar naming conventions.`,
    );
  }

  // 段落 3：第一階段已偵測到的 document_type hint（非空才加）
  if (detectedDocumentType && detectedDocumentType.trim().length > 0) {
    sections.push(
      `### DOCUMENT TYPE HINT
The initial scan identified this document as: "${detectedDocumentType}"
Confirm or refine this classification based on the full document content.`,
    );
  }

  // 段落 4：通用提取規則
  sections.push(
    `### EXTRACTION RULES FOR UNKNOWN TYPES
- Extract any visible monetary amounts (look for 合計, 總計, 金額, Total, Amount, subtotal)
- Extract any date (normalize to YYYY-MM-DD)
- Extract issuer/seller name and tax ID if present
- Set tax_code = "TXXX" unless the document clearly matches a known Taiwan GUI category
- Set voucher_type = your proposed Chinese name for this document type
- Set has_stamp = true if any official seal/stamp is visible
- CRITICAL: Output 0 for any amount field where no number is visibly printed
- Do NOT calculate or infer amounts that are not explicitly shown`,
  );

  // 段落 5：輸出指示
  sections.push(
    `### OUTPUT REQUIREMENTS
In the verification object, set:
- ai_confidence: your confidence level (0-100) in the extraction
- logic_is_valid: true only if amount_total ≈ amount_sales + amount_tax
- flagged_fields: list any fields you are uncertain about

In the document_type field, output the exact document name as printed (e.g., "旅行社代收轉付收據", "計程車收據", "保險費收據").
In the voucher_type field, output your proposed 2-6 character classification name.`,
  );

  return sections.join('\n\n');
}
