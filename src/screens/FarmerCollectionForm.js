// src/screens/FarmerCollectionForm.js
//
// Stage 1 of HerbChain custody chain: Farmer / Wild Collector.
// Captures the essential origin data for a batch before it is
// minted as an NFT: what was collected, by whom, where, when,
// how much, and photographic proof.

import React, { useState, useCallback } from 'react';
import { submitHerbBatch } from '../services/herbBatchService';
import { classifyPlant } from '../services/plantClassifier';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import DateTimePicker from '@react-native-community/datetimepicker';

import FormField from '../components/FormField';
import SegmentedChips from '../components/SegmentedChips';
import LocationCard from '../components/LocationCard';
import PhotoPicker from '../components/PhotoPicker';
import { colors, spacing, radius, typography } from '../theme/theme';

const SOURCE_TYPES = ['Cultivated', 'Wild-collected'];
const HARVEST_METHODS = ['Hand-picked', 'Cut/Pruned', 'Uprooted', 'Bark stripped', 'Other'];
const PLANT_PARTS = ['Root', 'Leaf', 'Bark', 'Flower', 'Fruit/Seed', 'Whole plant', 'Rhizome', 'Stem'];
const UNITS = ['kg', 'g', 'bundles'];

// Simple client-side batch ID generator: FARMER-YYYYMMDD-XXXX
// Final ID is authoritative once confirmed by the chain/backend.
function generateBatchId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `HC-${stamp}-${rand}`;
}

const initialState = {
  batchId: generateBatchId(),
  herbName: '',
  plantPart: PLANT_PARTS[0],
  collectionDate: new Date(),
  location: null,
  quantity: '',
  unit: UNITS[0],
  collectorName: '',
  collectorId: '',
  photos: [],
  qualityNotes: '',
  harvestMethod: HARVEST_METHODS[0],
  sourceType: SOURCE_TYPES[0],
};

export default function FarmerCollectionForm({ onSubmit }) {
  const [form, setForm] = useState(initialState);
  const [errors, setErrors] = useState({});
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mlPrediction, setMlPrediction] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  // ---- GPS capture ----
  const captureLocation = useCallback(async () => {
    setLocError(null);
    setLocLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission denied. Enable it in device settings.');
        setLocLoading(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setForm((f) => ({
        ...f,
        location: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: new Date().toISOString(),
        },
      }));
    } catch (e) {
      setLocError('Could not fetch location. Try again in open sky.');
    } finally {
      setLocLoading(false);
    }
  }, []);

  // ---- Photo capture ----
  const addPhoto = useCallback(async () => {
    if (form.photos.length >= 5) return;
    Alert.alert('Add photo', 'Choose a source', [
      { text: 'Camera', onPress: () => pickImage('camera') },
      { text: 'Gallery', onPress: () => pickImage('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [form.photos]);

  const pickImage = async (source) => {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (perm.status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to continue.');
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });

    if (!result.canceled && result.assets?.length) {
      const uri = result.assets[0].uri;
      setForm((f) => ({ ...f, photos: [...f.photos, uri] }));

      // Run ML classification on the newly added photo.
      setMlLoading(true);
      setMlPrediction(null);
      try {
        const pred = await classifyPlant(uri);
        setMlPrediction(pred);
        // Auto-fill herb name only when the field is still empty.
        setForm((f) => ({
          ...f,
          herbName: f.herbName.trim()
            ? f.herbName
            : pred.plant.replace(/_/g, ' '),
        }));
      } catch (e) {
        console.warn('ML classification error (non-fatal):', e.message);
      } finally {
        setMlLoading(false);
      }
    }
  };

  const removePhoto = (idx) =>
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }));

  // ---- Validation ----
  const validate = () => {
    const e = {};
    if (!form.herbName.trim()) e.herbName = 'Herb name is required';
    if (!form.quantity.trim() || isNaN(Number(form.quantity)))
      e.quantity = 'Enter a valid quantity';
    if (!form.collectorName.trim() && !form.collectorId.trim())
      e.collectorName = 'Provide collector name or ID';
    if (!form.location) e.location = 'GPS location must be captured';
    if (form.photos.length === 0) e.photos = 'At least one photo is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      Alert.alert('Missing information', 'Please fix the highlighted fields.');
      return;
    }
    setSubmitting(true);

    // Shape of the record appended to the batch at this stage.
    const record = {
      stage: 'FARMER_COLLECTION',
      batchId: form.batchId,
      herbName: form.herbName.trim(),
      plantPart: form.plantPart,
      collectionTimestamp: form.collectionDate.toISOString(),
      location: form.location,
      quantity: { value: Number(form.quantity), unit: form.unit },
      collector: { name: form.collectorName.trim(), id: form.collectorId.trim() },
      photos: form.photos,
      qualityNotes: form.qualityNotes.trim(),
      harvestMethod: form.harvestMethod,
      sourceType: form.sourceType,
      recordedAt: new Date().toISOString(),
      // ML identification result for audit trail (null if classification failed).
      mlPrediction: mlPrediction ?? null,
    };

    try {
      const saved = await submitHerbBatch(record);

      // Notify parent (App.js) if a callback was provided.
      if (onSubmit) onSubmit(saved);

      Alert.alert(
        '✅ Harvest Recorded',
        `Batch ${form.batchId} has been saved to the database.\n\nThis will be minted as an NFT once verified.`,
        [
          {
            text: 'New Entry',
            onPress: () =>
              setForm({ ...initialState, batchId: generateBatchId() }),
          },
          { text: 'OK' },
        ]
      );
    } catch (err) {
      console.error('Submit error:', err);
      Alert.alert(
        '❌ Submission Failed',
        err.message || 'An unexpected error occurred. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={typography.h1}>New Harvest Entry</Text>
        <Text style={[typography.hint, { marginBottom: spacing.lg }]}>
          Stage 1 · Farmer / Wild Collector
        </Text>

        {/* Batch ID */}
        <View style={styles.batchCard}>
          <Text style={typography.label}>BATCH ID</Text>
          <Text style={styles.batchId}>{form.batchId}</Text>
          <Text style={typography.hint}>Auto-generated · confirmed on-chain after submission</Text>
        </View>

        <FormField
          label="Herb name"
          required
          placeholder="e.g. Ashwagandha"
          value={form.herbName}
          onChangeText={set('herbName')}
          error={errors.herbName}
        />

        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>PART COLLECTED</Text>
          <SegmentedChips options={PLANT_PARTS} value={form.plantPart} onChange={set('plantPart')} />
        </View>

        {/* Date & time */}
        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>COLLECTION DATE & TIME</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.dateBtnText}>{form.collectionDate.toDateString()}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowTimePicker(true)}>
              <Text style={styles.dateBtnText}>
                {form.collectionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </TouchableOpacity>
          </View>
          {showDatePicker && (
            <DateTimePicker
              value={form.collectionDate}
              mode="date"
              maximumDate={new Date()}
              onChange={(evt, date) => {
                setShowDatePicker(false);
                if (date) set('collectionDate')(date);
              }}
            />
          )}
          {showTimePicker && (
            <DateTimePicker
              value={form.collectionDate}
              mode="time"
              onChange={(evt, date) => {
                setShowTimePicker(false);
                if (date) set('collectionDate')(date);
              }}
            />
          )}
        </View>

        <LocationCard
          location={form.location}
          loading={locLoading}
          error={errors.location || locError}
          onCapture={captureLocation}
        />

        {/* Quantity */}
        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>
            QUANTITY COLLECTED <Text style={{ color: colors.error }}>*</Text>
          </Text>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <FormField
                placeholder="0.0"
                keyboardType="decimal-pad"
                value={form.quantity}
                onChangeText={set('quantity')}
                error={errors.quantity}
              />
            </View>
            <SegmentedChips options={UNITS} value={form.unit} onChange={set('unit')} />
          </View>
        </View>

        <FormField
          label="Collector name"
          placeholder="Full name"
          value={form.collectorName}
          onChangeText={set('collectorName')}
          error={errors.collectorName}
        />
        <FormField
          label="Collector ID"
          hint="Farmer registration / Aadhaar-linked ID, if available"
          placeholder="Optional"
          value={form.collectorId}
          onChangeText={set('collectorId')}
        />

        <PhotoPicker
          photos={form.photos}
          onAdd={addPhoto}
          onRemove={removePhoto}
          error={errors.photos}
        />

        {/* ML Suggestion Card — shown while classifying or after a result arrives */}
        {(mlLoading || mlPrediction) && (
          <View style={styles.mlCard}>
            <View style={styles.mlHeader}>
              <Text style={styles.mlLabel}>🌿 ML IDENTIFICATION</Text>
              {mlLoading && (
                <ActivityIndicator size="small" color={colors.primary} />
              )}
            </View>

            {mlLoading && (
              <Text style={[typography.hint, { marginTop: 4 }]}>
                Analysing image…
              </Text>
            )}

            {!mlLoading && mlPrediction && (
              <>
                {/* Top prediction */}
                <Text style={styles.mlPlantName}>
                  {mlPrediction.plant.replace(/_/g, ' ')}
                </Text>

                {/* Confidence bar */}
                <View style={styles.mlConfidenceRow}>
                  <View style={styles.mlBarTrack}>
                    <View
                      style={[
                        styles.mlBarFill,
                        { width: `${(mlPrediction.confidence * 100).toFixed(0)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.mlConfidenceText}>
                    {(mlPrediction.confidence * 100).toFixed(1)}%
                  </Text>
                </View>

                {/* Top-3 breakdown */}
                <View style={styles.mlDivider} />
                {mlPrediction.top3.map((item, i) => (
                  <View key={item.plant} style={styles.mlRow}>
                    <Text style={styles.mlRowRank}>{i + 1}.</Text>
                    <Text style={styles.mlRowName}>
                      {item.plant.replace(/_/g, ' ')}
                    </Text>
                    <Text style={styles.mlRowConf}>
                      {(item.confidence * 100).toFixed(1)}%
                    </Text>
                  </View>
                ))}

                <Text style={[typography.hint, { marginTop: spacing.sm }]}>
                  Herb name was auto-filled — you may edit it above.
                </Text>
              </>
            )}
          </View>
        )}

        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>SOURCE TYPE</Text>
          <SegmentedChips options={SOURCE_TYPES} value={form.sourceType} onChange={set('sourceType')} />
        </View>

        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>HARVEST METHOD</Text>
          <SegmentedChips options={HARVEST_METHODS} value={form.harvestMethod} onChange={set('harvestMethod')} />
        </View>

        <FormField
          label="Initial quality notes"
          hint="Colour, aroma, visible damage, moisture, pests, etc."
          placeholder="Optional notes"
          value={form.qualityNotes}
          onChangeText={set('qualityNotes')}
          multiline
          numberOfLines={3}
        />

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Submit Harvest Record</Text>
          )}
        </TouchableOpacity>
        <Text style={[typography.hint, { textAlign: 'center', marginTop: spacing.sm }]}>
          This will mint a new batch NFT once verified.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  batchCard: {
    backgroundColor: colors.chipBg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  batchId: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primaryDark,
    marginVertical: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  dateBtnText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // ---- ML suggestion card ----
  mlCard: {
    backgroundColor: colors.chipBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '33',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  mlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  mlLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.primary,
  },
  mlPlantName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.primaryDark,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  mlConfidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  mlBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  mlBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  mlConfidenceText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    width: 44,
    textAlign: 'right',
  },
  mlDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  mlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
  },
  mlRowRank: {
    width: 20,
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  mlRowName: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  mlRowConf: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
