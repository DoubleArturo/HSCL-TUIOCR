import { useState, useRef, useEffect, useCallback } from 'react';
import type { Project, ProjectMeta, InvoiceEntry, ERPRecord } from '../../types';
import { fileStorageService } from '../../services/fileStorageService';
import { logger } from '../../services/loggerService';
import {
  fetchCloudProjects,
  fetchCloudProject,
  saveProjectToCloud,
  deleteCloudProject,
  uploadInvoiceFile,
} from '../../services/supabaseService';

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

export function useProject(userId?: string) {
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [project, setProject] = useState<Project | null>(null);

  const isDirtyRef = useRef(false);
  const latestProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    latestProjectRef.current = project;
    if (project) isDirtyRef.current = true;
  }, [project]);

  // Load project list (cloud if logged in, else localStorage)
  useEffect(() => {
    if (userId) {
      fetchCloudProjects(userId).then(cloudList => {
        const storedRaw = localStorage.getItem('project_list');
        const localList: ProjectMeta[] = storedRaw
          ? (() => { try { return JSON.parse(storedRaw); } catch { return []; } })()
          : [];

        if (cloudList.length === 0) {
          // Cloud empty — keep local data intact (first login, no cloud yet, or cloud error)
          if (localList.length > 0) setProjectList(localList);
          return;
        }

        // Merge: per-project, keep whichever version has the later updatedAt.
        // This guards against stale cloud data overwriting newer local edits
        // (e.g. when cloud sync silently failed in the previous session).
        const localMap = new Map(localList.map((p: ProjectMeta) => [p.id, p]));
        const mergedList: ProjectMeta[] = cloudList.map(cp => {
          const lp = localMap.get(cp.id);
          if (!lp) return cp;
          const cloudTime = new Date(cp.updatedAt || 0).getTime();
          const localTime = new Date(lp.updatedAt || 0).getTime();
          return localTime > cloudTime ? lp : cp;
        });
        // Preserve local-only projects not yet synced to cloud
        localList.forEach((lp: ProjectMeta) => {
          if (!cloudList.find(cp => cp.id === lp.id)) mergedList.push(lp);
        });

        setProjectList(mergedList);
        localStorage.setItem('project_list', JSON.stringify(mergedList));
      }).catch(() => {
        // Network error: fall back to localStorage cache
        const stored = localStorage.getItem('project_list');
        if (stored) setProjectList(JSON.parse(stored));
      });
    } else {
      const stored = localStorage.getItem('project_list');
      if (stored) setProjectList(JSON.parse(stored));
    }

    // Auto-save interval (10s)
    const interval = setInterval(() => {
      if (isDirtyRef.current && latestProjectRef.current) {
        saveSnapshot(latestProjectRef.current);
        isDirtyRef.current = false;
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSnapshot = useCallback((proj: Project) => {
    // 1. localStorage (always, as local cache)
    const serializable = serializeProject(proj);
    localStorage.setItem(`project_${proj.id}`, JSON.stringify(serializable));
    setProjectList(prev => {
      const meta: ProjectMeta = {
        id: proj.id, name: proj.name,
        updatedAt: new Date().toISOString(),
        invoiceCount: proj.invoices.length,
        erpCount: proj.erpData.length,
        year: proj.year, month: proj.month,
      };
      const updated = [meta, ...prev.filter(p => p.id !== proj.id)];
      localStorage.setItem('project_list', JSON.stringify(updated));
      return updated;
    });

    // 2. Cloud sync (non-blocking, best-effort)
    if (userId) {
      saveProjectToCloud(userId, proj).catch(e =>
        console.warn('[Cloud] auto-save failed:', e)
      );
    }
  }, [userId]);

  const createProject = useCallback((name: string, year?: number, month?: number) => {
    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name, invoices: [], erpData: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      year, month,
    };
    setProject(newProj);
    saveSnapshot(newProj);
    return newProj;
  }, [saveSnapshot]);

  const loadProject = useCallback(async (
    id: string,
    onError?: (invId: string, err: any) => void,
  ): Promise<boolean> => {
    // Try cloud first (if logged in)
    if (userId) {
      try {
        const cloudProject = await fetchCloudProject(userId, id);
        if (cloudProject) {
          // Guard against stale cloud data: if local cache has a newer updatedAt
          // (e.g. cloud sync failed silently last session), skip cloud and use local.
          let skipCloud = false;
          const storedRaw = localStorage.getItem(`project_${id}`);
          if (storedRaw) {
            try {
              const stored = JSON.parse(storedRaw);
              const cloudTime = new Date(cloudProject.updatedAt || 0).getTime();
              const localTime = new Date(stored.updatedAt || 0).getTime();
              if (localTime > cloudTime) {
                skipCloud = true;
                console.warn('[Cloud] Local cache is newer than cloud — using local to avoid overwriting unsaved edits.');
              }
            } catch { /* ignore JSON parse error */ }
          }

          if (!skipCloud) {
            setProject(cloudProject);

            // Rehydrate files: IndexedDB cache → Supabase Storage fallback
            const updated = await Promise.all(cloudProject.invoices.map(async (inv) => {
              try {
                const file = await fileStorageService.getFileWithCloudFallback(inv.id, inv.storagePath);
                if (file) return { ...inv, file, previewUrl: URL.createObjectURL(file) };
              } catch (err: any) {
                logger.error('FILE', `Load failed for ${inv.id}`, err);
                onError?.(inv.id, err);
              }
              return inv;
            }));
            setProject(prev => prev ? { ...prev, invoices: updated } : null);

            // Sync to localStorage cache
            const serializable = serializeProject({ ...cloudProject, invoices: updated });
            localStorage.setItem(`project_${id}`, JSON.stringify(serializable));
            return true;
          }
          // skipCloud=true: fall through to localStorage path below
        }
      } catch (e) {
        console.warn('[Cloud] loadProject failed, falling back to localStorage:', e);
      }
    }

    // Fall back to localStorage
    const data = localStorage.getItem(`project_${id}`);
    if (!data) return false;

    const loaded: Project = JSON.parse(data);
    loaded.invoices = loaded.invoices.map((inv: any) => ({
      ...inv,
      status: inv.status === 'PROCESSING' ? 'PENDING' : inv.status,
      file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }),
      previewUrl: '',
    }));
    setProject(loaded);

    // Async rehydrate images from IndexedDB
    const updated = await Promise.all(loaded.invoices.map(async (inv: any) => {
      try {
        const dbFile = await fileStorageService.getFile(inv.id);
        if (dbFile) return { ...inv, file: dbFile, previewUrl: URL.createObjectURL(dbFile) };
      } catch (err: any) {
        logger.error('FILE', `IndexedDB Load Failed for ${inv.id}`, err);
        onError?.(inv.id, err);
      }
      return { ...inv, file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }), previewUrl: '' };
    }));
    setProject(prev => prev ? { ...prev, invoices: updated } : null);
    return true;
  }, [userId]);

  const updateProjectMeta = useCallback((id: string, name: string, year: number, month: number) => {
    setProjectList(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, name, year, month } : p);
      localStorage.setItem('project_list', JSON.stringify(updated));
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
    localStorage.removeItem(`project_${id}`);
    setProjectList(prev => {
      const updated = prev.filter(p => p.id !== id);
      localStorage.setItem('project_list', JSON.stringify(updated));
      return updated;
    });
    if (userId) {
      deleteCloudProject(userId, id).catch(e =>
        console.warn('[Cloud] deleteProject failed:', e)
      );
    }
  }, [userId]);

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

  // Upload invoice file to Supabase Storage in the background
  const syncFileToCloud = useCallback(async (projectId: string, invoiceId: string, file: File) => {
    if (!userId) return;
    try {
      const storagePath = await uploadInvoiceFile(userId, projectId, invoiceId, file);
      if (storagePath) {
        setProject(prev => {
          if (!prev) return null;
          return {
            ...prev,
            invoices: prev.invoices.map(inv =>
              inv.id === invoiceId ? { ...inv, storagePath } : inv
            ),
          };
        });
      }
    } catch (e) {
      console.warn('[Cloud] syncFileToCloud failed:', e);
    }
  }, [userId]);

  return {
    projectList,
    project,
    setProject,
    saveSnapshot,
    createProject,
    loadProject,
    deleteProject,
    updateInvoices,
    updateERP,
    toggleErpFlag,
    updateProjectMeta,
    syncFileToCloud,
  };
}
