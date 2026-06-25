import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../services/supabaseService';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = getSupabaseClient();
    if (!client) {
      // Supabase not configured — run in local-only mode
      setLoading(false);
      return;
    }

    // Get the current session on mount
    client.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for login / logout events
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const client = getSupabaseClient();
    await client?.auth.signOut();
  };

  return { user, loading, signOut };
}
