require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const Fuse = require('fuse.js');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// ===========================================
// CONFIGURATION
// ===========================================
const PORT = process.env.PORT || 10000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Configuration livraison (frais de service supprimés)
const DELIVERY_CONFIG = {
    PRICES: { DAY: 400, NIGHT: 600 },
    DELIVERY_TIME: 45,
    FREE_DELIVERY_THRESHOLD: 5000 // Seuil pour livraison gratuite
};

// États de conversation
const ConversationStates = {
    IDLE: 'IDLE',
    WAITING_MEDICINE: 'WAITING_MEDICINE',
    WAITING_QUANTITY: 'WAITING_QUANTITY',
    WAITING_SELECTION: 'WAITING_SELECTION',
    WAITING_QUARTIER: 'WAITING_QUARTIER',
    WAITING_NAME: 'WAITING_NAME',
    WAITING_AGE: 'WAITING_AGE',
    WAITING_PHONE: 'WAITING_PHONE',
    WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
    WAITING_MODIFICATION: 'WAITING_MODIFICATION',
    WAITING_MEDICINE_TO_EDIT: 'WAITING_MEDICINE_TO_EDIT',
    WAITING_QUANTITY_TO_EDIT: 'WAITING_QUANTITY_TO_EDIT',
    WAITING_INFO_TO_EDIT: 'WAITING_INFO_TO_EDIT'
};

// Cache pour éviter les doublons
const processedMessages = new NodeCache({ stdTTL: 600 });

// ===========================================
// LOGGER
// ===========================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

function log(level, message) {
    logger.log(level, message);
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on('error', (err) => log('error', `Erreur DB: ${err.message}`));

// ===========================================
// UTILS
// ===========================================
class Utils {
    static normalizeText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static extractNumber(text) {
        if (!text) return null;
        const match = text.match(/\d+/);
        return match ? parseInt(match[0], 10) : null;
    }

    static formatPhone(phone) {
        return phone?.toString().replace(/\D/g, '') || '';
    }

    static generateOrderId() {
        return `CMD${Date.now()}${Math.floor(Math.random() * 1000)}`;
    }

    static generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    static getDeliveryPrice() {
        const hour = new Date().getHours();
        const isNight = hour >= 0 && hour < 7;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'Nuit' : 'Jour',
            time: DELIVERY_CONFIG.DELIVERY_TIME
        };
    }

    static calculateTotal(cart) {
        const subtotal = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const delivery = this.getDeliveryPrice();
        const total = subtotal + delivery.price;
        return {
            subtotal,
            deliveryPrice: delivery.price,
            total,
            deliveryPeriod: delivery.period,
            deliveryTime: delivery.time,
            isFreeDelivery: subtotal >= DELIVERY_CONFIG.FREE_DELIVERY_THRESHOLD
        };
    }
}

// ===========================================
// VALIDATION SERVICE
// ===========================================
class ValidationService {
    static validate(field, value) {
        if (!value && value !== 0) return false;
        switch(field) {
            case 'nom':
                return value.trim().length >= 2 && /^[a-zA-ZÀ-ÿ\s-]+$/.test(value);
            case 'age':
                const age = parseInt(value, 10);
                return !isNaN(age) && age >= 1 && age <= 120;
            case 'telephone':
                const clean = value.replace(/\D/g, '');
                return clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean);
            case 'quartier':
                return value.trim().length >= 2;
            case 'quantite':
                const qty = parseInt(value, 10);
                return !isNaN(qty) && qty >= 1 && qty <= 10;
            default:
                return true;
        }
    }

    static getErrorMessage(field) {
        const messages = {
            'nom': "❌ *Nom invalide.*\n→ Utilise seulement des lettres (ex: *Jean Kouamé*).",
            'age': "❌ *Âge invalide.*\n→ Choisis un nombre entre 1 et 120.",
            'telephone': "❌ *Numéro invalide.*\n→ Format attendu: *0712345678*.",
            'quartier': "❌ *Quartier invalide.*\n→ Précise ton quartier à San Pedro (ex: *Cité*).",
            'quantite': "❌ *Quantité invalide.*\n→ Choisis un nombre entre 1 et 10."
        };
        return messages[field] || "❌ *Valeur invalide.*";
    }
}

// ===========================================
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    async sendMessage(to, text) {
        try {
            if (!text || typeof text !== 'string') {
                text = "Bonjour ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 *Quel médicament cherches-tu ?*";
            }
            const safeText = text.substring(0, 4096);
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: safeText }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 10000
            });
            return true;
        } catch (error) {
            log('error', `Erreur envoi: ${error.message}`);
            return false;
        }
    }

    async sendTyping(to) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'typing',
                typing: { action: 'typing', duration_ms: 3000 }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
        } catch (error) {}
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
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            return true;
        } catch (error) {
            log('error', `Erreur boutons: ${error.message}`);
            return false;
        }
    }

    async downloadMedia(mediaId) {
        try {
            const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } }
            );
            const fileResponse = await axios.get(mediaResponse.data.url, {
                responseType: 'arraybuffer',
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            return { success: true, buffer: Buffer.from(fileResponse.data) };
        } catch (error) {
            log('error', `Erreur téléchargement: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async markAsRead(messageId) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
        } catch (error) {}
    }
}

// ===========================================
// FUSE SERVICE - RECHERCHE MÉDICAMENTS
// ===========================================
class FuseService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600 });
    }

    async initialize() {
        log('info', 'Chargement des médicaments...');
        const result = await pool.query(`
            SELECT code_produit, nom_commercial, dci, prix, categorie
            FROM medicaments
        `);
        this.medicaments = result.rows.map(med => ({
            ...med,
            normalized: Utils.normalizeText(med.nom_commercial),
            searchable: `${med.nom_commercial} ${med.dci || ''}`.toLowerCase()
        }));
        this.fuse = new Fuse(this.medicaments, {
            keys: [
                { name: 'nom_commercial', weight: 0.8 },
                { name: 'dci', weight: 0.5 },
                { name: 'normalized', weight: 0.6 }
            ],
            threshold: 0.3,
            distance: 50,
            minMatchCharLength: 2,
            shouldSort: true,
            includeScore: true,
            ignoreLocation: true
        });
        log('info', `${this.medicaments.length} médicaments chargés`);
    }

    async search(query, limit = 5, threshold = 0.4) {
        if (!query || query.length < 2) return [];
        const cacheKey = `search:${Utils.normalizeText(query)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.slice(0, limit);
        const results = this.fuse.search(query)
            .filter(r => r.score < threshold)
            .slice(0, limit)
            .map(r => r.item);
        if (results.length > 0) this.cache.set(cacheKey, results);
        return results;
    }
}

// ===========================================
// LLM SERVICE - GROQ LLAMA-3.3-70B
// ===========================================
class LLMService {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = "https://api.groq.com/openai/v1";
        this.model = "llama-3.3-70b-versatile";
        this.cache = new NodeCache({ stdTTL: 300 });
    }

    getSystemPrompt(conv) {
        const context = conv?.context || {};
        const cart = conv?.cart || [];
        const lastMedicine = conv?.context?.lastMedicine?.name || 'aucun';
        return `Tu es MARIAM, une assistante santé virtuelle à San Pedro, Côte d'Ivoire.

        ⚠️ INSTRUCTIONS CRITIQUES ⚠️
        - Réponds UNIQUEMENT en JSON valide.
        - Utilise les champs "intention", "entites", et "reponse".
        - Si l'utilisateur demande un médicament, retourne une liste numérotée des résultats.
        - Guide l'utilisateur étape par étape jusqu'à la commande.

        ===========================================================
        CONTEXTE ACTUEL
        ===========================================================
        - État: ${conv?.state || 'IDLE'}
        - Panier: ${cart.length} article(s)
        - Dernier médicament: ${lastMedicine}

        ===========================================================
        INTENTIONS À DÉTECTER
        ===========================================================
        1. "greet" → Salutation (bonjour, salut, hey, cc)
        2. "question" → Question sur toi (qui es-tu, que fais-tu, comment tu peux m'aider)
        3. "help" → Demande d'aide (aide, aide-moi, que peux-tu faire)
        4. "search" → Recherche médicament (doliprane, amox)
        5. "order" → Commande avec quantité (je veux 2 doliprane)
        6. "add" → Ajout au panier (ajoute, mets dans panier)
        7. "cart" → Voir le panier (mon panier, voir panier)
        8. "checkout" → Passer commande (commander, finaliser)
        9. "info" → Donner info (j'habite à, je m'appelle, j'ai X ans)
        10. "confirm" → Confirmation (oui, d'accord, ok)
        11. "cancel" → Annulation (non, annuler)

        ===========================================================
        EXEMPLES PRÉCIS
        ===========================================================
        1. "salut" → {"intention":"greet", "reponse":"Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Quel médicament cherches-tu ?"}
        2. "qui es-tu ?" → {"intention":"question", "reponse":"Je suis MARIAM, ton assistante santé à San Pedro. Je peux t'aider à trouver des médicaments, répondre à tes questions sur la santé et te guider pour passer commande en ligne."}
        3. "aide" → {"intention":"help", "reponse":"Voici ce que je peux faire pour toi :\\n- Rechercher des médicaments (ex: \\"doliprane\\\")\\n- Ajouter des médicaments à ton panier\\n- Passer une commande\\n- Répondre à tes questions sur la santé\\n\\nTu peux commencer par me dire ce que tu cherches !"}
        4. "doliprane" → {"intention":"search", "entites":{"medicament":"doliprane"}, "reponse":"Je cherche le doliprane..."}
        5. "je veux 2 doliprane" → {"intention":"order", "entites":{"medicament":"doliprane", "quantite":2}, "reponse":"D'accord pour 2 doliprane. Je l'ajoute à ton panier."}
        6. "ajoute au panier" → {"intention":"add", "reponse":"Quel médicament veux-tu ajouter ?"}
        7. "mon panier" → {"intention":"cart", "reponse":"Voici ton panier : ..."}
        8. "commander" → {"intention":"checkout", "reponse":"Je prépare ta commande..."}
        9. "j'habite à cité" → {"intention":"info", "entites":{"champ":"quartier", "valeur":"cité"}, "reponse":"Quartier enregistré : Cité."}
        10. "oui" → {"intention":"confirm", "reponse":"Commande confirmée !"}
        11. "non" → {"intention":"cancel", "reponse":"Annulé."}`;
    }

    getHistory(conversation) {
        if (!conversation?.history) return [];
        return conversation.history
            .slice(-6)
            .map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            }));
    }

    async analyzeMessage(userMessage, conversation) {
        const cacheKey = `llm:${userMessage.substring(0, 50)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;
        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        { role: "system", content: this.getSystemPrompt(conversation) },
                        ...this.getHistory(conversation),
                        { role: "user", content: userMessage }
                    ],
                    temperature: 0.1,
                    max_tokens: 300,
                    response_format: { type: "json_object" }
                })
            });
            const data = await response.json();
            let content = data.choices[0].message.content;
            content = content.replace(/^```json\s*|\s*```$/g, '');
            const result = JSON.parse(content);
            this.cache.set(cacheKey, result);
            return result;
        } catch (error) {
            console.error('❌ Erreur LLM:', error);
            return this.fallbackResponse(userMessage);
        }
    }

    fallbackResponse(userMessage) {
        const lower = userMessage.toLowerCase();
        if (lower.match(/bonjour|salut|hey|cc/)) {
            return { intention: "greet", reponse: "Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 *Quel médicament cherches-tu ?*" };
        } else if (lower.match(/qui es-tu|qui es tu|tu es qui|présente toi/)) {
            return { intention: "question", reponse: "Je suis MARIAM, ton assistante santé à San Pedro. Je peux t'aider à trouver des médicaments, répondre à tes questions sur la santé et te guider pour passer commande en ligne." };
        } else if (lower.match(/aide|help|aide-moi|que peux-tu faire/)) {
            return { intention: "help", reponse: "Je peux t'aider à rechercher des médicaments, les ajouter à ton panier et passer commande. Essaie par exemple : *\"doliprane\"* ou *\"mon panier\"*." };
        } else if (lower.match(/mon panier|voir panier/)) {
            return { intention: "cart", reponse: "Ton panier est vide. Ajoute des médicaments avec leur nom." };
        } else {
            return { intention: "search", entites: { medicament: userMessage }, reponse: `Je cherche "${userMessage}"...` };
        }
    }
}

// ===========================================
// VISION SERVICE - GROQ LLAMA-4-SCOUT
// ===========================================
class VisionService {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = "https://api.groq.com/openai/v1";
        this.model = "meta-llama/llama-4-scout-17b-16e-instruct";
    }

    async analyzeImage(imageBuffer) {
        try {
            const base64Image = imageBuffer.toString('base64');
            const sizeInMB = base64Image.length / 1024 / 1024;
            if (sizeInMB > 4) {
                return { type: "inconnu", error: "L'image est trop grande (max 4MB)." };
            }
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: `Analyse cette image de médicament. Réponds en JSON avec:
                                    {
                                        "type": "boite|ordonnance|inconnu",
                                        "medicaments": [{"nom": "", "dosage": "", "forme": ""}],
                                        "confidence": 0.0-1.0
                                    }`
                                },
                                {
                                    type: "image_url",
                                    image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                                }
                            ]
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 500,
                    response_format: { type: "json_object" }
                })
            });
            const data = await response.json();
            const content = data.choices[0].message.content;
            const cleanContent = content.replace(/^```json\s*|\s*```$/g, '');
            return JSON.parse(cleanContent);
        } catch (error) {
            console.error('❌ Erreur vision:', error);
            return { type: "inconnu", error: "Erreur lors de l'analyse de l'image." };
        }
    }
}

// ===========================================
// ORDER SERVICE
// ===========================================
class OrderService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async createOrder(phone, cart, context, deliveryPrice) {
        if (!cart || cart.length === 0) throw new Error("Panier vide");
        const requiredFields = ['quartier', 'nom', 'age', 'telephone'];
        if (requiredFields.some(field => !context[field])) {
            throw new Error("Données client incomplètes");
        }
        const orderId = Utils.generateOrderId();
        const code = Utils.generateCode();
        const subtotal = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const total = subtotal + deliveryPrice;
        const order = {
            id: orderId,
            client_name: context.nom,
            client_phone: phone,
            client_quartier: context.quartier,
            client_ville: 'San Pedro',
            client_indications: context.indications || '',
            patient_age: context.age,
            patient_genre: context.genre,
            patient_poids: context.poids || null,
            patient_taille: context.taille || null,
            items: cart,
            subtotal,
            delivery_price: deliveryPrice,
            total,
            confirmation_code: code,
            delivery_period: Utils.getDeliveryPrice().period,
            status: 'PENDING'
        };
        await pool.query(`
            INSERT INTO orders (
                id, client_name, client_phone, client_quartier, client_ville,
                client_indications, patient_age, patient_genre, patient_poids,
                patient_taille, items, subtotal, delivery_price, total,
                confirmation_code, delivery_period, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
            order.id, order.client_name, order.client_phone, order.client_quartier,
            order.client_ville, order.client_indications, order.patient_age,
            order.patient_genre, order.patient_poids, order.patient_taille,
            JSON.stringify(order.items), order.subtotal, order.delivery_price,
            order.total, order.confirmation_code, order.delivery_period, order.status
        ]);
        return order;
    }

    async notifySupport(order) {
        const items = order.items.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
        const message = `📦 NOUVELLE COMMANDE #${order.id}
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
📦\n${items}
💰 TOTAL: ${order.total} FCFA (livraison incluse)
🔑 CODE: ${order.confirmation_code}`;
        await this.whatsapp.sendInteractiveButtons(SUPPORT_PHONE, message, [
            '✅ Valider livraison',
            '❌ Annuler commande'
        ]);
    }

    async assignLivreur(orderId) {
        const livreurResult = await pool.query(`
            SELECT id_livreur, nom, telephone, whatsapp
            FROM livreurs
            WHERE disponible = true
            ORDER BY commandes_livrees ASC
            LIMIT 1
        `);
        if (livreurResult.rows.length === 0) return { success: false };
        const livreur = livreurResult.rows[0];
        const order = await pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (order.rows.length === 0) return { success: false };
        const items = JSON.parse(order.rows[0].items).map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ');
        const message = `🛵 NOUVELLE LIVRAISON #${orderId}
👤 Client: ${order.rows[0].client_name} (${order.rows[0].client_phone})
📍 ${order.rows[0].client_quartier}
📦 ${items}
💰 ${order.rows[0].total} FCFA
🔑 CODE: ${order.rows[0].confirmation_code}`;
        await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);
        return { success: true, livreur };
    }
}

// ===========================================
// CONVERSATION MANAGER
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.whatsapp = new WhatsAppService();
        this.fuse = null;
        this.llm = null;
        this.vision = null;
        this.orders = null;
    }

    async init() {
        this.fuse = new FuseService();
        await this.fuse.initialize();
        this.llm = new LLMService();
        this.vision = new VisionService();
        this.orders = new OrderService(this.whatsapp);
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                state: ConversationStates.IDLE,
                cart: [],
                context: {},
                history: [],
                lastActivity: Date.now()
            });
        }
        return this.conversations.get(phone);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, mediaType } = input;
        try {
            await this.whatsapp.sendTyping(phone);
            if (text) {
                conv.history.push({ role: 'user', content: text, timestamp: Date.now() });
            }
            if (mediaType === 'audio') {
                await this.whatsapp.sendMessage(phone, "🎤 Désolé, je ne traite pas les messages vocaux. Envoie un texte ou une photo.");
                return;
            }
            if (mediaId) {
                await this.processImage(phone, mediaId, conv);
                return;
            }
            const analysis = await this.llm.analyzeMessage(text, conv);
            await this.handleIntention(phone, conv, analysis, text);
            conv.lastActivity = Date.now();
            this.conversations.set(phone, conv);
        } catch (error) {
            console.error('❌ Erreur process:', error);
            await this.whatsapp.sendMessage(phone, "Désolé, une erreur technique est survenue. Réessaie.");
        }
    }

    async processImage(phone, mediaId, conv) {
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Impossible de télécharger l'image. Réessaie.");
            return;
        }
        const analysis = await this.vision.analyzeImage(media.buffer);
        if (analysis.type === "boite" && analysis.medicaments.length > 0) {
            const medNames = analysis.medicaments.map(m => m.nom).join(", ");
            await this.whatsapp.sendMessage(phone, `📸 J'ai détecté : *${medNames}*.\n💡 Tu peux maintenant chercher ces médicaments par leur nom.`);
        } else if (analysis.type === "ordonnance") {
            await this.whatsapp.sendMessage(phone, "📄 Ordonnance détectée. Envoie-moi le *nom des médicaments* un par un pour les ajouter à ton panier.");
        } else {
            await this.whatsapp.sendMessage(phone, "❌ Je n'ai pas pu analyser cette image. Envoie une photo plus nette d'une boîte ou d'une ordonnance.");
        }
    }

    async handleIntention(phone, conv, analysis, originalText) {
        const { intention, entites, reponse } = analysis;
        await this.whatsapp.sendMessage(phone, reponse);
        conv.history.push({ role: 'assistant', content: reponse, timestamp: Date.now() });

        switch (intention) {
            case 'greet':
                conv.state = ConversationStates.IDLE;
                break;

            case 'question':
                conv.state = ConversationStates.IDLE;
                break;

            case 'help':
                conv.state = ConversationStates.IDLE;
                break;

            case 'search':
                if (entites.medicament) {
                    const delivery = Utils.getDeliveryPrice();
                    const results = await this.fuse.search(entites.medicament, 5);
                    if (results.length > 0) {
                        conv.context.searchResults = results;
                        conv.state = ConversationStates.WAITING_SELECTION;
                        const list = results.map((m, i) =>
                            `${i+1}. *${m.nom_commercial}* (${m.prix} FCFA/boîte)`
                        ).join('\n');
                        const message = `🔍 *Résultats pour "${entites.medicament}"* :
${list}

📌 *Frais de livraison* : ${delivery.price} FCFA (${delivery.period})
💡 *Réponds avec le numéro* (ex: *1*), ou envoie une *photo* de ton ordonnance.`;
                        await this.whatsapp.sendMessage(phone, message);
                    } else {
                        const suggestions = await this.fuse.search(entites.medicament, 3, 0.5);
                        let suggestionText = "";
                        if (suggestions.length > 0) {
                            suggestionText = `\n\n💡 *Tu cherches peut-être :*
${suggestions.slice(0, 3).map((m, i) => `${i+1}. ${m.nom_commercial}`).join('\n')}`;
                        }
                        await this.whatsapp.sendMessage(phone, `❌ *"${entites.medicament}" introuvable.*${suggestionText}`);
                    }
                }
                break;

            case 'select':
                if (conv.context.searchResults) {
                    const selectedIndex = Utils.extractNumber(originalText) - 1;
                    if (selectedIndex >= 0 && selectedIndex < conv.context.searchResults.length) {
                        const selectedMed = conv.context.searchResults[selectedIndex];
                        conv.context.pendingMedicine = selectedMed;
                        conv.state = ConversationStates.WAITING_QUANTITY;
                        const delivery = Utils.getDeliveryPrice();
                        await this.whatsapp.sendMessage(phone,
                            `💊 *Tu as sélectionné* : *${selectedMed.nom_commercial}* (${selectedMed.prix} FCFA/boîte)
🚚 *Frais de livraison* : ${delivery.price} FCFA (${delivery.period})

📌 *Combien de boîtes veux-tu ?* (1-10)
→ Réponds avec un *nombre* (ex: *2*).`);
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            `❌ *"${originalText}" n'est pas un numéro valide.
📌 *Choisis un numéro entre 1 et ${conv.context.searchResults.length}.*`);
                    }
                }
                break;

            case 'add':
                if (conv.context.pendingMedicine) {
                    const med = conv.context.pendingMedicine;
                    const qty = Utils.extractNumber(originalText) || 1;
                    if (qty < 1 || qty > 10) {
                        await this.whatsapp.sendMessage(phone,
                            `❌ *Quantité invalide* (${qty}).
📌 *Choisis un nombre entre 1 et 10.*`);
                        return;
                    }
                    if (!conv.cart) conv.cart = [];
                    const existing = conv.cart.find(item => item.code_produit === med.code_produit);
                    if (existing) {
                        existing.quantite += qty;
                        await this.whatsapp.sendMessage(phone,
                            `✅ *Mise à jour* : ${existing.quantite}x *${med.nom_commercial}* dans ton panier.`);
                    } else {
                        conv.cart.push({ ...med, quantite: qty });
                        await this.whatsapp.sendMessage(phone,
                            `✅ *${qty}x ${med.nom_commercial}* ajouté à ton panier !
🛒 *Pour voir ton panier*, envoie *mon panier*.`);
                    }
                    delete conv.context.pendingMedicine;
                    conv.state = ConversationStates.IDLE;
                }
                break;

            case 'cart':
                await this.showCart(phone, conv);
                break;

            case 'checkout':
                await this.startCheckout(phone, conv);
                break;

            case 'info':
                if (entites.champ && entites.valeur) {
                    if (ValidationService.validate(entites.champ, entites.valeur)) {
                        conv.context[entites.champ] = ValidationService.normalize(entites.champ, entites.valeur);
                        await this.whatsapp.sendMessage(phone, `✅ *${entites.champ}* enregistré : *${entites.valeur}*.`);
                        if (entites.champ === 'quartier') {
                            await this.startCheckout(phone, conv);
                        }
                    } else {
                        await this.whatsapp.sendMessage(phone, ValidationService.getErrorMessage(entites.champ));
                    }
                }
                break;

            case 'confirm':
                if (conv.state === ConversationStates.WAITING_CONFIRMATION) {
                    if (originalText.toUpperCase() === 'OUI') {
                        await this.placeOrder(phone, conv);
                    } else if (originalText.toUpperCase() === 'NON') {
                        await this.whatsapp.sendMessage(phone,
                            `🔙 *Que veux-tu modifier ?*
→ *1* : Changer un médicament
→ *2* : Changer la quantité
→ *3* : Changer mes infos (quartier, nom, etc.)
→ *4* : Annuler la commande

💡 *Réponds avec le numéro.*`);
                        conv.state = ConversationStates.WAITING_MODIFICATION;
                    } else {
                        await this.whatsapp.sendMessage(phone,
                            `❌ *Réponse invalide.*
📌 *Réponds par OUI, NON ou ANNULER.*`);
                    }
                }
                break;

            case 'cancel':
                conv.state = ConversationStates.IDLE;
                delete conv.context.pendingMedicine;
                break;
        }
    }

    async showCart(phone, conv) {
        if (!conv.cart || conv.cart.length === 0) {
            const delivery = Utils.getDeliveryPrice();
            await this.whatsapp.sendMessage(phone,
                `🛒 *Ton panier est vide.*
💊 *Pour ajouter un médicament*, envoie son nom (ex: *Doliprane*).
📌 *Frais de livraison* : ${delivery.price} FCFA (${delivery.period})`);
            return;
        }
        const totalInfo = Utils.calculateTotal(conv.cart);
        const items = conv.cart.map(i =>
            `• ${i.quantite}x *${i.nom_commercial}* (${i.prix * i.quantite} FCFA)`
        ).join('\n');
        let deliveryMessage = `🚚 *Livraison (${totalInfo.deliveryPeriod})* : ${totalInfo.deliveryPrice} FCFA`;
        if (totalInfo.isFreeDelivery) {
            deliveryMessage = `🎉 *Livraison gratuite !* (dès ${DELIVERY_CONFIG.FREE_DELIVERY_THRESHOLD} FCFA)`;
            totalInfo.total = totalInfo.subtotal; // Livraison gratuite
        }
        await this.whatsapp.sendMessage(phone,
            `🛒 *TON PANIER* :
${items}

💰 *Sous-total* : ${totalInfo.subtotal} FCFA
${deliveryMessage}
💰 *TOTAL* : *${totalInfo.total} FCFA*

📌 *Que veux-tu faire ?*
→ *1* : Continuer mes achats
→ *2* : Passer commande
→ *3* : Vider le panier

💡 *Réponds avec le numéro.*`);
    }

    async startCheckout(phone, conv) {
        if (!conv.cart || conv.cart.length === 0) {
            await this.whatsapp.sendMessage(phone,
                `❌ *Ton panier est vide.*
💊 *Ajoute des médicaments* en envoyant leur nom.`);
            return;
        }
        const requiredFields = ['quartier', 'nom', 'age', 'telephone'];
        const missingFields = requiredFields.filter(field => !conv.context[field]);
        if (missingFields.length > 0) {
            const fieldQuestions = {
                'quartier': "📍 *Quel est ton quartier à San Pedro ?*\n→ Ex: *Cité*, *Quartier Industriel*",
                'nom': "👤 *Quel est ton nom complet ?*\n→ Ex: *Jean Kouamé*",
                'age': "🎂 *Quel est ton âge ?*\n→ Ex: *25*",
                'telephone': "📞 *Quel est ton numéro de téléphone ?*\n→ Ex: *0701234567*"
            };
            await this.whatsapp.sendMessage(phone, fieldQuestions[missingFields[0]]);
            conv.state = this.getStateForField(missingFields[0]);
        } else {
            await this.showOrderSummary(phone, conv);
            conv.state = ConversationStates.WAITING_CONFIRMATION;
        }
    }

    async showOrderSummary(phone, conv) {
        const totalInfo = Utils.calculateTotal(conv.cart);
        const items = conv.cart.map(i => `• ${i.quantite}x *${i.nom_commercial}*`).join('\n');
        let deliveryMessage = `🚚 *Livraison (${totalInfo.deliveryPeriod})* : ${totalInfo.deliveryPrice} FCFA`;
        if (totalInfo.isFreeDelivery) {
            deliveryMessage = `🎉 *Livraison gratuite !* (dès ${DELIVERY_CONFIG.FREE_DELIVERY_THRESHOLD} FCFA)`;
        }
        await this.whatsapp.sendMessage(phone,
            `📋 *RÉCAPITULATIF DE TA COMMANDE*
${items}

📍 *Livraison à* : ${conv.context.quartier} (${totalInfo.deliveryPeriod})
👤 *Nom* : ${conv.context.nom}
📞 *Téléphone* : ${conv.context.telephone}

💰 *Sous-total* : ${totalInfo.subtotal} FCFA
${deliveryMessage}
💰 *TOTAL* : *${totalInfo.total} FCFA*

🔘 *Tout est correct ?*
→ *OUI* : Pour confirmer la commande
→ *NON* : Pour modifier
→ *ANNULER* : Pour tout annuler

💡 *Réponds avec OUI, NON ou ANNULER.*`);
    }

    async placeOrder(phone, conv) {
        try {
            const totalInfo = Utils.calculateTotal(conv.cart);
            const order = await this.orders.createOrder(phone, conv.cart, conv.context, totalInfo.deliveryPrice);
            let deliveryMessage = `🛵 *Livraison à ${order.client_quartier} (${totalInfo.deliveryPeriod}) dans ${totalInfo.deliveryTime} min.*`;
            if (totalInfo.isFreeDelivery) {
                deliveryMessage = `🎉 *Livraison gratuite !* (dès ${DELIVERY_CONFIG.FREE_DELIVERY_THRESHOLD} FCFA)`;
            }
            await this.whatsapp.sendMessage(phone,
                `🎉 *Commande #${order.id} confirmée !*
📦 *Médicaments* :
${conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n')}

${deliveryMessage}
🔑 *Code* : ${order.confirmation_code}
💰 *TOTAL* : *${totalInfo.total} FCFA* (livraison incluse)

💡 *Montre ce code au livreur à la réception.*
Merci pour ta confiance ! 💊`);

            await this.orders.notifySupport(order);
            await this.orders.assignLivreur(order.id);

            // Réinitialisation
            this.conversations.set(phone, {
                state: ConversationStates.IDLE,
                cart: [],
                context: {},
                history: conv.history.slice(-5),
                lastActivity: Date.now()
            });

        } catch (error) {
            console.error('❌ Erreur placeOrder:', error);
            await this.whatsapp.sendMessage(phone, "❌ *Erreur technique.* Réessaie plus tard.");
        }
    }

    getStateForField(field) {
        const map = {
            'quartier': ConversationStates.WAITING_QUARTIER,
            'nom': ConversationStates.WAITING_NAME,
            'age': ConversationStates.WAITING_AGE,
            'telephone': ConversationStates.WAITING_PHONE
        };
        return map[field] || ConversationStates.IDLE;
    }
}

// ===========================================
// INITIALISATION BASE DE DONNÉES
// ===========================================
async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS medicaments (
            code_produit VARCHAR(50) PRIMARY KEY,
            nom_commercial VARCHAR(200) NOT NULL,
            dci TEXT,
            prix DECIMAL(10,2) NOT NULL,
            categorie VARCHAR(100),
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id VARCHAR(50) PRIMARY KEY,
            client_name VARCHAR(100),
            client_phone VARCHAR(20),
            client_quartier VARCHAR(100),
            client_ville VARCHAR(100),
            client_indications TEXT,
            patient_age INTEGER,
            patient_genre VARCHAR(1),
            patient_poids INTEGER,
            patient_taille INTEGER,
            items JSONB NOT NULL,
            subtotal DECIMAL(10,2),
            delivery_price DECIMAL(10,2),
            total DECIMAL(10,2),
            confirmation_code VARCHAR(20),
            delivery_period VARCHAR(10),
            status VARCHAR(50),
            livreur_phone VARCHAR(20),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS livreurs (
            id_livreur SERIAL PRIMARY KEY,
            nom VARCHAR(100) NOT NULL,
            telephone VARCHAR(20) NOT NULL,
            whatsapp VARCHAR(20),
            disponible BOOLEAN DEFAULT true,
            commandes_livrees INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(client_phone);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);
    log('info', 'Base de données prête');
}

// ===========================================
// SERVEUR EXPRESS
// ===========================================
const app = express();
const bot = new ConversationManager();

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    keyGenerator: (req) => {
        const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        return msg?.from || req.ip;
    }
}));

// Routes
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
        log('info', '✅ Webhook vérifié');
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const msg = changes?.value?.messages?.[0];
        if (!msg) return;
        if (processedMessages.has(msg.id)) return;
        processedMessages.set(msg.id, true);
        await bot.whatsapp.markAsRead(msg.id);
        const phone = msg.from;
        if (msg.type === 'text') {
            await bot.process(phone, { text: msg.text.body });
        } else if (msg.type === 'image') {
            await bot.process(phone, { mediaId: msg.image.id, mediaType: 'image' });
        } else if (msg.type === 'audio') {
            await bot.process(phone, { mediaType: 'audio' });
        } else if (msg.type === 'interactive') {
            const buttonText = msg.interactive.button_reply.title;
            await bot.process(phone, { text: buttonText });
        }
    } catch (error) {
        log('error', `Webhook: ${error.message}`);
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        mode: 'production',
        conversations: bot.conversations.size,
        timestamp: new Date().toISOString()
    });
});

// Nettoyage périodique
setInterval(() => {
    const now = Date.now();
    for (const [phone, conv] of bot.conversations) {
        if (now - conv.lastActivity > 30 * 60 * 1000) {
            bot.conversations.delete(phone);
            log('info', `Conversation expirée: ${phone}`);
        }
    }
}, 15 * 60 * 1000);

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        await initDatabase();
        await bot.init();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 MARIAM BOT - PRODUCTION FINALE                       ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║                                                           ║
║   🤖 IA Conversationnelle: llama-3.3-70b-versatile        ║
║   📸 Vision: llama-4-scout-17b-16e-instruct               ║
║   🔍 Recherche: Fuse.js (6000+ médicaments)               ║
║   ✅ Validations strictes (8 champs)                      ║
║   🛒 Gestion complète des commandes                        ║
║   📱 Notifications livreur et support                      ║
║   ⚡ Cache multi-niveaux                                    ║
║   💰 Livraison transparente (400 FCFA jour / 600 FCFA nuit)║
║                                                           ║
║   📱 Port: ${PORT}                                         ║
║   👨‍💻 Créé par Youssef - UPSP 2026                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        log('error', `Erreur fatale: ${error.message}`);
        process.exit(1);
    }
}

start();
