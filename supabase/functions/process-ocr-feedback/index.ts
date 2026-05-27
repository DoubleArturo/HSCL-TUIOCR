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

function buildEmailBody(
  feedback: FeedbackRequest,
  rootCause: string,
  actions: any[]
): string {
  return `
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; line-height: 1.6;">
  <h2>🤖 OCR 自我調整報告</h2>

  <h3>📋 檔案資訊</h3>
  <p><strong>檔名:</strong> ${feedback.fileName}</p>
  <p><strong>上傳者:</strong> ${feedback.userEmail}</p>
  <p><strong>錯誤類型:</strong> ${feedback.errorType}</p>

  <h3>🔍 根因分析</h3>
  <p>${rootCause}</p>

  <h3>🔧 建議改進</h3>
  <ul>
    ${actions.map((a) => `<li>[${a.priority}] ${a.category}: ${a.change}</li>`).join('')}
  </ul>

  <p><strong>請檢查並核准上述建議。</strong></p>
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
  try {
    // 使用 Resend API 或其他 Email 服務
    // 這裡是示範實作，實際需要配置 Email 服務
    console.log(`Sending email to ${options.to}`);
    return true;
  } catch (error) {
    console.error('Email send failed:', error);
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
