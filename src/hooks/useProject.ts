import { useState, useRef, useEffect, useCallback } from 'react';
import type { Project, ProjectMeta, InvoiceEntry, ERPRecord } from '../../types';
import { fileStorageService } from '../../services/fileStorageService';
import { logger } from '../../services/loggerService';
import {
  fetchProjectList,
  fetchFullProject,
  upsertProject,
  upsertInvoiceEntries,
  upsertErpRecords,
  deleteProject as cloudDeleteProject,
} from '../../services/cloudSyncService';
import { pruneExpiredFilesForProject } from '../../services/cloudFileService';

// ─── localStorage helpers (cache only) ───────────────────────────────────────

function serializeProject(proj: Project): object {
  return {
    ...proj,
    updatedAt: new Date().toISOString(),
    invoices: proj.invoices.map(inv => ({
      ...inv,
      file: { name: inv.file.name, type: inv.file.type },
      previewUrl: '',
    })),
  };
}

function cacheWrite(proj: Project) {
  try {
    localStorage.setItem(`project_${proj.id}`, JSON.stringify(serializeProject(proj)));
  } catch { /* quota exceeded — cache write is best-effort */ }
}

function cacheRead(id: string): Project | null {
  try {
    const raw = localStorage.getItem(`project_${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheWriteList(list: ProjectMeta[]) {
  try { localStorage.setItem('project_list', JSON.stringify(list)); } catch { /* best-effort */ }
}

function cacheReadList(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem('project_list');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProject() {
  const [projectList, setProjectList] = useState<ProjectMeta[]>(() => cacheReadList());
  const [project, setProject] = useState<Project | null>(null);

  const isDirtyRef = useRef(false);
  const latestProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    latestProjectRef.current = project;
    if (project) isDirtyRef.current = true;
  }, [project]);

  // Startup: load list from Supabase (cache shown instantly while fetching)
  useEffect(() => {
    fetchProjectList().then(list => {
      if (list.length > 0) {
        setProjectList(list);
        cacheWriteList(list);
      }
    });

    // Auto-save dirty state every 10s
    const interval = setInterval(() => {
      if (isDirtyRef.current && latestProjectRef.current) {
        syncProject(latestProjectRef.current);
        isDirtyRef.current = false;
      }
    }, 10000);

    // Force-save when tab is hidden (handles Chrome Memory Saver / tab switching)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && isDirtyRef.current && latestProjectRef.current) {
        syncProject(latestProjectRef.current);
        isDirtyRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ─── Cloud sync ────────────────────────────────────────────────────────────

  const syncProject = useCallback(async (proj: Project) => {
    cacheWrite(proj);
    await upsertProject(proj);
    await Promise.all([
      upsertInvoiceEntries(proj.id, proj.invoices),
      upsertErpRecords(proj.id, proj.erpData),
    ]);
    // Refresh project list counts in background
    fetchProjectList().then(list => {
      setProjectList(list);
      cacheWriteList(list);
    });
  }, []);

  // ─── Project list metadata update helper ──────────────────────────────────

  const refreshListMeta = useCallback((proj: Project) => {
    setProjectList(prev => {
      const meta: ProjectMeta = {
        id: proj.id,
        name: proj.name,
        updatedAt: new Date().toISOString(),
        invoiceCount: proj.invoices.length,
        erpCount: proj.erpData.length,
        year: proj.year,
        month: proj.month,
      };
      const updated = [meta, ...prev.filter(p => p.id !== proj.id)];
      cacheWriteList(updated);
      return updated;
    });
  }, []);

  // ─── Public API ────────────────────────────────────────────────────────────

  const saveSnapshot = useCallback((proj: Project) => {
    cacheWrite(proj);
    refreshListMeta(proj);
    upsertProject(proj);
    upsertInvoiceEntries(proj.id, proj.invoices);
    upsertErpRecords(proj.id, proj.erpData);
  }, [refreshListMeta]);

  const forceSave = useCallback(() => {
    if (latestProjectRef.current) {
      saveSnapshot(latestProjectRef.current);
      isDirtyRef.current = false;
    }
  }, [saveSnapshot]);

  const createProject = useCallback((name: string, year?: number, month?: number) => {
    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name,
      invoices: [],
      erpData: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      year,
      month,
    };
    setProject(newProj);
    saveSnapshot(newProj);
    return newProj;
  }, [saveSnapshot]);

  const loadProject = useCallback(async (
    id: string,
    onError?: (invId: string, err: any) => void,
  ): Promise<boolean> => {
    // 1. Show cached version instantly if available
    const cached = cacheRead(id);
    if (cached) {
      const preloaded: Project = {
        ...cached,
        invoices: cached.invoices.map((inv: any) => ({
          ...inv,
          status: inv.status === 'PROCESSING' ? 'PENDING' : inv.status,
          file: new File([], inv.file?.name || 'unknown', { type: inv.file?.type || 'image/jpeg' }),
          previewUrl: '',
        })),
      };
      setProject(preloaded);
    }

    // 2. Fetch from Supabase (authoritative)
    const cloud = await fetchFullProject(id);
    if (!cloud) {
      // No cloud data: fall back to cache only
      if (!cached) return false;
    } else {
      const loaded: Project = {
        ...cloud,
        invoices: cloud.invoices.map((inv: any) => ({
          ...inv,
          status: inv.status === 'PROCESSING' ? 'PENDING' : inv.status,
        })),
      };
      setProject(loaded);
      cacheWrite(loaded);
      // lazy cleanup: fire-and-forget, never blocks load
      pruneExpiredFilesForProject(id).catch(() => {});
    }

    // 3. Async rehydrate images from IndexedDB
    const base = cloud ?? cached!;
    const updated = await Promise.all(base.invoices.map(async (inv: any) => {
      try {
        const dbFile = await fileStorageService.getFile(inv.id);
        if (dbFile) return { ...inv, file: dbFile, previewUrl: URL.createObjectURL(dbFile) };
      } catch (err: any) {
        logger.error('FILE', `IndexedDB Load Failed for ${inv.id}`, err);
        onError?.(inv.id, err);
      }
      return {
        ...inv,
        file: new File([], inv.file?.name || 'unknown', { type: inv.file?.type || 'image/jpeg' }),
        previewUrl: '',
      };
    }));

    setProject(prev => prev ? { ...prev, invoices: updated } : null);
    return true;
  }, []);

  const updateProjectMeta = useCallback((id: string, name: string, year: number, month: number) => {
    setProjectList(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, name, year, month } : p);
      cacheWriteList(updated);
      return updated;
    });
    setProject(prev => {
      if (!prev || prev.id !== id) return prev;
      const updatedProj = { ...prev, name, year, month };
      setTimeout(() => saveSnapshot(updatedProj), 0);
      return updatedProj;
    });
  }, [saveSnapshot]);

  const deleteProject = useCallback((id: string) => {
    try { localStorage.removeItem(`project_${id}`); } catch { /* best-effort */ }
    setProjectList(prev => {
      const updated = prev.filter(p => p.id !== id);
      cacheWriteList(updated);
      return updated;
    });
    cloudDeleteProject(id);
  }, []);

  const updateInvoices = useCallback((updater: (prev: InvoiceEntry[]) => InvoiceEntry[]) => {
    setProject(prev => prev ? { ...prev, invoices: updater(prev.invoices) } : null);
  }, []);

  const updateERP = useCallback((records: ERPRecord[]) => {
    setProject(prev => {
      if (!prev) return null;
      const updated = { ...prev, erpData: records };
      setTimeout(() => saveSnapshot(updated), 100);
      return updated;
    });
  }, [saveSnapshot]);

  const toggleErpFlag = useCallback((voucherId: string, invoiceNumbers: string[]) => {
    setProject(prev => {
      if (!prev) return null;
      return {
        ...prev,
        erpData: prev.erpData.map(erp => {
          const isMatch = erp.voucher_id === voucherId && erp.invoice_numbers.join(',') === invoiceNumbers.join(',');
          return isMatch ? { ...erp, erpFlagged: !erp.erpFlagged } : erp;
        }),
      };
    });
  }, []);

  return {
    projectList,
    project,
    setProject,
    saveSnapshot,
    forceSave,
    createProject,
    loadProject,
    deleteProject,
    updateInvoices,
    updateERP,
    toggleErpFlag,
    updateProjectMeta,
  };
}
