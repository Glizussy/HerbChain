import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabaseClient';
import AuthLanguage, { useAuthLanguage } from '../components/AuthLanguage';
import { requireNoEmailConfirmation, registrationUser,authError } from '../../server/public/ayur-signup-policy';
export default function AyurSignInScreen() {
  const { locale, setLocale, t } = useAuthLanguage();
  const [mode, setMode] = useState('login'), [step, setStep] = useState(0), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [show, setShow] = useState(false);
  const [values, setValues] = useState({ name:'', email:'', mobile:'', org:'', region:'', password:'', confirm:'' });
  const update = (key, value) => setValues(v => ({...v, [key]:value}));
  function changeMode(next) { setMode(next); setStep(0); setMessage(''); update('password',''); update('confirm',''); }
  async function submit() {
    if (busy) return;
    if (mode === 'signup' && step === 0) { setStep(1); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) || mode === 'signup' && step === 1 && !values.name.trim()) { setMessage('missingDetails'); return; }
    if (mode === 'signup' && step < 3) { setStep(step+1); setMessage(''); return; }
    if (values.password.length < (mode === 'signup' ? 8 : 1) || mode === 'signup' && values.password !== values.confirm) { setMessage('passwordHint'); return; }
    setBusy(true); setMessage('');
    try {
      const credentials = { email: values.email.trim(), password: values.password };
      if (mode === 'signup') {
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
        try{const response=await fetch(process.env.EXPO_PUBLIC_SUPABASE_URL+'/auth/v1/settings',{headers:{apikey:process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY},signal:controller.signal});
          if(!response.ok)throw {uiKey:'authSettingsUnavailable'};requireNoEmailConfirmation(await response.json());
        }finally{clearTimeout(timer);}
        const {data,error} = await supabase.auth.signUp({...credentials, options:{data:{full_name:values.name.trim(), requested_role:'collector', contact_mobile:values.mobile.trim(), organization_name:values.org.trim(), region:values.region.trim()}}});
        if(error)throw {uiKey:authError(error,error.status)};
        registrationUser(data);
        let session=data.session;
        if(!session){const signedIn=await supabase.auth.signInWithPassword(credentials);session=signedIn.error?null:signedIn.data.session;}
        update('password',''); update('confirm',''); setStep(4); setMessage(session ? 'createdNoEmail' : 'createdSignIn');
      } else { const {error} = await supabase.auth.signInWithPassword(credentials); if(error)throw {uiKey:authError(error,error.status)}; }
    } catch (error) { setMessage(error.uiKey || 'authUnavailable'); } finally { setBusy(false); }
  }
  async function recover() {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) { setMessage('email'); return; }
    setBusy(true);
    try { const api=process.env.EXPO_PUBLIC_HERBCHAIN_API_URL; if(!api?.startsWith('https://')){setMessage('recoveryError');return;}
      const {error}=await supabase.auth.resetPasswordForEmail(values.email.trim(), {redirectTo:api.replace(/\/$/,'')+'/reset-password'});setMessage(error?'recoveryError':'recoverySent');
    } catch { setMessage('recoveryError'); } finally { setBusy(false); }
  }
  const field=(key,label,extra={})=><View style={s.field}><Text style={s.label}>{t(label)}</Text><TextInput accessibilityLabel={t(label)} style={s.input} value={values[key]} onChangeText={v=>update(key,v)} editable={!busy} {...extra}/></View>;
  const button=(key,action,secondary=false)=><TouchableOpacity accessibilityRole="button" disabled={busy} style={[s.button,secondary&&s.secondary]} onPress={action}>{busy&&!secondary?<ActivityIndicator color="white"/>:<Text style={[s.buttonText,secondary&&s.secondaryText]}>{t(key)}</Text>}</TouchableOpacity>;
  return <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}><ScrollView contentContainerStyle={s.container} keyboardShouldPersistTaps="handled">
    <Text style={s.brand}>⌁ AyurRaksha</Text><AuthLanguage locale={locale} onChange={setLocale}/>
    <View style={s.card}>
      {mode==='demo'?<><Text style={s.badge}>{t('demoMode')}</Text><Text style={s.title}>{t('collector')}</Text><Text style={s.hint}>{t('demoNote')}</Text><View style={s.sample}><Text style={s.sampleTitle}>Tulsi · तुलसी · తులసి</Text>{['COLLECTED','REVIEWED','PACKAGED','DELIVERED'].map(key=><Text key={key} style={s.sampleRow}>✓ {t(key)}</Text>)}</View>{button('back',()=>changeMode('login'),true)}</>:<>
        <Text style={s.title}>{t(mode==='signup'?'create':'welcome')}</Text><Text style={s.hint}>{t(mode==='signup'?'farmerApp':'loginHint')}</Text>
        {mode==='signup'&&<View style={s.progress}>{[0,1,2,3,4].map(i=><View key={i} style={[s.progressPart,i<=step&&{backgroundColor:'#396649'}]}/>)}</View>}
        {mode==='signup'&&step===0?<View style={s.sample}><Text style={s.sampleTitle}>⌁ {t('collector')}</Text><Text style={s.hint}>{t('collectorHint')}</Text><Text style={s.hint}>{t('approval')}</Text></View>:mode==='signup'&&step===4?<Text style={s.hint}>{t('approval')}</Text>:<>
          {mode==='signup'&&step===1&&field('name','name',{autoComplete:'name',maxLength:100})}
          {(mode==='login'||step===1)&&field('email','email',{autoCapitalize:'none',autoCorrect:false,keyboardType:'email-address',autoComplete:'email'})}
          {mode==='signup'&&step===1&&field('mobile','mobile',{keyboardType:'phone-pad',maxLength:30})}
          {mode==='signup'&&step===2&&<>{field('org','org',{maxLength:160})}{field('region','regionInput',{maxLength:100})}</>}
          {(mode==='login'||step===3)&&<>{field('password','password',{secureTextEntry:!show,autoCapitalize:'none',autoComplete:mode==='login'?'current-password':'new-password'})}<TouchableOpacity accessibilityRole="checkbox" accessibilityState={{checked:show}} style={s.smallButton} onPress={()=>setShow(!show)}><Text style={s.link}>{show?'✓ ':'○ '}{t('showPassword')}</Text></TouchableOpacity></>}
          {mode==='signup'&&step===3&&<>{field('confirm','confirmPassword',{secureTextEntry:true,autoCapitalize:'none',autoComplete:'new-password'})}<Text style={s.hint}>{t('passwordHint')}</Text></>}
        </>}
        {!!message&&<Text accessibilityRole="alert" style={s.message}>{t(message)}</Text>}
        {mode==='signup'&&step===4?button('login',()=>changeMode('login')):button(mode==='login'?'login':step===3?'create':'next',submit)}
        {mode==='login'?<>{button('forgot',recover,true)}{button('create',()=>changeMode('signup'),true)}{button('demo',()=>changeMode('demo'),true)}</>:step<4&&button('back',()=>step===0?changeMode('login'):setStep(step-1),true)}
      </>}
    </View><Text style={s.foot}>{t('tagline')}</Text>
  </ScrollView></KeyboardAvoidingView>;
}
const s=StyleSheet.create({container:{flexGrow:1,padding:22,paddingTop:30,backgroundColor:'#faf9f5',justifyContent:'center',maxWidth:620,width:'100%',alignSelf:'center'},brand:{color:'#396649',fontSize:26,fontWeight:'800'},card:{backgroundColor:'white',borderColor:'#e1e5dc',borderWidth:1,padding:24,borderRadius:24},title:{color:'#253c32',fontSize:28,lineHeight:38,fontWeight:'700',marginBottom:12},hint:{color:'#69756c',fontSize:15,lineHeight:24,marginBottom:18},field:{marginBottom:16},label:{color:'#253c32',fontWeight:'600',fontSize:15,marginBottom:8},input:{borderColor:'#cdd6ca',borderWidth:1,padding:14,fontSize:17,borderRadius:12,minHeight:54,color:'#253c32',backgroundColor:'#fff'},button:{backgroundColor:'#396649',minHeight:54,padding:16,alignItems:'center',justifyContent:'center',borderRadius:12,marginTop:10},buttonText:{color:'white',fontSize:16,fontWeight:'700',textAlign:'center'},secondary:{backgroundColor:'#faf9f5',borderWidth:1,borderColor:'#e1e5dc'},secondaryText:{color:'#396649'},smallButton:{minHeight:48,justifyContent:'center',marginBottom:12},link:{color:'#396649'},message:{color:'#854528',backgroundColor:'#faece0',padding:14,borderRadius:10,lineHeight:23,marginVertical:12},foot:{textAlign:'center',color:'#69756c',fontSize:13,marginTop:25},progress:{flexDirection:'row',gap:6,marginBottom:25},progressPart:{flex:1,height:4,borderRadius:2,backgroundColor:'#e1e5dc'},sample:{backgroundColor:'#e4ece2',padding:18,borderRadius:16,marginBottom:20},sampleTitle:{fontSize:20,fontWeight:'700',color:'#253c32',marginBottom:12},sampleRow:{color:'#396649',paddingVertical:12,fontSize:16},badge:{color:'#896127',backgroundColor:'#fff2d9',padding:12,marginBottom:20,borderRadius:12}});
