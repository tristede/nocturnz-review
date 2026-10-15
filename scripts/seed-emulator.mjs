// Prépare l'émulateur local : liste des hôtes. Le mot-clé « owner » contourne les règles (émulateur uniquement).
// Usage : HOSTS="moi@exemple.test" npm run seed:emu   (avec l'émulateur lancé)
const emails = (process.env.HOSTS || 'host@example.test').split(',').map((e) => e.trim().toLowerCase());
const base = `http://127.0.0.1:8080/v1/projects/nocturnz-review/databases/(default)/documents/config/hosts`;
const body = { fields: { emails: { arrayValue: { values: emails.map((stringValue) => ({ stringValue })) } } } };
const r = await fetch(base, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify(body) });
console.log(r.ok ? `Hôtes de l'émulateur : ${emails.join(', ')}` : `Échec ${r.status} : ${await r.text()}`);
