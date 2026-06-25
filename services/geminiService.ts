import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { InvoiceData, ExpectedERP } from "../types";
import { responseSchema } from './geminiSchema';
import { getSupabase } from './supabaseClient';
import { buildPromptText, buildSystemPrompt } from './promptBuilder';
import { mergeSellerDB, postProcessItems, deduplicateResults, UsageData } from './invoicePostProcessor';

declare const process: {
  env: {
    GEMINI_API_KEY?: string;
    API_KEY?: string;
    [key: string]: string | undefined;
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callGeminiApi(
  effectiveModel: string,
  cleanBase64: string,
  mimeType: string,
  promptText: string,
  systemPrompt: string
): Promise<{ text: string | null; usageData: UsageData | undefined }> {
  const useDirectAPI = import.meta.env.VITE_USE_DIRECT_API === 'true';

  if (useDirectAPI) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
    const ai = new GoogleGenAI({ apiKey: apiKey as string });

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: effectiveModel,
      contents: {
        parts: [
          { inlineData: { mimeType, data: cleanBase64 } },
          { text: promptText },
        ],
      },
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
      },
    });

    const text = response.text ?? null;
    const usage = response.usageMetadata;
    let usageData: UsageData | undefined;
    if (usage) {
      const inputPrice = 0.075 / 1000000;
      const outputPrice = 0.30 / 1000000;
      usageData = {
        promptTokenCount: usage.promptTokenCount,
        candidatesTokenCount: usage.candidatesTokenCount,
        totalTokenCount: usage.totalTokenCount,
        cost_usd: (usage.promptTokenCount * inputPrice) + (usage.candidatesTokenCount * outputPrice),
      };
    }
    return { text, usageData };
  }

  // Production: proxy via Supabase Edge Function
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke('gemini-ocr-proxy', {
    body: { model: effectiveModel, mimeType, base64Data: cleanBase64, promptText, systemPrompt, responseSchema },
  });

  if (error) throw new Error(`Proxy error: ${error.message}`);

  let usageData: UsageData | undefined;
  if (data?.usageMetadata) {
    const usage = data.usageMetadata;
    const inputPrice = 0.075 / 1000000;
    const outputPrice = 0.30 / 1000000;
    usageData = {
      promptTokenCount: usage.promptTokenCount ?? 0,
      candidatesTokenCount: usage.candidatesTokenCount ?? 0,
      totalTokenCount: usage.totalTokenCount ?? 0,
      cost_usd: ((usage.promptTokenCount ?? 0) * inputPrice) + ((usage.candidatesTokenCount ?? 0) * outputPrice),
    };
  }
  return { text: data?.text ?? null, usageData };
}

export const analyzeInvoice = async (
  base64Data: string,
  mimeType: string,
  modelName: string = 'gemini-1.5-flash',
  retryCount = 0,
  knownSellers: Record<string, string> = {},
  expectedERP?: ExpectedERP,
  validationRetryCount = 0,
  skipValidationRetry = false
): Promise<InvoiceData[]> => {
  const effectiveModel = modelName.includes('hybrid') ? 'gemini-3-flash-preview' : modelName;
  const cleanBase64 = base64Data.split(',')[1] || base64Data;

  try {
    const { text, usageData } = await callGeminiApi(
      effectiveModel,
      cleanBase64,
      mimeType,
      buildPromptText(expectedERP, validationRetryCount),
      buildSystemPrompt(expectedERP, validationRetryCount)
    );

    if (!text) {
      console.warn("AI returned empty response text.");
      return [];
    }

    const parsedData = JSON.parse(text);
    let results: InvoiceData[] = Array.isArray(parsedData)
      ? parsedData
      : (typeof parsedData === 'object' && parsedData !== null ? [parsedData] : []);

    const MERGED_SELLERS = await mergeSellerDB(knownSellers);
    results = await postProcessItems(results, base64Data, mimeType, modelName, expectedERP, text, usageData, MERGED_SELLERS);
    results = deduplicateResults(results);

    // --- Hybrid Auto-Escalation Logic (Flash → Pro) ---
    if (modelName.includes('hybrid')) {
      const validResults = results.filter(r => r.error_code !== 'NOT_INVOICE' && r.tax_code !== 'TXXX');
      const needsEscalation = validResults.length > 0 && validResults.some(r => {
        const arithmeticFail = r.amount_total > 0 && r.amount_sales > 0 &&
          Math.abs((r.amount_sales + r.amount_tax) - r.amount_total) > 1;
        const missingInvNo = !r.invoice_number && r.tax_code !== 'TXXX' && r.tax_code !== 'T500';
        const lowConfidence = r.verification.ai_confidence < 70;
        return arithmeticFail || missingInvNo || lowConfidence || !r.verification.logic_is_valid;
      });

      if (needsEscalation) {
        console.log(`[Auto-Escalation] Tier-1 failed (${effectiveModel}). Escalating to gemini-2.5-pro...`);
        const proResults = await analyzeInvoice(base64Data, mimeType, 'gemini-2.5-pro', retryCount, knownSellers, expectedERP, validationRetryCount, true);
        return proResults.map(item => ({
          ...item,
          trace_logs: [`[System] Escalated: ${effectiveModel} → gemini-2.5-pro`, ...(item.trace_logs || [])],
        }));
      }
    }

    // --- ERP Crosscheck Validation Retry (max 1 attempt with Pro) ---
    if (expectedERP && validationRetryCount < 1 && !skipValidationRetry) {
      const validInvoices = results.filter(r => r.document_type !== '非發票' && r.error_code !== 'NOT_INVOICE');

      if (validInvoices.length > 0) {
        const ocrTotalSum = validInvoices.reduce((sum, inv) => sum + (inv.amount_total || 0), 0);
        const ocrSalesSum = validInvoices.reduce((sum, inv) => sum + (inv.amount_sales || 0), 0);
        const ocrTaxSum  = validInvoices.reduce((sum, inv) => sum + (inv.amount_tax  || 0), 0);

        const mismatchLogs: string[] = [];
        if (expectedERP.amount_total !== undefined && expectedERP.amount_total !== 0 && Math.abs(ocrTotalSum - expectedERP.amount_total) > 1)
          mismatchLogs.push(`Total mismatch (OCR: ${ocrTotalSum}, ERP: ${expectedERP.amount_total})`);
        if (expectedERP.amount_sales !== undefined && expectedERP.amount_sales !== 0 && Math.abs(ocrSalesSum - expectedERP.amount_sales) > 1)
          mismatchLogs.push(`Sales mismatch (OCR: ${ocrSalesSum}, ERP: ${expectedERP.amount_sales})`);
        if (expectedERP.amount_tax !== undefined && expectedERP.amount_tax !== 0 && Math.abs(ocrTaxSum - expectedERP.amount_tax) > 1)
          mismatchLogs.push(`Tax mismatch (OCR: ${ocrTaxSum}, ERP: ${expectedERP.amount_tax})`);

        // 多張發票憑證：OCR 取出數量少於 ERP 期望數量，也觸發 Pro 升級
        const countMismatch =
          expectedERP.invoice_numbers &&
          expectedERP.invoice_numbers.length > 1 &&
          validInvoices.filter(r => r.invoice_number).length < expectedERP.invoice_numbers.length;

        if (countMismatch) {
          mismatchLogs.push(
            `Count mismatch: ERP expects ${expectedERP.invoice_numbers!.length} invoices, OCR found ${validInvoices.filter(r => r.invoice_number).length}`,
          );
        }

        if (mismatchLogs.length > 0) {
          console.log(`[Validation Retry] ERP mismatch detected: ${mismatchLogs.join(', ')}. Attempt ${validationRetryCount + 1}/1 with gemini-2.5-pro...`);

          // Pro ROI guard: if Flash result is already reliable, ERP amount is likely wrong — skip Pro.
          const flashIsReliable = validInvoices.every(
            inv =>
              inv.verification.ai_confidence >= 85 &&
              Math.abs((inv.amount_sales + inv.amount_tax) - inv.amount_total) <= 1 &&
              !!inv.invoice_number,
          );
          if (flashIsReliable) {
            console.log(`[Pro Guard] Flash result is reliable — ERP amount likely wrong, skipping Pro`);
            results.forEach(r => {
              if (!r.verification.flagged_fields.includes('erp_amount_suspicious')) {
                r.verification.flagged_fields.push('erp_amount_suspicious');
              }
            });
            return results;
          }

          const retryResults = await analyzeInvoice(base64Data, mimeType, 'gemini-2.5-pro', retryCount, knownSellers, expectedERP, validationRetryCount + 1);
          return retryResults.map(item => ({
            ...item,
            trace_logs: [
              `[System] Escapated to PRO (Attempt ${validationRetryCount + 1}) due to ERP mismatch: ${mismatchLogs.join(', ')}.`,
              ...(item.trace_logs || []),
            ],
          }));
        }
      } else {
        console.log(`[Validation Guard] Skipping Pro escalation because no valid invoice data was found initially.`);
      }
    }

    console.log("[GEMINI] ===== FINAL RESULTS =====");
    console.log("[GEMINI] Total invoices returned:", results.length);
    console.log("[GEMINI] Invoice numbers:", results.map(r => r.invoice_number || '(blank)').join(", "));
    console.log("[GEMINI] Tax codes:", results.map(r => r.tax_code || 'N/A').join(", "));
    console.log("[GEMINI] Amounts (total):", results.map(r => r.amount_total || 0).join(", "));
    if (expectedERP) {
      console.log("[GEMINI] ERP expects:", expectedERP.invoice_numbers?.join(", ") || 'N/A', "| tax_code:", expectedERP.tax_code, "| amount:", expectedERP.amount_total);
    }
    console.log("[GEMINI] ===== END GEMINI LOG =====");

    return results;

  } catch (err: any) {
    const isRetryable = err?.message?.includes('429') || err?.status === 503 || err?.status === 500;
    if (isRetryable && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 500);
      console.log(`API Busy/Error. Retrying in ${Math.round(waitTime)}ms (Attempt ${retryCount + 1}/3)`);
      await sleep(waitTime);
      return analyzeInvoice(base64Data, mimeType, modelName, retryCount + 1, knownSellers, expectedERP, validationRetryCount, skipValidationRetry);
    }
    console.error("Error analyzing invoice:", err);
    throw err;
  }
};
