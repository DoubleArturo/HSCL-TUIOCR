
import React from 'react';
import { Zap, BarChart3, CheckCircle2 } from 'lucide-react';
import { Project } from '../types';

interface CostDashboardProps {
    project: Project | null;
    accuracy: number; // 0-100
    modelName: string;
    totalDuration: number; // ms
    parsed: number;
    total: number;
}

const CostDashboard: React.FC<CostDashboardProps> = ({ project, accuracy, totalDuration, parsed, total }) => {
    if (!project) return null;

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const sec = Math.floor(ms / 1000);
        const min = Math.floor(sec / 60);
        if (min > 0) return `${min}m ${sec % 60}s`;
        return `${sec}s`;
    };

    const isHigh = accuracy >= 90;
    const isMid = accuracy >= 70 && accuracy < 90;

    return (
        <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-8">
            {/* Accuracy */}
            <div className="flex items-center gap-3" title={`已解析 ${parsed} / ${total} 筆（排除外國Invoice及待解析）`}>
                <div className={`p-1.5 rounded-lg ${isHigh ? 'bg-emerald-100 text-emerald-600' : isMid ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
                    <BarChart3 className="w-5 h-5" />
                </div>
                <div className="flex flex-col leading-none">
                    <span className={`text-2xl font-extrabold font-mono ${isHigh ? 'text-emerald-600' : isMid ? 'text-amber-600' : 'text-rose-600'}`}>
                        {accuracy.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-gray-400 mt-0.5">對帳正確率 ({parsed}/{total})</span>
                </div>
            </div>

            <div className="h-8 w-px bg-gray-200" />

            {/* Time */}
            <div className="flex items-center gap-3" title="批次解析總耗時">
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

            {/* Strategy badge */}
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
