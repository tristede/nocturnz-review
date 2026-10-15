import { cookies } from 'next/headers';
import { createHash } from 'node:crypto';

const sig = () => createHash('sha256').update('review:' + (process.env.ADMIN_PASSWORD || '')).digest('hex');
export const isAdmin = async () => (await cookies()).get('admin')?.value === sig();
export const loginCookie = () => ({ name: 'admin', value: sig(), options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 60 } });
export const checkPassword = (p) => !!process.env.ADMIN_PASSWORD && p === process.env.ADMIN_PASSWORD;
