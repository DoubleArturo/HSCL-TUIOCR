
import React from 'react';
import { InvoiceData } from '../types';
import { CheckCircle, AlertCircle, ShieldCheck, Printer } from 'lucide-react';

// Lucide icons are imported via standard named imports as per guidelines
import * as Lucide from 'lucide-react';

interface Props {
  data: InvoiceData;
  onReset: () => void;
}

const InvoiceResult: React.FC<Props> = ({ data, onReset }) => {
  const { logic_is_valid, ai_confidence, flagged_fields } = data.verification;

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className={`p-6 text-white flex justify-between items-center ${logic_is_valid ? 'bg-emerald-600' : 'bg-rose-600'}`}>
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            {logic_is_valid ? <Lucide.CheckCircle className="w-8 h-8" /> : <Lucide.AlertCircle className="w-8 h-8" />}
            {logic_is_valid ? '審核通過 (Math Valid)' : '計算錯誤 (Logic Fail)'}
          </h2>
          <p className="text-emerald-100/80 text-sm mt-1">AI 信心指數: {ai_confidence}%</p>
        </div>
        <button 
          onClick={onReset}
          className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
        >
          <Lucide.RefreshCcw className="w-4 h-4" /> 重新上傳
        </button>
      </div>

      <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="space-y-6">
          <div>
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">發票號碼 Invoice No.</label>
            <p className="text-3xl font-mono text-gray-800 tracking-tighter">{data.invoice_number || '無法辨識'}</p>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">開立日期 Date</label>
            <p className="text-xl font-medium text-gray-700">{data.invoice_date || '無法辨識'}</p>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100">
            <div className="mb-4">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">賣方名稱 Seller</label>
              <p className="text-lg font-semibold text-gray-800">{data.seller_name}</p>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase tracking-wider">統一編號 Tax ID</label>
              <p className="text-lg font-mono font-medium text-gray-700">{data.seller_tax_id}</p>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="bg-gray-900 text-white p-6 rounded-2xl shadow-inner font-mono">
            <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
              <span className="text-gray-400 text-sm">銷售金額 Sales</span>
              <span className="text-xl">${data.amount_sales.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
              <span className="text-gray-400 text-sm">營業稅 Tax (5%)</span>
              <span className="text-xl">${data.amount_tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-emerald-400 font-bold">總計 TOTAL</span>
              <span className="text-3xl font-bold text-emerald-400">${data.amount_total.toLocaleString()}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 p-4 rounded-xl border border-gray-200">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${data.has_stamp ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-400'}`}>
              <Lucide.ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <p className="font-bold text-gray-800">{data.has_stamp ? '已蓋章 (Stamped)' : '未檢測到印章'}</p>
              <p className="text-sm text-gray-500">統一發票專用章辨識</p>
            </div>
          </div>

          {flagged_fields.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
              <p className="text-amber-800 font-bold text-sm mb-1 flex items-center gap-2">
                <Lucide.AlertTriangle className="w-4 h-4" /> 疑慮欄位 Alert:
              </p>
              <div className="flex flex-wrap gap-2">
                {flagged_fields.map(f => (
                  <span key={f} className="bg-amber-200 text-amber-900 px-2 py-0.5 rounded text-xs font-bold uppercase">{f}</span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
         <button className="flex items-center gap-2 px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            <Lucide.Printer className="w-4 h-4" /> 列印傳票
         </button>
         <button className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            <Lucide.Database className="w-4 h-4" /> 確認入帳
         </button>
      </div>
    </div>
  );
};

export default InvoiceResult;
