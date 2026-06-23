import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { login, signup, AppUser } from '../services/authService';

interface LoginScreenProps {
  onLogin: (user: AppUser) => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (tab === 'login') {
      const { user, error: err } = await login(email.trim(), password);
      setLoading(false);
      if (err) { setError(err); return; }
      if (user) onLogin(user);
    } else {
      const { user, error: err } = await signup(email.trim(), password);
      setLoading(false);
      if (err) {
        // Confirmation email sent is not a fatal error
        if (err.includes('確認信')) { setInfo(err); return; }
        setError(err);
        return;
      }
      if (user) onLogin(user);
    }
  };

  const disabled = loading || !email.trim() || password.length < 6;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-200 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">Taiwan Invoice Audit Pro</h1>
          <p className="text-sm text-gray-400 mt-1">請登入以存取您的稽核資料</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            <button
              type="button"
              onClick={() => { setTab('login'); setError(null); setInfo(null); }}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                tab === 'login'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              登入
            </button>
            <button
              type="button"
              onClick={() => { setTab('signup'); setError(null); setInfo(null); }}
              className={`flex-1 py-3 text-sm font-bold transition-colors ${
                tab === 'signup'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              建立帳號
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Email</label>
              <input
                autoFocus
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="border-2 border-gray-100 rounded-xl px-4 py-3 text-base focus:border-indigo-500 outline-none transition-colors text-gray-700"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">密碼</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="至少 6 個字元"
                className="border-2 border-gray-100 rounded-xl px-4 py-3 text-base focus:border-indigo-500 outline-none transition-colors text-gray-700"
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
            {info && (
              <p className="text-sm text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={disabled}
              className="mt-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : null}
              {loading ? (tab === 'login' ? '登入中...' : '建立中...') : (tab === 'login' ? '登入' : '建立帳號')}
            </button>
          </form>
        </div>

        {/* Tagline */}
        <p className="text-center text-xs text-gray-400 mt-4">
          資料儲存於您的專屬帳號，跨裝置同步
        </p>
      </div>
    </div>
  );
};

export default LoginScreen;
