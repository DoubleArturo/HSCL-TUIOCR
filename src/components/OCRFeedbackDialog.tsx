import React, { useState } from 'react';
import { AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import type { InvoiceData } from '../types';

interface OCRFeedbackDialogProps {
  isOpen: boolean;
  fileName: string;
  fileId: string;
  ocrResult: InvoiceData | null;
  onClose: () => void;
  onSubmit?: (feedback: any) => void;
}

type ErrorType = 'ocr_error' | 'classification_error' | 'new_category' | 'validation_error';

export function OCRFeedbackDialog({
  isOpen,
  fileName,
  fileId,
  ocrResult,
  onClose,
  onSubmit
}: OCRFeedbackDialogProps) {
  const [errorType, setErrorType] = useState<ErrorType>('ocr_error');
  const [description, setDescription] = useState('');
  const [expectedCorrection, setExpectedCorrection] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<'success' | 'error' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // 調用後端 Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ocr-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            fileName,
            fileId,
            userId: localStorage.getItem('userId'),
            userEmail: localStorage.getItem('userEmail'),
            errorType,
            errorDescription: description,
            expectedCorrection: expectedCorrection || undefined,
            ocrResult
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      setSubmitResult('success');
      onSubmit?.({
        fileName,
        fileId,
        errorType,
        description
      });

      setTimeout(() => {
        onClose();
        setErrorType('ocr_error');
        setDescription('');
        setExpectedCorrection('');
        setSubmitResult(null);
      }, 2000);
    } catch (error) {
      console.error('Feedback submission error:', error);
      setSubmitResult('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-4">
          <h2 className="text-lg font-semibold">回報 OCR 問題</h2>
          <p className="text-sm text-blue-100">幫助我們改進發票識別精準度</p>
        </div>

        {/* Content */}
        <div className="p-6">
          {submitResult === 'success' && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-green-900">感謝您的回報！</h3>
                <p className="text-sm text-green-700">
                  我們已收到您的反饋，AI 正在分析。管理員將於本週內確認並採取行動。
                </p>
              </div>
            </div>
          )}

          {submitResult === 'error' && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">提交失敗</h3>
                <p className="text-sm text-red-700">請稍後重試，或聯繫技術支援。</p>
              </div>
            </div>
          )}

          {submitResult !== 'success' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* 檔案資訊 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  檔案名稱
                </label>
                <input
                  type="text"
                  value={fileName}
                  disabled
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-gray-600 cursor-not-allowed"
                />
              </div>

              {/* 錯誤類型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  問題類型 *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'ocr_error', label: '識別錯誤 (日期、金額、統編等)' },
                    { value: 'classification_error', label: '稅別/分類錯誤' },
                    { value: 'new_category', label: '新的文件類別' },
                    { value: 'validation_error', label: '驗證規則問題' }
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-400 transition"
                      style={{
                        borderColor: errorType === option.value ? '#2563eb' : '#e5e7eb',
                        backgroundColor:
                          errorType === option.value ? '#eff6ff' : 'transparent'
                      }}
                    >
                      <input
                        type="radio"
                        name="errorType"
                        value={option.value}
                        checked={errorType === option.value}
                        onChange={(e) => setErrorType(e.target.value as ErrorType)}
                        className="w-4 h-4"
                      />
                      <span className="ml-2 text-sm font-medium">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 問題描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  問題描述 *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="例：系統識別日期為 '2O26' 而非 '2026'（混淆 O 和 0）"
                  rows={4}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 預期修正 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  預期修正（可選）
                </label>
                <textarea
                  value={expectedCorrection}
                  onChange={(e) => setExpectedCorrection(e.target.value)}
                  placeholder="例：發票日期應為 '2026/04/01'，金額應為 '110,040'"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* 原始 OCR 結果預覽 */}
              {ocrResult && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    原始 OCR 結果
                  </label>
                  <div className="p-3 bg-gray-50 border border-gray-300 rounded-md max-h-48 overflow-y-auto">
                    <pre className="text-xs text-gray-600">
                      {JSON.stringify(
                        {
                          invoice_number: ocrResult.invoice_number,
                          invoice_date: ocrResult.invoice_date,
                          seller_name: ocrResult.seller_name,
                          seller_tax_id: ocrResult.seller_tax_id,
                          amount_total: ocrResult.amount_total,
                          tax_code: ocrResult.tax_code
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              )}

              {/* 按鈕 */}
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!description.trim() || isSubmitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      提交中...
                    </>
                  ) : (
                    '提交回報'
                  )}
                </button>
              </div>

              <p className="text-xs text-gray-500 text-center">
                您的反饋將由 AI 自動分析，管理員將於本週確認並採取行動。
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
