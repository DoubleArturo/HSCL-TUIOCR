import React, { useState } from 'react';
import { ShieldCheck, LogIn } from 'lucide-react';
import { login, AppUser } from '../services/authService';

interface LoginScreenProps {
  onLogin: (user: AppUser) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [employeeId, setEmployeeId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { user, error: err } = await login(employeeId, name);
    setLoading(false);
    if (err) { setError(err); return; }
    if (user) onLogin(user);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-200 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Taiwan Invoice Audit Pro</h1>
          <p className="text-sm text-gray-400 mt-1">請輸入工號與姓名登入</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">工號</label>
            <input
              autoFocus
              type="text"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value.toUpperCase())}
              placeholder="例：A1282"
              maxLength={5}
              className="border-2 border-gray-100 rounded-xl px-4 py-3 font-mono font-bold text-lg focus:border-indigo-500 outline-none transition-colors text-gray-700 tracking-widest"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">姓名</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例：范文瑞"
              className="border-2 border-gray-100 rounded-xl px-4 py-3 font-bold text-base focus:border-indigo-500 outline-none transition-colors text-gray-700"
            />
          </div>

          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !employeeId.trim() || !name.trim()}
            className="mt-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {loading ? '登入中...' : '登入'}
          </button>

          <p className="text-center text-xs text-gray-400">
            首次登入將自動建立帳號
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;
