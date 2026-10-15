# Nocturnz Review

Outil de review vidéo **sans abonnement**, pensé pour les créateurs : tes clients commentent
à l'image près, sur des vidéos que tu partages **par lien** (YouTube, même non répertorié, ou
fichier Google Drive partagé « avec le lien »). Aucun compte Drive n'est relié à l'outil.

> Fait partie de la suite d'outils [Nocturnz](https://nocturnz.xyz). Statut : en bêta.

## Ce que ça fait

- **Commentaires précis** : timecode à l'image, plage In/Out, dessin sur l'image, réponses, filtres,
  commentaires en temps réel.
- **Timeline** : onde sonore (mono/stéréo, 4 styles), zoom, pas image par image ou seconde par seconde.
- **Versions** : v1, v2… sous un même lien, validation par version, comparaison côte à côte synchronisée.
- **Partage**, au choix pour chaque review :
  - **lien secret** : quiconque a le lien commente, sans compte ;
  - **sur invitation** : seuls les Gmail listés entrent, après connexion Google.
  Expiration et désactivation du lien dans les deux cas.
- **Export** des commentaires en markers pour Premiere Pro.

## Architecture

Application **statique** (Vite + React) sur **Firebase**, plan gratuit (Spark) : Hosting, Firestore,
Authentication (Google). Pas de serveur à maintenir.

La sécurité est portée par les **règles Firestore** ([`firestore.rules`](firestore.rules)), couvertes
par des tests ([`tests/rules.test.mjs`](tests/rules.test.mjs)) :

- seuls les **hôtes** (Gmail listés dans le document `config/hosts`, illisible côté client) créent et
  gèrent des reviews, et seulement les leurs ;
- l'identifiant d'une review (128 bits aléatoires) fait office de lien secret ; les reviews ne peuvent
  pas être énumérées ;
- un invité ne peut modifier que le statut « résolu » d'un commentaire et la validation d'une version.

## Développer

Prérequis : Node 20+, Java 11+ (émulateurs), Firebase CLI.

```bash
npm install
npm run emulators                         # Auth + Firestore en local
HOSTS="toi@exemple.test" npm run seed:emu # déclare un hôte dans l'émulateur
npm run dev:emu                           # http://localhost:3100, branché sur les émulateurs
npm run test:rules                        # tests des règles de sécurité
```

## Mettre en production

1. Console Firebase → Authentication → activer le fournisseur **Google**.
2. Firestore → créer le document `config/hosts` avec un champ `emails` (tableau de Gmail en minuscules).
3. Pour les vidéos Drive : activer l'**API Google Drive** dans le projet et l'autoriser sur la clé
   « Browser key » (ou fournir `VITE_DRIVE_API_KEY`), restreinte au domaine du site.
4. `npm run build && firebase deploy --only hosting,firestore`.

L'ancienne version (Next.js + SQLite, avec serveur) reste disponible sous l'étiquette `v0-next-sqlite`.
