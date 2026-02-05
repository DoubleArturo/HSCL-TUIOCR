
import React, { useState, useMemo } from 'react';
import { Project, InvoiceEntry, InvoiceData } from '../types';
import * as Lucide from 'lucide-react';
import InvoicePreview from './InvoicePreview';
import InvoiceForm from './InvoiceForm';

interface Props {
    project: Project;
    onBack: () => void;
    onUpdateInvoice: (id: string, updatedData: InvoiceData) => void;
}

// Error category types
type ErrorCategory = 'all' | 'buyer_tax_id' | 'amount_logic' | 'seller_tax_id' | 'other';

interface ErrorItem {
    entry: InvoiceEntry;
    invoiceIndex: number;
    categories: ErrorCategory[];
    reasons: string[];
}

const ErrorReviewPage: React.FC<Props> = ({ project, onBack, onUpdateInvoice }) => {
    const [selectedCategory, setSelectedCategory] = useState<ErrorCategory>('all');

    // Comprehensive error categorization
    const { errorList, categoryCounts } = useMemo(() => {
        const list: ErrorItem[] = [];
        const counts: Record<ErrorCategory, number> = {
            all: 0,
            buyer_tax_id: 0,
            amount_logic: 0,
            seller_tax_id: 0,
            other: 0
        };

        project.invoices.forEach(entry => {
            entry.data.forEach((inv, idx) => {
                const categories: ErrorCategory[] = [];
                const reasons: string[] = [];

                // 1. Buyer Tax ID Error
                if (inv.verification?.flagged_fields?.includes('buyer_tax_id') ||
                    (inv.buyer_tax_id && inv.buyer_tax_id !== '16547744')) {
                    categories.push('buyer_tax_id');
                    reasons.push('買方統編錯誤');
                    counts.buyer_tax_id++;
                }

                // 2. Amount Logic Error
                if (!inv.verification?.logic_is_valid) {
                    categories.push('amount_logic');
                    reasons.push('金額勾稽錯誤');
                    counts.amount_logic++;
                }

                // 3. Seller Tax ID Issues
                if (inv.seller_tax_id && (inv.seller_tax_id.includes('?') || inv.seller_tax_id === 'NOT_FOUND')) {
                    categories.push('seller_tax_id');
                    reasons.push('賣方統編不清');
                    counts.seller_tax_id++;
                }

                // 4. Other verification flags
                if (inv.verification?.flagged_fields && inv.verification.flagged_fields.length > 0) {
                    const otherFlags = inv.verification.flagged_fields.filter(
                        f => !['buyer_tax_id', 'seller_tax_id'].includes(f)
                    );
                    if (otherFlags.length > 0 && categories.length === 0) {
                        categories.push('other');
                        reasons.push('其他驗證異常');
                        counts.other++;
                    }
                }

                // Only add if there are errors
                if (categories.length > 0) {
                    list.push({ entry, invoiceIndex: idx, categories, reasons });
                    counts.all++;
                }
            });
        });

        return { errorList: list, categoryCounts: counts };
    }, [project.invoices]);

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
                <div className="w-[380px] bg-white border-r border-gray-200 flex flex-col shrink-0 z-40">
                    {/* Category Filters */}
                    <div className="p-3 border-b bg-gradient-to-br from-gray-50 to-white">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">錯誤類別篩選</h3>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={() => setSelectedCategory('all')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === 'all'
                                    ? 'bg-indigo-600 text-white shadow-lg'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>全部</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedCategory === 'all' ? 'bg-indigo-500' : 'bg-gray-200'
                                        }`}>
                                        {categoryCounts.all}
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setSelectedCategory('buyer_tax_id')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === 'buyer_tax_id'
                                    ? 'bg-rose-600 text-white shadow-lg'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>買方統編</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedCategory === 'buyer_tax_id' ? 'bg-rose-500' : 'bg-gray-200'
                                        }`}>
                                        {categoryCounts.buyer_tax_id}
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setSelectedCategory('amount_logic')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === 'amount_logic'
                                    ? 'bg-amber-600 text-white shadow-lg'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>金額勾稽</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedCategory === 'amount_logic' ? 'bg-amber-500' : 'bg-gray-200'
                                        }`}>
                                        {categoryCounts.amount_logic}
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setSelectedCategory('seller_tax_id')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === 'seller_tax_id'
                                    ? 'bg-orange-600 text-white shadow-lg'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>賣方統編</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedCategory === 'seller_tax_id' ? 'bg-orange-500' : 'bg-gray-200'
                                        }`}>
                                        {categoryCounts.seller_tax_id}
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setSelectedCategory('other')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${selectedCategory === 'other'
                                    ? 'bg-gray-600 text-white shadow-lg'
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <span>其他</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${selectedCategory === 'other' ? 'bg-gray-500' : 'bg-gray-200'
                                        }`}>
                                        {categoryCounts.other}
                                    </span>
                                </div>
                            </button>
                        </div>
                    </div>

                    <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">待處理異常 QUEUES</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {filteredErrorList.map((item, idx) => (
                            <div
                                key={`${item.entry.id}_${item.invoiceIndex}`}
                                onClick={() => setSelectedIndex(idx)}
                                className={`p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md group ${selectedIndex === idx ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex flex-wrap gap-1">
                                        {item.reasons.map((reason, ridx) => (
                                            <span key={ridx} className={`text-[10px] font-black px-1.5 py-0.5 rounded ${reason.includes('買方') ? 'bg-rose-100 text-rose-600' :
                                                reason.includes('金額') ? 'bg-amber-100 text-amber-600' :
                                                    reason.includes('賣方') ? 'bg-orange-100 text-orange-600' :
                                                        'bg-gray-100 text-gray-600'
                                                }`}>
                                                {reason}
                                            </span>
                                        ))}
                                    </div>
                                    <span className="text-[10px] text-gray-400 font-mono">#{idx + 1}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-gray-800 text-sm truncate">{item.entry.id}</span>
                                    {item.entry.data[item.invoiceIndex]?.document_type && (
                                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${item.entry.data[item.invoiceIndex].document_type === '統一發票' ? 'bg-blue-100 text-blue-700' :
                                                item.entry.data[item.invoiceIndex].document_type === 'Invoice' ? 'bg-purple-100 text-purple-700' :
                                                    item.entry.data[item.invoiceIndex].document_type === '進口報關' ? 'bg-teal-100 text-teal-700' :
                                                        'bg-gray-100 text-gray-600'
                                            }`}>
                                            {item.entry.data[item.invoiceIndex].document_type}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                                    <Lucide.FileText className="w-3 h-3" />
                                    {item.invoiceIndex + 1} / {item.entry.data.length}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Split View */}
                <div className="flex-1 flex relative">
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
                    <InvoicePreview
                        currentEntry={currentEntry}
                        entries={[currentEntry]} // Hide switcher effectively or show just one
                        currentIndex={0}
                        onSwitchFile={() => { }}
                    />

                    {/* Re-use InvoiceForm */}
                    {/* Wrapper to handle state */}
                    <ErrorReviewFormWrapper
                        key={`${currentEntry.id}-${selectedItem.invoiceIndex}`} // Re-mount on switch
                        initialData={currentInvoiceData}
                        invoiceIndex={selectedItem.invoiceIndex}
                        totalInvoices={currentEntry.data.length}
                        entryId={currentEntry.id}
                        onUpdate={(newData) => onUpdateInvoice(currentEntry.id, newData)}
                        onNext={() => {
                            if (selectedIndex < errorList.length - 1) setSelectedIndex(s => s + 1);
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
    onUpdate: (data: InvoiceData) => void,
    onNext: () => void
}> = ({ initialData, invoiceIndex, totalInvoices, entryId, onUpdate, onNext }) => {
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
            onInvoiceSwitch={() => { }} // Disable switching invoices within form, use sidebar
            onSave={handleSave}
            showCloseButton={false}
        />
    );
}

export default ErrorReviewPage;
