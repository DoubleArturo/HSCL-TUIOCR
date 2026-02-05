
export interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR';
    category: 'SYSTEM' | 'QUEUE' | 'API' | 'FILE' | 'PREPROCESSING';
    message: string;
    details?: any;
}

class SystemLogger {
    private logs: LogEntry[] = [];
    private maxLogs = 5000; // Prevent memory overflow

    log(level: LogEntry['level'], category: LogEntry['category'], message: string, details?: any) {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            category,
            message,
            details: details ? (typeof details === 'object' ? JSON.parse(JSON.stringify(details)) : details) : undefined
        };

        console.log(`[${entry.category}] ${entry.message}`, details || '');

        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift(); // Remove oldest
        }
    }

    info(category: LogEntry['category'], message: string, details?: any) {
        this.log('INFO', category, message, details);
    }

    warn(category: LogEntry['category'], message: string, details?: any) {
        this.log('WARN', category, message, details);
    }

    error(category: LogEntry['category'], message: string, details?: any) {
        this.log('ERROR', category, message, details);
    }

    exportLogs(): string {
        return JSON.stringify(this.logs, null, 2);
    }

    downloadLogs() {
        const blob = new Blob([this.exportLogs()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `system_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    clear() {
        this.logs = [];
    }
}

export const logger = new SystemLogger();
