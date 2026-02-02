
import React, { useState, useEffect } from 'react';
import { InvoiceEntry, InvoiceData } from '../types';
import * as Lucide from 'lucide-react';

interface Props {
  entry: InvoiceEntry;
  onSave: (id: string, updatedData: InvoiceData) => void;
  onClose: () => void;
}

const InvoiceEditor: React.FC<Props> = ({ entry, onSave, onClose }) => {
  // Default to the first invoice in the array for editing
  // In a full multi-invoice editor, we would add tabs here.
  const [formData, setFormData] = useState<InvoiceData | null>(entry.data[0] || null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    setIsVisible(true);
  }, []);

  if (!formData) return null;

  const handleChange = (field: keyof InvoiceData, value: any) => {
    if (!formData) return;
    const updated = { ...formData, [field]: value };
    if (['amount_sales', 'amount_tax', 'amount_total'].includes(field)) {
        const sales = field === 'amount_sales' ? value : updated.amount_sales;
        const tax = field === 'amount_tax' ? value : updated.amount_tax;
        const total = field === 'amount_total' ? value : updated.amount_total;
        updated.verification.logic_is_valid = Math.abs((sales + tax) - total) <= 1;
    }
    setFormData(updated);
  };
  
  const getFieldContainerStyle = (score: number) => {
    if (score < 70) return 'bg-rose-50 border-rose-400 ring-4 ring-rose-100 shadow-sm';
    if (score < 90) return 'bg-amber-50 border-amber-400 ring-4 ring-amber-100 shadow-sm';
    return 'bg-white border-gray-200 focus-within:border-indigo-500';
  };

  const getScoreBadgeStyle = (score: number) => {
    if (score < 70) return 'bg-rose-600 text-white';
    if (score < 90) return 'bg-amber-500 text-white';
    return 'bg-emerald-500 text-white';
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

  const isPdf = entry.file.type === 'application/pdf';
  const hasPreview = !!entry.previewUrl;

  const FieldHeader = ({ label, score }: { label: string, score: number }) => (
    <label className="flex items-center justify-between text-xs font-black text-gray-500 mb-1.5 uppercase tracking-wider">
      <span className="flex items-center gap-1.5">{label}{score < 90 && (<Lucide.AlertTriangle className={`w-3.5 h-3.5 ${score < 70 ? 'text-rose-600' : 'text-amber-500'}`} />)}</span>
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getScoreBadgeStyle(score)}`}>{score < 100 ? `AI 信心: ${score}%` : '驗證完畢'}</span>
    </label>
  );

  return (
    <div className={`fixed inset-0 z-50 bg-gray-900/60 backdrop-blur-md flex justify-end transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
      <div className={`bg-white w-full max-w-[90vw] lg:max-w-7xl h-full shadow-2xl flex transition-transform duration-500 ease-in-out ${isVisible ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex-1 bg-gray-200 relative overflow-hidden flex flex-col">
          <div className="absolute top-6 left-6 z-20 flex gap-2">
            <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-xl border border-gray-200 flex items-center gap-4">
              <span className="text-sm font-bold text-gray-700">檢視控制</span>
              <div className="h-4 w-px bg-gray-300"></div>
              <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-50" disabled={isPdf}><Lucide.Minus className="w-4 h-4" /></button>
              <span className="text-xs font-mono font-bold w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(z + 0.2, 8))} className="p-1 hover:bg-gray-100 rounded-lg disabled:opacity-50" disabled={isPdf}><Lucide.Plus className="w-4 h-4" /></button>
              <button onClick={resetView} className="p-1 hover:bg-gray-100 rounded-lg text-indigo-600 disabled:opacity-50" disabled={isPdf}><Lucide.Maximize className="w-4 h-4" /></button>
            </div>
             {entry.file.name && (
              <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-xl border border-gray-200 flex items-center gap-3" title={entry.file.name}>
                 <Lucide.FileText className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                 <p className="text-sm font-semibold text-gray-700 max-w-xs truncate">{entry.file.name}</p>
                 {entry.data.length > 1 && <span className="bg-indigo-100 text-indigo-700 text-xs px-2 rounded-full font-bold">含 {entry.data.length} 張發票</span>}
              </div>
            )}
          </div>
          <div className={`flex-1 relative ${isPdf || !hasPreview ? '' : 'cursor-grab active:cursor-grabbing'} bg-gray-300`} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
            <div className="absolute inset-0 flex items-center justify-center transition-transform duration-75 will-change-transform" style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})` }}>
              {hasPreview ? (
                isPdf ? (
                    <div className="w-[800px] h-[1131px] bg-white shadow-2xl">
                        <embed src={entry.previewUrl} type="application/pdf" className="w-full h-full border-none" />
                    </div>
                ) : (
                    <img src={entry.previewUrl} className="max-w-none shadow-2xl bg-white" style={{ width: '800px' }} alt="Invoice" draggable={false} />
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
        <div className="w-[480px] flex flex-col border-l border-gray-200 bg-white z-30 shadow-[-10px_0_30px_rgba(0,0,0,0.05)]">
          <div className="p-8 border-b flex justify-between items-center bg-white sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">稽核編輯器</h2>
              {entry.data.length > 1 && <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded">正在編輯第 1/{entry.data.length} 張</span>}
            </div>
            <button onClick={onClose} className="p-2.5 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><Lucide.X className="w-6 h-6" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
            <div className={`p-5 rounded-2xl flex items-center gap-4 border ${formData.verification.logic_is_valid ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-rose-50 text-rose-800 border-rose-200 shadow-sm'}`}><div className={`p-2 rounded-xl ${formData.verification.logic_is_valid ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{formData.verification.logic_is_valid ? <Lucide.CheckCircle2 className="w-6 h-6" /> : <Lucide.AlertCircle className="w-6 h-6" />}</div><div><p className="font-black text-sm uppercase tracking-widest">會計邏輯狀態</p><p className="text-xs font-medium opacity-80">{formData.verification.logic_is_valid ? '金額勾稽正確無誤' : '銷售額 + 稅額 ≠ 總計，請檢查'}</p></div></div>
            <div className="space-y-6">
              <div><FieldHeader label="發票號碼" score={formData.field_confidence.invoice_number} /><input type="text" className={`w-full border rounded-2xl px-5 py-4 font-mono text-xl font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_number)}`} value={formData.invoice_number || ''} onChange={(e) => handleChange('invoice_number', e.target.value)} /></div>
              
              <div className="grid grid-cols-2 gap-5">
                  <div><FieldHeader label="開立日期" score={formData.field_confidence.invoice_date} /><input type="date" className={`w-full border rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.invoice_date)}`} value={formData.invoice_date || ''} onChange={(e) => handleChange('invoice_date', e.target.value)} /></div>
                  <div><FieldHeader label="買方統編" score={formData.field_confidence.buyer_tax_id || 0} /><input type="text" className={`w-full border rounded-2xl px-5 py-4 text-sm font-mono font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${(formData.buyer_tax_id === '16547744') ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50 text-rose-700'}`} value={formData.buyer_tax_id || ''} onChange={(e) => handleChange('buyer_tax_id', e.target.value)} />{formData.buyer_tax_id !== '16547744' && <p className="text-[10px] text-rose-600 font-bold mt-1">必須為 16547744</p>}</div>
              </div>

              <div className="grid grid-cols-1 gap-5">
                 <div><FieldHeader label="賣方統編" score={formData.field_confidence.seller_tax_id} /><input type="text" className={`w-full border rounded-2xl px-5 py-4 text-sm font-mono font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.seller_tax_id)}`} value={formData.seller_tax_id || ''} onChange={(e) => handleChange('seller_tax_id', e.target.value)} /></div>
                 <div><FieldHeader label="賣方公司名稱" score={formData.field_confidence.seller_name} /><input type="text" className={`w-full border rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-indigo-500 transition-all outline-none ${getFieldContainerStyle(formData.field_confidence.seller_name)}`} value={formData.seller_name || ''} onChange={(e) => handleChange('seller_name', e.target.value)} /></div>
              </div>

              <div className="p-6 bg-gray-900 rounded-[32px] space-y-5 shadow-2xl border border-gray-800">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <div><FieldHeader label="銷售額" score={formData.field_confidence.amount_sales} /><input type="number" className={`w-full text-left bg-gray-800/50 border-2 border-gray-700 rounded-lg p-2 text-white focus:border-indigo-400 outline-none text-lg font-bold ${formData.field_confidence.amount_sales < 90 ? 'text-amber-400 border-amber-500/50' : ''}`} value={formData.amount_sales} onChange={(e) => handleChange('amount_sales', parseInt(e.target.value) || 0)} /></div>
                    <div><FieldHeader label="營業稅" score={formData.field_confidence.amount_tax} /><input type="number" className={`w-full text-left bg-gray-800/50 border-2 border-gray-700 rounded-lg p-2 text-white focus:border-indigo-400 outline-none text-lg font-bold ${formData.field_confidence.amount_tax < 90 ? 'text-amber-400 border-amber-500/50' : ''}`} value={formData.amount_tax} onChange={(e) => handleChange('amount_tax', parseInt(e.target.value) || 0)} /></div>
                </div>
                <div className="pt-4 border-t border-gray-800"><FieldHeader label="總計金額" score={formData.field_confidence.amount_total} /><input type="number" className="w-full text-left bg-transparent text-white focus:text-indigo-400 outline-none text-4xl font-black" value={formData.amount_total} onChange={(e) => handleChange('amount_total', parseInt(e.target.value) || 0)} /></div>
              </div>
            </div>
          </div>
          <div className="p-8 bg-gray-50 border-t flex gap-4"><button onClick={() => formData && onSave(entry.id, formData)} className="flex-1 bg-indigo-600 text-white py-5 rounded-[24px] text-lg font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 active:scale-[0.98]"><Lucide.Save className="w-5 h-5" /> 儲存變更</button></div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceEditor;
