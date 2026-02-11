
import React, { useState, useEffect } from 'react';
import { InvoiceEntry } from '../types';
import * as Lucide from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';

// Check if worker is already configured
if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
    ).toString();
}

interface Props {
    currentEntry: InvoiceEntry;
    entries: InvoiceEntry[]; // For file switcher
    currentIndex: number;
    onSwitchFile: (index: number) => void;
}

const InvoicePreview: React.FC<Props> = ({ currentEntry, entries, currentIndex, onSwitchFile }) => {
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

    // PDF state
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageNumber, setPageNumber] = useState(1);

    const isPdf = currentEntry.file.type === 'application/pdf';
    const hasPreview = !!currentEntry.previewUrl;

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
        setPageNumber(1);
    };

    // Reset View and Page on File Switch
    useEffect(() => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
        setPageNumber(1);
    }, [currentIndex]);

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.035 : 0.035;
        setZoom(prev => Math.min(Math.max(prev + delta, 0.3), 8));
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    };

    const handleMouseUp = () => setIsDragging(false);
    const resetView = () => { setZoom(1); setPosition({ x: 0, y: 0 }); };

    return (
        <div className="flex-1 bg-gray-200 relative overflow-hidden flex flex-col h-full min-w-0">
            {/* Controls */}
            <div className="absolute top-6 left-6 z-20 flex flex-col gap-3">
                {/* File Switcher (Tabs) */}
                {entries.length > 1 && (
                    <div className="bg-white/90 backdrop-blur p-1.5 rounded-2xl shadow-xl border border-gray-200 flex flex-col gap-1 max-w-[300px] max-h-[300px] overflow-y-auto custom-scrollbar">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 sticky top-0 bg-white/95 pb-1 block">
                            切換憑證文件 ({entries.length})
                        </span>
                        {entries.map((entry, idx) => (
                            <button
                                key={entry.id}
                                onClick={() => onSwitchFile(idx)}
                                className={`text-left px-3 py-2 rounded-lg text-xs font-bold transition-all truncate flex items-center gap-2 ${idx === currentIndex ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-gray-100 text-gray-600'}`}
                            >
                                <Lucide.FileText className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{entry.id}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-xl border border-gray-200 flex items-center gap-4 w-fit">
                    <span className="text-sm font-bold text-gray-700">檢視控制</span>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-50"><Lucide.Minus className="w-4 h-4" /></button>
                    <span className="text-xs font-mono font-bold w-12 text-center">{Math.round(zoom * 100)}%</span>
                    <button onClick={() => setZoom(z => Math.min(z + 0.2, 8))} className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-50"><Lucide.Plus className="w-4 h-4" /></button>
                    <button onClick={resetView} className="p-1 hover:bg-gray-100 rounded-lg text-indigo-600 disabled:opacity-50"><Lucide.Maximize className="w-4 h-4" /></button>

                    {/* PDF Page Navigation */}
                    {isPdf && numPages && numPages > 1 && (
                        <>
                            <div className="h-4 w-px bg-gray-300 ml-2"></div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                                    disabled={pageNumber <= 1}
                                    className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-30 text-gray-600"
                                >
                                    <Lucide.ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-xs font-mono font-bold text-gray-600 w-12 text-center">
                                    {pageNumber} / {numPages}
                                </span>
                                <button
                                    onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
                                    disabled={pageNumber >= numPages}
                                    className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-30 text-gray-600"
                                >
                                    <Lucide.ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </>
                    )}
                </div>
                {currentEntry.file.name && (
                    <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-xl border border-gray-200 flex items-center gap-3 w-fit" title={currentEntry.file.name}>
                        <Lucide.FileText className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                        <p className="text-sm font-semibold text-gray-700 max-w-xs truncate">{currentEntry.file.name}</p>
                    </div>
                )}
            </div>

            <div className={`flex-1 relative ${!hasPreview ? '' : 'cursor-grab active:cursor-grabbing'} bg-gray-300 overflow-hidden flex items-center justify-center`} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
                <div className={`transition-transform duration-75 will-change-transform ${isPdf ? 'flex items-center justify-center' : 'absolute inset-0 flex items-center justify-center'}`} style={{ transform: `translate(${position.x}px, ${position.y}px) ${isPdf ? '' : `scale(${zoom})`}` }}>
                    {hasPreview ? (
                        isPdf ? (
                            <div className="relative shadow-2xl">
                                <Document
                                    file={currentEntry.previewUrl}
                                    onLoadSuccess={onDocumentLoadSuccess}
                                    className="bg-white"
                                    loading={<div className="text-gray-500 font-bold p-10">載入 PDF 中...</div>}
                                    error={<div className="text-rose-500 font-bold p-10">PDF 載入失敗</div>}
                                >
                                    <Page
                                        pageNumber={pageNumber}
                                        scale={zoom}
                                        renderTextLayer={false}
                                        renderAnnotationLayer={false}
                                        className="bg-white shadow-lg"
                                    />
                                </Document>
                            </div>
                        ) : (
                            <img src={currentEntry.previewUrl} className="max-w-none shadow-2xl bg-white" style={{ width: '800px' }} alt="Invoice" draggable={false} />
                        )
                    ) : (
                        <div className="text-center p-8 bg-gray-100 rounded-lg">
                            <Lucide.FileWarning className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                            <p className="font-bold text-gray-600">無可用預覽</p>
                            <p className="text-sm text-gray-500">此筆資料由先前的工作階段載入</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InvoicePreview;
