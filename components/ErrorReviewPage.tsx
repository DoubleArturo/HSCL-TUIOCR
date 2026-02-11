
import React, { useState, useMemo } from 'react';

import { Project, InvoiceEntry, InvoiceData, AuditRow } from '../types';
import * as Lucide from 'lucide-react';
import InvoicePreview from './InvoicePreview';
import InvoiceForm from './InvoiceForm';

interface Props {
    project: Project;
    auditList: AuditRow[];
    onBack: () => void;
    onUpdateInvoice: (id: string, updatedData: InvoiceData) => void;
}

// Error category types
type ErrorCategory = 'all' | 'buyer_tax_id' | 'amount_logic' | 'seller_tax_id' | 'erp_mismatch' | 'other';

interface ErrorItem {
    entry: InvoiceEntry;
    invoiceIndex: number;
    categories: ErrorCategory[];
    reasons: string[];
    erp?: any; // ERP Record
}



const ErrorReviewPage: React.FC<Props> = ({ project, auditList, onBack, onUpdateInvoice }) => {
    const [selectedCategory, setSelectedCategory] = useState<ErrorCategory>('all');

    // Comprehensive error categorization
    const { errorList, categoryCounts } = useMemo(() => {
        const list: ErrorItem[] = [];
        const counts: Record<ErrorCategory, number> = {
            all: 0,
            buyer_tax_id: 0,
            amount_logic: 0,
            seller_tax_id: 0,
            erp_mismatch: 0,
            other: 0
        };

        // We iterate auditList to ensure we capture ERP mismatches AND intrinsic errors
        auditList.forEach(row => {
            // Each AuditRow might contain multiple files (if one ERP matches multiple params)
            // Or "Extra Files" (no ERP).

            row.files.forEach(entry => {
                entry.data.forEach((inv, idx) => {
                    const categories: ErrorCategory[] = [];
                    const reasons: string[] = [];

                    // 1. Buyer Tax ID Error (Strict Value Check)
                    if (inv.buyer_tax_id !== '16547744') {
                        categories.push('buyer_tax_id');
                        if (!reasons.includes('買方統編錯誤')) reasons.push('買方統編錯誤');
                        counts.buyer_tax_id++;
                    }

                    // 2. Amount Logic Error (Intrinsic)
                    if (!inv.verification?.logic_is_valid) {
                        categories.push('amount_logic');
                        if (!reasons.includes('金額勾稽錯誤')) reasons.push('金額勾稽錯誤');
                        counts.amount_logic++;
                    }

                    // 3. Seller Tax ID Intrinsic Issues
                    if (inv.seller_tax_id && (inv.seller_tax_id.includes('?') || inv.seller_tax_id === 'NOT_FOUND')) {
                        categories.push('seller_tax_id');
                        if (!reasons.includes('賣方統編不清')) reasons.push('賣方統編不清');
                        counts.seller_tax_id++;
                    }

                    // 4. ERP Mismatches (From AuditRow)
                    // Only apply if this file is actually part of the mismatch determination. 
                    // Usually safe to assume if the row is MISMATCH, the invoices in it are suspect.
                    if (row.auditStatus === 'MISMATCH') {
                        if (row.diffDetails.includes('amount')) {
                            categories.push('erp_mismatch');
                            if (!reasons.includes('ERP金額不符')) reasons.push('ERP金額不符');
                            counts.erp_mismatch++;
                        }
                        if (row.diffDetails.includes('tax_id')) {
                            categories.push('erp_mismatch');
                            if (!reasons.includes('ERP賣方統編不符')) reasons.push('ERP賣方統編不符');
                            counts.erp_mismatch++;
                        }
                        if (row.diffDetails.includes('buyer_id_error')) {
                            // Already handled by intrinsic check usually, but if intrinsic passed and this failed? 
                            // (Unlikely if logic is synced, but safe to add)
                            if (!categories.includes('buyer_tax_id')) categories.push('buyer_tax_id');
                            if (!reasons.includes('買方統編錯誤')) reasons.push('買方統編錯誤 (ERP要求)');
                        }
                    }

                    // 5. Other verification flags
                    if (inv.verification?.flagged_fields && inv.verification.flagged_fields.length > 0) {
                        const otherFlags = inv.verification.flagged_fields.filter(
                            f => !['buyer_tax_id', 'seller_tax_id'].includes(f)
                        );
                        if (otherFlags.length > 0 && categories.length === 0) { // Only if no other major errors? Or always?
                            // Let's always add if it's a flag we haven't covered
                            categories.push('other');
                            reasons.push('AI標記異常');
                            counts.other++;
                        }
                    }

                    // Dedupe categories
                    const uniqueCategories = Array.from(new Set(categories));

                    // Only add if there are errors AND not manually verified
                    if (uniqueCategories.length > 0 && !inv.manually_verified) {
                        list.push({ entry, invoiceIndex: idx, categories: uniqueCategories, reasons, erp: row.erp });
                        counts.all++;
                    }
                });
            });
        });

        // Deduplicate list? 
        // auditList rows are unique by definition (One ERP or One Extra).
        // But `row.files` might overlap? 
        // App.tsx logic: "matchingFiles" are found.
        // If one file helps match 2 ERPs (unlikely 1:1 usually), it might appear twice.
        // But `files.flatMap` in App.tsx suggests N:M?
        // Let's assume unique enough or acceptable duplication for now.
        // Actually, let's dedupe by entry.id + index just in case.
        const uniqueList = list.filter((item, index, self) =>
            index === self.findIndex((t) => (
                t.entry.id === item.entry.id && t.invoiceIndex === item.invoiceIndex
            ))
        );

        // Recalculate 'all' count based on unique list
        counts.all = uniqueList.length;

        return { errorList: uniqueList, categoryCounts: counts };
    }, [auditList]); // Depend on auditList, not project.invoices


    // Filter by category
    const filteredErrorList = useMemo(() => {
        if (selectedCategory === 'all') return errorList;
        return errorList.filter(item => item.categories.includes(selectedCategory));
    }, [errorList, selectedCategory]);

    const [selectedIndex, setSelectedIndex] = useState(0);

    // Reset selected index when filter changes
    React.useEffect(() => {
        setSelectedIndex(0);
    }, [selectedCategory]);

    // If list is empty
    if (filteredErrorList.length === 0 && selectedCategory !== 'all') {
        return (
            <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
                <div className="bg-white p-12 rounded-3xl shadow-xl text-center max-w-lg">
                    <div className="bg-blue-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Lucide.Filter className="w-10 h-10 text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-black text-gray-800 mb-2">此類別無異常</h2>
                    <p className="text-gray-500 mb-8">切換到其他類別查看錯誤</p>
                    <button onClick={() => setSelectedCategory('all')} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors">
                        查看全部異常
                    </button>
                </div>
            </div>
        );
    }

    if (errorList.length === 0) {
        return (
            <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
                <div className="bg-white p-12 rounded-3xl shadow-xl text-center max-w-lg">
                    <div className="bg-emerald-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Lucide.CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h2 className="text-2xl font-black text-gray-800 mb-2">太棒了！沒有發現異常</h2>
                    <p className="text-gray-500 mb-8">所有發票的買方統編與金額邏輯皆正確。</p>
                    <button onClick={onBack} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors">
                        返回專案首頁
                    </button>
                </div>
            </div>
        );
    }

    const selectedItem = filteredErrorList[selectedIndex];
    const currentEntry = selectedItem?.entry;
    const currentInvoiceData = currentEntry?.data[selectedItem?.invoiceIndex];

    // Handler for saving
    const handleSave = () => {
        // Current invoice data is modified in place via setFormData wrapper below?
        // No, InvoiceForm takes formData prop. We need to handle the update.
        // Wait, InvoiceForm calls setFormData which updates LOCAL state in InvoiceForm? 
        // No, InvoiceForm is controlled.
    };

    // We need a local state wrapper for the form data because InvoiceForm expects `setFormData`
    // But we want to modify the global state eventually.
    // Actually, let's just make a wrapper that updates the global state immediately?
    // Or better, local state that syncs like InvoiceEditor.

    // Let's create a wrapper component or just separate logic here.
    // InvoiceForm expects `formData` and `setFormData`.

    // Use a key to force reset state when switching items
    return (
        <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
            {/* Header */}
            <div className="h-16 bg-white border-b flex items-center px-4 justify-between shrink-0 z-50">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors">
                        <Lucide.ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="h-6 w-px bg-gray-200"></div>
                    <h1 className="text-lg font-black text-gray-800 flex items-center gap-2">
                        <Lucide.AlertOctagon className="w-5 h-5 text-rose-500" />
                        異常檢核列表 ({filteredErrorList.length}筆)
                    </h1>
                </div>
                <div className="bg-rose-50 text-rose-600 px-3 py-1 rounded-full text-xs font-bold border border-rose-100">
                    專注模式：請修正左側原始憑證與右側資料的差異
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar List */}
                <div className="w-[240px] bg-white border-r border-gray-200 flex flex-col shrink-0 z-40 transition-all duration-300">
                    {/* Category Filters */}
                    <div className="p-3 border-b bg-gradient-to-br from-gray-50 to-white">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">錯誤類別篩選</label>
                        <div className="relative">
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value as ErrorCategory)}
                                className="w-full appearance-none bg-white border border-gray-300 text-gray-700 text-xs font-bold rounded-lg py-2 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                            >
                                <option value="all">全部異常 ({categoryCounts.all})</option>
                                <option value="buyer_tax_id">買方統編錯誤 ({categoryCounts.buyer_tax_id})</option>
                                <option value="amount_logic">金額勾稽錯誤 ({categoryCounts.amount_logic})</option>
                                <option value="seller_tax_id">賣方統編不清 ({categoryCounts.seller_tax_id})</option>
                                <option value="erp_mismatch">ERP 比對異常 ({categoryCounts.erp_mismatch})</option>
                                <option value="other">其他 ({categoryCounts.other})</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                                <Lucide.ChevronDown className="w-4 h-4" />
                            </div>
                        </div>
                    </div>

                    <div className="bg-gray-50 px-3 py-2 border-b">
                        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">待處理 ({filteredErrorList.length})</h3>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {filteredErrorList.map((item, idx) => (
                            <div
                                key={`${item.entry.id}_${item.invoiceIndex}`}
                                onClick={() => setSelectedIndex(idx)}
                                className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:shadow-md group relative ${selectedIndex === idx ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-500/30' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                            >
                                <div className="flex justify-between items-start mb-1.5">
                                    <span className="font-bold text-gray-800 text-xs truncate max-w-[140px] block" title={item.entry.id}>{item.entry.id}</span>
                                    <span className="text-[9px] text-gray-400 font-mono shrink-0">#{idx + 1}</span>
                                </div>

                                <div className="flex flex-wrap gap-1 mb-1.5">
                                    {item.reasons.map((reason, ridx) => (
                                        <span key={ridx} className={`text-[9px] font-black px-1.5 py-0.5 rounded ${reason.includes('買方') ? 'bg-rose-100 text-rose-600' :
                                            reason.includes('金額') ? 'bg-amber-100 text-amber-600' :
                                                reason.includes('ERP') ? 'bg-purple-100 text-purple-600' :
                                                    reason.includes('賣方') ? 'bg-orange-100 text-orange-600' :
                                                        'bg-gray-100 text-gray-600'
                                            }`}>
                                            {reason}
                                        </span>
                                    ))}
                                </div>

                                <div className="flex items-center justify-between">
                                    {item.entry.data[item.invoiceIndex]?.document_type ? (
                                        <span className={`text-[9px] font-bold px-1 py-px rounded whitespace-nowrap ${item.entry.data[item.invoiceIndex].document_type === '統一發票' ? 'bg-blue-50 text-blue-600' :
                                            item.entry.data[item.invoiceIndex].document_type === 'Invoice' ? 'bg-purple-50 text-purple-600' :
                                                item.entry.data[item.invoiceIndex].document_type === '進口報關' ? 'bg-teal-50 text-teal-600' :
                                                    'bg-gray-50 text-gray-500'
                                            }`}>
                                            {item.entry.data[item.invoiceIndex].document_type}
                                        </span>
                                    ) : <span></span>}
                                    <div className="text-[9px] text-gray-400 flex items-center gap-1">
                                        <Lucide.FileText className="w-2.5 h-2.5" />
                                        {item.invoiceIndex + 1}/{item.entry.data.length}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Split View */}
                <div className="flex-1 flex overflow-x-auto overflow-y-hidden">
                    {/* Re-use InvoicePreview */}
                    {/* Be careful with `currentIndex` which is for the LIST of files in InvoicePreview. 
                     Here we just want to show ONE file.
                     So we pass a list of 1 file, or adjust InvoicePreview to accept single file.
                     InvoicePreview takes `entries` and `currentIndex`. We can pass errorList mapped to entries?
                     No, InvoicePreview's file switcher allows switching files.
                     Here the Sidebar controls the file.
                     So we pass entries=[currentEntry] and currentIndex=0. 
                     And ignore onSwitchFile.
                 */}
                    <div className="w-[650px] min-w-[650px] shrink-0 h-full flex flex-col relative">
                        <InvoicePreview
                            currentEntry={currentEntry}
                            entries={[currentEntry]} // Hide switcher effectively or show just one
                            currentIndex={0}
                            onSwitchFile={() => { }}
                        />
                    </div>

                    {/* Re-use InvoiceForm */}
                    {/* Wrapper to handle state */}
                    <ErrorReviewFormWrapper
                        key={`${currentEntry.id}-${selectedItem.invoiceIndex}`} // Re-mount on switch
                        initialData={currentInvoiceData}
                        invoiceIndex={selectedItem.invoiceIndex}
                        totalInvoices={currentEntry.data.length}
                        entryId={currentEntry.id}
                        erpRecord={selectedItem.erp}
                        onUpdate={(newData) => onUpdateInvoice(currentEntry.id, newData)}
                        onNext={() => {
                            if (selectedIndex < filteredErrorList.length - 1) setSelectedIndex(s => s + 1);
                            else alert('已是最後一筆');
                        }}
                    />
                </div>
            </div>
        </div>
    );
};

// Local wrapper to bridge InvoiceForm state
const ErrorReviewFormWrapper: React.FC<{
    initialData: InvoiceData,
    invoiceIndex: number,
    totalInvoices: number,
    entryId: string,
    erpRecord?: any,
    onUpdate: (data: InvoiceData) => void,
    onNext: () => void
}> = ({ initialData, invoiceIndex, totalInvoices, entryId, erpRecord, onUpdate, onNext }) => {
    const [formData, setFormData] = React.useState(initialData);

    // Auto-save on unmount or explicit save? 
    // User expects "Save".
    const handleSave = () => {
        onUpdate(formData); // This updates the global state in App.tsx
        // Visual feedback?
        // Maybe move to next automatically?
        onNext();
    };

    return (
        <InvoiceForm
            formData={formData}
            setFormData={setFormData}
            currentInvoiceIndex={invoiceIndex}
            totalInvoices={totalInvoices}
            erpRecord={erpRecord}
            onInvoiceSwitch={() => { }} // Disable switching invoices within form, use sidebar
            onSave={handleSave}
            showCloseButton={false}
        />
    );
}

export default ErrorReviewPage;
