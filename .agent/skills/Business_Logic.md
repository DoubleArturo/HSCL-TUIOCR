# Skill: Business Logic & Accounting Rules

## Overview
This skill documents the immutable business rules, data models, and validation logic for the **Taiwan Invoice OCR Audit Pro**. Any modification to these rules may cause financial audit failures.

## 1. Accounting Integirty Rules

### Rule #1: The Golden Equation
For every invoice, the following equation **MUST** hold true:
```
Amount Sales (銷售額) + Amount Tax (稅額) === Amount Total (總計)
```
- **Tolerance**: ±1 (to account for rounding errors).
- **Implementation**: `InvoiceForm.tsx` (real-time check), `geminiService.ts` (backend check).
- **Status**: If this fails, `verification.logic_is_valid` must be `false`.

### Rule #2: Buyer Tax ID (買方統編)
- **Hard requirement**: The system is hardcoded to validate against a specific Buyer Tax ID.
- **Current Value**: `16547744`
- **Validation**:
    - If `ocr_buyer_tax_id != 16547744`, it is an **Error**.
    - If `ocr_buyer_tax_id` is missing, it is an **Error**.

### Rule #3: Deduplication
- **Key**: `Invoice Number` (e.g., AB-12345678).
- **Logic**: A project cannot contain two invoices with the same invoice number.
- **Handling**:
    - If AI detects a duplicate within the same batch or existing project, mark as `DUPLICATE_WARNING`.

## 2. Model Definitions (`types.ts`)

### `InvoiceData`
The core data structure returned by Gemini and used in the UI.
```typescript
interface InvoiceData {
  invoice_number: string | null;
  invoice_date: string | null;
  buyer_tax_id: string | null;
  seller_name: string;
  seller_tax_id: string | null;
  amount_sales: number;
  amount_tax: number;
  amount_total: number;
  verification: {
      logic_is_valid: boolean; // Computed by Rule #1
      ai_confidence: number;
  };
  field_confidence: FieldConfidence; // field-level confidence (0-100)
}
```

## 3. Error Handling Strategy

### Error Codes
- `BLURRY`: Image is too blurry to read.
- `NOT_INVOICE`: Image is not a Taiwanese invoice.
- `PARTIAL`: Key fields are cut off.

### Confidence Thresholds
- **High Confidence**: Score >= 100 (Green Badge)
- **Low Confidence**: Score < 100 (Yellow/Red Badge depending on field severity)
    - **Critical Fields** (Red): Tax Amount, Seller Tax ID.
    - **Warning Fields** (Orange): Sales Amount, Total Amount.
    - **Minor Fields** (Gray): Date, Invoice Number.
