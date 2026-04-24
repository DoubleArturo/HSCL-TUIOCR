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
    onToggleErpDiscrepancy: (voucherId: string) => void;
}

// All possible diff keys in display order
// no_match_found = file/ERP naming issue, not an OCR error — excluded from review
const DIFF_KEYS = ['date', 'amount', 'inv_no', 'tax_code', 'tax_id', 'tax_id_unclear'] as const;
type DiffKey = typeof DIFF_KEYS[number];

const DIFF_LABELS: Record<DiffKey, string> = {
    date: '日期不符',
    amount: '金額不符',
    inv_no: '發票號碼不符',
    tax_code: '稅別不符',
    tax_id: '統編不符',
    tax_id_unclear: '統編模糊',
};

const DIFF_COLORS: Record<DiffKey, string> = {
    date: 'bg-amber-100 text-amber-700',
    amount: 'bg-rose-100 text-rose-700',
    inv_no: 'bg-rose-100 text-rose-700',
    tax_code: 'bg-purple-100 text-purple-700',
    tax_id: 'bg-orange-100 text-orange-700',
    tax_id_unclear: 'bg-amber-100 text-amber-700',
};

function isInvoiceType(row: AuditRow) {
    return row.ocr?.voucher_type === 'Invoice' ||
        row.ocr?.document_type === 'Invoice' ||
        row.ocr?.document_type === 'Commercial Invoice';
}

const ErrorReviewPage: React.FC<Props> = ({ project, auditList, onBack, onUpdateInvoice, onToggleErpDiscrepancy }) => {
    const [activeFilter, setActiveFilter] = useState<DiffKey | 'all'>('all');
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Build error rows: only MISMATCH rows with real OCR-level diffs
    // Exclude: Invoice type, PENDING files, and rows where the only diff is no_match_found
    const errorRows = useMemo(() =>
        auditList.filter(row => {
            if (row.auditStatus !== 'MISMATCH') return false;
            if (isInvoiceType(row)) return false;
            if (!row.file || row.file.status === 'PENDING' || row.file.status === 'PROCESSING') return false;
            // Only include rows that have at least one reviewable diff key
            return row.diffDetails.some(d => DIFF_KEYS.includes(d as DiffKey));
        }),
        [auditList]
    );

    // Count per diff key
    const keyCounts = useMemo(() => {
        const counts = {} as Record<DiffKey, number>;
        for (const key of DIFF_KEYS) counts[key] = 0;
        for (const row of errorRows) {
            for (const d of row.diffDetails) {
                if (d in counts) counts[d as DiffKey]++;
            }
        }
        return counts;
    }, [errorRows]);

    // Filtered list
    const filteredRows = useMemo(() =>
        activeFilter === 'all'
            ? errorRows
            : errorRows.filter(row => row.diffDetails.includes(activeFilter)),
        [errorRows, activeFilter]
    );

    // Reset selection when filter changes
    React.useEffect(() => { setSelectedIndex(0); }, [activeFilter]);

    if (errorRows.length === 0) {
        return (
            <div className="h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
                <div className="bg-white p-12 rounded-3xl shadow-xl text-center max-w-lg">
                    <div className="bg-emerald-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Lucide.CheckCircle2 className="w-10 h-10 text-emerald-600" />
                    </div>
                    <h2 className="text-2xl font-black text-gray-800 mb-2">太棒了！沒有發現異常</h2>
                    <p className="text-gray-500 mb-8">所有已比對憑證皆符合 ERP 資料。</p>
                    <button onClick={onBack} className="bg-gray-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-black transition-colors">
                        返回專案首頁
                    </button>
                </div>
            </div>
        );
    }

    const selectedRow = filteredRows[selectedIndex];
    const currentEntry = selectedRow?.file ?? selectedRow?.files[0] ?? null;
    const invoiceIndex = selectedRow?.initialInvoiceIndex ?? 0;
    const currentInvoiceData = currentEntry?.data[invoiceIndex];

    return (
        <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
            {/* Header */}
            <div className="h-14 bg-white border-b flex items-center px-4 justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors">
                        <Lucide.ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="h-6 w-px bg-gray-200" />
                    <h1 className="text-base font-black text-gray-800 flex items-center gap-2">
                        <Lucide.AlertOctagon className="w-4 h-4 text-rose-500" />
                        異常檢核列表
                        <span className="text-rose-500">({errorRows.length})</span>
                    </h1>
                </div>
                <span className="text-[11px] text-rose-500 font-bold bg-rose-50 border border-rose-100 px-3 py-1 rounded-full">
                    請對照左側憑證修正右側資料
                </span>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <div className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">

                    {/* Group filter buttons */}
                    <div className="p-3 border-b space-y-1">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2">比對錯誤類型</p>

                        {/* All */}
                        <button
                            onClick={() => setActiveFilter('all')}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeFilter === 'all' ? 'bg-slate-800 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                        >
                            <span>全部異常</span>
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${activeFilter === 'all' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                                {errorRows.length}
                            </span>
                        </button>

                        {/* Per diff key — only show keys that have > 0 */}
                        {DIFF_KEYS.filter(k => keyCounts[k] > 0).map(key => (
                            <button
                                key={key}
                                onClick={() => setActiveFilter(key)}
                                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeFilter === key ? 'bg-rose-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                            >
                                <span>{DIFF_LABELS[key]}</span>
                                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${activeFilter === key ? 'bg-white/20 text-white' : 'bg-rose-50 text-rose-500'}`}>
                                    {keyCounts[key]}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Item list */}
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1 pt-1 pb-0.5">
                            {activeFilter === 'all' ? '全部' : DIFF_LABELS[activeFilter as DiffKey]} ({filteredRows.length})
                        </p>
                        {filteredRows.map((row, idx) => (
                            <div
                                key={row.key}
                                onClick={() => setSelectedIndex(idx)}
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${selectedIndex === idx ? 'bg-indigo-50 border-indigo-300 ring-1 ring-indigo-400/30' : 'bg-white border-gray-100 hover:border-gray-300'}`}
                            >
                                <div className="flex justify-between items-center mb-1">
                                    <span className="font-bold text-gray-800 text-[11px] truncate max-w-[100px]" title={row.id}>{row.id}</span>
                                    <div className="flex items-center gap-1">
                                        {row.erp?.erp_discrepancy && (
                                            <span className="text-[8px] font-black px-1 py-px rounded bg-indigo-100 text-indigo-600">ERP問題</span>
                                        )}
                                        <span className="text-[9px] text-gray-400 font-mono">#{idx + 1}</span>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-0.5">
                                    {row.diffDetails.filter(d => DIFF_KEYS.includes(d as DiffKey)).map(d => (
                                        <span key={d} className={`text-[8px] font-black px-1 py-px rounded ${DIFF_COLORS[d as DiffKey] ?? 'bg-gray-100 text-gray-500'}`}>
                                            {DIFF_LABELS[d as DiffKey] ?? d}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {filteredRows.length === 0 && (
                            <div className="text-center py-8 text-xs text-gray-400">此分類無異常</div>
                        )}
                    </div>
                </div>

                {/* Main split view */}
                {selectedRow && currentEntry && currentInvoiceData ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* ERP Discrepancy banner */}
                        {selectedRow.erp && (
                            <div className={`shrink-0 px-4 py-2 flex items-center justify-between border-b text-xs font-bold transition-colors ${selectedRow.erp.erp_discrepancy ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100'}`}>
                                <span className={selectedRow.erp.erp_discrepancy ? 'text-indigo-700' : 'text-gray-400'}>
                                    {selectedRow.erp.erp_discrepancy
                                        ? '✅ 已標記：此差異來自 ERP 登載問題（AI 辨識正確）'
                                        : '此筆差異是 ERP 資料問題，還是 AI 讀取錯誤？'}
                                </span>
                                <button
                                    onClick={() => onToggleErpDiscrepancy(selectedRow.erp!.voucher_id)}
                                    className={`ml-4 px-3 py-1 rounded-lg border font-black text-[11px] transition-colors ${
                                        selectedRow.erp.erp_discrepancy
                                            ? 'bg-indigo-100 border-indigo-300 text-indigo-700 hover:bg-indigo-200'
                                            : 'bg-white border-gray-300 text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700'
                                    }`}
                                >
                                    {selectedRow.erp.erp_discrepancy ? '取消標記' : '標記為 ERP 問題'}
                                </button>
                            </div>
                        )}
                        <div className="flex-1 flex overflow-x-auto overflow-y-hidden">
                            <div className="flex-1 shrink-0 h-full flex flex-col relative min-w-[400px]">
                                <InvoicePreview
                                    currentEntry={currentEntry}
                                    entries={[currentEntry]}
                                    currentIndex={0}
                                    onSwitchFile={() => {}}
                                />
                            </div>
                            <ErrorReviewFormWrapper
                                key={`${currentEntry.id}-${invoiceIndex}`}
                                initialData={currentInvoiceData}
                                invoiceIndex={invoiceIndex}
                                totalInvoices={currentEntry.data.length}
                                entryId={currentEntry.id}
                                erpRecord={selectedRow.erp}
                                onUpdate={(newData) => onUpdateInvoice(currentEntry.id, newData)}
                                onNext={() => {
                                    if (selectedIndex < filteredRows.length - 1) setSelectedIndex(s => s + 1);
                                    else alert('已是最後一筆');
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                        選擇左側項目以檢視
                    </div>
                )}
            </div>
        </div>
    );
};

// Local wrapper to bridge InvoiceForm state
const ErrorReviewFormWrapper: React.FC<{
    initialData: InvoiceData;
    invoiceIndex: number;
    totalInvoices: number;
    entryId: string;
    erpRecord?: any;
    onUpdate: (data: InvoiceData) => void;
    onNext: () => void;
}> = ({ initialData, invoiceIndex, totalInvoices, entryId, erpRecord, onUpdate, onNext }) => {
    const [formData, setFormData] = React.useState(initialData);

    const handleSave = () => {
        onUpdate(formData);
        onNext();
    };

    return (
        <InvoiceForm
            formData={formData}
            setFormData={setFormData}
            currentInvoiceIndex={invoiceIndex}
            totalInvoices={totalInvoices}
            erpRecord={erpRecord}
            onInvoiceSwitch={() => {}}
            onSave={handleSave}
            showCloseButton={false}
        />
    );
};

export default ErrorReviewPage;
