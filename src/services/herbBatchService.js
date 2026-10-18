import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { createHarvestOutbox } from './harvestOutbox';
import { supabase } from '../lib/supabaseClient';

// Native uploads are saved before network submission. Web retains session-only behavior.
const prepared = new Map();
const outbox = createHarvestOutbox(FileSystem, FileSystem.documentDirectory);
async function activeSession() { const {data:{session},error}=await supabase.auth.getSession();if(error||!session)throw new Error('Sign in before submitting a harvest.');return session; }
export async function listPendingHarvests() { const session=await activeSession();return Platform.OS==='web'?{entries:[],warnings:['Upload recovery across restarts is available in the Android app.']}:outbox.list(session.user.id); }
export async function retryPendingHarvest(clientId) { const session=await activeSession();const saved=await outbox.read(session.user.id,clientId);if(!saved)throw new Error('Saved harvest not found for this account.');return sendPrepared(session,saved.payload); }
export async function submitHerbBatch(record) {
  const base = process.env.EXPO_PUBLIC_HERBCHAIN_API_URL?.replace(/\/$/, '');
  if (!base) throw new Error('Set EXPO_PUBLIC_HERBCHAIN_API_URL to the backend address reachable from this phone.');
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Sign in before submitting a harvest.');
  const key = `${session.user.id}:${record.batchId}`;
  let payload = prepared.get(key);
  if(!payload && Platform.OS!=='web') payload=(await outbox.read(session.user.id,record.batchId))?.payload;
  if (!payload) {
    const photos = [];
    for (const [index,uri] of record.photos.entries()) {
      const image = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1280 } }], {
        compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true,
      });
      if (!image.base64 || image.base64.length > 4194304) throw new Error('Photo is too large. Choose a smaller photo.');
      photos.push({ base64: image.base64,source:record.photoCaptures?.[index]?.source,capturedAt:record.photoCaptures?.[index]?.capturedAt });
    }
    const prediction = record.mlPrediction;
    const photoIndex = prediction ? record.photos.indexOf(prediction.sourceUri) : -1;
    payload = { ...record, photos, mlPrediction: photoIndex >= 0 ? {
      plant: prediction.plant, confidence: prediction.confidence, modelVersion: prediction.modelVersion, photoIndex,
    } : null };
  }
  if(Platform.OS!=='web')payload=(await outbox.save(session.user.id,payload)).payload;
  prepared.set(key,payload);
  return sendPrepared(session,payload);
}
async function sendPrepared(session,payload) {
  const base=process.env.EXPO_PUBLIC_HERBCHAIN_API_URL?.replace(/\/$/,'');
  if(!base)throw new Error('Set EXPO_PUBLIC_HERBCHAIN_API_URL to the backend address reachable from this phone.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${base}/api/harvests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload), signal: controller.signal,
    });
    const result = await response.json().catch(() => ({ error: `Backend returned HTTP ${response.status}` }));
    if (!response.ok){const error=new Error(result.error||'Harvest submission failed');if(result.code==='CAPTURE_VALIDATION'&&!result.transactionId){if(Platform.OS!=='web')await outbox.remove(session.user.id,payload.batchId);prepared.delete(`${session.user.id}:${payload.batchId}`);error.captureRejected=true;}throw error;}
    if(result.committed===true && Platform.OS!=='web') { try{await outbox.remove(session.user.id,payload.batchId);}catch{result.localCleanupPending=true;} }
    return result;
  } finally { clearTimeout(timeout); }
}
export function releasePreparedHarvest(userId, clientId) { prepared.delete(`${userId}:${clientId}`); }
