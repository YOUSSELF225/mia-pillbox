// ===========================================
// MARIAM BOT - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// 100% IA avec Groq (Llama-3.3-70b + Llama-4-Scout)
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

// Clés API Groq
const GROQ_API_KEY = process.env.GROQ_API_KEY ;

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
    WAITING_ADD_CONFIRMATION: 'WAITING_ADD_CONFIRMATION',
    WAITING_SELECTION: 'WAITING_SELECTION',
    WAITING_POST_ADD: 'WAITING_POST_ADD',
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
    CHECKOUT: 'CHECKOUT'
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
            if (!text || typeof text !== 'string') {
                text = "Bonjour ! Je suis MARIAM. Comment puis-je t'aider ?";
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
// LLM SERVICE - GROQ LLAMA-3.3-70B (100% IA)
// ===========================================
class LLMService {
    constructor() {
        this.apiKey = GROQ_API_KEY;
        this.baseURL = "https://api.groq.com/openai/v1";
        this.model = "llama-3.3-70b-versatile";
        this.cache = new NodeCache({ stdTTL: 300 });
        
        log('info', `🤖 LLM prêt (${this.model})`);
    }

    async analyzeMessage(userMessage, conversation) {
        const cacheKey = `llm:${userMessage.substring(0, 50)}:${conversation?.state || 'IDLE'}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            console.log('📦 Réponse du cache');
            return cached;
        }

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
                        {
                            role: "system",
                            content: this.getSystemPrompt(conversation)
                        },
                        ...this.getHistory(conversation),
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
            let content = data.choices[0].message.content;
            
            // Nettoyer le JSON (enlever les backticks si présents)
            content = content.replace(/^```json\s*|\s*```$/g, '');
            
            const result = JSON.parse(content);
            
            // Assurer que l'intention existe
            if (!result.intention) {
                result.intention = this.detectIntentionFallback(userMessage);
            }
            
            this.cache.set(cacheKey, result);
            console.log('🧠 IA:', result);
            return result;

        } catch (error) {
            console.error('❌ Erreur LLM:', error);
            return this.fallbackResponse(userMessage);
        }
    }

    getSystemPrompt(conv) {
        const context = conv?.context || {};
        const cart = conv?.cart || [];
        const lastMedicine = conv?.context?.lastMedicine?.name || 'aucun';
        const isNewUser = !conv?.history || conv.history.length < 2;
        
        return `Tu es MARIAM, une assistante santé virtuelle à San Pedro, Côte d'Ivoire.

⚠️⚠️⚠️ INSTRUCTION CRITIQUE ⚠️⚠️⚠️
Tu NE DOIS JAMAIS répondre avec autre chose que du JSON valide.
Tu NE DOIS JAMAIS sortir de ton rôle d'assistante santé.
Tu NE DOIS JAMAIS inventer des médicaments.

===========================================================
CONTEXTE ACTUEL
===========================================================
- État: ${conv?.state || 'IDLE'}
- Panier: ${cart.length} article(s)
- Infos client: ${JSON.stringify(context)}
- Dernier médicament discuté: ${lastMedicine}
- ${isNewUser ? "⚠️ NOUVEL UTILISATEUR - Sois accueillante" : "✅ Utilisateur régulier"}

===========================================================
INTENTIONS À DÉTECTER
===========================================================
1. "greet" → Salutation (bonjour, salut, hey, cc)
2. "question" → Question sur toi (qui es-tu, tu fais quoi)
3. "search" → Recherche médicament (doliprane, amox)
4. "order" → Commande avec quantité (je veux 2 doliprane)
5. "price" → Demande de prix (combien coûte, prix)
6. "add" → Ajout au panier (ajoute, mets dans panier)
7. "cart" → Voir le panier (mon panier, voir panier)
8. "checkout" → Passer commande (commander, finaliser)
9. "info" → Donner info (j'habite à, je m'appelle, j'ai X ans)
10. "confirm" → Confirmation (oui, d'accord, ok)
11. "cancel" → Annulation (non, annuler)
12. "unknown" → Pas compris

===========================================================
EXEMPLES PRÉCIS
===========================================================
1. "salut" → {"intention":"greet","entites":{},"reponse":"Salut ! Je suis MARIAM. Tu cherches un médicament ?"}
2. "qui es tu" → {"intention":"question","entites":{},"reponse":"Je suis MARIAM, ton assistante santé à San Pedro."}
3. "doliprane" → {"intention":"search","entites":{"medicament":"doliprane"},"reponse":"Je cherche le doliprane..."}
4. "je veux 2 doliprane" → {"intention":"order","entites":{"medicament":"doliprane","quantite":2},"reponse":"D'accord pour 2 doliprane."}
5. "combien coûte l'amox" → {"intention":"price","entites":{"medicament":"amoxicilline"},"reponse":"L'amoxicilline est à 2500 FCFA."}
6. "ajoute au panier" → {"intention":"add","entites":{},"reponse":"Quel médicament veux-tu ajouter ?"}
7. "voir mon panier" → {"intention":"cart","entites":{},"reponse":"Voici ton panier..."}
8. "commander" → {"intention":"checkout","entites":{},"reponse":"Je prépare ta commande."}
9. "j'habite à cité" → {"intention":"info","entites":{"champ":"quartier","valeur":"cité"},"reponse":"Cité, c'est noté !"}
10. "oui" → {"intention":"confirm","entites":{},"reponse":"D'accord, je continue."}
11. "non" → {"intention":"cancel","entites":{},"reponse":"Pas de problème."}

===========================================================
FORMAT DE RÉPONSE OBLIGATOIRE
===========================================================
{
    "intention": "greet|question|search|order|price|add|cart|checkout|info|confirm|cancel|unknown",
    "entites": {
        "medicament": null,
        "quantite": 1,
        "champ": null,
        "valeur": null
    },
    "reponse": "ta réponse naturelle ici (1-2 phrases)"
}`;
    }

    getHistory(conv) {
        if (!conv?.history) return [];
        return conv.history
            .slice(-6)
            .map(msg => ({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.content
            }));
    }

    detectIntentionFallback(message) {
        const lower = message.toLowerCase();
        if (lower.match(/bonjour|salut|hey|cc/)) return 'greet';
        if (lower.match(/qui es tu|comment tu t'appelles/)) return 'question';
        if (lower.match(/\d+\s*[a-z]/)) return 'order';
        if (lower.match(/prix|combien|coûte/)) return 'price';
        if (lower.match(/ajoute|panier/)) return 'add';
        if (lower.match(/voir|mon panier/)) return 'cart';
        if (lower.match(/commander|finaliser/)) return 'checkout';
        if (lower.match(/oui|d'accord|ok/)) return 'confirm';
        if (lower.match(/non|annuler/)) return 'cancel';
        return 'search';
    }

    fallbackResponse(message) {
        return {
            intention: this.detectIntentionFallback(message),
            entites: {},
            reponse: "Bonjour ! Je suis MARIAM. Comment puis-je t'aider ?"
        };
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
        
        log('info', '📸 Vision Service prêt');
    }

    async analyzeImage(imageBuffer) {
        try {
            const base64Image = imageBuffer.toString('base64');
            
            const sizeInMB = base64Image.length / 1024 / 1024;
            if (sizeInMB > 4) {
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
                                    text: `Analyse cette image de médicament. Réponds en JSON avec:
                                    {
                                        "type": "boite|ordonnance|inconnu",
                                        "medicaments": [{"nom": "", "dosage": "", "forme": ""}]
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
            return { type: "inconnu", medicaments: [] };
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
            patient_poids: context.poids || null,
            patient_taille: context.taille || null,
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
👤 Client: ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
📦 ${items}
💰 ${order.total} FCFA
🔑 CODE: ${order.confirmation_code}`;

        await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);
        return { success: true, livreur };
    }

    async notifySupport(order) {
        const items = order.items.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
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

    saveLastMedicine(conv, medicineName, results) {
        conv.context.lastMedicine = {
            name: medicineName,
            results: results,
            timestamp: Date.now()
        };
    }

    getLastMedicine(conv) {
        const last = conv.context.lastMedicine;
        if (last && (Date.now() - last.timestamp) < 5 * 60 * 1000) {
            return last;
        }
        return null;
    }

    getExpectedField(state) {
        const map = {
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

    getStateForField(field) {
        const map = {
            'quartier': ConversationStates.WAITING_QUARTIER,
            'nom': ConversationStates.WAITING_NAME,
            'age': ConversationStates.WAITING_AGE,
            'genre': ConversationStates.WAITING_GENDER,
            'poids': ConversationStates.WAITING_WEIGHT,
            'taille': ConversationStates.WAITING_HEIGHT,
            'telephone': ConversationStates.WAITING_PHONE,
            'indications': ConversationStates.WAITING_INDICATIONS
        };
        return map[field] || ConversationStates.IDLE;
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, mediaType } = input;

        console.log(`\n📩 [${phone}] ${text || mediaType || ''}`);

        try {
            await this.whatsapp.sendTyping(phone);
            
            if (text) {
                conv.history.push({ role: 'user', content: text, timestamp: Date.now() });
            }

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

            // ANALYSE IA
            const analysis = await this.llm.analyzeMessage(text, conv);
            
            // Vérifier si c'est une question sur le bot
            if (this.isQuestionAboutBot(text)) {
                analysis.intention = 'question';
            }

            // GESTION SELON INTENTION
            await this.handleIntention(phone, conv, analysis, text);

            conv.lastActivity = Date.now();
            this.conversations.set(phone, conv);

        } catch (error) {
            console.error('❌ Erreur process:', error);
            await this.whatsapp.sendMessage(phone, 
                "Désolé, j'ai eu un petit problème. Peux-tu répéter ?");
        }
    }

    isQuestionAboutBot(text) {
        const lower = text.toLowerCase();
        const questions = [
            'qui es tu', 'qui est tu', 'c\'est qui', 'tu es qui',
            'comment tu t\'appelles', 'ton nom', 'présente toi',
            'tu fais quoi', 'comment tu peux m\'aider', 'à quoi tu sers'
        ];
        return questions.some(q => lower.includes(q));
    }

    async handleIntention(phone, conv, analysis, originalText) {
        const { intention, entites } = analysis;

        // Envoyer la réponse de l'IA
        await this.whatsapp.sendMessage(phone, analysis.reponse);
        conv.history.push({ role: 'assistant', content: analysis.reponse, timestamp: Date.now() });

        switch(intention) {
            case 'greet':
                conv.state = ConversationStates.WAITING_MEDICINE;
                break;

            case 'question':
                // L'IA a déjà répondu, rien à faire
                break;

            case 'search':
            case 'order':
            case 'price':
                const medicineName = entites?.medicament || originalText;
                const results = await this.fuse.search(medicineName, 5);
                
                if (results.length > 0) {
                    this.saveLastMedicine(conv, medicineName, results);
                    
                    if (results.length === 1) {
                        const med = results[0];
                        conv.context.pendingMedicine = med;
                        conv.state = ConversationStates.WAITING_ADD_CONFIRMATION;
                        
                        if (intention === 'order' && entites?.quantite) {
                            conv.context.pendingQuantity = entites.quantite;
                        }
                    } else {
                        conv.context.searchResults = results;
                        conv.state = ConversationStates.WAITING_SELECTION;
                    }
                }
                break;

            case 'add':
                const lastMedicine = this.getLastMedicine(conv);
                if (lastMedicine && lastMedicine.results.length === 1) {
                    conv.context.pendingMedicine = lastMedicine.results[0];
                    conv.state = ConversationStates.WAITING_ADD_CONFIRMATION;
                } else if (lastMedicine && lastMedicine.results.length > 1) {
                    conv.context.searchResults = lastMedicine.results;
                    conv.state = ConversationStates.WAITING_SELECTION;
                }
                break;

            case 'cart':
                await this.showCart(phone, conv);
                break;

            case 'checkout':
                await this.startCheckout(phone, conv);
                break;

            case 'info':
                if (entites?.champ && entites?.valeur) {
                    if (ValidationService.validate(entites.champ, entites.valeur)) {
                        conv.context[entites.champ] = ValidationService.normalize(entites.champ, entites.valeur);
                    }
                }
                break;

            case 'confirm':
                if (conv.state === ConversationStates.WAITING_ADD_CONFIRMATION && conv.context.pendingMedicine) {
                    conv.state = ConversationStates.WAITING_QUANTITY;
                } else if (conv.state === ConversationStates.WAITING_CONFIRMATION) {
                    await this.placeOrder(phone, conv);
                    return;
                }
                break;

            case 'cancel':
                // Reset partiel
                delete conv.context.pendingMedicine;
                delete conv.context.pendingQuantity;
                delete conv.context.searchResults;
                conv.state = ConversationStates.IDLE;
                break;
        }

        // Gestion des états d'attente
        const expectedField = this.getExpectedField(conv.state);
        if (expectedField && !conv.context[expectedField]) {
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
            await this.whatsapp.sendMessage(phone, questions[expectedField]);
        }

        // Gestion de la quantité
        if (conv.state === ConversationStates.WAITING_QUANTITY && conv.context.pendingMedicine) {
            const qty = entites?.quantite || Utils.extractNumber(originalText) || 1;
            
            if (qty >= 1 && qty <= 100) {
                const med = conv.context.pendingMedicine;
                conv.cart.push({ ...med, quantite: qty });
                
                delete conv.context.pendingMedicine;
                delete conv.context.pendingQuantity;
                conv.state = ConversationStates.WAITING_POST_ADD;
                
                await this.whatsapp.sendMessage(phone, 
                    `✅ ${qty}x ${med.nom_commercial} ajouté (${med.prix * qty} FCFA). Tu veux autre chose ?`);
            }
        }

        // Gestion de la sélection
        if (conv.state === ConversationStates.WAITING_SELECTION && conv.context.searchResults) {
            const num = parseInt(originalText);
            if (num >= 1 && num <= conv.context.searchResults.length) {
                const med = conv.context.searchResults[num - 1];
                conv.context.pendingMedicine = med;
                conv.state = ConversationStates.WAITING_ADD_CONFIRMATION;
                
                await this.whatsapp.sendMessage(phone, 
                    `💊 ${med.nom_commercial} à ${med.prix} FCFA. Ajouter au panier ? (oui/non)`);
            }
        }

        // Vérifier si on peut passer au checkout
        if (conv.cart.length > 0 && 
            conv.context.quartier && conv.context.nom && 
            conv.context.age && conv.context.genre && conv.context.telephone) {
            await this.showSummary(phone, conv);
            conv.state = ConversationStates.WAITING_CONFIRMATION;
        }
    }

    async processImage(phone, mediaId, conv) {
        await this.whatsapp.sendMessage(phone, "📸 J'analyse ton image...");
        
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "❌ Je n'ai pas pu télécharger l'image.");
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        
        if (!visionResult.medicaments?.length) {
            await this.whatsapp.sendMessage(phone, 
                "🔍 Je n'ai pas reconnu de médicament. Envoie une photo plus nette.");
            return;
        }

        const foundMedicines = [];
        for (const med of visionResult.medicaments) {
            const results = await this.fuse.search(med.nom, 1);
            if (results.length > 0) foundMedicines.push(results[0]);
        }

        if (foundMedicines.length === 0) {
            await this.whatsapp.sendMessage(phone, 
                `❌ ${visionResult.medicaments[0].nom} n'est pas dans ma base.`);
            return;
        }

        if (foundMedicines.length === 1) {
            conv.context.pendingMedicine = foundMedicines[0];
            conv.state = ConversationStates.WAITING_ADD_CONFIRMATION;
            
            await this.whatsapp.sendMessage(phone, 
                `📸 J'ai détecté *${foundMedicines[0].nom_commercial}* à ${foundMedicines[0].prix} FCFA.\n\nAjouter au panier ? (oui/non)`);
        } else {
            conv.context.pendingImageOptions = foundMedicines;
            conv.state = ConversationStates.WAITING_IMAGE_SELECTION;
            
            const list = foundMedicines.map((m, i) => 
                `${i+1}. *${m.nom_commercial}* (${m.prix} FCFA)`).join('\n');
            
            await this.whatsapp.sendMessage(phone, 
                `📸 Plusieurs médicaments détectés:\n${list}\n\nLequel veux-tu ajouter ?`);
        }

        this.conversations.set(phone, conv);
    }

    async showCart(phone, conv) {
        if (!conv.cart?.length) {
            await this.whatsapp.sendMessage(phone, 
                "🛒 Ton panier est vide. Ajoute des médicaments avec leur nom.");
            return;
        }

        const items = conv.cart.map(i => 
            `• ${i.quantite}x ${i.nom_commercial} (${i.prix * i.quantite} FCFA)`).join('\n');
        const total = conv.cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        
        await this.whatsapp.sendMessage(phone, 
            `🛒 *TON PANIER*\n${items}\n💰 Sous-total: ${total} FCFA`);
    }

    async showSummary(phone, conv) {
        const total = Utils.calculateTotal(conv.cart);
        const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
        
        await this.whatsapp.sendMessage(phone, 
            `📋 *RÉCAPITULATIF*\n${items}\n📍 ${conv.context.quartier}\n👤 ${conv.context.nom}\n💰 Total: ${total} FCFA\n\nConfirme avec "oui"`);
    }

    async startCheckout(phone, conv) {
        if (!conv.cart?.length) {
            await this.whatsapp.sendMessage(phone, 
                "❌ Ton panier est vide. Ajoute d'abord des médicaments.");
            return;
        }

        const required = ['quartier', 'nom', 'age', 'genre', 'telephone'];
        const missing = required.filter(f => !conv.context[f]);
        
        if (missing.length > 0) {
            const firstMissing = missing[0];
            const questions = {
                'quartier': "📍 Pour la livraison, dans quel quartier habites-tu ?",
                'nom': "👤 Quel est ton nom complet ?",
                'age': "🎂 Quel âge as-tu ?",
                'genre': "⚧ Genre (M/F) ?",
                'telephone': "📞 Ton numéro de téléphone ?"
            };
            
            conv.state = this.getStateForField(firstMissing);
            await this.whatsapp.sendMessage(phone, questions[firstMissing]);
        } else {
            await this.showSummary(phone, conv);
            conv.state = ConversationStates.WAITING_CONFIRMATION;
        }
    }

    async placeOrder(phone, conv) {
        try {
            // Vérifications finales
            if (!conv.cart?.length) {
                await this.whatsapp.sendMessage(phone, "❌ Panier vide.");
                return;
            }

            const required = ['quartier', 'nom', 'age', 'genre', 'telephone'];
            const missing = required.filter(f => !conv.context[f]);
            if (missing.length > 0) {
                await this.startCheckout(phone, conv);
                return;
            }

            // Créer la commande
            const order = await this.orders.createOrder(phone, conv.cart, conv.context);
            
            // Confirmation client
            await this.whatsapp.sendMessage(phone, 
                `🎉 *Commande confirmée #${order.id}*\n🔑 Code: ${order.confirmation_code}\n🛵 Livraison dans ~45 min\n\nLe livreur te demandera ce code.`);
            
            // Notifications
            await this.orders.notifySupport(order);
            await this.orders.assignLivreur(order.id);

            // Reset conversation
            this.conversations.set(phone, {
                state: ConversationStates.IDLE,
                cart: [],
                context: {},
                history: conv.history.slice(-5),
                lastActivity: Date.now()
            });

        } catch (error) {
            console.error('❌ Erreur placeOrder:', error);
            await this.whatsapp.sendMessage(phone, 
                "❌ Une erreur est survenue. Contacte le support au 0701406880.");
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
║   💰 100% GRATUIT !                                        ║
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
