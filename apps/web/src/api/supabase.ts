import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** เฟส 4: บัญชีผู้ใช้ผ่าน Supabase Auth — sign-in แบบ anonymous ก่อน แล้วค่อยผูกอีเมลทีหลัง (ดู ADR-0004) */
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** กัน signInAnonymously ถูกยิงซ้ำถ้ามีคนเรียก ensureSession พร้อมกันหลายที่ */
let anonymousSignIn: Promise<Session> | null = null;

/** มี session อยู่แล้วก็คืนเลย ไม่มีก็ signInAnonymously ให้อัตโนมัติ — เล่นได้ทันทีไม่ต้องสมัครสมาชิกก่อน */
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;
  if (!anonymousSignIn) {
    anonymousSignIn = supabase.auth.signInAnonymously().then(({ data: signedIn, error }) => {
      anonymousSignIn = null;
      if (error || !signedIn.session) throw error ?? new Error('เข้าสู่ระบบแบบไม่ระบุตัวตนไม่สำเร็จ');
      return signedIn.session;
    });
  }
  return anonymousSignIn;
}

/** access token ปัจจุบัน (supabase-js ต่ออายุให้อัตโนมัติถ้าใกล้หมด) — null ถ้ายังไม่มี session เลย */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
}

export async function currentUser(): Promise<CurrentUser | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;
  return { id: user.id, email: user.email ?? null, isAnonymous: user.is_anonymous === true };
}

/**
 * ผูกอีเมลเข้ากับบัญชี anonymous ปัจจุบัน (หรือ sign in ด้วยอีเมลถ้ายังไม่มี session)
 * Supabase จะส่งลิงก์ยืนยันไปที่อีเมล กดแล้วบัญชี anonymous เดิมจะกลายเป็นบัญชีถาวร เกม/เซฟเดิมไม่หาย
 */
export async function linkEmail(email: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export type { Session };
