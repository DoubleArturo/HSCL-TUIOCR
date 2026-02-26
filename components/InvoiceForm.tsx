
import React from 'react';
import { InvoiceData } from '../types';
import * as Lucide from 'lucide-react';

interface Props {
    formData: InvoiceData;
    setFormData: (data: InvoiceData) => void;
    currentInvoiceIndex: number;
    totalInvoices: number;
    erpRecord?: any;
    onInvoiceSwitch: (index: number) => void;
    onSave: () => void;
    onClose?: () => void;
    showCloseButton?: boolean;
}

const InvoiceForm: React.FC<Props> = ({
    formData, setFormData,
    currentInvoiceIndex, totalInvoices, onInvoiceSwitch,
    erpRecord,
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
        // Highlighting Logic: Check if field is flagged in verification.flagged_fields OR ERP Mismatch
        const isFlagged = formData.verification?.flagged_fields?.includes(field);
        let isErpMismatch = false;

        if (erpRecord) {
            // Compare string values roughly
            if (field === 'seller_tax_id' && erpRecord.seller_tax_id && formData.seller_tax_id != erpRecord.seller_tax_id) isErpMismatch = true;
            if (field === 'amount_total' && erpRecord.amount_total && formData.amount_total != erpRecord.amount_total) isErpMismatch = true;
        }

        if (isFlagged || isErpMismatch) {
            return 'bg-rose-50 border-rose-500 ring-2 ring-rose-200 shadow-sm animate-pulse-once'; // Distinct Red for Error
        }

        if (score >= 90) return 'bg-white border-gray-200 focus-within:border-indigo-500';
        const severity = getFieldSeverity(field);
        if (severity === 'critical') return 'bg-rose-50 border-rose-400 ring-2 ring-rose-100 shadow-sm';
        if (severity === 'warning') return 'bg-amber-50 border-amber-300 ring-2 ring-amber-50 shadow-sm';
        return 'bg-slate-50 border-slate-300 ring-2 ring-slate-50 shadow-sm';
    };

    const FieldHeader = ({ label, field, score }: { label: string, field: string, score: number }) => {
        const isFlagged = formData.verification?.flagged_fields?.includes(field);
        let erpMismatchValue = null;
        if (erpRecord) {
            if (field === 'seller_tax_id' && erpRecord.seller_tax_id && formData.seller_tax_id != erpRecord.seller_tax_id) erpMismatchValue = erpRecord.seller_tax_id;
            if (field === 'amount_total' && erpRecord.amount_total && formData.amount_total != erpRecord.amount_total) erpMismatchValue = erpRecord.amount_total;
        }

        const severity = getFieldSeverity(field);
        const alertColor = (isFlagged || erpMismatchValue || severity === 'critical') ? 'text-rose-600' : (severity === 'warning' ? 'text-amber-500' : 'text-slate-500');

        // Confidence UI Logic
        // 1. Critical Errors (ERP Mismatch, Flagged): Keep Prominent
        // 2. High Confidence (>=100): Subtle Green Dot
        // 3. Low Confidence (<100): Subtle Amber Text (No heavy background)
        return (
            <label className="flex items-center justify-between text-xs font-black text-gray-500 mb-1.5 uppercase tracking-wider group/label">
                <span className="flex items-center gap-1.5">
                    {label}
                    {(isFlagged || erpMismatchValue) && (<Lucide.AlertTriangle className={`w-3.5 h-3.5 ${alertColor}`} />)}
                </span>
                <div className="flex items-center gap-2">
                    {erpMismatchValue && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-600 border border-rose-200" title={`ERP Value: ${erpMismatchValue}`}>
                            ERP不符
                        </span>
                    )}

                    {/* Simplified Confidence Indicator */}
                    {isFlagged || erpMismatchValue ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-600 text-white">
                            異常
                        </span>
                    ) : (
                        <div className="flex items-center gap-1.5" title={`AI Confidence: ${score}%`}>
                            {score < 90 ? (
                                <span className={`text-[10px] font-bold ${score < 80 ? 'text-amber-600' : 'text-slate-400'}`}>
                                    {score}%
                                </span>
                            ) : (
                                // High Confidence (>=90%): Minimalist Dot
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 opacity-50 group-hover/label:opacity-100 transition-opacity"></div>
                            )}
                        </div>
                    )}
                </div>
            </label>
        );
    };

    // Quick Fix Handler
    const handleQuickFixTaxId = () => {
        const updated = { ...formData };
        updated.buyer_tax_id = '16547744';

        // Remove 'buyer_tax_id' from flagged_fields
        if (updated.verification?.flagged_fields) {
            updated.verification.flagged_fields = updated.verification.flagged_fields.filter(f => f !== 'buyer_tax_id');
        }
        setFormData(updated);
    };

    const errorSummary = [];
    if (!formData.manually_verified) {
        if (!formData.verification.logic_is_valid) errorSummary.push('金額勾稽錯誤');
        if (formData.verification.flagged_fields?.includes('buyer_tax_id')) errorSummary.push('買方統編錯誤');
        if (formData.verification.flagged_fields?.includes('seller_tax_id')) errorSummary.push('賣方統編異常');
        if (formData.verification.flagged_fields?.includes('invoice_number')) errorSummary.push('發票號碼格式異常');
    }

    const isSuccess = errorSummary.length === 0;


    // Manual Verification Handler
    const handleVisualCheck = () => {
        const updated = {
            ...formData,
            manually_verified: true,
            verification: {
                ...formData.verification,
                logic_is_valid: true,
                flagged_fields: [] // Clear flags
            }
        };
        setFormData(updated);
        // We need to ensure state is updated before saving? 
        // In React batching, calling onSave might use old state if it reads from props or own state?
        // InvoiceForm is controlled (formData prop). 
        // So we call setFormData -> parent updates prop -> re-render.
        // We can't immediately save unless we pass the new data to onSave or similar.
        // But `onSave` in ErrorReviewPageWrapper calls `onUpdate(formData)`.
        // So we should modify `onSave` to accept data override OR force update.
        // Actually, let's just use `onUpdate` concept from parent?
        // InvoiceForm prop `onSave` takes no args.
        // For this immediate action, let's assume valid "Save" requires the state to settle?
        // Wait, `onSave` in the wrapper calls `onUpdate(formData)`. 
        // If we call setFormData, `formData` prop won't update until next render.
        // So we CANNOT call onSave() immediately here using `formData`.
        // Suggestion: Temporarily relying on user to click Save? 
        // Requirement: "One click".
        // Use a timeout? Or better, change `onSave` to accept optional data.
        // Let's modify `onSave` in this file to NOT take args (interface), 
        // but we can pass the NEW object to `setFormData` AND ...
        // We can't easily change the prop signature without changing parent. 
        // Let's Assume `onSave` is just a signal.
        // We can hack it? No.
        // Correct way: Invoke a new prop `onvisualVerify`? Or modify `onSave` signature?
        // Let's modify `onSave` signature in `Props`? No, affects other usages.
        // InvoiceForm is used in EditorPage too?
        // Let's check usages. Only ErrorReviewPage and InvoiceEditor.
        // Let's just update the internal state and trigger save with a tiny delay or effect?
        // Better: We can make `onSave` accept an argument `data?`.
    };

    // Actually, let's just implement the button to update state, and USER clicks save? 
    // Requirement: "一鍵讓異常變成正常綠勾勾... 都可以改變狀態" (One key... change status).
    // It doesn't explicitly say "Save immediately", but "Change Status".
    // If I update the state, the UI updates to Green. User sees result. Then user clicks Save (or Next).
    // "讓使用者視覺檢查完後 ... 都可以改變狀態"
    // I will implement the state update first. If "Save" is needed, user can click it.
    // Or, I can check if I can modify onSave easily.

    // Let's stick to updating state first. It changes the UI to green immediately.

    return (
        <div className="w-[450px] min-w-[450px] shrink-0 flex flex-col border-l border-gray-200 bg-white z-30 shadow-[-10px_0_30px_rgba(0,0,0,0.05)] h-full">
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
                    <button
                        onClick={handleVisualCheck}
                        className="bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-200 transition-all flex items-center gap-2"
                        title="將所有異常標記為已人工確認"
                    >
                        <Lucide.CheckCheck className="w-3.5 h-3.5" /> 視覺確認無誤
                    </button>
                    <button onClick={onSave} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 active:scale-95"><Lucide.Save className="w-3.5 h-3.5" /> 儲存</button>
                    {showCloseButton && onClose && (
                        <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><Lucide.X className="w-5 h-5" /></button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                <div className={`p-3 rounded-xl flex items-center gap-3 border ${isSuccess ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200 shadow-sm'}`}>
                    <div className={`p-1.5 rounded-lg ${isSuccess ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                        {isSuccess ? <Lucide.CheckCircle2 className="w-4 h-4" /> : <Lucide.AlertCircle className="w-4 h-4" />}
                    </div>
                    <div>
                        <p className="font-black text-xs uppercase tracking-widest">異常狀態檢核</p>
                        <p className="text-[10px] font-bold opacity-90 mt-0.5">
                            {isSuccess ? '所有檢核項目皆正確無誤' : errorSummary.join('、')}
                        </p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div><FieldHeader label="發票號碼" field="invoice_number" score={formData.field_confidence.invoice_number} /><input type="text" className={`w-full border rounded-xl px-3 py-2 font-mono text-lg font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_number, 'invoice_number')}`} value={formData.invoice_number || ''} onChange={(e) => handleChange('invoice_number', e.target.value)} /></div>

                    <div className="grid grid-cols-2 gap-3">
                        <div><FieldHeader label="開立日期" field="invoice_date" score={formData.field_confidence.invoice_date} /><input type="date" className={`w-full border rounded-xl px-3 py-2 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_date, 'invoice_date')}`} value={formData.invoice_date || ''} onChange={(e) => handleChange('invoice_date', e.target.value)} /></div>
                        <div>
                            <FieldHeader label="買方統編" field="buyer_tax_id" score={formData.field_confidence.buyer_tax_id || 0} />
                            <div className="relative">
                                <input type="text" className={`w-full border rounded-xl px-3 py-2 text-xs font-mono font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${(formData.buyer_tax_id === '16547744') ? 'border-emerald-300 bg-emerald-50' : getFieldContainerStyle(formData.field_confidence.buyer_tax_id || 0, 'buyer_tax_id')}`} value={formData.buyer_tax_id || ''} onChange={(e) => handleChange('buyer_tax_id', e.target.value)} />
                                {formData.buyer_tax_id !== '16547744' && (
                                    <div className="mt-1 flex flex-col gap-1">
                                        <p className="text-[9px] text-rose-600 font-bold flex items-center gap-1"><Lucide.XCircle className="w-3 h-3" /> 錯誤：非 16547744</p>
                                        <button
                                            onClick={handleQuickFixTaxId}
                                            className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[10px] font-bold py-1 px-2 rounded-lg flex items-center gap-1 transition-colors w-fit border border-emerald-200"
                                        >
                                            <Lucide.Check className="w-3 h-3" /> 系統誤判？(改為16547744)
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
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
