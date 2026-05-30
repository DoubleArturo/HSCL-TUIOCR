import { useState } from 'react';
import {
  SellerRow,
  fetchAllSellerRows,
  upsertSeller,
  deleteSeller,
} from '../../services/supabaseService';

export function useSellers() {
  const [sellerRows, setSellerRows] = useState<SellerRow[]>([]);
  const [sellerSearchQuery, setSellerSearchQuery] = useState('');
  const [sellerDbLoading, setSellerDbLoading] = useState(false);
  const [isAddingNewSeller, setIsAddingNewSeller] = useState(false);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerTaxId, setNewSellerTaxId] = useState('');

  const loadSellerDB = async () => {
    setSellerDbLoading(true);
    const rows = await fetchAllSellerRows();
    setSellerRows(rows);
    setSellerDbLoading(false);
  };

  const handleAddNewSeller = async () => {
    if (!newSellerName.trim() || !/^\d{8}$/.test(newSellerTaxId.trim())) return;
    await upsertSeller(newSellerName.trim(), newSellerTaxId.trim(), 'manual');
    setNewSellerName('');
    setNewSellerTaxId('');
    setIsAddingNewSeller(false);
    await loadSellerDB();
  };

  const handleDeleteSeller = async (id: string) => {
    if (!confirm('確定刪除此廠商記錄？')) return;
    await deleteSeller(id);
    setSellerRows(prev => prev.filter(r => r.id !== id));
  };

  return {
    sellerRows,
    sellerSearchQuery,
    setSellerSearchQuery,
    sellerDbLoading,
    isAddingNewSeller,
    setIsAddingNewSeller,
    newSellerName,
    setNewSellerName,
    newSellerTaxId,
    setNewSellerTaxId,
    loadSellerDB,
    handleAddNewSeller,
    handleDeleteSeller,
  };
}
