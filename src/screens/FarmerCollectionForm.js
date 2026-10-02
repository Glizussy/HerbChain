// src/screens/FarmerCollectionForm.js
//
// Stage 1 of HerbChain custody chain: Farmer / Wild Collector.
// Captures the essential origin data for a batch before it is
// registered for review: what was collected, by whom, where, when,
// how much, and photographic proof.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { submitHerbBatch, releasePreparedHarvest } from '../services/herbBatchService';
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

let DateTimePicker = null;
if (Platform.OS !== 'web') {
  try {
    DateTimePicker = require('@react-native-community/datetimepicker').default || require('@react-native-community/datetimepicker');
  } catch (e) {
    console.warn('DateTimePicker load warning:', e);
  }
}

import FormField from '../components/FormField';
import SegmentedChips from '../components/SegmentedChips';
import LocationCard from '../components/LocationCard';
import PhotoPicker from '../components/PhotoPicker';
import { colors, spacing, radius, typography } from '../theme/theme';

const SOURCE_TYPES = ['Cultivated', 'Wild-collected'];
const HARVEST_METHODS = ['Hand-picked', 'Cut/Pruned', 'Uprooted', 'Bark stripped', 'Other'];
const PLANT_PARTS = ['Root', 'Leaf', 'Bark', 'Flower', 'Fruit/Seed', 'Whole plant', 'Rhizome', 'Stem'];
const UNITS = ['kg', 'g'];

// Simple client-side batch ID generator: FARMER-YYYYMMDD-XXXX
// Final ID is authoritative once confirmed by the chain/backend.
function generateBatchId() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  return `HC-${stamp}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
}

const initialState = {
  batchId: generateBatchId(),
  herbName: '',
  originRegion: '',
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

export default function FarmerCollectionForm({ onSubmit, userId }) {
  const [form, setForm] = useState(() => ({ ...initialState, collectionDate: new Date(), batchId: generateBatchId() }));
  const [step, setStep] = useState(0);
  const [showReceipt, setShowReceipt] = useState(false);
  const scroll = useRef(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  const [errors, setErrors] = useState({});
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [mlPrediction, setMlPrediction] = useState(null);
  const [mlLoading, setMlLoading] = useState(false);
  const mlRequest = useRef(0);
  const snapshot = useRef(null);
  const sending = useRef(false);
  const [locked, setLocked] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [submissionMessage, setSubmissionMessage] = useState('');
  const resetEntry = () => {
    releasePreparedHarvest(userId, form.batchId);
    snapshot.current = null; mlRequest.current++;
    setForm({ ...initialState, collectionDate: new Date(), batchId: generateBatchId() });
    setMlPrediction(null); setMlLoading(false); setErrors({}); setReceipt(null); setLocked(false); setSubmissionMessage(''); setStep(0); setShowReceipt(false);
  };

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
      const request = ++mlRequest.current;
      setForm((f) => ({ ...f, photos: [...f.photos, uri] }));

      // Run ML classification on the newly added photo.
      setMlLoading(true);
      setMlPrediction(null);
      try {
        const pred = await classifyPlant(uri);
        if (request !== mlRequest.current) return;
        setMlPrediction({ ...pred, sourceUri: uri, modelVersion: 'sha256:328589201306d7e70ba5e288f5b78fac7aef248de5fcbf43ad24297c588ac322' });
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
        if (request === mlRequest.current) setMlLoading(false);
      }
    }
  };

  const removePhoto = (idx) => {
    mlRequest.current++; setMlPrediction(null); setMlLoading(false);
    setForm((f) => ({ ...f, photos: f.photos.filter((_, i) => i !== idx) }));
  };

  // ---- Validation ----
  const validate = (fields = null) => {
    const e = {};
    if (!form.herbName.trim()) e.herbName = 'Herb name is required';
    if (!form.originRegion.trim()) e.originRegion = 'Enter district and state';
    if (!form.quantity.trim() || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0)
      e.quantity = 'Enter a positive quantity';
    if (!Number.isSafeInteger(Number(form.quantity) * (form.unit === 'kg' ? 1000 : 1))) e.quantity = 'Quantity must equal a whole number of grams';
    if (!form.collectorName.trim() && !form.collectorId.trim())
      e.collectorName = 'Provide collector name or ID';
    if (!form.location) e.location = 'GPS location must be captured';
    if (form.photos.length === 0) e.photos = 'At least one photo is required';
    const visible = fields ? Object.fromEntries(Object.entries(e).filter(([key]) => fields.includes(key))) : e;
    setErrors(visible);
    return Object.keys(visible).length === 0;
  };

  const handleSubmit = async () => {
    if (sending.current || mlLoading) return;
    if (!snapshot.current && !validate()) {
      Alert.alert('Missing information', 'Please fix the highlighted fields.');
      return;
    }
    sending.current = true;
    setSubmitting(true);
    setLocked(true);
    setSubmissionMessage('Uploading evidence and checking blockchain registration…');

    // Shape of the record appended to the batch at this stage.
    const record = snapshot.current || {
      stage: 'FARMER_COLLECTION',
      batchId: form.batchId,
      herbName: form.herbName.trim(),
      originRegion: form.originRegion.trim(),
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
    snapshot.current = record;

    try {
      const saved = await submitHerbBatch(record);
      setReceipt(saved); setSubmissionMessage(saved.message);

      // Notify parent (App.js) if a callback was provided.
      if (onSubmit) onSubmit(saved);

      Alert.alert(
        saved.committed ? 'Harvest recorded' : 'Waiting for confirmation',
        saved.committed ? 'Your harvest is recorded. An independent review is needed before it can move forward. You can follow it in My harvests.' : saved.message,
        saved.committed ? [
          {
            text: 'New Entry',
            onPress: resetEntry,
          },
          { text: 'OK' },
        ] : [{ text: 'OK' }]
      );
    } catch (err) {
      console.error('Submit error:', err);
      setSubmissionMessage(`${err.message}. Your original submission is kept for retry while this screen stays open.`);
      Alert.alert(
        '❌ Submission Failed',
        err.message || 'An unexpected error occurred. Please try again.'
      );
    } finally {
      setSubmitting(false);
      sending.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {locked && <View style={{ padding: 16, backgroundColor: '#e2eddf' }}>
        <Text accessibilityRole="alert">{submissionMessage}</Text>
        {!!receipt?.batchId && <TouchableOpacity accessibilityRole="button" style={styles.backBtn} onPress={()=>setShowReceipt(!showReceipt)}><Text>{showReceipt?'Hide record details':'View batch number & receipt'}</Text></TouchableOpacity>}
        {showReceipt && <><Text selectable>{receipt?.batchId}</Text><Text selectable>Transaction: {receipt?.transactionId || 'Awaiting confirmation'}</Text></>}
        {!submitting && <TouchableOpacity style={{ paddingVertical: 14 }} onPress={receipt?.committed ? resetEntry : handleSubmit}>
          <Text style={{ fontWeight: '700' }}>{receipt?.committed ? 'New harvest' : 'Retry original submission'}</Text>
        </TouchableOpacity>}
      </View>}
      <ScrollView ref={scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" pointerEvents={locked ? 'none' : 'auto'}>
        <Text style={typography.h1}>Record your harvest</Text>
        <Text style={styles.intro}>A batch is a group of herbs collected together. Record each harvest separately.</Text>
        <View style={styles.progress} accessibilityLabel={'Step '+(step+1)+' of 3'}>
          {['Herb & photos','Harvest details','Check & send'].map((label,index)=><View key={label} style={[styles.step,step===index&&styles.activeStep]}><Text style={[styles.stepText,step===index&&styles.activeStepText]}>{index+1}. {label}</Text></View>)}
        </View>
        {step===0 && <>
          <Text style={styles.sectionTitle}>What did you collect?</Text>
          <Text style={styles.intro}>Add a clear photo. Check the suggested herb name and correct it if needed.</Text>
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
              <Text style={styles.mlLabel}>PHOTO SUGGESTION</Text>
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
                  This is a photo suggestion, not a verified identification. Check and edit the herb name below.
                </Text>
              </>
            )}
          </View>
        )}

        <FormField
          label="Herb name"
          maxLength={160}
          required
          placeholder="e.g. Tulsi / Ocimum tenuiflorum"
          value={form.herbName}
          onChangeText={set('herbName')}
          error={errors.herbName}
        />
        <View style={{ marginBottom: spacing.md }}>
          <Text style={typography.label}>PART COLLECTED</Text>
          <SegmentedChips options={PLANT_PARTS} value={form.plantPart} onChange={set('plantPart')} />
        </View>

        </>}
        {step===1 && <>
          <Text style={styles.sectionTitle}>Where and how much?</Text>
          <Text style={styles.intro}>Have the herbs and their weight ready. Fields marked * are required.</Text>
        <FormField label="District and state" maxLength={160} required placeholder="e.g. Pune, Maharashtra" value={form.originRegion} onChangeText={set('originRegion')} error={errors.originRegion} hint="This coarse origin will be visible in the product history. Exact GPS stays private." />

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
            Platform.OS === 'web' ? (
              <View style={{ marginTop: spacing.xs }}>
                <input
                  type="date"
                  value={form.collectionDate.toISOString().split('T')[0]}
                  onChange={(e) => {
                    setShowDatePicker(false);
                    if (e.target.value) {
                      const parts = e.target.value.split('-');
                      const updated = new Date(form.collectionDate);
                      updated.setFullYear(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                      set('collectionDate')(updated);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${colors.border}`,
                    fontSize: '14px',
                  }}
                />
              </View>
            ) : DateTimePicker ? (
              <DateTimePicker
                value={form.collectionDate}
                mode="date"
                maximumDate={new Date()}
                onChange={(evt, date) => {
                  setShowDatePicker(false);
                  if (date) set('collectionDate')(date);
                }}
              />
            ) : null
          )}
          {showTimePicker && (
            Platform.OS === 'web' ? (
              <View style={{ marginTop: spacing.xs }}>
                <input
                  type="time"
                  value={form.collectionDate.toTimeString().slice(0, 5)}
                  onChange={(e) => {
                    setShowTimePicker(false);
                    if (e.target.value) {
                      const [h, m] = e.target.value.split(':').map(Number);
                      const updated = new Date(form.collectionDate);
                      updated.setHours(h, m);
                      set('collectionDate')(updated);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${colors.border}`,
                    fontSize: '14px',
                  }}
                />
              </View>
            ) : DateTimePicker ? (
              <DateTimePicker
                value={form.collectionDate}
                mode="time"
                onChange={(evt, date) => {
                  setShowTimePicker(false);
                  if (date) set('collectionDate')(date);
                }}
              />
            ) : null
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
          label="Your name"
          placeholder="Full name"
          value={form.collectorName}
          onChangeText={set('collectorName')}
          error={errors.collectorName}
        />
        <FormField
          label="Farm reference (optional)"
          hint="Your cooperative or farm reference, if available. Do not enter an Aadhaar number."
          placeholder="Optional"
          value={form.collectorId}
          onChangeText={set('collectorId')}
        />

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

        </>}
        {step===2 && <View style={styles.reviewCard}>
          <Text style={styles.sectionTitle}>Check before you send</Text>
          <Text style={styles.reviewValue}>{form.herbName}</Text>
          <Text style={styles.reviewLine}>{form.quantity} {form.unit} · {form.plantPart}</Text>
          <Text style={styles.reviewLine}>{form.originRegion}</Text>
          <Text style={styles.reviewLine}>Collected {form.collectionDate.toLocaleString()}</Text>
          <Text style={styles.reviewLine}>Farmer: {form.collectorName || form.collectorId}</Text>
          <Text style={styles.reviewLine}>{form.photos.length} photo(s) · {form.location ? 'Farm location captured' : 'Farm location missing'}</Text>
          <Text style={styles.reviewLine}>{form.sourceType} · {form.harvestMethod}</Text>
          {!!form.qualityNotes && <Text style={styles.reviewLine}>Notes: {form.qualityNotes}</Text>}
          <Text style={styles.intro}>After you send, an independent reviewer must check this harvest before it can move forward.</Text>
        </View>}
        {step<2 && <TouchableOpacity accessibilityRole="button" disabled={mlLoading} style={[styles.submitBtn,mlLoading&&{opacity:0.5}]} onPress={()=>{
          const fields=step===0?['herbName','photos']:['originRegion','quantity','collectorName','location'];
          if(validate(fields))setStep(step+1);else Alert.alert('A few details are missing','Please check the highlighted fields before continuing.');
        }}><Text style={styles.submitText}>{mlLoading?'Checking photo…':step===0?'Continue to harvest details':'Check your harvest'}</Text></TouchableOpacity>}
        {step>0 && <TouchableOpacity accessibilityRole="button" style={styles.backBtn} onPress={()=>setStep(step-1)}><Text style={styles.backText}>Back — edit details</Text></TouchableOpacity>}
        {step===2 && <>
        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
          onPress={handleSubmit}
          disabled={submitting || mlLoading}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>Send harvest for review</Text>
          )}
        </TouchableOpacity>
        <Text style={[typography.hint, { textAlign: 'center', marginTop: spacing.sm }]}>
          Your photos and harvest details will be sent for independent review.
        </Text>
        </>}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  intro:{fontSize:15,lineHeight:23,color:colors.textMuted,marginVertical:12},
  progress:{flexDirection:'row',gap:6,marginVertical:16},
  step:{flex:1,padding:10,borderRadius:10,backgroundColor:colors.chipBg},
  activeStep:{backgroundColor:colors.primaryDark},
  stepText:{fontSize:13,lineHeight:19,color:colors.text},activeStepText:{color:'#fff',fontWeight:'700'},
  sectionTitle:{fontSize:21,fontWeight:'700',color:colors.text,marginBottom:8},
  reviewCard:{padding:20,backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:colors.border},
  reviewValue:{fontSize:23,fontWeight:'700',color:colors.primaryDark,marginVertical:10},
  reviewLine:{fontSize:16,lineHeight:25,marginVertical:5,color:colors.text},
  backBtn:{minHeight:48,paddingVertical:14,alignItems:'center'},backText:{fontSize:16,color:colors.primaryDark,fontWeight:'600'},
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
