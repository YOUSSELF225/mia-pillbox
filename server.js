// MARIAM IA - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// Version Finale - Mars 2026
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
        const isNight = hour >= 23 || hour < 7;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'nuit' : 'jour',
            time: DELIVERY_CONFIG.DELIVERY_TIME
        };
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
            medicaments.slice(0, 10).forEach((med, idx) => {
                message += `${idx+1}. ${med.nom_commercial} : ${med.prix.toLocaleString()}F\n`;
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
        return `Salut ! 👋\n\nJe suis MARIAM, ton IA santé à San Pedro 💊\n\n🔍 Je cherche tes médicaments\n💰 Prix transparents\n🚚 Livraison rapide (${delivery.price}F, ${delivery.time}min)\n\nQu'est-ce qu'il te faut aujourd'hui ?`;
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

            const result = await pool.query("SELECT * FROM medicaments ORDER BY nom_commercial");
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

    async search(query, limit = 10) {
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
        const orderLink = Utils.getOrderLink();
        const creatorMessage = Utils.getCreatorMessage();
        
        return `Tu es MARIAM, une IA santé à San Pedro, Côte d'Ivoire.

STYLE PAYPARROT :
- Messages courts et clairs
- Emojis discrets (💊 🚚 📲)
- Structure: accueil → info → question

CONTEXTE :
- Livraison: ${delivery.price}F (${delivery.period}), délai: ${delivery.time}min
- Lien commande: ${orderLink}
- Créateur: ${creatorMessage}

FORMAT DE REPONSE (JSON uniquement) :
{
    "intention": "greet|search|support|delivery|creator|purpose|unknown",
    "medicament": "nom extrait ou null",
    "reponse": "ta réponse style PayParrot"
}

RÈGLES IMPORTANTES :
- Pour "qui es-tu" → dis ton nom MARIAM
- Pour "à quoi tu sers" → explique ton rôle
- Pour "comment commander" → donne le lien
- Reste naturelle et amicale`;
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
        
        if (msg.match(/qui es-tu|qui est tu|qui êtes vous|c'est quoi toi|présente-toi/)) {
            return {
                intention: "greet",
                medicament: null,
                reponse: "Je suis MARIAM ! Ton IA santé à San Pedro 💊\n\nJe t'aide à trouver des médicaments, je te donne les prix, et je te livre rapidement !\n\nQu'est-ce qu'il te faut aujourd'hui ?"
            };
        }
        
        if (msg.match(/à quoi tu sers|tu sers à quoi|ton rôle|utilité|tu fais quoi/)) {
            return {
                intention: "purpose",
                medicament: null,
                reponse: "Mon rôle c'est de t'aider à trouver tes médicaments facilement ! 💊\n\n🔍 Recherche par nom\n💰 Prix transparents\n🚚 Livraison rapide à San Pedro\n\nDonne-moi le nom d'un médicament et je le cherche pour toi !"
            };
        }
        
        if (msg.match(/salut|bonsoir|bonjour|hi|hello|yo|coucou/)) {
            return {
                intention: "greet",
                medicament: null,
                reponse: "Salut ! Je suis MARIAM 💊\n\nTu cherches un médicament ? Donne-moi le nom, je te trouve les prix et la livraison !"
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
                reponse: `Livraison à San Pedro uniquement :\n\n- Jour (7h-23h) : ${DELIVERY_CONFIG.PRICES.DAY}F\n- Nuit (23h-7h) : ${DELIVERY_CONFIG.PRICES.NIGHT}F\n- Délai : ${DELIVERY_CONFIG.DELIVERY_TIME} min 🚚`
            };
        }
        
        if (msg.match(/support|contact|aide|problème|bug|commander|comment commander/)) {
            const orderLink = Utils.getOrderLink();
            return {
                intention: "support",
                medicament: null,
                reponse: `Pour commander, c'est simple ! 📲\n\n1. Dis-moi le médicament que tu veux\n2. Je te donne les prix\n3. Clique sur le lien :\n${orderLink}\n\nLe support te répondra rapidement !`
            };
        }
        
        const words = message.split(/[\s,]+/);
        const potentialMeds = words.filter(w => w.length > 3 && !w.match(/et|le|la|les|de|du|des|pour|dans|avec/i));
        
        if (potentialMeds.length > 0) {
            return {
                intention: "search",
                medicament: message,
                reponse: `Je cherche "${message}" pour toi ! 🔍`
            };
        }
        
        return {
            intention: "unknown",
            medicament: null,
            reponse: "Je n'ai pas bien compris. Dis-moi le nom d'un médicament ou demande-moi de l'aide ! 💊"
        };
    }

    async analyserImage(imageBuffer) {
        try {
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
                                    text: "Liste les médicaments que tu vois sur cette image. Réponds uniquement avec {\"medicaments\": [\"nom1\", \"nom2\"]}"
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
                    max_completion_tokens: 300,
                    response_format: { type: "json_object" }
                });
                return JSON.parse(completion.choices[0].message.content);
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
                welcomeSent: false
            });
        }
        return this.conversations.get(phone);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, messageId } = input;

        if (processedMessages.has(messageId)) return;
        processedMessages.set(messageId, true);

        try {
            await this.whatsapp.sendTyping(phone);

            // Envoyer message de bienvenue une seule fois
            if (!conv.welcomeSent && !text && !mediaId) {
                conv.welcomeSent = true;
                const welcomeMsg = Utils.getWelcomeMessage();
                await this.whatsapp.sendMessage(phone, welcomeMsg);
                conv.historique.push({
                    role: "assistant",
                    content: welcomeMsg,
                    timestamp: Date.now()
                });
                conv.derniereActivite = Date.now();
                return;
            }

            if (text) {
                conv.historique.push({
                    role: "user",
                    content: text,
                    timestamp: Date.now()
                });
            }

            // ===========================================
            // CAS 1: IMAGE REÇUE
            // ===========================================
            if (mediaId) {
                await this.whatsapp.sendMessage(phone, "J'analyse ton image... 📸");
                
                const media = await this.whatsapp.downloadMedia(mediaId);
                if (!media.success) {
                    await this.whatsapp.sendMessage(phone, "Je n'ai pas pu télécharger l'image. Envoie le nom du médicament par texte stp !");
                    return;
                }

                const visionResult = await this.llm.analyserImage(media.buffer);
                
                if (visionResult.medicaments && visionResult.medicaments.length > 0) {
                    const allResults = [];
                    for (const med of visionResult.medicaments) {
                        const results = await this.fuse.search(med, 3);
                        allResults.push(...results);
                    }
                    
                    const uniqueResults = [];
                    const seen = new Set();
                    for (const med of allResults) {
                        if (!seen.has(med.code_produit)) {
                            seen.add(med.code_produit);
                            uniqueResults.push(med);
                        }
                    }

                    if (uniqueResults.length > 0) {
                        const reponse = "Médicaments détectés ! 📸\n\n" + 
                            Utils.formatOrderMessage(uniqueResults);
                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                    } else {
                        await this.whatsapp.sendMessage(phone, 
                            Utils.formatNotFoundMessage(visionResult.medicaments[0]));
                    }
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        "Je ne vois pas de médicament clairement. Envoie le nom par texte stp !");
                }
                
                conv.derniereActivite = Date.now();
                return;
            }

            // ===========================================
            // CAS 2: TEXTE REÇU
            // ===========================================
            if (text) {
                // Détecter les recherches multiples (séparées par "et", ",", "&")
                const multipleMatch = text.match(/(.+?)\s+(et|,|&)\s+(.+)/i);
                let searchTerms = [];
                
                if (multipleMatch) {
                    const words = text.split(/[\s,]+/);
                    searchTerms = words.filter(w => w.length > 3 && !w.match(/et|le|la|les|de|du|des|pour|dans|avec/i));
                }
                
                if (searchTerms.length > 1) {
                    let allResults = [];
                    for (const term of searchTerms) {
                        const results = await this.fuse.search(term, 3);
                        allResults.push(...results);
                    }
                    
                    const uniqueResults = [];
                    const seen = new Set();
                    for (const med of allResults) {
                        if (!seen.has(med.code_produit)) {
                            seen.add(med.code_produit);
                            uniqueResults.push(med);
                        }
                    }
                    
                    if (uniqueResults.length > 0) {
                        const reponse = "J'ai trouvé ces médicaments ! 💊\n\n" + 
                            Utils.formatOrderMessage(uniqueResults);
                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                        conv.derniereActivite = Date.now();
                        return;
                    }
                }
                
                // Recherche simple ou autre intention
                const comprehension = await this.llm.comprendre(text, conv.historique);
                
                if (comprehension.intention === "search" && comprehension.medicament) {
                    const results = await this.fuse.search(comprehension.medicament, 10);
                    
                    if (results.length > 0) {
                        const reponse = Utils.formatOrderMessage(results);
                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                    } else {
                        const reponse = Utils.formatNotFoundMessage(comprehension.medicament);
                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                    }
                } 
                else {
                    let reponse = comprehension.reponse;
                    if (!reponse || reponse.trim() === "") {
                        reponse = "Je n'ai pas bien compris. Dis-moi le nom d'un médicament ! 💊";
                    }
                    await this.whatsapp.sendMessage(phone, reponse);
                    conv.historique.push({
                        role: "assistant",
                        content: reponse,
                        timestamp: Date.now()
                    });
                }
                
                conv.derniereActivite = Date.now();
            }

        } catch (error) {
            log('error', `Process error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                "Désolé, erreur technique ! Réessaie dans une minute ⏱️");
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

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200
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
        log('error', `Webhook error: ${error.message}`);
    }
});

app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        conversations: bot.conversations.size,
        timestamp: new Date().toISOString(),
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

// Nettoyage périodique
setInterval(() => {
    const now = Date.now();
    for (const [phone, conv] of bot.conversations) {
        if (now - conv.derniereActivite > 30 * 60 * 1000) {
            bot.conversations.delete(phone);
            log('info', `Conversation expirée: ${phone}`);
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
║   🚀 MARIAM IA - PRODUCTION READY                        ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║                                                           ║
║   🤖 IA Conversationnelle                                 ║
║   💬 Llama 3.3 70B (texte)                               ║
║   📸 Llama 4 Scout 17B (vision)                          ║
║   🔍 Fuse.js (recherche floue)                           ║
║   🗄️ Redis + NodeCache                                    ║
║   🗃️ PostgreSQL                                           ║
║                                                           ║
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                           ║
║   👨💻 Créé par Yousself - UPSP 2026                      ║
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
