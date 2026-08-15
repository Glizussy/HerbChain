// App.js
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import FarmerCollectionForm from './src/screens/FarmerCollectionForm';
import { colors } from './src/theme/theme';

export default function App() {
  // onSubmit is called after a successful Supabase insert.
  // Use this hook to navigate to a confirmation screen or trigger
  // the NFT minting service once you're ready.
  const handleSubmit = (savedRow) => {
    console.log('Batch saved to Supabase:', savedRow);
    // TODO: Navigate to confirmation screen or trigger NFT minting
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <FarmerCollectionForm onSubmit={handleSubmit} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
});
