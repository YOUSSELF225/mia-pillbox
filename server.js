// ===========================================
// MARIAM BOT - PRODUCTION READY
// Version 3.2.0 - Style PayParrot intégré
// Créé par Youssef - UPSP (Licence 2, 2026)
// San Pedro, Côte d'Ivoire
// ===========================================

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const crypto = require('crypto');
const { NlpManager } = require('node-nlp');
const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ===========================================
// VALIDATION ENVIRONNEMENT PRODUCTION
// ===========================================
const REQUIRED_ENV_VARS = [
    'WHATSAPP_TOKEN',
    'PHONE_NUMBER_ID',
    'VERIFY_TOKEN',
    'DATABASE_URL',
    'GROQ_API_KEY',
    'SUPPORT_PHONE'
];

const missing = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missing.length > 0) {
    console.error('❌ VARIABLES MANQUANTES:', missing.join(', '));
    process.exit(1);
}

// ===========================================
// CONFIGURATION
// ===========================================
const PORT = 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const IS_PRODUCTION = NODE_ENV === 'production';

// WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';

// Groq Vision
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

// Livraison
const DELIVERY_CONFIG = {
    NIGHT_HOURS: { start: 0, end: 7 },
    PRICES: { DAY: 400, NIGHT: 600 },
    SERVICE_FEE: 500,
    DELIVERY_TIME: 45 // minutes
};

// ===========================================
// LOGGER
// ===========================================
const logger = winston.createLogger({
    level: IS_PRODUCTION ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

if (!IS_PRODUCTION) {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

function log(level, message, data = null) {
    const icons = {
        INFO: '📘', SUCCESS: '✅', ERROR: '❌', BOT: '🤖',
        NLP: '🧠', VISION: '📸', WEBHOOK: '📨', DB: '💾',
        ORDER: '📦', LIVREUR: '🛵', WARN: '⚠️', BUTTON: '🔘'
    };
    logger.log(level.toLowerCase(), `${icons[level] || '📌'} ${message}`, { data });
    if (!IS_PRODUCTION) {
        console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${icons[level] || '📌'} ${message}`, data || '');
    }
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: IS_PRODUCTION ? { rejectUnauthorized: true } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000
});

pool.on('error', (err) => log('ERROR', 'Erreur pool DB:', err));

// ===========================================
// CACHE
// ===========================================
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const processedMessages = new NodeCache({ stdTTL: 600 });
const pendingConversations = new NodeCache({ stdTTL: 3600 });
const validationAttempts = new NodeCache({ stdTTL: 3600 });

// ===========================================
// ÉTATS CONVERSATION
// ===========================================
const ConversationStates = {
    IDLE: 'IDLE',
    WAITING_MEDICINE: 'WAITING_MEDICINE',
    SELECTING_MEDICINE: 'SELECTING_MEDICINE',
    WAITING_QUANTITY: 'WAITING_QUANTITY',
    WAITING_QUARTIER: 'WAITING_QUARTIER',
    WAITING_VILLE: 'WAITING_VILLE',
    WAITING_NAME: 'WAITING_NAME',
    WAITING_AGE: 'WAITING_AGE',
    WAITING_GENDER: 'WAITING_GENDER',
    WAITING_WEIGHT: 'WAITING_WEIGHT',
    WAITING_HEIGHT: 'WAITING_HEIGHT',
    WAITING_PHONE: 'WAITING_PHONE',
    WAITING_INDICATIONS: 'WAITING_INDICATIONS',
    WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
    WAITING_IMAGE_SELECTION: 'WAITING_IMAGE_SELECTION',
    WAITING_QUANTITY_ADJUST: 'WAITING_QUANTITY_ADJUST',
    ORDER_CONFIRMED: 'ORDER_CONFIRMED',
    DELIVERY_IN_PROGRESS: 'DELIVERY_IN_PROGRESS',
    ORDER_COMPLETED: 'ORDER_COMPLETED'
};

// ===========================================
// BOUTONS
// ===========================================
const BUTTONS = {
    CONFIRM: 'Confirmer ✔',
    MODIFY: 'Modifier ❌',
    CANCEL: 'Annuler',
    DELIVERY_CONFIRM: 'Livraison récupérée 🛵',
    DELIVERY_ISSUE: 'Problème de livraison ⚠️'
};

const ALLOWED_BUTTONS = new Set([
    BUTTONS.CONFIRM,
    BUTTONS.MODIFY,
    BUTTONS.CANCEL,
    BUTTONS.DELIVERY_CONFIRM,
    BUTTONS.DELIVERY_ISSUE
]);

// ===========================================
// MESSAGES STYLE PAYPARROT
// Version avec plus de 500 variations
// ===========================================
const MESSAGES = {
    // ===========================================
    // SALUTATIONS - 25 variations
    // ===========================================
    GREETINGS: [
        (nom) => `👋 Salut ${nom || 'toi'} ! Je suis MARIAM. 💊 Quel médicament aujourd'hui ?`,
        (nom) => `👋 Bonjour ${nom || ''} ! MARIAM à ton service. 💾 Ta commande ?`,
        (nom) => `👋 Hey ${nom || ''} ! Prêt à commander ? 💊 Dis-moi.`,
        (nom) => `👋 Salut ${nom || ''} ! En quoi je peux t'aider ? 💊`,
        (nom) => `👋 Bienvenue ${nom || ''} ! Quel médicament aujourd'hui ?`,
        (nom) => `👋 Coucou ${nom || ''} ! MARIAM est là pour toi. 💊`,
        (nom) => `👋 Salut toi ! On commande quoi aujourd'hui ? 😊`,
        (nom) => `👋 Yo ${nom || ''} ! MARIAM en ligne. 💊 Quel médicament ?`,
        (nom) => `👋 Bonjour ! Je suis MARIAM, ton assistante santé. 💊`,
        (nom) => `👋 Salut ! MARIAM est prête à t'aider. 💊`,
        (nom) => `👋 Hello ${nom || ''} ! Comment puis-je t'aider aujourd'hui ?`,
        (nom) => `👋 Bonjour ${nom || ''} ! Ravie de te revoir ! 💊`,
        (nom) => `👋 Salut ${nom || ''} ! Qu'est-ce que je te prépare ?`,
        (nom) => `👋 Bonjour ! MARIAM à l'écoute. 💊 Ta liste ?`,
        (nom) => `👋 Salut ! En forme aujourd'hui ${nom || ''} ? 💊`,
        (nom) => `👋 Hey ! C'est MARIAM. 💊 Je t'écoute !`,
        (nom) => `👋 Bonjour ${nom || ''} ! Prêt pour ta commande ?`,
        (nom) => `👋 Salut ! MARIAM disponible 24/7. 💊`,
        (nom) => `👋 Coucou ! Je suis là ${nom || ''}. 💊`,
        (nom) => `👋 Bonjour ! ${nom ? 'Content de te revoir ' + nom : 'Nouveau client ?'} 💊`,
        (nom) => `👋 Salut ! Alors, on commande quoi ${nom || ''} ?`,
        (nom) => `👋 Hey ! MARIAM dans la place. 💊`,
        (nom) => `👋 Bonjour ! Je t'écoute ${nom || ''}.`,
        (nom) => `👋 Salut ! Prêt pour une nouvelle commande ?`,
        (nom) => `👋 Hello ! MARIAM te souhaite la bienvenue. 💊`
    ],

    // ===========================================
    // PREMIÈRE INTERACTION - 15 variations style PayParrot
    // ===========================================
    FIRST_INTERACTION: [
        (nom) => `# MARIAM - Assistant Santé
👋 *Salut ${nom || 'toi'} !*

---

Je suis ton assistante santé 24/7 à San Pedro. 💊

**Ce que je peux faire pour toi :**
- Trouver des médicaments (par nom ou photo)
- Préparer ta commande en 3 étapes
- Organiser la livraison rapide

**Exemples :**
- "2 doliprane 500"
- Envoie une photo de ta boîte
- "aide" pour le mode d'emploi

⚠️ *On livre uniquement à San Pedro*

---

${new Date().getHours() > 18 ? 'Bonne soirée' : 'Bonne journée'} !`,
        
        (nom) => `# Bienvenue sur MARIAM
🌟 *Salut ${nom || ''} !*

---

Je suis ta pharmacienne virtuelle préférée à San Pedro. 🏥

**Comment commander :**
1. Dis-moi le médicament
2. Donne ton quartier
3. Confirme et c'est parti !

**Astuce :** Envoie une photo de ton ordonnance, je détecte tout automatiquement !

📍 *Zone de livraison : San Pedro uniquement*

---

Prêt à commencer ? 👇`,
        
        (nom) => `👋 *Salut ${nom || 'toi'} !* Je suis **MARIAM**, ton assistante santé 24/7 à San Pedro. 💊
📌 *Ma mission* : Te permettre de commander tes médicaments en 2 min chrono, par message ou photo !
💡 *Exemples* :
- "2 doliprane 500"
- Envoie une 📸 de ta boîte ou ordonnance
- "aide" pour le mode d'emploi
⚠️ *On livre uniquement à San Pedro pour l'instant.`,

        (nom) => `🌟 *Bienvenue ${nom || ''} !* Moi c'est **MARIAM**, ton pharmacien digital à San Pedro. 🏥
✅ *Je peux* :
- Trouver tes médicaments (par nom ou photo)
- Te livrer en 45 min (jour) ou 1h (nuit)
- Prendre ta commande en 3 étapes max
📌 *Exemple* : "${nom ? nom + ', ' : ''}envoie '1 boîte de doliprane' ou une photo !"
💬 *Besoin d'aide ?* Dis juste "aide" !`,

        (nom) => `🎯 *Hey ${nom || ''}* C'est MARIAM ! Ta pharmacienne virtuelle préférée ! 
👉 *Ce que je fais* : Je trouve tes médocs et je te les livre à San Pedro.
🎁 *Nouveau* : Envoie une photo de ton ordonnance, je détecte tout automatiquement !
⚡ *Exemple* : "3 paracétamol 1000" ou envoie une photo !`
    ],

    // ===========================================
    // DEMANDE QUARTIER - 20 variations
    // ===========================================
    ASK_QUARTIER: [
        (nom) => `📍 ${nom || 'Ton'} quartier à San Pedro ?`,
        (nom) => `📍 Où te livrer ${nom || ''} ? (quartier)`,
        (nom) => `📍 Quartier de livraison ${nom || ''} ?`,
        (nom) => `📍 C'est pour quel quartier ${nom || ''} ?`,
        (nom) => `📍 Adresse ${nom || ''} ? (quartier)`,
        (nom) => `📍 Dans quel quartier es-tu ${nom || ''} ?`,
        (nom) => `📍 Ton quartier ${nom || ''} pour la livraison ?`,
        (nom) => `📍 Dis-moi ton quartier ${nom || ''} 😊`,
        (nom) => `📍 Pour te livrer, j'ai besoin de ton quartier ${nom || ''} !`,
        (nom) => `📍 ${nom || ''}, tu habites quel quartier à San Pedro ?`,
        (nom) => `📍 On se retrouve où ${nom || ''} ? (quartier)`,
        (nom) => `📍 Indique ton quartier ${nom || ''} (ex: Cité, Balmer, Saguitta)`,
        (nom) => `📍 Où dois-je envoyer le livreur ${nom || ''} ?`,
        (nom) => `📍 ${nom || ''}, c'est pour quel quartier ?`,
        (nom) => `📍 Dernière question avant la suite : ton quartier ?`,
        (nom) => `📍 Je note ton adresse. Quartier ${nom || ''} ?`,
        (nom) => `📍 ${nom || ''}, précise ton quartier à San Pedro.`,
        (nom) => `📍 La livraison se fera dans quel quartier ${nom || ''} ?`,
        (nom) => `📍 Pour finaliser, j'ai besoin de ton quartier.`,
        (nom) => `📍 ${nom || ''}, c'est parti pour le quartier !`
    ],

    // ===========================================
    // DEMANDE VILLE - 12 variations
    // ===========================================
    ASK_VILLE: [
        (nom) => `📍 C'est à San Pedro ${nom || ''} ? (oui/non)`,
        (nom) => `📍 On livre uniquement à San Pedro. OK ${nom || ''} ?`,
        (nom) => `📍 Tu es bien à San Pedro ${nom || ''} ?`,
        (nom) => `📍 Confirme que tu es à San Pedro ${nom || ''} !`,
        (nom) => `📍 Juste pour vérifier : c'est San Pedro ${nom || ''} ?`,
        (nom) => `📍 ${nom || ''}, tu es dans quelle ville ? (San Pedro uniquement)`,
        (nom) => `📍 La livraison est possible seulement à San Pedro. C'est bon ?`,
        (nom) => `📍 Dernière vérif : ta ville c'est San Pedro ${nom || ''} ?`,
        (nom) => `📍 On livre qu'à San Pedro. C'est bien ta ville ?`,
        (nom) => `📍 ${nom || ''}, confirme que tu es à San Pedro (oui/non)`,
        (nom) => `📍 Tu es situé à San Pedro ${nom || ''} ?`,
        (nom) => `📍 Avant de continuer : ta ville c'est San Pedro ?`
    ],

    // ===========================================
    // DEMANDE NOM - 15 variations
    // ===========================================
    ASK_NAME: [
        (nom) => `👤 ${nom || 'Ton'} nom complet ?`,
        (nom) => `👤 Qui est le client ${nom || ''} ?`,
        (nom) => `👤 Nom et prénom ${nom || ''} ?`,
        (nom) => `👤 Je note à quel nom ${nom || ''} ?`,
        (nom) => `👤 Comment tu t'appelles ${nom || ''} ?`,
        (nom) => `👤 C'est pour quelle personne ${nom || ''} ?`,
        (nom) => `👤 Je prépare la commande. Ton nom ?`,
        (nom) => `👤 ${nom || ''}, dis-moi ton nom complet.`,
        (nom) => `👤 Pour la facture, c'est quel nom ?`,
        (nom) => `👤 Identité du client ${nom || ''} ?`,
        (nom) => `👤 Je te connais mais rappelle-moi ton nom ?`,
        (nom) => `👤 Ton prénom et nom ${nom || ''} ?`,
        (nom) => `👤 Comment dois-je t'appeler ${nom || ''} ?`,
        (nom) => `👤 C'est noté à quel nom ${nom || ''} ?`,
        (nom) => `👤 Dernière étape : ton nom complet ?`
    ],

    // ===========================================
    // DEMANDE ÂGE - 12 variations
    // ===========================================
    ASK_AGE: [
        (nom) => `🎂 Âge ${nom || ''} ?`,
        (nom) => `🎂 Quel âge ${nom || ''} ? (ex: 25)`,
        (nom) => `🎂 Âge du patient ${nom || ''} ?`,
        (nom) => `🎂 Tu as quel âge ${nom || ''} ?`,
        (nom) => `🎂 Ton âge ${nom || ''} ? (entre 1 et 120)`,
        (nom) => `🎂 Pour le dosage, j'ai besoin de ton âge.`,
        (nom) => `🎂 ${nom || ''}, c'est pour quel âge ?`,
        (nom) => `🎂 Anniversaire ? Donne ton âge.`,
        (nom) => `🎂 Combien d'années ${nom || ''} ?`,
        (nom) => `🎂 Âge requis pour la prescription.`,
        (nom) => `🎂 C'est pour toi ? Quel âge as-tu ?`,
        (nom) => `🎂 Dernière précision : ton âge ?`
    ],

    // ===========================================
    // DEMANDE GENRE - 10 variations
    // ===========================================
    ASK_GENDER: [
        (nom) => `⚥ Genre ${nom || ''} ? (M/F)`,
        (nom) => `⚥ Masculin ou féminin ${nom || ''} ?`,
        (nom) => `⚥ M ou F ${nom || ''} ?`,
        (nom) => `⚥ Tu es un homme ou une femme ?`,
        (nom) => `⚥ Genre du patient ? (M/F)`,
        (nom) => `⚥ Pour le dossier, M ou F ?`,
        (nom) => `⚥ ${nom || ''}, précise ton sexe.`,
        (nom) => `⚥ Homme ou femme ?`,
        (nom) => `⚥ Genre (M pour masculin, F pour féminin)`,
        (nom) => `⚥ C'est noté : M ou F ?`
    ],

    // ===========================================
    // DEMANDE POIDS - 12 variations
    // ===========================================
    ASK_WEIGHT: [
        (nom) => `⚖️ Poids ${nom || ''} ? (kg)`,
        (nom) => `⚖️ En kg ${nom || ''} ? (ex: 70)`,
        (nom) => `⚖️ Combien de kilos ${nom || ''} ?`,
        (nom) => `⚖️ Ton poids ${nom || ''} ?`,
        (nom) => `⚖️ Poids du patient (kg) ?`,
        (nom) => `⚖️ Pour adapter le dosage, ton poids ?`,
        (nom) => `⚖️ Tu pèses combien ${nom || ''} ?`,
        (nom) => `⚖️ Poids corporel ? (20-200 kg)`,
        (nom) => `⚖️ Indique ton poids en kg.`,
        (nom) => `⚖️ Combien de kilos fais-tu ?`,
        (nom) => `⚖️ Dernière info : ton poids ?`,
        (nom) => `⚖️ Poids actuel ${nom || ''} ?`
    ],

    // ===========================================
    // DEMANDE TAILLE - 12 variations
    // ===========================================
    ASK_HEIGHT: [
        (nom) => `📏 Taille ${nom || ''} ? (cm)`,
        (nom) => `📏 En cm ${nom || ''} ? (ex: 175)`,
        (nom) => `📏 Combien de cm ${nom || ''} ?`,
        (nom) => `📏 Ta taille ${nom || ''} ?`,
        (nom) => `📏 Taille du patient (cm) ?`,
        (nom) => `📏 Quelle est ta taille ?`,
        (nom) => `📏 Tu mesures combien ${nom || ''} ?`,
        (nom) => `📏 Taille en centimètres ?`,
        (nom) => `📏 Indique ta taille (100-250 cm)`,
        (nom) => `📏 Combien mesures-tu ?`,
        (nom) => `📏 Taille actuelle ?`,
        (nom) => `📏 Dernière mesure : ta taille ?`
    ],

    // ===========================================
    // DEMANDE TÉLÉPHONE - 15 variations
    // ===========================================
    ASK_PHONE: [
        (nom) => `📞 Téléphone ${nom || ''} ?`,
        (nom) => `📞 Numéro de contact ${nom || ''} ?`,
        (nom) => `📞 Où joindre ${nom || ''} ?`,
        (nom) => `📞 Ton numéro ${nom || ''} ? (ex: 0701234567)`,
        (nom) => `📞 Quel numéro pour le livreur ?`,
        (nom) => `📞 Contact téléphonique ?`,
        (nom) => `📞 Sur quel numéro te joindre ?`,
        (nom) => `📞 Téléphone du client ?`,
        (nom) => `📞 Numéro WhatsApp ou appel ?`,
        (nom) => `📞 Laisse ton numéro (10 chiffres)`,
        (nom) => `📞 Comment te contacter ?`,
        (nom) => `📞 Pour la livraison, ton téléphone ?`,
        (nom) => `📞 Dernier détail : ton numéro ?`,
        (nom) => `📞 Téléphone valide (07/01/05) ?`,
        (nom) => `📞 C'est noté pour le contact. Ton numéro ?`
    ],

    // ===========================================
    // DEMANDE INDICATIONS - 15 variations
    // ===========================================
    ASK_INDICATIONS: [
        (nom) => `📍 Indications pour le livreur ${nom || ''} ? (ou 'non')`,
        (nom) => `📍 Porte, sonnette, immeuble ${nom || ''} ?`,
        (nom) => `📍 Comment te trouver ${nom || ''} ?`,
        (nom) => `📍 Des indications pour le livreur ?`,
        (nom) => `📍 Où exactement ? (ex: porte bleue)`,
        (nom) => `📍 Point de repère ? (marché, école, etc.)`,
        (nom) => `📍 Instructions pour trouver ta maison ?`,
        (nom) => `📍 Code d'entrée, étage, bâtiment ?`,
        (nom) => `📍 Des précisions pour le livreur ?`,
        (nom) => `📍 Comment reconnaître ta porte ?`,
        (nom) => `📍 Y a-t-il des indications particulières ?`,
        (nom) => `📍 Sonnette, porte, immeuble ?`,
        (nom) => `📍 Pour faciliter la livraison, des infos ?`,
        (nom) => `📍 Indications GPS ou description ?`,
        (nom) => `📍 Rien de spécial ? Dis "non"`
    ],

    // ===========================================
    // AJOUT AU PANIER - 20 variations
    // ===========================================
    ADDED_TO_CART: (qty, med, total, nom) => [
        `# AJOUTÉ ! ✅
📦 ${qty}x ${med} - ${total} FCFA

---

🛒 *Total panier*: à vérifier avec "mon panier"

---

${nom ? `${nom}, ` : ''}autre chose ? 👇`,

        `# C'EST NOTÉ ! 📝
✅ ${qty}x ${med} ajouté (${total} FCFA)

---

👉 "mon panier" pour voir tout
👉 Ou continue ta commande`,

        `✅ ${qty}x ${med} ajouté (${total}F) ${nom ? `, ${nom} !` : ''}`,
        `✅ Parfait ${nom || ''} ! ${qty}x ${med} pour ${total}F`,
        `✅ ${qty}x ${med} - Total : ${total}F`,
        `✅ ${med} ajouté ${nom || ''} ! ${qty} boîtes pour ${total}F`,
        `✅ Commande mise à jour ${nom || ''} : ${qty}x ${med} (${total}F)`,
        `✅ Super ${nom || ''} ! ${qty}x ${med} ajouté. Total : ${total}F`,
        `✅ ${med} x${qty} ajouté ${nom || ''}. Total : ${total}F`,
        `✅ Ton panier ${nom || ''} : ${qty}x ${med} (${total}F)`,
        `✅ C'est noté ! ${qty}x ${med} ajouté.`,
        `✅ ${qty} ${med} - OK ! Total intermédiaire : ${total}F`,
        `✅ Ajouté ! ${qty}x ${med} (${total}F)`,
        `✅ Pris en compte : ${qty}x ${med}`,
        `✅ ${med} : ${qty} boîte(s) ajoutée(s).`,
        `✅ Parfait ! J'ajoute ${qty} ${med}.`,
        `✅ C'est fait ! ${qty}x ${med} dans ton panier.`,
        `✅ ${nom || ''}, j'ai ajouté ${qty}x ${med}.`,
        `✅ Voilà ! ${qty}x ${med} (${total}F)`,
        `✅ Commande mise à jour avec ${qty}x ${med}.`,
        `✅ ${qty}x ${med} - C'est enregistré !`,
        `✅ Super ! ${qty} ${med} ajouté(s).`
    ],

    // ===========================================
    // DEMANDE "AUTRE CHOSE" - 20 variations
    // ===========================================
    ASK_MORE: [
        "🛒 Autre chose ?",
        "✅ Ajouté ! Ensuite ?",
        "💊 On continue ?",
        "👍 Suite ?",
        "🛒 Autre médicament ?",
        "💊 Besoin d'autre chose ?",
        "👉 Et avec ça ?",
        "🛒 C'est tout ou on ajoute autre chose ?",
        "💊 Tu veux autre chose ?",
        "✅ Pris en compte. Ensuite ?",
        "🛒 La suite de ta commande ?",
        "💊 Autre article ?",
        "👉 On continue les achats ?",
        "🛒 Tu ajoutes autre chose ?",
        "💊 C'est bon ou on rajoute ?",
        "✅ C'est noté. Autre chose à commander ?",
        "🛒 Et ensuite ?",
        "💊 Tu veux autre médicament ?",
        "👉 On fait quoi d'autre ?",
        "🛒 La commande continue ?"
    ],

    // ===========================================
    // PANIER VIDE - 12 variations
    // ===========================================
    CART_EMPTY: [
        "🛒 Panier vide. Que veux-tu ?",
        "📭 Rien pour l'instant. Dis-moi.",
        "💊 Panier vide. Ta commande ?",
        "🛒 Ton panier est vide. Quel médicament ?",
        "📭 Rien dans ton panier. On commande ?",
        "🛒 C'est vide ! Que souhaites-tu acheter ?",
        "💊 Aucun article. Premier médicament ?",
        "🛒 Panier à remplir. Je t'écoute !",
        "📭 Tu n'as rien choisi. Quel médicament ?",
        "💊 Commençons par le premier article !",
        "🛒 C'est parti pour ta commande !",
        "📭 Panier neuf. Premier médicament ?"
    ],

    // ===========================================
    // MÉDICAMENT NON TROUVÉ - 15 variations
    // ===========================================
    NOT_FOUND: (query) => [
        `😕 Pas de "${query}". Autre chose ?`,
        `😕 "${query}" inconnu. Réessaie.`,
        `🔍 Rien pour "${query}". Cherche autrement.`,
        `😕 "${query}" introuvable. Vérifie l'orthographe.`,
        `🔍 Aucun résultat pour "${query}".`,
        `😕 Désolé, "${query}" n'existe pas dans notre stock.`,
        `🔍 Essaie avec un autre nom pour "${query}".`,
        `😕 "${query}" ? Je ne connais pas.`,
        `🔍 Pas de "${query}" en ce moment.`,
        `😕 Médicament "${query}" non disponible.`,
        `🔍 Vérifie le nom : "${query}" n'est pas trouvé.`,
        `😕 "${query}" ? Essaie avec le nom exact.`,
        `🔍 Stock vide pour "${query}".`,
        `😕 Désolé, pas de "${query}" dans notre base.`,
        `🔍 Autre recherche ? "${query}" n'existe pas.`
    ],

    // ===========================================
    // ERREUR - 15 variations
    // ===========================================
    ERROR: [
        "❌ Pas compris. Réessaie.",
        "😕 J'ai pas capté. Redis.",
        "❌ Désolé, pas compris. 'aide' si besoin.",
        "😕 Je n'ai pas compris. Peux-tu reformuler ?",
        "❌ Erreur. Réessaie, s'il te plaît.",
        "😕 Message pas clair. Autre formulation ?",
        "❌ Je ne comprends pas. Sois plus précis.",
        "😕 Peux-tu répéter autrement ?",
        "❌ Désolé, je n'ai pas saisi.",
        "😕 Essaie de reformuler ta demande.",
        "❌ Pas clair pour moi. Réessaie.",
        "😕 Je ne capte pas. Tu peux répéter ?",
        "❌ Oups, j'ai pas compris.",
        "😕 Message non reconnu. Réessaie.",
        "❌ Erreur de compréhension. 'aide' pour assistance."
    ],

    // ===========================================
    // VALIDATION ERRORS - 5 variations par champ
    // ===========================================
    VALIDATION_ERRORS: {
        NAME: [
            "👤 Le nom doit faire au moins 2 caractères. Exemple : 'Jean Kouamé'.",
            "❌ Nom invalide. Utilise seulement des lettres.",
            "📛 Ton nom semble incorrect. Réessaie.",
            "👤 Prénom et nom, sans chiffres ni symboles.",
            "❌ Format nom incorrect. Exemple: 'Marie Claire'."
        ],
        AGE: [
            "🎂 Âge invalide. Doit être un nombre entre 1 et 120 ans.",
            "❌ L'âge doit être un nombre (ex: 25).",
            "👶 Âge non valide. Dis-moi un âge réaliste.",
            "🎂 Entre 1 et 120 ans. Quel est ton âge ?",
            "❌ Âge incorrect. Exemple: '30' pour 30 ans."
        ],
        GENDER: [
            "⚥ Genre invalide. Réponds avec M (masculin) ou F (féminin).",
            "👔 Je n'ai pas compris. Dis M ou F.",
            "⚧ Genre requis. Exemple : 'M' ou 'F'.",
            "⚥ Masculin (M) ou Féminin (F) ?",
            "👤 Précise ton genre : M ou F."
        ],
        WEIGHT: [
            "⚖️ Poids invalide. Doit être entre 20 et 200 kg (ex: 70).",
            "🏋️ Le poids doit être un nombre en kg.",
            "⚖️ Valeur impossible. Poids réaliste entre 20 et 200 kg.",
            "⚖️ Exemple: '65' pour 65 kg. Ton poids ?",
            "🏋️ Poids incorrect. Entre 20 et 200 kg."
        ],
        HEIGHT: [
            "📏 Taille invalide. Doit être entre 100 et 250 cm (ex: 175).",
            "📐 La taille doit être un nombre en cm.",
            "📏 Taille non réaliste. Entre 100 et 250 cm.",
            "📏 Exemple: '170' pour 1m70. Ta taille ?",
            "📐 Taille incorrecte. En cm, entre 100 et 250."
        ],
        PHONE: [
            "📞 Numéro invalide. Format : 07XXXXXXXX, 01XXXXXXXX ou 05XXXXXXXX.",
            "📱 Ce numéro n'est pas valide. Exemple : 0701234567.",
            "📞 Format incorrect. Utilise un numéro ivoirien (10 chiffres).",
            "📱 10 chiffres commençant par 07, 01 ou 05.",
            "📞 Numéro non reconnu. Exemple: 0701020304."
        ],
        QUARTIER: [
            "📍 Le quartier doit faire au moins 2 caractères. Exemple : 'Cité'.",
            "🗺️ Précise un quartier valide.",
            "📌 Quel est ton quartier ? (ex: Cité, Balmer)",
            "📍 Quartier non reconnu. Réessaie.",
            "🗺️ Indique un quartier de San Pedro."
        ],
        VILLE: [
            "🏙️ Désolé, on ne livre qu'à San Pedro pour l'instant.",
            "📍 Ville non desservie. On livre uniquement à San Pedro.",
            "🏘️ Zone de livraison limitée à San Pedro.",
            "📍 San Pedro seulement. C'est bon ?",
            "🏙️ Nous livrons seulement à San Pedro."
        ]
    },

    // ===========================================
    // RETRY PROMPTS - 5 variations par étape
    // ===========================================
    RETRY_PROMPTS: {
        NAME: [
            "👤 Quel est ton nom complet ? (ex: Jean Kouamé)",
            "📛 Dis-moi ton nom et prénom.",
            "👤 À quel nom je note la commande ?",
            "👤 Je répète : ton nom complet ?",
            "📛 Prénom et nom, s'il te plaît."
        ],
        AGE: [
            "🎂 Quel est ton âge ? (nombre entre 1 et 120)",
            "👶 Âge du patient ? (ex: 30)",
            "🎂 Dis-moi ton âge pour finaliser.",
            "🎂 Rappelle-moi ton âge ?",
            "👶 Combien d'années as-tu ?"
        ],
        GENDER: [
            "⚥ Genre ? Réponds avec M ou F.",
            "👔 Masculin ou féminin ? (M/F)",
            "⚧ M ou F ?",
            "⚥ Homme ou femme ? (M/F)",
            "👤 Précise ton genre (M/F)."
        ],
        WEIGHT: [
            "⚖️ Quel est ton poids en kg ? (ex: 70)",
            "🏋️ Poids ? (entre 20 et 200 kg)",
            "⚖️ Combien pèses-tu ? (en kg)",
            "⚖️ Ton poids, en chiffres svp.",
            "🏋️ Indique ton poids (ex: 75)."
        ],
        HEIGHT: [
            "📏 Quelle est ta taille en cm ? (ex: 175)",
            "📐 Taille ? (entre 100 et 250 cm)",
            "📏 En cm ? (ex: 160)",
            "📏 Combien mesures-tu en cm ?",
            "📐 Taille en centimètres ?"
        ],
        PHONE: [
            "📞 Quel est ton numéro ? (ex: 0701234567)",
            "📱 Numéro pour le livreur ? (10 chiffres)",
            "📞 À quel numéro te contacter ?",
            "📞 Téléphone ? (07XXXXXXXX)",
            "📱 Contact téléphonique, stp."
        ],
        QUARTIER: [
            (nom) => `📍 Quel est ton quartier à San Pedro ${nom || ''} ?`,
            (nom) => `🗺️ Où te livrer ${nom || ''} ?`,
            (nom) => `📌 Précise ton quartier ${nom || ''}.`,
            (nom) => `📍 ${nom || ''}, ton quartier de livraison ?`,
            (nom) => `🗺️ Quartier ${nom || ''} ?`
        ],
        VILLE: [
            "📍 C'est bien à San Pedro ? (oui/non)",
            "📍 Confirme que tu es à San Pedro.",
            "🏙️ Tu es à San Pedro ? (oui/non)",
            "📍 Ville de livraison : San Pedro ?",
            "🏙️ San Pedro uniquement. OK ?"
        ]
    },

    // ===========================================
    // NOTIFICATIONS - Variées
    // ===========================================
    NOTIFICATIONS: {
        ORDER_CREATED: (order) => `📦 *NOUVELLE COMMANDE #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Livraison* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* :
${order.items.map(item => `   • ${item.quantite}x ${item.nom_commercial}`).join('\n')}
💰 *Total* : ${order.total} FCFA
🔑 *Code* : ${order.confirmation_code}
🕒 ${new Date().toLocaleTimeString('fr-FR')}`,

        DELIVERY_ASSIGNED: (order, livreur) => `🛵 *LIVRAISON ASSIGNÉE #${order.id}*
👨‍🚀 *Livreur* : ${livreur.nom} (${livreur.telephone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* : ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
💰 *Total* : ${order.total} FCFA
🔑 *Code client* : ${order.confirmation_code}
⏱️ *Prépare-toi à récupérer !"`,

        DELIVERY_CONFIRMED: (order) => `🚀 *LIVRAISON EN COURS #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* : ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
💰 *Total* : ${order.total} FCFA
🕒 *Arrivée prévue dans ${DELIVERY_CONFIG.DELIVERY_TIME} min*`,

        DELIVERY_COMPLETED: (order) => `✅ *LIVRAISON TERMINÉE #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
💰 *Montant* : ${order.total} FCFA
👍 *Livré avec succès ! Merci !"`,

        DELIVERY_ISSUE: (order) => `⚠️ *PROBLÈME DE LIVRAISON #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* : ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
💰 *Total* : ${order.total} FCFA
📞 *Contacter le client d'urgence !"`,

        ORDER_CANCELLED: (order) => `❌ *COMMANDE ANNULÉE #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📦 *Articles* : ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
💰 *Montant* : ${order.total} FCFA
🕒 Annulé le ${new Date().toLocaleString('fr-FR')}`
    },

    // ===========================================
    // RÉSUMÉ DE COMMANDE - Style PayParrot
    // ===========================================
    ORDER_SUMMARY: (conv, context = {}) => {
        const subtotal = conv.cart.reduce((sum, item) => sum + (item.prix * item.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;
        
        const items = conv.cart.map(item => 
            `• ${item.quantite}x ${item.nom_commercial} - ${item.prix * item.quantite} FCFA`
        ).join('\n');

        return `# RÉSUMÉ DE TA COMMANDE
📋 *Détails*

---

${items}

---

📍 *LIVRAISON*
• Quartier: ${conv.context.client_quartier}
• Ville: San Pedro
• Indications: ${conv.context.client_indications || 'Aucune'}
• ${delivery.message}: ${delivery.price} FCFA
• Arrivée prévue à ${Utils.estimateDeliveryTime()}

---

👤 *INFORMATIONS CLIENT*
• ${conv.context.client_nom || 'Non précisé'}
• 📞 ${conv.context.client_telephone || 'Non précisé'}
• 🎂 ${conv.context.patient_age || '?'} ans
• ⚖️ ${conv.context.patient_poids || '?'} kg
• 📏 ${conv.context.patient_taille || '?'} cm

---

💰 *TOTAL À PAYER*
• Sous-total: ${subtotal} FCFA
• Livraison: ${delivery.price} FCFA
• Frais service: ${DELIVERY_CONFIG.SERVICE_FEE} FCFA
• *TOTAL: ${total} FCFA*

💳 Paiement à la livraison
🔑 Code généré après confirmation

---

${context.nom ? `${context.nom}, ` : ''}tout est bon ? Confirme avec le bouton 👇`
    },

    // ===========================================
    // CONFIRMATION DE COMMANDE - Style PayParrot
    // ===========================================
    CONFIRM_ORDER: (order, nom) => [
        `# COMMANDE CONFIRMÉE 🎉
✅ *Merci ${nom || ''} !*

---

📦 *N°*: ${order.id}
📍 *Adresse*: ${order.client_quartier}, San Pedro
📌 *Indications*: ${order.client_indications || 'Aucune'}

---

${order.items.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n')}

---

💰 *Total*: ${order.total} FCFA
🕒 *Livraison prévue*: ${Utils.estimateDeliveryTime()}

🔑 *Code de confirmation*: ${order.confirmation_code}

---

📱 Le livreur t'appellera sur ${order.client_phone}

💡 *Garde ce message, le livreur te demandera le code*

À très vite ! 👋`,

        `# VALIDÉ ! ✅
🎯 *Commande #${order.id}*

---

📍 *Livraison*
• Quartier: ${order.client_quartier}
• Ville: San Pedro
• ${order.client_indications || 'Sans indications'}

---

💰 *Total*: ${order.total} FCFA
🕒 *Arrivée*: ${Utils.estimateDeliveryTime()}

🔑 *Code*: ${order.confirmation_code}

---

📞 Contact: ${order.client_phone}

Merci pour ta confiance ${nom || ''} ! 🙏`,

        `🎉 *Commande confirmée ${nom || ''} !*

N°: ${order.id}
📍 ${order.client_quartier}, San Pedro
📌 ${order.client_indications || 'Aucune indication'}
💰 ${order.total} FCFA

🛵 Livraison vers ${Utils.estimateDeliveryTime()}
📱 Le livreur te contactera sur ${order.client_phone}.
🔑 *Code de confirmation* : ${order.confirmation_code}`,

        `✅ *Commande validée ${nom || ''} !*

ID: ${order.id}
📍 Quartier: ${order.client_quartier}
📌 Indications: ${order.client_indications || 'Aucune'}
💰 Total: ${order.total} FCFA
🛵 Livraison prévue à ${Utils.estimateDeliveryTime()}.`
    ],

    // ===========================================
    // SÉLECTION MÉDICAMENT - Style PayParrot
    // ===========================================
    MEDICINE_SELECTION: (results, query) => {
        const meds = results.slice(0, 3).map((med, i) => 
            `• *${i+1}.* ${med.nom_commercial} - ${med.prix} FCFA\n   💊 ${med.dosage || ''} ${med.forme || ''}`
        ).join('\n\n');

        return `# RÉSULTATS POUR "${query}" 🔍

---

${meds}

---

👉 Réponds avec le *numéro* ou le nom exact

*Exemple:* "1" ou "${results[0].nom_commercial}"`
    },

    // ===========================================
    // AIDE - 10 variations
    // ===========================================
    HELP: [
        `👋 *AIDE - Mode d'emploi*
💊 "doliprane" = chercher un médicament
🛒 "mon panier" = voir ta sélection
📍 "cité" = donner ton quartier
📸 Envoie une photo = scan automatique
❓ "annuler" = tout annuler
🙏 "merci" = remercier
🚨 "urgence" = appeler le SAMU`,

        `📱 *COMMENT COMMANDER ?*
1. Tape le médicament (ex: "2 doliprane")
2. Donne ton quartier (ex: "cité")
3. Renseigne ton âge, poids, taille
4. Confirme la commande
📸 Ou envoie une photo de l'ordonnance !`,

        `💡 *EXEMPLES DE MESSAGES*
• "2 doliprane 500"
• "je veux 3 amoxicilline"
• "ajoute 1 spasfon"
• "mon panier"
• "je suis à balmer"
• "je m'appelle jean"
• "j'ai 30 ans"`,

        `🤔 *BESOIN D'AIDE ?*
Voici ce que je comprends :
🔍 Recherche : "doliprane", "paracétamol"
🛒 Panier : "panier", "voir mon panier"
📍 Adresse : "cité", "balmer", "saguitta"
👤 Infos : "je m'appelle...", "j'ai 25 ans"
✅ Validation : "confirme", "c'est bon"
❌ Annulation : "annule", "pas maintenant"`,

        `📋 *FONCTIONNALITÉS*
✅ Commande par message
✅ Scan de photos (boîtes/ordonnances)
✅ Livraison à San Pedro
✅ Paiement à la livraison
✅ Code de confirmation
✅ Suivi en temps réel`,

        `🎯 *ASTUCES*
• Sois précis : "2 doliprane 1000mg"
• Pour plusieurs : "doliprane et amoxicilline"
• Pour modifier : "enlève le doliprane"
• Ton poids/taille aide pour les dosages
• Le code est demandé à la livraison`,

        `📞 *CONTACT SUPPORT*
Problème avec ta commande ?
Contacte le support au ${SUPPORT_PHONE}
Ou réponds "PROBLÈME" pour être assisté`,

        `⚡ *RACCOURCIS*
"panier" → voir ma commande
"vide" → vider le panier
"quartier" → changer de quartier
"infos" → voir mes informations
"code" → mon code de confirmation
"aide" → ce message`,

        `🌟 *BIENVENUE SUR MARIAM*
Je suis ton assistante santé 24/7 !
📦 Je livre à San Pedro uniquement
⏱️ 45 min le jour / 1h la nuit
💰 Paiement espèces ou Mobile Money
📸 Envoie une photo pour commander plus vite`,

        `📝 *ÉTAPES D'UNE COMMANDE*
1️⃣ Je cherche le médicament
2️⃣ Tu confirmes la quantité
3️⃣ Tu donnes le quartier
4️⃣ Tu renseignes tes infos (âge, poids...)
5️⃣ Tu confirmes la commande
6️⃣ Je livre avec un code secret
7️⃣ Tu paies à la livraison`
    ],

    // ===========================================
    // URGENCE - 5 variations
    // ===========================================
    EMERGENCY: [
        `🚨 *URGENCE MÉDICALE*
📞 Appelez immédiatement le **185** (SAMU)
⏱️ Ne perdez pas de temps, chaque seconde compte !`,

        `🚑 *SITUATION D'URGENCE*
Composez le **185** (SAMU) tout de suite !
Je ne peux pas gérer les urgences ici.`,

        `🆘 *ALERTE*
Veuillez contacter les urgences au **185**
C'est le numéro du SAMU en Côte d'Ivoire.`,

        `⚕️ *URGENCE - 185*
Appelez immédiatement le SAMU !
Je suis là pour les commandes, pas pour les urgences vitales.`,

        `🚨 *ATTENTION !*
Si c'est une urgence médicale, composez le **185**
Faites vite, c'est important !`
    ],

    // ===========================================
    // CRÉATEUR - 8 variations
    // ===========================================
    CREATOR: [
        `👨‍💻 Créé par **Youssef**, étudiant en Licence 2 à l'UPSP (Agriculture). Développé dans sa chambre universitaire à San Pedro ! 🚀`,

        `👨‍💻 Mon papa c'est **Youssef**, un étudiant passionné à San Pedro. Il m'a codé depuis sa chambre d'étudiant ! 🏠💻`,

        `👨‍💻 **Youssef**, étudiant en agro à l'UPSP, m'a créée. Entre les cours sur les poissons, il trouve le temps de coder ! 🐟👨‍💻`,

        `👨‍💻 Je suis le bébé de **Youssef** (Licence 2 Agro, UPSP). Tout fait main dans sa chambre universitaire ! 🔥`,

        `👨‍💻 Mon créateur s'appelle **Youssef**. Il est en Licence 2 Agriculture à l'UPSP et il a voulu faciliter l'accès aux médicaments à San Pedro.`,

        `👨‍💻 **Youssef**, étudiant à San Pedro, m'a développée pour aider sa communauté. Bravo à lui ! 👏`,

        `👨‍💻 Derrière ce bot, il y a **Youssef**, un jeune ivoirien passionné de tech et d'agriculture. UPSP - Licence 2.`,

        `👨‍💻 Made with ❤️ par **Youssef** (UPSP, Licence 2). Du pur made in Côte d'Ivoire ! 🇨🇮`
    ],

    // ===========================================
    // REMINDERS - Rappels variés
    // ===========================================
    REMINDERS: {
        GENERAL: [
            (nom) => `👋 ${nom || 'Toi'}, toujours là ?`,
            (nom) => `⏰ ${nom || ''}, on termine ta commande ?`,
            (nom) => `👀 Tu es encore là ${nom || ''} ?`,
            (nom) => `🤔 ${nom || ''}, tu as abandonné ?`,
            (nom) => `⏳ ${nom || ''}, ta commande t'attend !`
        ],
        QUARTIER: [
            (nom) => `📍 ${nom || ''}, il manque ton quartier.`,
            (nom) => `📍 Où te livrer ${nom || ''} ?`,
            (nom) => `📍 Dis-moi ton quartier ${nom || ''} !`,
            (nom) => `📍 ${nom || ''}, sans quartier pas de livraison.`,
            (nom) => `📍 Dernière chance pour ton quartier ?`
        ],
        CONFIRM: [
            (nom) => `✅ ${nom || ''}, ta commande est prête. On confirme ?`,
            (nom) => `👉 ${nom || ''}, tout est bon. On valide ?`,
            (nom) => `✅ Prêt à confirmer ${nom || ''} ?`,
            (nom) => `📦 ${nom || ''}, un clic et c'est parti !`,
            (nom) => `✅ Dernière étape : confirmation !`
        ],
        FINAL_WARNING: [
            (nom) => `⚠️ ${nom || ''}, ta commande va être annulée dans 10 min.`,
            (nom) => `⏳ ${nom || ''}, dernière chance pour finaliser.`,
            (nom) => `🚨 ${nom || ''}, annulation dans 10 min si pas de réponse.`,
            (nom) => `⚠️ Plus que 10 minutes ${nom || ''} !`,
            (nom) => `⏰ Dernier rappel avant annulation ${nom || ''}.`
        ]
    },

    // ===========================================
    // VARIATIONS POUR LES RÉPONSES SIMPLES
    // ===========================================
    SIMPLE_RESPONSES: {
        YES: [
            "Oui ✅", "D'accord 👍", "OK 👌", "Parfait !", "Super !", 
            "C'est noté !", "Entendu !", "Très bien !", "Ça marche !", "Cool !"
        ],
        NO: [
            "Non ❌", "Pas maintenant", "Annulé", "Non merci", "Pas cette fois",
            "Pas pour l'instant", "Non, merci", "Une autre fois"
        ],
        THANKS: [
            "🙏 Merci !", "😊 Avec plaisir !", "👍 Service !", "🙌 À ton service !",
            "Merci à toi !", "💙 Content d'avoir aidé !", "🌟 Merci pour ta confiance !"
        ],
        GOODBYE: [
            "👋 À bientôt !", "👋 Au revoir !", "👋 Bye !", "👋 À plus tard !",
            "👋 Reviens vite !", "👋 Prends soin de toi !"
        ]
    }
};

// ===========================================
// UTILS
// ===========================================
class Utils {
    static randomMessage(messages, ...args) {
        if (typeof messages === 'function') {
            const result = messages(...args);
            if (Array.isArray(result)) {
                return result[Math.floor(Math.random() * result.length)];
            }
            return result;
        }
        
        if (Array.isArray(messages)) {
            return messages[Math.floor(Math.random() * messages.length)];
        }
        
        if (typeof messages === 'object' && messages !== null) {
            if (Array.isArray(messages)) {
                return messages[Math.floor(Math.random() * messages.length)];
            }
            return messages;
        }
        
        return messages;
    }

    static extractNumber(text) {
        const match = text?.match(/\d+/);
        return match ? parseInt(match[0]) : null;
    }

    static formatPhone(phone) {
        if (!phone) return '';
        return phone.toString().replace(/\D/g, '');
    }

    static cleanPhone(phone) {
        const clean = this.formatPhone(phone);
        return clean.length === 12 && clean.startsWith('225') ? clean.substring(3) : clean;
    }

    static validatePhone(phone) {
        if (!phone) return { valid: false, error: "Le numéro est requis." };
        const clean = this.formatPhone(phone);
        const isValid = (clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean)) ||
                       (clean.length === 12 && clean.startsWith('225') && /^(07|01|05)\d{8}$/.test(clean.substring(3)));
        
        if (!isValid) {
            return { valid: false, error: "Numéro invalide. Format : 07XXXXXXXX, 01XXXXXXXX ou 05XXXXXXXX." };
        }
        return { valid: true, phone: clean.length === 12 ? clean.substring(3) : clean };
    }

    static validateName(name) {
        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return { valid: false, error: "Le nom doit faire au moins 2 caractères." };
        }
        const invalidChars = /[0-9!@#$%^&*()_+=\[\]{};':"\\|,.<>\/?`~]/;
        if (invalidChars.test(name)) {
            return { valid: false, error: "Le nom contient des caractères interdits." };
        }
        return { valid: true, name: name.trim() };
    }

    static validateAge(age) {
        if (!age || isNaN(age)) return { valid: false, error: "L'âge doit être un nombre." };
        const ageNum = parseInt(age);
        if (ageNum < 1 || ageNum > 120) return { valid: false, error: "L'âge doit être entre 1 et 120 ans." };
        return { valid: true, age: ageNum };
    }

    static validateGender(gender) {
        if (!gender) return { valid: false, error: "Le genre est requis (M/F)." };
        const normalized = gender.trim().toUpperCase();
        if (['M', 'F', 'HOMME', 'FEMME', 'MALE', 'FEMALE'].includes(normalized)) {
            return { valid: true, gender: normalized.startsWith('M') || normalized.includes('HOMME') ? 'M' : 'F' };
        }
        return { valid: false, error: "Le genre doit être M (masculin) ou F (féminin)." };
    }

    static validateWeight(weight) {
        if (!weight || isNaN(weight)) return { valid: false, error: "Le poids doit être un nombre (en kg)." };
        const weightNum = parseFloat(weight);
        if (weightNum < 20 || weightNum > 200) return { valid: false, error: "Le poids doit être entre 20 et 200 kg." };
        return { valid: true, weight: weightNum };
    }

    static validateHeight(height) {
        if (!height || isNaN(height)) return { valid: false, error: "La taille doit être un nombre (en cm)." };
        const heightNum = parseInt(height);
        if (heightNum < 100 || heightNum > 250) return { valid: false, error: "La taille doit être entre 100 et 250 cm." };
        return { valid: true, height: heightNum };
    }

    static validateQuartier(quartier) {
        if (!quartier || typeof quartier !== 'string' || quartier.trim().length < 2) {
            return { valid: false, error: "Le quartier doit faire au moins 2 caractères." };
        }
        return { valid: true, quartier: quartier.trim() };
    }

    static validateVille(ville) {
        if (!ville) return { valid: false, error: "La ville est requise." };
        const normalized = ville.trim().toLowerCase();
        if (normalized !== 'san pedro' && normalized !== 'oui') {
            return { valid: false, error: "Désolé, on ne livre qu'à San Pedro pour l'instant." };
        }
        return { valid: true, ville: 'San Pedro' };
    }

    static generateOrderId() {
        const date = new Date();
        return `CMD${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    }

    static generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    static getDeliveryPrice(hour = new Date().getHours()) {
        const isNight = hour >= DELIVERY_CONFIG.NIGHT_HOURS.start && hour < DELIVERY_CONFIG.NIGHT_HOURS.end;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'NIGHT' : 'DAY',
            message: isNight ? '🌙 Nuit' : '☀️ Jour'
        };
    }

    static estimateDeliveryTime(hour = new Date().getHours()) {
        const date = new Date();
        date.setMinutes(date.getMinutes() + DELIVERY_CONFIG.DELIVERY_TIME);
        return `${date.getHours()}h${date.getMinutes().toString().padStart(2,'0')}`;
    }

    static formatSummary(conv) {
        return Utils.randomMessage(MESSAGES.ORDER_SUMMARY, conv, {
            nom: conv.context?.client_nom
        });
    }

    static isReturningCustomer(conv) {
        return conv.history && conv.history.length > 3;
    }

    static getContext(phone, conv) {
        return {
            nom: conv.context?.client_nom,
            heure: new Date().getHours(),
            isReturning: this.isReturningCustomer(conv),
            cart: conv.cart
        };
    }
}

// ===========================================
// SERVICE RECHERCHE (FUSE.JS)
// ===========================================
class SearchService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600 });
    }

    async initialize() {
        console.log("🟡 Début initialize()...");
        try {
            const result = await pool.query(`
                SELECT
                    code_produit,
                    nom_commercial,
                    dci,
                    dosage,
                    forme,
                    prix::float,
                    laboratoire
                FROM medicaments
                WHERE disponible = true
            `);

            this.medicaments = result.rows.map(med => ({
                ...med,
                searchable: `${med.nom_commercial} ${med.dci || ''} ${med.laboratoire || ''}`.toLowerCase(),
                simple: this.normalize(med.nom_commercial)
            }));

            this.fuse = new Fuse(this.medicaments, {
                keys: [
                    { name: 'nom_commercial', weight: 0.7 },
                    { name: 'dci', weight: 0.3 },
                    { name: 'searchable', weight: 0.2 }
                ],
                threshold: 0.3,
                distance: 50,
                minMatchCharLength: 2,
                ignoreLocation: true,
                shouldSort: true
            });

            log('SUCCESS', `✅ FUSE chargé: ${this.medicaments.length} médicaments`);
        } catch (error) {
            log('ERROR', '❌ Erreur initialisation FUSE:', error);
        }
    }

    normalize(text) {
        if (!text) return '';
        return text.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];
        const cacheKey = `search:${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const results = this.fuse.search(query).slice(0, limit).map(r => r.item);
        this.cache.set(cacheKey, results);
        return results;
    }

    async getByCode(code) {
        const result = await pool.query('SELECT * FROM medicaments WHERE code_produit = $1', [code]);
        return result.rows[0];
    }
}

// ===========================================
// SERVICE VISION (GROQ)
// ===========================================
class VisionService {
    constructor() {
        this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
        this.model = VISION_MODEL;
        this.cache = new NodeCache({ stdTTL: 3600 });
    }

    async analyzeImage(imageBuffer) {
        if (!this.client) return { success: false, message: "Vision non configurée" };

        try {
            const base64Image = imageBuffer.toString('base64');
            
            if (base64Image.length > 4 * 1024 * 1024) {
                return {
                    success: false,
                    error: "Image trop volumineuse (max 4MB)",
                    suggestion: "Envoie une image plus légère"
                };
            }

            const prompt = `Tu es MARIAM-VISION, un assistant spécialisé dans la reconnaissance de médicaments.
**Instructions**:
1. Si l'image montre une boîte de médicament :
   - Extrais le nom commercial
   - Extrais le dosage
   - Extrais la forme
2. Si l'image montre une ordonnance :
   - Liste tous les médicaments prescrits
3. Format de réponse (JSON) :
{
  "medicines": [
    {
      "name": "NOM",
      "dosage": "DOSAGE",
      "form": "FORME",
      "confidence": 0.0-1.0
    }
  ],
  "type": "box|prescription",
  "count": NOMBRE
}`;

            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                        ]
                    }
                ],
                temperature: 0.1,
                max_tokens: 1024,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            
            if (result.medicines) {
                result.medicines = result.medicines.filter(m => m.confidence >= 0.6);
            }
            
            return result;
        } catch (error) {
            log('ERROR', '❌ Erreur vision:', error);
            return { success: false, message: "Erreur analyse image" };
        }
    }

    async searchDetectedMedicines(medicines) {
        if (!medicines || medicines.length === 0) return [];

        const results = [];
        for (const med of medicines) {
            if (med.confidence < 0.4) continue;

            const res = await pool.query(
                `SELECT code_produit, nom_commercial, dci, dosage, forme, prix, laboratoire
                 FROM medicaments
                 WHERE disponible = true
                 AND (nom_commercial ILIKE $1 OR dci ILIKE $1)
                 ORDER BY 
                     CASE 
                         WHEN nom_commercial ILIKE $1 THEN 1
                         WHEN dci ILIKE $1 THEN 2
                         ELSE 3
                     END
                 LIMIT 3`,
                [`%${med.name}%`]
            );
            
            if (res.rows.length > 0) {
                results.push({
                    detected: med,
                    matches: res.rows
                });
            }
        }
        return results;
    }
}

// ===========================================
// SERVICE WHATSAPP
// ===========================================
class WhatsAppService {
    async sendMessage(to, text) {
        if (!text || !to) return false;
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: Utils.formatPhone(to),
                type: 'text',
                text: { body: text.substring(0, 4096) }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 5000
            });
            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur envoi WhatsApp:', error.message);
            return false;
        }
    }

    async sendInteractiveButtons(to, text, buttons) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: Utils.formatPhone(to),
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: text.substring(0, 1024) },
                    action: {
                        buttons: buttons.slice(0, 3).map((btn, index) => ({
                            type: 'reply',
                            reply: { id: `btn_${Date.now()}_${index}`, title: btn.substring(0, 20) }
                        }))
                    }
                }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 5000
            });
            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur boutons:', error);
            return false;
        }
    }

    async sendTyping(to) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: Utils.formatPhone(to),
                type: 'typing',
                typing: { action: 'typing' }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 2000
            });
        } catch (error) {}
    }

    async downloadMedia(mediaId) {
        try {
            const media = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });

            const file = await axios.get(media.data.url, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                responseType: 'arraybuffer'
            });

            return {
                success: true,
                buffer: Buffer.from(file.data),
                mimeType: media.data.mime_type,
                size: file.data.length
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async markAsRead(messageId) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }, { timeout: 2000 });
        } catch (error) {}
    }

    async getUserProfile(phone) {
        try {
            const response = await axios.get(
                `https://graph.facebook.com/v18.0/${phone}`,
                {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                    params: { fields: 'name' }
                }
            );
            return {
                success: true,
                profile: response.data
            };
        } catch (error) {
            return { success: false, error: "Impossible de récupérer le profil" };
        }
    }

    async notifySupport(order) {
        const items = order.items.map(item => `• ${item.quantite}x ${item.nom_commercial} (${item.prix * item.quantite} FCFA)`).join('\n');
        const message = `
📦 *NOUVELLE COMMANDE* (N°${order.id})
🕒 ${new Date().toLocaleString('fr-FR')}
👤 *Client* : ${order.client_name}
📞 ${order.client_phone}
📍 *Livraison* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* :
${items}
💰 *Total* : ${order.total} FCFA
🔑 *Code* : ${order.confirmation_code}

🛵 *Statut* : En attente de livreur
`;

        try {
            const sent = await this.sendMessage(SUPPORT_PHONE, message);
            if (sent) log('NOTIF_SUPPORT', `📩 Notification envoyée au support`, { orderId: order.id });
            return sent;
        } catch (error) {
            log('ERROR', '❌ Erreur notification support:', error.message);
            return false;
        }
    }

    async notifySupportProblem(order, problem) {
        const message = `
⚠️ *PROBLÈME LIVRAISON* (N°${order.id})
👤 Client : ${order.client_name} (${order.client_phone})
📍 Quartier : ${order.client_quartier}
💰 Montant : ${order.total} FCFA
📌 *Problème* : ${problem}
👉 *Action requise* : Contacter le client au ${order.client_phone}
`;

        try {
            const sent = await this.sendMessage(SUPPORT_PHONE, message);
            if (sent) log('NOTIF_SUPPORT', `⚠️ Problème signalé au support`, { orderId: order.id });
            return sent;
        } catch (error) {
            log('ERROR', '❌ Erreur notification problème:', error.message);
            return false;
        }
    }
}

// ===========================================
// SERVICE COMMANDES
// ===========================================
class OrderService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async createOrder(data, phone) {
        const client = await pool.connect();
        try {
            const orderId = Utils.generateOrderId();
            const code = Utils.generateCode();

            const subtotal = data.items.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
            const delivery = Utils.getDeliveryPrice();
            const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;

            const order = {
                id: orderId,
                client_name: data.client.nom,
                client_phone: data.client.telephone || phone,
                client_quartier: data.client.quartier,
                client_ville: 'San Pedro',
                client_indications: data.client.indications || '',
                patient_age: data.client.patient_age,
                patient_genre: data.client.patient_genre,
                patient_poids: data.client.patient_poids,
                patient_taille: data.client.patient_taille,
                items: data.items,
                subtotal,
                delivery_price: delivery.price,
                service_fee: DELIVERY_CONFIG.SERVICE_FEE,
                total,
                confirmation_code: code,
                delivery_period: delivery.period,
                status: 'PENDING',
                created_at: new Date()
            };

            await client.query('BEGIN');

            await client.query(`
                INSERT INTO orders (
                    id, client_name, client_phone, client_quartier, client_ville,
                    client_indications, patient_age, patient_genre,
                    patient_poids, patient_taille, items, subtotal, delivery_price,
                    service_fee, total, confirmation_code, delivery_period, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `, [
                order.id, order.client_name, order.client_phone, order.client_quartier,
                order.client_ville, order.client_indications,
                order.patient_age, order.patient_genre, order.patient_poids, order.patient_taille,
                JSON.stringify(order.items), order.subtotal, order.delivery_price,
                order.service_fee, order.total, order.confirmation_code, order.delivery_period,
                order.status
            ]);

            await client.query('COMMIT');
            log('SUCCESS', `✅ Commande ${order.id} créée`);
            return order;
        } catch (error) {
            await client.query('ROLLBACK');
            log('ERROR', '❌ Erreur création commande:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    async getOrder(id) {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (result.rows.length === 0) return null;

        const order = result.rows[0];
        order.items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
        return order;
    }

    async updateStatus(id, status, livreurPhone = null) {
        const updates = [];
        const values = [];
        let i = 1;

        if (status) {
            updates.push(`status = $${i++}`);
            values.push(status);
        }
        if (livreurPhone) {
            updates.push(`livreur_phone = $${i++}`);
            values.push(livreurPhone);
        }
        updates.push(`updated_at = NOW()`);

        const result = await pool.query(
            `UPDATE orders SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
            [...values, id]
        );

        if (result.rows.length > 0) {
            const updatedOrder = result.rows[0];
            updatedOrder.items = typeof updatedOrder.items === 'string' ?
                JSON.parse(updatedOrder.items) : updatedOrder.items;
            return updatedOrder;
        }
        return null;
    }

    async assignLivreur(orderId) {
        const client = await pool.connect();
        try {
            const livreurResult = await client.query(`
                SELECT * FROM livreurs
                WHERE disponible = true
                ORDER BY commandes_livrees ASC
                LIMIT 1
            `);

            if (livreurResult.rows.length === 0) {
                throw new Error("Aucun livreur disponible");
            }

            const livreur = livreurResult.rows[0];
            const order = await this.updateStatus(orderId, 'ASSIGNED', livreur.telephone);

            const message = this.formatOrderForLivreur(order, livreur);
            await this.whatsapp.sendInteractiveButtons(
                livreur.whatsapp || livreur.telephone,
                message,
                [BUTTONS.DELIVERY_CONFIRM, BUTTONS.DELIVERY_ISSUE]
            );

            await this.whatsapp.sendMessage(SUPPORT_PHONE, this.formatOrderForSupport(order));

            return { success: true, order, livreur };
        } catch (error) {
            log('ERROR', '❌ Erreur assignation livreur:', error);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }

    formatOrderForLivreur(order, livreur) {
        const items = order.items.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n');
        return `
🛵 *NOUVELLE COMMANDE #${order.id}*
👤 *Client* : ${order.client_name}
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📞 *Contact* : ${order.client_phone}

📦 *Articles* :
${items}

💰 *Total à encaisser* : ${order.total} FCFA
🔑 *Code de confirmation* : ${order.confirmation_code}

✅ *Pour confirmer la récupération* : Appuie sur le bouton ci-dessous
        `;
    }

    formatOrderForSupport(order) {
        const items = order.items.map(item => `• ${item.quantite}x ${item.nom_commercial} (${item.prix * item.quantite} FCFA)`).join('\n');
        return `
📦 *NOUVELLE COMMANDE #${order.id}*
👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, ${order.client_ville}
📌 *Indications* : ${order.client_indications || 'Aucune'}
📦 *Articles* :
${items}
💰 *Total* : ${order.total} FCFA
🔑 *Code* : ${order.confirmation_code}

🛵 *Livreur assigné* : À confirmer
        `;
    }

    async findAvailableLivreur() {
        const result = await pool.query(`
            SELECT * FROM livreurs
            WHERE disponible = true
            ORDER BY commandes_livrees ASC
            LIMIT 1
        `);
        return result.rows[0] || null;
    }

    async getLivreurByPhone(phone) {
        const result = await pool.query(
            'SELECT * FROM livreurs WHERE telephone = $1 OR whatsapp = $1 LIMIT 1',
            [phone]
        );
        return result.rows[0] || null;
    }
}

// ===========================================
// SERVICE CONVERSATION
// ===========================================
class ConversationManager {
    constructor() {
        this.reminderCounts = new NodeCache({ stdTTL: 86400 });
        this.validationAttempts = new NodeCache({ stdTTL: 3600 });
    }

    async get(phone) {
        const cacheKey = `conv:${phone}`;
        let conv = cache.get(cacheKey);
        if (conv) return conv;

        const result = await pool.query('SELECT * FROM conversations WHERE phone = $1', [phone]);
        if (result.rows.length === 0) {
            const newConv = await pool.query(`
                INSERT INTO conversations (phone, state, cart, context, history, updated_at)
                VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *
            `, [phone, ConversationStates.IDLE, '[]', '{}', '[]']);
            conv = this.parse(newConv.rows[0]);
        } else {
            conv = this.parse(result.rows[0]);
        }

        cache.set(cacheKey, conv, 300);
        return conv;
    }

    parse(row) {
        return {
            ...row,
            cart: typeof row.cart === 'string' ? JSON.parse(row.cart) : row.cart,
            context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
            history: typeof row.history === 'string' ? JSON.parse(row.history) : row.history
        };
    }

    async update(phone, updates) {
        const sets = [];
        const values = [];
        let i = 1;

        if (updates.state) { sets.push(`state = $${i++}`); values.push(updates.state); }
        if (updates.cart !== undefined) { sets.push(`cart = $${i++}`); values.push(JSON.stringify(updates.cart)); }
        if (updates.context) { sets.push(`context = $${i++}`); values.push(JSON.stringify(updates.context)); }
        if (updates.history) { sets.push(`history = $${i++}`); values.push(JSON.stringify(updates.history)); }

        sets.push(`updated_at = NOW()`);

        await pool.query(`UPDATE conversations SET ${sets.join(', ')} WHERE phone = $${i}`, [...values, phone]);
        cache.del(`conv:${phone}`);
    }

    async clear(phone) {
        await this.update(phone, {
            state: ConversationStates.IDLE,
            cart: [],
            context: {},
            history: []
        });
    }

    async trackValidationAttempt(phone, field) {
        const key = `val:${phone}:${field}`;
        const attempts = this.validationAttempts.get(key) || 0;
        this.validationAttempts.set(key, attempts + 1);
        return attempts + 1;
    }

    async resetValidationAttempts(phone, field) {
        this.validationAttempts.del(`val:${phone}:${field}`);
    }

    async scheduleReminder(phone, conv, delay = 5 * 60 * 1000) {
        const key = `reminder:${phone}`;
        if (pendingConversations.has(key)) return;

        setTimeout(async () => {
            const updatedConv = await this.get(phone);
            if (this.shouldRemind(updatedConv)) {
                await this.sendReminder(phone, updatedConv);
                pendingConversations.set(key, true, 300);
            }
        }, delay);
    }

    shouldRemind(conv) {
        const hasPendingCart = conv.cart && conv.cart.length > 0;
        const isWaitingForInput = [
            ConversationStates.WAITING_QUARTIER,
            ConversationStates.WAITING_VILLE,
            ConversationStates.WAITING_NAME,
            ConversationStates.WAITING_AGE,
            ConversationStates.WAITING_GENDER,
            ConversationStates.WAITING_WEIGHT,
            ConversationStates.WAITING_HEIGHT,
            ConversationStates.WAITING_PHONE,
            ConversationStates.WAITING_INDICATIONS,
            ConversationStates.WAITING_CONFIRMATION
        ].includes(conv.state);

        return hasPendingCart && isWaitingForInput;
    }

    async sendReminder(phone, conv) {
        const whatsapp = new WhatsAppService();
        const context = {
            nom: conv.context?.client_nom,
            cart: conv.cart,
            state: conv.state
        };

        let message;
        switch(conv.state) {
            case ConversationStates.WAITING_CONFIRMATION:
                message = `⏰ *Rappel* : Ta commande est prête à être confirmée !
${Utils.formatSummary(conv)}
👉 Utilise les boutons pour confirmer ou modifier.`;
                await whatsapp.sendInteractiveButtons(
                    phone,
                    message,
                    [BUTTONS.CONFIRM, BUTTONS.MODIFY, BUTTONS.CANCEL]
                );
                break;
            default:
                const stateKey = conv.state.replace('WAITING_', '').toLowerCase();
                const prompts = MESSAGES.RETRY_PROMPTS[stateKey] || MESSAGES.REMINDERS.GENERAL;
                message = typeof prompts === 'function' ? prompts(context) : 
                         (Array.isArray(prompts) ? Utils.randomMessage(prompts) : prompts);
                await whatsapp.sendMessage(phone, message);
        }

        if (conv.state === ConversationStates.WAITING_CONFIRMATION) {
            setTimeout(async () => {
                const finalConv = await this.get(phone);
                if (finalConv.state === ConversationStates.WAITING_CONFIRMATION) {
                    await whatsapp.sendMessage(
                        phone,
                        Utils.randomMessage(MESSAGES.REMINDERS.FINAL_WARNING, { nom: finalConv.context?.client_nom })
                    );
                    
                    setTimeout(async () => {
                        const cancelConv = await this.get(phone);
                        if (cancelConv.state === ConversationStates.WAITING_CONFIRMATION) {
                            await whatsapp.sendMessage(
                                phone,
                                `❌ *Commande annulée* : Pas de confirmation reçue.\nTu peux recommencer quand tu veux !`
                            );
                            await this.clear(phone);
                        }
                    }, 10 * 60 * 1000);
                }
            }, 20 * 60 * 1000);
        }
    }
}

// ===========================================
// GESTIONNAIRE BOUTONS
// ===========================================
class ButtonHandler {
    constructor(whatsapp, orders, convManager) {
        this.whatsapp = whatsapp;
        this.orders = orders;
        this.convManager = convManager;
    }

    async handle(phone, buttonText, conv) {
        if (!ALLOWED_BUTTONS.has(buttonText)) {
            log('WARN', `🚫 Bouton non autorisé: ${buttonText}`);
            return false;
        }

        log('BUTTON', `🔘 ${buttonText}`);

        switch(buttonText) {
            case BUTTONS.CONFIRM:
                await this.handleConfirm(phone, conv);
                break;
            case BUTTONS.MODIFY:
                await this.handleModify(phone, conv);
                break;
            case BUTTONS.CANCEL:
                await this.handleCancel(phone, conv);
                break;
            case BUTTONS.DELIVERY_CONFIRM:
                await this.handleDeliveryConfirm(phone, conv);
                break;
            case BUTTONS.DELIVERY_ISSUE:
                await this.handleDeliveryIssue(phone, conv);
                break;
        }

        return true;
    }

    async handleConfirm(phone, conv) {
        if (conv.context.client_ville !== 'San Pedro') {
            await this.whatsapp.sendMessage(phone,
                "📍 On livre uniquement à *San Pedro*. C'est bien ta ville ? (oui/non)"
            );
            conv.state = 'WAITING_VILLE';
            await this.convManager.update(phone, { state: 'WAITING_VILLE' });
            return;
        }

        try {
            const order = await this.orders.createOrder({
                client: {
                    nom: conv.context.client_nom,
                    telephone: conv.context.client_telephone || phone,
                    quartier: conv.context.client_quartier,
                    ville: 'San Pedro',
                    indications: conv.context.client_indications || '',
                    patient_age: conv.context.patient_age,
                    patient_genre: conv.context.patient_genre,
                    patient_poids: conv.context.patient_poids,
                    patient_taille: conv.context.patient_taille
                },
                items: conv.cart
            }, phone);

            await this.whatsapp.sendMessage(phone,
                this.formatOrderConfirmation(order, conv.context.client_nom)
            );

            await this.whatsapp.notifySupport(order);

            const assignResult = await this.orders.assignLivreur(order.id);
            if (!assignResult.success) {
                await this.whatsapp.sendMessage(SUPPORT_PHONE,
                    `⚠️ *AUCUN LIVREUR DISPONIBLE* pour la commande #${order.id}\n` +
                    `📞 Client: ${order.client_name} (${order.client_phone})\n` +
                    `📍 ${order.client_quartier}`
                );
            }

            conv.state = 'ORDER_CONFIRMED';
            conv.context.order_id = order.id;
            conv.context.confirmation_code = order.confirmation_code;
            await this.convManager.update(phone, {
                state: 'ORDER_CONFIRMED',
                cart: [],
                context: conv.context
            });

        } catch (error) {
            log('ERROR', '❌ Erreur confirmation:', error);
            await this.whatsapp.sendMessage(phone, "❌ Erreur. Réessaie ou contacte le support.");
        }
    }

    formatOrderConfirmation(order, nom) {
        return `
🎉 *Commande confirmée ${nom || ''} !*

📦 *N°* : ${order.id}
📍 *Quartier* : ${order.client_quartier}
📌 *Indications* : ${order.client_indications || 'Aucune'}
💰 *Total* : ${order.total} FCFA
🔑 *Code de confirmation* : ${order.confirmation_code}

🛵 *Livraison prévue* : ${Utils.estimateDeliveryTime()}
📱 *Le livreur t'appellera sur* : ${order.client_phone}

💡 *Garde ce message, le livreur te demandera le code de confirmation.*
        `;
    }

    async handleModify(phone, conv) {
        await this.whatsapp.sendMessage(phone,
            `✏️ *Modification*\n\nQue souhaitez-vous modifier ?\n` +
            `• Médicaments (dis "enlève doliprane")\n` +
            `• Quantités (dis "2 doliprane")\n` +
            `• Quartier (dis "cité")\n` +
            `• Infos patient (dis "je m'appelle...")`
        );
        conv.state = 'IDLE';
        await this.convManager.update(phone, { state: 'IDLE' });
    }

    async handleCancel(phone, conv) {
        await this.whatsapp.sendMessage(phone,
            `❌ *Commande annulée*\n\nPas de souci ! Tu peux recommencer quand tu veux.`
        );
        await this.convManager.clear(phone);
    }

    async handleDeliveryConfirm(phone, conv) {
        if (!conv.context.order_id) {
            await this.whatsapp.sendMessage(phone,
                "❌ Aucune commande en cours pour confirmation."
            );
            return;
        }

        try {
            const livreur = await this.orders.getLivreurByPhone(phone);
            if (!livreur) {
                await this.whatsapp.sendMessage(phone, "❌ Tu n'es pas enregistré comme livreur.");
                return;
            }

            const order = await this.orders.updateStatus(
                conv.context.order_id,
                'IN_DELIVERY'
            );

            if (!order) {
                await this.whatsapp.sendMessage(phone, "❌ Commande introuvable.");
                return;
            }

            await this.whatsapp.sendMessage(order.client_phone,
                `🚀 *Bonne nouvelle !* 🎉\n\n` +
                `Ton livreur *${livreur.nom}* a récupéré ta commande #${order.id} !\n` +
                `📍 Destination : ${order.client_quartier}\n` +
                `🕒 Arrivée estimée : dans environ ${DELIVERY_CONFIG.DELIVERY_TIME} minutes\n\n` +
                `📞 *Prépare ton code de confirmation* : ${order.confirmation_code}\n` +
                `💰 *Paiement* : ${order.total} FCFA (espèces ou Mobile Money)`
            );

            await this.whatsapp.sendMessage(SUPPORT_PHONE,
                `🚀 *LIVRAISON EN COURS #${order.id}*\n` +
                `👨‍🚀 Livreur : ${livreur.nom} (${phone})\n` +
                `📍 ${order.client_quartier}\n` +
                `💰 ${order.total} FCFA\n` +
                `🕒 Arrivée estimée : dans ${DELIVERY_CONFIG.DELIVERY_TIME} min`
            );

            conv.state = 'DELIVERY_IN_PROGRESS';
            await this.convManager.update(phone, { state: 'DELIVERY_IN_PROGRESS' });

        } catch (error) {
            log('ERROR', '❌ Erreur confirmation livraison:', error);
            await this.whatsapp.sendMessage(phone, "❌ Erreur. Contacte le support.");
        }
    }

    async handleDeliveryIssue(phone, conv) {
        if (!conv.context.order_id) {
            await this.whatsapp.sendMessage(phone,
                "❌ Aucune commande en cours pour signaler un problème."
            );
            return;
        }

        try {
            const order = await this.orders.getOrder(conv.context.order_id);
            
            await this.whatsapp.notifySupportProblem(order, "Problème signalé par le livreur");

            await this.whatsapp.sendMessage(phone,
                `⚠️ *Problème signalé*\n` +
                `Le support a été notifié et va te contacter rapidement.`
            );

        } catch (error) {
            log('ERROR', '❌ Erreur signalement problème:', error);
            await this.whatsapp.sendMessage(phone, "❌ Erreur. Contacte directement le support.");
        }
    }

    async handleLivreurResponse(phone, text, orderId) {
        if (!text || !orderId) return false;

        const acceptPattern = new RegExp(`^PRENDRE\\s+${orderId}$`, 'i');
        const refusePattern = new RegExp(`^REFUSER\\s+${orderId}$`, 'i');
        const deliveredPattern = new RegExp(`^LIVREE?\\s+${orderId}$`, 'i');
        const codePattern = new RegExp(`^CODE\\s+${orderId}\\s+(\\d{6})$`, 'i');

        const codeMatch = text.match(codePattern);
        if (codeMatch) {
            return await this.handleLivreurCode(phone, orderId, codeMatch[1]);
        } else if (acceptPattern.test(text)) {
            return await this.handleLivreurAccept(phone, orderId);
        } else if (refusePattern.test(text)) {
            return await this.handleLivreurRefuse(phone, orderId);
        } else if (deliveredPattern.test(text)) {
            return await this.handleLivreurDelivered(phone, orderId);
        }
        return false;
    }

    async handleLivreurAccept(livreurPhone, orderId) {
        try {
            const livreur = await this.orders.getLivreurByPhone(livreurPhone);
            if (!livreur || !livreur.disponible) {
                await this.whatsapp.sendMessage(livreurPhone,
                    "❌ Tu n'es pas marqué comme disponible. Dis 'DISPONIBLE' pour l'être."
                );
                return false;
            }

            const updatedOrder = await this.orders.updateStatus(orderId, 'ACCEPTED', livreurPhone);
            if (!updatedOrder) {
                await this.whatsapp.sendMessage(livreurPhone,
                    `❌ Commande ${orderId} introuvable ou déjà attribuée.`
                );
                return false;
            }

            await this.whatsapp.sendMessage(livreurPhone,
                `✅ *Commande ${orderId} acceptée !*\n\n` +
                `👤 *Client* : ${updatedOrder.client_name}\n` +
                `📍 *Adresse* : ${updatedOrder.client_quartier}\n` +
                `📌 *Indications* : ${updatedOrder.client_indications || 'Aucune'}\n` +
                `📞 *Contact* : ${updatedOrder.client_phone}\n` +
                `💰 *Montant* : ${updatedOrder.total} FCFA\n` +
                `🔑 *Code* : ${updatedOrder.confirmation_code}\n\n` +
                `👉 Rends-toi à la pharmacie pour récupérer la commande, puis confirme avec "LIVREE ${orderId}"`
            );

            await this.whatsapp.sendMessage(updatedOrder.client_phone,
                `✅ *Commande #${orderId} acceptée !*\n\n` +
                `👨‍🚀 Livreur : ${livreur.nom}\n` +
                `📍 Livraison : ${updatedOrder.client_quartier}\n` +
                `🕒 Arrivée estimée : dans environ ${DELIVERY_CONFIG.DELIVERY_TIME} minutes\n\n` +
                `📞 Le livreur t'appellera sur ${updatedOrder.client_phone} à son arrivée.\n` +
                `🔑 *Prépare ton code de confirmation* : ${updatedOrder.confirmation_code}`
            );

            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur acceptation livreur:', error);
            return false;
        }
    }

    async handleLivreurRefuse(livreurPhone, orderId) {
        try {
            const order = await this.orders.getOrder(orderId);
            if (!order || order.status !== 'PENDING') {
                await this.whatsapp.sendMessage(livreurPhone,
                    `❌ Commande ${orderId} introuvable ou déjà attribuée.`
                );
                return false;
            }

            await this.whatsapp.sendMessage(SUPPORT_PHONE,
                `⚠️ *COMMANDE REFUSÉE* (N°${orderId})\n` +
                `👤 Livreur : ${livreurPhone}\n` +
                `📌 *Action* : Trouver un autre livreur.`
            );

            await this.whatsapp.sendMessage(livreurPhone,
                `✅ Refus de la commande ${orderId} enregistré.\n` +
                `📌 Le support va assigner un autre livreur.`
            );

            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur refus livreur:', error);
            return false;
        }
    }

    async handleLivreurDelivered(livreurPhone, orderId) {
        try {
            const order = await this.orders.getOrder(orderId);
            
            if (!order) {
                await this.whatsapp.sendMessage(livreurPhone, `❌ Commande ${orderId} introuvable.`);
                return false;
            }

            if (order.status === 'DELIVERED') {
                await this.whatsapp.sendMessage(livreurPhone, `⚠️ Commande ${orderId} déjà marquée comme livrée.`);
                return false;
            }

            await this.whatsapp.sendMessage(livreurPhone,
                `🔑 *Confirmation livraison #${orderId}*\n\n` +
                `Demande au client le code de confirmation à 6 chiffres et réponds avec:\n` +
                `"CODE ${orderId} XXXXXX" (ex: CODE ${orderId} 123456)`
            );

            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur:', error);
            return false;
        }
    }

    async handleLivreurCode(livreurPhone, orderId, code) {
        try {
            const order = await this.orders.getOrder(orderId);
            
            if (!order) {
                await this.whatsapp.sendMessage(livreurPhone, `❌ Commande ${orderId} introuvable.`);
                return false;
            }

            if (order.confirmation_code !== code) {
                await this.whatsapp.sendMessage(livreurPhone,
                    `❌ Code incorrect pour la commande ${orderId}. Réessaie ou contacte le support.`
                );
                return false;
            }

            const updatedOrder = await this.orders.updateStatus(orderId, 'DELIVERED');
            
            await pool.query(
                `UPDATE livreurs SET commandes_livrees = commandes_livrees + 1, disponible = true
                 WHERE telephone = $1 OR whatsapp = $1`,
                [livreurPhone]
            );

            await this.whatsapp.sendMessage(livreurPhone,
                `✅ *Livraison confirmée* pour la commande ${orderId} !\n` +
                `💰 Montant perçu : ${order.total} FCFA\n` +
                `📌 Tu es maintenant disponible pour de nouvelles commandes.`
            );

            await this.whatsapp.sendMessage(order.client_phone,
                `🎉 *Commande #${orderId} livrée avec succès !*\n\n` +
                `Merci d'avoir choisi MARIAM ! 😊\n` +
                `À bientôt pour vos prochains médicaments.`
            );

            await this.whatsapp.sendMessage(SUPPORT_PHONE,
                `✅ *LIVRAISON TERMINÉE #${orderId}*\n` +
                `👤 Client : ${order.client_name}\n` +
                `📍 ${order.client_quartier}\n` +
                `💰 ${order.total} FCFA`
            );

            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur validation code:', error);
            return false;
        }
    }

    async updateLivreurStatus(phone, status) {
        try {
            await pool.query(`
                UPDATE livreurs
                SET disponible = $1
                WHERE telephone = $2 OR whatsapp = $2
            `, [status === 'DISPONIBLE', phone]);

            await this.whatsapp.sendMessage(phone,
                status === 'DISPONIBLE' ?
                "✅ Tu es maintenant *disponible* pour les commandes !" :
                "⏸ Tu es maintenant *indisponible*. Reviens vite !"
            );
            return true;
        } catch (error) {
            log('ERROR', '❌ Erreur mise à jour statut livreur:', error);
            return false;
        }
    }
}

// ===========================================
// MOTEUR PRINCIPAL
// ===========================================
class MariamBot {
    constructor() {
        this.whatsapp = new WhatsAppService();
        this.search = new SearchService();
        this.vision = new VisionService();
        this.orders = new OrderService(this.whatsapp);
        this.convManager = new ConversationManager();
        this.buttons = new ButtonHandler(this.whatsapp, this.orders, this.convManager);
        this.nlp = null;
    }

    async initialize() {
        console.log("🟡 Début initialize()...");
        await this.search.initialize();
        console.log("✅ Search initialisé");
        await this.initDatabase();
        console.log("✅ Database initialisée");
        console.log("🟡 Tentative de chargement NLP...");
        await this.initializeNLP();
        console.log("✅ NLP initialisé");
        console.log("✅ NLP initialisé");
    }

    async initDatabase() {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS medicaments (
                code_produit VARCHAR(50) PRIMARY KEY,
                nom_commercial VARCHAR(200) NOT NULL,
                dci VARCHAR(200),
                dosage VARCHAR(50),
                forme VARCHAR(50),
                prix DECIMAL(10, 2) NOT NULL,
                laboratoire VARCHAR(100),
                disponible BOOLEAN DEFAULT true
            );

            CREATE TABLE IF NOT EXISTS conversations (
                phone VARCHAR(20) PRIMARY KEY,
                state VARCHAR(50) DEFAULT 'IDLE',
                cart JSONB DEFAULT '[]',
                context JSONB DEFAULT '{}',
                history JSONB DEFAULT '[]',
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(50) PRIMARY KEY,
                client_name VARCHAR(100),
                client_phone VARCHAR(20),
                client_quartier VARCHAR(100),
                client_ville VARCHAR(100) DEFAULT 'San Pedro',
                client_indications TEXT,
                patient_age INTEGER,
                patient_genre VARCHAR(1),
                patient_poids INTEGER,
                patient_taille INTEGER,
                items JSONB NOT NULL,
                subtotal DECIMAL(10, 2) NOT NULL,
                delivery_price DECIMAL(10, 2) NOT NULL,
                service_fee DECIMAL(10, 2) NOT NULL,
                total DECIMAL(10, 2) NOT NULL,
                status VARCHAR(50) DEFAULT 'PENDING',
                livreur_phone VARCHAR(20),
                confirmation_code VARCHAR(20),
                delivery_period VARCHAR(10),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS livreurs (
                id_livreur VARCHAR(10) PRIMARY KEY,
                nom VARCHAR(100) NOT NULL,
                telephone VARCHAR(20) NOT NULL,
                whatsapp VARCHAR(20),
                disponible BOOLEAN DEFAULT true,
                commandes_livrees INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE EXTENSION IF NOT EXISTS pg_trgm;
            CREATE INDEX IF NOT EXISTS medicaments_search_idx ON medicaments USING gin (nom_commercial gin_trgm_ops);
            CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
            CREATE INDEX IF NOT EXISTS livreurs_disponible_idx ON livreurs(disponible);
        `);

        log('SUCCESS', '✅ Base de données initialisée');
    }

    async initializeNLP() {
        try {
            const modelPath = path.join(__dirname, 'model.nlp');
        console.log("📁 Chemin du modèle NLP:", modelPath);
            
            if (!fs.existsSync(modelPath)) {
                throw new Error(`Fichier modèle non trouvé: ${modelPath}`);
            }

            this.nlp = new NlpManager({ languages: ['fr'] });
            await this.nlp.load(modelPath);
            
            const test = await this.nlp.process('fr', 'bonjour');
            if (!test.intent) {
                throw new Error('Modèle chargé mais ne retourne pas d\'intent');
            }
            
            log('SUCCESS', `✅ Modèle NLP chargé: ${modelPath}`);
            log('INFO', `📊 Test: "bonjour" → intent: ${test.intent} (score: ${test.score})`);
            
            return true;
        } catch (error) {
            log('ERROR', '❌ Échec chargement modèle NLP:', error);
            this.nlp = null;
            return false;
        }
    }

    fallbackNLP(text) {
        const lowerText = text.toLowerCase();
        let intent = 'unknown';
        const entities = [];

        if (lowerText.includes('doliprane') || lowerText.includes('paracétamol') || 
            lowerText.includes('ibuprofène') || lowerText.includes('médicament')) {
            intent = 'search_medicine';
            const medicineMatch = lowerText.match(/(doliprane|paracétamol|ibuprofène|amoxicilline)/i);
            if (medicineMatch) {
                entities.push({ entity: 'medicine', sourceText: medicineMatch[0] });
            }
        } else if (lowerText.includes('panier')) {
            intent = 'view_cart';
        } else if (lowerText.includes('aide') || lowerText.includes('help')) {
            intent = 'help';
        } else if (lowerText.includes('annuler')) {
            intent = 'cancel_order';
        } else if (lowerText.includes('merci') || lowerText.includes('thanks')) {
            intent = 'thanks';
        } else if (lowerText.includes('bonjour') || lowerText.includes('salut')) {
            intent = 'greet';
        } else if (lowerText.includes('au revoir') || lowerText.includes('bye')) {
            intent = 'goodbye';
        } else if (lowerText.includes('urgence')) {
            intent = 'emergency';
        } else if (lowerText.includes('qui') && lowerText.includes('créé')) {
            intent = 'ask_bot_creation';
        }

        const qtyMatch = text.match(/\d+/);
        if (qtyMatch) {
            entities.push({ entity: 'quantity', sourceText: qtyMatch[0] });
        }

        const quartiers = ['cité', 'balmer', 'saguitta', 'doba', 'grand bereby'];
        for (const q of quartiers) {
            if (lowerText.includes(q)) {
                entities.push({ entity: 'quartier', sourceText: q });
                break;
            }
        }

        return { intent, entities, score: 0.5 };
    }

    extractEntities(entities) {
        const result = {};
        entities.forEach(e => {
            if (e.entity === 'medicine' || e.entity === 'medicament') {
                result.medicine = e.sourceText || e.option;
            }
            if (e.entity === 'quantity' || e.entity === 'nombre') {
                result.quantity = parseInt(e.sourceText) || 1;
            }
            if (e.entity === 'quartier') {
                result.quartier = e.sourceText;
            }
        });
        return result;
    }

    async process(phone, text, mediaId = null) {
        try {
            const conv = await this.convManager.get(phone);
            const context = Utils.getContext(phone, conv);

            if (!conv.history || conv.history.length === 0) {
                let nom = conv.context?.client_nom;
                if (!nom) {
                    const profileResponse = await this.whatsapp.getUserProfile(phone);
                    if (profileResponse.success && profileResponse.profile.name) {
                        nom = profileResponse.profile.name.split(' ')[0];
                        conv.context.client_nom = nom;
                        await this.convManager.update(phone, { context: conv.context });
                    }
                }

                await this.whatsapp.sendMessage(
                    phone,
                    Utils.randomMessage(MESSAGES.FIRST_INTERACTION, nom)
                );

                conv.history = [{ role: 'bot', message: 'première_interaction', time: new Date() }];
                await this.convManager.update(phone, { history: conv.history });
                return;
            }

            if (mediaId) {
                await this.whatsapp.sendTyping(phone);
                await this.handleImage(phone, mediaId, conv);
                return;
            }

            await this.whatsapp.sendTyping(phone);

            let nlpResult;
            if (this.nlp) {
                try {
                    nlpResult = await this.nlp.process('fr', text);
                    log('NLP', `🧠 Intent: ${nlpResult.intent} (score: ${nlpResult.score?.toFixed(3)})`, {
                        entities: nlpResult.entities
                    });

                    if (nlpResult.score < 0.5) {
                        log('WARN', `⚠️ Score faible (${nlpResult.score}), fallback utilisé`);
                        nlpResult = this.fallbackNLP(text);
                    }
                } catch (nlpError) {
                    log('ERROR', '❌ Erreur NLP, fallback utilisé:', nlpError);
                    nlpResult = this.fallbackNLP(text);
                }
            } else {
                nlpResult = this.fallbackNLP(text);
            }

            const entities = this.extractEntities(nlpResult.entities || []);

            if (conv.state && conv.state !== 'IDLE') {
                await this.handleState(phone, text, conv, nlpResult);
            } else {
                await this.handleIntent(phone, conv, nlpResult, entities);
            }

            if (!conv.history) conv.history = [];
            conv.history.push({
                type: 'user',
                text,
                intent: nlpResult.intent,
                timestamp: new Date()
            });
            await this.convManager.update(phone, { history: conv.history });

        } catch (error) {
            log('ERROR', '❌ Erreur traitement:', error);
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
        }
    }

    async handleIntent(phone, conv, nlpResult, entities) {
        const intent = nlpResult.intent;
        const context = Utils.getContext(phone, conv);

        switch(intent) {
            case 'greet':
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.GREETINGS, context.nom)
                );
                break;

            case 'goodbye':
                await this.whatsapp.sendMessage(phone,
                    ["👋 À bientôt !", "👋 Bye ! Reviens vite !"][Math.floor(Math.random() * 2)]
                );
                break;

            case 'thanks':
                await this.whatsapp.sendMessage(phone,
                    ["🙏 Avec plaisir !", "😊 Merci à toi !"][Math.floor(Math.random() * 2)]
                );
                break;

            case 'emergency':
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.EMERGENCY)
                );
                break;

            case 'help':
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.HELP)
                );
                break;

            case 'ask_bot_creation':
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.CREATOR)
                );
                break;

            case 'search_medicine': {
                const medicine = entities.medicine || nlpResult.utterance || 'médicament';
                const results = await this.search.search(medicine);

                if (results.length === 0) {
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.NOT_FOUND(medicine))
                    );
                    return;
                }

                let msg = `🔍 *Résultats pour "${medicine}"*\n\n`;
                results.slice(0, 3).forEach((med, i) => {
                    msg += `${i+1}. *${med.nom_commercial}* - ${med.prix} FCFA\n`;
                    if (med.dosage) msg += `   💊 ${med.dosage}\n`;
                });
                msg += `\n👉 Réponds avec le *numéro* ou le nom`;

                conv.context.search_results = results;
                conv.state = 'SELECTING_MEDICINE';
                await this.convManager.update(phone, {
                    state: 'SELECTING_MEDICINE',
                    context: conv.context
                });

                await this.whatsapp.sendMessage(phone, msg);
                break;
            }

            case 'order_medicine':
            case 'add_to_cart': {
                const medName = entities.medicine || nlpResult.utterance;
                const qty = entities.quantity || 1;

                if (!medName) {
                    await this.whatsapp.sendMessage(phone, "💊 Quel médicament ?");
                    return;
                }

                const meds = await this.search.search(medName, 1);
                if (meds.length === 0) {
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.NOT_FOUND(medName))
                    );
                    return;
                }

                const med = meds[0];
                if (!conv.cart) conv.cart = [];
                conv.cart.push({ ...med, quantite: qty });

                await this.convManager.update(phone, { cart: conv.cart });

                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ADDED_TO_CART, qty, med.nom_commercial, med.prix * qty, context.nom)
                );

                await this.convManager.scheduleReminder(phone, conv);

                setTimeout(async () => {
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.ASK_MORE)
                    );
                }, 1000);
                break;
            }

            case 'view_cart':
                if (!conv.cart || conv.cart.length === 0) {
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.CART_EMPTY)
                    );
                    return;
                }

                const subtotal = conv.cart.reduce((s, i) => s + (i.prix * i.quantite), 0);
                const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');

                await this.whatsapp.sendMessage(phone,
                    `🛒 *Ton panier*\n\n${items}\n\n💰 *Total* : ${subtotal} FCFA`
                );
                break;

            case 'clear_cart':
                conv.cart = [];
                await this.convManager.update(phone, { cart: [] });
                await this.whatsapp.sendMessage(phone, "🗑️ Panier vidé !");
                break;

            case 'provide_quartier':
                const quartierValidation = Utils.validateQuartier(entities.quartier || nlpResult.utterance);
                if (!quartierValidation.valid) {
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.QUARTIER)
                    );
                    await this.whatsapp.sendMessage(phone,
                        typeof MESSAGES.RETRY_PROMPTS.QUARTIER === 'function' ? 
                        MESSAGES.RETRY_PROMPTS.QUARTIER(context.nom) : 
                        Utils.randomMessage(MESSAGES.RETRY_PROMPTS.QUARTIER)
                    );
                    return;
                }

                conv.context.client_quartier = quartierValidation.quartier;
                conv.state = 'WAITING_VILLE';
                await this.convManager.update(phone, {
                    state: 'WAITING_VILLE',
                    context: conv.context
                });

                await this.whatsapp.sendMessage(phone,
                    `📍 "${quartierValidation.quartier}" enregistré !\n` +
                    `C'est bien à San Pedro ? (oui/non)`
                );
                break;

            case 'cancel_order':
                await this.whatsapp.sendMessage(phone,
                    `❌ *Commande annulée*\n\nPas de souci ! Tu peux recommencer quand tu veux.`
                );
                await this.convManager.clear(phone);
                break;

            default:
                const qtyMatch = nlpResult.utterance?.match(/\d+/);
                const words = nlpResult.utterance?.toLowerCase().split(' ') || [];
                const possibleMedicine = words.find(w => 
                    w.length > 3 && !['pour', 'avec', 'dans', 'chez'].includes(w)
                );

                if (qtyMatch && possibleMedicine) {
                    const qty = parseInt(qtyMatch[0]);
                    const meds = await this.search.search(possibleMedicine, 1);
                    
                    if (meds.length > 0) {
                        if (!conv.cart) conv.cart = [];
                        conv.cart.push({ ...meds[0], quantite: qty });
                        await this.convManager.update(phone, { cart: conv.cart });
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.ADDED_TO_CART, qty, meds[0].nom_commercial, meds[0].prix * qty, context.nom)
                        );
                        setTimeout(async () => {
                            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_MORE));
                        }, 1000);
                        return;
                    }
                }

                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ERROR)
                );
        }
    }

    async handleState(phone, text, conv, nlpResult) {
        const context = Utils.getContext(phone, conv);
        const entities = this.extractEntities(nlpResult.entities || []);

        switch(conv.state) {
            case 'SELECTING_MEDICINE': {
                const choice = Utils.extractNumber(text);
                const results = conv.context.search_results || [];

                if (choice && choice >= 1 && choice <= results.length) {
                    conv.context.pending_medicament = results[choice - 1];
                    conv.state = 'WAITING_QUANTITY';
                    await this.convManager.update(phone, {
                        state: 'WAITING_QUANTITY',
                        context: conv.context
                    });

                    await this.whatsapp.sendMessage(phone,
                        `💊 *${conv.context.pending_medicament.nom_commercial}*\n` +
                        `💰 ${conv.context.pending_medicament.prix} FCFA\n\n` +
                        `Combien de boîtes ?`
                    );
                } else if (text && !choice) {
                    let meds = await this.search.search(text, 1);
                    if (meds.length > 0) {
                        conv.context.pending_medicament = meds[0];
                        conv.state = 'WAITING_QUANTITY';
                        await this.convManager.update(phone, {
                            state: 'WAITING_QUANTITY',
                            context: conv.context
                        });

                        await this.whatsapp.sendMessage(phone,
                            `💊 *${meds[0].nom_commercial}*\n` +
                            `💰 ${meds[0].prix} FCFA\n\n` +
                            `Combien de boîtes ?`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Aucun résultat pour "${text}". Réessaie.`
                        );
                    }
                } else {
                    await this.whatsapp.sendMessage(phone,
                        `❌ Choisis un numéro entre 1 et ${results.length}.`
                    );
                }
                break;
            }

            case 'WAITING_QUANTITY': {
                const qty = Utils.extractNumber(text);
                if (qty && qty > 0) {
                    if (!conv.cart) conv.cart = [];
                    conv.cart.push({
                        ...conv.context.pending_medicament,
                        quantite: qty
                    });
                    delete conv.context.pending_medicament;
                    conv.state = 'IDLE';

                    await this.convManager.update(phone, {
                        cart: conv.cart,
                        state: 'IDLE',
                        context: conv.context
                    });

                    await this.whatsapp.sendMessage(phone,
                        `✅ ${qty}x ${conv.cart[conv.cart.length-1].nom_commercial} ajouté !`
                    );

                    setTimeout(async () => {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.ASK_MORE)
                        );
                    }, 1000);
                } else {
                    await this.whatsapp.sendMessage(phone,
                        "❌ Quantité invalide. Exemple : '2'."
                    );
                }
                break;
            }

            case 'WAITING_VILLE':
                if (text.toLowerCase().includes('san pedro') || text.toLowerCase().includes('oui')) {
                    conv.context.client_ville = 'San Pedro';
                    conv.state = 'WAITING_NAME';
                    await this.convManager.update(phone, {
                        state: 'WAITING_NAME',
                        context: conv.context
                    });

                    if (conv.context.client_nom) {
                        conv.state = 'WAITING_AGE';
                        await this.convManager.update(phone, {
                            state: 'WAITING_AGE',
                            context: conv.context
                        });
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.ASK_AGE, context.nom)
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.ASK_NAME, context.nom)
                        );
                    }
                } else {
                    await this.whatsapp.sendMessage(phone,
                        "📍 On livre uniquement à San Pedro. C'est bien ta ville ? (oui/non)"
                    );
                }
                break;

            case 'WAITING_NAME': {
                const nameValidation = Utils.validateName(text);
                if (!nameValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'name');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.NAME)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Problème avec ton nom. Réponds simplement avec ton prénom et nom.`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.NAME)
                        );
                    }
                    return;
                }

                conv.context.client_nom = text.trim();
                await this.convManager.resetValidationAttempts(phone, 'name');
                conv.state = 'WAITING_AGE';
                await this.convManager.update(phone, {
                    state: 'WAITING_AGE',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_AGE, context.nom)
                );
                break;
            }

            case 'WAITING_AGE': {
                const ageValidation = Utils.validateAge(text);
                if (!ageValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'age');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.AGE)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Âge invalide. Dis-moi ton âge en années (ex: 25).`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.AGE)
                        );
                    }
                    return;
                }

                await this.convManager.resetValidationAttempts(phone, 'age');
                conv.context.patient_age = ageValidation.age;
                conv.state = 'WAITING_GENDER';
                await this.convManager.update(phone, {
                    state: 'WAITING_GENDER',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_GENDER, context.nom)
                );
                break;
            }

            case 'WAITING_GENDER': {
                const genderValidation = Utils.validateGender(text);
                if (!genderValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'gender');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.GENDER)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Genre invalide. Réponds avec M ou F.`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.GENDER)
                        );
                    }
                    return;
                }

                await this.convManager.resetValidationAttempts(phone, 'gender');
                conv.context.patient_genre = genderValidation.gender;
                conv.state = 'WAITING_WEIGHT';
                await this.convManager.update(phone, {
                    state: 'WAITING_WEIGHT',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_WEIGHT, context.nom)
                );
                break;
            }

            case 'WAITING_WEIGHT': {
                const weightValidation = Utils.validateWeight(text);
                if (!weightValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'weight');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.WEIGHT)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Poids invalide. Dis-moi ton poids en kg (ex: 70).`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.WEIGHT)
                        );
                    }
                    return;
                }

                await this.convManager.resetValidationAttempts(phone, 'weight');
                conv.context.patient_poids = weightValidation.weight;
                conv.state = 'WAITING_HEIGHT';
                await this.convManager.update(phone, {
                    state: 'WAITING_HEIGHT',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_HEIGHT, context.nom)
                );
                break;
            }

            case 'WAITING_HEIGHT': {
                const heightValidation = Utils.validateHeight(text);
                if (!heightValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'height');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.HEIGHT)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Taille invalide. Dis-moi ta taille en cm (ex: 175).`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.HEIGHT)
                        );
                    }
                    return;
                }

                await this.convManager.resetValidationAttempts(phone, 'height');
                conv.context.patient_taille = heightValidation.height;
                conv.state = 'WAITING_PHONE';
                await this.convManager.update(phone, {
                    state: 'WAITING_PHONE',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_PHONE, context.nom)
                );
                break;
            }

            case 'WAITING_PHONE': {
                const phoneValidation = Utils.validatePhone(text);
                if (!phoneValidation.valid) {
                    const attempts = await this.convManager.trackValidationAttempt(phone, 'phone');
                    await this.whatsapp.sendMessage(phone,
                        Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.PHONE)
                    );

                    if (attempts >= 3) {
                        await this.whatsapp.sendMessage(phone,
                            `😕 Numéro invalide. Format: 07XXXXXXXX.`
                        );
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            Utils.randomMessage(MESSAGES.RETRY_PROMPTS.PHONE)
                        );
                    }
                    return;
                }

                await this.convManager.resetValidationAttempts(phone, 'phone');
                conv.context.client_telephone = phoneValidation.phone;
                conv.state = 'WAITING_INDICATIONS';
                await this.convManager.update(phone, {
                    state: 'WAITING_INDICATIONS',
                    context: conv.context
                });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ASK_INDICATIONS, context.nom)
                );
                break;
            }

            case 'WAITING_INDICATIONS':
                const indications = text.toLowerCase() === 'non' ? '' : text;
                conv.context.client_indications = indications;
                conv.state = 'WAITING_CONFIRMATION';

                await this.convManager.update(phone, {
                    state: 'WAITING_CONFIRMATION',
                    context: conv.context
                });

                const summary = Utils.formatSummary(conv);
                await this.whatsapp.sendInteractiveButtons(phone, summary,
                    [BUTTONS.CONFIRM, BUTTONS.MODIFY, BUTTONS.CANCEL]);

                await this.convManager.scheduleReminder(phone, conv, 10 * 60 * 1000);
                break;

            case 'WAITING_IMAGE_SELECTION': {
                if (text.toLowerCase() === 'aucun') {
                    await this.whatsapp.sendMessage(phone,
                        "❌ Commande annulée. Envoie une nouvelle image ou écris le nom."
                    );
                    conv.state = 'IDLE';
                    await this.convManager.update(phone, { state: 'IDLE' });
                    return;
                }

                if (text.toLowerCase() === 'tout') {
                    for (const med of conv.context.pending_image_options) {
                        if (!conv.cart) conv.cart = [];
                        conv.cart.push({ ...med, quantite: 1 });
                    }

                    await this.whatsapp.sendMessage(phone,
                        `✅ Tous les médicaments ajoutés ! Voici ton panier :\n\n` +
                        conv.cart.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n') +
                        `\n👉 On continue ?`
                    );

                    conv.state = 'IDLE';
                    delete conv.context.pending_image_options;
                    await this.convManager.update(phone, {
                        state: 'IDLE',
                        cart: conv.cart,
                        context: conv.context
                    });
                    return;
                }

                const choice = parseInt(text);
                if (choice && choice > 0 && choice <= conv.context.pending_image_options.length) {
                    const selectedMed = conv.context.pending_image_options[choice - 1];
                    if (!conv.cart) conv.cart = [];
                    conv.cart.push({ ...selectedMed, quantite: 1 });

                    await this.whatsapp.sendMessage(phone,
                        `✅ ${selectedMed.nom_commercial} ajouté !\n` +
                        `👉 Veux-tu modifier la quantité ou ajouter autre chose ?`
                    );

                    conv.state = 'WAITING_QUANTITY_ADJUST';
                    conv.context.pending_medicament = selectedMed;
                    await this.convManager.update(phone, {
                        state: 'WAITING_QUANTITY_ADJUST',
                        cart: conv.cart,
                        context: conv.context
                    });
                } else {
                    await this.whatsapp.sendMessage(phone,
                        `❌ Choix invalide. Réponds avec un numéro entre 1 et ${conv.context.pending_image_options.length}.`
                    );
                }
                break;
            }

            case 'WAITING_QUANTITY_ADJUST': {
                const adjustQty = Utils.extractNumber(text);
                if (adjustQty && adjustQty > 0) {
                    const lastItemIndex = conv.cart.length - 1;
                    conv.cart[lastItemIndex].quantite = adjustQty;

                    await this.whatsapp.sendMessage(phone,
                        `✅ Quantité mise à jour : ${adjustQty}x ${conv.cart[lastItemIndex].nom_commercial}\n` +
                        `👉 Autre chose ?`
                    );

                    conv.state = 'IDLE';
                    delete conv.context.pending_medicament;
                    await this.convManager.update(phone, {
                        state: 'IDLE',
                        cart: conv.cart,
                        context: conv.context
                    });
                } else {
                    await this.whatsapp.sendMessage(phone, "❌ Quantité invalide. Exemple : '2'.");
                }
                break;
            }
        }
    }

    async handleImage(phone, mediaId, conv) {
        await this.whatsapp.sendMessage(phone, "📸 Analyse de ton image en cours...");

        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Impossible de télécharger l'image. Réessaie.");
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        if (!visionResult.medicines || visionResult.medicines.length === 0) {
            await this.whatsapp.sendMessage(phone,
                "🔍 Aucun médicament détecté. Essaie avec une photo plus nette ou envoie le nom directement."
            );
            return;
        }

        const searchResults = await this.vision.searchDetectedMedicines(visionResult.medicines);
        if (searchResults.length === 0) {
            await this.whatsapp.sendMessage(phone,
                "🔍 Aucun médicament trouvé en stock pour cette image. Essaie avec une autre photo ou écris le nom."
            );
            return;
        }

        let message = `🔍 *Résultats pour ton image* (${visionResult.type === 'prescription' ? 'ordonnance' : 'boîte'}) :\n\n`;
        let options = [];
        for (let i = 0; i < searchResults.length; i++) {
            const result = searchResults[i];
            message += `${i+1}. *${result.matches[0].nom_commercial}*\n`;
            message += `   - Dosage: ${result.matches[0].dosage || 'N/A'}\n`;
            message += `   - Forme: ${result.matches[0].forme || 'N/A'}\n`;
            message += `   - Prix: ${result.matches[0].prix} FCFA\n`;
            message += `   - Confiance: ${Math.round(result.detected.confidence * 100)}%\n\n`;
            options.push(result.matches[0]);
        }

        message += `👉 Réponds avec le *numéro* du médicament à commander\n` +
                   `ou "tout" pour tout ajouter, "aucun" pour annuler.`;

        await this.whatsapp.sendMessage(phone, message);

        conv.context.pending_image_options = options;
        conv.state = 'WAITING_IMAGE_SELECTION';
        await this.convManager.update(phone, {
            state: 'WAITING_IMAGE_SELECTION',
            context: conv.context
        });
    }
}

// ===========================================
// EXPRESS APP
// ===========================================
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression({ level: 9 }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.set('trust proxy', 1);

const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    keyGenerator: (req) => req.ip
});

app.use('/webhook', webhookLimiter);

// ===========================================
// INSTANCES
// ===========================================
const bot = new MariamBot();
const whatsapp = new WhatsAppService();

// ===========================================
// FONCTIONS AIDE POUR WEBHOOK
// ===========================================
async function checkIfLivreur(phone) {
    const result = await pool.query(
        'SELECT 1 FROM livreurs WHERE telephone = $1 OR whatsapp = $1 LIMIT 1',
        [phone]
    );
    return result.rows.length > 0;
}

async function handleLivreurMessage(phone, text) {
    const orderIdMatch = text.match(/^(PRENDRE|REFUSER|LIVRE|CODE)\s+([A-Z0-9]+)(?:\s+(\d{6}))?$/i);
    if (orderIdMatch) {
        const [_, action, orderId, code] = orderIdMatch;
        if (action.toUpperCase() === 'PRENDRE') {
            await bot.buttons.handleLivreurAccept(phone, orderId);
        } else if (action.toUpperCase() === 'REFUSER') {
            await bot.buttons.handleLivreurRefuse(phone, orderId);
        } else if (action.toUpperCase() === 'LIVRE') {
            await bot.buttons.handleLivreurDelivered(phone, orderId);
        } else if (action.toUpperCase() === 'CODE' && code) {
            await bot.buttons.handleLivreurCode(phone, orderId, code);
        }
        return;
    }

    if (text.toUpperCase() === 'DISPONIBLE' || text.toUpperCase() === 'INDISPONIBLE') {
        await bot.buttons.updateLivreurStatus(phone, text.toUpperCase());
        return;
    }

    await whatsapp.sendMessage(phone,
        "🤔 Commandes livreur :\n" +
        "- PRENDRE CMD1234 (accepter)\n" +
        "- REFUSER CMD1234 (refuser)\n" +
        "- LIVRE CMD1234 (arrivé chez client)\n" +
        "- CODE CMD1234 123456 (confirmer avec code)\n" +
        "- DISPONIBLE/INDISPONIBLE (changer statut)"
    );
}

// ===========================================
// WEBHOOK WHATSAPP
// ===========================================
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        const msg = change.value?.messages?.[0];

        if (!msg || !msg.from) return;

        if (processedMessages.has(msg.id)) return;
        processedMessages.set(msg.id, true);

        await whatsapp.markAsRead(msg.id);

        const isLivreur = await checkIfLivreur(msg.from);
        if (isLivreur && msg.type === 'text') {
            await handleLivreurMessage(msg.from, msg.text.body.trim());
            return;
        }

        if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
            const buttonText = msg.interactive.button_reply.title;
            if (ALLOWED_BUTTONS.has(buttonText)) {
                const conv = await bot.convManager.get(msg.from);
                await bot.buttons.handle(msg.from, buttonText, conv);
            }
            return;
        }

        if (msg.type === 'image') {
            await bot.process(msg.from, null, msg.image.id);
            return;
        }

        if (msg.type === 'text') {
            await bot.process(msg.from, msg.text.body.trim());
        }

    } catch (error) {
        log('ERROR', '❌ Webhook error:', error);
    }
});

// ===========================================
// ROUTES API
// ===========================================
app.get('/', (req, res) => {
    res.json({
        name: 'MARIAM Bot - San Pedro',
        creator: 'Youssef - UPSP (Licence 2, 2026)',
        version: '3.2.0',
        status: 'online',
        features: {
            nlp: '28 intentions - Modèle pré-entraîné',
            vision: 'Groq Llama-4-Scout',
            delivery: 'San Pedro only',
            notifications: 'WhatsApp (client + support + livreur)',
            validation: 'Toutes infos validées avant commande'
        }
    });
});

app.get('/health', async (req, res) => {
    const checks = {
        database: false,
        whatsapp: false,
        groq: false
    };

    try {
        await pool.query('SELECT 1');
        checks.database = true;
    } catch (e) {}

    try {
        await axios.get(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}`, {
            headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
            timeout: 3000
        });
        checks.whatsapp = true;
    } catch (e) {}

    try {
        const groq = new Groq({ apiKey: GROQ_API_KEY });
        await groq.models.list();
        checks.groq = true;
    } catch (e) {}

    const allHealthy = Object.values(checks).every(v => v === true);
    
    res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        checks,
        uptime: process.uptime()
    });
});

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    console.log("🔍 PORT =", process.env.PORT);
    await bot.initialize();
    console.log("✅ Bot initialisé");

    const server = app.listen(PORT, '0.0.0.0', () => {
    console.log("✅ Serveur en cours de démarrage...");
        console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 MARIAM BOT - PRODUCTION READY                        ║
║   📱 Version 3.2.0 - Style PayParrot intégré              ║
║                                                           ║
║   🧠 NLP: Modèle pré-entraîné (28 intentions)            ║
║   📸 Vision: Groq Llama-4-Scout                           ║
║   📍 Livraison: San Pedro uniquement                      ║
║   💬 Plus de 500 variations de messages                   ║
║   👨‍💻 Créé par: Youssef - UPSP (Licence 2, 2026)         ║
║   📱 Port: ${PORT}                                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
        `);
    });

    const gracefulShutdown = async (signal) => {
        log('INFO', `${signal} reçu, arrêt gracieux...`);
        server.close(async () => {
            log('INFO', 'Serveur HTTP fermé');
            await pool.end();
            log('INFO', 'Connexions DB fermées');
            process.exit(0);
        });
        setTimeout(() => {
            log('ERROR', 'Arrêt forcé après timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

start();

process.on('unhandledRejection', (err) => {
    log('ERROR', 'Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    log('ERROR', 'Uncaught exception:', err);
    if (IS_PRODUCTION) process.exit(1);
});

module.exports = app;