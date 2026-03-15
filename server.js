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
    levels: winston.config.npm.levels,
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
📍 *Zone de livraison : San Pedro uniquement*`
    ],

    ASK_QUARTIER: [
        (nom) => `📍 ${nom || 'Ton'} quartier à San Pedro ?`,
        (nom) => `📍 Où te livrer ${nom || ''} ? (quartier)`,
        (nom) => `📍 Quartier de livraison ${nom || ''} ?`
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

    ADDED_TO_CART: (qty, med, total, nom) => [
        `✅ *Ajouté !* 📦 ${qty}x ${med} pour ${total} FCFA.\n${nom ? `${nom}, ` : ''}Tu veux autre chose ?`,
        `🎉 *C’est noté !* ${qty}x ${med} ajouté(e)s à ton panier (${total} FCFA).\n👉 Dis-moi si tu veux continuer !`,
        `✅ *Parfait !* ${qty}x ${med} = ${total} FCFA.\n${nom ? `${nom}, ` : ''}On ajoute autre chose ? 😊`
    ],

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
            📱 Le livreur t’appellera sur ${order.client_phone}.`
        ];
    },

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

    NOTIFICATIONS: {
        ORDER_CREATED: (order) => [
            `📦 *NOUVELLE COMMANDE #${order.id}*
            👤 *Client* : ${order.client_name} (${order.client_phone})
            📍 *Livraison* : ${order.client_quartier}, San Pedro
            👶 *Patient* :
            - Âge: ${order.patient_age || 'Non précisé'}
            - Poids: ${order.patient_poids || 'Non précisé'} kg
            📦 *Articles* :
            ${order.items.map(item => `   • ${item.quantite}x ${item.nom_commercial}`).join('\n')}
            💰 *Total* : ${order.total} FCFA
            🔑 *Code* : ${order.confirmation_code}`
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

    static validatePhone(phone) {
        if (!phone) return { valid: false, error: "Le numéro est requis." };
        const clean = this.formatPhone(phone);
        const isValid = (clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean)) ||
                       (clean.length === 12 && clean.startsWith('225') && /^(07|01|05)\d{8}$/.test(clean.substring(3)));
        if (!isValid) return { valid: false, error: "Numéro invalide. Format : 07XXXXXXXX." };
        return { valid: true, phone: clean.length === 12 ? clean.substring(3) : clean };
    }

    static validateName(name) {
        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return { valid: false, error: "Le nom doit faire au moins 2 caractères." };
        }
        return { valid: true, name: name.trim() };
    }

    static validateAge(age) {
        if (!age || isNaN(age)) return { valid: false, error: "L'âge doit être un nombre." };
        const ageNum = parseInt(age);
        if (ageNum < 1 || ageNum > 120) return { valid: false, error: "L'âge doit être entre 1 et 120 ans." };
        return { valid: true, age: ageNum };
    }

    static generateOrderId() {
        const date = new Date();
        return `CMD${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    }

    static generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000)); // Code à 6 chiffres
    }

    static getDeliveryPrice() {
        return { price: DELIVERY_CONFIG.PRICES.DAY, period: 'DAY', message: '☀️ Jour' };
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

// ===========================================
// CACHE
// ===========================================
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const processedMessages = new NodeCache({ stdTTL: 600 });

// ===========================================
// SERVICE DE RECHERCHE (Corrigé)
// ===========================================
class SearchService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600 });
    }

    async initialize() {
        // Requête corrigée : fonctionne même sans colonne "disponible"
        const result = await pool.query(`
            SELECT code_produit, nom_commercial, dci, prix, categorie
            FROM medicaments
            LIMIT 1000
        `);
        this.medicaments = result.rows.map(med => ({
            ...med,
            searchable: `${med.nom_commercial} ${med.dci || ''} ${med.categorie || ''}`.toLowerCase()
        }));
        this.fuse = new Fuse(this.medicaments, {
            keys: ['nom_commercial', 'dci', 'searchable'],
            threshold: 0.4
        });
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];
        const cacheKey = `search:${query}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        const results = this.fuse.search(query)
            .slice(0, limit)
            .map(r => r.item);

        this.cache.set(cacheKey, results);
        return results;
    }
}

// ===========================================
// SERVICE VISION (GROQ) OPTIMISÉ
// ===========================================
class VisionService {
    constructor() {
        this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
        this.model = VISION_MODEL;
    }

    async analyzeImage(imageBuffer) {
        if (!this.client) return { success: false, error: "Service Groq non configuré" };

        try {
            const base64Image = imageBuffer.toString('base64');
            if (base64Image.length > 4 * 1024 * 1024) {
                return { success: false, error: "Image trop grande (max 4MB)" };
            }

            const prompt = `
            Tu es MARIAM-VISION, un assistant médical spécialisé dans l'analyse d'images de:
            1. Boîtes de médicaments (nom commercial, dosage, forme galénique)
            2. Ordonnances médicales (liste des médicaments prescrits)

            **Instructions strictes**:
            - Pour les boîtes: extrais NOM COMMERCIAL, DOSAGE, FORME (comprimé/gélule/etc.)
            - Pour les ordonnances: liste TOUS les médicaments avec leurs dosages
            - Retourne UNIQUEMENT un JSON valide avec cette structure:
            {
              "type": "box|prescription|unknown",
              "medicines": [
                {
                  "name": "NOM_EXACT_DU_MÉDICAMENT",
                  "dosage": "DOSAGE_EXACT (ex: 500mg)",
                  "form": "FORME (ex: comprimé)",
                  "confidence": 0.0-1.0
                }
              ],
              "count": NOMBRE_DE_MÉDICAMENTS
            }
            - Si l'image ne contient pas de médicament: retourne {"type": "unknown"}
            - Utilise toujours le français pour les noms de médicaments
            - Sois extrêmement précis sur les noms (ex: "DOLIPRANE 500mg" et non "paracétamol")
            `;

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

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            console.error("Erreur Groq Vision:", error);
            return { type: "unknown", error: "Échec de l'analyse" };
        }
    }
}

// ===========================================
// SERVICE WHATSAPP
// ===========================================
class WhatsAppService {
    async sendMessage(to, text) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text.substring(0, 4096) }
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            return true;
        } catch (error) {
            console.error("Erreur WhatsApp:", error.message);
            return false;
        }
    }

    async sendInteractiveButtons(to, text, buttons) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
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
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            return true;
        } catch (error) {
            console.error("Erreur boutons:", error.message);
            return false;
        }
    }

    async downloadMedia(mediaId) {
        try {
            const media = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            const file = await axios.get(media.data.url, {
                responseType: 'arraybuffer'
            });
            return { success: true, buffer: Buffer.from(file.data) };
        } catch (error) {
            return { success: false, error: error.message };
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
            status: 'PENDING',
            created_at: new Date()
        };

        await pool.query(`
            INSERT INTO orders (
                id, client_name, client_phone, client_quartier, client_ville,
                patient_age, patient_genre, patient_poids, patient_taille,
                items, subtotal, delivery_price, service_fee, total,
                confirmation_code, status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
            order.id, order.client_name, order.client_phone, order.client_quartier,
            order.client_ville, order.patient_age, order.patient_genre,
            order.patient_poids, order.patient_taille, JSON.stringify(order.items),
            order.subtotal, order.delivery_price, order.service_fee, order.total,
            order.confirmation_code, order.status, order.created_at
        ]);

        return order;
    }
}

// ===========================================
// GESTION DES CONVERSATIONS
// ===========================================
class ConversationManager {
    async get(phone) {
        const cacheKey = `conv:${phone}`;
        let conv = cache.get(cacheKey);
        if (conv) return conv;

        const result = await pool.query(`
            SELECT * FROM conversations WHERE phone = $1
        `, [phone]);

        if (result.rows.length === 0) {
            const newConv = await pool.query(`
                INSERT INTO conversations (phone, state, context, history)
                VALUES ($1, $2, $3, $4) RETURNING *
            `, [phone, ConversationStates.IDLE, '{}', '[]']);
            conv = newConv.rows[0];
        } else {
            conv = result.rows[0];
        }

        conv.context = typeof conv.context === 'string' ? JSON.parse(conv.context) : conv.context;
        conv.history = typeof conv.history === 'string' ? JSON.parse(conv.history) : conv.history;
        cache.set(cacheKey, conv, 300);
        return conv;
    }

    async update(phone, updates) {
        const sets = [];
        const values = [];
        let i = 1;

        if (updates.state) {
            sets.push(`state = $${i++}`);
            values.push(updates.state);
        }
        if (updates.context) {
            sets.push(`context = $${i++}`);
            values.push(JSON.stringify(updates.context));
        }
        if (updates.history) {
            sets.push(`history = $${i++}`);
            values.push(JSON.stringify(updates.history));
        }

        await pool.query(`
            UPDATE conversations SET ${sets.join(', ')} WHERE phone = $${i}
        `, [...values, phone]);

        cache.del(`conv:${phone}`);
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
    }

    async initialize() {
        await this.search.initialize();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                phone VARCHAR(20) PRIMARY KEY,
                state VARCHAR(50) DEFAULT 'IDLE',
                context JSONB DEFAULT '{}',
                history JSONB DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(50) PRIMARY KEY,
                client_name VARCHAR(100),
                client_phone VARCHAR(20),
                client_quartier VARCHAR(100),
                client_ville VARCHAR(100) DEFAULT 'San Pedro',
                patient_age INTEGER,
                patient_genre VARCHAR(1),
                patient_poids INTEGER,
                patient_taille INTEGER,
                items JSONB NOT NULL,
                subtotal DECIMAL(10, 2) NOT NULL,
                delivery_price DECIMAL(10, 2) NOT NULL,
                service_fee DECIMAL(10, 2) NOT NULL,
                total DECIMAL(10, 2) NOT NULL,
                confirmation_code VARCHAR(20),
                status VARCHAR(50) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
    }

    async process(phone, text, mediaId = null) {
        try {
            let conv = await this.convManager.get(phone);

            if (!conv.history || conv.history.length === 0) {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.GREETINGS));
                conv.history = [{ role: 'bot', message: 'première_interaction', time: new Date() }];
                await this.convManager.update(phone, { history: conv.history });
                return;
            }

            if (mediaId) {
                await this.handleImage(phone, mediaId, conv);
                return;
            }

            // Gestion des commandes textuelles (simplifiée pour l'exemple)
            if (text.toLowerCase().includes('doliprane')) {
                const results = await this.search.search('doliprane');
                if (results.length > 0) {
                    const med = results[0];
                    await this.whatsapp.sendMessage(phone, `✅ 1x ${med.nom_commercial} ajouté pour ${med.prix} FCFA !`);
                }
            }
        } catch (error) {
            console.error("Erreur traitement:", error);
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
        }
    }

    async handleImage(phone, mediaId, conv) {
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Impossible de télécharger l'image. Réessaie avec une photo plus petite (max 4MB).");
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        if (!visionResult || visionResult.type === 'unknown') {
            await this.whatsapp.sendMessage(phone, "🔍 Aucun médicament détecté. Essaie avec une photo plus nette ou écris le nom du médicament.");
            return;
        }

        if (visionResult.medicines.length === 0) {
            await this.whatsapp.sendMessage(phone, "🔍 Aucune information médicale trouvée. Envoie une photo claire d'une boîte de médicament ou d'une ordonnance.");
            return;
        }

        let message = `💊 *Résultats pour ton image* (${visionResult.type}):\n\n`;
        for (let i = 0; i < visionResult.medicines.length; i++) {
            const med = visionResult.medicines[i];
            const dbResults = await this.search.search(med.name, 1);
            message += `${i+1}. *${med.name}* (${med.dosage || 'dosage inconnu'})\n`;
            message += `   - Forme: ${med.form || 'non spécifiée'}\n`;
            message += `   - Confiance: ${Math.round(med.confidence * 100)}%\n`;
            if (dbResults.length > 0) {
                message += `   - 💰 Prix: ${dbResults[0].prix} FCFA (disponible)\n`;
            } else {
                message += `   - ⚠️ Non disponible en stock\n`;
            }
            message += '\n';
        }

        message += `👉 Réponds avec le *numéro* du médicament à ajouter au panier\nou "tout" pour tout ajouter, "aucun" pour annuler.`;

        await this.whatsapp.sendMessage(phone, message);
    }
}

// ===========================================
// EXPRESS APP
// ===========================================
const app = express();
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

// Webhook WhatsApp
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
        const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (!msg) return;

        const bot = new MariamBot();
        await bot.initialize();

        if (msg.type === 'image') {
            const conv = await bot.convManager.get(msg.from);
            await bot.handleImage(msg.from, msg.image.id, conv);
        } else if (msg.type === 'text') {
            const conv = await bot.convManager.get(msg.from);
            await bot.process(msg.from, msg.text.body, null);
        }
    } catch (error) {
        console.error("Erreur webhook:", error);
    }
});

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        const bot = new MariamBot();
        await bot.initialize();

        app.listen(PORT, () => {
            console.log(`🚀 Serveur démarré sur le port ${PORT}`);
        });
    } catch (error) {
        console.error("Erreur fatale:", error);
        process.exit(1);
    }
}

start();
