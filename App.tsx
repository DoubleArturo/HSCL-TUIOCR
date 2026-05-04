
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Upload, Loader2, AlertCircle, CheckCircle2, Edit3, Trash2, FileSearch, Key, PlusSquare, FileDown, Clock, FileText, FileSpreadsheet, ArrowLeftRight, AlertTriangle, ArrowRight, UploadCloud, FolderOpen, ChevronRight, LogOut, Calendar } from 'lucide-react';
import { analyzeInvoice } from './services/geminiService';
import { preprocessImageForOCR } from './utils/imagePreprocessing';
import { InvoiceData, AppStatus, InvoiceEntry, Project, ERPRecord, ProjectMeta, ProcessingState, AuditRow } from './types';
import InvoiceEditor from './components/InvoiceEditor';
import ErrorReviewPage from './components/ErrorReviewPage';
import CostDashboard from './components/CostDashboard';
import * as Lucide from 'lucide-react';
import * as XLSX from 'xlsx';
import UTIF from 'utif';

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window { aistudio?: AIStudio; }
}

import { fileStorageService } from './services/fileStorageService';
import { logger } from './services/loggerService';
import { useAuditList } from './src/hooks/useAuditList';
import { buildAuditCSV, downloadCSV } from './src/lib/csvExport';
import { parseERPRows } from './src/lib/erpParser';

const BUYER_TAX_ID_REQUIRED = "16547744";

const App: React.FC = () => {
    const [view, setView] = useState<'PROJECT_LIST' | 'WORKSPACE' | 'ERROR_REVIEW'>('PROJECT_LIST');
    const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
    const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
    const [progress, setProgress] = useState<ProcessingState>({ current: 0, total: 0, status: 'IDLE' });
    const [project, setProject] = useState<Project | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hasCustomKey, setHasCustomKey] = useState(false);
    const selectedModel = 'gemini-3-flash-preview-hybrid';
    const [batchStats, setBatchStats] = useState({ startTime: 0, endTime: 0, totalDuration: 0 });

    const [isCreating, setIsCreating] = useState(false);
    const [createYear, setCreateYear] = useState(new Date().getFullYear());
    const [createMonth, setCreateMonth] = useState(new Date().getMonth() + 1);
    const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editYear, setEditYear] = useState(0);
    const [editMonth, setEditMonth] = useState(0);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const erpInputRef = useRef<HTMLInputElement>(null);
    const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isDirtyRef = useRef(false);
    const latestProjectRef = useRef<Project | null>(null);
    const cancelProcessingRef = useRef(false); // Used to instantly halt background async requests

    // Keep ref in sync
    useEffect(() => {
        latestProjectRef.current = project;
        if (project) {
            isDirtyRef.current = true;
        }
    }, [project]);

    // Cleanup old files on startup & Setup Auto-Save
    useEffect(() => {
        // Prune files older than 30 days (extended from 24h)
        fileStorageService.pruneOldFiles(30 * 24 * 60 * 60 * 1000).then(count => {
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
                erpCount: proj.erpData.length,
                year: proj.year,
                month: proj.month
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
            year: createYear,
            month: createMonth,
        };

        const newMeta: ProjectMeta = {
            id: newProj.id,
            name: newProj.name,
            updatedAt: newProj.updatedAt,
            invoiceCount: 0,
            erpCount: 0,
            year: createYear,
            month: createMonth,
        };

        setProject(newProj);
        setProject(newProj);
        saveProjectSnapshot(newProj);
        setProjectList([...projectList, newMeta]);
        localStorage.setItem('project_list', JSON.stringify([...projectList, newMeta]));
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
                status: inv.status === 'PROCESSING' ? 'PENDING' : inv.status, // Reset stuck items from mid-batch refresh
                file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }),
                previewUrl: '' // Empty until re-uploaded
            }));
            setProject(loaded);

            // Async rehydrate DB files
            const rehydrateImages = async () => {
                const updatedInvoices = await Promise.all(loaded.invoices.map(async (inv: any) => {
                    try {
                        const dbFile = await fileStorageService.getFile(inv.id);
                        if (dbFile) {
                            return {
                                ...inv,
                                file: dbFile,
                                previewUrl: URL.createObjectURL(dbFile)
                            };
                        }
                    } catch (err: any) {
                        logger.error('FILE', `IndexedDB Load Failed for ${inv.id}`, err);
                        alert(`讀取圖片或PDF失敗 (${inv.id}): ${err?.name || 'Error'} - ${err?.message || '未知儲存空間錯誤。建議檢查儲存空間或隱私權設定。'}`);
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

    const startEditingProject = (p: ProjectMeta, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setEditingProjectId(p.id);
        setEditName(p.name);
        setEditYear(p.year || new Date().getFullYear());
        setEditMonth(p.month || new Date().getMonth() + 1);
    };

    const saveProjectEdit = () => {
        if (!editingProjectId || !editName.trim()) return;

        const updated = projectList.map(p =>
            p.id === editingProjectId
                ? { ...p, name: editName, year: editYear, month: editMonth }
                : p
        );
        setProjectList(updated);
        localStorage.setItem('project_list', JSON.stringify(updated));

        // Update loaded project if it's the one being edited
        if (project?.id === editingProjectId) {
            const updatedProject = { ...project, name: editName, year: editYear, month: editMonth };
            setProject(updatedProject);
            saveProjectSnapshot(updatedProject);
        }

        setEditingProjectId(null);
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
            setTimeout(() => saveProjectSnapshot(updated), 100);
            return updated;
        });
    };

    const toggleErpFlag = (voucherId: string, invoiceNumbers: string[]) => {
        setProject(prev => {
            if (!prev) return null;
            return {
                ...prev,
                erpData: prev.erpData.map(erp => {
                    const isMatch = erp.voucher_id === voucherId &&
                        erp.invoice_numbers.join(',') === invoiceNumbers.join(',');
                    return isMatch ? { ...erp, erpFlagged: !erp.erpFlagged } : erp;
                })
            };
        });
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

            const parsedRecords = parseERPRows(rows);

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
    const handleFiles = async (files: FileList | File[]) => {
        if (!project) return;

        const fileArray = Array.from(files);
        if (fileArray.length === 0) return;

        setStatus(AppStatus.PROCESSING);
        cancelProcessingRef.current = false; // Reset lock on start

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

        // Helper: Convert ALL pages of a TIF to one tall PNG (pages stacked vertically)
        const convertTifToPng = async (file: File): Promise<File> => {
            const buffer = await file.arrayBuffer();
            const ifds = UTIF.decode(buffer);

            // Decode all pages
            ifds.forEach((ifd: any) => UTIF.decodeImage(buffer, ifd));

            // Stitch all pages vertically onto one canvas
            const totalWidth = Math.max(...ifds.map((p: any) => p.width as number));
            const totalHeight = ifds.reduce((sum: number, p: any) => sum + (p.height as number), 0);

            const canvas = document.createElement('canvas');
            canvas.width = totalWidth;
            canvas.height = totalHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Could not get canvas context");
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, totalWidth, totalHeight);

            let yOffset = 0;
            for (const page of ifds) {
                const rgba = UTIF.toRGBA8(page);
                const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer), page.width, page.height);
                const offscreen = document.createElement('canvas');
                offscreen.width = page.width;
                offscreen.height = page.height;
                offscreen.getContext('2d')!.putImageData(imgData, 0, 0);
                ctx.drawImage(offscreen, 0, yOffset);
                yOffset += page.height;
            }

            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    if (!blob) throw new Error("Canvas toBlob failed");
                    resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".png", { type: "image/png" }));
                }, 'image/png');
            });
        };

        let nextInvoices = [...currentInvoices];

        // Threshold for performance: only generate previews automatically if batch size < 800
        const shouldGeneratePreview = fileArray.length < 800;
        if (!shouldGeneratePreview) {
            logger.warn('SYSTEM', `Batch size (${fileArray.length}) is large. Auto-previews disabled to save memory.`);
        }

        for (const file of fileArray) {
            if (cancelProcessingRef.current) break; // Stop if cancelled
            let processedFile = file;
            const isTif = file.name.toLowerCase().endsWith('.tif') || file.name.toLowerCase().endsWith('.tiff');

            if (isTif) {
                try {
                    logger.info('IMAGE', `Converting TIF to PNG: ${file.name}`);
                    processedFile = await convertTifToPng(file);
                } catch (err) {
                    logger.error('IMAGE', `Failed to convert TIF: ${file.name}`, err);
                }
            }

            const filename = processedFile.name;
            let id = filename.substring(0, filename.lastIndexOf('.')) || filename;

            // Disambiguate: if same base-name ID already taken by a DIFFERENT file (e.g. G61-Q10001.pdf vs G61-Q10001.jpg),
            // append the extension so both get processed and prefix-matched to the same ERP row.
            if (existingMap.has(id) || nextInvoices.some(n => n.id === id && n.file.name !== processedFile.name)) {
                const existing = existingMap.get(id) || nextInvoices.find(n => n.id === id);
                if (existing && existing.file.name !== processedFile.name) {
                    const ext = filename.split('.').pop()?.toLowerCase() || '';
                    id = `${id}-${ext}`;
                }
            }

            // Sanitize ID: Remove any spaces or special characters that might cause IDB issues in some environments
            const sanitizedId = id.replace(/[^\w-]/g, '_');

            // Save to IndexedDB - CRITICAL: Must AWAIT to prevent race conditions on Edge
            try {
                await fileStorageService.saveFile(sanitizedId, processedFile);
            } catch (err: any) {
                logger.error('FILE', `IndexedDB Save Failed for ${sanitizedId}`, err);
                alert(`儲存檔案至瀏覽器失敗 (${sanitizedId}): ${err?.name || 'Error'} - ${err?.message || '未知儲存空間錯誤。您的磁碟可能已滿，或是處於無痕模式。'}`);
                // We proceed but it might show 'missing file' later if rehydrated
            }

            const previewUrl = shouldGeneratePreview ? URL.createObjectURL(processedFile) : '';

            if (existingMap.has(sanitizedId) || nextInvoices.some(n => n.id === sanitizedId)) {
                const existing = existingMap.get(sanitizedId) || nextInvoices.find(n => n.id === sanitizedId)!;

                if (existing.status === 'SUCCESS' && existing.data.length > 0) {
                    const entry: InvoiceEntry = {
                        ...existing,
                        file: processedFile,
                        previewUrl: previewUrl,
                        status: 'SUCCESS'
                    };
                    nextInvoices = nextInvoices.map(inv => inv.id === sanitizedId ? entry : inv);
                } else {
                    const entry: InvoiceEntry = { id: sanitizedId, file: processedFile, previewUrl, status: 'PENDING', data: [] };
                    nextInvoices = nextInvoices.map(inv => inv.id === sanitizedId ? entry : inv);
                    newProcessQueue.push(entry);
                }
            } else {
                const entry: InvoiceEntry = { id: sanitizedId, file: processedFile, previewUrl, status: 'PENDING', data: [] };
                nextInvoices.push(entry);
                newProcessQueue.push(entry);
            }
        }

        // If processing was cancelled during file preparation, stop here
        if (cancelProcessingRef.current) {
            setStatus(AppStatus.IDLE);
            setProgress({ current: 0, total: 0, status: 'IDLE' });
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

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

        // --- START BATCH PROCESS ---
        const CONCURRENCY_LIMIT = 5; // Increased from 2 to 5 for better throughput without hitting 429 too fast
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
            if (cancelProcessingRef.current) return; // Stop if cancelled

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

                // Find matching ERP record for cross-validation
                let expectedERP = undefined;
                if (project && project.erpData) {
                    const matchingErp = project.erpData.find(erp =>
                        item.id === erp.voucher_id || item.id.startsWith(erp.voucher_id + '-') || item.id.startsWith(erp.voucher_id + '_')
                    );
                    if (matchingErp) {
                        expectedERP = {
                            amount_total: matchingErp.amount_total,
                            amount_sales: matchingErp.amount_sales,
                            amount_tax: matchingErp.amount_tax,
                            invoice_numbers: matchingErp.invoice_numbers
                        };
                    }
                }

                // Pass the Excel-derived seller map to the AI service
                const results = await analyzeInvoice(base64, processedFile.type, selectedModel, 0, knownSellersFromExcel, expectedERP);

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
            if (cancelProcessingRef.current) return; // INSTANT ABORT
            if (queue.length === 0) return;
            const item = queue.shift();
            if (item) {
                await processItem(item);

                // 強制延遲 0.5 秒，稍微稀釋 API 請求頻率即可
                await new Promise(resolve => setTimeout(resolve, 500));

                // After finishing one, try to pick up another
                if (queue.length > 0 && !cancelProcessingRef.current) await processNext();
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

    const handleDeleteOCR = (id: string) => {
        updateProjectInvoices(prev => prev.map(inv =>
            inv.id === id
                ? { ...inv, data: [], status: 'PENDING' as const, previewUrl: '' }
                : inv
        ));
        setSelectedKey(null);
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

    const selectedRow = auditList.find(r => r.key === selectedKey);
    const selectedFiles = selectedRow?.files || [];
    const selectedInitialFileId = selectedRow?.file?.id;
    const selectedInitialInvoiceIndex = selectedRow?.initialInvoiceIndex;

    // --- Views ---

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
                            <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,application/pdf,image/tiff,.tif,.tiff" onChange={(e) => e.target.files && handleFiles(e.target.files)} />

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
                    <CostDashboard project={project} auditCoverage={metrics.auditCoverage} discrepancyCount={metrics.discrepancyCount} modelName={selectedModel} totalDuration={metrics.duration} uploaded={metrics.uploaded} missing={metrics.missing} total={metrics.total} />
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
                                        setProgress(p => ({ ...p, status: 'IDLE' }));
                                        setStatus(AppStatus.IDLE);
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
                                    <tr className="font-black uppercase tracking-widest text-center sticky top-0 z-20">
                                        <th className="bg-slate-100 py-2 border-b border-r border-gray-200 w-[42%] text-slate-700 shadow-sm" colSpan={8}>ERP 帳務資料</th>
                                        <th className="bg-gray-50 py-2 border-b border-r border-gray-200 w-[6%] text-gray-500 shadow-sm">狀態</th>
                                        <th className="bg-indigo-50 py-2 border-b border-gray-200 w-[52%] text-indigo-700 shadow-sm" colSpan={8}>OCR 辨識結果</th>
                                    </tr>
                                    <tr className="bg-white border-b border-gray-100 text-gray-400 sticky top-[33px] z-20 shadow-sm">
                                        <th className="pl-4 py-2 font-bold text-slate-500 bg-slate-50/90 backdrop-blur">傳票編號</th>
                                        <th className="px-1 py-2 font-bold text-slate-500 bg-slate-50/90 backdrop-blur">發票日期</th>
                                        <th className="px-1 py-2 font-bold text-slate-500 bg-slate-50/90 backdrop-blur">發票號碼</th>
                                        <th className="px-1 py-2 font-bold text-slate-400 bg-slate-50/90 backdrop-blur">稅別</th>
                                        <th className="px-1 py-2 text-right bg-slate-50/90 backdrop-blur">銷售額合計</th>
                                        <th className="px-1 py-2 text-right bg-slate-50/90 backdrop-blur">營業稅</th>
                                        <th className="px-1 py-2 text-right font-bold text-slate-600 bg-slate-50/90 backdrop-blur">總計</th>
                                        <th className="px-1 py-2 text-center border-r bg-slate-50/90 backdrop-blur">統編</th>
                                        <th className="px-1 py-2 text-center border-r bg-white/90 backdrop-blur">比對</th>
                                        <th className="pl-4 py-2 text-indigo-400 bg-indigo-50/90 backdrop-blur">發票日期</th>
                                        <th className="px-1 py-2 text-indigo-400 bg-indigo-50/90 backdrop-blur">OCR 發票號</th>
                                        <th className="px-1 py-2 text-indigo-400 bg-indigo-50/90 backdrop-blur">稅別</th>
                                        <th className="px-1 py-2 text-right text-indigo-300 bg-indigo-50/90 backdrop-blur">銷售額合計</th>
                                        <th className="px-1 py-2 text-right text-indigo-300 bg-indigo-50/90 backdrop-blur">營業稅</th>
                                        <th className="px-1 py-2 text-right font-bold text-indigo-500 bg-indigo-50/90 backdrop-blur">總計</th>
                                        <th className="px-1 py-2 text-center text-indigo-300 bg-indigo-50/90 backdrop-blur">賣方統編</th>
                                        <th className="px-1 py-2 text-right pr-4 bg-indigo-50/90 backdrop-blur">功能</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 text-[13px]">
                                    {auditList.map((row) => {
                                        const isMismatch = row.auditStatus === 'MISMATCH';
                                        let isMissing = row.auditStatus === 'MISSING_FILE';
                                        const isExtra = row.auditStatus === 'EXTRA_FILE';
                                        const isMatch = row.auditStatus === 'MATCH';
                                        const isPending = row.file?.status === 'PENDING';
                                        const hasOcrButNoFile = row.file && !row.file.previewUrl && row.file.status === 'SUCCESS';

                                        // Override missing visual flag if it's just PENDING
                                        if (isPending) isMissing = false;
                                        const isInvoiceRow = row.ocr?.voucher_type === 'Invoice' || row.ocr?.document_type === 'Invoice' || row.ocr?.document_type === 'Commercial Invoice';

                                        return (
                                            <tr key={row.key} className={`group hover:bg-gray-50 transition-colors ${isMismatch && !isPending && !isInvoiceRow ? 'bg-rose-50/40' : ''} ${isMissing ? 'bg-slate-50' : ''} ${row.erp?.erpFlagged ? 'bg-amber-50/60' : ''}`}>
                                                <td className={`pl-4 py-3 font-mono font-bold whitespace-nowrap ${isMissing || isPending ? 'text-slate-400' : 'text-slate-700'}`}>
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{row.id}</span>
                                                        {isExtra && <span className="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">無 ERP</span>}
                                                        {row.erp && (
                                                            <button
                                                                title={row.erp.erpFlagged ? 'ERP 已標注待確認，點擊取消' : '標注此 ERP 資料待確認'}
                                                                onClick={() => toggleErpFlag(row.erp!.voucher_id, row.erp!.invoice_numbers)}
                                                                className={`opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1 rounded ${row.erp.erpFlagged ? 'opacity-100 text-amber-600 bg-amber-100' : 'text-gray-400 hover:text-amber-500'}`}
                                                            >🚩</button>
                                                        )}
                                                        {row.erp?.erpFlagged && <span className="text-[9px] text-amber-700 font-bold bg-amber-100 px-1 rounded">ERP 待確認</span>}
                                                    </div>
                                                </td>
                                                <td className="px-1 py-3 font-mono text-slate-400">
                                                    {row.erp?.invoice_date || '-'}
                                                </td>
                                                <td className={`px-1 py-3 font-mono ${!isInvoiceRow && row.diffDetails.includes('inv_no') ? 'text-rose-600 font-bold' : (isMissing ? 'text-slate-400' : 'text-slate-600')}`}>
                                                    {row.erp?.invoice_numbers.length ? (
                                                        <div className="flex flex-col">
                                                            {row.erp.invoice_numbers.map((num, i) => <span key={i}>{num}</span>)}
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-1 py-3 text-center font-mono">
                                                    {row.erp?.tax_code ? (
                                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">{row.erp.tax_code}</span>
                                                    ) : '-'}
                                                </td>
                                                <td className={`px-1 py-3 text-right font-mono ${isMissing ? 'text-slate-300' : 'text-slate-500'}`}>{row.erp ? row.erp.amount_sales.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-right font-mono ${isMissing ? 'text-slate-300' : 'text-slate-500'}`}>{row.erp ? row.erp.amount_tax.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-right font-mono font-bold ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : (isMissing ? 'text-slate-400' : 'text-slate-800')}`}>{row.erp ? row.erp.amount_total.toLocaleString() : '-'}</td>
                                                <td className={`px-1 py-3 text-center font-mono border-r border-gray-100 ${!isInvoiceRow && row.diffDetails.includes('tax_id') ? 'text-rose-600 font-bold' : (isMissing ? 'text-slate-300' : 'text-slate-500')}`}>{row.erp?.seller_tax_id || '-'}</td>
                                                <td className="px-1 py-3 text-center border-r border-gray-100 align-middle">
                                                    <div className="flex flex-col items-center gap-1">
                                                        {isPending && <><Lucide.Clock className="w-4 h-4 text-amber-500" /><span className="text-[9px] text-amber-600 font-bold mt-0.5">待解析</span></>}
                                                        {!isPending && isInvoiceRow && <CheckCircle2 className="w-5 h-5 text-slate-300" />}
                                                        {!isPending && !isInvoiceRow && isMatch && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                                                        {!isPending && !isInvoiceRow && isMismatch && <AlertTriangle className="w-5 h-5 text-rose-500" />}
                                                        {isMissing && <><UploadCloud className="w-4 h-4 text-slate-300" /><span className="text-[9px] text-slate-400 font-bold mt-0.5">缺件</span></>}
                                                        
                                                        {!isMissing && (row.ocr?.voucher_type || row.ocr?.document_type) && (
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none text-center whitespace-nowrap ${
                                                                row.ocr?.voucher_type === '三聯手寫' ? 'bg-amber-100 text-amber-800' :
                                                                row.ocr?.voucher_type === '三聯收銀' ? 'bg-blue-100 text-blue-700' :
                                                                row.ocr?.voucher_type === '三聯電子' ? 'bg-indigo-100 text-indigo-700' :
                                                                row.ocr?.voucher_type === '二聯收銀' ? 'bg-purple-100 text-purple-700' :
                                                                row.ocr?.voucher_type === '收據' ? 'bg-gray-100 text-gray-600' :
                                                                row.ocr?.voucher_type === '車票' ? 'bg-green-100 text-green-700' :
                                                                row.ocr?.voucher_type === 'Invoice' ? 'bg-rose-100 text-rose-700' :
                                                                row.ocr?.document_type === '進口報單' || (row.ocr?.document_type || '').includes('海關') ? 'bg-teal-100 text-teal-700' :
                                                                'bg-gray-100 text-gray-500'
                                                            }`} title={row.ocr?.voucher_type || row.ocr?.document_type}>
                                                                {row.ocr?.voucher_type || (row.ocr?.document_type && row.ocr.document_type.length > 6 ? row.ocr.document_type.substring(0, 5) + '..' : row.ocr?.document_type)}
                                                            </span>
                                                        )}

                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('date') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">日期不符</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('amount') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">金額不符</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('inv_no') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">發票號碼不符</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('tax_code') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">稅別不符</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('tax_id') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">統編不符</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('tax_id_unclear') && <span className="text-[9px] text-amber-600 font-bold bg-amber-100 px-1 rounded">統編模糊</span>}
                                                        {isMismatch && !isInvoiceRow && row.diffDetails.includes('no_match_found') && <span className="text-[9px] text-rose-600 font-bold bg-rose-100 px-1 rounded">找不到對應</span>}
                                                    </div>
                                                </td>
                                                <td className="pl-4 py-3 font-mono text-indigo-900 flex items-center gap-2 cursor-pointer" onClick={() => row.file && row.file.previewUrl && setSelectedKey(row.key)}>
                                                    {row.file ? (
                                                        <>
                                                            {row.file.status === 'PROCESSING' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (hasOcrButNoFile ? <FileSearch className="w-3.5 h-3.5 text-amber-400" /> : <FileText className="w-3.5 h-3.5 text-indigo-300" />)}
                                                            <span className={`${!row.ocr ? 'text-gray-400 italic' : ''}`}>
                                                                {row.ocr?.invoice_date ? <span className="text-xs text-indigo-300 mr-1">{row.ocr.invoice_date}</span> : null}
                                                                {row.ocr?.error_code === 'BLURRY' ? <span className="text-rose-500 font-bold flex items-center gap-1"><Lucide.EyeOff className="w-3 h-3" /> 影像模糊</span> :
                                                                        (row.ocr?.invoice_number || (row.file.status === 'PROCESSING' ? '...' :
                                                                            (row.file.status === 'ERROR' ? <span className="text-rose-500 font-bold" title={row.file.error}>{row.file.error || '辨識失敗'}</span> :
                                                                                (hasOcrButNoFile ? '需補上傳' : '未對應'))))}
                                                            </span>
                                                            {hasOcrButNoFile && <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">資料已存/缺圖</span>}
                                                            {isPending && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleFiles([row.file!.file]); }}
                                                                    className="ml-2 text-[9px] px-1.5 py-0.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded flex items-center gap-1 transition-colors bg-white font-bold"
                                                                >
                                                                    <Lucide.Play className="w-2.5 h-2.5" /> 原單續傳
                                                                </button>
                                                            )}
                                                        </>
                                                    ) : <span className="text-gray-300 text-xs italic">等待上傳...</span>}
                                                </td>
                                                <td className="px-1 py-3 text-center font-mono">
                                                    {row.ocr?.tax_code ? (
                                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                                                            row.ocr.tax_code === 'T300' ? 'bg-amber-100 text-amber-700' :
                                                            row.ocr.tax_code === 'T301' ? 'bg-indigo-100 text-indigo-700' :
                                                            row.ocr.tax_code === 'T302' ? 'bg-blue-100 text-blue-700' :
                                                            row.ocr.tax_code === 'T400' ? 'bg-teal-100 text-teal-700' :
                                                            row.ocr.tax_code === 'T500' ? 'bg-purple-100 text-purple-700' :
                                                            'bg-gray-100 text-gray-500'
                                                        }`}>{row.ocr.tax_code}</span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-1 py-3 text-right font-mono text-indigo-400">
                                                    {row.ocr ? (
                                                        <span className="flex items-center justify-end gap-1">
                                                            {row.ocr.currency && row.ocr.currency !== 'TWD' && <span className="text-[9px] text-gray-400 font-sans tracking-wide">{row.ocr.currency}</span>}
                                                            {row.ocr.amount_sales.toLocaleString()}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-1 py-3 text-right font-mono text-indigo-400">
                                                    {row.ocr ? (
                                                        <span className="flex items-center justify-end gap-1">
                                                            {row.ocr.currency && row.ocr.currency !== 'TWD' && <span className="text-[9px] text-gray-400 font-sans tracking-wide">{row.ocr.currency}</span>}
                                                            {row.ocr.amount_tax.toLocaleString()}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className={`px-1 py-3 text-right font-mono font-bold ${row.diffDetails.includes('amount') ? 'text-rose-600' : 'text-indigo-700'}`}>
                                                    {row.ocr ? (
                                                        <span className="flex items-center justify-end gap-1">
                                                            {row.ocr.currency && row.ocr.currency !== 'TWD' && <span className="text-[9px] text-gray-500 font-sans tracking-wide">{row.ocr.currency}</span>}
                                                            {row.ocr.amount_total.toLocaleString()}
                                                        </span>
                                                    ) : '-'}
                                                </td>
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
            {selectedFiles.length > 0 && <InvoiceEditor entries={selectedFiles} initialEntryId={selectedInitialFileId} initialInvoiceIndex={selectedInitialInvoiceIndex} erpRecord={selectedRow?.erp} onSave={handleSave} onDelete={handleDeleteOCR} onClose={() => setSelectedKey(null)} />}
        </div >
    );
};

export default App;
