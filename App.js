// App.js
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet } from 'react-native';
import FarmerCollectionForm from './src/screens/FarmerCollectionForm';
import { colors } from './src/theme/theme';

export default function App() {
  // On submit, this record is what you POST to your backend / smart
  // contract minting service to create the initial batch NFT.
  const handleSubmit = (record) => {
    console.log('Farmer stage record:', record);
    // TODO: POST to backend -> mint NFT -> navigate to confirmation screen
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
