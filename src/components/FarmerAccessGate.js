import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabaseClient';
import AuthLanguage, { useAuthLanguage } from './AuthLanguage';
export default function FarmerAccessGate({ session, children }) {
  const { locale, setLocale, t } = useAuthLanguage();
  const [state, setState] = useState('checking'), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000);
    setState(previous => previous === 'ready' ? 'ready' : 'checking');
    (async () => {
      try {
        const base = process.env.EXPO_PUBLIC_HERBCHAIN_API_URL?.replace(/\/$/, ''); if (!base) throw Error();
        let r = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + session.access_token }, signal: controller.signal });
        if(r.status===403){
          const setup=await fetch(base+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+session.access_token},signal:controller.signal});
          if(!setup.ok){if(active)setState('setupUnavailable');return;}
          const result=await setup.json();
          if(!['active','disabled'].includes(result.state)){if(active)setState(result.state==='rejected'?'accessRejected':'accessRequested');return;}
          r=await fetch(base+'/api/me',{headers:{Authorization:'Bearer '+session.access_token},signal:controller.signal});
        }
        if (!r.ok) { if (active) setState(r.status >= 500 ? 'unavailable' : 'pending'); return; }
        const me = await r.json(); if (active) setState(me.role === 'collector' ? 'ready' : 'web');
      } catch { if (active) setState('unavailable'); }
      finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [session.user.id, session.access_token, retry]);
  if (state === 'ready') return children;
  return <View style={s.container}><Text style={s.brand}>AyurRaksha</Text><AuthLanguage locale={locale} onChange={setLocale}/>{state === 'checking' ? <><ActivityIndicator size="large" color="#396649"/><Text style={s.message}>{t('accountSettingUp')}</Text></> : <><Text style={s.message}>{t(state === 'web' ? 'useWeb' : state === 'pending' ? 'pending' : ['setupUnavailable','accessRejected','accessRequested'].includes(state)?state:'unavailable')}</Text><TouchableOpacity accessibilityRole="button" style={s.button} onPress={()=>setRetry(v=>v+1)}><Text style={s.text}>{t('retry')}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={s.button} onPress={async()=>{const {error}=await supabase.auth.signOut();if(error)setState('unavailable');}}><Text style={s.text}>{t('signout')}</Text></TouchableOpacity></>}</View>;
}
const s=StyleSheet.create({container:{flex:1,justifyContent:'center',padding:28,backgroundColor:'#faf9f5'},brand:{fontSize:26,color:'#396649',fontWeight:'800'},message:{fontSize:18,lineHeight:28,color:'#253c32',marginVertical:20},button:{minHeight:54,padding:16,backgroundColor:'#e4ece2',marginTop:12,borderRadius:12,alignItems:'center'},text:{color:'#253c32',fontWeight:'700',fontSize:16}});
