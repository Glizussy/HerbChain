// src/components/LocationCard.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/theme';

export default function LocationCard({ location, loading, error, onCapture }) {
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={typography.label}>
          GPS LOCATION <Text style={{ color: colors.error }}>*</Text>
        </Text>
        {loading ? (
          <View style={styles.row}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[typography.hint, { marginLeft: 8 }]}>Fetching location…</Text>
          </View>
        ) : location ? (
          <Text style={styles.coords}>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
            {'\n'}
            <Text style={typography.hint}>
              Accuracy ±{Math.round(location.accuracy || 0)}m
            </Text>
          </Text>
        ) : (
          <Text style={typography.hint}>
            {error || 'Location not captured yet'}
          </Text>
        )}
      </View>

      <TouchableOpacity style={styles.btn} onPress={onCapture} activeOpacity={0.8}>
        <Text style={styles.btnText}>{location ? 'Re-capture' : 'Capture'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  coords: { marginTop: 6, fontSize: 14, color: colors.text, fontWeight: '600' },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    marginLeft: spacing.md,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
