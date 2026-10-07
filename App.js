// App.js
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import SignInScreen from './src/screens/SignInScreen';
import FarmerAccessGate from './src/components/FarmerAccessGate';
import { supabase } from './src/lib/supabaseClient';

import FarmerWorkspace from './src/screens/FarmerWorkspace';

import { colors } from './src/theme/theme';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) { setSession(next); setLoading(false); }
    });
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setLoading(false); } }).catch(() => { if (active) setLoading(false); });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    });
    return () => { active = false; subscription.unsubscribe(); appState.remove(); };
  }, []);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      {loading ? <ActivityIndicator style={{ flex: 1 }} /> : session ? <FarmerAccessGate session={session}><FarmerWorkspace key={session.user.id} session={session} /></FarmerAccessGate> : <SignInScreen />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
