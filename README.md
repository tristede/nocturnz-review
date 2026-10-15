# Nocturnz Review

Outil de review vidéo **sans abonnement**, pensé pour les créateurs : tes clients commentent
directement à l'image près, sur des vidéos qui restent chez toi (Google Drive ou YouTube non
répertorié). Alternative maison à Frame.io / Onde Review.

> Fait partie de la suite d'outils [Nocturnz](https://nocturnz.xyz). Statut : en développement.

## Ce que ça fait

- **Commentaires précis** : timecode à l'image, plage In/Out, dessin sur l'image (flèche, crayon,
  cercle, rectangle, repère), réponses, filtres, lien direct vers un commentaire.
- **Timeline** : onde sonore (mono/stéréo, 4 styles, teinte selon le volume), zoom, pas image par image
  ou seconde par seconde (touche `S`), framerate détecté automatiquement.
- **Versions** : v1, v2… sous un même lien, validation par version, **comparaison côte à côte**
  avec lecture synchronisée.
- **Partage** : lien invité sans compte, mot de passe, expiration, désactivation, « nouveau lien ».
- **Export** des commentaires en markers pour Premiere Pro (CSV).
- **Interface** : simple pour les clients, mode **Pro** pour les monteurs.

## Sources vidéo

| Source | Précision | Onde |
|---|---|---|
| Google Drive (OAuth `drive.file` + sélecteur, ou lien public + clé API) | à l'image | automatique (calculée dans le navigateur de l'admin) |
| YouTube (même non répertorié, intégration autorisée) | non garantie, fps à régler | seulement depuis le fichier source, en local |

## Lancer en local

Prérequis : Node 24 (utilise `node:sqlite`).

```bash
npm install
cp .env.example .env.local   # puis renseigner ADMIN_PASSWORD (et les clés Google si besoin)
npm run dev                  # http://localhost:3100
```

Les données (SQLite) sont dans `data/`, ignoré par git.

## Notes

- Les accès invités sont contrôlés côté serveur sur chaque route (mot de passe, expiration,
  désactivation) ; changer le lien invalide aussi les anciens accès.
- Le streaming Google Drive réel n'a pas encore été éprouvé de bout en bout.
- [`AUDIT-FRAMEIO.md`](AUDIT-FRAMEIO.md) : analyse de Frame.io et d'Onde Review qui a guidé le projet.
