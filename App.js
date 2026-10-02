// App.js
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, AppState, Alert } from 'react-native';
import SignInScreen from './src/screens/SignInScreen';
import { supabase } from './src/lib/supabaseClient';

import FarmerCollectionForm from './src/screens/FarmerCollectionForm';
import FarmerBatchesScreen from './src/screens/FarmerBatchesScreen';

import { colors } from './src/theme/theme';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('harvest');
  useEffect(() => { setView('harvest'); }, [session?.user.id]);
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
      {loading ? <ActivityIndicator style={{ flex: 1 }} /> : session ? <>
        <View style={{ padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff' }}>
          <View style={{ flex: 1 }}><Text style={{ color: colors.primaryDark, fontSize: 18, fontWeight: '800', letterSpacing: 2 }}>HERBCHAIN</Text><Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>{session.user.email}</Text></View>
          <TouchableOpacity accessibilityRole="button" style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 }} onPress={async () => { const { error } = await supabase.auth.signOut(); if (error) Alert.alert('Sign out failed', error.message); }}><Text>Sign out</Text></TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', paddingHorizontal: 12, gap: 12 }}>
          {['harvest','batches'].map(tab => <TouchableOpacity key={tab} accessibilityRole="tab" accessibilityState={{ selected: view === tab }} onPress={() => setView(tab)} style={{ flex: 1, minHeight: 52, alignItems: 'center', padding: 12, borderBottomWidth: view === tab ? 3 : 0, borderBottomColor: '#173d30' }}><Text>{tab === 'harvest' ? 'Record a harvest' : 'My harvests'}</Text></TouchableOpacity>)}
        </View>
        <View style={{ flex: 1, display: view === 'harvest' ? 'flex' : 'none' }}><FarmerCollectionForm key={session.user.id} userId={session.user.id} /></View>
        {view === 'batches' && <FarmerBatchesScreen key={session.user.id} userId={session.user.id} />}
      </> : <SignInScreen />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
