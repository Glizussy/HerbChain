// src/components/FormField.js
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, spacing, radius, typography } from '../theme/theme';

export default function FormField({
  label,
  required,
  error,
  hint,
  children,
  ...inputProps
}) {
  return (
    <View style={styles.wrapper}>
      <Text style={typography.label}>
        {label}
        {required ? <Text style={{ color: colors.error }}> *</Text> : null}
      </Text>

      {children ? (
        children
      ) : (
        <TextInput
          style={[styles.input, error && styles.inputError]}
          placeholderTextColor={colors.textMuted}
          {...inputProps}
        />
      )}

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : hint ? (
        <Text style={typography.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  input: {
    marginTop: spacing.xs,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.error,
  },
  errorText: {
    marginTop: 4,
    fontSize: 12,
    color: colors.error,
  },
});
