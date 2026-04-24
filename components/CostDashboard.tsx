import React from 'react';
import { Zap, BarChart3, CheckCircle2, ScanLine } from 'lucide-react';
import { Project } from '../types';

interface CostDashboardProps {
    project: Project | null;
    erpMatchRate: number;
    ocrAccuracy: number;
    modelName: string;
    totalDuration: number;
    uploaded: number;
    missing: number;
    total: number;
    erpDiscrepancyCount: number;
}

function colorClass(pct: number) {
    if (pct >= 90) return { text: 'text-emerald-600', bg: 'bg-emerald-100 text-emerald-600' };
    if (pct >= 70) return { text: 'text-amber-600', bg: 'bg-amber-100 text-amber-600' };
    return { text: 'text-rose-600', bg: 'bg-rose-100 text-rose-600' };
}

const CostDashboard: React.FC<CostDashboardProps> = ({
    project, erpMatchRate, ocrAccuracy, totalDuration,
    uploaded, missing, total, erpDiscrepancyCount,
}) => {
    if (!project) return null;

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const sec = Math.floor(ms / 1000);
        const min = Math.floor(sec / 60);
        return min > 0 ? `${min}m ${sec % 60}s` : `${sec}s`;
    };

    const ocrC = colorClass(ocrAccuracy);
    const erpC = colorClass(erpMatchRate);

    return (
        <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-6 flex-wrap">

            {/* OCR Accuracy — primary metric */}
            <div className="flex items-center gap-3" title="AI辨識正確率：MATCH + 已確認ERP問題的筆數 ÷ 已匯入，反映AI讀取能力">
                <div className={`p-1.5 rounded-lg ${ocrC.bg}`}>
                    <ScanLine className="w-5 h-5" />
                </div>
                <div className="flex flex-col leading-none">
                    <span className={`text-2xl font-extrabold font-mono ${ocrC.text}`}>
                        {uploaded > 0 ? `${ocrAccuracy.toFixed(1)}%` : '—'}
                    </span>
                    <span className="text-[10px] text-gray-400 mt-0.5">
                        AI辨識率
                        {erpDiscrepancyCount > 0 && (
                            <span className="ml-1 text-indigo-400">(含{erpDiscrepancyCount}筆ERP問題)</span>
                        )}
                    </span>
                </div>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            {/* ERP Match Rate — secondary metric */}
            <div className="flex items-center gap-3" title="ERP比對正確率：MATCH ÷ 已匯入，受ERP資料品質影響">
                <div className={`p-1.5 rounded-lg ${erpC.bg}`}>
                    <BarChart3 className="w-5 h-5" />
                </div>
                <div className="flex flex-col leading-none">
                    <span className={`text-2xl font-extrabold font-mono ${erpC.text}`}>
                        {uploaded > 0 ? `${erpMatchRate.toFixed(1)}%` : '—'}
                    </span>
                    <span className="text-[10px] text-gray-400 mt-0.5">ERP比對率</span>
                </div>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            {/* Upload breakdown */}
            <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex flex-col items-center leading-none">
                    <span className="text-lg font-extrabold text-emerald-600">{uploaded}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">已匯入</span>
                </div>
                <div className="text-gray-300 text-lg font-light">/</div>
                <div className="flex flex-col items-center leading-none">
                    <span className="text-lg font-extrabold text-rose-400">{missing}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">未匯入</span>
                </div>
                <div className="text-gray-300 text-lg font-light">/</div>
                <div className="flex flex-col items-center leading-none">
                    <span className="text-lg font-extrabold text-slate-600">{total}</span>
                    <span className="text-[10px] text-gray-400 mt-0.5">總計</span>
                </div>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            {/* Time */}
            <div className="flex items-center gap-3">
                <div className="bg-purple-50 p-1.5 rounded-lg text-purple-600">
                    <Zap className="w-5 h-5" />
                </div>
                <div className="flex flex-col leading-none">
                    <span className="text-2xl font-extrabold font-mono text-slate-700">
                        {totalDuration > 0 ? formatDuration(totalDuration) : '—'}
                    </span>
                    <span className="text-[10px] text-gray-400 mt-0.5">解析耗時</span>
                </div>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg">
                    ⚡ 多重解析策略
                </span>
            </div>
        </div>
    );
};

export default CostDashboard;
