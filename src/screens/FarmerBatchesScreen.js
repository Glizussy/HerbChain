import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabaseClient';
import { listPendingHarvests, retryPendingHarvest } from '../services/herbBatchService';

const labels = {PENDING_REVIEW:'Waiting for review',VERIFIED:'Review approved',PROCESSED:'Processing recorded',PACKAGED:'Packed',DELIVERED:'Delivered',REJECTED:'Review rejected',RECALLED:'Recalled — stop use'};
const descriptions = {
  PENDING_REVIEW: 'Harvest recorded. Independent review is pending.',
  VERIFIED: 'Review approved. Follow the custody and laboratory steps before use.',
  PROCESSED: 'Processing recorded. Final lab testing is required before packaging.',
  PACKAGED: 'Packaged and available for consumer tracing.',
  DELIVERED: 'Delivery recorded.',
  REJECTED: 'This batch was rejected and cannot continue through the supply chain.',
  RECALLED: 'This batch has been recalled. Further movement is blocked.',
};
export default function FarmerBatchesScreen({ userId }) {
  const [cursor,setCursor]=useState(null);
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
  const [outbox,setOutbox]=useState({entries:[],warnings:[]}),[retrying,setRetrying]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    const timer=setTimeout(()=>controller.abort(),30000);
    (async()=>{setLoading(true);setError('');try{
      const saved=await listPendingHarvests();if(active)setOutbox(saved);
      const base=process.env.EXPO_PUBLIC_HERBCHAIN_API_URL?.replace(/\/$/,'');if(!base)throw Error('Configure the HerbChain API URL to view your batches.');
      const {data:{session},error:authError}=await supabase.auth.getSession();if(authError||!session||session.user.id!==userId)throw Error('Sign in again to view your batches.');
      const r=await fetch(base+'/api/dashboard?limit=25'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+session.access_token},signal:controller.signal});const result=await r.json();if(!r.ok)throw Error(result.error||'Unable to load batches.');if(result.role!=='collector')throw Error('Use a farmer account for this view.');if(active)setData(previous=>cursor&&result.indexed?{...result,batches:[...new Map([...(previous?.batches||[]),...result.batches].map(b=>[b.batchId,b])).values()]}:result);
    }catch(e){if(active)setError(e.name==='AbortError'?'The request timed out. Check your API connection and refresh.':e.message);}finally{clearTimeout(timer);if(active)setLoading(false);}})();
    return()=>{active=false;clearTimeout(timer);controller.abort();};
  },[userId,reload,cursor]);
  async function retry(clientId){if(retrying)return;setRetrying(true);try{const r=await retryPendingHarvest(clientId);setNotice(r.committed?'Harvest confirmed on Fabric. '+r.batchId:'Evidence remains saved. The ledger commit is not yet confirmed; retry later.');setCursor(null);setReload(v=>v+1);}catch(e){setNotice(e.message+' The saved upload is kept on this phone.');}finally{setRetrying(false);}}
  return <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.title}>My harvests</Text><Text style={styles.subtitle}>Follow your recorded batches after collection.</Text>
    <TouchableOpacity accessibilityRole="button" disabled={loading} style={styles.button} onPress={()=>{setCursor(null);setReload(v=>v+1);}}><Text style={styles.buttonText}>Refresh status</Text></TouchableOpacity>
    {loading&&<ActivityIndicator accessibilityLabel="Loading batch status"/>}
    {!!notice&&<Text accessibilityRole="alert" style={styles.explanation}>{notice}</Text>}
    {outbox.warnings.map((w,i)=><Text style={styles.error} key={'outbox-'+i}>{w}</Text>)}
    {!!outbox.entries.length&&<Text style={styles.name}>Saved uploads awaiting confirmation</Text>}
    {outbox.entries.map(entry=><View style={styles.card} key={entry.clientId}><Text style={styles.name}>{entry.species}</Text><Text selectable>{entry.clientId}</Text><Text style={styles.subtitle}>Saved {new Date(entry.createdAt).toLocaleString()}. Retry checks the same submission; it does not create a new batch.</Text><TouchableOpacity accessibilityRole="button" disabled={retrying} style={styles.button} onPress={()=>retry(entry.clientId)}><Text style={styles.buttonText}>{retrying?'Checking…':'Check or retry saved harvest'}</Text></TouchableOpacity></View>)}
    {!!error&&<Text accessibilityRole="alert" style={styles.error}>{error}{data?'\nPrevious results below may be out of date.':''}</Text>}
    {data&&<Text style={styles.subtitle}>{data.indexed ? (data.indexedAt ? 'Index updated: '+new Date(data.indexedAt).toLocaleString()+'. Recent changes may take a moment to appear.' : 'Waiting for the batch index to start.') : 'Last checked: '+new Date(data.checkedAt).toLocaleString()}</Text>}
    {data?.warnings.map((w,i)=><Text style={styles.error} key={i}>{w}</Text>)}
    {data&&!data.batches.length&&<Text>No recorded harvests yet. Register a harvest, then refresh this list.</Text>}
    {data?.batches.map(b=><View style={styles.card} key={b.batchId}>
      <Text style={styles.status}>{labels[b.status] || b.status.replaceAll('_',' ')}</Text><Text style={styles.name}>{b.species}</Text><Text>{b.quantityGrams >= 1000 ? (b.quantityGrams / 1000).toLocaleString() + ' kg' : b.quantityGrams + ' g'} · {b.originRegion}</Text>
      <Text style={styles.explanation}>{descriptions[b.status]||'Check the recorded lifecycle status.'}</Text>
      <Text>{b.outgoing?'Waiting for the recipient to confirm receipt.':b.inCustody?'This batch is with you.':'This batch is with another participant.'}</Text>
      <Text style={styles.demo}>{b.demoStatus==='SIMULATED'?'SIMULATED DEMO':b.demoStatus==='UNKNOWN'?'Demo status unavailable':'Available records are not marked as demo'}</Text>
      <Text selectable style={styles.id}>{b.batchId}</Text><Text style={styles.subtitle}>Recorded updates: {b.sequence}</Text>
    </View>)}
    {!!data?.pagination?.nextCursor&&<TouchableOpacity accessibilityRole="button" disabled={loading||retrying} style={styles.button} onPress={()=>{setCursor(data.pagination.nextCursor);setReload(v=>v+1);}}><Text style={styles.buttonText}>{loading?'Loading…':'Load more harvests'}</Text></TouchableOpacity>}
  </ScrollView>;
}
const styles=StyleSheet.create({content:{padding:20,paddingBottom:50},title:{fontSize:28,fontWeight:'700',color:'#173d30'},subtitle:{color:'#617469',marginVertical:10},button:{backgroundColor:'#173d30',padding:14,borderRadius:10,marginVertical:14},buttonText:{color:'white',textAlign:'center'},error:{color:'#922d20',marginVertical:12},card:{backgroundColor:'#fffefa',padding:18,borderRadius:14,borderWidth:1,borderColor:'#d9e2d7',marginVertical:10},status:{color:'#426331',fontWeight:'700'},name:{fontSize:21,fontWeight:'600',marginVertical:8},explanation:{marginVertical:12},demo:{color:'#805b13',marginTop:12},id:{fontSize:12,marginTop:14,color:'#526356'}});
