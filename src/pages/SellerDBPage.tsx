import React from 'react';
import { ArrowLeftRight, Database, Plus, Search, Loader2, Trash2 } from 'lucide-react';
import { useSellers } from '../hooks/useSellers';
import AddSellerModal from '../components/modals/AddSellerModal';

interface SellerDBPageProps {
  onBack: () => void;
}

export default function SellerDBPage({ onBack }: SellerDBPageProps) {
  const {
    sellerRows,
    sellerSearchQuery,
    setSellerSearchQuery,
    sellerDbLoading,
    isAddingNewSeller,
    setIsAddingNewSeller,
    newSellerName,
    setNewSellerName,
    newSellerTaxId,
    setNewSellerTaxId,
    handleAddNewSeller,
    handleDeleteSeller,
  } = useSellers();

  const sourceBadge = (source: string) => {
    const map: Record<string, string> = {
      ocr: 'bg-blue-50 text-blue-600',
      erp: 'bg-emerald-50 text-emerald-600',
      manual: 'bg-gray-100 text-gray-500',
    };
    return map[source] || 'bg-gray-100 text-gray-500';
  };

  const filtered = sellerRows.filter(r =>
    r.seller_name.includes(sellerSearchQuery) || r.seller_tax_id.includes(sellerSearchQuery)
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
              <ArrowLeftRight className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                <Database className="w-6 h-6 text-indigo-600" /> 廠商資料庫
              </h1>
              <p className="text-gray-500 text-sm mt-0.5">OCR 自動累積 · ERP 匯入同步 · 手動維護</p>
            </div>
          </div>
          <button onClick={() => setIsAddingNewSeller(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all active:scale-95 text-sm">
            <Plus className="w-4 h-4" /> 手動新增
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜尋廠商名稱或統一編號..."
                value={sellerSearchQuery}
                onChange={e => setSellerSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          </div>

          {sellerDbLoading ? (
            <div className="p-16 text-center text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
              載入中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-16 text-center">
              <Database className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">{sellerSearchQuery ? '找不到符合的廠商' : '尚無廠商資料'}</p>
              <p className="text-gray-300 text-sm mt-1">OCR 辨識後會自動新增</p>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_120px_80px_56px] gap-x-4 px-6 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <span>廠商名稱</span>
                <span>統一編號</span>
                <span>來源</span>
                <span></span>
              </div>
              <div className="divide-y divide-gray-50">
                {filtered.map(r => (
                  <div key={r.id} className="grid grid-cols-[1fr_120px_80px_56px] gap-x-4 items-center px-6 py-3.5 hover:bg-gray-50 transition-colors">
                    <span className="font-medium text-gray-800 text-sm truncate">{r.seller_name}</span>
                    <span className="font-mono text-sm text-gray-600">{r.seller_tax_id}</span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg w-fit ${sourceBadge(r.source)}`}>{r.source}</span>
                    <button onClick={() => handleDeleteSeller(r.id)} className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-400">
                共 {filtered.length} 筆{sellerSearchQuery ? `（篩選自 ${sellerRows.length} 筆）` : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {isAddingNewSeller && (
        <AddSellerModal
          newSellerName={newSellerName}
          newSellerTaxId={newSellerTaxId}
          onChangeName={setNewSellerName}
          onChangeTaxId={setNewSellerTaxId}
          onConfirm={handleAddNewSeller}
          onClose={() => { setIsAddingNewSeller(false); setNewSellerName(''); setNewSellerTaxId(''); }}
        />
      )}
    </div>
  );
}
