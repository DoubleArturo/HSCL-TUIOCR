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
        if (cloudList.length > 0) {
          // Cloud has data — it's the source of truth
          setProjectList(cloudList);
          localStorage.setItem('project_list', JSON.stringify(cloudList));
        } else {
          // Cloud is empty (first login or no cloud projects yet).
          // Fall back to any existing localStorage data so the user still
          // sees their locally-cached projects.
          const stored = localStorage.getItem('project_list');
          if (stored) {
            try { setProjectList(JSON.parse(stored)); } catch { /* ignore */ }
          }
        }
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
