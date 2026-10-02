// Optional authenticated Fabric API client. Login and identity enrollment must be
// completed before calling this; no signing keys or role claims belong in Expo.
import { supabase } from '../lib/supabaseClient';
export async function submitFabricTransaction(operation, args) {
  const base = process.env.EXPO_PUBLIC_HERBCHAIN_API_URL;
  if (!base) throw new Error('Configure EXPO_PUBLIC_HERBCHAIN_API_URL');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in before submitting to Fabric');
  const response = await fetch(`${base}/api/transactions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ operation, args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${result.error}${result.transactionId ? ` (transaction ${result.transactionId})` : ''}`);
  return result;
}
