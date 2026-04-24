import { useState, useRef, useEffect, useCallback } from 'react';
import type { Project, ProjectMeta, InvoiceEntry, ERPRecord } from '../../types';
import { fileStorageService } from '../../services/fileStorageService';
import { logger } from '../../services/loggerService';

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

export function useProject() {
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [project, setProject] = useState<Project | null>(null);

  const isDirtyRef = useRef(false);
  const latestProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    latestProjectRef.current = project;
    if (project) isDirtyRef.current = true;
  }, [project]);

  // Load project list + setup auto-save
  useEffect(() => {
    const stored = localStorage.getItem('project_list');
    if (stored) setProjectList(JSON.parse(stored));

    const interval = setInterval(() => {
      if (isDirtyRef.current && latestProjectRef.current) {
        saveSnapshot(latestProjectRef.current);
        isDirtyRef.current = false;
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const saveSnapshot = useCallback((proj: Project) => {
    const serializable = serializeProject(proj);
    localStorage.setItem(`project_${proj.id}`, JSON.stringify(serializable));
    setProjectList(prev => {
      const meta: ProjectMeta = {
        id: proj.id,
        name: proj.name,
        updatedAt: new Date().toISOString(),
        invoiceCount: proj.invoices.length,
        erpCount: proj.erpData.length,
      };
      const updated = [meta, ...prev.filter(p => p.id !== proj.id)];
      localStorage.setItem('project_list', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const createProject = useCallback((name: string) => {
    const newProj: Project = {
      id: `proj_${Date.now()}`,
      name,
      invoices: [],
      erpData: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProject(newProj);
    saveSnapshot(newProj);
    return newProj;
  }, [saveSnapshot]);

  const loadProject = useCallback(async (id: string): Promise<boolean> => {
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
      }
      return { ...inv, file: new File([], inv.file.name || 'unknown', { type: inv.file.type || 'image/jpeg' }), previewUrl: '' };
    }));
    setProject(prev => prev ? { ...prev, invoices: updated } : null);
    return true;
  }, []);

  const deleteProject = useCallback((id: string) => {
    localStorage.removeItem(`project_${id}`);
    setProjectList(prev => {
      const updated = prev.filter(p => p.id !== id);
      localStorage.setItem('project_list', JSON.stringify(updated));
      return updated;
    });
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
    createProject,
    loadProject,
    deleteProject,
    updateInvoices,
    updateERP,
    toggleErpFlag,
  };
}
