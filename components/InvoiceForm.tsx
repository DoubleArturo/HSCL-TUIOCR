
import React from 'react';
import { InvoiceData } from '../types';
import * as Lucide from 'lucide-react';

interface Props {
    formData: InvoiceData;
    setFormData: (data: InvoiceData) => void;
    currentInvoiceIndex: number;
    totalInvoices: number;
    onInvoiceSwitch: (index: number) => void;
    onSave: () => void;
    onClose?: () => void; // Optional if embedded in a larger view
    showCloseButton?: boolean;
}

const InvoiceForm: React.FC<Props> = ({
    formData, setFormData,
    currentInvoiceIndex, totalInvoices, onInvoiceSwitch,
    onSave, onClose, showCloseButton = true
}) => {

    const handleChange = (field: keyof InvoiceData, value: any) => {
        if (!formData) return;
        const updated = { ...formData, [field]: value };
        // Basic validation logic
        if (['amount_sales', 'amount_tax', 'amount_total'].includes(field)) {
            const sales = field === 'amount_sales' ? value : updated.amount_sales;
            const tax = field === 'amount_tax' ? value : updated.amount_tax;
            const total = field === 'amount_total' ? value : updated.amount_total;
            updated.verification.logic_is_valid = Math.abs((sales + tax) - total) <= 1;
        }
        setFormData(updated);
    };

    const getFieldSeverity = (field: string) => {
        if (['amount_tax', 'seller_tax_id'].includes(field)) return 'critical';
        if (['amount_sales', 'amount_total'].includes(field)) return 'warning';
        if (['buyer_tax_id', 'invoice_number', 'invoice_date', 'seller_name'].includes(field)) return 'minor';
        return 'minor';
    };

    const getScoreBadgeStyle = (score: number, field: string) => {
        if (score >= 100) return 'bg-emerald-500 text-white';
        const severity = getFieldSeverity(field);
        if (severity === 'critical') return 'bg-rose-600 text-white';
        if (severity === 'warning') return 'bg-amber-500 text-white';
        return 'bg-slate-500 text-white';
    };

    const getFieldContainerStyle = (score: number, field: string) => {
        if (score >= 100) return 'bg-white border-gray-200 focus-within:border-indigo-500';
        const severity = getFieldSeverity(field);
        if (severity === 'critical') return 'bg-rose-50 border-rose-400 ring-4 ring-rose-100 shadow-sm';
        if (severity === 'warning') return 'bg-amber-50 border-amber-400 ring-4 ring-amber-100 shadow-sm';
        return 'bg-slate-50 border-slate-400 ring-4 ring-slate-100 shadow-sm';
    };

    const FieldHeader = ({ label, field, score }: { label: string, field: string, score: number }) => {
        const severity = getFieldSeverity(field);
        const alertColor = severity === 'critical' ? 'text-rose-600' : (severity === 'warning' ? 'text-amber-500' : 'text-slate-500');

        return (
            <label className="flex items-center justify-between text-xs font-black text-gray-500 mb-1.5 uppercase tracking-wider">
                <span className="flex items-center gap-1.5">{label}{score < 100 && (<Lucide.AlertTriangle className={`w-3.5 h-3.5 ${alertColor}`} />)}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getScoreBadgeStyle(score, field)}`}>{score < 100 ? `AI 信心: ${score}%` : '驗證完畢'}</span>
            </label>
        );
    };

    return (
        <div className="w-[480px] flex flex-col border-l border-gray-200 bg-white z-30 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] h-full">
            <div className="p-4 border-b flex justify-between items-center bg-white sticky top-0 z-40 shadow-sm/50 shrink-0">
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-black text-gray-900 tracking-tight">稽核編輯器</h2>
                    {totalInvoices > 1 && (
                        <div className="flex items-center bg-gray-100 rounded-lg px-2 py-1 gap-2">
                            <span className="text-xs font-bold text-gray-500">發票 {currentInvoiceIndex + 1} / {totalInvoices}</span>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => onInvoiceSwitch(Math.max(0, currentInvoiceIndex - 1))}
                                    disabled={currentInvoiceIndex === 0}
                                    className="p-0.5 hover:bg-white rounded disabled:opacity-30"
                                >
                                    <Lucide.ChevronLeft className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => onInvoiceSwitch(Math.min(totalInvoices - 1, currentInvoiceIndex + 1))}
                                    disabled={currentInvoiceIndex === totalInvoices - 1}
                                    className="p-0.5 hover:bg-white rounded disabled:opacity-30"
                                >
                                    <Lucide.ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={onSave} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 active:scale-95"><Lucide.Save className="w-3.5 h-3.5" /> 儲存</button>
                    {showCloseButton && onClose && (
                        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><Lucide.X className="w-5 h-5" /></button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                <div className={`p-3 rounded-xl flex items-center gap-3 border ${formData.verification.logic_is_valid ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200 shadow-sm'}`}><div className={`p-1.5 rounded-lg ${formData.verification.logic_is_valid ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{formData.verification.logic_is_valid ? <Lucide.CheckCircle2 className="w-4 h-4" /> : <Lucide.AlertCircle className="w-4 h-4" />}</div><div><p className="font-black text-xs uppercase tracking-widest">會計邏輯狀態</p><p className="text-[10px] font-medium opacity-80">{formData.verification.logic_is_valid ? '金額勾稽正確無誤' : '銷售額 + 稅額 ≠ 總計，請檢查'}</p></div></div>

                <div className="space-y-4">
                    <div><FieldHeader label="發票號碼" field="invoice_number" score={formData.field_confidence.invoice_number} /><input type="text" className={`w-full border rounded-xl px-3 py-2 font-mono text-lg font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_number, 'invoice_number')}`} value={formData.invoice_number || ''} onChange={(e) => handleChange('invoice_number', e.target.value)} /></div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><FieldHeader label="開立日期" field="invoice_date" score={formData.field_confidence.invoice_date} /><input type="date" className={`w-full border rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_date, 'invoice_date')}`} value={formData.invoice_date || ''} onChange={(e) => handleChange('invoice_date', e.target.value)} /></div>
                        <div><FieldHeader label="買方統編" field="buyer_tax_id" score={formData.field_confidence.buyer_tax_id || 0} /><input type="text" className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${(formData.buyer_tax_id === '16547744') ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50 text-rose-700'}`} value={formData.buyer_tax_id || ''} onChange={(e) => handleChange('buyer_tax_id', e.target.value)} />{formData.buyer_tax_id !== '16547744' && <p className="text-[9px] text-rose-600 font-bold mt-1">必須為 16547744</p>}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><FieldHeader label="賣方統編" field="seller_tax_id" score={formData.field_confidence.seller_tax_id} /><input type="text" className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.seller_tax_id, 'seller_tax_id')}`} value={formData.seller_tax_id || ''} onChange={(e) => handleChange('seller_tax_id', e.target.value)} /></div>
                        <div><FieldHeader label="賣方公司名稱" field="seller_name" score={formData.field_confidence.seller_name} /><input type="text" className={`w-full border rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.seller_name, 'seller_name')}`} value={formData.seller_name || ''} onChange={(e) => handleChange('seller_name', e.target.value)} /></div>
                    </div>

                    <div className="p-4 bg-gray-900 rounded-2xl shadow-xl border border-gray-800">
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div><FieldHeader label="銷售額合計" field="amount_sales" score={formData.field_confidence.amount_sales} /><input type="number" className={`w-full text-left bg-gray-800/50 border border-gray-700 rounded-lg p-1.5 text-white focus:border-indigo-400 outline-none text-sm font-bold ${formData.field_confidence.amount_sales < 100 ? 'text-amber-400 border-amber-500/50' : ''}`} value={formData.amount_sales} onChange={(e) => handleChange('amount_sales', parseInt(e.target.value) || 0)} /></div>
                                <div><FieldHeader label="營業稅" field="amount_tax" score={formData.field_confidence.amount_tax} /><input type="number" className={`w-full text-left bg-gray-800/50 border border-gray-700 rounded-lg p-1.5 text-white focus:border-indigo-400 outline-none text-sm font-bold ${formData.field_confidence.amount_tax < 100 ? 'text-rose-400 border-rose-500/50' : ''}`} value={formData.amount_tax} onChange={(e) => handleChange('amount_tax', parseInt(e.target.value) || 0)} /></div>
                            </div>
                            <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
                                <FieldHeader label="總計" field="amount_total" score={formData.field_confidence.amount_total} />
                                <input type="number" className={`w-[180px] text-right bg-transparent focus:text-indigo-400 outline-none text-2xl font-black ${formData.field_confidence.amount_total < 100 ? 'text-amber-400' : 'text-white'}`} value={formData.amount_total} onChange={(e) => handleChange('amount_total', parseInt(e.target.value) || 0)} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default InvoiceForm;
