
import React, { useState, useRef, useEffect } from 'react';
import { analyzeInvoice } from './services/geminiService';
import { enhanceImageForOCR } from './src/lib/imageEnhancement';
import { InvoiceData, ProjectMeta } from './types';
import ErrorReviewPage from './components/ErrorReviewPage';
import * as XLSX from 'xlsx';
import { useProject } from './src/hooks/useProject';
import { useOCRBatch } from './src/hooks/useOCRBatch';
import { useAuth } from './src/hooks/useAuth';
import { fileStorageService } from './services/fileStorageService';
import { upsertSellers } from './services/supabaseService';
import { logger } from './services/loggerService';
import { useAuditList } from './src/hooks/useAuditList';
import { buildAuditCSV, downloadCSV } from './src/lib/csvExport';
import { parseERPRows } from './src/lib/erpParser';
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

const App: React.FC = () => {
    const { user, loading: authLoading, signOut } = useAuth();
    const [view, setView] = useState<'PROJECT_LIST' | 'WORKSPACE' | 'ERROR_REVIEW' | 'SELLER_DB'>('PROJECT_LIST');
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
    } = useProject(user?.id);

    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hasCustomKey, setHasCustomKey] = useState(false);
    const selectedModel = 'gemini-3-flash-preview-hybrid';

    const { progress, batchStats, cancelProcessingRef, handleFiles, fileInputRef } = useOCRBatch({
        project,
        selectedModel,
        updateProjectInvoices: updateInvoices,
    });

    const [editingProject, setEditingProject] = useState<ProjectMeta | null>(null);

    const erpInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Throttle file pruning to once per week — running every load risks deleting
        // files that haven't been re-uploaded to cloud storage yet.
        const PRUNE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
        const lastPrune = parseInt(localStorage.getItem('_lastFilesPruneTime') || '0');
        if (Date.now() - lastPrune > PRUNE_INTERVAL_MS) {
            fileStorageService.pruneOldFiles(30 * 24 * 60 * 60 * 1000).then(count => {
                if (count > 0) console.log(`Cleaned up ${count} old temporary files`);
                localStorage.setItem('_lastFilesPruneTime', Date.now().toString());
            });
        }
        const checkKey = async () => {
            if (window.aistudio) setHasCustomKey(await window.aistudio.hasSelectedApiKey());
        };
        checkKey();
    }, []);

    // Flush latest project state to localStorage before page unload (closes the
    // 10-second auto-save gap; cloud sync is async so only localStorage gets flushed).
    useEffect(() => {
        const handleBeforeUnload = () => {
            if (project) saveSnapshot(project);
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [project, saveSnapshot]);

    // --- Project Management ---

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
        if (!confirm("確定要刪除此專案嗎？所有資料將無法復原。")) return;
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

    const handleERPUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

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
        updateInvoices(prev => prev.map(inv => {
            if (inv.id === id) {
                const newData = [...inv.data];
                if (newData.length > 0) newData[0] = updatedData;
                else newData.push(updatedData);
                return { ...inv, data: newData };
            }
            return inv;
        }));
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

    const { auditList, metrics } = useAuditList(project, batchStats.totalDuration);

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

    if (authLoading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-gray-400">
                    <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium">載入中...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return <AuthPage />;
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
                userEmail={user.email}
                onSignOut={signOut}
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
