// Signing in with a phone number and a texted code, joining, and leaving.
import { sb } from './client.js';

export const session = () => sb.auth.getSession();
export const onChange = (fn) => sb.auth.onAuthStateChange((_event, s) => fn(s));
// options: { captchaToken } when the sign-in check (Turnstile) is on; the preview sends none
export const sendCode = (phone, options) => sb.auth.signInWithOtp(options ? { phone, options } : { phone });
export const verifyCode = (phone, token) => sb.auth.verifyOtp({ phone, token, type: 'sms' });
export const signOut = () => sb.auth.signOut();
// Who's signed in: the profile, or no rows before they've picked a handle
export const me = () => sb.rpc('me');
export const completeSignup = (args) => sb.rpc('complete_signup', args);
export const deleteAccount = () => sb.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
