import React, { useEffect, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ArrowLeft, Trash2, ShieldCheck, User, TrendingUp, BarChart2, Clock } from 'lucide-react';
import { fetchAllUsers, deleteUser, AppUser } from '../services/authService';

// ── Supabase client ──────────────────────────────────────────────────────────
let _sb: SupabaseClient | null = null;
function getSB() {
  if (_sb) return _sb;
  _sb = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
  return _sb;
}

// ── Field label mapping ───────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  invoice_number: '發票號碼',
  invoice_date:   '發票日期',
  seller_name:    '賣方名稱',
  seller_tax_id:  '賣方統編',
  buyer_tax_id:   '買方統編',
  amount_sales:   '銷售額',
  amount_tax:     '稅額',
  amount_total:   '總金額',
  tax_code:       '稅別',
  voucher_type:   '憑證類型',
};
const fieldLabel = (name: string) => FIELD_LABELS[name] ?? name;

// ── Types ─────────────────────────────────────────────────────────────────────
interface CorrectionSummaryRow { field_name: string; tax_code: string; created_at: string; }
interface RecentRow {
  created_at: string; file_id: string; tax_code: string;
  field_name: string; original_value: string | null; corrected_value: string;
}
interface FieldCount { field: string; count: number; lastAt: string; }

// ── OCR analytics hook ────────────────────────────────────────────────────────
function useCorrectionStats() {
  const [summary, setSummary] = useState<CorrectionSummaryRow[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [{ data: s, error: e1 }, { data: r, error: e2 }] = await Promise.all([
          getSB()
            .from('ocr_corrections')
            .select('field_name, tax_code, created_at')
            .gte('created_at', thirtyDaysAgo.toISOString()),
          getSB()
            .from('ocr_corrections')
            .select('created_at, file_id, tax_code, field_name, original_value, corrected_value')
            .order('created_at', { ascending: false })
            .limit(20),
        ]);
        if (e1 || e2) { setUnavailable(true); return; }
        setSummary((s as CorrectionSummaryRow[]) ?? []);
        setRecent((r as RecentRow[]) ?? []);
      } catch {
        setUnavailable(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // client-side aggregation
  const fieldCounts: FieldCount[] = (() => {
    const map = new Map<string, { count: number; lastAt: string }>();
    for (const row of summary) {
      const prev = map.get(row.field_name);
      const rowAt = row.created_at;
      if (!prev) { map.set(row.field_name, { count: 1, lastAt: rowAt }); }
      else { prev.count++; if (rowAt > prev.lastAt) prev.lastAt = rowAt; }
    }
    return [...map.entries()]
      .map(([field, v]) => ({ field, count: v.count, lastAt: v.lastAt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  })();

  const topField = fieldCounts[0]?.field ?? null;
  const topTaxCode = (() => {
    const m = new Map<string, number>();
    for (const r of summary) m.set(r.tax_code, (m.get(r.tax_code) ?? 0) + 1);
    let best = null as string | null, max = 0;
    for (const [k, v] of m) if (v > max) { max = v; best = k; }
    return best;
  })();

  return { loading, unavailable, total: summary.length, topField, topTaxCode, fieldCounts, recent };
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-4 flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1 text-gray-400">{icon}</div>
      <div className="text-2xl font-bold font-mono text-gray-800 truncate">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function OCRAnalyticsTab() {
  const { loading, unavailable, total, topField, topTaxCode, fieldCounts, recent } = useCorrectionStats();

  if (loading) return <div className="p-12 text-center text-gray-400">載入中...</div>;

  if (unavailable) {
    return (
      <div className="p-8">
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 text-sm text-blue-700">
          尚無修正記錄。系統將在使用者開始修正 OCR 結果後自動記錄。
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Section 1 — Summary cards */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">過去 30 天摘要</p>
        <div className="flex gap-4">
          <StatCard icon={<TrendingUp className="w-4 h-4" />} value={String(total)} label="總修正次數" />
          <StatCard icon={<BarChart2 className="w-4 h-4" />} value={topField ? fieldLabel(topField) : '—'} label="最常修正欄位" />
          <StatCard icon={<BarChart2 className="w-4 h-4" />} value={topTaxCode ?? '—'} label="修正最多稅別" />
        </div>
      </div>

      {/* Section 2 — Top 10 fields */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Top 10 最常修正欄位</p>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {fieldCounts.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">尚無修正記錄</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">欄位名稱</th>
                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">修正次數</th>
                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">最近修正時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fieldCounts.map(fc => (
                  <tr key={fc.field} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{fieldLabel(fc.field)}</td>
                    <td className="px-5 py-3 font-mono font-bold text-indigo-600">{fc.count}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs font-mono">
                      {new Date(fc.lastAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Section 3 — Recent 20 corrections */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">最近 20 筆修正記錄</p>
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {recent.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">尚無修正記錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">時間</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">檔案 ID</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">稅別</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">欄位</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">原始值</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">修正後</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recent.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs font-mono whitespace-nowrap">
                        {new Date(row.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs font-mono max-w-[120px] truncate">{row.file_id}</td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] bg-gray-100 text-gray-600 font-medium px-1.5 py-0.5 rounded">{row.tax_code}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-xs font-medium whitespace-nowrap">{fieldLabel(row.field_name)}</td>
                      <td className="px-4 py-3 text-rose-400 text-xs font-mono max-w-[120px] truncate">{row.original_value ?? '（空）'}</td>
                      <td className="px-4 py-3 text-emerald-600 text-xs font-mono max-w-[120px] truncate">{row.corrected_value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface AdminPageProps {
  currentUser: AppUser;
  onBack: () => void;
}

const AdminPage: React.FC<AdminPageProps> = ({ currentUser, onBack }) => {
  const [tab, setTab] = useState(0);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAllUsers().then(data => { setUsers(data); setLoading(false); });
  }, []);

  const handleDelete = async (user: AppUser) => {
    if (!confirm(`確定要刪除使用者「${user.name}（${user.employee_id}）」？此操作無法復原。`)) return;
    setDeletingId(user.id);
    const { error } = await deleteUser(user.id);
    setDeletingId(null);
    if (error) { alert(`刪除失敗：${error}`); return; }
    setUsers(prev => prev.filter(u => u.id !== user.id));
  };

  const tabs = ['使用者管理', 'OCR 修正分析'];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">管理後台</h1>
        </div>
        {tab === 0 && <span className="ml-auto text-xs text-gray-400 font-mono">{users.length} 位使用者</span>}
      </header>

      {/* Tab bar */}
      <div className="bg-white border-b px-6">
        <div className="flex gap-0">
          {tabs.map((label, i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === i
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 0 — User management */}
      {tab === 0 && (
        <div className="max-w-2xl mx-auto p-6">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-400">載入中...</div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center text-gray-400">尚無使用者</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">工號</th>
                    <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">姓名</th>
                    <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">角色</th>
                    <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">最後登入</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono font-bold text-gray-700">{user.employee_id}</td>
                      <td className="px-5 py-3.5 font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-gray-300" />
                          {user.name}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        {user.is_admin
                          ? <span className="text-[11px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded">ADMIN</span>
                          : <span className="text-[11px] bg-gray-100 text-gray-500 font-medium px-2 py-0.5 rounded">一般</span>}
                      </td>
                      <td className="px-5 py-3.5 text-gray-400 text-xs font-mono">
                        {user.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {user.id !== currentUser.id && (
                          <button
                            onClick={() => handleDelete(user)}
                            disabled={deletingId === user.id}
                            className="p-1.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40"
                            title="刪除使用者"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tab 1 — OCR correction analytics */}
      {tab === 1 && (
        <div className="max-w-4xl mx-auto">
          <OCRAnalyticsTab />
        </div>
      )}
    </div>
  );
};

export default AdminPage;
