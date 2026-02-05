
import React, { useState, useEffect } from 'react';
import { InvoiceEntry, InvoiceData } from '../types';
import * as Lucide from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import InvoicePreview from './InvoicePreview';
import InvoiceForm from './InvoiceForm';

// Configure PDF worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface Props {
  entries: InvoiceEntry[];
  initialEntryId?: string;
  initialInvoiceIndex?: number;
  onSave: (id: string, updatedData: InvoiceData) => void;
  onClose: () => void;
}

const InvoiceEditor: React.FC<Props> = ({ entries, initialEntryId, initialInvoiceIndex, onSave, onClose }) => {
  // Current active file index - default to matching ID or 0
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (initialEntryId) {
      const idx = entries.findIndex(e => e.id === initialEntryId);
      return idx >= 0 ? idx : 0;
    }
    return 0;
  });
  const currentEntry = entries[currentIndex];

  // Current active invoice index within the file (for multi-page/multi-invoice files)
  const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(initialInvoiceIndex || 0);

  // Reset invoice index when file changes
  useEffect(() => {
    // If we're on the initial load and this is the target file, keep the initial index
    // Otherwise reset to 0
    if (currentEntry.id !== initialEntryId) {
      setCurrentInvoiceIndex(0);
    } else {
      // If it IS the initial file, we might want to respect initialInvoiceIndex, 
      // but this effect runs on every currentIndex change. 
      // Actually simpler: just reset to 0 if we switch files manually.
      // But wait, the initial load handles the initial state.
      // We only want to reset to 0 if the USER switches files.
    }
  }, [currentIndex]); // Logic might be tricky, let's simplify: 

  // Actually, better to just let `currentInvoiceIndex` be independent state, 
  // but we need to reset it when `currentIndex` changes unless it's the first render?
  // Let's just reset it to 0 in the `useEffect` dependent on `currentIndex`.
  // BUT we need `initialInvoiceIndex` only on mount.

  // Let's rely on a combined effect for data loading.

  // Form Data for the CURRENT entry's first invoice (assuming 1 invoice per file for now)
  // TODO: If a single file has multiple invoices (e.g. multi-page), we might need another level of navigation.
  // For now, consistent with App.tsx, we rely on the first parsed invoice of the file.
  const [formData, setFormData] = useState<InvoiceData | null>(null);

  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);

  // PDF specific state
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  useEffect(() => {
    setIsVisible(true);
  }, []);

  // Update form data automatically when file or invoice index changes
  useEffect(() => {
    if (currentEntry && currentEntry.data.length > 0) {
      // Ensure index is valid
      const safeIndex = Math.min(currentInvoiceIndex, currentEntry.data.length - 1);
      if (safeIndex !== currentInvoiceIndex) setCurrentInvoiceIndex(safeIndex);

      setFormData(currentEntry.data[safeIndex]);
    } else {
      setFormData(null);
    }

    // Only reset view when changing FILES (currentIndex), not invoices within file
    // But we can't easily distinguish here. Let's just leave view alone for smoother invoice switching?
    // User might want to zoom in on different parts for different invoices. 
    // Let's reset view only if file ID changes.
  }, [currentIndex, currentInvoiceIndex, currentEntry]);

  // Reset Page Number when file changes
  useEffect(() => {
    setPageNumber(1);
  }, [currentIndex]);

  // Reset Zoom on File Switch only
  useEffect(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    // When switching files, reset invoice index to 0 (unless it's the very first load which is handled by init state?? No, useState init only runs once)
    // We need to detect if we switched files.
    // Actually, we can just use `setCurrentInvoiceIndex(0)` here?
    // But that would override `initialInvoiceIndex` on first mount if we are not careful.
    // `initialEntryId` logic sets the initial `currentIndex`. 
    // How to detect "user switched file"? 
    // Maybe just check if the new file is NOT the initial file, OR if we have already consumed the initial load.
  }, [currentIndex]);

  if (!formData || !currentEntry) return null;

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

  const handleSave = () => {
    if (formData && currentEntry) {
      onSave(currentEntry.id, formData);
    }
  };

  const getFieldSeverity = (field: string) => {
    // 嚴重：營業稅、賣方統編
    if (['amount_tax', 'seller_tax_id'].includes(field)) return 'critical';
    // 普通：銷售額合計、總計
    if (['amount_sales', 'amount_total'].includes(field)) return 'warning';
    // 輕微：買方統編 (和其他)
    if (['buyer_tax_id', 'invoice_number', 'invoice_date', 'seller_name'].includes(field)) return 'minor';
    return 'minor';
  };

  const getScoreBadgeStyle = (score: number, field: string) => {
    if (score >= 100) return 'bg-emerald-500 text-white';

    // Low confidence colors based on severity
    const severity = getFieldSeverity(field);
    if (severity === 'critical') return 'bg-rose-600 text-white'; // Critical -> Red
    if (severity === 'warning') return 'bg-amber-500 text-white'; // Warning -> Orange
    return 'bg-slate-500 text-white'; // Minor -> Gray/Blue
  };

  const getFieldContainerStyle = (score: number, field: string) => {
    if (score >= 100) return 'bg-white border-gray-200 focus-within:border-indigo-500';

    // Different border/bg for low confidence based on severity
    const severity = getFieldSeverity(field);
    if (severity === 'critical') return 'bg-rose-50 border-rose-400 ring-4 ring-rose-100 shadow-sm';
    if (severity === 'warning') return 'bg-amber-50 border-amber-400 ring-4 ring-amber-100 shadow-sm';
    return 'bg-slate-50 border-slate-400 ring-4 ring-slate-100 shadow-sm';
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isPdf) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setZoom(prev => Math.min(Math.max(prev + delta, 0.3), 8));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isPdf) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);
  const resetView = () => { setZoom(1); setPosition({ x: 0, y: 0 }); };

  const isPdf = currentEntry.file.type === 'application/pdf';
  const hasPreview = !!currentEntry.previewUrl;

  const FieldHeader = ({ label, field, score }: { label: string, field: string, score: number }) => {
    const severity = getFieldSeverity(field);
    const alertColor = severity === 'critical' ? 'text-rose-600' : (severity === 'warning' ? 'text-amber-500' : 'text-slate-500');

    return (
      <label className="flex items-center justify-between text-xs font-black text-gray-500 mb-1.5 uppercase tracking-wider">
        <span className="flex items-center gap-1.5">{label}{score < 100 && (<Lucide.AlertTriangle className={`w-3.5 h-3.5 ${alertColor}`} />)}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getScoreBadgeStyle(score, field)}`}>{score < 100 ? `AI 信心: ${score}%` : '驗證完畢'}</span>
      </label>
    );
  };

  return (
    <div className={`fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-md flex justify-end transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`bg-white w-full max-w-[90vw] lg:max-w-7xl h-full shadow-2xl flex transition-transform duration-500 ease-in-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* Left Side: Preview Area */}
        <InvoicePreview
          currentEntry={currentEntry}
          entries={entries}
          currentIndex={currentIndex}
          onSwitchFile={setCurrentIndex}
        />

        {/* Right Side: Form */}
        <InvoiceForm
          formData={formData}
          setFormData={setFormData}
          currentInvoiceIndex={currentInvoiceIndex}
          totalInvoices={currentEntry.data.length}
          onInvoiceSwitch={setCurrentInvoiceIndex}
          onSave={handleSave}
          onClose={onClose}
          showCloseButton={true}
        />
      </div>
    </div>
  );
};

export default InvoiceEditor;
