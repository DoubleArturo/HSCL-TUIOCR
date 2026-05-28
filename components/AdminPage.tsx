import React, { useEffect, useState } from 'react';
import { ArrowLeft, Trash2, ShieldCheck, User } from 'lucide-react';
import { fetchAllUsers, deleteUser, AppUser } from '../services/authService';

interface AdminPageProps {
  currentUser: AppUser;
  onBack: () => void;
}

const AdminPage: React.FC<AdminPageProps> = ({ currentUser, onBack }) => {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">使用者管理</h1>
        </div>
        <span className="ml-auto text-xs text-gray-400 font-mono">{users.length} 位使用者</span>
      </header>

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
    </div>
  );
};

export default AdminPage;
