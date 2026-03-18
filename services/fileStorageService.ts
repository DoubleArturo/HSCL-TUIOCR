
const DB_NAME = 'InvoiceOCRDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

interface StoredFile {
    id: string;
    blob?: Blob;
    buffer?: ArrayBuffer;
    name: string;
    type: string;
    timestamp: number;
}

export const fileStorageService = {
    async openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => reject('IndexedDB error');
            request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    },

    async saveFile(id: string, file: File): Promise<void> {
        const db = await this.openDB();
        
        // Use ArrayBuffer for cross-browser stability (Edge/Safari bugs with Blob directly in IDB)
        const buffer = await file.arrayBuffer();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put({ 
                id, 
                buffer, // Store as safe ArrayBuffer
                name: file.name,
                type: file.type,
                timestamp: Date.now() 
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject('Failed to save file');
        });
    },

    async getFile(id: string): Promise<File | null> {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                const result = request.result as StoredFile;
                if (!result) return resolve(null);
                
                // 1. New safe approach: ArrayBuffer
                if (result.buffer) {
                    resolve(new File([result.buffer], result.name, { type: result.type }));
                } 
                // 2. Legacy: File or Blob object
                else {
                    const fileData = (result as any).file;
                    if (fileData instanceof File || fileData instanceof Blob) {
                        resolve(new File([fileData], result.name || (fileData as any).name || 'unknown', { type: result.type || fileData.type }));
                    } else if (result.blob) {
                        resolve(new File([result.blob], result.name, { type: result.type }));
                    } else {
                        resolve(null);
                    }
                }
            };
            request.onerror = () => reject('Failed to get file');
        });
    },

    async deleteFile(id: string): Promise<void> {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject('Failed to delete file');
        });
    },

    /**
     * Delete files older than maxAgeMs
     * Default: 30 days (30 * 24 * 60 * 60 * 1000)
     */
    async pruneOldFiles(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const now = Date.now();
            let deletedCount = 0;

            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
                if (cursor) {
                    const record = cursor.value as StoredFile;
                    if (now - record.timestamp > maxAgeMs) {
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    resolve(deletedCount);
                }
            };
            request.onerror = () => reject('Failed to prune files');
        });
    }
};
