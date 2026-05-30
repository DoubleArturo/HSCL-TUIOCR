import React from 'react';
import { Plus } from 'lucide-react';

interface AddSellerModalProps {
  newSellerName: string;
  newSellerTaxId: string;
  onChangeName: (name: string) => void;
  onChangeTaxId: (taxId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export default function AddSellerModal({
  newSellerName,
  newSellerTaxId,
  onChangeName,
  onChangeTaxId,
  onConfirm,
  onClose,
}: AddSellerModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl">
        <h3 className="text-lg font-black text-gray-800 mb-5 flex items-center gap-2">
          <Plus className="w-5 h-5 text-indigo-600" /> 手動新增廠商
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">廠商名稱</label>
            <input autoFocus type="text" value={newSellerName} onChange={e => onChangeName(e.target.value)} className="w-full border-2 border-gray-100 rounded-xl px-4 py-2.5 font-medium text-sm focus:border-indigo-500 outline-none transition-colors" placeholder="例：惠成工業股份有限公司" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">統一編號（8碼）</label>
            <input type="text" value={newSellerTaxId} onChange={e => onChangeTaxId(e.target.value)} maxLength={8} className="w-full border-2 border-gray-100 rounded-xl px-4 py-2.5 font-mono font-bold text-sm focus:border-indigo-500 outline-none transition-colors" placeholder="12345678" />
            {newSellerTaxId && !/^\d{8}$/.test(newSellerTaxId) && (
              <p className="text-rose-500 text-xs mt-1">必須是 8 位數字</p>
            )}
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={() => { onClose(); onChangeName(''); onChangeTaxId(''); }} className="flex-1 py-2.5 font-bold text-gray-500 hover:bg-gray-50 rounded-xl transition-colors text-sm">取消</button>
          <button onClick={onConfirm} disabled={!newSellerName.trim() || !/^\d{8}$/.test(newSellerTaxId)} className="flex-1 py-2.5 font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 transition-colors text-sm">新增</button>
        </div>
      </div>
    </div>
  );
}
