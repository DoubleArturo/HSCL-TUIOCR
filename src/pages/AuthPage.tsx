import React, { useState } from 'react';
import { ShieldCheck, Loader2, LogIn, UserPlus } from 'lucide-react';
import { getSupabaseClient } from '../../services/supabaseService';

type Mode = 'login' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    const client = getSupabaseClient();
    if (!client) {
      setError('系統未設定 Supabase，請聯絡管理員。');
      setLoading(false);
      return;
    }

    if (mode === 'login') {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) setError(translateError(error.message));
    } else {
      const { error } = await client.auth.signUp({ email, password });
      if (error) {
        setError(translateError(error.message));
      } else {
        setSuccessMsg('帳號建立成功！請查收驗證信，點擊連結後即可登入。');
        setMode('login');
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-200 mb-4">
            <ShieldCheck className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">Taiwan Invoice Audit Pro</h1>
          <p className="text-gray-400 text-sm mt-1">請登入以存取您的稽核資料</p>
        </div>

        {/* Mode Toggle */}
        <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'login' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LogIn className="w-4 h-4 inline mr-1.5" />登入
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); setSuccessMsg(''); }}
            className={`flex-1 py-2 rounded-lg font-bold text-sm transition-all ${mode === 'signup' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <UserPlus className="w-4 h-4 inline mr-1.5" />建立帳號
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">電子郵件</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="your@email.com"
              className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-medium focus:border-indigo-500 outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1.5 uppercase tracking-wider">密碼</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="至少 6 個字元"
              className="w-full border-2 border-gray-100 rounded-xl px-4 py-3 text-sm font-medium focus:border-indigo-500 outline-none transition-colors"
            />
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm rounded-xl px-4 py-3 font-medium">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl px-4 py-3 font-medium">
              {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> 處理中...</>
              : mode === 'login' ? '登入' : '建立帳號'
            }
          </button>
        </form>
      </div>

      <p className="text-gray-300 text-xs mt-6">資料儲存於您的專屬帳號，跨裝置同步</p>
    </div>
  );
}

function translateError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return '電子郵件或密碼錯誤';
  if (msg.includes('Email not confirmed')) return '請先點擊驗證信連結，再登入';
  if (msg.includes('User already registered')) return '此信箱已有帳號，請直接登入';
  if (msg.includes('Password should be')) return '密碼至少需要 6 個字元';
  return msg;
}
