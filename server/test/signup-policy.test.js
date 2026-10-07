const {test}=require('node:test');const assert=require('node:assert/strict');
const {requireNoEmailConfirmation,registrationSession,registrationUser}=require('../public/ayur-signup-policy');
test('no-email signup requires the actual project auto-confirm setting',()=>{
 assert.doesNotThrow(()=>requireNoEmailConfirmation({mailer_autoconfirm:true}));
 assert.throws(()=>requireNoEmailConfirmation({mailer_autoconfirm:false}),e=>e.uiKey==='emailConfirmationEnabled');
 for(const settings of [null,{}, {mailer_autoconfirm:'true'}])assert.throws(()=>requireNoEmailConfirmation(settings),e=>e.uiKey==='authSettingsUnavailable');
});
test('signup recognizes REST and SDK sessions without treating a user-only response as a session',()=>{
 const session={access_token:'fixture',refresh_token:'fixture',user:{id:'fixture'}};
 assert.equal(registrationSession(session),session);assert.equal(registrationSession({session}),session);
 assert.equal(registrationSession({user:{id:'fixture'}}),null);assert.equal(registrationSession({access_token:'fixture'}),null);
 assert.equal(registrationUser({user:{id:'fixture'}}).id,'fixture');assert.equal(registrationUser({id:'fixture'}).id,'fixture');
 assert.throws(()=>registrationUser({user:{id:'fixture',identities:[]}}),e=>e.uiKey==='signupError');
});
