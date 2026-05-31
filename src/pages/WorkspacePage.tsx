import React from 'react';
import { ArrowLeftRight, Play, FileSpreadsheet, Upload, AlertOctagon, Loader2, Square, LayoutDashboard } from 'lucide-react';
import { Project, ProjectMeta, AuditRow } from '../../types';
import CostDashboard from '../../components/CostDashboard';
import AuditTable from '../../components/AuditTable';
import InvoiceEditor from '../../components/InvoiceEditor';
import EditProjectModal from '../components/modals/EditProjectModal';

interface WorkspacePageProps {
  project: Project | null;
  selectedModel: string;
  progress: { status: string; current: number; total: number };
  batchStats: any;
  cancelProcessingRef: React.MutableRefObject<boolean>;
  handleFiles: (files: FileList | File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  erpInputRef: React.RefObject<HTMLInputElement | null>;
  onERPUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  auditList: AuditRow[];
  metrics: { auditCoverage: number; discrepancyCount: number; duration: number; uploaded: number; missing: number; total: number };
  selectedKey: string | null;
  onRowClick: (key: string | null) => void;
  selectedRow: AuditRow | null;
  selectedFiles: any[];
  selectedInitialFileId: string | undefined;
  selectedInitialInvoiceIndex: number | undefined;
  onSave: (id: string, data: any) => void;
  onDeleteOCR: (id: string) => void;
  onReOCR: (id: string) => void;
  onToggleErpFlag: (id: string) => void;
  onBack: () => void;
  onGoToErrorReview: () => void;
  editingProject: ProjectMeta | null;
  onStartEditing: (p: ProjectMeta) => void;
  onSaveEdit: (id: string, name: string, year: number, month: number) => void;
  onCancelEdit: () => void;
}

export default function WorkspacePage({
  project,
  selectedModel,
  progress,
  batchStats,
  cancelProcessingRef,
  handleFiles,
  fileInputRef,
  erpInputRef,
  onERPUpload,
  auditList,
  metrics,
  selectedKey,
  onRowClick,
  selectedRow,
  selectedFiles,
  selectedInitialFileId,
  selectedInitialInvoiceIndex,
  onSave,
  onDeleteOCR,
  onReOCR,
  onToggleErpFlag,
  onBack,
  onGoToErrorReview,
  editingProject,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
}: WorkspacePageProps) {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col font-sans text-gray-800">
      <div className="sticky top-0 z-40 bg-white shadow-sm transition-all duration-200">
        <header className="bg-white border-b relative">
          <div className="max-w-[1920px] mx-auto px-4 h-16 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-800 transition-colors" title="返回專案列表">
                <ArrowLeftRight className="w-5 h-5" />
              </button>
              <div className="h-6 w-px bg-gray-200"></div>
              <div>
                <div className="flex items-center gap-2 cursor-pointer group" onDoubleClick={() => project && onStartEditing({
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
                  <Play className="w-4 h-4" /> 繼續解析 ({project.invoices.filter(inv => inv.status === 'PENDING').length} 筆)
                </button>
              )}
              <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs rounded-lg px-2.5 py-1.5 font-bold flex items-center gap-1.5">
                ⚡ 多重解析策略
              </span>
              <div className="h-4 w-px bg-gray-200 mx-1"></div>
              <button onClick={() => erpInputRef.current?.click()} className="btn-sm btn-blue">
                <FileSpreadsheet className="w-3.5 h-3.5" /> 匯入 ERP
              </button>
              <input type="file" ref={erpInputRef} className="hidden" accept=".csv, .xlsx, .xls" onChange={onERPUpload} />

              <button onClick={() => fileInputRef.current?.click()} className="btn-sm btn-indigo">
                <Upload className="w-3.5 h-3.5" /> 上傳/補件 (OCR)
              </button>
              <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/png,image/jpeg,application/pdf,image/tiff,.tif,.tiff" onChange={(e) => e.target.files && handleFiles(e.target.files)} />

              <div className="h-4 w-px bg-gray-200 mx-1"></div>
              <div className="h-4 w-px bg-gray-200 mx-1"></div>
              <button onClick={onGoToErrorReview} className="btn-sm bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100 hover:border-rose-300 shadow-sm font-bold">
                <AlertOctagon className="w-3.5 h-3.5" /> 異常檢核
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
                  onClick={() => { cancelProcessingRef.current = true; }}
                  className="px-2 py-0.5 bg-white border border-rose-200 text-rose-500 rounded text-[10px] font-bold hover:bg-rose-50 flex items-center gap-1 shadow-sm transition-colors"
                >
                  <Square className="w-2.5 h-2.5" /> 停止解析
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <main className="max-w-[1920px] mx-auto w-full px-2 py-4 flex-1 overflow-hidden flex flex-col">
        {!project || (project.erpData.length === 0 && project.invoices.length === 0) ? (
          <div className="h-[60vh] flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center mb-4 border-4 border-white shadow-xl"><LayoutDashboard className="w-8 h-8 text-indigo-600 opacity-50" /></div>
            <h2 className="text-xl font-black text-gray-800 mb-1">專案已建立</h2>
            <p className="text-gray-400 text-xs mb-6">請匯入 ERP Excel 或直接上傳憑證開始工作</p>
            <div className="flex gap-3">
              <button onClick={() => erpInputRef.current?.click()} className="px-5 py-2 bg-white border border-gray-300 rounded-lg text-gray-600 font-bold hover:border-blue-500 hover:text-blue-600 transition-colors text-sm shadow-sm flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> 1. 匯入 Excel</button>
              <button onClick={() => fileInputRef.current?.click()} className="px-5 py-2 bg-white border border-gray-300 rounded-lg text-gray-600 font-bold hover:border-indigo-500 hover:text-indigo-600 transition-colors text-sm shadow-sm flex items-center gap-2"><Upload className="w-4 h-4" /> 2. 上傳憑證</button>
            </div>
          </div>
        ) : (
          <AuditTable
            auditList={auditList}
            selectedKey={selectedKey}
            onRowClick={onRowClick}
            onReprocess={(file) => handleFiles([file])}
            onToggleErpFlag={onToggleErpFlag}
            project={project}
          />
        )}
      </main>
      <style>{`
    .btn-sm { @apply flex items-center gap-1.5 px-3 py-1.5 rounded-md font-bold transition-all shadow-sm text-xs; }
    .btn-white { @apply border border-gray-200 bg-white text-gray-600 hover:bg-gray-50; }
    .btn-blue { @apply bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100; }
    .btn-indigo { @apply bg-indigo-600 text-white hover:bg-indigo-700 border border-transparent; }
  `}</style>
      {selectedKey && (
        <InvoiceEditor
          entries={selectedFiles}
          initialEntryId={selectedInitialFileId}
          initialInvoiceIndex={selectedInitialInvoiceIndex}
          erpRecord={selectedRow?.erp}
          auditStatus={selectedRow?.auditStatus}
          diffDetails={selectedRow?.diffDetails}
          onSave={onSave}
          onDelete={onDeleteOCR}
          onReOCR={onReOCR}
          onClose={() => onRowClick(null)}
        />
      )}

      {editingProject && (
        <EditProjectModal
          initialName={editingProject.name}
          initialYear={editingProject.year || new Date().getFullYear()}
          initialMonth={editingProject.month || new Date().getMonth() + 1}
          onSave={(name, year, month) => {
            onSaveEdit(editingProject.id, name, year, month);
          }}
          onClose={onCancelEdit}
        />
      )}
    </div>
  );
}
