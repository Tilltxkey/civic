/**
 * i18n.ts
 * ─────────────────────────────────────────────────────────────
 * Minimal translation system. Add keys here, use useLang()
 * anywhere in the app.
 * ─────────────────────────────────────────────────────────────
 */

export type Lang = "fr" | "ht";

export const T: Record<Lang, Record<string, string>> = {
  fr: {
    // Header
    "menu.setPhoto":       "Définir photo",
    "menu.language":       "Langue",
    "menu.darkMode":       "Mode sombre",
    "menu.notifications":  "Notifications",
    "menu.signOut":        "Se déconnecter",
    "menu.credit":         "Propulsé par Pretari Technologies",

    // Race
    "race.noWinner":       "Aucun vainqueur n'a encore été désigné.",
    "race.toWin":          "50 % pour gagner",
    "race.votes":          "votes",
    "race.timeLeft":       "restant",
    "race.done":           "scrutin fermé",

    // Treemap
    "treemap.title":       "Résultats par groupe",
    "treemap.allRaces":    "Toutes les courses",
    "treemap.reporting":   "% dépouillé",
    "treemap.tooClose":    "Trop serré",
    "treemap.noResult":    "Aucun résultat",
    "treemap.watch":       "Surveiller",
    "treemap.elected":     "élu·e",
    "treemap.gap":         "< 2 % d'écart",

    // Vote sheet
    "vote.pickTitle":      "Choisissez votre candidat·e",
    "vote.pickSub":        "Sélectionnez un candidat pour continuer",
    "vote.continue":       "Continuer",
    "vote.confirmTitle":   "Vous voulez voter pour",
    "vote.back":           "← Retour",
    "vote.confirm":        "Votez",
    "vote.doneLabel":      "Terminé",

    // Photo crop
    "crop.title":          "Recadrer",
    "crop.cancel":         "Annuler",
    "crop.ok":             "OK",
    "crop.hint":           "Faites glisser pour recadrer",
    "photo.title":         "Photo de profil",
    "photo.camera":        "Caméra",
    "photo.gallery":       "Galerie",

    // Ticker
    "ticker.flash":        "FLASH",

    // Navbar
    "nav.theses":          "Thèses",
    "theses.subtitle":     "La recherche économique haïtienne, réunie en un seul endroit.",
    "theses.search":       "Titre, auteur…",
    "theses.noResult":     "Aucun résultat pour",
    "nav.vote":            "Voter",
    "nav.community":       "Communauté",
  },

  ht: {
    // Header
    "menu.setPhoto":       "Mete foto",
    "menu.language":       "Lang",
    "menu.darkMode":       "Mòd nwa",
    "menu.notifications":  "Notifikasyon",
    "menu.signOut":        "Dekonekte",
    "menu.credit":         "Fèt pa Pretari Technologies",

    // Race
    "race.noWinner":       "Pa gen venkè ankò.",
    "race.toWin":          "50 % pou genyen",
    "race.votes":          "vòt",
    "race.timeLeft":       "rete",
    "race.done":           "biwo vòt fèmen",

    // Treemap
    "treemap.title":       "Rezilta pa gwoup",
    "treemap.allRaces":    "Tout kous yo",
    "treemap.reporting":   "% depoуye",
    "treemap.tooClose":    "Twò sere",
    "treemap.noResult":    "Pa gen rezilta",
    "treemap.watch":       "Siveyans",
    "treemap.elected":     "eli",
    "treemap.gap":         "< 2 % diferans",

    // Vote sheet
    "vote.pickTitle":      "Chwazi kandida ou",
    "vote.pickSub":        "Seleksyone yon kandida pou kontinye",
    "vote.continue":       "Kontinye",
    "vote.confirmTitle":   "Ou vle vote pou",
    "vote.back":           "← Retounen",
    "vote.confirm":        "Vote",
    "vote.doneLabel":      "Fini",

    // Photo crop
    "crop.title":          "Koupe",
    "crop.cancel":         "Anile",
    "crop.ok":             "OK",
    "crop.hint":           "Glise pou rekabre",
    "photo.title":         "Foto pwofil",
    "photo.camera":        "Kamera",
    "photo.gallery":       "Galri",

    // Ticker
    "ticker.flash":        "FLASH",

    // Navbar
    "nav.theses":          "Tèz",
    "theses.subtitle":     "Rechèch ekonomik ayisyen an, rasanble nan yon sèl kote.",
    "theses.search":       "Tit, otè…",
    "theses.noResult":     "Pa gen rezilta pou",
    "nav.vote":            "Vote",
    "nav.community":       "Kominote",
  },
};