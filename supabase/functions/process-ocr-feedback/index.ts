import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const geminiKey = Deno.env.get('GEMINI_API_KEY');
const adminEmail = Deno.env.get('ADMIN_EMAIL') || 'admin@example.com';

const supabase = createClient(supabaseUrl!, supabaseKey!);
const genAI = new GoogleGenerativeAI(geminiKey!);

interface FeedbackRequest {
  fileName: string;
  fileId: string;
  userId: string;
  userEmail: string;
  errorType:
    | 'ocr_error'
    | 'classification_error'
    | 'new_category'
    | 'validation_error';
  errorDescription: string;
  ocrResult: any;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders() });
  }

  try {
    const feedback: FeedbackRequest = await req.json();

    // 1. Save feedback to database
    const { data: feedbackRecord, error: insertError } = await supabase
      .from('ocr_feedback')
      .insert([
        {
          file_name: feedback.fileName,
          file_id: feedback.fileId,
          user_id: feedback.userId,
          user_email: feedback.userEmail,
          error_type: feedback.errorType,
          error_description: feedback.errorDescription,
          original_ocr_result: feedback.ocrResult
        }
      ])
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert feedback: ${insertError.message}`);
    }

    // 2. AI analysis
    const analysisPrompt = buildAnalysisPrompt(feedback);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent(analysisPrompt);
    const analysisText = result.response.text();

    const suggestedActions = parseActions(analysisText);
    const rootCause = extractRootCause(analysisText);

    // 3. Update feedback record with analysis
    const { error: updateError } = await supabase
      .from('ocr_feedback')
      .update({
        ai_analysis: analysisText,
        suggested_actions: suggestedActions
      })
      .eq('id', feedbackRecord.id);

    if (updateError) {
      console.error('Failed to update analysis:', updateError);
    }

    // 4. Send email notification
    const emailBody = buildEmailBody(feedback, rootCause, suggestedActions);
    const emailResult = await sendEmail({
      to: adminEmail,
      subject: `[OCR 自我調整] ${feedback.fileName} - 待確認`,
      html: emailBody,
      replyTo: feedback.userEmail
    });

    return new Response(
      JSON.stringify({
        success: true,
        feedbackId: feedbackRecord.id,
        analysisComplete: true,
        emailSent: emailResult
      }),
      {
        status: 200,
        headers: getCorsHeaders()
      }
    );
  } catch (error) {
    console.error('Error processing feedback:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: getCorsHeaders()
      }
    );
  }
});

function buildAnalysisPrompt(feedback: FeedbackRequest): string {
  return `你是一個發票 OCR 系統的自我調整助手。分析以下的使用者回報，並提出改進方案。

【發票檔案】
檔名: ${feedback.fileName}
上傳者: ${feedback.userEmail}
錯誤類型: ${feedback.errorType}

【錯誤描述】
${feedback.errorDescription}

【原始 OCR 結果】
${JSON.stringify(feedback.ocrResult, null, 2)}

請分析並提供以下 JSON 格式的建議：
{
  "root_cause": "根因分析",
  "suggested_actions": [
    {
      "category": "prompt_update|validation_rule|registry_update|test_case",
      "component": "具體檔案名稱",
      "change": "具體改動",
      "priority": "high|medium|low",
      "reasoning": "改動理由"
    }
  ]
}

用繁體中文回答。`;
}

function parseActions(responseText: string): any[] {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.suggested_actions || [];
    }
  } catch {
    // Continue
  }
  return [];
}

function extractRootCause(responseText: string): string {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.root_cause || '需要進一步分析';
    }
  } catch {
    // Continue
  }

  const lines = responseText.split('\n');
  for (const line of lines) {
    if (line.includes('根因') || line.includes('root_cause')) {
      return line.replace(/[#*`]/g, '').trim();
    }
  }
  return '需要進一步分析';
}

const PRIORITY_LABEL: Record<string, string> = {
  high: '高優先',
  medium: '中優先',
  low: '低優先'
};

const CATEGORY_LABEL: Record<string, string> = {
  prompt_update: 'Prompt 更新',
  validation_rule: '驗證規則',
  registry_update: '登錄檔更新',
  test_case: '測試案例'
};

function buildEmailBody(
  feedback: FeedbackRequest,
  rootCause: string,
  actions: any[]
): string {
  const actionsHtml =
    actions.length === 0
      ? '<p style="color:#888;">（無建議改動）</p>'
      : actions
          .map((a) => {
            const priority = PRIORITY_LABEL[a.priority] ?? a.priority;
            const category = CATEGORY_LABEL[a.category] ?? a.category;
            const badge =
              a.priority === 'high'
                ? 'background:#dc2626;color:#fff'
                : a.priority === 'medium'
                  ? 'background:#d97706;color:#fff'
                  : 'background:#6b7280;color:#fff';
            return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
        <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;${badge}">${priority}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${category}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${a.component ?? '-'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${a.change}</td>
    </tr>
    ${
      a.reasoning
        ? `<tr><td colspan="4" style="padding:4px 12px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">理由：${a.reasoning}</td></tr>`
        : ''
    }`;
          })
          .join('');

  return `
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;max-width:700px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e40af;border-bottom:2px solid #dbeafe;padding-bottom:8px;">OCR 自我調整報告</h2>

  <h3 style="color:#374151;">檔案資訊</h3>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
    <tr><td style="padding:4px 0;color:#6b7280;width:100px;">檔名</td><td><strong>${feedback.fileName}</strong></td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">上傳者</td><td>${feedback.userEmail}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">錯誤類型</td><td>${feedback.errorType}</td></tr>
    <tr><td style="padding:4px 0;color:#6b7280;">描述</td><td>${feedback.errorDescription}</td></tr>
  </table>

  <h3 style="color:#374151;">根因分析</h3>
  <p style="background:#f1f5f9;padding:12px 16px;border-radius:6px;border-left:4px solid #1e40af;">${rootCause}</p>

  <h3 style="color:#374151;">建議改進（共 ${actions.length} 項）</h3>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr style="background:#f8fafc;">
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #dbeafe;">優先級</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #dbeafe;">類別</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #dbeafe;">元件</th>
        <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #dbeafe;">改動說明</th>
      </tr>
    </thead>
    <tbody>
      ${actionsHtml}
    </tbody>
  </table>

  <p style="margin-top:24px;padding:12px 16px;background:#fef3c7;border-radius:6px;border-left:4px solid #d97706;">
    <strong>請登入系統檢查並核准上述建議。</strong>
  </p>
</body>
</html>
`;
}

async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<boolean> {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    console.warn('[Email] RESEND_API_KEY not set, skipping email');
    return false;
  }

  try {
    const body: Record<string, unknown> = {
      from: 'HSCL OCR <onboarding@resend.dev>',
      to: [options.to],
      subject: options.subject,
      html: options.html
    };
    if (options.replyTo) {
      body.reply_to = options.replyTo;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Email] Resend error:', err);
      return false;
    }

    console.log('[Email] Sent successfully via Resend');
    return true;
  } catch (error) {
    console.error('[Email] Failed to send:', error);
    return false;
  }
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}
