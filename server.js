// ===========================================
// MARIAM BOT - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// 100% IA avec OpenRouter (MiniMax) + Groq Vision (Llama-4)
// ===========================================

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

// Clés API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "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";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
// Configuration livraison
const DELIVERY_CONFIG = {
    PRICES: { DAY: 400, NIGHT: 600 },
    SERVICE_FEE: 500,
    DELIVERY_TIME: 45
};

// États de conversation
const ConversationStates = {
    IDLE: 'IDLE',
    WAITING_MEDICINE: 'WAITING_MEDICINE',
    WAITING_QUANTITY: 'WAITING_QUANTITY',
    WAITING_QUARTIER: 'WAITING_QUARTIER',
    WAITING_NAME: 'WAITING_NAME',
    WAITING_AGE: 'WAITING_AGE',
    WAITING_GENDER: 'WAITING_GENDER',
    WAITING_WEIGHT: 'WAITING_WEIGHT',
    WAITING_HEIGHT: 'WAITING_HEIGHT',
    WAITING_PHONE: 'WAITING_PHONE',
    WAITING_INDICATIONS: 'WAITING_INDICATIONS',
    WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
    WAITING_IMAGE_SELECTION: 'WAITING_IMAGE_SELECTION',
    ORDER_PLACED: 'ORDER_PLACED'
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
        const match = text?.match(/\d+/);
        return match ? parseInt(match[0]) : null;
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
            period: isNight ? 'NIGHT' : 'DAY'
        };
    }

    static calculateTotal(cart) {
        const subtotal = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const delivery = this.getDeliveryPrice();
        return subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;
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
                const age = parseInt(value);
                return !isNaN(age) && age >= 1 && age <= 120;
            
            case 'genre':
                const g = value.trim().toUpperCase();
                return g === 'M' || g === 'F' || g === 'HOMME' || g === 'FEMME';
            
            case 'poids':
                const poids = parseFloat(value);
                return !isNaN(poids) && poids >= 20 && poids <= 200;
            
            case 'taille':
                const taille = parseInt(value);
                return !isNaN(taille) && taille >= 100 && taille <= 250;
            
            case 'telephone':
                const clean = value.replace(/\D/g, '');
                return clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean);
            
            case 'quartier':
                return value.trim().length >= 2;
            
            case 'quantite':
                const qty = parseInt(value);
                return !isNaN(qty) && qty >= 1 && qty <= 100;
            
            case 'indications':
                return true;
            
            default:
                return true;
        }
    }

    static normalize(field, value) {
        if (!value) return value;

        switch(field) {
            case 'genre':
                const g = value.trim().toUpperCase();
                if (g === 'M' || g === 'HOMME' || g === 'H') return 'M';
                if (g === 'F' || g === 'FEMME' || g === 'F') return 'F';
                return value;
            
            case 'telephone':
                return value.replace(/\D/g, '');
            
            case 'age':
            case 'poids':
            case 'taille':
            case 'quantite':
                const num = parseFloat(value);
                return isNaN(num) ? value : num;
            
            default:
                return value.trim();
        }
    }
}

// ===========================================
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    async sendMessage(to, text) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text.substring(0, 4096) }
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

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];

        const cacheKey = `search:${Utils.normalizeText(query)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.slice(0, limit);

        const results = this.fuse.search(query)
            .filter(r => r.score < 0.4)
            .slice(0, limit)
            .map(r => r.item);

        if (results.length > 0) {
            this.cache.set(cacheKey, results);
        }
        return results;
    }

    async findBestMatch(query) {
        const results = await this.search(query, 1);
        return results.length > 0 ? results[0] : null;
    }
}

// ===========================================
// LLM SERVICE - OPENROUTER (MINIMAX M2.5) GRATUIT
// ===========================================
class LLMService {
    constructor() {
        this.apiKey = OPENROUTER_API_KEY;
        this.baseURL = "https://openrouter.ai/api/v1";
        this.model = "minimax/minimax-m2.5";
        this.siteUrl = "https://mia-pillbox.onrender.com";
        this.siteName = "MARIAM Bot";
        this.cache = new NodeCache({ stdTTL: 300 });
        
        log('info', `🤖 LLM prêt: MiniMax M2.5 (gratuit)`);
    }

    async analyzeMessage(userMessage, conversation) {
        const cacheKey = `llm:${userMessage.substring(0, 50)}:${conversation.state}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': this.siteUrl,
                    'X-Title': this.siteName
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: "system",
                            content: this.getSystemPrompt(conversation)
                        },
                        {
                            role: "user",
                            content: userMessage
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 300,
                    response_format: { type: "json_object" }
                })
            });

            const data = await response.json();
            
            if (data.error) {
                log('error', `OpenRouter error: ${JSON.stringify(data.error)}`);
                return this.fallbackResponse(userMessage);
            }

            const content = data.choices[0].message.content;
            const result = JSON.parse(content);
            
            this.cache.set(cacheKey, result);
            return result;

        } catch (error) {
            log('error', `Erreur LLM: ${error.message}`);
            return this.fallbackResponse(userMessage);
        }
    }

    getSystemPrompt(conv) {
        return `Tu es MARIAM, assistante santé à San Pedro, Côte d'Ivoire.
Tu réponds en français, de façon naturelle et chaleureuse.

CONTEXTE ACTUEL:
- État: ${conv.state}
- Panier: ${conv.cart?.length || 0} articles
- Infos client: ${JSON.stringify(conv.context || {})}

INSTRUCTIONS STRICTES:
Analyse le message et retourne UNIQUEMENT un JSON avec ce format EXACT:

{
    "intention": "greet" | "order" | "price" | "search" | "info" | "confirm" | "unknown",
    "entites": {
        "medicament": null,
        "quantite": 1,
        "champ": null,
        "valeur": null
    },
    "reponse": "ta réponse naturelle en français"
}

EXEMPLES:
- "bonjour" → {"intention":"greet","entites":{},"reponse":"Bonjour ! Je suis MARIAM. Quel médicament cherches-tu ?"}
- "2 doliprane" → {"intention":"order","entites":{"medicament":"doliprane","quantite":2},"reponse":"D'accord pour 2 doliprane"}
- "j'habite à cité" → {"intention":"info","entites":{"champ":"quartier","valeur":"cité"},"reponse":"📍 Cité, c'est noté !"}`;
    }

    fallbackResponse(message) {
        const lower = message.toLowerCase();
        
        if (lower.match(/bonjour|salut|hey|cc/)) {
            return {
                intention: "greet",
                entites: {},
                reponse: "Bonjour ! Je suis MARIAM. Quel médicament cherches-tu ?"
            };
        }
        
        return {
            intention: "search",
            entites: { medicament: message },
            reponse: `Je cherche "${message}" dans ma base...`
        };
    }
}

// ===========================================
// VISION SERVICE - GROQ (LLAMA-4 SCOUT)
// ===========================================
class VisionService {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = "https://api.groq.com/openai/v1";
        this.model = "meta-llama/llama-4-scout-17b-16e-instruct";
        
        log('info', `👁️ Vision prête: Llama-4 Scout`);
    }

    async analyzeImage(imageBuffer) {
        try {
            const base64Image = imageBuffer.toString('base64');
            
            // Vérifier taille (max 4MB pour base64)
            const sizeInMB = base64Image.length / 1024 / 1024;
            if (sizeInMB > 4) {
                log('warn', 'Image trop grande, compression nécessaire');
                return { type: "inconnu", medicaments: [] };
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
                                    text: this.getVisionPrompt()
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${base64Image}`
                                    }
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
            
            if (data.error) {
                log('error', `Groq Vision error: ${JSON.stringify(data.error)}`);
                return { type: "inconnu", medicaments: [] };
            }

            const content = data.choices[0].message.content;
            return JSON.parse(content);

        } catch (error) {
            log('error', `Erreur vision: ${error.message}`);
            return { type: "inconnu", medicaments: [] };
        }
    }

    getVisionPrompt() {
        return `Tu es MARIAM Vision, assistant santé à San Pedro.
Analyse cette image de médicament ou d'ordonnance et retourne UNIQUEMENT un JSON avec ce format:

{
    "type": "boite" | "ordonnance" | "inconnu",
    "medicaments": [
        {
            "nom": "nom du médicament",
            "dosage": "dosage si visible",
            "forme": "comprimé|sirop|injectable",
            "quantite": nombre si visible
        }
    ],
    "confiance": 0.0-1.0
}`;
    }
}

// ===========================================
// ORDER SERVICE
// ===========================================
class OrderService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async createOrder(phone, cart, context) {
        const orderId = Utils.generateOrderId();
        const code = Utils.generateCode();
        const subtotal = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;

        const order = {
            id: orderId,
            client_name: context.nom,
            client_phone: phone,
            client_quartier: context.quartier,
            client_ville: 'San Pedro',
            client_indications: context.indications || '',
            patient_age: context.age,
            patient_genre: context.genre,
            patient_poids: context.poids,
            patient_taille: context.taille,
            items: cart,
            subtotal,
            delivery_price: delivery.price,
            service_fee: DELIVERY_CONFIG.SERVICE_FEE,
            total,
            confirmation_code: code,
            delivery_period: delivery.period,
            status: 'PENDING'
        };

        await pool.query(`
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

        return order;
    }

    async getOrder(id) {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (result.rows.length === 0) return null;
        const order = result.rows[0];
        order.items = JSON.parse(order.items);
        return order;
    }

    async updateStatus(id, status) {
        await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
    }

    async assignLivreur(orderId) {
        const livreurResult = await pool.query(`
            SELECT id_livreur, nom, telephone, whatsapp
            FROM livreurs
            WHERE disponible = true
            ORDER BY commandes_livrees ASC
            LIMIT 1
        `);

        if (livreurResult.rows.length === 0) {
            return { success: false };
        }

        const livreur = livreurResult.rows[0];
        const order = await this.getOrder(orderId);
        await this.updateStatus(orderId, 'ASSIGNED');

        const items = order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ');
        const message = `🛵 NOUVELLE LIVRAISON #${order.id}
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
📦 ${items}
💰 ${order.total} FCFA
🔑 CODE: ${order.confirmation_code}`;

        await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);
        return { success: true, livreur };
    }

    async notifySupport(order) {
        const items = order.items.map(i => `• ${i.quantite}x ${i.nom_commercial} (${i.prix * i.quantite} FCFA)`).join('\n');
        const message = `📦 NOUVELLE COMMANDE #${order.id}
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
📦\n${items}
💰 TOTAL: ${order.total} FCFA
🔑 CODE: ${order.confirmation_code}`;

        await this.whatsapp.sendInteractiveButtons(SUPPORT_PHONE, message, [
            '✅ Valider livraison',
            '❌ Annuler commande'
        ]);
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
        this.reminders = new Map();
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

    getExpectedField(state) {
        const map = {
            [ConversationStates.WAITING_MEDICINE]: 'medicine',
            [ConversationStates.WAITING_QUANTITY]: 'quantite',
            [ConversationStates.WAITING_QUARTIER]: 'quartier',
            [ConversationStates.WAITING_NAME]: 'nom',
            [ConversationStates.WAITING_AGE]: 'age',
            [ConversationStates.WAITING_GENDER]: 'genre',
            [ConversationStates.WAITING_WEIGHT]: 'poids',
            [ConversationStates.WAITING_HEIGHT]: 'taille',
            [ConversationStates.WAITING_PHONE]: 'telephone',
            [ConversationStates.WAITING_INDICATIONS]: 'indications'
        };
        return map[state] || null;
    }

    getNextState(currentState) {
        const flow = {
            [ConversationStates.WAITING_MEDICINE]: ConversationStates.WAITING_QUANTITY,
            [ConversationStates.WAITING_QUANTITY]: ConversationStates.IDLE,
            [ConversationStates.WAITING_QUARTIER]: ConversationStates.WAITING_NAME,
            [ConversationStates.WAITING_NAME]: ConversationStates.WAITING_AGE,
            [ConversationStates.WAITING_AGE]: ConversationStates.WAITING_GENDER,
            [ConversationStates.WAITING_GENDER]: ConversationStates.WAITING_WEIGHT,
            [ConversationStates.WAITING_WEIGHT]: ConversationStates.WAITING_HEIGHT,
            [ConversationStates.WAITING_HEIGHT]: ConversationStates.WAITING_PHONE,
            [ConversationStates.WAITING_PHONE]: ConversationStates.WAITING_INDICATIONS,
            [ConversationStates.WAITING_INDICATIONS]: ConversationStates.WAITING_CONFIRMATION
        };
        return flow[currentState] || currentState;
    }

    scheduleReminders(phone, nom) {
        if (this.reminders.has(phone)) {
            clearTimeout(this.reminders.get(phone));
        }

        const timers = [];

        timers.push(setTimeout(async () => {
            const conv = this.getConversation(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_PLACED') {
                await this.whatsapp.sendMessage(phone, 
                    `⏰ ${nom || 'Tu'}, ta commande est en attente.`);
            }
        }, 5 * 60 * 1000));

        timers.push(setTimeout(async () => {
            const conv = this.getConversation(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_PLACED') {
                await this.whatsapp.sendMessage(phone, 
                    `⚠️ Dernière minute avant annulation !`);
            }
        }, 19 * 60 * 1000));

        timers.push(setTimeout(async () => {
            const conv = this.getConversation(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_PLACED') {
                await this.whatsapp.sendMessage(phone, 
                    `❌ Commande annulée pour inactivité.`);
                this.conversations.delete(phone);
            }
        }, 20 * 60 * 1000));

        this.reminders.set(phone, timers);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, mediaType } = input;

        console.log(`\n📩 [${phone}] ${mediaType || 'texte'}: ${text || ''}`);

        try {
            conv.lastActivity = Date.now();
            conv.history.push({ role: 'user', content: text || `[${mediaType}]`, timestamp: Date.now() });

            // AUDIO
            if (mediaType === 'audio') {
                await this.whatsapp.sendMessage(phone, 
                    "🎤 Désolé, je ne traite pas les messages vocaux. Envoie un texte ou une photo.");
                return;
            }

            // IMAGE
            if (mediaId) {
                await this.processImage(phone, mediaId, conv);
                return;
            }

            // TEXTE - Analyse IA
            const analysis = await this.llm.analyzeMessage(text, conv);
            
            console.log('🧠 IA:', analysis);

            // Validation si nécessaire
            const expectedField = this.getExpectedField(conv.state);
            if (expectedField && expectedField !== 'confirmation' && expectedField !== 'medicine') {
                if (!ValidationService.validate(expectedField, text)) {
                    await this.whatsapp.sendMessage(phone, 
                        `❌ La valeur "${text}" n'est pas valide. Réessaie.`);
                    return;
                }
                conv.context[expectedField] = ValidationService.normalize(expectedField, text);
                conv.state = this.getNextState(conv.state);
            }

            // Traitement selon intention
            await this.handleIntention(phone, conv, analysis);

        } catch (error) {
            log('error', `Erreur process: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                "Désolé, une erreur technique est survenue. Réessaie.");
        }
    }

    async handleIntention(phone, conv, analysis) {
        const { intention, entites, reponse } = analysis;

        // Envoyer la réponse naturelle
        await this.whatsapp.sendMessage(phone, reponse);
        
        conv.history.push({ role: 'bot', content: reponse, timestamp: Date.now() });

        switch(intention) {
            case 'order':
                if (entites.medicament) {
                    const results = await this.fuse.search(entites.medicament, 5);
                    if (results.length === 1) {
                        const med = results[0];
                        conv.cart.push({
                            ...med,
                            quantite: entites.quantite || 1
                        });
                        conv.state = ConversationStates.IDLE;
                    } else if (results.length > 1) {
                        conv.context.searchResults = results;
                        conv.state = ConversationStates.WAITING_QUANTITY;
                        const list = results.map((m, i) => 
                            `${i+1}. ${m.nom_commercial} (${m.prix} FCFA)`).join('\n');
                        await this.whatsapp.sendMessage(phone, 
                            `Plusieurs trouvés:\n${list}\n\nChoisis le numéro.`);
                    } else {
                        await this.whatsapp.sendMessage(phone, 
                            `❌ "${entites.medicament}" introuvable.`);
                    }
                }
                break;

            case 'price':
                if (entites.medicament) {
                    const med = await this.fuse.findBestMatch(entites.medicament);
                    if (med) {
                        await this.whatsapp.sendMessage(phone, 
                            `💰 ${med.nom_commercial}: ${med.prix} FCFA`);
                    }
                }
                break;

            case 'info':
                if (entites.champ && entites.valeur) {
                    if (ValidationService.validate(entites.champ, entites.valeur)) {
                        conv.context[entites.champ] = ValidationService.normalize(entites.champ, entites.valeur);
                        conv.state = this.getNextState(conv.state);
                    }
                }
                break;

            case 'confirm':
                if (conv.state === ConversationStates.WAITING_CONFIRMATION) {
                    await this.placeOrder(phone, conv);
                    return;
                }
                break;

            case 'greet':
                conv.state = ConversationStates.WAITING_MEDICINE;
                break;
        }

        // Vérifier si on doit passer à l'étape suivante
        const nextField = this.getExpectedField(conv.state);
        if (nextField && !conv.context[nextField] && conv.state !== ConversationStates.WAITING_QUANTITY) {
            const questions = {
                'quartier': "📍 Dans quel quartier habites-tu ?",
                'nom': "👤 Ton nom complet ?",
                'age': "🎂 Ton âge ?",
                'genre': "⚧ Genre (M/F) ?",
                'poids': "⚖️ Ton poids ?",
                'taille': "📏 Ta taille ?",
                'telephone': "📞 Ton téléphone ?",
                'indications': "📍 Indications pour le livreur ?"
            };
            await this.whatsapp.sendMessage(phone, questions[nextField]);
        }

        // Vérifier si on peut passer à la confirmation
        if (conv.cart.length > 0 && conv.context.quartier && conv.context.nom && 
            conv.context.age && conv.context.genre && conv.context.telephone) {
            await this.showSummary(phone, conv);
            conv.state = ConversationStates.WAITING_CONFIRMATION;
            this.scheduleReminders(phone, conv.context.nom);
        }

        this.conversations.set(phone, conv);
    }

    async processImage(phone, mediaId, conv) {
        await this.whatsapp.sendMessage(phone, "📸 Analyse de l'image en cours...");
        
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Impossible de télécharger l'image.");
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        
        if (visionResult.type === 'inconnu' || !visionResult.medicaments?.length) {
            await this.whatsapp.sendMessage(phone, 
                "🔍 Aucun médicament détecté. Envoie une photo plus nette.");
            return;
        }

        const foundMedicines = [];
        for (const med of visionResult.medicaments) {
            const results = await this.fuse.search(med.nom, 1);
            if (results.length > 0) {
                foundMedicines.push(results[0]);
            }
        }

        if (foundMedicines.length === 0) {
            await this.whatsapp.sendMessage(phone, 
                "❌ Médicaments non trouvés dans ma base.");
            return;
        }

        if (foundMedicines.length === 1) {
            conv.cart.push({
                ...foundMedicines[0],
                quantite: 1
            });
            await this.whatsapp.sendMessage(phone, 
                `✅ ${foundMedicines[0].nom_commercial} ajouté au panier.`);
        } else {
            conv.context.pendingImageOptions = foundMedicines;
            conv.state = ConversationStates.WAITING_IMAGE_SELECTION;
            
            const list = foundMedicines.map((m, i) => 
                `${i+1}. ${m.nom_commercial} (${m.prix} FCFA)`).join('\n');
            
            await this.whatsapp.sendMessage(phone, 
                `📸 Médicaments détectés:\n${list}\n\nChoisis le numéro.`);
        }

        this.conversations.set(phone, conv);
    }

    async showSummary(phone, conv) {
        const total = Utils.calculateTotal(conv.cart);
        const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
        
        await this.whatsapp.sendMessage(phone, 
            `📋 RÉCAPITULATIF:\n${items}\n📍 ${conv.context.quartier}\n👤 ${conv.context.nom}\n💰 Total: ${total} FCFA\n\nConfirme avec "oui"`);
    }

    async placeOrder(phone, conv) {
        try {
            const order = await this.orders.createOrder(phone, conv.cart, conv.context);
            
            await this.whatsapp.sendMessage(phone, 
                `🎉 Commande confirmée #${order.id}!\n🔑 Code: ${order.confirmation_code}\n🛵 Livraison dans ~45 min`);
            
            await this.orders.notifySupport(order);
            await this.orders.assignLivreur(order.id);

            // Reset conversation
            this.conversations.delete(phone);

        } catch (error) {
            log('error', `Erreur commande: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                "❌ Erreur lors de la commande. Contacte le support.");
        }
    }

    async handleButton(phone, buttonText, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) return;

        if (buttonText.includes('Valider')) {
            await this.orders.updateStatus(orderId, 'DELIVERED');
            await this.whatsapp.sendMessage(order.client_phone, 
                `🎉 Commande #${orderId} livrée ! Merci !`);
            await this.whatsapp.sendMessage(SUPPORT_PHONE, 
                `✅ Commande #${orderId} validée`);
        } else if (buttonText.includes('Annuler')) {
            await this.orders.updateStatus(orderId, 'CANCELED');
            await this.whatsapp.sendMessage(order.client_phone, 
                `❌ Commande #${orderId} annulée`);
            await this.whatsapp.sendMessage(SUPPORT_PHONE, 
                `❌ Commande #${orderId} annulée`);
        }
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
            service_fee DECIMAL(10,2),
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

        CREATE TABLE IF NOT EXISTS avis_clients (
            id SERIAL PRIMARY KEY,
            order_id VARCHAR(50) REFERENCES orders(id),
            client_phone VARCHAR(20),
            client_name VARCHAR(100),
            note INTEGER CHECK (note >= 1 AND note <= 5),
            commentaire TEXT,
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

        const whatsapp = new WhatsAppService();
        await whatsapp.markAsRead(msg.id);

        const phone = msg.from;

        if (msg.type === 'text') {
            await bot.process(phone, { text: msg.text.body });
        } else if (msg.type === 'image') {
            await bot.process(phone, { mediaId: msg.image.id, mediaType: 'image' });
        } else if (msg.type === 'audio') {
            await bot.process(phone, { mediaType: 'audio' });
        } else if (msg.type === 'interactive') {
            const buttonText = msg.interactive.button_reply.title;
            const orderId = msg.interactive.button_reply.id.split('_')[2];
            await bot.handleButton(phone, buttonText, orderId);
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
║   🚀 MARIAM BOT - PRODUCTION READY                        ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║                                                           ║
║   ✅ IA Conversationnelle: MiniMax M2.5 (OpenRouter)      ║
║   ✅ Vision: Llama-4 Scout (Groq)                         ║
║   ✅ Recherche: Fuse.js (6000+ médicaments)               ║
║   ✅ Validations strictes (8 champs)                      ║
║   ✅ Gestion complète des commandes                        ║
║   ✅ Support livreurs et avis clients                      ║
║   ✅ Cache multi-niveaux                                   ║
║   ✅ 100% GRATUIT !                                        ║
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
