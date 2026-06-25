
import React, { useState, useRef, useEffect } from 'react';
import { Loader2, CheckCircle2, Edit3, Trash2, PlusSquare, ArrowLeftRight, UploadCloud, FolderOpen, ChevronRight, Calendar, Database, Search, Plus, LogOut, Users } from 'lucide-react';
import { analyzeInvoice } from './services/geminiService';
import { enhanceImageForOCR } from './src/lib/imageEnhancement';
import { InvoiceData, ProjectMeta } from './types';
import ErrorReviewPage from './components/ErrorReviewPage';
import * as XLSX from 'xlsx';
import { useProject } from './src/hooks/useProject';
import { useOCRBatch } from './src/hooks/useOCRBatch';
import { useAuth } from './src/hooks/useAuth';
import ProjectListPage from './src/pages/ProjectListPage';
import SellerDBPage from './src/pages/SellerDBPage';
import WorkspacePage from './src/pages/WorkspacePage';
import AuthPage from './src/pages/AuthPage';

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
    } = useProject(currentUser?.id);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hasCustomKey, setHasCustomKey] = useState(false);
    const selectedModel = 'gemini-3-flash-preview-hybrid';

    const { progress, batchStats, cancelProcessingRef, handleFiles, fileInputRef } = useOCRBatch({
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

    // For ProjectListPage / WorkspacePage edit modal compatibility
    const [editingProject, setEditingProject] = useState<ProjectMeta | null>(null);

    // Cleanup old files on startup
    useEffect(() => {
        fileStorageService.pruneOldFiles(30 * 24 * 60 * 60 * 1000).then(count => {
            if (count > 0) console.log(`Cleaned up ${count} old temporary files`);
        });
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

    const handleCreateProject = (year: number, month: number) => {
        const name = `${year}-${String(month).padStart(2, '0')}月 進項發票`;
        createProject(name, year, month);
        setView('WORKSPACE');
    };

    const loadProject = async (id: string) => {
        const ok = await loadProjectFromHook(id, (invId, err) => {
            alert(`讀取圖片或PDF失敗 (${invId}): ${err?.name || 'Error'} - ${err?.message || '未知儲存空間錯誤。建議檢查儲存空間或隱私權設定。'}`);
        });
        if (ok) setView('WORKSPACE');
        else alert("讀取專案失敗");
    };

    const deleteProject = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("確定要刪除此專案嗎？\n\n・OCR 結果與稽核資料將永久刪除\n・Supabase Storage 上的原始憑證檔案也會一併刪除\n\n此操作無法復原。")) return;
        deleteProjectFromHook(id);
    };

    const startEditingProject = (p: ProjectMeta) => {
        setEditingProject(p);
    };

    const saveProjectEdit = (id: string, name: string, year: number, month: number) => {
        updateProjectMeta(id, name, year, month);
        setEditingProject(null);
    };

    const cancelProjectEdit = () => setEditingProject(null);

    // --- Core Features ---

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
            if (!data) return;

            let workbook;
            try { workbook = XLSX.read(data, { type: 'array' }); } catch {
                alert("無法解析檔案"); return;
            }

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            const parsedRecords = parseERPRows(rows);

            if (parsedRecords.length > 0) {
                updateERP(parsedRecords);
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
        if (!entry?.file) { alert('找不到原始檔案，請重新上傳'); return; }

        updateInvoices(prev => prev.map(inv =>
            inv.id === id ? { ...inv, status: 'PENDING' as const, data: [], error: undefined } : inv
        ));
        setSelectedKey(null);

        try {
            let processedFile = entry.file;
            if (entry.file.type.startsWith('image/')) {
                try { processedFile = await enhanceImageForOCR(entry.file); }
                catch (err) { logger.warn('PREPROCESSING', `Re-OCR image enhancement failed: ${id}`, err); }
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

    const selectedRow = auditList.find(r => r.key === selectedKey) ?? null;
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
        return <SellerDBPage onBack={() => setView('PROJECT_LIST')} />;
    }

    if (view === 'PROJECT_LIST') {
        return (
            <ProjectListPage
                projectList={projectList}
                onLoadProject={loadProject}
                onDeleteProject={deleteProject}
                onOpenSellerDB={() => setView('SELLER_DB')}
                onCreateProject={handleCreateProject}
                editingProject={editingProject}
                onStartEditing={startEditingProject}
                onSaveEdit={saveProjectEdit}
                onCancelEdit={cancelProjectEdit}
                userEmail={currentUser.email}
                onSignOut={() => clearSession().then(() => setCurrentUser(null))}
            />
        );
    }

    return (
        <WorkspacePage
            project={project}
            selectedModel={selectedModel}
            progress={progress}
            batchStats={batchStats}
            cancelProcessingRef={cancelProcessingRef}
            handleFiles={handleFiles}
            fileInputRef={fileInputRef}
            erpInputRef={erpInputRef}
            onERPUpload={handleERPUpload}
            auditList={auditList}
            metrics={metrics}
            selectedKey={selectedKey}
            onRowClick={setSelectedKey}
            selectedRow={selectedRow}
            selectedFiles={selectedFiles}
            selectedInitialFileId={selectedInitialFileId}
            selectedInitialInvoiceIndex={selectedInitialInvoiceIndex}
            onSave={handleSave}
            onDeleteOCR={handleDeleteOCR}
            onReOCR={handleReOCR}
            onToggleErpFlag={toggleErpFlag}
            onBack={() => setView('PROJECT_LIST')}
            onGoToErrorReview={() => setView('ERROR_REVIEW')}
            editingProject={editingProject}
            onStartEditing={startEditingProject}
            onSaveEdit={saveProjectEdit}
            onCancelEdit={cancelProjectEdit}
        />
    );
};

export default App;
