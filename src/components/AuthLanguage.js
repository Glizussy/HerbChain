import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dictionary from '../../server/public/ayur-translations.json';
import workspace from '../../server/public/workspace-translations.json';
export const locales = ['en', 'hi', 'mr', 'te'];
export const translate = (locale, key) => (workspace[key] || dictionary[key])?.[locales.indexOf(locale)] || (workspace[key] || dictionary[key])?.[0] || key;
export function useAuthLanguage() {
  const [locale, update] = useState('en');
  useEffect(() => { let active = true; AsyncStorage.getItem('ayur-language').then(value => { if (active && locales.includes(value)) update(value); }).catch(() => {}); return () => { active = false; }; }, []);
  function setLocale(value) { update(value); AsyncStorage.setItem('ayur-language', value).catch(() => {}); }
  return { locale, setLocale, t: key => translate(locale, key) };
}
export default function AuthLanguage({ locale, onChange }) {
  return <View accessibilityLabel="Language / भाषा / భాష" style={styles.row}>{['English', 'हिंदी', 'मराठी', 'తెలుగు'].map((name, i) => <TouchableOpacity key={name} accessibilityRole="button" accessibilityState={{ selected: locale === locales[i] }} style={[styles.option, locale === locales[i] && styles.selected]} onPress={() => onChange(locales[i])}><Text style={[styles.text, locale === locales[i] && styles.active]}>{name}</Text></TouchableOpacity>)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 18 }, option: { minHeight: 48, paddingHorizontal: 13, justifyContent: 'center', borderWidth: 1, borderColor: '#dce2d6', borderRadius: 12 }, selected: { backgroundColor: '#e4ece2', borderColor: '#396649' }, text: { color: '#69756c', fontSize: 14 }, active: { color: '#253c32', fontWeight: '700' } });
