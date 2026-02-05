
import React from 'react';
import { DollarSign, Zap, BarChart3, TrendingDown } from 'lucide-react';
import { Project } from '../types';

interface CostDashboardProps {
    project: Project | null;
    accuracy: number; // 0-100
    modelName: string;
    totalDuration: number; // ms
}

const CostDashboard: React.FC<CostDashboardProps> = ({ project, accuracy, modelName, totalDuration }) => {
    if (!project) return null;

    // Calculate stats
    const totalInvoices = project.invoices.filter(i => i.status === 'SUCCESS').length;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    project.invoices.forEach(inv => {
        inv.data.forEach(d => {
            if (d.usage_metadata) {
                totalInputTokens += d.usage_metadata.promptTokenCount;
                totalOutputTokens += d.usage_metadata.candidatesTokenCount;
                totalCost += d.usage_metadata.cost_usd || 0;
            }
        });
    });

    // Compare to Pro Model (approx 50x more expensive)
    // Pro Pricing (approx): Input $1.25/M, Output $5.00/M
    // Flash Pricing: Input $0.075/M, Output $0.30/M
    const proCost = (totalInputTokens / 1000000 * 1.25) + (totalOutputTokens / 1000000 * 5.00);
    const savings = proCost - totalCost;
    const savingsPercent = proCost > 0 ? (savings / proCost) * 100 : 0;

    const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms}ms`;
        const sec = Math.floor(ms / 1000);
        const min = Math.floor(sec / 60);
        if (min > 0) return `${min}m ${sec % 60}s`;
        return `${sec}s`;
    };

    return (
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between text-xs font-mono w-full">
            <div className="flex items-center gap-6 overflow-x-auto no-scrollbar">
                {/* Accuracy Badge */}
                <div className="flex items-center gap-2" title="Audit Accuracy (Match Rate)">
                    <div className={`p-1 rounded-md ${accuracy === 100 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        <BarChart3 className="w-3.5 h-3.5" />
                    </div>
                    <span className={`font-bold ${accuracy === 100 ? 'text-emerald-700' : 'text-amber-700'}`}>{accuracy.toFixed(1)}%</span>
                    <span className="text-gray-400">Correct</span>
                </div>

                {/* Duration Badge */}
                <div className="flex items-center gap-2" title="Total Batch Processing Time">
                    <div className="bg-purple-50 p-1 rounded-md text-purple-600"><Zap className="w-3.5 h-3.5" /></div>
                    <span className="font-bold text-slate-700">{formatDuration(totalDuration)}</span>
                    <span className="text-gray-400">Time</span>
                </div>

                <div className="flex items-center gap-2 text-gray-600" title="Total API Cost">
                    <div className="bg-emerald-100 p-1 rounded-md text-emerald-600"><DollarSign className="w-3.5 h-3.5" /></div>
                    <span className="font-bold text-emerald-700">${totalCost.toFixed(5)}</span>
                    <span className="text-gray-400">Cost</span>
                </div>

                <div className="flex items-center gap-2 text-gray-600 hidden lg:flex" title="Tokens Used">
                    <div className="bg-blue-50 p-1 rounded-md text-blue-600"><Zap className="w-3.5 h-3.5" /></div>
                    <span className="font-bold text-slate-700">{(totalInputTokens + totalOutputTokens).toLocaleString()}</span>
                    <span className="text-gray-400 hidden xl:inline">Tokens</span>
                </div>

                {totalCost > 0 && (
                    <div className="flex items-center gap-2 text-gray-600 hidden xl:flex" title="Estimated Savings vs Gemini Pro">
                        <div className="bg-indigo-50 p-1 rounded-md text-indigo-600"><TrendingDown className="w-3.5 h-3.5" /></div>
                        <span className="font-bold text-indigo-600">${savings.toFixed(4)} ({savingsPercent.toFixed(0)}%)</span>
                        <span className="hidden 2xl:inline text-gray-400">Savings</span>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2 text-gray-400 pl-4 border-l border-gray-100 ml-4 flex-shrink-0">
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-bold">{modelName}</span>
            </div>
        </div>
    );
};

export default CostDashboard;
