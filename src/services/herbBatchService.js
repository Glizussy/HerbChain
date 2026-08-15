// src/services/herbBatchService.js
//
// All Supabase interactions for the Farmer Collection stage.
// Two responsibilities:
//   1. uploadPhoto      — uploads a local image to Supabase Storage, returns public URL
//   2. submitHerbBatch  — uploads photos then inserts the batch row into herb_batches

import { supabase } from '../lib/supabaseClient';

const STORAGE_BUCKET = 'herb-photos';
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Uploads a single local image URI to Supabase Storage.
 *
 * Uses React Native's native FormData — appending { uri, name, type } tells
 * RN's OS-level networking to read and stream the file directly.
 * This is the most reliable approach in Expo without extra dependencies.
 *
 * @param {string} localUri  - A local file URI from expo-image-picker (file:///...)
 * @param {string} batchId   - Used to namespace the file inside the bucket
 * @returns {Promise<string>} Public URL of the uploaded photo
 */
export async function uploadPhoto(localUri, batchId) {
  const filename = localUri.split('/').pop();
  const storagePath = `${batchId}/${Date.now()}-${filename}`;

  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;

  // React Native's FormData treats { uri, name, type } as a native file reference.
  // The OS networking layer reads the file:// URI and streams it — no JS file reading needed.
  const formData = new FormData();
  formData.append('file', {
    uri: localUri,
    name: filename,
    type: mimeType,
  });

  // Do NOT set Content-Type manually — FormData sets it with the correct multipart boundary.
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(`Photo upload failed: ${errorBody.message || `HTTP ${response.status}`}`);
  }

  // Return the public URL for storage in the database row.
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Submits a full herb batch record to Supabase.
 * Handles photo uploads internally, then inserts the row.
 *
 * @param {object} record - The record object built by FarmerCollectionForm.handleSubmit
 * @returns {Promise<object>} The inserted database row
 */
export async function submitHerbBatch(record) {
  // 1. Upload every photo and collect public URLs.
  let photoUrls = [];
  if (record.photos && record.photos.length > 0) {
    const uploads = record.photos.map((uri) => uploadPhoto(uri, record.batchId));
    photoUrls = await Promise.all(uploads);
  }

  // 2. Flatten the record into the herb_batches table schema.
  const row = {
    batch_id: record.batchId,
    stage: record.stage,
    herb_name: record.herbName,
    plant_part: record.plantPart,
    collection_timestamp: record.collectionTimestamp,

    // Location stored as flat columns for easy querying.
    latitude: record.location?.latitude ?? null,
    longitude: record.location?.longitude ?? null,
    location_accuracy: record.location?.accuracy ?? null,
    location_captured_at: record.location?.capturedAt ?? null,

    quantity_value: record.quantity.value,
    quantity_unit: record.quantity.unit,

    collector_name: record.collector.name || null,
    collector_id: record.collector.id || null,

    photo_urls: photoUrls,
    quality_notes: record.qualityNotes || null,
    harvest_method: record.harvestMethod,
    source_type: record.sourceType,
    recorded_at: record.recordedAt,
  };

  const { data, error } = await supabase
    .from('herb_batches')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`Database insert failed: ${error.message}`);
  }

  return data;
}
