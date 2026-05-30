import React, { useState } from 'react';
import { Edit3 } from 'lucide-react';

interface EditProjectModalProps {
  initialName: string;
  initialYear: number;
  initialMonth: number;
  onSave: (name: string, year: number, month: number) => void;
  onClose: () => void;
}

export default function EditProjectModal({
  initialName,
  initialYear,
  initialMonth,
  onSave,
  onClose,
}: EditProjectModalProps) {
  const [editName, setEditName] = useState(initialName);
  const [editYear, setEditYear] = useState(initialYear);
  const [editMonth, setEditMonth] = useState(initialMonth);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
        <h3 className="text-xl font-black text-gray-800 mb-6 flex items-center gap-2">
          <Edit3 className="w-6 h-6 text-indigo-600" />
          編輯專案
        </h3>
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">專案名稱</label>
            <input autoFocus type="text" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSave(editName, editYear, editMonth); if (e.key === 'Escape') onClose(); }} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-base focus:border-indigo-500 outline-none transition-colors text-gray-700" placeholder="輸入專案名稱" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">年度 (Year)</label>
            <input type="number" value={editYear} onChange={e => setEditYear(parseInt(e.target.value))} className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 font-mono font-bold text-xl text-center focus:border-indigo-500 outline-none transition-colors text-gray-700" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">月份 (Month)</label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => (
                <button key={m} onClick={() => setEditMonth(m)} className={`py-2.5 rounded-xl font-bold text-sm transition-all ${editMonth === m ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>{m}月</button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">取消</button>
          <button onClick={() => onSave(editName, editYear, editMonth)} className="flex-1 py-3 font-bold bg-indigo-600 text-white rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-colors">保存</button>
        </div>
      </div>
    </div>
  );
}
