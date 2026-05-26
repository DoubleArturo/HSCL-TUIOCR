import { createClient } from '@supabase/supabase-js';
import type { FeedbackAnalysisReport } from './ocrFeedbackService';

/**
 * Email notification service for OCR feedback reports
 * Sends weekly digest of all pending feedback to admin
 */
export class EmailNotificationService {
  private supabase;
  private adminEmail: string;

  constructor(supabaseUrl: string, supabaseKey: string, adminEmail: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.adminEmail = adminEmail;
  }

  /**
   * Send individual feedback report (immediate notification)
   */
  async sendFeedbackReport(
    report: FeedbackAnalysisReport,
    userEmail: string
  ): Promise<boolean> {
    const emailBody = this.buildFeedbackEmailBody(report, userEmail);

    return this.sendEmail({
      to: this.adminEmail,
      subject: `[OCR 自我調整] ${report.fileName} - 待確認`,
      html: emailBody,
      replyTo: userEmail
    });
  }

  /**
   * Send weekly digest of all pending reports
   * Called once per week (Monday morning)
   */
  async sendWeeklyDigest(): Promise<boolean> {
    // 查詢過去 7 天的 pending 報告
    const { data: feedbacks, error } = await this.supabase
      .from('ocr_feedback')
      .select('*')
      .eq('report_status', 'pending_review')
      .gte('created_at', this.getWeekAgoDate())
      .order('created_at', { ascending: false });

    if (error || !feedbacks || feedbacks.length === 0) {
      console.log('No pending feedback for weekly digest');
      return true;
    }

    const emailBody = this.buildWeeklyDigestBody(feedbacks);

    return this.sendEmail({
      to: this.adminEmail,
      subject: `[每週報告] OCR 自我調整 - ${feedbacks.length} 筆待確認`,
      html: emailBody
    });
  }

  /**
   * Send approval/rejection confirmation
   */
  async sendApprovalConfirmation(
    reportId: string,
    status: 'approved' | 'rejected',
    notes?: string
  ): Promise<boolean> {
    const { data: feedback } = await this.supabase
      .from('ocr_feedback')
      .select('*')
      .eq('id', reportId)
      .single();

    if (!feedback) return false;

    const statusText =
      status === 'approved'
        ? '✅ 已核准，將開始執行'
        : '❌ 已拒絕，需重新分析';
    const emailBody = `
【OCR 自我調整 - 核准結果】

檔案: ${feedback.file_name}
決定: ${statusText}
${notes ? `備註: ${notes}` : ''}

${
  status === 'approved'
    ? '系統將在下一個執行週期自動應用改動。'
    : '請重新上傳檔案或聯繫技術支援。'
}
`;

    return this.sendEmail({
      to: feedback.user_email,
      subject: `[OCR 回報結果] ${feedback.file_name} - ${status === 'approved' ? '已核准' : '已拒絕'}`,
      html: emailBody
    });
  }

  /**
   * Internal method: send email via Supabase Edge Function or external service
   */
  private async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    replyTo?: string;
  }): Promise<boolean> {
    try {
      // 實作方式 1: 使用 Supabase Edge Function
      // 實作方式 2: 使用第三方服務（SendGrid, Resend 等）
      // 這裡示範 Edge Function 調用

      const response = await fetch(
        `${process.env.VITE_SUPABASE_URL}/functions/v1/send-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            to: options.to,
            subject: options.subject,
            html: options.html,
            replyTo: options.replyTo || this.adminEmail
          })
        }
      );

      if (!response.ok) {
        console.error('Email send failed:', await response.text());
        return false;
      }

      console.log(`Email sent to ${options.to}`);
      return true;
    } catch (error) {
      console.error('Email service error:', error);
      return false;
    }
  }

  /**
   * Build HTML for individual feedback email
   */
  private buildFeedbackEmailBody(
    report: FeedbackAnalysisReport,
    userEmail: string
  ): string {
    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background: #1E40AF; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .section { padding: 20px; border: 1px solid #ddd; border-top: none; }
    .actions { background: #f5f5f5; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .action-btn { display: inline-block; padding: 10px 20px; margin-right: 10px; border-radius: 4px; text-decoration: none; }
    .approve { background: #10b981; color: white; }
    .reject { background: #ef4444; color: white; }
    .impact { padding: 10px; background: #fef3c7; border-left: 4px solid #f59e0b; margin: 10px 0; }
    .action-item { padding: 12px; margin: 8px 0; background: #f9fafb; border-left: 4px solid #3b82f6; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🤖 OCR 自我調整報告</h1>
      <p>系統自動分析 - 待您確認</p>
    </div>

    <div class="section">
      <h2>📋 檔案資訊</h2>
      <p><strong>檔案名稱:</strong> ${report.fileName}</p>
      <p><strong>上傳者:</strong> ${userEmail}</p>
      <p><strong>分析時間:</strong> ${new Date().toLocaleString('zh-TW')}</p>
    </div>

    <div class="section">
      <h2>🔍 根因分析</h2>
      <p>${report.rootCause}</p>
    </div>

    <div class="section">
      <h2>🔧 建議改進方案</h2>
      ${report.suggestedActions
        .map(
          (action) => `
        <div class="action-item">
          <p><strong>[${action.priority.toUpperCase()}] ${action.category}</strong></p>
          <p>檔案/模組: <code>${action.component}</code></p>
          <p>修改: ${action.change}</p>
          <p><em>理由: ${action.reasoning}</em></p>
        </div>
      `
        )
        .join('')}
    </div>

    <div class="impact">
      <strong>⚡ 預期影響</strong>
      <p>${report.estimatedImpact}</p>
    </div>

    <div class="section">
      <h2>✅ 請確認下列行動</h2>
      <div class="actions">
        <a href="${process.env.ADMIN_PANEL_URL}/feedback/${report.feedbackId}/approve" class="action-btn approve">
          ✓ 核准並執行
        </a>
        <a href="${process.env.ADMIN_PANEL_URL}/feedback/${report.feedbackId}/reject" class="action-btn reject">
          ✗ 拒絕 - 需重新分析
        </a>
      </div>
      <p><small>或直接登入管理後台確認: <a href="${process.env.ADMIN_PANEL_URL}/feedback">${process.env.ADMIN_PANEL_URL}/feedback</a></small></p>
    </div>

    <div class="section" style="background: #f0f9ff; border-top: 3px solid #3b82f6;">
      <h3>📌 自動化流程說明</h3>
      <ol>
        <li>您確認後，系統將自動更新對應的檔案（Prompt、驗證規則等）</li>
        <li>在 Golden Test Sample 上執行驗證，確保不會造成回歸</li>
        <li>如果驗證通過，自動部署到生產環境</li>
        <li>您將收到最終確認通知</li>
      </ol>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Build HTML for weekly digest
   */
  private buildWeeklyDigestBody(feedbacks: any[]): string {
    const byStatus = feedbacks.reduce(
      (acc, f) => {
        if (!acc[f.error_type]) acc[f.error_type] = [];
        acc[f.error_type].push(f);
        return acc;
      },
      {} as Record<string, any[]>
    );

    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', sans-serif; color: #333; }
    .container { max-width: 900px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1E40AF 0%, #7C3AED 100%); color: white; padding: 30px; border-radius: 8px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 20px 0; }
    .stat { background: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; }
    .stat-num { font-size: 24px; font-weight: bold; color: #3b82f6; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .table th { background: #f3f4f6; padding: 12px; text-align: left; border-bottom: 2px solid #ddd; }
    .table td { padding: 12px; border-bottom: 1px solid #ddd; }
    .priority-high { color: #dc2626; font-weight: bold; }
    .priority-medium { color: #f59e0b; }
    .priority-low { color: #10b981; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 OCR 自我調整 - 每週報告</h1>
      <p>本週 (${new Date().toLocaleDateString('zh-TW')}) 發現 ${feedbacks.length} 筆待確認的 OCR 反饋</p>
    </div>

    <div class="summary">
      <div class="stat">
        <div class="stat-num">${feedbacks.length}</div>
        <div>待確認案例</div>
      </div>
      <div class="stat">
        <div class="stat-num">${new Set(feedbacks.map((f) => f.error_type)).size}</div>
        <div>錯誤類型</div>
      </div>
      <div class="stat">
        <div class="stat-num">${feedbacks.filter((f) => f.ai_analysis).length}</div>
        <div>已分析</div>
      </div>
      <div class="stat">
        <div class="stat-num">⏳</div>
        <div>等待您審核</div>
      </div>
    </div>

    <h2>📋 詳細列表</h2>
    <table class="table">
      <thead>
        <tr>
          <th>檔案名稱</th>
          <th>錯誤類型</th>
          <th>上傳者</th>
          <th>優先級</th>
        </tr>
      </thead>
      <tbody>
        ${feedbacks
          .map(
            (f) => `
          <tr>
            <td>${f.file_name}</td>
            <td>${f.error_type}</td>
            <td>${f.user_email}</td>
            <td>
              <a href="${process.env.ADMIN_PANEL_URL}/feedback/${f.id}">
                檢視詳情 →
              </a>
            </td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>

    <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin-top: 30px;">
      <h3>🔗 快速連結</h3>
      <ul>
        <li><a href="${process.env.ADMIN_PANEL_URL}/feedback?status=pending_review">所有待確認報告</a></li>
        <li><a href="${process.env.ADMIN_PANEL_URL}/feedback/analytics">反饋分析儀表板</a></li>
      </ul>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Helper: get date from 7 days ago
   */
  private getWeekAgoDate(): string {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString();
  }
}
