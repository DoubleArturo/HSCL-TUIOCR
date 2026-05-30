import React, { useState } from 'react';
import { Database, PlusSquare, FolderOpen, Trash2, ChevronRight, ShieldCheck, LogOut } from 'lucide-react';
import { ProjectMeta } from '../../types';
import CreateProjectModal from '../components/modals/CreateProjectModal';
import EditProjectModal from '../components/modals/EditProjectModal';

interface ProjectListPageProps {
  projectList: ProjectMeta[];
  onLoadProject: (id: string) => void;
  onDeleteProject: (id: string, e: React.MouseEvent) => void;
  onOpenSellerDB: () => void;
  onCreateProject: (year: number, month: number) => void;
  editingProject: ProjectMeta | null;
  onStartEditing: (p: ProjectMeta, e: React.MouseEvent) => void;
  onSaveEdit: (id: string, name: string, year: number, month: number) => void;
  onCancelEdit: () => void;
  userEmail?: string;
  onSignOut?: () => void;
}

export default function ProjectListPage({
  projectList,
  onLoadProject,
  onDeleteProject,
  onOpenSellerDB,
  onCreateProject,
  editingProject,
  onStartEditing,
  onSaveEdit,
  onCancelEdit,
  userEmail,
  onSignOut,
}: ProjectListPageProps) {
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-black text-gray-800 tracking-tight flex items-center gap-3">
              <div className="bg-indigo-600 p-2 rounded-xl shadow-lg shadow-indigo-200"><ShieldCheck className="w-8 h-8 text-white" /></div>
              Taiwan Invoice Audit Pro
            </h1>
            <p className="text-gray-500 mt-2 font-medium">請選擇或建立月份稽核專案</p>
          </div>
          <div className="flex items-center gap-3">
            {userEmail && onSignOut && (
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 shadow-sm">
                <span className="text-xs text-gray-500 font-medium max-w-[180px] truncate">{userEmail}</span>
                <button onClick={onSignOut} className="text-gray-400 hover:text-rose-500 transition-colors ml-1" title="登出">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
            <button onClick={onOpenSellerDB} className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 px-5 py-3 rounded-xl font-bold shadow-sm flex items-center gap-2 transition-all active:scale-95">
              <Database className="w-4 h-4" /> 廠商資料庫
            </button>
            <button onClick={() => setIsCreating(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all active:scale-95">
              <PlusSquare className="w-5 h-5" /> 建立新專案
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
                <div key={p.id} onClick={() => onLoadProject(p.id)} onDoubleClick={(e) => onStartEditing(p, e)} className="p-6 flex items-center justify-between hover:bg-gray-50 cursor-pointer group transition-colors">
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
                    <button onClick={(e) => onDeleteProject(p.id, e)} className="p-2 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all opacity-0 group-hover:opacity-100">
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
        <CreateProjectModal
          onConfirm={(year, month) => {
            onCreateProject(year, month);
            setIsCreating(false);
          }}
          onClose={() => setIsCreating(false)}
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
