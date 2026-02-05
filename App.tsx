
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Loader2, AlertCircle, CheckCircle2, Edit3, Trash2, FileSearch, Key, PlusSquare, FileDown, Clock, FileText, FileSpreadsheet, ArrowLeftRight, AlertTriangle, ArrowRight, UploadCloud, FolderOpen, ChevronRight, LogOut, Calendar } from 'lucide-react';
import { analyzeInvoice } from './services/geminiService';
import { preprocessImageForOCR } from './utils/imagePreprocessing';
import { InvoiceData, AppStatus, InvoiceEntry, Project, ERPRecord, ProjectMeta, ProcessingState } from './types';
import InvoiceEditor from './components/InvoiceEditor';
import ErrorReviewPage from './components/ErrorReviewPage';
import CostDashboard from './components/CostDashboard';
import * as Lucide from 'lucide-react';
import * as XLSX from 'xlsx';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window { aistudio?: AIStudio; }
}

import { fileStorageService } from './services/fileStorageService';
import { logger } from './services/loggerService';

const BUYER_TAX_ID_REQUIRED = "16547744";

const App: React.FC = () => {
    const [view, setView] = useState<'PROJECT_LIST' | 'WORKSPACE' | 'ERROR_REVIEW'>('PROJECT_LIST');
    const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [progress, setProgress] = useState<ProcessingState>({ current: 0, total: 0, status: 'IDLE' });
    const [project, setProject] = useState<Project | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hasCustomKey, setHasCustomKey] = useState(false);
    const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-pro');
    const [batchStats, setBatchStats] = useState({ startTime: 0, endTime: 0, totalDuration: 0 });

    const [isCreating, setIsCreating] = useState(false);
    const [createYear, setCreateYear] = useState(new Date().getFullYear());
    const [createMonth, setCreateMonth] = useState(new Date().getMonth() + 1);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const erpInputRef = useRef<HTMLInputElement>(null);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isDirtyRef = useRef(false);
    const latestProjectRef = useRef<Project | null>(null);

    // Keep ref in sync
    useEffect(() => {
        latestProjectRef.current = project;
        if (project) {
            isDirtyRef.current = true;
        }
    }, [project]);

    // Cleanup old files on startup & Setup Auto-Save
    useEffect(() => {
        // Prune files older than 24 hours (configurable)
        fileStorageService.pruneOldFiles(24 * 60 * 60 * 1000).then(count => {
            if (count > 0) console.log(`Cleaned up ${count} old temporary files`);
        });

        // Auto-save interval (10 seconds)
        const interval = setInterval(() => {
            if (isDirtyRef.current && latestProjectRef.current) {
                saveProjectSnapshot(latestProjectRef.current);
                isDirtyRef.current = false;
            }
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    // Load project list on startup
    useEffect(() => {
        const storedList = localStorage.getItem('project_list');
        if (storedList) {
            setProjectList(JSON.parse(storedList));
        }

        // Check API Key
        const checkKey = async () => {
            if (window.aistudio) setHasCustomKey(await window.aistudio.hasSelectedApiKey());
        };
        checkKey();
    }, []);



    // --- Project Management Functions ---

    const saveProjectSnapshot = (proj: Project) => {
        console.log('Auto-saving project...', new Date().toISOString());
        // 1. Save specific project data (Images excluded implicitly by JSON.stringify of File objects)
        const serializableProject = {
            ...proj,
            updatedAt: new Date().toISOString(),
            invoices: proj.invoices.map(inv => ({
                ...inv,
                file: { name: inv.file.name, type: inv.file.type }, // Only keep metadata
                previewUrl: '', // Clear blob URLs
            })),
        };
        localStorage.setItem(`project_${proj.id}`, JSON.stringify(serializableProject));

        // 2. Update Metadata List
        setProjectList(prev => {
            const newList = prev.filter(p => p.id !== proj.id);
            const meta: ProjectMeta = {
                id: proj.id,
                name: proj.name,
                updatedAt: new Date().toISOString(),
                invoiceCount: proj.invoices.length,
                erpCount: proj.erpData.length
            };
            const updatedList = [meta, ...newList];
            localStorage.setItem('project_list', JSON.stringify(updatedList));
            return updatedList;
        });
    };

    const confirmCreateProject = () => {
        const name = `${createYear}-${String(createMonth).padStart(2, '0')}月 進項發票`;

        const newProj: Project = {
            id: `proj_${Date.now()}`,
            name: name,
            invoices: [],
            erpData: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        setProject(newProj);
        setProject(newProj);
        saveProjectSnapshot(newProj);
        setView('WORKSPACE');
        setIsCreating(false);
    };

    const loadProject = (id: string) => {
        const data = localStorage.getItem(`project_${id}`);
        if (data) {
            const loaded: Project = JSON.parse(data);
            // Rehydrate File objects (mock files, real content needs re-upload)
            loaded.invoices = loaded.invoices.map((inv: any) => ({
                ...inv,
                file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }),
                previewUrl: '' // Empty until re-uploaded
            }));
            setProject(loaded);

            // Async rehydrate DB files
            const rehydrateImages = async () => {
                const updatedInvoices = await Promise.all(loaded.invoices.map(async (inv: any) => {
                    const dbFile = await fileStorageService.getFile(inv.id);
                    if (dbFile) {
                        return {
                            ...inv,
                            file: dbFile,
                            previewUrl: URL.createObjectURL(dbFile)
                        };
                    }
                    return {
                        ...inv,
                        file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }),
                        previewUrl: ''
                    };
                }));
                // Silent update to avoid triggering full re-render loop issues
                setProject(prev => prev ? { ...prev, invoices: updatedInvoices } : null);
            };
            rehydrateImages();

            setView('WORKSPACE');
        } else {
            alert("讀取專案失敗");
        }
    };

    const deleteProject = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("確定要刪除此專案嗎？所有資料將無法復原。")) return;

        localStorage.removeItem(`project_${id}`);
        const newList = projectList.filter(p => p.id !== id);
        setProjectList(newList);
        localStorage.setItem('project_list', JSON.stringify(newList));
    };

    const updateProjectInvoices = (updater: (prevInvoices: InvoiceEntry[]) => InvoiceEntry[]) => {
        setProject(prev => {
            if (!prev) return null;
            return { ...prev, invoices: updater(prev.invoices) };
        });
        // Note: We removed immediate saveCurrentProject call. It is now handled by the 10s interval.
    };

    const updateProjectERP = (records: ERPRecord[]) => {
        setProject(prev => {
            if (!prev) return null;
            const updated = { ...prev, erpData: records };
            // For ERP Upload, we can save immediately as it's a one-time big action
            setTimeout(() => saveProjectSnapshot(updated), 100);
            return updated;
        });
    };

    // --- Core Features ---

    const handleERPUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus(AppStatus.PROCESSING);
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = event.target?.result;
            if (!data) { setStatus(AppStatus.IDLE); return; }

            let workbook;
            try { workbook = XLSX.read(data, { type: 'array' }); } catch (error) {
                alert("無法解析檔案"); setStatus(AppStatus.IDLE); return;
            }

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

            const parsedRecords: ERPRecord[] = [];
            let headerMap: Record<string, number> | null = null;
            let headerMatchQuality: Record<string, number> = {};

            // Keywords ordered by specificity (most specific first)
            const keyMap = {
                voucher_id: ['傳票編號', '傳票號碼', '單號', 'Voucher', '傳票', 'NO.', '帳款單號'],
                invoice_number: ['發票號碼', '發票編號', 'Invoice No', '發票', '多發票號碼'],
                invoice_date: ['發票日期', '日期', 'Date'],
                seller_name: ['廠商名稱', '廠商', 'Vendor', '客戶名稱', '摘要'],
                seller_tax_id: ['統一編號', '統編', 'Tax ID'],
                amount_sales: ['未稅金額(本幣)(查詢 1 與 fin_apb)', '未稅金額', '銷售額', 'Sales Amount', '未稅'],
                amount_tax: ['稅額(本幣)(查詢 1 與 fin_apb)', '稅額', '營業稅', 'Tax Amount', '稅金', '稅額(本幣)'],
                amount_total: ['含稅金額(本幣)(查詢 1 與 fin_apb)', '含稅金額', '總額', '總計', 'Total Amount', '金額', '本幣借方金額']
            };

            const fixedIndices = { voucher_id: 1, invoice_date: 2, seller_name: 8, invoice_number: 10, seller_tax_id: 11, amount_sales: 13, amount_tax: 14, amount_total: 15 };

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!headerMap) {
                    const rowStr = row.map(c => String(c).trim());
                    // Look for '帳款單號' or '傳票編號' to identify header row
                    if (rowStr.some(s => keyMap.voucher_id.some(k => s.includes(k)))) {
                        headerMap = {};
                        headerMatchQuality = {};

                        rowStr.forEach((col, idx) => {
                            for (const [key, keywords] of Object.entries(keyMap)) {
                                // Find the index of the matching keyword (0 is highest priority)
                                const matchIndex = keywords.findIndex(k => col.includes(k));

                                if (matchIndex !== -1) {
                                    // If we haven't matched this key yet, OR if this match is better (lower index) than previous
                                    const currentBest = headerMatchQuality[key] ?? 999;
                                    if (matchIndex < currentBest) {
                                        headerMap![key] = idx;
                                        headerMatchQuality[key] = matchIndex;
                                    }
                                }
                            }
                        });
                        continue;
                    }
                }
                const getIdx = (key: keyof typeof fixedIndices) => headerMap ? (headerMap[key] ?? -1) : fixedIndices[key];
                const getVal = (idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : undefined;
                const voucherIdRaw = getVal(getIdx('voucher_id'));

                if (voucherIdRaw && String(voucherIdRaw).trim() !== '') {
                    const vId = String(voucherIdRaw).trim();
                    if (keyMap.voucher_id.some(k => vId.includes(k))) continue;
                    const parseAmount = (val: any) => {
                        if (typeof val === 'number') return val;
                        if (typeof val === 'string') return parseFloat(val.replace(/,/g, '').trim()) || 0;
                        return 0;
                    };

                    // Handle multiple invoice numbers in one column (split by space, comma, slash)
                    const invRaw = getVal(getIdx('invoice_number'));
                    const invStr = invRaw ? String(invRaw) : '';
                    const invArray = invStr.split(/[\s,、;/]+/).filter(Boolean);

                    parsedRecords.push({
                        voucher_id: vId,
                        invoice_date: String(getVal(getIdx('invoice_date')) || ''),
                        invoice_numbers: invArray,
                        seller_name: String(getVal(getIdx('seller_name')) || ''),
                        seller_tax_id: String(getVal(getIdx('seller_tax_id')) || ''),
                        amount_sales: parseAmount(getVal(getIdx('amount_sales'))),
                        amount_tax: parseAmount(getVal(getIdx('amount_tax'))),
                        amount_total: parseAmount(getVal(getIdx('amount_total'))),
                        raw_row: row.map(String)
                    });
                }
            }

            if (parsedRecords.length > 0) {
                updateProjectERP(parsedRecords);
                alert(`成功匯入 ${parsedRecords.length} 筆 ERP 帳務資料`);
            } else {
                alert("無法解析檔案內容。");
            }
            setStatus(AppStatus.IDLE);
            if (erpInputRef.current) erpInputRef.current.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    // Smart Upload with Deduplication, Concurrency, and Batch Updates
    const handleFiles = async (files: FileList) => {
        if (!project) return;

        const fileArray = Array.from(files);
        if (fileArray.length === 0) return;

        setStatus(AppStatus.PROCESSING);

        // Reset metrics for new batch
        const batchStart = Date.now();
        setBatchStats({ startTime: batchStart, endTime: 0, totalDuration: 0 });

        const newProcessQueue: InvoiceEntry[] = [];

        // 1. Calculate new invoice list synchronously
        const currentInvoices = project.invoices;
        const existingMap = new Map(currentInvoices.map(p => [p.id, p]));

        // Track seen invoice numbers for duplicate detection
        const seenInvoiceNumbers = new Set<string>();
        currentInvoices.forEach(inv => inv.data.forEach(d => {
            if (d.invoice_number) seenInvoiceNumbers.add(d.invoice_number.replace(/[\s-]/g, '').toUpperCase());
        }));

        let nextInvoices = [...currentInvoices];

        fileArray.forEach(file => {
            const filename = file.name;
            const id = filename.substring(0, filename.lastIndexOf('.')) || filename;

            // Save to IndexedDB
            fileStorageService.saveFile(id, file).catch(err => console.error("IDB Save Fail", err));

            if (existingMap.has(id)) {
                // Re-upload existing
                const existing = existingMap.get(id) as InvoiceEntry;

                // If it was successful, keep it unless user deletes it first.
                // BUT if it was ERROR or PENDING, we re-try!
                if (existing.status === 'SUCCESS' && existing.data.length > 0) {
                    // Updating the file blob/preview in case standard local file reference was lost
                    // The old entry might have a stale previewUrl or mock File object
                    const entry: InvoiceEntry = {
                        ...existing,
                        file: file,
                        previewUrl: URL.createObjectURL(file), // Refresh preview
                        status: 'SUCCESS'
                    };
                    nextInvoices = nextInvoices.map(inv => inv.id === id ? entry : inv);
                } else {
                    // Retry failed or stuck items
                    const entry: InvoiceEntry = { id, file, previewUrl: URL.createObjectURL(file), status: 'PENDING', data: [] };
                    nextInvoices = nextInvoices.map(inv => inv.id === id ? entry : inv);
                    newProcessQueue.push(entry);
                }
            } else {
                // Brand new
                const entry: InvoiceEntry = { id, file, previewUrl: URL.createObjectURL(file), status: 'PENDING', data: [] };
                nextInvoices.push(entry);
                newProcessQueue.push(entry);
            }
        });

        // Update list to show "PENDING" state
        updateProjectInvoices(() => nextInvoices);

        // If nothing to process (all duplicates), finish early
        if (newProcessQueue.length === 0) {
            setStatus(AppStatus.IDLE);
            alert("所有檔案皆已處理過。若需重新辨識，請先刪除舊資料。");
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        // --- Concurrency & Batch Update Logic ---

        // Initialize Progress
        const totalItems = newProcessQueue.length;
        logger.info('QUEUE', `Batch started with ${totalItems} new items using model: ${selectedModel}`, { fileNames: newProcessQueue.map(i => i.id) });
        setProgress({ current: 0, total: totalItems, status: 'PROCESSING' });

        const CONCURRENCY_LIMIT = 20;
        const changesMap = new Map<string, Partial<InvoiceEntry>>();

        // Start the batch updater interval
        const flushInterval = setInterval(() => {
            if (changesMap.size > 0) {
                // CRITICAL FIX: Snapshot the map immediately!
                // We cannot read from 'changesMap' inside the setState callback because
                // changesMap.clear() runs synchronously below, wiping it before React updates.
                const changesSnapshot = new Map(changesMap);
                changesMap.clear();

                updateProjectInvoices(prev => prev.map(inv => {
                    const change = changesSnapshot.get(inv.id);
                    return change ? { ...inv, ...change } : inv;
                }));
            }
        }, 500);

        let completedCount = 0;

        // Generate Seller Map from ERP Data for AI Enrichment
        const knownSellersFromExcel: Record<string, string> = {};
        if (project && project.erpData) {
            project.erpData.forEach(erp => {
                // Format: { "Vendor Name": "TaxID" }
                // Only add if both exist and TaxID is valid (digits)
                // Clean up name by removing common suffixes if needed, but 'includes' logic in service handles partials.
                if (erp.seller_name && erp.seller_tax_id && /^\d{8}$/.test(erp.seller_tax_id.trim())) {
                    knownSellersFromExcel[erp.seller_name.trim()] = erp.seller_tax_id.trim();
                }
            });
            logger.info('QUEUE', `Generated ${Object.keys(knownSellersFromExcel).length} seller mappings from Excel.`);
        }

        // Worker function for the concurrency pool
        const processItem = async (item: InvoiceEntry) => {
            // Mark as processing in our batch map
            changesMap.set(item.id, { status: 'PROCESSING' });
            logger.info('QUEUE', `Processing item: ${item.id}`);

            try {
                // Step 1: Preprocess image for better OCR accuracy
                let processedFile = item.file;
                if (item.file.type.startsWith('image/')) {
                    try {
                        processedFile = await preprocessImageForOCR(item.file, {
                            sharpen: true,
                            increaseContrast: true,
                            grayscale: false // Keep color for now
                        });
                        logger.info('PREPROCESSING', `Enhanced image: ${item.id}`);
                    } catch (err) {
                        logger.warn('PREPROCESSING', `Failed to preprocess ${item.id}, using original`, err);
                    }
                }

                const base64 = await fileToBase64(processedFile);
                // Log start time for this specific item
                const startTime = Date.now();

                // Pass the Excel-derived seller map to the AI service
                const results = await analyzeInvoice(base64, processedFile.type, selectedModel, 0, knownSellersFromExcel);

                if (results && results.length > 0) {

                    // Duplicate Check Logic
                    results.forEach(res => {
                        const normNo = (res.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
                        if (normNo) {
                            if (seenInvoiceNumbers.has(normNo)) {
                                res.trace_logs = res.trace_logs || [];
                                res.trace_logs.push(`[System Warning] Duplicate Invoice Number Detected: ${res.invoice_number}`);
                                // We can also flag it if there is a verification status field
                                // res.verification.logic_is_valid = false; // Optional?
                            } else {
                                seenInvoiceNumbers.add(normNo);
                            }
                        }
                    });

                    const duration = Date.now() - startTime;
                    logger.info('API', `Success: ${item.id}`, { duration, invoiceCount: results.length });
                    changesMap.set(item.id, { status: 'SUCCESS', data: results });
                } else {
                    logger.warn('API', `Empty Result: ${item.id}`, { duration: Date.now() - startTime });
                    changesMap.set(item.id, { status: 'ERROR', error: '無法辨識發票內容', data: [] });
                }
            } catch (err: any) {
                const errorMsg = err?.message?.includes('429') ? 'API 額度已滿' : (err.message || '辨識失敗');
                logger.error('API', `Failed: ${item.id}`, { error: errorMsg, details: err });
                changesMap.set(item.id, { status: 'ERROR', error: errorMsg, data: [] });
            } finally {
                completedCount++;
                setProgress({ current: completedCount, total: totalItems, status: 'PROCESSING' });
            }
        };

        // Simple Concurrency Pool Loop
        const pool: Promise<void>[] = [];
        const queue = [...newProcessQueue];

        // We use a simple recurrent function to process the queue
        const processNext = async () => {
            if (queue.length === 0) return;
            const item = queue.shift();
            if (item) {
                await processItem(item);
                // After finishing one, try to pick up another
                if (queue.length > 0) await processNext();
            }
        };

        // Start initial batch
        const initialBatch = Array(Math.min(CONCURRENCY_LIMIT, queue.length)).fill(null).map(() => processNext());
        await Promise.all(initialBatch);

        // Clean up
        clearInterval(flushInterval);

        // Final flush if any remains
        if (changesMap.size > 0) {
            updateProjectInvoices(prev => prev.map(inv => {
                const change = changesMap.get(inv.id);
                return change ? { ...inv, ...change } : inv;
            }));
        }

        const batchEnd = Date.now();
        setBatchStats({ startTime: batchStart, endTime: batchEnd, totalDuration: batchEnd - batchStart });

        setStatus(AppStatus.IDLE);
        setProgress({ current: completedCount, total: totalItems, status: 'COMPLETED' });
        logger.info('QUEUE', `Batch completed. Processed ${completedCount}/${totalItems} items.`);

        // Reset progress after a delay
        setTimeout(() => {
            setProgress(p => ({ ...p, status: 'IDLE' }));
        }, 3000);

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    const handleSave = (id: string, updatedData: InvoiceData) => {
        updateProjectInvoices(prev => prev.map(inv => {
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

    // Audit Logic
    const auditList = useMemo(() => {
        if (!project) return [];

        const fileMap = new Map<string, InvoiceEntry>(project.invoices.map(i => [i.id, i]));
        const matchedFileIds = new Set<string>(); // Track files matched to ERP to exclude from Extra List

        const mappedRows = project.erpData.map((erp, index) => {
            // Smart Matching: Find ALL files that start with the voucher ID
            // e.g. ERP "G61-PC0008" matches "G61-PC0008", "G61-PC0008-1", "G61-PC0008-2"
            const matchingFiles: InvoiceEntry[] = [];

            // 1. Try exact match
            const exact = fileMap.get(erp.voucher_id);
            if (exact) matchingFiles.push(exact);

            // 2. Try prefix match (only if exact match logic implies checking others, or just always check others?)
            // User requirement: "Single Tiptop Voucher ... has multiple invoice numbers ... G61-PC0098-1...-4"
            // So we should collect ALL relevant files.
            for (const [key, entry] of fileMap.entries()) {
                if (key === erp.voucher_id) continue; // Already handled
                if (key.startsWith(erp.voucher_id + '-') || key.startsWith(erp.voucher_id + '_')) {
                    matchingFiles.push(entry);
                }
            }

            // Mark these files as matched
            matchingFiles.forEach(f => matchedFileIds.add(f.id));

            let auditStatus: 'MATCH' | 'MISMATCH' | 'MISSING_FILE' | 'EXTRA_FILE' = 'MATCH';
            let diffDetails: string[] = [];

            // Flatten all OCR invoices from the matching files
            const allOCRInvoices = matchingFiles.flatMap(f => f.data);
            let matchedOCRInvoices: InvoiceData[] = [];

            if (matchingFiles.length === 0) {
                auditStatus = 'MISSING_FILE';
            } else if (allOCRInvoices.length > 0) {
                const erpInvNos = erp.invoice_numbers.map(n => n.replace(/[\s-]/g, '').toUpperCase());

                // Find OCR invoices that match ERP numbers
                matchedOCRInvoices = allOCRInvoices.filter(inv => {
                    const ocrInvNo = (inv.invoice_number || '').replace(/[\s-]/g, '').toUpperCase();
                    // Check if this OCR invoice matches ANY of the ERP numbers
                    return erpInvNos.some(erpNo => ocrInvNo.includes(erpNo) || erpNo.includes(ocrInvNo));
                });

                // If no direct number match, but we have exactly 1 ERP inv and 1 OCR inv, assume match
                if (matchedOCRInvoices.length === 0 && erpInvNos.length === 1 && allOCRInvoices.length === 1) {
                    matchedOCRInvoices = [allOCRInvoices[0]];
                }

                if (matchedOCRInvoices.length > 0) {
                    // Try to find the specific file that provided the matched invoice
                    // Use the first matched invoice's parent file if possible.
                    // But we flattened `allOCRInvoices` without keeping parent ref?
                    // We need to know which file `matchedOCRInvoices[0]` belongs to.
                    // Let's refactor the flatten logic slightly above? 
                    // No, `matchingFiles` is small, we can just find it.
                    // Actually, we can just store the file ID if we find a match.
                }
                // Compare Sums (ERP Total vs Sum of Matched OCR Totals)
                const erpTotal = erp.amount_total;
                const ocrTotalSum = matchedOCRInvoices.reduce((sum, inv) => sum + (inv.amount_total || 0), 0);

                if (Math.abs(ocrTotalSum - erpTotal) > 1) diffDetails.push('amount');

                // Validate Tax IDs for all matched invoices
                const erpTaxId = erp.seller_tax_id || '';
                matchedOCRInvoices.forEach(inv => {
                    const ocrTaxId = inv.seller_tax_id || '';
                    if (ocrTaxId && erpTaxId && ocrTaxId !== erpTaxId) {
                        if (!diffDetails.includes('tax_id')) diffDetails.push('tax_id');
                    }
                    const ocrBuyerId = inv.buyer_tax_id || '';
                    if (ocrBuyerId !== BUYER_TAX_ID_REQUIRED) {
                        if (!diffDetails.includes('buyer_id_error')) diffDetails.push('buyer_id_error');
                    }
                    if (ocrTaxId.includes('?')) {
                        if (!diffDetails.includes('tax_id_unclear')) diffDetails.push('tax_id_unclear');
                    }
                });

                // Check if we found ALL expected invoices
                // (This is hard if 1 ERP entry maps to N files, simpler to check if we matched *something*)
                // Ideally check count: erpInvNos.length vs matchedOCRInvoices.length
                if (erpInvNos.length !== matchedOCRInvoices.length) {
                    diffDetails.push('count_mismatch');
                }

                if (diffDetails.length > 0) auditStatus = 'MISMATCH';

            } else {
                auditStatus = 'MISMATCH';
                diffDetails.push('no_match_found');
            }


            // Construct specific display object. 
            // For display, we might pick the "first" matched invoice to show details, 
            // or sum them up. For now, let's use the first one but show sum in Amount.
            let displayOCR = null;
            if (matchedOCRInvoices.length > 0) {
                displayOCR = {
                    ...matchedOCRInvoices[0],
                    amount_total: matchedOCRInvoices.reduce((sum, i) => sum + (i.amount_total || 0), 0),
                    invoice_number: matchedOCRInvoices.map(i => i.invoice_number).join(' / ')
                };
            }

            // Determine the "Primary" matched file for this specific row (if any)
            let primaryFile = matchingFiles[0] || null;
            if (matchedOCRInvoices.length > 0) {
                const targetInv = matchedOCRInvoices[0];
                const foundFile = matchingFiles.find(f => f.data.includes(targetInv));
                if (foundFile) primaryFile = foundFile;
            }

            // Determine index of matched invoice in file
            let invoiceIndex = 0;
            if (primaryFile && matchedOCRInvoices.length > 0) {
                invoiceIndex = primaryFile.data.indexOf(matchedOCRInvoices[0]);
                if (invoiceIndex === -1) invoiceIndex = 0;
            }

            return {
                key: `${erp.voucher_id}_${index}`,
                id: erp.voucher_id,
                erp,
                files: matchingFiles,
                file: primaryFile,
                ocr: displayOCR,
                auditStatus,
                diffDetails,
                initialInvoiceIndex: invoiceIndex
            };
        });

        // Calculate Extras: Files that were NOT matched to any ERP row
        const extraFiles = project.invoices
            .filter(f => !matchedFileIds.has(f.id))
            .map(f => ({
                key: `extra_${f.id}`,
                id: f.id,
                erp: null,
                files: [f],
                file: f,
                ocr: f.data[0] || null,
                auditStatus: 'EXTRA_FILE' as const,
                diffDetails: []
            }));

        return [...mappedRows, ...extraFiles].sort((a, b) => a.id.localeCompare(b.id));
    }, [project]);

    // --- Metrics Calculation ---
    const metrics = useMemo(() => {
        if (!project) return { accuracy: 0, duration: 0 };
        const total = auditList.length;
        const correct = auditList.filter(i => i.auditStatus === 'MATCH').length;
        const accuracy = total > 0 ? (correct / total) * 100 : 0;
        return { accuracy, duration: batchStats.totalDuration };
    }, [auditList, batchStats.totalDuration]);

    const exportAuditReport = () => {
        if (auditList.length === 0) return;

        // Add Summary Header
        const summary = [
            `專案名稱,${project?.name}`,
            `匯出時間,${new Date().toLocaleString()}`,
            `使用模型,${selectedModel}`,
            `辨識正確率,${metrics.accuracy.toFixed(1)}%`,
            `總耗時,${(metrics.duration / 1000).toFixed(1)}秒`,
            `總筆數,${auditList.length}`,
            `` // Empty line separator
        ];

        const headers = ["傳票編號", "狀態", "ERP_發票號碼", "OCR_發票號碼", "買方統編狀態", "ERP_賣方統編", "OCR_賣方統編", "ERP_含稅總額", "OCR_含稅總額", "差異說明"];
        const rows = auditList.map(item => {
            const statusMap = { 'MATCH': 'OK', 'MISMATCH': '異常', 'MISSING_FILE': '缺件', 'EXTRA_FILE': '多餘' };
            return [
                item.id, statusMap[item.auditStatus],
                item.erp?.invoice_numbers.join(' / ') || '', item.ocr?.invoice_number || '',
                item.ocr?.buyer_tax_id === BUYER_TAX_ID_REQUIRED ? 'OK' : item.ocr?.buyer_tax_id,
                item.erp?.seller_tax_id || '', item.ocr?.seller_tax_id || '',
                item.erp?.amount_total || 0, item.ocr?.amount_tax || 0, // Changed from amount_sales to amount_tax for consistency
                item.erp?.amount_total || 0, item.ocr?.amount_total || 0,
                item.erp?.amount_total || 0, item.ocr?.amount_total || 0,
                item.diffDetails.map(d => {
                    if (d === 'amount') return '金額不符';
                    if (d === 'tax_id') return '賣方統編不符';
                    if (d === 'buyer_id_error') return '買方統編錯誤';
                    if (d === 'tax_id_unclear') return '賣方統編不清';
                    if (d === 'count_mismatch') return '發票數量不符';
                    if (d === 'no_match_found') return '找不到對應發票';
                    return d;
                }).join(';')
            ].join(',');
        });

        const csvContent = "\uFEFF" + [...summary, headers.join(','), ...rows].join('\n');

        const link = document.createElement("a");
        link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
        link.download = `稽核報告_${project?.name}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    };

    const selectedRow = auditList.find(r => r.key === selectedKey);
    const selectedFiles = selectedRow?.files || [];
    const selectedInitialFileId = selectedRow?.file?.id;
    const selectedInitialInvoiceIndex = selectedRow?.initialInvoiceIndex;

    // --- Views ---

    if (view === 'ERROR_REVIEW' && project) {
        return (
            <ErrorReviewPage
                project={project}
                onBack={() => setView('WORKSPACE')}
                onUpdateInvoice={handleSave}
            />
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
                        <button onClick={() => setIsCreating(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all active:scale-95">
                            <PlusSquare className="w-5 h-5" /> 建立新專案
                        </button>
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
                                    <div key={p.id} onClick={() => loadProject(p.id)} className="p-6 flex items-center justify-between hover:bg-gray-50 cursor-pointer group transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className="bg-blue-50 p-3 rounded-lg text-blue-600 group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                                                <FolderOpen className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-gray-800 text-lg group-hover:text-indigo-600 transition-colors">{p.name}</h3>
                                                <div className="flex items-center gap-3 text-xs text-gray-400 mt-1 font-mono">
                                                    <span>最後更新: {new Date(p.updatedAt).toLocaleDateString()}</span>
                                                    <span>•</span>
                                                    <span>ERP: {p.erpCount} 筆</span>
                                                    <span>•</span>
                                                    <span>已辨識: {p.invoiceCount} 筆</span>
                                                </div>
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
                                <h1 className="text-base font-black text-gray-900 tracking-tight">{project?.name}</h1>
                                <div className="flex items-center gap-2">
                                    {project && <span className="bg-gray-100 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold">ERP: {project.erpData.length} | OCR: {project.invoices.length}</span>}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="bg-gray-50 border border-gray-200 text-gray-700 text-xs rounded-lg p-1.5 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-medium"
                            >
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash (Fast)</option>
                                <option value="gemini-2.5-flash-hybrid">✨ Hybrid Auto-Escalation</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro (Accuracy)</option>
                            </select>
                            <div className="h-4 w-px bg-gray-200 mx-1"></div>
                            <button onClick={() => erpInputRef.current?.click()} className="btn-sm btn-blue">
                                <Lucide.FileSpreadsheet className="w-3.5 h-3.5" /> 匯入 ERP
                            </button>
                            <input type="file" ref={erpInputRef} className="hidden" accept=".csv, .xlsx, .xls" onChange={handleERPUpload} />

                            <button onClick={() => fileInputRef.current?.click()} className="btn-sm btn-indigo">
                                <Lucide.Upload className="w-3.5 h-3.5" /> 上傳/補件 (OCR)
                            </button>
                            <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,application/pdf" onChange={(e) => e.target.files && handleFiles(e.target.files)} />

                            <div className="h-4 w-px bg-gray-200 mx-1"></div>


                            <div className="h-4 w-px bg-gray-200 mx-1"></div>
                            <button onClick={() => setView('ERROR_REVIEW')} className="btn-sm bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 hover:border-rose-300 shadow-sm font-bold">
                                <Lucide.AlertOctagon className="w-3.5 h-3.5" /> 異常檢核
                            </button>
                            <button onClick={exportAuditReport} className="btn-sm btn-white"><Lucide.FileDown className="w-3.5 h-3.5" /> 報告</button>
                            <button onClick={() => logger.downloadLogs()} className="btn-sm btn-white text-gray-500" title="下載系統除錯紀錄"><Lucide.Bug className="w-3.5 h-3.5" /></button>
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
                    <CostDashboard project={project} accuracy={metrics.accuracy} modelName={selectedModel} totalDuration={metrics.duration} />
                    {progress.status !== 'IDLE' && (
                        <span className="font-mono font-bold text-indigo-600 flex items-center gap-2">
                            {progress.status === 'PROCESSING' && <Loader2 className="w-3 h-3 animate-spin" />}
                            Processing: {progress.current} / {progress.total}
                        </span>
                    )}
                </div>
            </div>

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
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col flex-1">
                        <div className="overflow-auto custom-scrollbar flex-1">
                            <table className="w-full text-left border-collapse relative">
                                <thead className="sticky top-0 z-20 shadow-sm text-[11px]">
                                    <tr className="font-black uppercase tracking-widest text-center">
                                        <th className="bg-slate-100 py-2 border-b border-r border-gray-200 w-[42%] text-slate-700" colSpan={6}>ERP 帳務資料</th>
                                        <th className="bg-gray-50 py-2 border-b border-r border-gray-200 w-[6%] text-gray-500">狀態</th>
                                        <th className="bg-indigo-50 py-2 border-b border-gray-200 w-[52%] text-indigo-700" colSpan={6}>OCR 辨識結果</th>
                                    </tr>
                                    <tr className="bg-white border-b border-gray-100 text-gray-400">
                                        <th className="pl-4 py-2 font-bold text-slate-500">傳票編號</th>
                                        <th className="px-1 py-2 font-bold text-slate-500">發票號碼</th>
                                        <th className="px-1 py-2 text-right">銷售額合計</th>
                                        <th className="px-1 py-2 text-right">營業稅</th>
                                        <th className="px-1 py-2 text-right font-bold text-slate-600">總計</th>
                                        <th className="px-1 py-2 text-center border-r">統編</th>
                                        <th className="px-1 py-2 text-center border-r">比對</th>
                                        <th className="pl-4 py-2 text-indigo-400">OCR 發票號</th>
                                        <th className="px-1 py-2 text-right text-indigo-300">銷售額合計</th>
                                        <th className="px-1 py-2 text-right text-indigo-300">營業稅</th>
                                        <th className="px-1 py-2 text-right font-bold text-indigo-500">總計</th>
                                        <th className="px-1 py-2 text-center text-indigo-300">賣方統編</th>
                                        <th className="px-1 py-2 text-right pr-4">功能</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 text-[13px]">
                                    {auditList.map((row) => {
                                        const isMismatch = row.auditStatus === 'MISMATCH';
                                        const isMissing = row.auditStatus === 'MISSING_FILE';
                                        const isExtra = row.auditStatus === 'EXTRA_FILE';
                                        const isMatch = row.auditStatus === 'MATCH';
                                        const hasOcrButNoFile = row.file && !row.file.previewUrl && row.file.status === 'SUCCESS';

                                        return (
                                            <tr key={row.key} className={`group hover:bg-gray-50 transition-colors ${isMismatch ? 'bg-rose-50/40' : ''} ${isMissing ? 'bg-slate-50' : ''}`}>
                                                <td className={`pl-4 py-3 font-mono font-bold whitespace-nowrap ${isMissing ? 'text-slate-400' : 'text-slate-700'}`}>{row.id}{isExtra && <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1 rounded">無 ERP</span>}</td>
                                                <td className={`px-1 py-3 font-mono ${row.diffDetails.includes('inv_no') ? 'text-rose-600 font-bold' : (isMissing ? 'text-slate-400' : 'text-slate-600')}`}>
                                                    {row.erp?.invoice_numbers.length ? (
                                                        <div className="flex flex-col">
                                                            {row.erp.invoice_numbers.map((num, i) => <span key={i}>{num}</span>)}
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                                <td className={`px-1 py-3 text-right font-mono ${isMissing ? 'text-slate-300' : 'text-slate-500'}`}>{row.erp ? row.erp.amount_sales.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-right font-mono ${isMissing ? 'text-slate-300' : 'text-slate-500'}`}>{row.erp ? row.erp.amount_tax.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-right font-mono font-bold ${row.diffDetails.includes('amount') ? 'text-rose-600' : (isMissing ? 'text-slate-400' : 'text-slate-800')}`}>{row.erp ? row.erp.amount_total.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-center font-mono border-r border-gray-100 ${row.diffDetails.includes('tax_id') ? 'text-rose-600 font-bold' : (isMissing ? 'text-slate-300' : 'text-slate-500')}`}>{row.erp?.seller_tax_id || '-'}</td>
                                                <td className="px-1 py-3 text-center border-r border-gray-100 align-middle">
                                                    {isMatch && <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />}
                                                    {isMismatch && (
                                                        <div className="flex flex-col items-center gap-0.5">
                                                            <AlertTriangle className="w-5 h-5 text-rose-500" />
                                                            {row.diffDetails.includes('buyer_id_error') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">買方錯誤</span>}
                                                            {row.diffDetails.includes('amount') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">金額不符</span>}
                                                            {row.diffDetails.includes('inv_no') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">號碼錯誤</span>}
                                                            {row.diffDetails.includes('tax_id_unclear') && <span className="text-[9px] text-amber-600 font-bold bg-amber-100 px-1 rounded">統編模糊</span>}
                                                        </div>
                                                    )}
                                                    {isMissing && <div className="flex flex-col items-center"><UploadCloud className="w-4 h-4 text-slate-300" /><span className="text-[9px] text-slate-400 font-bold mt-0.5">缺件</span></div>}
                                                </td>
                                                <td className="pl-4 py-3 font-mono text-indigo-900 flex items-center gap-2 cursor-pointer" onClick={() => row.file && row.file.previewUrl && setSelectedKey(row.key)}>
                                                    {row.file ? (
                                                        <>
                                                            {row.file.status === 'PROCESSING' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (hasOcrButNoFile ? <FileSearch className="w-3.5 h-3.5 text-amber-400" /> : <FileText className="w-3.5 h-3.5 text-indigo-300" />)}
                                                            <span className={`${!row.ocr ? 'text-gray-400 italic' : ''}`}>
                                                                {row.ocr?.error_code === 'BLURRY' ? <span className="text-rose-500 font-bold flex items-center gap-1"><Lucide.EyeOff className="w-3 h-3" /> 影像模糊</span> :
                                                                    row.ocr?.error_code === 'NOT_INVOICE' ? <span className="text-rose-500 font-bold flex items-center gap-1"><Lucide.XCircle className="w-3 h-3" /> 非發票</span> :
                                                                        (row.ocr?.invoice_number || (row.file.status === 'PROCESSING' ? '...' :
                                                                            (row.file.status === 'ERROR' ? <span className="text-rose-500 font-bold" title={row.file.error}>{row.file.error || '辨識失敗'}</span> :
                                                                                (hasOcrButNoFile ? '需補上傳' : '未對應'))))}
                                                            </span>
                                                            {hasOcrButNoFile && <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">資料已存/缺圖</span>}
                                                        </>
                                                    ) : <span className="text-gray-300 text-xs italic">等待上傳...</span>}
                                                </td>
                                                <td className="px-1 py-3 text-right font-mono text-indigo-400">{row.ocr ? row.ocr.amount_sales.toLocaleString() : '-'}</td>
                                                <td className="px-1 py-3 text-right font-mono text-indigo-400">{row.ocr ? row.ocr.amount_tax.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-right font-mono font-bold ${row.diffDetails.includes('amount') ? 'text-rose-600' : 'text-indigo-700'}`}>{row.ocr ? row.ocr.amount_total.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-center font-mono ${row.ocr?.seller_tax_id?.includes('?') ? 'text-amber-500 font-bold' : (row.diffDetails.includes('tax_id') ? 'text-rose-600 font-bold' : 'text-indigo-400')}`}>{row.ocr?.seller_tax_id || '-'}</td>
                                                <td className="px-1 py-3 text-right pr-4">
                                                    {(row.file?.status === 'SUCCESS' || row.ocr) && (
                                                        <div className="flex justify-end gap-1"><button className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" onClick={() => setSelectedKey(row.key)}><Edit3 className="w-3.5 h-3.5" /></button></div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
                }
            </main >
            <style>{`
        .btn-sm { @apply flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-all shadow-sm text-xs; }
        .btn-white { @apply border border-gray-200 bg-white text-gray-600 hover:bg-gray-50; }
        .btn-blue { @apply bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100; }
        .btn-indigo { @apply bg-indigo-600 text-white hover:bg-indigo-700 border border-transparent; }
      `}</style>
            {selectedFiles.length > 0 && <InvoiceEditor entries={selectedFiles} initialEntryId={selectedInitialFileId} initialInvoiceIndex={selectedInitialInvoiceIndex} onSave={handleSave} onClose={() => setSelectedKey(null)} />}
        </div >
    );
};

export default App;
