# Audit Frame.io → notre outil (stockage Google Drive)

Sources : [Frame.io V4 player & commenting](https://blog.frame.io/2024/05/28/frame-io-v4-features-player-and-commenting/), [V4 vs Legacy](https://help.frame.io/en/articles/9084073-frame-io-v4-legacy-feature-comparison), [Premiere comments panel](https://help.frame.io/en/articles/9859849-premiere-pro-v4-comment-panel-overview), [frame.io/creative-cloud](https://frame.io/creative-cloud), [comparatifs de prix](https://www.capterra.com/p/148214/Frame-io/pricing/) (les chiffres varient selon les sources : Free ≈ 2 Go / 2 membres, Pro ≈ 15 $/user/mois, Team ≈ 25 $/user/mois).

Légende : ✅ déjà dans le MVP · 🟡 faisable facilement · 🔴 dur / pas rentable · ⛔ hors scope

## 1. Lecteur

| Frame.io | Statut | Note |
|---|---|---|
| Lecteur plein écran, barre de contrôles fixe en bas | 🟡 | Remplacer les contrôles natifs `<video>` par une barre custom |
| Scrub frame-accurate, preview au survol de la timeline | 🟡 | Besoin de sprites de vignettes (ffmpeg, voir §4) |
| Raccourcis clavier J/K/L, ←/→ = 1 frame, espace | 🟡 | Il faut connaître le FPS (Drive le donne dans `videoMediaMetadata`, sinon ffprobe) |
| Auto-pause quand on tape un commentaire | ✅ | |
| Focus rendu au lecteur après envoi | 🟡 | 2 lignes |
| Zoom + mini-map sur l'image | 🟡 | Utile surtout pour annotations précises |
| Lecture HLS adaptative | 🔴 | Drive ne transcode pas pour l'API. Alternative : proxy H.264 léger (§4) |
| Formats : vidéo, audio, image, PDF | 🟡 | Vidéo d'abord, image/PDF ensuite |
| Comparaison de versions côte à côte | 🟡 | 2 lecteurs synchronisés |

## 2. Commentaires & annotations

| Frame.io | Statut | Note |
|---|---|---|
| Commentaire timecodé | ✅ | |
| Commentaire sur une plage (in/out) | 🟡 | Ajouter `t_end` |
| Commentaire ancré (point précis sur l'image) | 🟡 | Ajouter `x,y` en % |
| Annotations dessinées sur la frame | 🟡 | Canvas par-dessus la vidéo : crayon, flèche, rectangle, cercle ; stocké en JSON |
| Réponses (threads) | 🟡 | `parent_id` |
| Statut résolu / à traiter | ✅ | |
| @mentions, notifications | 🟡 | Mail via Resend ; @mentions seulement utiles si comptes |
| Commentaires internes vs publics | 🟡 | Flag `internal`, visible seulement en admin |
| Pièces jointes, réactions emoji | 🟡 | Secondaire (emoji = trivial, pièces jointes = stockage) |
| Hashtags + filtres (annotations, résolus, auteur) | 🟡 | Filtres simples d'abord |
| Lien direct vers un commentaire | 🟡 | `?c=ID` → seek auto |
| Export vers Premiere (commentaires → markers) | ✅ (CSV) | Panel Premiere Frame.io = 🔴, on reste sur import de markers (CSV ✅, XML/EDL 🟡) |

## 3. Organisation, partage, workflow

| Frame.io | Statut | Note |
|---|---|---|
| Projets / dossiers / grille d'assets | 🟡 | **Un dossier Drive = un projet**, listé via l'API Drive |
| Versions / stacks | 🟡 | Convention `_v1/_v2` ou **révisions Drive** (`files.revisions`) |
| Liens de partage invité sans compte | ✅ | |
| Options de lien : mot de passe, expiration, téléchargement, nom | 🟡 | Mot de passe + expiration = rapide |
| Approbation (valider / demander des changements) | 🟡 | Statut par version + bouton dans la page invité |
| Custom branding sur le lien (logo, couleur) | 🟡 | |
| Métadonnées, collections, recherche | 🟡 | Recherche titre/commentaires simple |
| Permissions utilisateurs / rôles | 🟡 | Seulement si tu bosses à plusieurs ; sinon admin unique ✅ |
| Notifications | 🟡 | Mail quand un invité commente |
| App iOS native | ⛔ | La page web responsive suffit |
| Camera to Cloud, Frame.io Transfer | ⛔ | Inutile ici |
| SSO / sécurité entreprise | ⛔ | |

## 4. Lien avec Google Drive : ce qui change vraiment

1. **Streaming** : le MVP passe par un proxy qui relaie les requêtes `Range` vers l'API Drive. Ça marche pour des fichiers « avec le lien » et une clé API. Pour des fichiers privés : OAuth (refresh token) ou compte de service avec dossier partagé.
2. **Pas de transcodage côté Drive** : un ProRes ou un H.264 très lourd sera lent à scrubber. Solution : exporter un proxy H.264 (1080p, ~8 Mb/s, GOP court) dans le dossier Drive, et que l'outil lise celui-là. Option plus tard : worker ffmpeg local qui génère proxy + sprites + waveform à l'ajout d'une vidéo.
3. **Métadonnées gratuites** via Drive : `videoMediaMetadata` (durée, largeur, hauteur), `thumbnailLink`, `modifiedTime`, `revisions`. Ça suffit pour la grille d'assets sans traitement.
4. **Détection de nouvelle version** : pas de webhook simple, mais on peut interroger le dossier (poll toutes les X min ou au chargement) ; détection par nom (`_v2`) ou par révision.
5. **Limites à connaître** : quotas de téléchargement Drive sur gros fichiers très demandés ; la clé API ne marche que pour les fichiers publics ; un lien public Drive reste techniquement devinable, donc le token de review ne protège pas le fichier lui-même (le mettre en « avec le lien » = acceptable pour du client, pas pour du confidentiel).
6. **Hébergement de l'outil** : le MVP est local (SQLite fichier). Pour des clients externes il faut le déployer (VPS, Fly.io, ou un serveur domestique avec tunnel). SQLite → Turso ou volume persistant.

## 5. Interface à reprendre (layout)

- **Accueil** : grille de projets (vignettes, nb de versions, badge commentaires non résolus, statut d'approbation).
- **Projet** : grille/liste d'assets avec vignettes Drive, tri, recherche, stacks de versions repliables.
- **Review** : lecteur à gauche (≈ 70 %), panneau de commentaires à droite (liste triée par timecode, filtres en haut, champ en bas), timeline avec markers colorés par statut, barre d'outils annotation (crayon/flèche/forme/gomme/couleur), sélecteur de version, bouton Approuver.
- **Page invité** : même vue, sans navigation admin, nom demandé une fois (✅), branding du projet.

## 6. Roadmap proposée

**Phase 1 : « remplace Frame.io pour un client »** (le plus gros gain)
1. Dessin sur frame (canvas) + commentaires ancrés + plage in/out
2. Réponses + filtres + lien direct vers un commentaire
3. Versions (révisions Drive ou `_vN`) + sélecteur + comparaison
4. Lien de partage : mot de passe, expiration, approbation, notif mail

**Phase 2 : confort d'éditeur**
5. Raccourcis clavier + frame-step + barre de contrôles custom
6. Projets = dossiers Drive, grille avec vignettes et métadonnées Drive
7. Export markers Premiere (XML en plus du CSV)

**Phase 3 : robustesse**
8. Auth Google (fichiers privés), déploiement, worker proxy/sprites ffmpeg
9. Image/PDF, branding, recherche

---

# Annexe : analyse d'Onde Review (onde-review.com)

Source : [onde-review.com](https://onde-review.com/) (page produit, bêta au 30/09/2026, éditeur THE BROWZ).

## Ce que c'est
**Extension Chrome desktop** qui ajoute la review dans l'interface Google Drive, sans passer par l'API Drive. Les fichiers restent dans Drive, pas de double stockage. Une copie temporaire n'est créée que pour un lien public (supprimée sous 35 jours).

## Fonctionnalités
- Commentaires timecodés ou sur plage, fils de discussion, @mentions, pièces jointes (≤ 20 Mo)
- Annotations rectangle / cercle / flèche sur vidéo, image, PDF (bêta), calées sur le timecode
- Validation par version **ou par dossier entier** + bouton « Review terminée » → récap email à l'équipe
- Alertes email + Slack, réglables par dossier
- **Safezones 9:16** (TikTok, Reels, Stories, Shorts, Snapchat) + « Smart View » qui regroupe les formats d'une même créa d'après le nom des fichiers
- Lien de review fichier ou dossier : **30 jours, révocable**, client sans compte (nom obligatoire, email facultatif), téléchargement possible
- Les commentaires restent dans Drive après expiration du lien
- Pas de Premiere / After Effects, page client non adaptée au mobile
- Prix : gratuit en bêta, puis 29 € HT/mois (1 membre) + 9 €/membre ; reviewers externes gratuits

## Onde vs notre approche

| | Onde | Notre outil |
|---|---|---|
| Architecture | Extension dans Drive | Web app + proxy de streaming Drive |
| Hébergement à gérer | Aucun (côté éditeur) | Oui (local ou déploiement) |
| Prix | 29 €/mois après bêta | Gratuit |
| Dépendance | UI de Drive (fragile si Google change le DOM) | API Drive |
| Export Premiere | Non | Oui (CSV markers) |
| Contrôle de l'interface | Faible | Total |

## À reprendre d'Onde (ajouts roadmap)
1. **Approbation par dossier** + bouton « Review terminée » → mail récap (phase 1, lien de partage)
2. **Lien révocable avec expiration** (30 j par défaut) et possibilité de passer en dossier entier
3. **Safezones 9:16** : calques SVG par plateforme, bouton dans le lecteur (phase 2, très utile pour du social)
4. **Alertes Slack / email par dossier** (phase 3)
5. **Pièces jointes dans un commentaire** (≤ 20 Mo) et **@mentions**
6. Commentaires conservés après expiration du lien, signés du nom de l'auteur

## Verdict
Onde valide le concept (Drive + clients sans compte + annotations) mais est payant et fermé. Rester sur une **web app + proxy** est plus robuste que l'extension : pas de dépendance au DOM de Drive, page client mobile possible, et on garde l'export Premiere. Une extension qui ajoute un bouton « Ouvrir en review » dans Drive pourrait venir tout à la fin, en bonus.
