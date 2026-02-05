
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

const ErrorReviewPage: React.FC<Props> = ({ project, onBack, onUpdateInvoice }) => {
    // Filter for errors
    const errorList = useMemo(() => {
        const list: { entry: InvoiceEntry, invoiceIndex: number, reason: string }[] = [];

        project.invoices.forEach(entry => {
            entry.data.forEach((inv, idx) => {
                let reasons: string[] = [];

                // 1. Buyer Tax ID Error
                if (inv.buyer_tax_id && inv.buyer_tax_id !== '16547744') {
                    reasons.push('買方統編錯誤');
                }

                // 2. Logic Invalid
                if (!inv.verification.logic_is_valid) {
                    reasons.push('金額勾稽錯誤');
                }

                // 3. Tax ID Unclear
                if (inv.seller_tax_id && inv.seller_tax_id.includes('?')) {
                    reasons.push('賣方統編不清');
                }

                // 4. Trace Log Warnings (Optional, might be too noisy)
                // if (inv.trace_logs && inv.trace_logs.some(l => l.includes('Warning'))) {
                //   reasons.push('警示項目');
                // }

                if (reasons.length > 0) {
                    list.push({ entry, invoiceIndex: idx, reason: reasons.join(', ') });
                }
            });
        });

        return list;
    }, [project.invoices]);

    const [selectedIndex, setSelectedIndex] = useState(0);

    // If list is empty
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

    const selectedItem = errorList[selectedIndex];
    const currentEntry = selectedItem.entry;
    const currentInvoiceData = currentEntry.data[selectedItem.invoiceIndex];

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
                        異常檢核列表 ({errorList.length})
                    </h1>
                </div>
                <div className="bg-rose-50 text-rose-600 px-3 py-1 rounded-full text-xs font-bold border border-rose-100">
                    專注模式：請修正左側原始憑證與右側資料的差異
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar List */}
                <div className="w-[320px] bg-white border-r border-gray-200 flex flex-col shrink-0 z-40">
                    <div className="p-4 border-b bg-gray-50">
                        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">待處理異常 queues</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {errorList.map((item, idx) => (
                            <div
                                key={`${item.entry.id}_${item.invoiceIndex}`}
                                onClick={() => setSelectedIndex(idx)}
                                className={`p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md group ${selectedIndex === idx ? 'bg-indigo-50 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className={`text-xs font-black px-1.5 py-0.5 rounded ${item.reason.includes('買方') ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                                        {item.reason.split(',')[0]}
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-mono">#{idx + 1}</span>
                                </div>
                                <div className="font-bold text-gray-800 text-sm truncate">{item.entry.id}</div>
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
