
import React, { useState, useRef, useEffect } from 'react';
import { Loader2, CheckCircle2, Edit3, Trash2, PlusSquare, ArrowLeftRight, UploadCloud, FolderOpen, ChevronRight, Calendar, Database, Search, Plus, LogOut, Users } from 'lucide-react';
import { analyzeInvoice } from './services/geminiService';
import { enhanceImageForOCR } from './src/lib/imageEnhancement';
import { InvoiceData, ProjectMeta } from './types';
import InvoiceEditor from './components/InvoiceEditor';
import ErrorReviewPage from './components/ErrorReviewPage';
import CostDashboard from './components/CostDashboard';
import AuditTable from './components/AuditTable';
import * as Lucide from 'lucide-react';
import * as XLSX from 'xlsx';
import { useProject } from './src/hooks/useProject';
import { useOCRBatch } from './src/hooks/useOCRBatch';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window { aistudio?: AIStudio; }
}

import { fileStorageService } from './services/fileStorageService';
import { fetchAllSellerRows, upsertSeller, deleteSeller, upsertSellers, SellerRow, recordOCRCorrections, OCRCorrectionRecord } from './services/supabaseService';
import { logger } from './services/loggerService';
import { getSession, clearSession, initSession, AppUser } from './services/authService';
import LoginScreen from './components/LoginScreen';
import AdminPage from './components/AdminPage';
import { useAuditList } from './src/hooks/useAuditList';
import { buildAuditCSV, downloadCSV } from './src/lib/csvExport';
import { parseERPRows } from './src/lib/erpParser';

const BUYER_TAX_ID_REQUIRED = "16547744";

function getDaysRemaining(updatedAt: string): number {
    const expiry = new Date(updatedAt).getTime() + 90 * 24 * 60 * 60 * 1000;
    return Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000));
}

const App: React.FC = () => {
    // === Auth state ===
    const [currentUser, setCurrentUser] = useState<AppUser | null>(() => getSession());
    const [authLoading, setAuthLoading] = useState(true);
    const [view, setView] = useState<'PROJECT_LIST' | 'WORKSPACE' | 'ERROR_REVIEW' | 'SELLER_DB' | 'ADMIN'>('PROJECT_LIST');

    // Verify session with Supabase on mount (handles page refresh)
    useEffect(() => {
        initSession().then(user => {
            setCurrentUser(user);
            setAuthLoading(false);
        });
    }, []);

    // === All remaining hooks — must run before any early return ===
    const {
        projectList,
        project,
        createProject,
        loadProject: loadProjectFromHook,
        deleteProject: deleteProjectFromHook,
        updateInvoices,
        updateERP,
        toggleErpFlag,
        updateProjectMeta,
        setProject,
        saveSnapshot,
        forceSave,
    } = useProject();

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hasCustomKey, setHasCustomKey] = useState(false);
    const selectedModel = 'gemini-3-flash-preview-hybrid';

    const {
        progress,
        batchStats,
        cancelProcessingRef,
        handleFiles,
        fileInputRef,
    } = useOCRBatch({
        project,
        selectedModel,
        updateProjectInvoices: updateInvoices,
        onBatchComplete: forceSave,
    });

    const { auditList, metrics } = useAuditList(project, batchStats.totalDuration);

    const [isCreating, setIsCreating] = useState(false);
    const [createYear, setCreateYear] = useState(new Date().getFullYear());
    const [createMonth, setCreateMonth] = useState(new Date().getMonth() + 1);
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editYear, setEditYear] = useState(0);
    const [editMonth, setEditMonth] = useState(0);

    // Seller DB state
    const [sellerRows, setSellerRows] = useState<SellerRow[]>([]);
    const [sellerSearchQuery, setSellerSearchQuery] = useState('');
    const [sellerDbLoading, setSellerDbLoading] = useState(false);
    const [isAddingNewSeller, setIsAddingNewSeller] = useState(false);
    const [newSellerName, setNewSellerName] = useState('');
    const [newSellerTaxId, setNewSellerTaxId] = useState('');

    const erpInputRef = useRef<HTMLInputElement>(null);

    const [showRetentionBanner, setShowRetentionBanner] = useState(() =>
        !sessionStorage.getItem('retention_warned')
    );

    // Cleanup old files on startup
    useEffect(() => {
        fileStorageService.pruneOldFiles(30 * 24 * 60 * 60 * 1000).then(count => {
            if (count > 0) console.log(`Cleaned up ${count} old temporary files`);
        });

        // Check API Key
        const checkKey = async () => {
            if (window.aistudio) setHasCustomKey(await window.aistudio.hasSelectedApiKey());
        };
        checkKey();
    }, []);

    // === Early returns — after ALL hooks ===
    if (authLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <span className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
            </div>
        );
    }

    if (!currentUser) {
        return <LoginScreen onLogin={user => setCurrentUser(user)} />;
    }

    // --- Project Management Functions ---

    const confirmCreateProject = () => {
        const name = `${createYear}-${String(createMonth).padStart(2, '0')}月 進項發票`;
        createProject(name, createYear, createMonth);
        setView('WORKSPACE');
        setIsCreating(false);
    };

    const loadProject = async (id: string) => {
        const ok = await loadProjectFromHook(id, (invId, err) => {
            alert(`讀取圖片或PDF失敗 (${invId}): ${err?.name || 'Error'} - ${err?.message || '未知儲存空間錯誤。建議檢查儲存空間或隱私權設定。'}`);
        });
        if (ok) {
            setView('WORKSPACE');
        } else {
            alert("讀取專案失敗");
        }
    };

    const deleteProject = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("確定要刪除此專案嗎？\n\n・OCR 結果與稽核資料將永久刪除\n・Supabase Storage 上的原始憑證檔案也會一併刪除\n\n此操作無法復原。")) return;
        deleteProjectFromHook(id);
    };

    const startEditingProject = (p: ProjectMeta, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setEditingProjectId(p.id);
        setEditName(p.name);
        setEditYear(p.year || new Date().getFullYear());
        setEditMonth(p.month || new Date().getMonth() + 1);
    };

    const saveProjectEdit = () => {
        if (!editingProjectId || !editName.trim()) return;
        updateProjectMeta(editingProjectId, editName, editYear, editMonth);
        setEditingProjectId(null);
    };

    const loadSellerDB = async () => {
        setSellerDbLoading(true);
        const rows = await fetchAllSellerRows();
        setSellerRows(rows);
        setSellerDbLoading(false);
    };

    const handleAddNewSeller = async () => {
        if (!newSellerName.trim() || !/^\d{8}$/.test(newSellerTaxId.trim())) return;
        await upsertSeller(newSellerName.trim(), newSellerTaxId.trim(), 'manual');
        setNewSellerName('');
        setNewSellerTaxId('');
        setIsAddingNewSeller(false);
        await loadSellerDB();
    };

    const handleDeleteSeller = async (id: string) => {
        if (!confirm('確定刪除此廠商記錄？')) return;
        await deleteSeller(id);
        setSellerRows(prev => prev.filter(r => r.id !== id));
    };

    const toggleErpDiscrepancy = (voucherId: string) => {
        setProject(prev => {
            if (!prev) return null;
            return {
                ...prev,
                erpData: prev.erpData.map(erp =>
                    erp.voucher_id === voucherId
                        ? { ...erp, erp_discrepancy: !erp.erp_discrepancy }
                        : erp
                ),
            };
        });
    };

    // --- Core Features ---

    const markRetentionWarned = () => {
        if (showRetentionBanner) {
            sessionStorage.setItem('retention_warned', '1');
            setShowRetentionBanner(false);
        }
    };

    const handleERPUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        markRetentionWarned();

        const reader = new FileReader();
        reader.onload = (event) => {
            const data = event.target?.result;
            if (!data) { return; }

            let workbook;
            try { workbook = XLSX.read(data, { type: 'array' }); } catch (error) {
                alert("無法解析檔案"); return;
            }

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            const parsedRecords = parseERPRows(rows);

            if (parsedRecords.length > 0) {
                updateERP(parsedRecords);
                // Sync sellers to Supabase in background
                const sellersFromERP: Record<string, string> = {};
                parsedRecords.forEach(r => {
                    if (r.seller_name && r.seller_tax_id && /^\d{8}$/.test(r.seller_tax_id)) {
                        sellersFromERP[r.seller_name.trim()] = r.seller_tax_id.trim();
                    }
                });
                if (Object.keys(sellersFromERP).length > 0) {
                    upsertSellers(sellersFromERP, 'erp').catch(e => console.warn('[SellerDB] ERP sync failed', e));
                }
                alert(`成功匯入 ${parsedRecords.length} 筆 ERP 帳務資料`);
            } else {
                alert("無法解析檔案內容。");
            }
            if (erpInputRef.current) erpInputRef.current.value = '';
        };
        reader.readAsArrayBuffer(file);
    };


    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const handleSave = (id: string, updatedData: InvoiceData) => {
        updateInvoices(prev => {
            // OCR correction feedback loop — fire-and-forget, never throws
            const _original = prev.find(inv => inv.id === id)?.data[0];
            if (_original) {
                const TRACKED: Array<keyof InvoiceData> = [
                    'invoice_number', 'invoice_date', 'seller_name', 'seller_tax_id',
                    'buyer_tax_id', 'amount_sales', 'amount_tax', 'amount_total',
                    'tax_code', 'voucher_type',
                ];
                const diffs: OCRCorrectionRecord[] = [];
                for (const f of TRACKED) {
                    const from = String(_original[f] ?? '');
                    const to   = String(updatedData[f] ?? '');
                    if (from !== to && to) {
                        diffs.push({
                            file_id: id,
                            voucher_id: project?.erpData?.find(
                                e => id === e.voucher_id || id.startsWith(e.voucher_id + '-') || id.startsWith(e.voucher_id + '_')
                            )?.voucher_id,
                            tax_code: _original.tax_code,
                            voucher_type: _original.voucher_type ?? undefined,
                            field_name: f,
                            original_value: from || null,
                            corrected_value: to,
                        });
                    }
                }
                if (diffs.length > 0) recordOCRCorrections(diffs).catch(() => {});
            }

            return prev.map(inv => {
                if (inv.id === id) {
                    const newData = [...inv.data];
                    if (newData.length > 0) newData[0] = updatedData;
                    else newData.push(updatedData);
                    return { ...inv, data: newData };
                }
                return inv;
            });
        });
        setSelectedKey(null);
    };

    const handleDeleteOCR = (id: string) => {
        updateInvoices(prev => prev.map(inv =>
            inv.id === id
                ? { ...inv, data: [], status: 'PENDING' as const, previewUrl: '' }
                : inv
        ));
        setSelectedKey(null);
    };

    const handleReOCR = async (id: string) => {
        const entry = project?.invoices.find(inv => inv.id === id);
        if (!entry?.file) {
            alert('找不到原始檔案，請重新上傳');
            return;
        }

        updateInvoices(prev => prev.map(inv =>
            inv.id === id ? { ...inv, status: 'PENDING' as const, data: [], error: undefined } : inv
        ));
        setSelectedKey(null);

        try {
            let processedFile = entry.file;
            if (entry.file.type.startsWith('image/')) {
                try {
                    processedFile = await enhanceImageForOCR(entry.file);
                } catch (err) {
                    logger.warn('PREPROCESSING', `Re-OCR image enhancement failed: ${id}`, err);
                }
            }

            const base64 = await fileToBase64(processedFile);

            const knownSellers: Record<string, string> = {};
            project?.erpData?.forEach(erp => {
                if (erp.seller_name && erp.seller_tax_id && /^\d{8}$/.test(erp.seller_tax_id.trim())) {
                    knownSellers[erp.seller_name.trim()] = erp.seller_tax_id.trim();
                }
            });

            let expectedERP = undefined;
            const matchingErp = project?.erpData?.find(erp =>
                id === erp.voucher_id || id.startsWith(erp.voucher_id + '-') || id.startsWith(erp.voucher_id + '_')
            );
            if (matchingErp) {
                expectedERP = {
                    amount_total: matchingErp.amount_total,
                    amount_sales: matchingErp.amount_sales,
                    amount_tax: matchingErp.amount_tax,
                    invoice_numbers: matchingErp.invoice_numbers,
                };
            }

            const results = await analyzeInvoice(base64, processedFile.type, selectedModel, 0, knownSellers, expectedERP);
            updateInvoices(prev => prev.map(inv =>
                inv.id === id
                    ? { ...inv, status: results.length > 0 ? 'SUCCESS' as const : 'ERROR' as const, data: results, error: results.length > 0 ? undefined : '無法辨識發票內容' }
                    : inv
            ));
        } catch (err: any) {
            const msg = err?.message?.includes('429') ? 'API 額度已滿，請稍後再試' : (err?.message || '辨識失敗');
            updateInvoices(prev => prev.map(inv =>
                inv.id === id ? { ...inv, status: 'ERROR' as const, error: msg } : inv
            ));
        }
    };

    const exportAuditReport = () => {
        if (auditList.length === 0) return;
        const csv = buildAuditCSV(auditList, {
            projectName: project?.name ?? '',
            model: selectedModel,
            accuracy: metrics.auditCoverage,
            duration: metrics.duration,
        });
        downloadCSV(csv, `稽核報告_${project?.name}_${new Date().toISOString().split('T')[0]}.csv`);
    };

    const selectedRow = auditList.find(r => r.key === selectedKey);
    const selectedFiles = selectedRow?.files || [];
    const selectedInitialFileId = selectedRow?.file?.id;
    const selectedInitialInvoiceIndex = selectedRow?.initialInvoiceIndex;

    // --- Views ---

    if (view === 'ADMIN') {
        return <AdminPage currentUser={currentUser} onBack={() => setView('PROJECT_LIST')} />;
    }

    if (view === 'ERROR_REVIEW' && project) {
        return (
            <ErrorReviewPage
                project={project}
                auditList={auditList}
                onBack={() => setView('WORKSPACE')}
                onUpdateInvoice={handleSave}
                onToggleErpDiscrepancy={toggleErpDiscrepancy}
            />
        );
    }

    if (view === 'SELLER_DB') {
        const sourceBadge = (source: string) => {
            const map: Record<string, string> = {
                ocr: 'bg-blue-50 text-blue-600',
                erp: 'bg-emerald-50 text-emerald-600',
                manual: 'bg-gray-100 text-gray-500',
            };
            return map[source] || 'bg-gray-100 text-gray-500';
        };
        const filtered = sellerRows.filter(r =>
            r.seller_name.includes(sellerSearchQuery) || r.seller_tax_id.includes(sellerSearchQuery)
        );
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
                <div className="w-full max-w-4xl">
                    <div className="flex justify-between items-center mb-8">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setView('PROJECT_LIST')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                                <ArrowLeftRight className="w-5 h-5" />
                            </button>
                            <div>
                                <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                                    <Database className="w-6 h-6 text-indigo-600" /> 廠商資料庫
                                </h1>
                                <p className="text-gray-500 text-sm mt-0.5">OCR 自動累積 · ERP 匯入同步 · 手動維護</p>
                            </div>
                        </div>
                        <button onClick={() => setIsAddingNewSeller(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all active:scale-95 text-sm">
                            <Plus className="w-4 h-4" /> 手動新增
                        </button>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-4 border-b border-gray-100">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="搜尋廠商名稱或統一編號..."
                                    value={sellerSearchQuery}
                                    onChange={e => setSellerSearchQuery(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 transition-colors"
                                />
                            </div>
                        </div>

                        {sellerDbLoading ? (
                            <div className="p-16 text-center text-gray-400">
                                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
                                載入中...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="p-16 text-center">
                                <Database className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                                <p className="text-gray-400 font-medium">{sellerSearchQuery ? '找不到符合的廠商' : '尚無廠商資料'}</p>
                                <p className="text-gray-300 text-sm mt-1">OCR 辨識後會自動新增</p>
                            </div>
                        ) : (
                            <div>
                                <div className="grid grid-cols-[1fr_120px_80px_56px] gap-x-4 px-6 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                                    <span>廠商名稱</span>
                                    <span>統一編號</span>
                                    <span>來源</span>
                                    <span></span>
                                </div>
                                <div className="divide-y divide-gray-50">
                                    {filtered.map(r => (
                                        <div key={r.id} className="grid grid-cols-[1fr_120px_80px_56px] gap-x-4 items-center px-6 py-3.5 hover:bg-gray-50 transition-colors">
                                            <span className="font-medium text-gray-800 text-sm truncate">{r.seller_name}</span>
                                            <span className="font-mono text-sm text-gray-600">{r.seller_tax_id}</span>
                                            <span className={`text-xs font-bold px-2 py-1 rounded-lg w-fit ${sourceBadge(r.source)}`}>{r.source}</span>
                                            <button onClick={() => handleDeleteSeller(r.id)} className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
                                    共 {filtered.length} 筆{sellerSearchQuery ? `（篩選自 ${sellerRows.length} 筆）` : ''}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {isAddingNewSeller && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
                            <h3 className="text-lg font-black text-gray-800 mb-5 flex items-center gap-2">
                                <Plus className="w-5 h-5 text-indigo-600" /> 手動新增廠商
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">廠商名稱</label>
                                    <input autoFocus type="text" value={newSellerName} onChange={e => setNewSellerName(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-2.5 font-medium text-sm focus:border-indigo-500 outline-none transition-colors" placeholder="例：惠成工業股份有限公司" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">統一編號（8碼）</label>
                                    <input type="text" value={newSellerTaxId} onChange={e => setNewSellerTaxId(e.target.value)} maxLength={8} className="w-full border-2 border-gray-100 rounded-xl px-4 py-2.5 font-mono font-bold text-sm focus:border-indigo-500 outline-none transition-colors" placeholder="12345678" />
                                    {newSellerTaxId && !/^\d{8}$/.test(newSellerTaxId) && (
                                        <p className="text-rose-500 text-xs mt-1">必須是 8 位數字</p>
                                    )}
                                </div>
                            </div>
                            <div className="mt-6 flex gap-3">
                                <button onClick={() => { setIsAddingNewSeller(false); setNewSellerName(''); setNewSellerTaxId(''); }} className="flex-1 py-2.5 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors text-sm">取消</button>
                                <button onClick={handleAddNewSeller} disabled={!newSellerName.trim() || !/^\d{8}$/.test(newSellerTaxId)} className="flex-1 py-2.5 font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors text-sm">新增</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (view === 'PROJECT_LIST') {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
                <div className="w-full max-w-4xl">
                    <div className="flex justify-between items-center mb-8">
                        <div>
                            <h1 className="text-3xl font-black text-gray-800 tracking-tight flex items-center gap-3">
                                <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200"><Lucide.ShieldCheck className="w-8 h-8 text-white" /></div>
                                Taiwan Invoice Audit Pro
                            </h1>
                            <p className="text-gray-500 mt-2 font-medium">請選擇或建立月份稽核專案</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border border-gray-200 px-4 py-2.5 rounded-xl">
                                <span className="text-gray-700">{currentUser.email}</span>
                                {currentUser.is_admin && <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-1.5 py-0.5 rounded">ADMIN</span>}
                            </div>
                            {currentUser.is_admin && (
                                <button onClick={() => setView('ADMIN')} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2.5 rounded-xl font-bold shadow-sm flex items-center gap-2 transition-all active:scale-95">
                                    <Users className="w-4 h-4" /> 使用者管理
                                </button>
                            )}
                            <button onClick={() => { setView('SELLER_DB'); loadSellerDB(); }} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-5 py-3 rounded-xl font-bold shadow-sm flex items-center gap-2 transition-all active:scale-95">
                                <Database className="w-4 h-4" /> 廠商資料庫
                            </button>
                            <button onClick={() => setIsCreating(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all active:scale-95">
                                <PlusSquare className="w-5 h-5" /> 建立新專案
                            </button>
                            <button onClick={() => clearSession().then(() => setCurrentUser(null))} className="p-3 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors" title="登出">
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        {projectList.length === 0 ? (
                            <div className="p-16 text-center">
                                <FolderOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                                <h3 className="text-lg font-bold text-gray-700">尚無專案</h3>
                                <p className="text-gray-400 mb-6">建立您的第一個稽核專案以開始使用</p>
                                <button onClick={() => setIsCreating(true)} className="px-6 py-2 bg-indigo-50 text-indigo-600 font-bold rounded-lg hover:bg-indigo-100 transition-colors">立即建立</button>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {projectList.map(p => (
                                    <div key={p.id} onClick={() => loadProject(p.id)} onDoubleClick={(e) => startEditingProject(p, e)} className="p-6 flex items-center justify-between hover:bg-gray-50 cursor-pointer group transition-colors">
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className="bg-blue-50 p-3 rounded-lg text-blue-600 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                                                <FolderOpen className="w-6 h-6" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-gray-800 text-lg group-hover:text-indigo-600 transition-colors">{p.name}</h3>
                                                    {p.year && p.month && (
                                                        <span className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg text-xs font-mono font-bold">
                                                            {p.year}-{String(p.month).padStart(2, '0')}
                                                        </span>
                                                    )}
                                                    {(() => {
                                                        const days = getDaysRemaining(p.updatedAt);
                                                        if (days > 30) return null;
                                                        return (
                                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                                                days <= 7
                                                                    ? 'bg-red-100 text-red-700'
                                                                    : 'bg-amber-100 text-amber-700'
                                                            }`}>
                                                                {days <= 0 ? '即將到期' : `${days} 天後到期`}
                                                            </span>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-gray-400 mt-1 font-mono">
                                                    <span>最後更新: {new Date(p.updatedAt).toLocaleDateString()}</span>
                                                    <span>•</span>
                                                    <span>ERP: {p.erpCount} 筆</span>
                                                    <span>•</span>
                                                    <span>已辨識: {p.invoiceCount} 筆</span>
                                                </div>
                                                <span className="text-[11px] text-gray-300 mt-1">雙擊可編輯專案</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <button onClick={(e) => deleteProject(p.id, e)} className="p-2 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                                                <Trash2 className="w-5 h-5" />
                                            </button>
                                            <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-indigo-400" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {isCreating && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
                            <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                <Calendar className="w-6 h-6 text-indigo-600" />
                                建立新月份稽核
                            </h3>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">年度 (Year)</label>
                                    <input type="number" value={createYear} onChange={e => setCreateYear(parseInt(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-mono font-bold text-xl text-center focus:border-indigo-500 outline-none transition-colors text-gray-700" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">月份 (Month)</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => setCreateMonth(m)}
                                                className={`py-2.5 rounded-xl font-bold text-sm transition-all ${createMonth === m ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                                            >
                                                {m}月
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex gap-3">
                                <button onClick={() => setIsCreating(false)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">取消</button>
                                <button onClick={confirmCreateProject} className="flex-1 py-3 font-bold bg-indigo-600 text-white rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-colors">建立專案</button>
                            </div>
                        </div>
                    </div>
                )}

                {editingProjectId && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
                            <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                                <Edit3 className="w-6 h-6 text-indigo-600" />
                                編輯專案
                            </h3>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">專案名稱</label>
                                    <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-base focus:border-indigo-500 outline-none transition-colors text-gray-700" placeholder="輸入專案名稱" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">年度 (Year)</label>
                                    <input type="number" value={editYear} onChange={e => setEditYear(parseInt(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-mono font-bold text-xl text-center focus:border-indigo-500 outline-none transition-colors text-gray-700" />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">月份 (Month)</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => setEditMonth(m)}
                                                className={`py-2.5 rounded-xl font-bold text-sm transition-all ${editMonth === m ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                                            >
                                                {m}月
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex gap-3">
                                <button onClick={() => setEditingProjectId(null)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">取消</button>
                                <button onClick={saveProjectEdit} className="flex-1 py-3 font-bold bg-indigo-600 text-white rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-colors">保存</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col font-sans text-gray-800">
            <div className="sticky top-0 z-40 bg-white shadow-sm transition-all duration-200">
                <header className="bg-white border-b relative">
                    <div className="max-w-[1920px] mx-auto px-4 h-16 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <button onClick={() => setView('PROJECT_LIST')} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-800 transition-colors" title="返回專案列表">
                                <ArrowLeftRight className="w-5 h-5" />
                            </button>
                            <div className="h-6 w-px bg-gray-200"></div>
                            <div>
                                <div className="flex items-center gap-2 cursor-pointer group" onDoubleClick={() => project && startEditingProject({
                                    id: project.id,
                                    name: project.name,
                                    updatedAt: project.updatedAt,
                                    invoiceCount: project.invoices.length,
                                    erpCount: project.erpData.length,
                                    year: project.year,
                                    month: project.month
                                })} title="雙擊可編輯">
                                    <h1 className="text-base font-black text-gray-900 tracking-tight group-hover:text-indigo-600 transition-colors">{project?.name}</h1>
                                    {project?.year && project?.month && (
                                        <span className="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg text-xs font-mono font-bold">
                                            {project.year}-{String(project.month).padStart(2, '0')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    {project && <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold">ERP: {project.erpData.length} | OCR: {project.invoices.length}</span>}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {project?.invoices.some(inv => inv.status === 'PENDING') && (
                                <button
                                    onClick={() => {
                                        const pendingFiles = project.invoices.filter(inv => inv.status === 'PENDING' && inv.file).map(inv => inv.file);
                                        if (pendingFiles.length > 0) handleFiles(pendingFiles);
                                    }}
                                    className="btn-sm bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 font-bold px-3 py-1 flex items-center gap-1.5 shadow-sm"
                                    title={`發現 ${project.invoices.filter(inv => inv.status === 'PENDING').length} 筆未解析憑證。點擊以繼續解析。`}
                                >
                                    <Lucide.Play className="w-4 h-4" /> 繼續解析 ({project.invoices.filter(inv => inv.status === 'PENDING').length} 筆)
                                </button>
                            )}
                            <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1.5">
                                ⚡ 多重解析策略
                            </span>
                            <div className="h-4 w-px bg-gray-200 mx-1"></div>
                            <button onClick={() => erpInputRef.current?.click()} className="btn-sm btn-blue">
                                <Lucide.FileSpreadsheet className="w-3.5 h-3.5" /> 匯入 ERP
                            </button>
                            <input type="file" ref={erpInputRef} className="hidden" accept=".csv, .xlsx, .xls" onChange={handleERPUpload} />

                            <button onClick={() => fileInputRef.current?.click()} className="btn-sm btn-indigo">
                                <Lucide.Upload className="w-3.5 h-3.5" /> 上傳/補件 (OCR)
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,application/pdf,image/tiff,.tif,.tiff" onChange={(e) => { if (e.target.files) { markRetentionWarned(); handleFiles(e.target.files); } }} />

                            <div className="h-4 w-px bg-gray-200 mx-1"></div>


                            <div className="h-4 w-px bg-gray-200 mx-1"></div>
                            <button onClick={() => setView('ERROR_REVIEW')} className="btn-sm bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 hover:border-rose-300 shadow-sm font-bold">
                                <Lucide.AlertOctagon className="w-3.5 h-3.5" /> 異常檢核
                            </button>
                        </div>
                    </div>
                    {/* Progress Bar */}
                    {progress.status !== 'IDLE' && (
                        <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-100">
                            <div
                                className={`h-full transition-all duration-300 ${progress.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            ></div>
                        </div>
                    )}
                </header>
                <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-1 flex items-center justify-between text-xs">
                    <CostDashboard project={project} auditCoverage={metrics.auditCoverage} discrepancyCount={metrics.discrepancyCount} modelName={selectedModel} totalDuration={metrics.duration} uploaded={metrics.uploaded} missing={metrics.missing} total={metrics.total} proEscalatedCount={metrics.proEscalatedCount} proEscalationRate={metrics.proEscalationRate} />
                    {progress.status !== 'IDLE' && (
                        <div className="flex items-center gap-3">
                            <span className="font-mono font-bold text-indigo-600 flex items-center gap-2">
                                {progress.status === 'PROCESSING' && <Loader2 className="w-3 h-3 animate-spin" />}
                                Processing: {progress.current} / {progress.total}
                            </span>
                            {progress.status === 'PROCESSING' && (
                                <button
                                    onClick={() => {
                                        cancelProcessingRef.current = true;
                                    }}
                                    className="px-2 py-0.5 bg-white border border-rose-200 text-rose-500 rounded text-[10px] font-bold hover:bg-rose-50 flex items-center gap-1 shadow-sm transition-colors"
                                >
                                    <Lucide.Square className="w-2.5 h-2.5" /> 停止解析
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showRetentionBanner && (
                <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-3">
                    <Lucide.Clock className="w-4 h-4 text-amber-600 shrink-0" />
                    <p className="text-sm text-amber-800">
                        <span className="font-bold">檔案保留提醒：</span>
                        上傳的原始憑證（PDF/圖片）將在 60 天後自動刪除，OCR 結果與專案資料保留 90 天。
                    </p>
                    <button
                        onClick={() => {
                            sessionStorage.setItem('retention_warned', '1');
                            setShowRetentionBanner(false);
                        }}
                        className="ml-auto text-amber-600 hover:text-amber-800 p-1 rounded"
                    >
                        <Lucide.X className="w-4 h-4" />
                    </button>
                </div>
            )}
            <main className="max-w-[1920px] mx-auto w-full px-2 py-4 flex-1 overflow-hidden flex flex-col">
                {!project || (project.erpData.length === 0 && project.invoices.length === 0) ? (
                    <div className="h-[60vh] flex flex-col items-center justify-center text-center">
                        <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4 border-4 border-white shadow-xl"><Lucide.LayoutDashboard className="w-8 h-8 text-indigo-600 opacity-50" /></div>
                        <h2 className="text-xl font-black text-gray-800 mb-1">專案已建立</h2>
                        <p className="text-gray-400 text-xs mb-6">請匯入 ERP Excel 或直接上傳憑證開始工作</p>
                        <div className="flex gap-3">
                            <button onClick={() => erpInputRef.current?.click()} className="px-5 py-2 bg-white border border-gray-300 rounded-lg text-gray-600 font-bold hover:border-blue-500 hover:text-blue-600 transition-colors text-sm shadow-sm flex items-center gap-2"><Lucide.FileSpreadsheet className="w-4 h-4" /> 1. 匯入 Excel</button>
                            <button onClick={() => fileInputRef.current?.click()} className="px-5 py-2 bg-white border border-gray-300 rounded-lg text-gray-600 font-bold hover:border-indigo-500 hover:text-indigo-600 transition-colors text-sm shadow-sm flex items-center gap-2"><Lucide.Upload className="w-4 h-4" /> 2. 上傳憑證</button>
                        </div>
                    </div>
                ) : (
                    <AuditTable
                        auditList={auditList}
                        selectedKey={selectedKey}
                        onRowClick={setSelectedKey}
                        onReprocess={(file) => handleFiles([file])}
                        onToggleErpFlag={toggleErpFlag}
                        project={project}
                    />
                )
                }
            </main >
            <style>{`
        .btn-sm { @apply flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-all shadow-sm text-xs; }
        .btn-white { @apply border border-gray-200 bg-white text-gray-600 hover:bg-gray-50; }
        .btn-blue { @apply bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100; }
        .btn-indigo { @apply bg-indigo-600 text-white hover:bg-indigo-700 border border-transparent; }
      `}</style>
            {selectedKey && <InvoiceEditor entries={selectedFiles} initialEntryId={selectedInitialFileId} initialInvoiceIndex={selectedInitialInvoiceIndex} erpRecord={selectedRow?.erp} auditStatus={selectedRow?.auditStatus} diffDetails={selectedRow?.diffDetails} onSave={handleSave} onDelete={handleDeleteOCR} onReOCR={handleReOCR} onClose={() => setSelectedKey(null)} />}

            {editingProjectId && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
                        <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
                            <Edit3 className="w-6 h-6 text-indigo-600" />
                            編輯專案
                        </h3>
                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">專案名稱</label>
                                <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveProjectEdit(); if (e.key === 'Escape') setEditingProjectId(null); }} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-base focus:border-indigo-500 outline-none transition-colors text-gray-700" placeholder="輸入專案名稱" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">年度 (Year)</label>
                                <input type="number" value={editYear} onChange={e => setEditYear(parseInt(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-mono font-bold text-xl text-center focus:border-indigo-500 outline-none transition-colors text-gray-700" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">月份 (Month)</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                                        <button key={m} onClick={() => setEditMonth(m)} className={`py-2.5 rounded-xl font-bold text-sm transition-all ${editMonth === m ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>{m}月</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="mt-8 flex gap-3">
                            <button onClick={() => setEditingProjectId(null)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">取消</button>
                            <button onClick={saveProjectEdit} className="flex-1 py-3 font-bold bg-indigo-600 text-white rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-colors">保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default App;
