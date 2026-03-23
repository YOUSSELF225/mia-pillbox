// MARIAM IA - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// Version: 4.0 - Optimisée pour scale
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
const helmet = require('helmet');
const morgan = require('morgan');

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

// Configuration livraison
const DELIVERY_CONFIG = {
    PRICES: { DAY: 400, NIGHT: 600 },
    DELIVERY_TIME: 45
};

// Configuration timeouts
const TIMEOUTS = {
    WHATSAPP: 10000,
    MEDIA: 15000,
    GROQ: 30000,
    REDIS: 5000
};

// ===========================================
// LOGGER
// ===========================================
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

function log(level, message, meta = {}) {
    const logMessage = meta && Object.keys(meta).length ? `${message} ${JSON.stringify(meta)}` : message;
    logger.log(level, logMessage);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[${new Date().toISOString()}] ${logMessage}`);
    }
}

// ===========================================
// REDIS (Valkey) CACHE
// ===========================================
let redis;
try {
    redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => Math.min(times * 100, 5000),
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        connectTimeout: TIMEOUTS.REDIS
    });
    redis.on('error', (err) => log('error', `Redis: ${err.message}`));
    redis.on('connect', () => log('info', 'Redis connecté'));
} catch (error) {
    log('error', `Redis non disponible: ${error.message}`);
    redis = null;
}

// Cache hybride
class HybridCache {
    constructor() {
        this.localCache = new NodeCache({ stdTTL: 3600, checkperiod: 120, maxKeys: 10000 });
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

    async del(key) {
        if (redis) {
            try {
                await redis.del(key);
            } catch {}
        }
        this.localCache.del(key);
    }
}

const cache = new HybridCache();
const processedMessages = new NodeCache({ stdTTL: 600, checkperiod: 120 });
const userRateLimits = new NodeCache({ stdTTL: 60 });

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
        let phone = SUPPORT_PHONE.replace(/\D/g, '');
        if (!phone.startsWith('225')) {
            phone = '225' + phone;
        }
        return `https://wa.me/${phone}`;
    }

    static getOrderLink() {
        let phone = SUPPORT_PHONE.replace(/\D/g, '');
        if (!phone.startsWith('225')) {
            phone = '225' + phone;
        }
        const message = encodeURIComponent("L'IA Mariam m'a dit pour commander de vous contacter");
        return `https://wa.me/${phone}?text=${message}`;
    }

    static formatOrderMessage(medicaments) {
        const delivery = this.getDeliveryPrice();
        const orderLink = this.getOrderLink();
        
        let message = "";
        
        if (medicaments && medicaments.length > 0) {
            medicaments.forEach((med, idx) => {
                message += `${idx+1}. ${med.nom_commercial} : ${med.prix}F\n`;
            });
        }
        
        message += `\n📦 Livraison à San Pedro uniquement : ${delivery.price}F (${delivery.period}), délai ${delivery.time}min 🚚`;
        message += `\n\n💊 Pour commander, clique ici :\n${orderLink}`;
        
        return message;
    }

    static formatNotFoundMessage(medicamentName) {
        return `Désolé, je n'ai pas trouvé "${medicamentName}" dans ma base. 💊\n\nPeux-tu vérifier l'orthographe ou envoyer une photo de l'emballage ? 📸`;
    }

    static getWelcomeMessage() {
        const delivery = this.getDeliveryPrice();
        return `Salut ! 👋\n\nJe suis MARIAM, ton IA santé à San Pedro 💊\n\n🔍 Je cherche tes médicaments\n💰 Prix transparents\n🚚 Livraison rapide (${delivery.price}F, ${delivery.time}min)\n\nComment utiliser MARIAM :\n📝 Envoie le nom du médicament\n📸 Envoie une photo du médicament\n📋 Envoie une photo de l'ordonnance\n\nQu'est-ce qu'il te faut aujourd'hui ?`;
    }

    static getCreatorMessage() {
        return `J'ai été créée par Yousself, étudiant en Licence 2 à l'UPSP, aidé et soutenu par son ami Coulibaly Yaya. 🎓\n\nC'est dans sa chambre d'étudiant qu'il m'a donnée vie en mars 2026 💙\n\nUne belle histoire d'amitié et d'innovation !`;
    }
}

// ===========================================
// BASE DE DONNÉES POSTGRESQL
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => log('error', `DB Error: ${err.message}`));

// ===========================================
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    constructor() {
        this.lastTyping = new NodeCache({ stdTTL: 10 });
    }

    async sendMessage(to, text) {
        try {
            if (!text) text = Utils.getWelcomeMessage();
            const safeText = text.substring(0, 4096);
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: safeText }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: TIMEOUTS.WHATSAPP
            });
            return true;
        } catch (error) {
            log('error', `WhatsApp send error: ${error.message}`, { to });
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
                    timeout: TIMEOUTS.WHATSAPP / 2
                });
                this.lastTyping.set(to, Date.now());
            }
        } catch (error) {}
    }

    async downloadMedia(mediaId) {
        try {
            const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }, timeout: TIMEOUTS.MEDIA }
            );
            const imageUrl = mediaResponse.data.url;
            const fileResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: TIMEOUTS.MEDIA
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
            log('error', `Media download error: ${error.message}`, { mediaId });
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
                timeout: TIMEOUTS.WHATSAPP / 2
            });
        } catch (error) {}
    }
}

// ===========================================
// FUSE SERVICE - Recherche floue
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
// LLM SERVICE - Groq avec Rate Limit Management
// ===========================================
class LLMService {
    constructor() {
        this.client = new Groq({ apiKey: GROQ_API_KEY });
        this.models = {
            vision: "meta-llama/llama-4-scout-17b-16e-instruct",
            text: "llama-3.3-70b-versatile"
        };
        this.cache = cache;
        
        this.rateLimitUntil = null;
        this.retryCount = 0;
        this.maxRetryDelay = 3 * 60 * 60 * 1000;
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        const creatorMessage = Utils.getCreatorMessage();
        
        return `Tu es MARIAM, une IA santé à San Pedro, Côte d'Ivoire.

TON RÔLE : Aider les gens à trouver des médicaments.

3 FAÇONS DE T'UTILISER :
1. Par texte : l'utilisateur donne le nom d'un médicament
2. Par image : l'utilisateur envoie une photo du médicament
3. Par ordonnance : l'utilisateur envoie une photo de l'ordonnance

RÈGLES IMPORTANTES :
- Sois concise et utile
- Utilise des emojis discrets (💊 🚚 📸)
- Ne répète pas la présentation complète après le premier message
- Réponds naturellement comme une IA santé

CONTEXTE :
- Livraison: ${delivery.price}F (${delivery.period}), délai: ${delivery.time}min
- Support: ${supportLink}
- Créateur: ${creatorMessage}

FORMAT DE REPONSE (JSON uniquement) :
{
    "intention": "greet|search|support|delivery|creator|purpose|unknown",
    "medicament": "nom extrait ou null",
    "reponse": "ta réponse courte et naturelle"
}`;
    }

    async _handleRateLimit(error) {
        let waitTime = 60 * 60 * 1000;
        
        const match = error.message.match(/try again in (\d+)m(\d+)s/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            waitTime = (minutes * 60 + seconds) * 1000;
        }
        
        const exponentialDelay = waitTime * Math.pow(2, this.retryCount);
        const finalDelay = Math.min(exponentialDelay, this.maxRetryDelay);
        
        this.rateLimitUntil = Date.now() + finalDelay;
        this.retryCount++;
        
        log('warn', `Rate limit - retry ${this.retryCount}, waiting ${finalDelay/1000}s`);
        
        return finalDelay;
    }

    async _executeWithRetry(apiCall) {
        if (this.rateLimitUntil && Date.now() < this.rateLimitUntil) {
            const waitSeconds = Math.ceil((this.rateLimitUntil - Date.now()) / 1000);
            throw new Error(`RATE_LIMIT_ACTIVE: Attendre ${waitSeconds}s`);
        }
        
        try {
            const result = await apiCall();
            this.retryCount = 0;
            this.rateLimitUntil = null;
            return result;
        } catch (error) {
            if (error.message.includes('rate_limit_exceeded') || error.status === 429) {
                await this._handleRateLimit(error);
                throw new Error(`RATE_LIMIT:${Date.now()}`);
            }
            throw error;
        }
    }

    async comprendre(message, historique = []) {
        const cacheKey = `comprendre:${Utils.normalizeText(message).substring(0, 50)}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const result = await this._executeWithRetry(async () => {
                const completion = await this.client.chat.completions.create({
                    model: this.models.text,
                    messages: [
                        { role: "system", content: this.getSystemPrompt() },
                        { role: "user", content: `Message: "${message}"\nHistorique: ${JSON.stringify(historique.slice(-3))}` }
                    ],
                    temperature: 0.7,
                    max_completion_tokens: 300,
                    response_format: { type: "json_object" }
                });
                return JSON.parse(completion.choices[0].message.content);
            });
            
            await this.cache.set(cacheKey, result, 3600);
            return result;
            
        } catch (error) {
            log('error', `Comprendre error: ${error.message}`);
            return this._fallbackComprendre(message);
        }
    }

    _fallbackComprendre(message) {
        const msg = message.toLowerCase();
        
        if (msg.match(/salut|bonjour|hi|hello|yo|coucou|bonsoir/)) {
            return {
                intention: "greet",
                medicament: null,
                reponse: "Salut ! Tu cherches un médicament ? Donne-moi le nom 💊"
            };
        }
        
        if (msg.match(/comment|aide|help|fonctionne|utiliser|marche/)) {
            return {
                intention: "purpose",
                medicament: null,
                reponse: "Avec MARIAM c'est simple ! 💊\n\n📝 Écris le nom du médicament\n📸 Envoie une photo du médicament\n📋 Envoie une photo de l'ordonnance"
            };
        }
        
        if (msg.match(/ton nom|qui es-tu|t'appelles/)) {
            return {
                intention: "greet",
                medicament: null,
                reponse: "Je m'appelle MARIAM ! 💊\n\nJe t'aide à trouver tes médicaments à San Pedro. Donne-moi le nom de ce que tu cherches !"
            };
        }
        
        if (msg.match(/que fais|tu fais quoi|utilité|rôle/)) {
            return {
                intention: "purpose",
                medicament: null,
                reponse: "Je cherche tes médicaments et je te donne les prix ! 💊\n\nDonne-moi le nom de ce que tu veux."
            };
        }
        
        if (msg.match(/qui t'as crée|qui t'a crée|ton créateur|yousself|qui t'a fait/)) {
            return {
                intention: "creator",
                medicament: null,
                reponse: Utils.getCreatorMessage()
            };
        }
        
        if (msg.match(/livraison|prix livraison|frais de livraison|combien livraison/)) {
            const delivery = Utils.getDeliveryPrice();
            return {
                intention: "delivery",
                medicament: null,
                reponse: `Livraison à San Pedro uniquement :\n\n- Jour : ${DELIVERY_CONFIG.PRICES.DAY}F\n- Nuit : ${DELIVERY_CONFIG.PRICES.NIGHT}F\n- Délai : ${DELIVERY_CONFIG.DELIVERY_TIME} min 🚚`
            };
        }
        
        if (msg.match(/commander|comment commander|acheter/)) {
            const orderLink = Utils.getOrderLink();
            return {
                intention: "support",
                medicament: null,
                reponse: `Pour commander, contacte le support 📲\n\nClique ici : ${orderLink}`
            };
        }
        
        let cleanMsg = message;
        cleanMsg = cleanMsg.replace(/[?]/g, '');
        const separators = /[,;]|\s+et\s+|\s*,\s*|\s*;\s*|\s+/i;
        const parts = cleanMsg.split(separators);
        
        const medicaments = [];
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.length > 2 && !trimmed.match(/^[a-z]{1,3}$/i)) {
                medicaments.push(trimmed);
            }
        }
        
        if (medicaments.length > 0) {
            return {
                intention: "search",
                medicament: medicaments.join(','),
                reponse: `Je cherche ${medicaments.join(', ')} pour toi ! 🔍`
            };
        }
        
        return {
            intention: "unknown",
            medicament: null,
            reponse: "Donne-moi le nom d'un médicament, je te donne le prix et la disponibilité ! 💊\n\nExemple : Doliprane, Ibuprofène..."
        };
    }

    async analyserImage(imageBuffer) {
        try {
            log('info', `Analyse d'image - Taille: ${imageBuffer.length} bytes`);
            
            const result = await this._executeWithRetry(async () => {
                const base64Image = imageBuffer.toString('base64');
                
                const completion = await this.client.chat.completions.create({
                    model: this.models.vision,
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: `Analyse cette image et liste TOUS les médicaments que tu vois.
Si c'est une ordonnance, extrais les noms des médicaments.
Réponds UNIQUEMENT au format JSON : {"medicaments": ["nom1", "nom2"]}
Si tu ne vois aucun médicament, réponds : {"medicaments": []}`
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
                    max_completion_tokens: 500,
                    response_format: { type: "json_object" }
                });
                
                const responseText = completion.choices[0].message.content;
                log('info', `Vision response: ${responseText}`);
                
                try {
                    const parsed = JSON.parse(responseText);
                    if (parsed.medicaments && Array.isArray(parsed.medicaments)) {
                        log('info', `Médicaments détectés: ${parsed.medicaments.join(', ')}`);
                        return parsed;
                    }
                    return { medicaments: [] };
                } catch (parseError) {
                    log('error', `JSON parse error: ${parseError.message}`);
                    return { medicaments: [] };
                }
            });
            
            return result;
            
        } catch (error) {
            log('error', `Analyser image error: ${error.message}`);
            return { medicaments: [] };
        }
    }
}

// ===========================================
// CONVERSATION MANAGER - Cœur de l'IA
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.whatsapp = new WhatsAppService();
        this.fuse = new FuseService();
        this.llm = new LLMService();
        this.processedMessages = new Set();
    }

    async init() {
        await this.fuse.initialize();
        log('info', '🚀 MARIAM IA prête');
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                historique: [],
                derniereActivite: Date.now(),
                firstMessage: true,
                welcomeSent: false,
                messageCount: 0
            });
        }
        return this.conversations.get(phone);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, messageId } = input;

        if (this.processedMessages.has(messageId)) return;
        this.processedMessages.add(messageId);
        
        // Rate limiting par utilisateur (max 10 messages/minute)
        const userLimit = userRateLimits.get(phone) || 0;
        if (userLimit > 10) {
            await this.whatsapp.sendMessage(phone, "Trop de messages ! Attends un peu avant d'envoyer un nouveau message ⏱️");
            return;
        }
        userRateLimits.set(phone, userLimit + 1, 60);

        try {
            await this.whatsapp.sendTyping(phone);

            // Premier message : UNIQUEMENT la bienvenue, pas de traitement
            if (conv.firstMessage && !conv.welcomeSent) {
                conv.firstMessage = false;
                conv.welcomeSent = true;
                
                const welcomeMsg = Utils.getWelcomeMessage();
                await this.whatsapp.sendMessage(phone, welcomeMsg);
                
                conv.historique.push({
                    role: "assistant",
                    content: welcomeMsg,
                    timestamp: Date.now()
                });
                
                if (text) {
                    conv.historique.push({
                        role: "user",
                        content: text,
                        timestamp: Date.now()
                    });
                }
                
                conv.derniereActivite = Date.now();
                return;
            }

            // Après la bienvenue, traiter normalement
            if (text) {
                conv.historique.push({
                    role: "user",
                    content: text,
                    timestamp: Date.now()
                });
                await this.processUserMessage(phone, text, conv);
            } else if (mediaId) {
                await this.processImageMessage(phone, mediaId, conv);
            }

            conv.derniereActivite = Date.now();
            conv.messageCount++;

        } catch (error) {
            log('error', `Process error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                "Désolé, erreur technique ! Réessaie dans une minute ⏱️");
        }
    }

    async processUserMessage(phone, text, conv) {
        const comprehension = await this.llm.comprendre(text, conv.historique);
        
        if (comprehension.intention === "search" && comprehension.medicament) {
            let medicamentsToSearch = [];
            const rawMed = comprehension.medicament;
            
            const separators = /[,;]|\s+et\s+|\s*,\s*|\s*;\s*|\s+/i;
            const parts = rawMed.split(separators);
            
            for (const part of parts) {
                const cleanPart = part.trim();
                if (cleanPart.length > 2) {
                    medicamentsToSearch.push(cleanPart);
                }
            }
            
            const allResults = [];
            const notFound = [];
            
            for (const med of medicamentsToSearch) {
                const results = await this.fuse.search(med, 1);
                if (results.length > 0) {
                    allResults.push(results[0]);
                } else {
                    notFound.push(med);
                }
            }
            
            if (allResults.length > 0) {
                const reponse = Utils.formatOrderMessage(allResults);
                await this.whatsapp.sendMessage(phone, reponse);
                
                if (notFound.length > 0) {
                    const notFoundMsg = `\n\n⚠️ Je n'ai pas trouvé : ${notFound.join(', ')}\nVérifie l'orthographe ou envoie une photo 📸`;
                    await this.whatsapp.sendMessage(phone, notFoundMsg);
                }
                
                conv.historique.push({
                    role: "assistant",
                    content: reponse,
                    timestamp: Date.now()
                });
            } else {
                const reponse = Utils.formatNotFoundMessage(medicamentsToSearch.join(', '));
                await this.whatsapp.sendMessage(phone, reponse);
                
                conv.historique.push({
                    role: "assistant",
                    content: reponse,
                    timestamp: Date.now()
                });
            }
        } 
        else if (comprehension.intention === "delivery") {
            const delivery = Utils.getDeliveryPrice();
            const reponse = `Livraison à San Pedro uniquement :\n\n- Jour : ${DELIVERY_CONFIG.PRICES.DAY}F\n- Nuit : ${DELIVERY_CONFIG.PRICES.NIGHT}F\n- Délai : ${DELIVERY_CONFIG.DELIVERY_TIME} min 🚚`;
            await this.whatsapp.sendMessage(phone, reponse);
            
            conv.historique.push({
                role: "assistant",
                content: reponse,
                timestamp: Date.now()
            });
        }
        else if (comprehension.intention === "support" || 
                 text.toLowerCase().match(/commander|comment commander|support/)) {
            const orderLink = Utils.getOrderLink();
            const reponse = `Pour commander, contacte le support 📲\n\nClique ici : ${orderLink}`;
            await this.whatsapp.sendMessage(phone, reponse);
            
            conv.historique.push({
                role: "assistant",
                content: reponse,
                timestamp: Date.now()
            });
        }
        else if (comprehension.intention === "creator") {
            const reponse = Utils.getCreatorMessage();
            await this.whatsapp.sendMessage(phone, reponse);
            
            conv.historique.push({
                role: "assistant",
                content: reponse,
                timestamp: Date.now()
            });
        }
        else {
            let reponse = comprehension.reponse;
            
            if (!reponse || reponse.trim() === "") {
                reponse = "Donne-moi le nom d'un médicament, je te donne le prix ! 💊";
            }
            
            await this.whatsapp.sendMessage(phone, reponse);
            
            conv.historique.push({
                role: "assistant",
                content: reponse,
                timestamp: Date.now()
            });
        }
    }

    async processImageMessage(phone, mediaId, conv) {
        await this.whatsapp.sendMessage(phone, "J'analyse ton image... 📸");
        
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, "Je n'ai pas pu télécharger l'image. Envoie le nom du médicament par texte stp !");
            return;
        }

        const visionResult = await this.llm.analyserImage(media.buffer);
        
        if (visionResult.medicaments && visionResult.medicaments.length > 0) {
            const results = [];
            const notFound = [];
            
            for (const med of visionResult.medicaments) {
                const searchResults = await this.fuse.search(med, 1);
                if (searchResults.length > 0) {
                    results.push(searchResults[0]);
                } else {
                    notFound.push(med);
                }
            }

            if (results.length > 0) {
                const reponse = "Médicaments détectés ! 📸\n\n" + 
                    Utils.formatOrderMessage(results);
                
                await this.whatsapp.sendMessage(phone, reponse);
                
                if (notFound.length > 0) {
                    const notFoundMsg = `\n\n⚠️ Je n'ai pas trouvé dans ma base : ${notFound.join(', ')}`;
                    await this.whatsapp.sendMessage(phone, notFoundMsg);
                }
                
                conv.historique.push({
                    role: "assistant",
                    content: reponse,
                    timestamp: Date.now()
                });
            } else {
                const reponse = Utils.formatNotFoundMessage(notFound.join(', '));
                await this.whatsapp.sendMessage(phone, reponse);
                
                conv.historique.push({
                    role: "assistant",
                    content: reponse,
                    timestamp: Date.now()
                });
            }
        } else {
            await this.whatsapp.sendMessage(phone, 
                "Je ne vois pas de médicament clairement sur cette image. 📸\n\n" +
                "Essaie de :\n" +
                "📝 Envoyer le nom par texte\n" +
                "📸 Prendre une photo plus nette\n\n" +
                "Qu'est-ce que tu cherches ?");
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
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicaments_nom ON medicaments(nom_commercial);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicaments_dci ON medicaments(dci);`);

    log('info', 'Base de données prête');
}

// ===========================================
// SERVEUR EXPRESS
// ===========================================
const app = express();
const bot = new ConversationManager();

// Middleware de sécurité et performance
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('combined', { stream: { write: (message) => log('info', message.trim()) } }));

// Rate limiting global
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: { error: 'Trop de requêtes, réessaie plus tard' }
}));

// Logger des requêtes lentes
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (duration > 5000) {
            log('warn', `Requête lente: ${req.method} ${req.url} - ${duration}ms`);
        }
    });
    next();
});

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
    
    setImmediate(async () => {
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
                await bot.whatsapp.sendMessage(phone, 
                    "Désolé, je ne traite pas les audios. Envoie-moi du texte ou une image stp ! 📸");
            }
        } catch (error) {
            log('error', `Webhook background error: ${error.message}`);
        }
    });
});

app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        conversations: bot.conversations.size,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        redis: redis ? 'ok' : 'fallback',
        db: 'checking',
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
        version: '4.0'
    };

    try {
        await pool.query('SELECT 1');
        health.db = 'ok';
    } catch {
        health.db = 'error';
        health.status = 'degraded';
    }

    res.json(health);
});

app.get('/keep-alive', (req, res) => {
    res.status(200).send('OK');
});

// Auto-ping toutes les 10 minutes
setInterval(async () => {
    try {
        await axios.get(`http://localhost:${PORT}/health`, { timeout: 5000 });
    } catch (error) {}
}, 10 * 60 * 1000);

// Nettoyage périodique des conversations
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    for (const [phone, conv] of bot.conversations) {
        if (now - conv.derniereActivite > 30 * 60 * 1000) {
            bot.conversations.delete(phone);
            expiredCount++;
        }
    }
    if (expiredCount > 0) {
        log('info', `${expiredCount} conversations expirées nettoyées`);
    }
}, 5 * 60 * 1000);

// Nettoyage du cache des messages traités
setInterval(() => {
    processedMessages.flushAll();
    userRateLimits.flushAll();
    log('debug', 'Cache nettoyé');
}, 60 * 60 * 1000);

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    log('error', `Uncaught Exception: ${error.message}`, { stack: error.stack });
});

process.on('unhandledRejection', (reason) => {
    log('error', `Unhandled Rejection: ${reason}`);
});

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        await initDatabase();
        await bot.init();
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 MARIAM IA - PRODUCTION READY v4.0                       ║
║   📍 San Pedro, Côte d'Ivoire                                 ║
║                                                               ║
║   🤖 100% IA Conversationnelle                                ║
║   💬 Llama 3.3 70B (texte)                                   ║
║   📸 Llama 4 Scout 17B (vision)                              ║
║   🔍 Fuse.js (recherche floue)                               ║
║   🗄️ Redis + NodeCache                                        ║
║   🗃️ PostgreSQL                                               ║
║                                                               ║
║   📱 Port: ${PORT}                                            ║
║   📞 Support: ${SUPPORT_PHONE}                               ║
║   👨💻 Créé par Yousself - UPSP 2026                          ║
║                                                               ║
║   ⚡ Optimisations:                                           ║
║   - Rate limiting par utilisateur                            ║
║   - Cache hybride Redis/Memory                               ║
║   - Auto-scaling des conversations                           ║
║   - Keep-alive pour Render free                              ║
║   - Fallback sans LLM                                        ║
║   - Support images et ordonnances                            ║
║   - Gestion rate limit Groq                                  ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        log('error', `Fatal: ${error.message}`);
        process.exit(1);
    }
}

start();
