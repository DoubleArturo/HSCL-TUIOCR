# Skill: OCR Prompt Engineering & AI Strategy

## Overview
This skill documents the AI interaction strategy, specifically tailored for **Google Gemini 1.5 Flash/Pro**. It covers the System Instructions, JSON Schema definitions, and the "Hybrid Auto-Escalation" strategy.

## 1. System Instruction Strategy
The prompt is engineered to handle **Taiwanese Unified Invoices (GUI)** specifically.

### Key Instructions
1.  **Strict JSON Output**: The model must return ONLY valid JSON.
2.  **Field Extraction Rules**:
    - `invoice_number`: Must be 2 letters + 8 digits (e.g., AB-12345678).
    - `date`: Normalize to `YYYY-MM-DD` (Handle ROC years like 113/05/01 -> 2024-05-01).
    - `tax_id`: Validate length (8 digits).
3.  **Handling Edge Cases**:
    - **Rotation**: "Auto-detect orientation (portrait/landscape) and read text accordingly."
    - **A3 Scans**: "If multiple invoices appear on one A3 page, identify the PRIMARY invoice (largest/clearest) and ignore others."
    - **Blurry/Corrupt**: "If text is illegible, set `error_code` to `BLURRY`."

## 2. Hybrid Model Strategy (`gemini-2.5-flash-hybrid`)

To balance **Speed/Cost** vs **Accuracy**, we use a hybrid approach:

1.  **Tier 1: Gemini 1.5 Flash** (Fast, Cheap)
    - Default model for all requests.
    - If prediction confidence is **High** (>90) for all critical fields AND Logic Valid -> **Keep Result**.
    - If prediction confidence is **Low** OR Logic Invalid (`Sales+Tax != Total`) -> **Escalate**.

2.  **Tier 2: Gemini 1.5 Pro** (More Accurate, Slower)
    - Automatically triggered if Tier 1 fails validation.
    - Used for re-processing difficult images (handwritten, crumpled, low contrast).

## 3. JSON Schema (Output Structure)
The model is instructed to fill this schema:
```json
{
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "buyer_tax_id": "string",
  "seller_name": "string",
  "seller_tax_id": "string",
  "amount_sales": number,
  "amount_tax": number,
  "amount_total": number,
  "verification": {
      "logic_is_valid": boolean,
      "ai_confidence": number
  },
  "field_confidence": {
      "invoice_number": number,
      ...
  }
}
```

## 4. Troubleshooting
- **Hallucinations**: If model invents numbers, check `verification.logic_is_valid`.
- **Date Errors**: Check if the year is ROC (Civil Year) or Western. Prompt explicitly handles "Year 113".
