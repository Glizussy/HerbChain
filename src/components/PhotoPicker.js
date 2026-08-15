// src/components/PhotoPicker.js
import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/theme';

const MAX_PHOTOS = 5;

export default function PhotoPicker({ photos, onAdd, onRemove, error }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={typography.label}>
        PHOTOS OF HARVESTED PLANT <Text style={{ color: colors.error }}>*</Text>
      </Text>
      <Text style={[typography.hint, { marginTop: 2, marginBottom: 8 }]}>
        Add up to {MAX_PHOTOS} photos — whole plant, collected part, and site.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {photos.map((uri, idx) => (
          <View key={idx} style={styles.thumbWrap}>
            <Image source={{ uri }} style={styles.thumb} />
            <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(idx)}>
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {photos.length < MAX_PHOTOS && (
          <TouchableOpacity style={styles.addBtn} onPress={onAdd} activeOpacity={0.7}>
            <Text style={styles.addIcon}>＋</Text>
            <Text style={styles.addLabel}>Add photo</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  thumbWrap: { marginRight: spacing.sm, position: 'relative' },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: radius.sm,
    backgroundColor: colors.chipBg,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.error,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  addBtn: {
    width: 84,
    height: 84,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  addIcon: { fontSize: 20, color: colors.primary },
  addLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  errorText: { marginTop: 6, fontSize: 12, color: colors.error },
});
