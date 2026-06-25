import React, { useState } from 'react';
import { Calendar } from 'lucide-react';

interface CreateProjectModalProps {
  onConfirm: (year: number, month: number) => void;
  onClose: () => void;
}

export default function CreateProjectModal({ onConfirm, onClose }: CreateProjectModalProps) {
  const now = new Date();
  const [createYear, setCreateYear] = useState(now.getFullYear());
  const [createMonth, setCreateMonth] = useState(now.getMonth() + 1);

  return (
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
          <button onClick={onClose} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors">取消</button>
          <button onClick={() => onConfirm(createYear, createMonth)} className="flex-1 py-3 font-bold bg-indigo-600 text-white rounded-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-colors">建立專案</button>
        </div>
      </div>
    </div>
  );
}
