import { GoogleGenerativeAI } from '@google/generative-ai';
import type { InvoiceData } from '../types';

export interface OCRFeedback {
  fileName: string;
  fileId: string;
  userId: string;
  userEmail: string;
  errorType: 'ocr_error' | 'classification_error' | 'new_category' | 'validation_error';
  errorDescription: string;
  originalOcrResult: InvoiceData | null;
  expectedCorrection?: Partial<InvoiceData>;
}

export interface SuggestedAction {
  category: 'prompt_update' | 'validation_rule' | 'registry_update' | 'test_case';
  component: string;
  change: string;
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface FeedbackAnalysisReport {
  feedbackId: string;
  fileName: string;
  rootCause: string;
  suggestedActions: SuggestedAction[];
  summary: string;
  estimatedImpact: string;
}

/**
 * AI-powered OCR feedback analysis service
 * Analyzes user-reported errors and generates self-correction proposals
 */
export class OCRFeedbackService {
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Analyze OCR error and generate self-adjustment recommendations
   */
  async analyzeFeedback(
    feedback: OCRFeedback
  ): Promise<FeedbackAnalysisReport> {
    const model = this.client.getGenerativeModel({
      model: 'gemini-2.0-flash'
    });

    const analysisPrompt = this.buildAnalysisPrompt(feedback);

    const result = await model.generateContent(analysisPrompt);
    const analysisText = result.response.text();

    const suggestedActions = this.parseActions(analysisText);
    const rootCause = this.extractRootCause(analysisText);
    const summary = this.extractSummary(analysisText);
    const impact = this.estimateImpact(suggestedActions);

    return {
      feedbackId: feedback.fileId,
      fileName: feedback.fileName,
      rootCause,
      suggestedActions,
      summary,
      estimatedImpact: impact
    };
  }

  /**
   * Build structured analysis prompt for Gemini
   */
  private buildAnalysisPrompt(feedback: OCRFeedback): string {
    return `你是一個發票 OCR 系統的自我調整助手。分析以下的使用者回報，並提出改進方案。

【發票檔案】
檔名: ${feedback.fileName}
上傳者: ${feedback.userEmail}
錯誤類型: ${feedback.errorType}

【錯誤描述】
${feedback.errorDescription}

【原始 OCR 結果】
${feedback.originalOcrResult ? JSON.stringify(feedback.originalOcrResult, null, 2) : 'N/A'}

【預期修正】
${feedback.expectedCorrection ? JSON.stringify(feedback.expectedCorrection, null, 2) : '使用者未提供'}

請分析以下項目並用 JSON 格式回答：

1. 根因分析（root_cause）: 為什麼會發生這個錯誤？
   - 是 OCR 模型問題？
   - 是驗證規則問題？
   - 是發票格式特殊性問題？
   - 是新的稅別/分類問題？

2. 建議改進（suggested_actions）：
   以下列格式提供，可複數個：
   {
     "category": "prompt_update" | "validation_rule" | "registry_update" | "test_case",
     "component": "具體檔案或模組名稱（如 T300.ts, validationPipeline.ts）",
     "change": "具體要修改什麼",
     "priority": "high" | "medium" | "low",
     "reasoning": "為什麼要這樣改"
   }

3. 預期影響（impact）:
   - 會影響哪些稅別/文件類型？
   - 預期能解決多少百分比的類似問題？

請用繁體中文回答，並確保 JSON 格式正確。`;
  }

  /**
   * Extract structured actions from AI response
   */
  private parseActions(responseText: string): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    try {
      // 嘗試找 JSON 塊
      const jsonMatch = responseText.match(/\{[\s\S]*\}/g);
      if (jsonMatch) {
        for (const jsonStr of jsonMatch) {
          try {
            const parsed = JSON.parse(jsonStr);
            if (
              parsed.category &&
              parsed.component &&
              parsed.change &&
              parsed.priority
            ) {
              actions.push(parsed as SuggestedAction);
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } catch {
      // Fallback: parse text manually
    }

    return actions.length > 0
      ? actions
      : [
          {
            category: 'test_case',
            component: 'Golden Test Sample',
            change: '將本案例加入 Golden Test Sample',
            priority: 'high',
            reasoning: '作為回歸測試的基準案例'
          }
        ];
  }

  /**
   * Extract root cause from response
   */
  private extractRootCause(responseText: string): string {
    const lines = responseText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('根因') || lines[i].includes('root_cause')) {
        return lines
          .slice(i, i + 5)
          .join('\n')
          .replace(/[#*`]/g, '');
      }
    }
    return '需要進一步分析';
  }

  /**
   * Extract summary from response
   */
  private extractSummary(responseText: string): string {
    const lines = responseText.split('\n');
    const validLines = lines
      .filter(
        (line) =>
          line.trim().length > 20 &&
          !line.includes('{') &&
          !line.includes('[')
      )
      .slice(0, 3);
    return validLines.join(' ');
  }

  /**
   * Estimate impact of suggested actions
   */
  private estimateImpact(actions: SuggestedAction[]): string {
    const highPriorityCount = actions.filter(
      (a) => a.priority === 'high'
    ).length;
    const promptUpdates = actions.filter(
      (a) => a.category === 'prompt_update'
    ).length;

    if (highPriorityCount >= 3) {
      return '高影響：建議的改動可能影響多個組件。需要完整回歸測試。';
    } else if (promptUpdates > 0) {
      return '中影響：Prompt 更新可能影響 OCR 精準度。需要在 Golden Sample 驗證。';
    } else {
      return '低影響：主要是驗證規則或測試資料更新。';
    }
  }

  /**
   * Format report for email notification
   */
  formatReportForEmail(report: FeedbackAnalysisReport): string {
    return `
【OCR 自我調整報告】

檔案名稱: ${report.fileName}
分析日期: ${new Date().toLocaleString('zh-TW')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 根因分析
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${report.rootCause}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 建議改進方案
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${report.suggestedActions
  .map(
    (action, idx) => `
${idx + 1}. [${action.priority.toUpperCase()}] ${action.category}
   檔案/模組: ${action.component}
   修改內容: ${action.change}
   理由: ${action.reasoning}
`
  )
  .join('')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 預期影響
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${report.estimatedImpact}

摘要: ${report.summary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 後續步驟
1. 確認上述建議
2. 核准後，系統將自動執行改動
3. 在 Golden Test Sample 上執行驗證
4. 更新部署到生產環境

請於確認或拒絕此報告。
`;
  }
}
