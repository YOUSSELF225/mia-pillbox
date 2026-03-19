// ===========================================
// MARIAM IA - PRODUCTION READY AVEC COMMANDES
// San Pedro, Côte d'Ivoire
// ===========================================

require('dotenv').config();
const express = require('express');
const { Groq } = require('groq-sdk');
const { Pool } = require('pg');
const Redis = require('ioredis');
const NodeCache = require('node-cache');
const Fuse = require('fuse.js');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');

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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const DELIVERY_CONFIG = {
    PRICES: { DAY: 400, NIGHT: 600 },
    DELIVERY_TIME: 45
};

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
// REDIS CACHE
// ===========================================
let redis;
try {
    redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => Math.min(times * 100, 5000),
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
    });
    redis.on('error', (err) => log('error', `Redis: ${err.message}`));
    redis.on('connect', () => log('info', 'Redis connecté'));
} catch (error) {
    log('error', `Redis non disponible: ${error.message}`);
    redis = null;
}

class HybridCache {
    constructor() {
        this.localCache = new NodeCache({ stdTTL: 3600 });
    }

    async get(key) {
        if (!redis) return this.localCache.get(key);
        try {
            const value = await redis.get(key);
            return value ? JSON.parse(value) : null;
        } catch {
            return this.localCache.get(key);
        }
    }

    async set(key, value, ttl = 3600) {
        if (!redis) {
            this.localCache.set(key, value, ttl);
            return;
        }
        try {
            await redis.set(key, JSON.stringify(value), 'EX', ttl);
        } catch {
            this.localCache.set(key, value, ttl);
        }
    }
}

const cache = new HybridCache();
const processedMessages = new NodeCache({ stdTTL: 600 });

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

    static getDeliveryPrice() {
        const hour = new Date().getHours();
        const isNight = hour >= 0 && hour < 7;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'nuit' : 'jour',
            time: DELIVERY_CONFIG.DELIVERY_TIME
        };
    }

    static getSupportLink() {
        const phone = SUPPORT_PHONE.replace('+', '');
        return `https://wa.me/${phone}`;
    }

    static generateOrderCode() {
        return crypto.randomInt(100000, 999999).toString();
    }

    static formatPhoneNumber(phone) {
        return phone.replace(/[^0-9+]/g, '');
    }
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => log('error', `DB Error: ${err.message}`));

// ===========================================
// MODÈLE ORDER
// ===========================================
class Order {
    constructor(phone) {
        this.orderCode = Utils.generateOrderCode();
        this.phone = phone;
        this.status = 'pending';
        this.items = [];
        this.customerInfo = {
            nomComplet: null,
            quartier: null,
            age: null,
            taille: null,
            poids: null,
            telephoneContact: null,
            telephoneWhatsapp: phone,
            indications: null
        };
        this.createdAt = new Date();
        this.updatedAt = new Date();
        this.feedback = null;
        this.rating = null;
    }

    addItem(medicament, quantite) {
        this.items.push({
            code_produit: medicament.code_produit,
            nom_commercial: medicament.nom_commercial,
            prix_unitaire: parseFloat(medicament.prix),
            quantite: parseInt(quantite)
        });
        this.updatedAt = new Date();
    }

    getTotal() {
        const subtotal = this.items.reduce((sum, item) => 
            sum + (item.prix_unitaire * item.quantite), 0);
        const delivery = Utils.getDeliveryPrice().price;
        return {
            subtotal,
            delivery,
            total: subtotal + delivery
        };
    }

    isComplete() {
        return this.customerInfo.nomComplet && 
               this.customerInfo.quartier && 
               this.customerInfo.age && 
               this.customerInfo.taille && 
               this.customerInfo.poids && 
               this.customerInfo.telephoneContact;
    }

    getMissingFields() {
        const fields = [];
        if (!this.customerInfo.nomComplet) fields.push('nom complet');
        if (!this.customerInfo.quartier) fields.push('quartier');
        if (!this.customerInfo.age) fields.push('âge');
        if (!this.customerInfo.taille) fields.push('taille');
        if (!this.customerInfo.poids) fields.push('poids');
        if (!this.customerInfo.telephoneContact) fields.push('numéro de contact');
        return fields;
    }

    getSummary() {
        const totals = this.getTotal();
        const delivery = Utils.getDeliveryPrice();
        
        let summary = `📋 *RÉCAPITULATIF COMMANDE*\n`;
        summary += `Code: *${this.orderCode}*\n`;
        summary += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        summary += `🛒 *ARTICLES*\n`;
        
        this.items.forEach((item, index) => {
            summary += `${index + 1}. ${item.nom_commercial}\n`;
            summary += `   ${item.quantite} x ${item.prix_unitaire}F = ${item.prix_unitaire * item.quantite}F\n`;
        });
        
        summary += `\n💰 *TOTAUX*\n`;
        summary += `Sous-total: ${totals.subtotal}F\n`;
        summary += `Livraison (${delivery.period}): ${totals.delivery}F\n`;
        summary += `*Total: ${totals.total}F*\n\n`;
        summary += `👤 *INFORMATIONS*\n`;
        summary += `Nom: ${this.customerInfo.nomComplet || '—'}\n`;
        summary += `Quartier: ${this.customerInfo.quartier || '—'}\n`;
        summary += `Âge: ${this.customerInfo.age || '—'} ans\n`;
        summary += `Taille: ${this.customerInfo.taille || '—'} cm\n`;
        summary += `Poids: ${this.customerInfo.poids || '—'} kg\n`;
        summary += `Contact: ${this.customerInfo.telephoneContact || '—'}\n`;
        
        return summary;
    }
}

// ===========================================
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    constructor() {
        this.lastTyping = new NodeCache({ stdTTL: 10 });
    }

    async sendMessage(to, text) {
        try {
            if (!text) text = "Salut ! Je suis MARIAM 💊";
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
            log('error', `WhatsApp send error: ${error.message}`);
            return false;
        }
    }

    async sendTyping(to) {
        try {
            const lastTyping = this.lastTyping.get(to);
            if (!lastTyping || Date.now() - lastTyping > 10000) {
                await axios.post(WHATSAPP_API_URL, {
                    messaging_product: 'whatsapp',
                    to: to,
                    type: 'typing',
                    typing: { action: 'typing', duration_ms: 3000 }
                }, {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                    timeout: 5000
                });
                this.lastTyping.set(to, Date.now());
            }
        } catch (error) {}
    }

    async downloadMedia(mediaId) {
        try {
            const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }, timeout: 10000 }
            );
            const imageUrl = mediaResponse.data.url;
            const fileResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 15000
            });

            let buffer = Buffer.from(fileResponse.data);
            
            if (buffer.length > 3.5 * 1024 * 1024) {
                buffer = await sharp(buffer)
                    .resize(800, 800, { fit: 'inside' })
                    .jpeg({ quality: 80 })
                    .toBuffer();
            }
            
            return { success: true, buffer };
        } catch (error) {
            log('error', `Media download error: ${error.message}`);
            return { success: false };
        }
    }

    async markAsRead(messageId) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 5000
            });
        } catch (error) {}
    }

    async sendOrderToSupport(order) {
        try {
            const totals = order.getTotal();
            const delivery = Utils.getDeliveryPrice();
            
            let message = `🆕 *NOUVELLE COMMANDE*\n`;
            message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `📋 *CODE*: ${order.orderCode}\n`;
            message += `📱 *Client*: ${order.phone}\n`;
            message += `⏰ *Date*: ${order.createdAt.toLocaleString('fr-FR')}\n\n`;
            message += `🛒 *ARTICLES*\n`;
            
            order.items.forEach((item, index) => {
                message += `${index + 1}. *${item.nom_commercial}*\n`;
                message += `   ${item.quantite} x ${item.prix_unitaire}F = ${item.prix_unitaire * item.quantite}F\n`;
            });
            
            message += `\n💰 *TOTAUX*\n`;
            message += `Sous-total: ${totals.subtotal}F\n`;
            message += `Livraison (${delivery.period}): ${totals.delivery}F\n`;
            message += `*Total: ${totals.total}F*\n\n`;
            message += `👤 *CLIENT*\n`;
            message += `Nom: ${order.customerInfo.nomComplet}\n`;
            message += `Quartier: ${order.customerInfo.quartier}\n`;
            message += `Âge: ${order.customerInfo.age} ans\n`;
            message += `Taille: ${order.customerInfo.taille} cm\n`;
            message += `Poids: ${order.customerInfo.poids} kg\n`;
            message += `Contact: ${order.customerInfo.telephoneContact}\n`;
            
            if (order.customerInfo.indications) {
                message += `\n📝 *INDICATIONS*\n${order.customerInfo.indications}\n`;
            }
            
            message += `\n✅ *À traiter*`;

            await this.sendMessage(SUPPORT_PHONE, message);
            log('info', `Commande ${order.orderCode} envoyée au support`);
            return true;
        } catch (error) {
            log('error', `Erreur envoi support: ${error.message}`);
            return false;
        }
    }
}

// ===========================================
// FUSE SERVICE
// ===========================================
class FuseService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = cache;
    }

    async initialize() {
        try {
            const cached = await this.cache.get("all_medicaments");
            if (cached) {
                this.medicaments = cached;
                this.fuse = new Fuse(this.medicaments, {
                    keys: ['nom_commercial', 'dci'],
                    threshold: 0.3,
                    ignoreLocation: true,
                    minMatchCharLength: 2,
                    includeScore: true
                });
                log('info', `${this.medicaments.length} médicaments chargés (cache)`);
                return;
            }

            const result = await pool.query("SELECT * FROM medicaments");
            this.medicaments = result.rows;

            this.fuse = new Fuse(this.medicaments, {
                keys: ['nom_commercial', 'dci'],
                threshold: 0.3,
                ignoreLocation: true,
                minMatchCharLength: 2,
                includeScore: true
            });

            await this.cache.set("all_medicaments", this.medicaments, 3600);
            log('info', `${this.medicaments.length} médicaments chargés (DB)`);
        } catch (error) {
            log('error', `Fuse init error: ${error.message}`);
            throw error;
        }
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];
        
        const cacheKey = `search:${Utils.normalizeText(query)}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached.slice(0, limit);

        const results = this.fuse.search(query)
            .filter(r => r.score < 0.4)
            .slice(0, limit)
            .map(r => r.item);

        if (results.length > 0) {
            await this.cache.set(cacheKey, results, 300);
        }

        return results;
    }
}

// ===========================================
// SMART MODEL SWITCHER
// ===========================================
class SmartModelSwitcher {
    constructor() {
        this.models = {
            principal: {
                name: 'groq-llama-70b',
                provider: 'groq',
                model: 'llama-3.3-70b-versatile',
                quota: 100000,
                current: 0,
                resetTime: Date.now() + 24*60*60*1000,
                available: true,
                cooldownUntil: null
            },
            secours: [
                {
                    name: 'github-gpt4o',
                    provider: 'github',
                    model: 'gpt-4o',
                    quota: 150,
                    current: 0,
                    resetTime: Date.now() + 24*60*60*1000,
                    available: true,
                    cooldownUntil: null
                },
                {
                    name: 'github-llama3-70b',
                    provider: 'github',
                    model: 'llama-3-70b',
                    quota: 150,
                    current: 0,
                    resetTime: Date.now() + 24*60*60*1000,
                    available: true,
                    cooldownUntil: null
                },
                {
                    name: 'github-mistral-large',
                    provider: 'github',
                    model: 'mistral-large',
                    quota: 150,
                    current: 0,
                    resetTime: Date.now() + 24*60*60*1000,
                    available: true,
                    cooldownUntil: null
                }
            ]
        };

        this.currentModelForConversation = new Map();
        this.conversationSummaries = new Map();
        this.supportRedirects = 0;
        this.githubToken = GITHUB_TOKEN;
        this.maxRetries = 3;
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        
        return `Tu es MARIAM, IA santé à San Pedro.

STYLE : messages courts (3-4 lignes), emojis discrets (💊 🚚 📲)

CONTEXTE :
- Livraison: ${delivery.price}F (${delivery.period}), ${delivery.time}min
- Support: ${supportLink}

FORMAT JSON : {
    "intention": "greet|search|order|confirm_order|cancel_order|add_item|collect_info|feedback|support|delivery|creator|unknown",
    "medicament": "nom ou null",
    "quantite": "nombre ou null",
    "info_field": "champ à collecter",
    "info_value": "valeur ou null",
    "reponse": "ta réponse"
}`;
    }

    async isModelAvailable(model) {
        if (Date.now() > model.resetTime) {
            model.current = 0;
            model.resetTime = Date.now() + 24*60*60*1000;
            model.available = true;
            model.cooldownUntil = null;
        }

        if (model.cooldownUntil && Date.now() < model.cooldownUntil) {
            return false;
        }

        return model.current < model.quota;
    }

    async getAvailableModel(phone) {
        if (this.currentModelForConversation.has(phone)) {
            const current = this.currentModelForConversation.get(phone);
            
            if (current.provider === 'groq') {
                if (await this.isModelAvailable(this.models.principal)) {
                    return this.models.principal;
                }
            } else {
                const secoursModel = this.models.secours.find(m => m.name === current.name);
                if (secoursModel && await this.isModelAvailable(secoursModel)) {
                    return secoursModel;
                }
            }
        }

        if (await this.isModelAvailable(this.models.principal)) {
            this.currentModelForConversation.set(phone, this.models.principal);
            return this.models.principal;
        }

        for (const model of this.models.secours) {
            if (await this.isModelAvailable(model)) {
                log('info', `🔄 Bascule vers ${model.name} pour ${phone}`);
                this.currentModelForConversation.set(phone, model);
                return model;
            }
        }

        return null;
    }

    async callLLM(phone, message, historique = [], orderContext = null, retryCount = 0) {
        try {
            if (retryCount > this.maxRetries) {
                log('error', `❌ Max retries pour ${phone}`);
                return {
                    intention: "support",
                    medicament: null,
                    reponse: `📞 Contacte le support : *${SUPPORT_PHONE}*`
                };
            }

            const model = await this.getAvailableModel(phone);
            
            if (!model) {
                this.supportRedirects++;
                return {
                    intention: "support",
                    medicament: null,
                    reponse: `📞 *SERVICE INDISPONIBLE*\n\nContacte le support : *${SUPPORT_PHONE}*`
                };
            }

            const prompt = this.buildPrompt(message, historique, orderContext);
            
            let response;
            if (model.provider === 'groq') {
                response = await this.callGroq(prompt, model);
            } else {
                response = await this.callGithub(prompt, model);
            }

            model.current++;

            this.conversationSummaries.set(phone, {
                lastIntent: response.intention,
                lastMedicament: response.medicament,
                timestamp: Date.now()
            });

            log('info', `✅ ${model.name} (${model.current}/${model.quota})`);
            
            return response;

        } catch (error) {
            log('error', `Erreur callLLM: ${error.message}`);
            
            if (error.message.includes('429') || error.message.includes('rate_limit')) {
                const model = this.currentModelForConversation.get(phone);
                if (model) {
                    model.cooldownUntil = Date.now() + 2 * 60 * 1000;
                    model.available = false;
                    this.currentModelForConversation.delete(phone);
                }
            }

            this.currentModelForConversation.delete(phone);
            return this.callLLM(phone, message, historique, orderContext, retryCount + 1);
        }
    }

    buildPrompt(message, historique, orderContext) {
        const recentHistory = historique.slice(-3).map(m => ({
            role: m.role,
            content: m.content.substring(0, 100)
        }));

        let orderInfo = '';
        if (orderContext?.items?.length > 0) {
            orderInfo = `\nCommande: ${orderContext.items.length} article(s)`;
        }

        const summary = this.conversationSummaries.get(phone);
        const modelChangeNote = summary ? `\nRésumé: ${summary.lastIntent}` : '';

        return {
            systemPrompt: (this.getSystemPrompt() + orderInfo + modelChangeNote).substring(0, 1500),
            messages: recentHistory,
            currentMessage: message.substring(0, 200)
        };
    }

    async callGroq(prompt, model) {
        const groq = new Groq({ apiKey: GROQ_API_KEY });

        const messages = [
            { role: "system", content: prompt.systemPrompt },
            ...prompt.messages,
            { role: "user", content: prompt.currentMessage }
        ];

        const completion = await groq.chat.completions.create({
            model: model.model,
            messages: messages,
            temperature: 0.7,
            max_completion_tokens: 150,
            response_format: { type: "json_object" },
            timeout: 10000
        });

        return JSON.parse(completion.choices[0].message.content);
    }

    async callGithub(prompt, model) {
        const messages = [
            { role: "system", content: prompt.systemPrompt },
            ...prompt.messages,
            { role: "user", content: prompt.currentMessage }
        ];

        const response = await axios.post(
            'https://models.inference.ai.azure.com/chat/completions',
            {
                model: model.model,
                messages: messages,
                temperature: 0.7,
                max_tokens: 150
            },
            {
                headers: {
                    'Authorization': `Bearer ${this.githubToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        return JSON.parse(response.data.choices[0].message.content);
    }

    async checkAndSwitchBack(phone) {
        if (await this.isModelAvailable(this.models.principal)) {
            const current = this.currentModelForConversation.get(phone);
            if (current && current.provider !== 'groq') {
                log('info', `🔄 Retour à Groq pour ${phone}`);
                this.currentModelForConversation.set(phone, this.models.principal);
            }
        }
    }

    getStats() {
        return {
            principal: {
                used: this.models.principal.current,
                quota: this.models.principal.quota,
                remaining: this.models.principal.quota - this.models.principal.current
            },
            secours: this.models.secours.map(m => ({
                name: m.name,
                used: m.current,
                quota: m.quota,
                remaining: m.quota - m.current
            })),
            supportRedirects: this.supportRedirects
        };
    }
}

// ===========================================
// ORDER MANAGER
// ===========================================
class OrderManager {
    constructor() {
        this.orders = new Map();
        this.completedOrders = new Map();
        this.waitingForQuantity = new Map();
        this.waitingForInfo = new Map();
        this.db = pool;
    }

    async init() {
        try {
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS orders (
                    order_code VARCHAR(6) PRIMARY KEY,
                    phone VARCHAR(20) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    items JSONB NOT NULL,
                    customer_info JSONB NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    feedback TEXT,
                    rating INTEGER
                );
            `);
            
            await this.db.query(`
                CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
                CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            `);
            
            log('info', 'Table orders prête');
        } catch (error) {
            log('error', `Order init error: ${error.message}`);
        }
    }

    getOrCreateOrder(phone) {
        if (!this.orders.has(phone)) {
            this.orders.set(phone, new Order(phone));
        }
        return this.orders.get(phone);
    }

    getOrder(phone) {
        return this.orders.get(phone);
    }

    clearOrder(phone) {
        this.orders.delete(phone);
        this.waitingForQuantity.delete(phone);
        this.waitingForInfo.delete(phone);
    }

    setWaitingForQuantity(phone, medicament) {
        this.waitingForQuantity.set(phone, medicament);
    }

    getWaitingForQuantity(phone) {
        return this.waitingForQuantity.get(phone);
    }

    clearWaitingForQuantity(phone) {
        this.waitingForQuantity.delete(phone);
    }

    setWaitingForInfo(phone, field) {
        this.waitingForInfo.set(phone, field);
    }

    getWaitingForInfo(phone) {
        return this.waitingForInfo.get(phone);
    }

    clearWaitingForInfo(phone) {
        this.waitingForInfo.delete(phone);
    }

    async saveOrder(order) {
        try {
            await this.db.query(
                `INSERT INTO orders (order_code, phone, status, items, customer_info, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (order_code) DO UPDATE SET
                    status = EXCLUDED.status,
                    items = EXCLUDED.items,
                    customer_info = EXCLUDED.customer_info,
                    updated_at = EXCLUDED.updated_at`,
                [
                    order.orderCode,
                    order.phone,
                    order.status,
                    JSON.stringify(order.items),
                    JSON.stringify(order.customerInfo),
                    order.createdAt,
                    order.updatedAt
                ]
            );
            
            this.completedOrders.set(order.orderCode, order);
            log('info', `Commande ${order.orderCode} sauvegardée`);
            return true;
        } catch (error) {
            log('error', `Save order error: ${error.message}`);
            return false;
        }
    }

    async addFeedback(orderCode, rating, feedback) {
        try {
            await this.db.query(
                'UPDATE orders SET rating = $1, feedback = $2 WHERE order_code = $3',
                [rating, feedback, orderCode]
            );
            return true;
        } catch (error) {
            log('error', `Add feedback error: ${error.message}`);
            return false;
        }
    }
}

// ===========================================
// CONVERSATION MANAGER
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.whatsapp = new WhatsAppService();
        this.fuse = new FuseService();
        this.modelSwitcher = new SmartModelSwitcher();
        this.orders = new OrderManager();
        this.processedMessages = new Set();
    }

    async init() {
        await this.fuse.initialize();
        await this.orders.init();
        log('info', '🚀 MARIAM IA prête');
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                historique: [],
                derniereActivite: Date.now(),
                lastSearchTerm: null,
                lastSelectedMedicament: null
            });
        }
        return this.conversations.get(phone);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, messageId } = input;

        if (this.processedMessages.has(messageId)) return;
        this.processedMessages.add(messageId);

        try {
            await this.whatsapp.sendTyping(phone);

            // IMAGE
            if (mediaId) {
                await this.whatsapp.sendMessage(phone, "J'analyse ton image... 📸");
                
                const media = await this.whatsapp.downloadMedia(mediaId);
                if (!media.success) {
                    await this.whatsapp.sendMessage(phone, "Image non téléchargée. Envoie le nom par texte.");
                    return;
                }

                await this.whatsapp.sendMessage(phone, "Fonction image bientôt disponible !");
                return;
            }

            // TEXTE
            if (text) {
                conv.historique.push({
                    role: "user",
                    content: text,
                    timestamp: Date.now()
                });

                // Attente quantité
                const waitingForQty = this.orders.getWaitingForQuantity(phone);
                if (waitingForQty && /^\d+$/.test(text)) {
                    const quantite = parseInt(text);
                    if (quantite > 0 && quantite <= 100) {
                        const order = this.orders.getOrCreateOrder(phone);
                        order.addItem(waitingForQty, quantite);
                        this.orders.clearWaitingForQuantity(phone);
                        
                        await this.whatsapp.sendMessage(phone, 
                            `✅ Ajouté : ${quantite} x ${waitingForQty.nom_commercial}\n\n` +
                            `Autre chose ? (nom ou "commander")`);
                        return;
                    }
                }

                // Attente infos
                const waitingForInfo = this.orders.getWaitingForInfo(phone);
                if (waitingForInfo) {
                    await this.handleInfoCollection(phone, text);
                    return;
                }

                // LLM
                const order = this.orders.getOrder(phone);
                const orderContext = order ? {
                    items: order.items,
                    customerInfo: order.customerInfo,
                    isComplete: order.isComplete()
                } : null;

                const comprehension = await this.modelSwitcher.callLLM(phone, text, conv.historique, orderContext);
                await this.modelSwitcher.checkAndSwitchBack(phone);
                await this.handleIntention(phone, comprehension, conv, order);

                if (comprehension.intention !== 'support') {
                    conv.historique.push({
                        role: "assistant",
                        content: comprehension.reponse,
                        timestamp: Date.now()
                    });
                }
            }

            conv.derniereActivite = Date.now();

        } catch (error) {
            log('error', `Process error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, `⚠️ Contacte le support : *${SUPPORT_PHONE}*`);
        }
    }

    async handleInfoCollection(phone, text) {
        const order = this.orders.getOrder(phone);
        if (!order) return;

        const field = this.orders.getWaitingForInfo(phone);

        switch(field) {
            case 'nom':
                order.customerInfo.nomComplet = text;
                this.orders.setWaitingForInfo(phone, 'quartier');
                await this.whatsapp.sendMessage(phone, `Quartier ?`);
                break;
            case 'quartier':
                order.customerInfo.quartier = text;
                this.orders.setWaitingForInfo(phone, 'age');
                await this.whatsapp.sendMessage(phone, `Âge ?`);
                break;
            case 'age':
                if (/^\d+$/.test(text) && parseInt(text) > 0 && parseInt(text) < 120) {
                    order.customerInfo.age = parseInt(text);
                    this.orders.setWaitingForInfo(phone, 'taille');
                    await this.whatsapp.sendMessage(phone, `Taille (cm) ?`);
                }
                break;
            case 'taille':
                if (/^\d+$/.test(text) && parseInt(text) > 50 && parseInt(text) < 250) {
                    order.customerInfo.taille = parseInt(text);
                    this.orders.setWaitingForInfo(phone, 'poids');
                    await this.whatsapp.sendMessage(phone, `Poids (kg) ?`);
                }
                break;
            case 'poids':
                if (/^\d+$/.test(text) && parseInt(text) > 20 && parseInt(text) < 200) {
                    order.customerInfo.poids = parseInt(text);
                    this.orders.setWaitingForInfo(phone, 'contact');
                    await this.whatsapp.sendMessage(phone, `Numéro de contact ?`);
                }
                break;
            case 'contact':
                order.customerInfo.telephoneContact = text;
                this.orders.setWaitingForInfo(phone, 'indications');
                await this.whatsapp.sendMessage(phone, `Indications ? (ou "non")`);
                break;
            case 'indications':
                if (text.toLowerCase() !== 'non') {
                    order.customerInfo.indications = text;
                }
                this.orders.clearWaitingForInfo(phone);
                await this.whatsapp.sendMessage(phone, 
                    order.getSummary() + "\n\nconfirmer / modifier / annuler");
                break;
            case 'rating':
                if (/^[1-5]$/.test(text)) {
                    this.orders.setWaitingForInfo(phone, 'comment');
                    await this.whatsapp.sendMessage(phone, `Commentaire ?`);
                }
                break;
            case 'comment':
                const lastOrder = Array.from(this.orders.completedOrders.values())
                    .filter(o => o.phone === phone)
                    .sort((a, b) => b.createdAt - a.createdAt)[0];
                if (lastOrder) {
                    await this.orders.addFeedback(lastOrder.orderCode, 5, text);
                }
                await this.whatsapp.sendMessage(phone, `Merci ! 🙏`);
                this.orders.clearWaitingForInfo(phone);
                break;
        }
    }

    async handleIntention(phone, comprehension, conv, order) {
        const text = comprehension.reponse;

        switch(comprehension.intention) {
            case 'search':
                if (comprehension.medicament) {
                    const results = await this.fuse.search(comprehension.medicament, 3);
                    if (results.length > 0) {
                        let reponse = `Trouvé :\n\n`;
                        results.forEach((med, i) => {
                            reponse += `${i+1}. *${med.nom_commercial}* - ${med.prix}F\n`;
                        });
                        reponse += `\nLequel ? (1,2,3)`;
                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.lastSelectedMedicament = results;
                    } else {
                        await this.whatsapp.sendMessage(phone, `"${comprehension.medicament}" non trouvé.`);
                    }
                }
                break;

            case 'add_item':
                if (/^\d+$/.test(comprehension.quantite) && conv.lastSelectedMedicament) {
                    const quantite = parseInt(comprehension.quantite);
                    const selected = conv.lastSelectedMedicament[0];
                    this.orders.setWaitingForQuantity(phone, selected);
                    await this.whatsapp.sendMessage(phone, `Quantité pour ${selected.nom_commercial} ?`);
                } else {
                    await this.whatsapp.sendMessage(phone, text);
                }
                break;

            case 'order':
                if (!order || order.items.length === 0) {
                    await this.whatsapp.sendMessage(phone, "Commence par choisir un médicament.");
                } else {
                    this.orders.setWaitingForInfo(phone, 'nom');
                    await this.whatsapp.sendMessage(phone, "Nom complet ?");
                }
                break;

            case 'confirm_order':
                if (order && order.isComplete()) {
                    order.status = 'confirmed';
                    await this.whatsapp.sendOrderToSupport(order);
                    await this.orders.saveOrder(order);
                    
                    await this.whatsapp.sendMessage(phone, 
                        `✅ *COMMANDE CONFIRMÉE*\n\nCode : *${order.orderCode}*\n\nLe support te contacte.`);
                    
                    this.orders.clearOrder(phone);
                    
                    setTimeout(async () => {
                        await this.whatsapp.sendMessage(phone, `Note (1-5) ?`);
                        this.orders.setWaitingForInfo(phone, 'rating');
                    }, 60000);
                }
                break;

            case 'cancel_order':
                if (order) {
                    order.status = 'cancelled';
                    await this.orders.saveOrder(order);
                    this.orders.clearOrder(phone);
                    await this.whatsapp.sendMessage(phone, "❌ Commande annulée.");
                }
                break;

            case 'delivery':
                const delivery = Utils.getDeliveryPrice();
                await this.whatsapp.sendMessage(phone,
                    `🚚 Livraison : ${delivery.price}F (${delivery.period})`);
                break;

            case 'creator':
                await this.whatsapp.sendMessage(phone,
                    "👨‍💻 Créée par Youssef - UPSP 2026");
                break;

            case 'support':
            case 'greet':
            default:
                await this.whatsapp.sendMessage(phone, text);
                break;
        }
    }
}

// ===========================================
// BASE DE DONNÉES
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
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicaments_nom ON medicaments(nom_commercial);`);
    log('info', 'Base de données prête');
}

// ===========================================
// SERVEUR EXPRESS
// ===========================================
const app = express();
const bot = new ConversationManager();

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

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
            await bot.process(phone, { 
                text: msg.text.body, 
                messageId: msg.id 
            });
        } else if (msg.type === 'image') {
            await bot.process(phone, { 
                mediaId: msg.image.id, 
                messageId: msg.id 
            });
        } else if (msg.type === 'audio') {
            await bot.whatsapp.sendMessage(phone, "Texte ou image seulement stp ! 📸");
        }
    } catch (error) {
        log('error', `Webhook error: ${error.message}`);
    }
});

app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        conversations: bot.conversations.size,
        redis: redis ? 'ok' : 'fallback',
        db: 'checking'
    };

    try {
        await pool.query('SELECT 1');
        health.db = 'ok';
    } catch {
        health.db = 'error';
    }

    res.json(health);
});

app.get('/api/stats', (req, res) => {
    res.json(bot.modelSwitcher.getStats());
});

setInterval(() => {
    const now = Date.now();
    for (const [phone, conv] of bot.conversations) {
        if (now - conv.derniereActivite > 30 * 60 * 1000) {
            bot.conversations.delete(phone);
        }
    }
}, 5 * 60 * 1000);

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
║   🚀 MARIAM IA - PRODUCTION                              ║
║   📍 San Pedro, Côte d'Ivoire                            ║
║                                                           ║
║   📦 Commandes complètes                                 ║
║   🔄 Bascule Groq → GPT-4o → Llama → Mistral → Support  ║
║   💬 100% IA - 0 réponse en dur                          ║
║                                                           ║
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                            ║
║   👨‍💻 Créé par Youssef - UPSP 2026                       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        log('error', `Fatal: ${error.message}`);
        process.exit(1);
    }
}

start();
