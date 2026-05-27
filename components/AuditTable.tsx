import React from 'react';
import { Loader2, CheckCircle2, Edit3, FileSearch, FileText, AlertTriangle, UploadCloud } from 'lucide-react';
import * as Lucide from 'lucide-react';
import { AuditRow, Project } from '../types';

interface AuditTableProps {
  auditList: AuditRow[];
  selectedKey: string | null;
  onRowClick: (key: string) => void;
  onReprocess: (file: File) => void;
  onToggleErpFlag: (voucherId: string, invoiceNumbers: string[]) => void;
  project: Project | null;
}

const AuditTable: React.FC<AuditTableProps> = ({ auditList, selectedKey, onRowClick, onReprocess, onToggleErpFlag, project }) => {
  return (
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
              const isMatch = row.auditStatus === 'MATCH';
              const isSkipped = row.auditStatus === 'SKIPPED';
              const isPending = row.file?.status === 'PENDING';
              const hasOcrButNoFile = row.file && !row.file.previewUrl && row.file.status === 'SUCCESS';

              if (isPending) isMissing = false;
              const isInvoiceRow = row.ocr?.voucher_type === 'Invoice' || row.ocr?.document_type === 'Invoice' || row.ocr?.document_type === 'Commercial Invoice';

              return (
                <tr key={row.key} className={`group hover:bg-gray-50 transition-colors ${isMismatch && !isPending && !isInvoiceRow ? 'bg-rose-50/40' : ''} ${isMissing ? 'bg-slate-50' : ''} ${isSkipped ? 'bg-gray-100/30' : ''} ${row.erp?.erpFlagged ? 'bg-amber-50/60' : ''}`}>
                  <td className={`pl-4 py-3 font-mono font-bold whitespace-nowrap ${isMissing || isPending ? 'text-slate-400' : 'text-slate-700'}`}>
                    <div className="flex items-center gap-1.5">
                      <span>{row.id}</span>
                      {row.erp && (
                        <button
                          title={row.erp.erpFlagged ? 'ERP 已標注待確認，點擊取消' : '標注此 ERP 資料待確認'}
                          onClick={() => onToggleErpFlag(row.erp!.voucher_id, row.erp!.invoice_numbers)}
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
                  <td className={`px-1 py-3 text-right font-mono ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : (isMissing ? 'text-slate-300' : 'text-slate-500')}`}>{row.erp ? row.erp.amount_sales.toLocaleString() : '-'}</td>
                  <td className={`px-1 py-3 text-right font-mono ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : (isMissing ? 'text-slate-300' : 'text-slate-500')}`}>{row.erp ? row.erp.amount_tax.toLocaleString() : '-'}</td>
                  <td className={`px-1 py-3 text-right font-mono font-bold ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : (isMissing ? 'text-slate-400' : 'text-slate-800')}`}>{row.erp ? row.erp.amount_total.toLocaleString() : '-'}</td>
                  <td className={`px-1 py-3 text-center font-mono border-r border-gray-100 ${!isInvoiceRow && row.diffDetails.includes('tax_id') ? 'text-rose-600 font-bold' : (isMissing ? 'text-slate-300' : 'text-slate-500')}`}>{row.erp?.seller_tax_id || '-'}</td>
                  <td className="px-1 py-3 text-center border-r border-gray-100 align-middle">
                    <div className="flex flex-col items-center gap-1">
                      {isPending && <><Lucide.Clock className="w-4 h-4 text-amber-500" /><span className="text-[9px] text-amber-600 font-bold mt-0.5">待解析</span></>}
                      {!isPending && isInvoiceRow && <CheckCircle2 className="w-5 h-5 text-slate-300" />}
                      {!isPending && !isInvoiceRow && isMatch && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                      {!isPending && !isInvoiceRow && isMismatch && <AlertTriangle className="w-5 h-5 text-rose-500" />}
                      {!isPending && isSkipped && <><CheckCircle2 className="w-5 h-5 text-slate-400" /><span className="text-[9px] text-slate-500 font-bold mt-0.5">已跳過</span></>}
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
                  <td className="pl-4 py-3 font-mono text-indigo-900 flex items-center gap-2 cursor-pointer" onClick={() => onRowClick(row.key)}>
                    {isSkipped ? (
                      <span className="text-gray-400 italic">-</span>
                    ) : row.file ? (
                      <>
                        {row.file.status === 'PROCESSING' ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : (hasOcrButNoFile ? <FileSearch className="w-3.5 h-3.5 text-amber-400" /> : <FileText className="w-3.5 h-3.5 text-indigo-300" />)}
                        {isPending ? (
                          <>
                            <span className="text-gray-400 italic">-</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); onReprocess(row.file!.file); }}
                              className="ml-1 p-1 rounded text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                              title="重新上傳憑證並辨識"
                            >
                              <UploadCloud className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={`${!row.ocr ? 'text-gray-400 italic' : ''}`}>
                              {row.ocr?.invoice_date ? <span className={`text-xs mr-1 px-1 py-0.5 rounded ${row.diffDetails.includes('date') ? 'text-rose-600 font-bold bg-rose-100 border border-rose-300' : 'text-indigo-300'}`}>{row.ocr.invoice_date}</span> : null}
                              {row.ocr?.error_code === 'BLURRY' ? <span className="text-rose-500 font-bold flex items-center gap-1"><Lucide.EyeOff className="w-3 h-3" /> 影像模糊</span> :
                                (row.ocr?.invoice_number || (row.file.status === 'PROCESSING' ? '...' :
                                  (row.file.status === 'ERROR' ? <span className="text-rose-500 font-bold" title={row.file.error}>{row.file.error || '辨識失敗'}</span> :
                                    (hasOcrButNoFile ? '需補上傳' : '未對應'))))}
                            </span>
                            {hasOcrButNoFile && <span className="text-[9px] text-amber-600 bg-amber-50 px-1 rounded">資料已存/缺圖</span>}
                          </>
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
                      } ${!isInvoiceRow && row.diffDetails.includes('tax_code') ? 'ring-2 ring-rose-500' : ''}`}>{row.ocr.tax_code}</span>
                    ) : '-'}
                  </td>
                  <td className={`px-1 py-3 text-right font-mono ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : 'text-indigo-400'}`}>
                    {row.ocr ? (
                      <span className="flex items-center justify-end gap-1">
                        {row.ocr.currency && row.ocr.currency !== 'TWD' && <span className="text-[9px] text-gray-400 font-sans tracking-wide">{row.ocr.currency}</span>}
                        {row.ocr.amount_sales.toLocaleString()}
                      </span>
                    ) : '-'}
                  </td>
                  <td className={`px-1 py-3 text-right font-mono ${!isInvoiceRow && row.diffDetails.includes('amount') ? 'text-rose-600' : 'text-indigo-400'}`}>
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
                      <div className="flex justify-end gap-1"><button className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" onClick={() => onRowClick(row.key)}><Edit3 className="w-3.5 h-3.5" /></button></div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditTable;
