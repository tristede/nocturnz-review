import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { checkPassword, loginCookie } from '@/lib/auth';

async function login(fd) {
  'use server';
  if (!checkPassword(fd.get('password'))) redirect('/login?err=1');
  const c = loginCookie();
  (await cookies()).set(c.name, c.value, c.options);
  redirect('/');
}

export default async function Login({ searchParams }) {
  const { err } = await searchParams;
  return (
    <div className="wrap" style={{ maxWidth: 420, paddingTop: 120 }}>
      <div className="brand"><i /> Review</div>
      <h1 style={{ fontSize: 34 }}>Espace admin</h1>
      <form action={login} className="row">
        <input name="password" type="password" placeholder="Mot de passe" autoFocus />
        <button>Entrer</button>
      </form>
      {err && <p className="mut" style={{ marginTop: 14 }}>Mot de passe incorrect.</p>}
    </div>
  );
}
