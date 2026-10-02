import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabaseClient';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function authenticate(create) {
    if (!email.trim() || password.length < 8) { setMessage('Enter your email and a password of at least 8 characters.'); return; }
    setBusy(true); setMessage('');
    try {
      const credentials = { email: email.trim(), password };
      const { data, error } = create ? await supabase.auth.signUp(credentials) : await supabase.auth.signInWithPassword(credentials);
      if (error) throw error;
      if (create && !data.session) setMessage('Check your email to confirm your account, then sign in. Your project administrator must also enroll your account before you can submit harvests.');
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  }
  return <View style={styles.container}>
    <Text style={styles.brand}>HERBCHAIN</Text>
    <Text style={styles.title}>Record a harvest</Text>
    <Text style={styles.hint}>Sign in to submit photos and collection details for independent review.</Text>
    <Text style={styles.label}>Email</Text>
    <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy} />
    <Text style={styles.label}>Password</Text>
    <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" editable={!busy} />
    {!!message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
    <TouchableOpacity disabled={busy} style={styles.button} onPress={() => authenticate(false)}>
      {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign in</Text>}
    </TouchableOpacity>
    <TouchableOpacity disabled={busy} onPress={() => authenticate(true)}><Text style={styles.create}>Create an account</Text></TouchableOpacity>
  </View>;
}
const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#f5f7f0' },
  brand: { color: '#38624b', letterSpacing: 2, fontSize: 14 }, title: { fontSize: 30, fontWeight: '700', color: '#183d2b', marginVertical: 16 },
  hint: { color: '#536453', lineHeight: 22, marginBottom: 18 }, label: { color: '#183d2b', marginBottom: 6 },
  input: { backgroundColor: 'white', borderWidth: 1, borderColor: '#9baa9a', borderRadius: 10, padding: 14, marginBottom: 18, color: '#183d2b' },
  message: { color: '#923e22', lineHeight: 21, marginBottom: 16 }, button: { backgroundColor: '#183d2b', borderRadius: 10, padding: 16, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '700' }, create: { color: '#183d2b', textAlign: 'center', padding: 20 },
});
