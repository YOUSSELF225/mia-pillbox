require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const helmet = require('helmet');
const { NlpManager } = require('node-nlp');
const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ===========================================
// CONFIGURATION
// ===========================================
const PORT = process.env.PORT || 10000;
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
    levels: {
        error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6,
        nlp: 7, success: 8, vision: 9, webhook: 10, db: 11, order: 12, livreur: 13, button: 14
    },
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
    logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

function log(level, message, data = null) {
    const icons = {
        INFO: '📘', SUCCESS: '✅', ERROR: '❌', BOT: '🤖', NLP: '🧠',
        VISION: '📸', WEBHOOK: '📨', DB: '💾', ORDER: '📦',
        LIVREUR: '🛵', WARN: '⚠️', BUTTON: '🔘'
    };
    logger.log(level.toLowerCase(), `${icons[level] || '📌'} ${message}`, { data });
    if (!IS_PRODUCTION) console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] ${icons[level] || '📌'} ${message}`, data || '');
}

// ===========================================
// ÉTATS DE CONVERSATION
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
    CONFIRM: '✅ Valider',
    MODIFY: '❌ Modifier',
    CANCEL: '🗑️ Annuler',
    VALIDATE_DELIVERY: '✅ Valider la livraison',
    CANCEL_ORDER: '❌ Annuler la commande'
};

const ALLOWED_BUTTONS = new Set([
    BUTTONS.CONFIRM, BUTTONS.MODIFY, BUTTONS.CANCEL,
    BUTTONS.VALIDATE_DELIVERY, BUTTONS.CANCEL_ORDER
]);

// ===========================================
// MESSAGES VARIÉS
// ===========================================
const MESSAGES = {
    GREETINGS: [
        (nom) => `👋 Salut ${nom || 'toi'} ! Je suis MARIAM, ton assistante santé. 💊 Que puis-je faire pour toi aujourd’hui ?`,
        (nom) => `🌟 Bonjour ${nom || ''} ! MARIAM à ton service. 💊 Tu cherches un médicament ou tu veux passer une commande ?`,
        (nom) => `👋 Hey ${nom || ''} ! 💊 Dis-moi ce dont tu as besoin, et je m’occupe de tout !`
    ],

    FIRST_INTERACTION: [
        (nom) => `👋 *Salut ${nom || 'toi'} !*
Je suis MARIAM, ton assistante santé 24/7 à San Pedro. 💊
*Ce que je peux faire pour toi :*
• Trouver des médicaments (par nom ou photo)
• Préparer ta commande
• Organiser la livraison rapide
*Exemples :*
• "2 doliprane"
• Envoie une photo de ta boîte
• "aide" pour le mode d'emploi
⚠️ *On livre uniquement à San Pedro*`,
        (nom) => `🌟 *Bienvenue sur MARIAM ${nom || ''} !*
Je suis ta pharmacienne virtuelle à San Pedro. 🏥
*Comment commander :*
1. Dis-moi le médicament
2. Donne ton quartier
3. Confirme et c'est parti !
*Astuce :* Envoie une photo, je détecte automatiquement !
📍 *Zone de livraison : San Pedro uniquement*`,
        (nom) => `👋 *Salut ${nom || 'toi'} !* Je suis **MARIAM**.
📌 *Ma mission* : Te permettre de commander tes médicaments en 2 min chrono !
💡 *Exemples* :
• "2 doliprane"
• Envoie une 📸 de ta boîte
• "aide" pour le mode d'emploi
⚠️ *On livre uniquement à San Pedro*`
    ],

    ASK_QUARTIER: [
        (nom) => `📍 ${nom || 'Ton'} quartier à San Pedro ?`,
        (nom) => `📍 Où te livrer ${nom || ''} ? (quartier)`,
        (nom) => `📍 Quartier de livraison ${nom || ''} ?`
    ],

    ASK_VILLE: [
        (nom) => `📍 C'est à San Pedro ${nom || ''} ? (oui/non)`,
        (nom) => `📍 On livre uniquement à San Pedro. OK ${nom || ''} ?`,
        (nom) => `📍 Tu es bien à San Pedro ${nom || ''} ?`
    ],

    ASK_NAME: [
        (nom) => `👤 ${nom || 'Ton'} nom complet ?`,
        (nom) => `👤 Qui est le client ${nom || ''} ?`,
        (nom) => `👤 Nom et prénom ${nom || ''} ?`
    ],

    ASK_AGE: [
        (nom) => `🎂 ${nom || ''}, quel est ton âge ? (ex: 25 ans)`,
        (nom) => `👶 ${nom || ''}, peux-tu me dire ton âge ? (un nombre entre 1 et 120)`,
        (nom) => `📅 ${nom || ''}, quel âge as-tu ? (ex: 30)`
    ],

    ASK_GENDER: [
        (nom) => `⚧ ${nom || ''}, es-tu un homme (M) ou une femme (F) ?`,
        (nom) => `⚥ ${nom || ''}, peux-tu préciser ton genre ? (M ou F)`,
        (nom) => `👔 ${nom || ''}, quel est ton genre ? Réponds avec M ou F.`
    ],

    ASK_WEIGHT: [
        (nom) => `⚖️ ${nom || ''}, quel est ton poids en kg ? (ex: 70)`,
        (nom) => `🏋️ ${nom || ''}, peux-tu me dire ton poids ? (en kilogrammes)`,
        (nom) => `📉 ${nom || ''}, combien pèses-tu ? (ex: 65 kg)`
    ],

    ASK_HEIGHT: [
        (nom) => `📏 ${nom || ''}, quelle est ta taille en cm ? (ex: 175)`,
        (nom) => `📐 ${nom || ''}, peux-tu me donner ta taille ? (en centimètres)`,
        (nom) => `👣 ${nom || ''}, quelle est ta taille ? (ex: 168 cm)`
    ],

    ASK_PHONE: [
        (nom) => `📞 ${nom || ''}, quel est ton numéro de téléphone ?`,
        (nom) => `📱 ${nom || ''}, peux-tu me donner ton numéro ? (ex: 0701234567)`,
        (nom) => `📞 ${nom || ''}, à quel numéro te contacter ?`
    ],

    ASK_INDICATIONS: [
        (nom) => `📍 ${nom || ''}, as-tu des indications pour le livreur ? (ex: "Porte verte") ou "non"`,
        (nom) => `📌 ${nom || ''}, y a-t-il des détails pour faciliter la livraison ?`,
        (nom) => `🗺️ ${nom || ''}, comment le livreur peut-il te trouver ? (ou réponds "non")`
    ],

    ADDED_TO_CART: (qty, med, total, nom) => [
        `✅ *Ajouté !* 📦 ${qty}x ${med} pour ${total} FCFA.\n${nom ? `${nom}, ` : ''}Tu veux autre chose ?`,
        `🎉 *C’est noté !* ${qty}x ${med} ajouté(e)s à ton panier (${total} FCFA).\n👉 Dis-moi si tu veux continuer !`,
        `✅ *Parfait !* ${qty}x ${med} = ${total} FCFA.\n${nom ? `${nom}, ` : ''}On ajoute autre chose ? 😊`
    ],

    CART_EMPTY: [
        "🛒 Ton panier est vide pour l’instant. 😊 Tu veux ajouter un médicament ?",
        "📭 Rien dans ton panier. Dis-moi ce que tu cherches !",
        "💊 Ton panier est vide. Tape le nom d’un médicament ou envoie une photo pour commencer !"
    ],

    NOT_FOUND: (query) => [
        `😕 Pas de "${query}". Autre chose ?`,
        `🔍 "${query}" introuvable. Essaie avec un autre nom ou envoie une photo.`,
        `❌ Aucun résultat pour "${query}". Vérifie l’orthographe ou cherche autrement.`
    ],

    ERROR: [
        "🤔 Désolé, je n’ai pas compris. Peux-tu reformuler ou taper *aide* ?",
        "❌ Oops ! Je n’ai pas saisi ta demande. Essaie avec d’autres mots ou envoie *aide*.",
        "😕 Je n’ai pas capté. Tu peux réessayer ou taper *menu* pour voir les options."
    ],

    VALIDATION_ERRORS: {
        NAME: ["👤 Le nom doit faire au moins 2 caractères.", "❌ Nom invalide. Utilise des lettres.", "📛 Nom incorrect."],
        AGE: ["🎂 Âge invalide (1-120 ans).", "❌ Âge doit être un nombre.", "👶 Âge non valide."],
        GENDER: ["⚥ Genre invalide (M/F).", "👔 Réponds avec M ou F.", "⚧ Genre requis."],
        WEIGHT: ["⚖️ Poids invalide (20-200 kg).", "🏋️ Poids doit être un nombre.", "⚖️ Valeur impossible."],
        HEIGHT: ["📏 Taille invalide (100-250 cm).", "📐 Taille doit être un nombre.", "📏 Taille non réaliste."],
        PHONE: ["📞 Numéro invalide (ex: 07XXXXXXXX).", "📱 Format incorrect.", "📞 10 chiffres requis."],
        QUARTIER: ["📍 Quartier requis (ex: Cité).", "🗺️ Précise un quartier.", "📌 Quartier invalide."],
        VILLE: ["🏙️ Livraison uniquement à San Pedro.", "📍 Ville non desservie.", "🏘️ Zone limitée à San Pedro."]
    },

    CONFIRM_ORDER: (order, nom) => {
        const items = order.items.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n');
        return [
            `🎉 *COMMANDE CONFIRMÉE, ${nom || ''} !* 📦
            📋 *Détails*:
            • N°: ${order.id}
            • Adresse: ${order.client_quartier}, San Pedro
            • Livraison: ${Utils.estimateDeliveryTime()}
            • Code: **${order.confirmation_code}**
            👶 *Patient*:
            - Âge: ${order.patient_age || 'Non précisé'}
            - Genre: ${order.patient_genre || 'Non précisé'}
            - Poids: ${order.patient_poids || 'Non précisé'} kg
            - Taille: ${order.patient_taille || 'Non précisé'} cm
            📦 *Articles*:
            ${items}
            💰 *Total*: ${order.total} FCFA
            📱 Le livreur t’appellera sur ${order.client_phone}.`,
            `✅ *Commande validée, ${nom || ''} !* 🛵
            📦 *Ta commande*:
            - ID: ${order.id}
            - Adresse: ${order.client_quartier}
            - Code: **${order.confirmation_code}**
            👶 *Patient*:
            - Âge: ${order.patient_age || 'Non précisé'}
            - Poids: ${order.patient_poids || 'Non précisé'} kg
            📱 Le livreur t’appellera sur ${order.client_phone}.`,
            `🎉 *C’est parti, ${nom || ''} !* 📦
            • Commande #${order.id}
            • Livraison à ${order.client_quartier}
            • Code: **${order.confirmation_code}**
            👶 *Infos patient*:
            - Poids: ${order.patient_poids || 'Non précisé'} kg
            - Taille: ${order.patient_taille || 'Non précisé'} cm
            🕒 Arrivée: ${Utils.estimateDeliveryTime()}`
        ];
    },

    ORDER_SUMMARY: (conv, context = {}) => {
        const subtotal = conv.cart.reduce((sum, item) => sum + (item.prix * item.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;
        const items = conv.cart.map(item => `• ${item.quantite}x ${item.nom_commercial} - ${item.prix * item.quantite} FCFA`).join('\n');
        return [
            `*RÉSUMÉ DE TA COMMANDE* 📋
            ${items}
            📍 *LIVRAISON*
            • Quartier: ${conv.context.client_quartier}
            • Ville: San Pedro
            • ${delivery.message}: ${delivery.price} FCFA
            👤 *CLIENT*
            • ${conv.context.client_nom || 'Non précisé'}
            • 📞 ${conv.context.client_telephone || 'Non précisé'}
            👶 *PATIENT*
            • Âge: ${conv.context.patient_age || 'Non précisé'}
            • Genre: ${conv.context.patient_genre || 'Non précisé'}
            • Poids: ${conv.context.patient_poids || 'Non précisé'} kg
            • Taille: ${conv.context.patient_taille || 'Non précisé'} cm
            💰 *TOTAL: ${total} FCFA*
            -------------------
            ${context.nom ? `${context.nom}, ` : ''}Tout est bon ? 👇`,
            `📋 *Ta commande* 🛒
            ${items}
            📍 *Livraison à*: ${conv.context.client_quartier}, San Pedro
            👤 *Infos client*:
            - Nom: ${conv.context.client_nom || 'Non précisé'}
            - Téléphone: ${conv.context.client_telephone || 'Non précisé'}
            👶 *Patient*:
            - Âge: ${conv.context.patient_age || 'Non précisé'}
            - Poids: ${conv.context.patient_poids || 'Non précisé'} kg
            💰 *Total*: ${total} FCFA
            -------------------
            ✅ *Prêt à valider ?*`,
            `🛒 *Panier*:
            ${items}
            📍 *Adresse*: ${conv.context.client_quartier}
            👤 *Client*: ${conv.context.client_nom}
            👶 *Patient*:
            - Poids: ${conv.context.patient_poids || 'Non précisé'} kg
            - Taille: ${conv.context.patient_taille || 'Non précisé'} cm
            💰 *À payer*: ${total} FCFA
            -------------------
            ${context.nom ? `${context.nom}, ` : ''}On valide ? 😊`
        ];
    },

    NOTIFICATIONS: {
        ORDER_CREATED: (order) => [
            `📦 *NOUVELLE COMMANDE #${order.id}*
            👤 *Client* : ${order.client_name} (${order.client_phone})
            📍 *Livraison* : ${order.client_quartier}, San Pedro
            📌 *Indications* : ${order.client_indications || 'Aucune'}
            👶 *Patient* :
            - Âge: ${order.patient_age || 'Non précisé'}
            - Genre: ${order.patient_genre || 'Non précisé'}
            - Poids: ${order.patient_poids || 'Non précisé'} kg
            - Taille: ${order.patient_taille || 'Non précisé'} cm
            📦 *Articles* :
            ${order.items.map(item => `   • ${item.quantite}x ${item.nom_commercial}`).join('\n')}
            💰 *Total* : ${order.total} FCFA
            🔑 *Code* : ${order.confirmation_code}
            🕒 ${new Date().toLocaleTimeString('fr-FR')}`,
            `📋 *COMMANDE #${order.id} À TRAITER*
            👤 ${order.client_name} (${order.client_phone})
            📍 ${order.client_quartier}, San Pedro
            👶 *Patient* : ${order.patient_age || '?'} ans, ${order.patient_genre || '?'}, ${order.patient_poids || '?'} kg, ${order.patient_taille || '?'} cm
            📦 ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
            💰 ${order.total} FCFA | 🔑 ${order.confirmation_code}
            🕒 ${new Date().toLocaleTimeString('fr-FR')}`,
            `✅ *NOUVELLE COMMANDE*
            ID: ${order.id}
            Client: ${order.client_name} (${order.client_phone})
            Adresse: ${order.client_quartier}
            Patient: ${order.patient_age || '?'} ans, ${order.patient_poids || '?'} kg
            Articles: ${order.items.map(item => `${item.quantite}x ${item.nom_commercial}`).join(', ')}
            Total: ${order.total} FCFA | Code: ${order.confirmation_code}`
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
            return Array.isArray(result) ? result[Math.floor(Math.random() * result.length)] : result;
        }
        if (Array.isArray(messages)) {
            return messages[Math.floor(Math.random() * messages.length)];
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
        if (!isValid) return { valid: false, error: "Numéro invalide. Format : 07XXXXXXXX, 01XXXXXXXX ou 05XXXXXXXX." };
        return { valid: true, phone: clean.length === 12 ? clean.substring(3) : clean };
    }

    static validateName(name) {
        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return { valid: false, error: "Le nom doit faire au moins 2 caractères." };
        }
        const invalidChars = /[0-9!@#$%^&*()_+=\[\]{};':"\\|,.<>\/?`~]/;
        if (invalidChars.test(name)) return { valid: false, error: "Le nom contient des caractères interdits." };
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
            return { valid: true, gender: normalized.startsWith('M') ? 'M' : 'F' };
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

    static generateOrderId() {
        const date = new Date();
        return `CMD${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    }

    static generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000)); // Code à 6 chiffres
    }

    static getDeliveryPrice(hour = new Date().getHours()) {
        const isNight = hour >= DELIVERY_CONFIG.NIGHT_HOURS.start && hour < DELIVERY_CONFIG.NIGHT_HOURS.end;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'NIGHT' : 'DAY',
            message: isNight ? '🌙 Nuit' : '☀️ Jour'
        };
    }

    static estimateDeliveryTime() {
        const date = new Date();
        date.setMinutes(date.getMinutes() + DELIVERY_CONFIG.DELIVERY_TIME);
        return `${date.getHours()}h${String(date.getMinutes()).padStart(2, '0')}`;
    }
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
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
// SERVICE DE RECHERCHE
// ===========================================
class SearchService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600 });
    }

    async initialize() {
        const result = await pool.query(`
            SELECT code_produit, nom_commercial, dci, prix, categorie
            FROM medicaments
            WHERE disponible = true
        `);
        this.medicaments = result.rows.map(med => ({
            ...med,
            searchable: `${med.nom_commercial} ${med.dci || ''} ${med.categorie || ''}`.toLowerCase(),
            simple: Utils.normalize(med.nom_commercial)
        }));
        this.fuse = new Fuse(this.medicaments, {
            keys: [
                { name: 'nom_commercial', weight: 0.8 },
                { name: 'dci', weight: 0.5 },
                { name: 'searchable', weight: 0.3 }
            ],
            threshold: 0.3,
            distance: 50,
            minMatchCharLength: 2,
            ignoreLocation: true,
            shouldSort: true
        });
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

        const normalizedQuery = this.normalize(query);
        const results = this.fuse.search(normalizedQuery)
            .slice(0, limit)
            .map(r => r.item);

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
                return { success: false, error: "Image trop volumineuse (max 4MB)" };
            }

            const prompt = `Tu es MARIAM-VISION, un assistant spécialisé dans la reconnaissance de médicaments.
            **Instructions** :
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
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ]
                }],
                temperature: 0.1,
                max_tokens: 1024,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            if (result.medicines) result.medicines = result.medicines.filter(m => m.confidence >= 0.6);
            return result;
        } catch (error) {
            return { success: false, message: "Erreur analyse image" };
        }
    }

    async searchDetectedMedicines(medicines) {
        if (!medicines || medicines.length === 0) return [];
        const results = [];
        for (const med of medicines) {
            if (med.confidence < 0.4) continue;
            const res = await pool.query(
                `SELECT * FROM medicaments
                 WHERE disponible = true
                 AND (nom_commercial ILIKE $1 OR dci ILIKE $1)
                 LIMIT 3`,
                [`%${med.name}%`]
            );
            if (res.rows.length > 0) results.push({ detected: med, matches: res.rows });
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
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            return true;
        } catch (error) {
            log('ERROR', `Erreur envoi WhatsApp: ${error.message}`);
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
                            reply: { id: `btn_${Date.now()}_${index}_${to}`, title: btn.substring(0, 20) }
                        }))
                    }
                }
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            return true;
        } catch (error) {
            log('ERROR', `Erreur envoi boutons: ${error.message}`);
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
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
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
            return { success: true, buffer: Buffer.from(file.data), mimeType: media.data.mime_type };
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
            });
        } catch (error) {}
    }

    async getUserProfile(phone) {
        try {
            const response = await axios.get(`https://graph.facebook.com/v18.0/${phone}`, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                params: { fields: 'name' }
            });
            return { success: true, profile: response.data };
        } catch (error) {
            return { success: false, error: "Impossible de récupérer le profil" };
        }
    }

    async notifySupport(order) {
        const message = Utils.randomMessage(MESSAGES.NOTIFICATIONS.ORDER_CREATED, order);
        await this.sendInteractiveButtons(SUPPORT_PHONE, message, [
            BUTTONS.VALIDATE_DELIVERY,
            BUTTONS.CANCEL_ORDER
        ]);
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
                    client_indications, patient_age, patient_genre, patient_poids,
                    patient_taille, items, subtotal, delivery_price, service_fee,
                    total, confirmation_code, delivery_period, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `, [
                order.id, order.client_name, order.client_phone, order.client_quartier,
                order.client_ville, order.client_indications, order.patient_age,
                order.patient_genre, order.patient_poids, order.patient_taille,
                JSON.stringify(order.items), order.subtotal, order.delivery_price,
                order.service_fee, order.total, order.confirmation_code,
                order.delivery_period, order.status
            ]);
            await client.query('COMMIT');
            return order;
        } catch (error) {
            await client.query('ROLLBACK');
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

    async updateStatus(id, status) {
        const result = await pool.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id]
        );
        if (result.rows.length > 0) {
            const updatedOrder = result.rows[0];
            updatedOrder.items = typeof updatedOrder.items === 'string' ? JSON.parse(updatedOrder.items) : updatedOrder.items;
            return updatedOrder;
        }
        return null;
    }

    async assignLivreur(orderId) {
        const client = await pool.connect();
        try {
            const livreurResult = await client.query(`
                SELECT id_livreur, nom, telephone, whatsapp, statut, disponible
                FROM livreurs
                WHERE disponible = true
                ORDER BY commandes_livrees ASC
                LIMIT 1
            `);

            if (livreurResult.rows.length === 0) throw new Error("Aucun livreur disponible");

            const livreur = livreurResult.rows[0];
            const order = await this.updateStatus(orderId, 'ASSIGNED');

            const message = `
🛵 *NOUVELLE COMMANDE #${order.id}*

👤 *Client* : ${order.client_name} (${order.client_phone})
📍 *Adresse* : ${order.client_quartier}, San Pedro
📌 *Indications* : ${order.client_indications || 'Aucune'}
👶 *Patient* :
- Âge: ${order.patient_age || 'Non précisé'}
- Genre: ${order.patient_genre || 'Non précisé'}
- Poids: ${order.patient_poids || 'Non précisé'} kg
- Taille: ${order.patient_taille || 'Non précisé'} cm

📦 *Articles* :
${order.items.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n')}

💰 *Total à encaisser* : ${order.total} FCFA

✅ *Comment procéder* :
1. Récupère la commande à la pharmacie.
2. Livre au client.
3. **Demande au client le code de confirmation** qu'il a reçu.
4. **Envoie-moi (support) les informations suivantes par message** :
   - *ID de la commande* : ${order.id}
   - *Code de confirmation* : [celui donné par le client]
   - *Nom du client* : ${order.client_name}
   - *Téléphone du client* : ${order.client_phone}
            `;

            await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);
            return { success: true, order, livreur };
        } catch (error) {
            log('ERROR', `Erreur assignation livreur: ${error.message}`);
            return { success: false, error: error.message };
        } finally {
            client.release();
        }
    }
}

// ===========================================
// GESTION DES CONVERSATIONS
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
}

// ===========================================
// GESTION DES BOUTONS
// ===========================================
class ButtonHandler {
    constructor(whatsapp, orders, convManager) {
        this.whatsapp = whatsapp;
        this.orders = orders;
        this.convManager = convManager;
    }

    async handle(phone, buttonText, orderId) {
        if (buttonText === BUTTONS.VALIDATE_DELIVERY) {
            await this.handleValidateDelivery(phone, orderId);
        } else if (buttonText === BUTTONS.CANCEL_ORDER) {
            await this.handleCancelOrder(phone, orderId);
        }
    }

    async handleValidateDelivery(phone, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) {
            await this.whatsapp.sendMessage(phone, `❌ Commande ${orderId} introuvable.`);
            return;
        }

        if (order.status !== 'ASSIGNED') {
            await this.whatsapp.sendMessage(phone, `⚠️ La commande #${orderId} n'est pas en cours de livraison.`);
            return;
        }

        await this.orders.updateStatus(orderId, 'DELIVERED');
        const livreur = await pool.query(`
            SELECT telephone, whatsapp FROM livreurs
            WHERE telephone = (SELECT livreur_phone FROM orders WHERE id = $1)
            LIMIT 1
        `, [orderId]);

        if (livreur.rows.length > 0) {
            await this.whatsapp.sendMessage(livreur.rows[0].whatsapp || livreur.rows[0].telephone,
                `✅ *Livraison validée* pour la commande ${orderId} !\n` +
                `💰 Montant perçu : ${order.total} FCFA\n` +
                `📌 Tu es maintenant disponible.`
            );
        }

        await this.whatsapp.sendMessage(order.client_phone,
            `🎉 *Commande #${orderId} livrée avec succès !*\n\n` +
            `Merci d'avoir choisi MARIAM ! 😊\n` +
            `À bientôt !`
        );

        await this.whatsapp.sendMessage(phone,
            `✅ *Livraison #${orderId} validée avec succès !*\n` +
            `👤 Client : ${order.client_name}\n` +
            `📍 Adresse : ${order.client_quartier}\n` +
            `💰 Montant : ${order.total} FCFA`
        );
    }

    async handleCancelOrder(phone, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) {
            await this.whatsapp.sendMessage(phone, `❌ Commande ${orderId} introuvable.`);
            return;
        }

        await this.orders.updateStatus(orderId, 'CANCELED');
        await this.whatsapp.sendMessage(order.client_phone,
            `❌ *Commande #${order.id} annulée.*\n\n` +
            `Désolé pour ce contretemps. Tu peux repasser une commande quand tu veux !`
        );

        await this.whatsapp.sendMessage(phone,
            `❌ *Commande #${orderId} annulée.*\n` +
            `👤 Client notifié.`
        );
    }
}

// ===========================================
// MOTEUR PRINCIPAL
// ===========================================
class MariamBot {
    constructor() {
        this.whatsapp = new WhatsAppService();
        this.vision = new VisionService();
        this.search = new SearchService();
        this.orders = new OrderService(this.whatsapp);
        this.convManager = new ConversationManager();
        this.buttons = new ButtonHandler(this.whatsapp, this.orders, this.convManager);
        this.nlp = null;
    }

    async initialize() {
        await this.search.initialize();
        await this.initDatabase();
        await this.initializeNLP();
    }

    async initDatabase() {
        await pool.query(`
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

            CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
        `);
    }

    async initializeNLP() {
        const modelPath = path.join(__dirname, 'model.nlp');
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Modèle NLP introuvable: ${modelPath}`);
        }
        this.nlp = new NlpManager({ languages: ['fr'] });
        await this.nlp.load(modelPath);
    }

    extractEntities(entities) {
        const result = {};
        entities.forEach(e => {
            if (e.entity === 'medicine' || e.entity === 'medicament') result.medicine = e.sourceText || e.option;
            if (e.entity === 'quantity' || e.entity === 'number') result.quantity = parseInt(e.sourceText) || 1;
            if (e.entity === 'quartier') result.quartier = e.sourceText;
        });
        return result;
    }

    async process(phone, text, mediaId = null) {
        try {
            let conv = await this.convManager.get(phone);
            const context = { nom: conv.context?.client_nom };

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
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.FIRST_INTERACTION, nom));
                conv.history = [{ role: 'bot', message: 'première_interaction', time: new Date() }];
                await this.convManager.update(phone, { history: conv.history });
                return;
            }

            if (mediaId) {
                await this.whatsapp.sendMessage(phone, "📸 Analyse de ton image en cours...");
                await this.handleImage(phone, mediaId, conv);
                return;
            }

            await this.whatsapp.sendTyping(phone);
            const nlpResult = await this.nlp.process('fr', text);
            const entities = this.extractEntities(nlpResult.entities || []);

            if (conv.state && conv.state !== 'IDLE') {
                await this.handleState(phone, text, conv, nlpResult);
            } else {
                await this.handleIntent(phone, conv, nlpResult, entities);
            }

            conv.history.push({ type: 'user', text, intent: nlpResult.intent, timestamp: new Date() });
            await this.convManager.update(phone, { history: conv.history });
        } catch (error) {
            console.error(`Erreur traitement: ${error.message}`);
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
        }
    }

    async handleIntent(phone, conv, nlpResult, entities) {
        const intent = nlpResult.intent;
        const context = { nom: conv.context?.client_nom };

        switch(intent) {
            case 'greet':
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.GREETINGS, context.nom));
                break;
            case 'search_medicine':
                const medicine = entities.medicine || nlpResult.utterance || text;
                const results = await this.search.search(medicine);
                if (results.length === 0) {
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.NOT_FOUND(medicine)));
                    return;
                }
                conv.context.search_results = results;
                conv.state = 'SELECTING_MEDICINE';
                await this.convManager.update(phone, { state: 'SELECTING_MEDICINE', context: conv.context });
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.MEDICINE_SELECTION, results, medicine));
                break;
            case 'order_medicine':
            case 'add_to_cart':
                const medName = entities.medicine || nlpResult.utterance || text;
                const qty = entities.quantity || 1;
                const meds = await this.search.search(medName, 1);
                if (meds.length === 0) {
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.NOT_FOUND(medName)));
                    return;
                }
                const med = meds[0];
                if (!conv.cart) conv.cart = [];
                conv.cart.push({ ...med, quantite: qty });
                await this.convManager.update(phone, { cart: conv.cart });
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ADDED_TO_CART, qty, med.nom_commercial, med.prix * qty, context.nom));
                break;
            case 'provide_quartier':
                const quartierValidation = { valid: true, quartier: text };
                if (!quartierValidation.valid) {
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.VALIDATION_ERRORS.QUARTIER));
                    return;
                }
                conv.context.client_quartier = quartierValidation.quartier;
                conv.state = 'WAITING_VILLE';
                await this.convManager.update(phone, { state: 'WAITING_VILLE', context: conv.context });
                await this.whatsapp.sendMessage(phone, `📍 "${quartierValidation.quartier}" enregistré !\nC'est bien à San Pedro ? (oui/non)`);
                break;
            case 'provide_name':
                const nameValidation = Utils.validateName(text);
                if (nameValidation.valid) {
                    conv.context.client_nom = nameValidation.name;
                    await this.convManager.update(phone, { context: conv.context });
                    conv.state = 'WAITING_AGE';
                    await this.convManager.update(phone, { state: 'WAITING_AGE' });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_AGE, context.nom));
                }
                break;
            case 'provide_age':
                const ageValidation = Utils.validateAge(text);
                if (ageValidation.valid) {
                    conv.context.patient_age = ageValidation.age;
                    await this.convManager.update(phone, { context: conv.context });
                    conv.state = 'WAITING_GENDER';
                    await this.convManager.update(phone, { state: 'WAITING_GENDER' });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_GENDER, context.nom));
                }
                break;
            case 'provide_gender':
                const genderValidation = Utils.validateGender(text);
                if (genderValidation.valid) {
                    conv.context.patient_genre = genderValidation.gender;
                    await this.convManager.update(phone, { context: conv.context });
                    conv.state = 'WAITING_WEIGHT';
                    await this.convManager.update(phone, { state: 'WAITING_WEIGHT' });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_WEIGHT, context.nom));
                }
                break;
            case 'provide_weight':
                const weightValidation = Utils.validateWeight(text);
                if (weightValidation.valid) {
                    conv.context.patient_poids = weightValidation.weight;
                    await this.convManager.update(phone, { context: conv.context });
                    conv.state = 'WAITING_HEIGHT';
                    await this.convManager.update(phone, { state: 'WAITING_HEIGHT' });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_HEIGHT, context.nom));
                }
                break;
            case 'provide_height':
                const heightValidation = Utils.validateHeight(text);
                if (heightValidation.valid) {
                    conv.context.patient_taille = heightValidation.height;
                    await this.convManager.update(phone, { context: conv.context });
                    conv.state = 'WAITING_PHONE';
                    await this.convManager.update(phone, { state: 'WAITING_PHONE' });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_PHONE, context.nom));
                }
                break;
            default:
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
        }
    }

    async handleState(phone, text, conv, nlpResult) {
        const context = { nom: conv.context?.client_nom };

        switch(conv.state) {
            case 'WAITING_VILLE':
                if (text.toLowerCase().includes('san pedro') || text.toLowerCase().includes('oui')) {
                    conv.context.client_ville = 'San Pedro';
                    conv.state = 'WAITING_NAME';
                    await this.convManager.update(phone, { state: 'WAITING_NAME', context: conv.context });
                    if (conv.context.client_nom) {
                        conv.state = 'WAITING_AGE';
                        await this.convManager.update(phone, { state: 'WAITING_AGE' });
                        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_AGE, context.nom));
                    } else {
                        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_NAME, context.nom));
                    }
                }
                break;
            case 'WAITING_NAME':
                const nameValidation = Utils.validateName(text);
                if (nameValidation.valid) {
                    conv.context.client_nom = nameValidation.name;
                    conv.state = 'WAITING_AGE';
                    await this.convManager.update(phone, { state: 'WAITING_AGE', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_AGE, context.nom));
                }
                break;
            case 'WAITING_AGE':
                const ageValidation = Utils.validateAge(text);
                if (ageValidation.valid) {
                    conv.context.patient_age = ageValidation.age;
                    conv.state = 'WAITING_GENDER';
                    await this.convManager.update(phone, { state: 'WAITING_GENDER', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_GENDER, context.nom));
                }
                break;
            case 'WAITING_GENDER':
                const genderValidation = Utils.validateGender(text);
                if (genderValidation.valid) {
                    conv.context.patient_genre = genderValidation.gender;
                    conv.state = 'WAITING_WEIGHT';
                    await this.convManager.update(phone, { state: 'WAITING_WEIGHT', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_WEIGHT, context.nom));
                }
                break;
            case 'WAITING_WEIGHT':
                const weightValidation = Utils.validateWeight(text);
                if (weightValidation.valid) {
                    conv.context.patient_poids = weightValidation.weight;
                    conv.state = 'WAITING_HEIGHT';
                    await this.convManager.update(phone, { state: 'WAITING_HEIGHT', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_HEIGHT, context.nom));
                }
                break;
            case 'WAITING_HEIGHT':
                const heightValidation = Utils.validateHeight(text);
                if (heightValidation.valid) {
                    conv.context.patient_taille = heightValidation.height;
                    conv.state = 'WAITING_PHONE';
                    await this.convManager.update(phone, { state: 'WAITING_PHONE', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_PHONE, context.nom));
                }
                break;
            case 'WAITING_PHONE':
                const phoneValidation = Utils.validatePhone(text);
                if (phoneValidation.valid) {
                    conv.context.client_telephone = phoneValidation.phone;
                    conv.state = 'WAITING_INDICATIONS';
                    await this.convManager.update(phone, { state: 'WAITING_INDICATIONS', context: conv.context });
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_INDICATIONS, context.nom));
                }
                break;
            case 'WAITING_INDICATIONS':
                conv.context.client_indications = text.toLowerCase() === 'non' ? '' : text;
                conv.state = 'WAITING_CONFIRMATION';
                await this.convManager.update(phone, { state: 'WAITING_CONFIRMATION', context: conv.context });
                const summary = Utils.randomMessage(MESSAGES.ORDER_SUMMARY, conv, context);
                await this.whatsapp.sendInteractiveButtons(phone, summary, [
                    BUTTONS.CONFIRM,
                    BUTTONS.MODIFY,
                    BUTTONS.CANCEL
                ]);
                break;
            case 'WAITING_IMAGE_SELECTION':
                if (text.toLowerCase() === 'aucun') {
                    await this.whatsapp.sendMessage(phone, "❌ Commande annulée. Envoie une nouvelle image ou écris le nom.");
                    conv.state = 'IDLE';
                    await this.convManager.update(phone, { state: 'IDLE' });
                    return;
                }
                if (text.toLowerCase() === 'tout') {
                    for (const med of conv.context.pending_image_options) {
                        if (!conv.cart) conv.cart = [];
                        conv.cart.push({ ...med, quantite: 1 });
                    }
                    await this.whatsapp.sendMessage(phone, `✅ Tous les médicaments ajoutés !\n${conv.cart.map(item => `• ${item.quantite}x ${item.nom_commercial}`).join('\n')}`);
                    conv.state = 'IDLE';
                    delete conv.context.pending_image_options;
                    await this.convManager.update(phone, { state: 'IDLE', cart: conv.cart, context: conv.context });
                    return;
                }
                let choice = parseInt(text);
                if (choice && choice > 0 && choice <= conv.context.pending_image_options.length) {
                    const selectedMed = conv.context.pending_image_options[choice - 1];
                    if (!conv.cart) conv.cart = [];
                    conv.cart.push({ ...selectedMed, quantite: 1 });
                    await this.whatsapp.sendMessage(phone, `✅ ${selectedMed.nom_commercial} ajouté !`);
                    conv.state = 'WAITING_QUANTITY_ADJUST';
                    conv.context.pending_medicament = selectedMed;
                    await this.convManager.update(phone, { state: 'WAITING_QUANTITY_ADJUST', cart: conv.cart, context: conv.context });
                } else {
                    await this.whatsapp.sendMessage(phone, `❌ Choix invalide. Réponds avec un numéro entre 1 et ${conv.context.pending_image_options.length}.`);
                }
                break;
            default:
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
        }
    }

    async handleImage(phone, mediaId, conv) {
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Impossible de télécharger l'image. Réessaie.");
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        if (!visionResult.success) {
            await this.whatsapp.sendMessage(phone, `❌ ${visionResult.error}\n💡 Essaie avec une autre image.`);
            return;
        }

        if (!visionResult.medicines || visionResult.medicines.length === 0) {
            await this.whatsapp.sendMessage(phone, "🔍 Aucun médicament détecté. Essaie avec une photo plus nette ou écris le nom.");
            return;
        }

        const searchResults = await this.vision.searchDetectedMedicines(visionResult.medicines);
        if (searchResults.length === 0) {
            await this.whatsapp.sendMessage(phone, "🔍 Aucun médicament trouvé en stock pour cette image. Essaie avec une autre photo ou écris le nom.");
            return;
        }

        let message = `🔍 *Résultats pour ton image* (${visionResult.type === 'prescription' ? 'ordonnance' : 'boîte'}) :\n\n`;
        let options = [];
        for (let i = 0; i < searchResults.length; i++) {
            const result = searchResults[i];
            message += `${i+1}. *${result.matches[0].nom_commercial}*\n`;
            message += `   - Prix: ${result.matches[0].prix} FCFA\n`;
            message += `   - Confiance: ${Math.round(result.detected.confidence * 100)}%\n\n`;
            options.push(result.matches[0]);
        }

        message += `👉 Réponds avec le *numéro* du médicament à commander\nou "tout" pour tout ajouter, "aucun" pour annuler.`;

        await this.whatsapp.sendMessage(phone, message);
        conv.context.pending_image_options = options;
        conv.state = 'WAITING_IMAGE_SELECTION';
        await this.convManager.update(phone, { state: 'WAITING_IMAGE_SELECTION', context: conv.context });
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
        await new WhatsAppService().markAsRead(msg.id);

        const bot = new MariamBot();
        await bot.initialize();

        if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
            const buttonText = msg.interactive.button_reply.title;
            const orderId = msg.interactive.button_reply.id.split('_')[2];
            await bot.buttons.handle(SUPPORT_PHONE, buttonText, orderId);
            return;
        }

        if (msg.type === 'image') {
            const conv = await bot.convManager.get(msg.from);
            await bot.process(msg.from, null, msg.image.id);
            return;
        }

        if (msg.type === 'text') {
            const conv = await bot.convManager.get(msg.from);
            await bot.process(msg.from, msg.text.body.trim(), null);
        }
    } catch (error) {
        console.error(`Webhook error: ${error.message}`);
    }
});

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        const bot = new MariamBot();
        await bot.initialize();

        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Serveur démarré sur le port ${PORT}`);
        });

        process.on('SIGTERM', () => server.close(() => process.exit(0)));
        process.on('SIGINT', () => server.close(() => process.exit(0)));
    } catch (error) {
        console.error(`❌ Erreur fatale: ${error.message}`);
        process.exit(1);
    }
}

start();
