require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const Redis = require('ioredis');
const NodeCache = require('node-cache');
const Fuse = require('fuse.js');
const winston = require('winston');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const sharp = require('sharp');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

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
    DELIVERY_TIME: 45,
    ZONE: 'San Pedro'
};

// ===========================================
// REDIS (Valkey) CONFIGURATION
// ===========================================
let redis;
try {
    redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => Math.min(times * 100, 5000),
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
        lazyConnect: true
    });
    
    redis.on('error', (err) => {
        console.error(`❌ Redis error: ${err.message}`);
    });
    
    redis.on('connect', () => {
        console.log('✅ Redis connected (Valkey)');
    });
    
    redis.connect().catch(err => {
        console.error(`❌ Redis connection failed: ${err.message}`);
        redis = null;
    });
} catch (error) {
    console.error(`❌ Redis initialization failed: ${error.message}`);
    redis = null;
}

// ===========================================
// CACHE HYBRIDE
// ===========================================
class HybridCache {
    constructor() {
        this.localCache = new NodeCache({ 
            stdTTL: 3600,
            checkperiod: 600,
            useClones: false
        });
        this.stats = { hits: 0, misses: 0 };
    }

    async get(key) {
        if (!redis) {
            const value = this.localCache.get(key);
            if (value) this.stats.hits++;
            else this.stats.misses++;
            return value || null;
        }
        
        try {
            const value = await redis.get(key);
            if (value) {
                this.stats.hits++;
                return JSON.parse(value);
            }
            this.stats.misses++;
            return null;
        } catch (error) {
            const value = this.localCache.get(key);
            if (value) this.stats.hits++;
            else this.stats.misses++;
            return value || null;
        }
    }

    async set(key, value, ttl = 3600) {
        if (!redis) {
            this.localCache.set(key, value, ttl);
            return;
        }
        
        try {
            await redis.set(key, JSON.stringify(value), 'EX', ttl);
        } catch (error) {
            this.localCache.set(key, value, ttl);
        }
    }

    async del(key) {
        if (redis) {
            try { await redis.del(key); } catch (error) {}
        }
        this.localCache.del(key);
    }

    getStats() {
        return this.stats;
    }
}

const cache = new HybridCache();
const processedMessages = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// ===========================================
// LOGGER
// ===========================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message} ${info.stack || ''}`)
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({ 
            filename: 'combined.log', 
            maxsize: 5242880, 
            maxFiles: 5,
            format: winston.format.combine(
                winston.format.uncolorize(),
                winston.format.json()
            )
        })
    ]
});

function log(level, message, meta = {}) {
    logger.log(level, message, meta);
}

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
            time: DELIVERY_CONFIG.DELIVERY_TIME,
            zone: DELIVERY_CONFIG.ZONE
        };
    }

    static getSupportLink() {
        const phone = SUPPORT_PHONE.replace('+', '');
        return `https://wa.me/${phone}`;
    }

    static formatPhoneNumber(phone) {
        return phone.replace(/[^0-9]/g, '');
    }

    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static extractSearchTerm(text) {
        return text.replace(/^(cherche|trouve|as-tu|as tu|existe|disponible|prix de|pour|je veux|je prends|donne moi|stp|svp)\s*/i, '').trim();
    }

    static generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// ===========================================
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    constructor() {
        this.lastTyping = new NodeCache({ stdTTL: 10 });
        this.messageQueue = new Map();
    }

    async sendMessage(to, text) {
        if (!text || typeof text !== 'string') {
            text = "Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Comment puis-je t'aider ?";
        }
        
        const queueKey = `${to}:${Date.now()}`;
        if (this.messageQueue.has(queueKey)) return false;
        this.messageQueue.set(queueKey, true);
        setTimeout(() => this.messageQueue.delete(queueKey), 2000);

        try {
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
            
            log('info', `✅ Message envoyé à ${to}: ${safeText.substring(0, 50)}...`);
            return true;
        } catch (error) {
            log('error', `❌ WhatsApp send error: ${error.message}`);
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
            log('info', `📥 Téléchargement du média: ${mediaId}`);
            
            const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { 
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                    timeout: 10000 
                }
            );
            
            if (!mediaResponse.data || !mediaResponse.data.url) {
                throw new Error("URL du média non trouvée");
            }

            const imageUrl = mediaResponse.data.url;
            const mimeType = mediaResponse.data.mime_type || 'image/jpeg';
            
            const fileResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 30000,
                maxContentLength: 10 * 1024 * 1024
            });

            const buffer = Buffer.from(fileResponse.data);
            
            if (buffer.length > 4 * 1024 * 1024) {
                try {
                    const resizedBuffer = await sharp(buffer)
                        .resize(1024, 1024, { 
                            fit: 'inside',
                            withoutEnlargement: true 
                        })
                        .jpeg({ quality: 80 })
                        .toBuffer();
                    
                    return { 
                        success: true, 
                        buffer: resizedBuffer,
                        mimeType: 'image/jpeg',
                        originalSize: buffer.length
                    };
                } catch (sharpError) {
                    return { 
                        success: true, 
                        buffer: buffer,
                        mimeType: mimeType
                    };
                }
            }

            return { 
                success: true, 
                buffer: buffer,
                mimeType: mimeType 
            };

        } catch (error) {
            log('error', `❌ Media download error: ${error.message}`);
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
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                timeout: 5000
            });
        } catch (error) {}
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

pool.on('error', (err) => log('error', `❌ Database error: ${err.message}`));

// ===========================================
// FUSE SERVICE - Recherche intelligente
// ===========================================
class FuseService {
    constructor() {
        this.fuse = null;
        this.fusePhonetic = null;
        this.medicaments = [];
        this.medicamentMap = new Map();
        this.cache = cache;
    }

    async initialize() {
        log('info', '📚 Chargement des médicaments...');
        
        try {
            const cached = await this.cache.get("medicaments:all");
            if (cached && cached.length > 0) {
                this.medicaments = cached;
                this.buildIndexes();
                log('info', `✅ ${this.medicaments.length} médicaments chargés depuis cache`);
                return;
            }

            const result = await pool.query(`
                SELECT code_produit, nom_commercial, dci, prix, categorie 
                FROM medicaments 
                WHERE prix > 0
                ORDER BY nom_commercial
            `);
            
            this.medicaments = result.rows.map(med => ({
                ...med,
                normalized: Utils.normalizeText(med.nom_commercial),
                dci_normalized: med.dci ? Utils.normalizeText(med.dci) : '',
                searchable: Utils.normalizeText(`${med.nom_commercial} ${med.dci || ''} ${med.categorie || ''}`),
                words: Utils.normalizeText(med.nom_commercial).split(' ').filter(w => w.length > 1),
                phonetic: this.phoneticTransform(med.nom_commercial),
                prefixes: this.extractPrefixes(med.nom_commercial)
            }));

            this.buildIndexes();
            
            await this.cache.set("medicaments:all", this.medicaments, 3600);
            
            log('info', `✅ ${this.medicaments.length} médicaments chargés depuis DB`);
        } catch (error) {
            log('error', `❌ Erreur chargement médicaments: ${error.message}`);
            throw error;
        }
    }

    phoneticTransform(text) {
        return text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[aeiouy]/g, 'a')
            .replace(/[ckq]/g, 'k')
            .replace(/[sz]/g, 's')
            .replace(/[dt]/g, 't')
            .replace(/[mn]/g, 'n')
            .replace(/[pb]/g, 'p')
            .replace(/[^a-z]/g, '');
    }

    extractPrefixes(text) {
        const prefixes = new Set();
        const clean = text.toLowerCase().replace(/[^a-z]/g, '');
        for (let i = 3; i <= Math.min(6, clean.length); i++) {
            prefixes.add(clean.substring(0, i));
        }
        return Array.from(prefixes);
    }

    buildIndexes() {
        this.medicamentMap.clear();
        this.medicaments.forEach(med => {
            this.medicamentMap.set(med.code_produit, med);
        });

        this.fuse = new Fuse(this.medicaments, {
            keys: [
                { name: 'nom_commercial', weight: 0.8 },
                { name: 'dci', weight: 0.5 },
                { name: 'normalized', weight: 0.6 },
                { name: 'searchable', weight: 0.4 }
            ],
            threshold: 0.35,
            includeScore: true,
            ignoreLocation: true,
            findAllMatches: true,
            minMatchCharLength: 2
        });

        this.fusePhonetic = new Fuse(this.medicaments, {
            keys: [
                { name: 'phonetic', weight: 1.0 }
            ],
            threshold: 0.4,
            includeScore: true,
            ignoreLocation: true,
            minMatchCharLength: 3
        });
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];
        
        const normalizedQuery = Utils.normalizeText(query);
        const cacheKey = `search:${normalizedQuery}`;
        
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached.slice(0, limit);

        let results = [];

        results = this.medicaments.filter(med => 
            med.normalized === normalizedQuery || 
            med.nom_commercial.toLowerCase() === query.toLowerCase()
        );

        if (results.length === 0) {
            const words = normalizedQuery.split(' ').filter(w => w.length > 1);
            if (words.length > 0) {
                results = this.medicaments.filter(med => {
                    const medWords = med.words.join(' ');
                    return words.some(word => medWords.includes(word));
                }).slice(0, limit);
            }
        }

        if (results.length === 0) {
            const fuseResults = this.fuse.search(normalizedQuery);
            results = fuseResults
                .filter(r => r.score < 0.4)
                .slice(0, limit)
                .map(r => r.item);
        }

        if (results.length === 0 && normalizedQuery.length > 3) {
            const queryPhonetic = this.phoneticTransform(normalizedQuery);
            const phoneticResults = this.fusePhonetic.search(queryPhonetic);
            results = phoneticResults
                .filter(r => r.score < 0.4)
                .slice(0, limit)
                .map(r => r.item);
        }

        if (results.length > 0) {
            await this.cache.set(cacheKey, results, 300);
        }

        return results;
    }

    async getByCode(code) {
        return this.medicamentMap.get(code) || null;
    }

    async refresh() {
        const lastUpdate = await this.cache.get("medicaments:last_update");
        if (!lastUpdate || Date.now() - lastUpdate > 3600000) {
            await this.initialize();
            await this.cache.set("medicaments:last_update", Date.now(), 3600);
        }
    }
}

// ===========================================
// LLM SERVICE - Groq (100% IA, pas de fallback)
// ===========================================
class LLMService {
    constructor() {
        this.models = {
            detailed: "llama-3.3-70b-versatile",
            vision: "meta-llama/llama-4-scout-17b-16e-instruct"
        };
        this.cache = cache;
        this.systemPrompt = this.getSystemPrompt();
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        
        return `Tu es MARIAM, une assistante santé 100% IA à San Pedro, Côte d'Ivoire.

RÈGLE D'OR: TOUTES tes réponses doivent être générées par toi. Il n'y a AUCUN message pré-écrit.

STYLE:
- Naturelle, chaleureuse, professionnelle
- Utilise des émojis: 💊 (médicament), 📸 (photo), 🚚 (livraison), 📲 (support), 💙 (bienveillance)
- Maximum 3 phrases, sauf pour lister des options
- Adapte ton ton à la conversation

FORMAT DE RÉPONSE OBLIGATOIRE:
{
    "intention": "greet|search|support|delivery|creator|purpose|unknown|image",
    "reponse": "Ta réponse naturelle ici"
}

CONTEXTE (à utiliser):
- Zone: ${DELIVERY_CONFIG.ZONE}
- Prix livraison jour: ${DELIVERY_CONFIG.PRICES.DAY}F
- Prix livraison nuit (0h-7h): ${DELIVERY_CONFIG.PRICES.NIGHT}F
- Délai: ${DELIVERY_CONFIG.DELIVERY_TIME} minutes
- Support: ${supportLink}

COMMENT RÉPONDRE:

GREET (salutation):
Présente-toi, explique ton rôle, propose ton aide.

SEARCH (recherche):
Confirme le médicament, donne le prix, explique comment commander.

SUPPORT (commande):
Explique le processus, donne le lien, sois précise.

DELIVERY (livraison):
Donne les prix et délais, rassure sur le service.

CREATOR:
Parle de Youssef (étudiant UPSP en Agriculture/Agro-Industrie) et Coulibaly Yaya (rencontre mars 2026).

PURPOSE:
Explique que tu facilites l'accès aux médicaments à San Pedro.

UNKNOWN:
Guide l'utilisateur vers ce que tu peux faire, propose des alternatives.

IMAGE:
Confirme l'analyse, donne les résultats, explique la suite.

RAPPEL: Chaque réponse est UNIQUE car c'est TOI qui la génères !`;
    }

    async callGroq(prompt, model = this.models.detailed, temperature = 0.7) {
        const requestId = Utils.generateRequestId();
        const maxRetries = 2;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                log('info', `🤖 Groq request ${requestId} (tentative ${attempt}/${maxRetries})`);
                
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: "system", content: this.systemPrompt },
                            { role: "user", content: prompt }
                        ],
                        temperature: temperature,
                        max_tokens: 500,
                        response_format: { type: "json_object" }
                    }),
                    timeout: 15000
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Groq API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                return this.safeParseJSON(data);
                
            } catch (error) {
                log('error', `❌ Groq API error ${requestId} (tentative ${attempt}): ${error.message}`);
                
                if (attempt < maxRetries) {
                    await Utils.sleep(1000 * attempt);
                }
            }
        }

        throw new Error("Groq API failed after retries");
    }

    safeParseJSON(response) {
        try {
            if (!response.choices || !response.choices[0] || !response.choices[0].message) {
                throw new Error("Invalid Groq response structure");
            }

            const content = response.choices[0].message.content.trim();
            
            const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;
            
            const objMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (!objMatch) {
                throw new Error("No JSON object found");
            }
            
            const parsed = JSON.parse(objMatch[0]);

            if (!parsed.intention || !parsed.reponse) {
                throw new Error("Missing required fields");
            }

            return parsed;
            
        } catch (e) {
            log('error', `❌ JSON parsing error: ${e.message}`);
            throw new Error(`Failed to parse Groq response: ${e.message}`);
        }
    }

    async analyzeMessage(text, intention = null, context = {}) {
        const cacheKey = `llm:${intention || 'general'}:${Utils.normalizeText(text).substring(0, 50)}`;
        
        if (intention !== 'image') {
            const cached = await this.cache.get(cacheKey);
            if (cached) return cached;
        }

        let prompt = text;
        
        if (Object.keys(context).length > 0) {
            prompt = `Contexte: ${JSON.stringify(context, null, 2)}\n\nMessage: ${text}`;
        }

        if (intention) {
            prompt = `Intention détectée: ${intention}\n\nMessage: ${text}\n\nGénère une réponse appropriée pour cette intention.`;
        }

        try {
            const model = intention === 'image' ? this.models.vision : this.models.detailed;
            const temperature = intention === 'greet' ? 0.8 : 0.5;
            
            const response = await this.callGroq(prompt, model, temperature);
            
            if (intention !== 'image') {
                await this.cache.set(cacheKey, response, 300);
            }
            
            return response;
            
        } catch (error) {
            log('error', `❌ Analyze message error: ${error.message}`);
            throw error;
        }
    }
}

// ===========================================
// VISION SERVICE
// ===========================================
class VisionService {
    constructor() {
        this.model = "meta-llama/llama-4-scout-17b-16e-instruct";
        this.maxSize = 4 * 1024 * 1024;
    }

    detectMimeType(buffer) {
        const hex = buffer.toString('hex', 0, 4).toLowerCase();
        if (hex.startsWith('ffd8')) return 'image/jpeg';
        if (hex.startsWith('8950')) return 'image/png';
        if (hex.startsWith('4749')) return 'image/gif';
        return 'image/jpeg';
    }

    async analyzeImage(imageBuffer) {
        try {
            if (imageBuffer.length > this.maxSize) {
                return {
                    type: "inconnu",
                    medicaments: [],
                    message: "L'image est trop volumineuse (max 4 Mo)"
                };
            }

            const base64Image = imageBuffer.toString('base64');
            const mimeType = this.detectMimeType(imageBuffer);

            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
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
                                    text: `Analyse cette image de médicament ou d'ordonnance.
                                    Retourne UNIQUEMENT un objet JSON valide avec ce format exact:
                                    {
                                        "type": "boite" | "ordonnance" | "inconnu",
                                        "medicaments": [
                                            {
                                                "nom": "nom du médicament",
                                                "dosage": "dosage ou null",
                                                "forme": "comprimé|gélule|sirop|injection|inconnu"
                                            }
                                        ],
                                        "message": "message optionnel si type est inconnu"
                                    }
                                    
                                    Si c'est une boîte de médicament, extrais le nom exact.
                                    Si c'est une ordonnance, liste tous les médicaments prescrits.
                                    Si l'image n'est pas claire, retourne type "inconnu".`
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:${mimeType};base64,${base64Image}`
                                    }
                                }
                            ]
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 500,
                    response_format: { type: "json_object" }
                }),
                timeout: 30000
            });

            if (!response.ok) throw new Error(`Vision API error: ${response.status}`);

            const data = await response.json();
            const content = data.choices[0].message.content;
            
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error("No JSON found");
            
            return JSON.parse(jsonMatch[0]);

        } catch (error) {
            log('error', `❌ Vision error: ${error.message}`);
            return {
                type: "inconnu",
                medicaments: [],
                message: "Erreur d'analyse"
            };
        }
    }
}

// ===========================================
// CONVERSATION MANAGER - Coeur du bot
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.whatsapp = new WhatsAppService();
        this.fuse = new FuseService();
        this.llm = new LLMService();
        this.vision = new VisionService();
        this.messageCount = 0;
        this.startTime = Date.now();
    }

    async init() {
        await this.fuse.initialize();
        log('info', '🚀 MARIAM initialisé avec succès !');
        setInterval(() => this.fuse.refresh(), 3600000);
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                history: [],
                lastActivity: Date.now(),
                messageCount: 0,
                context: {
                    lastIntent: null,
                    pendingAction: null,
                    pendingData: null
                }
            });
        }
        return this.conversations.get(phone);
    }

    detectIntention(text) {
        if (!text) return "unknown";

        const normalized = Utils.normalizeText(text);
        const original = text.toLowerCase();

        if (/\b(salut|bonjour|bonsoir|hey|hello|coucou|slt|bjr|yo)\b/i.test(normalized)) return "greet";
        
        if (/\b(qui t'a? (cré[ée]|fait)|ton créateur|youssef|coulibaly|qui tacreer|qui ta creer)\b/i.test(original)) return "creator";
        
        if (/\b(pourquoi tu existes|à quoi tu sers|ton but|ton rôle|utilité)\b/i.test(original)) return "purpose";
        
        if (/\b(cherche|trouve|prix|combien|as-tu|existe|médicament|médoc|comprimé|sirop)\b/i.test(normalized)) return "search";
        
        if (/\b(support|commander|contact|aide|commande|acheter|je veux|je prends)\b/i.test(original)) return "support";
        
        if (/\b(livraison|livrer|délai|transport|frais livraison)\b/i.test(original)) return "delivery";
        
        if (/\b(oui|ouais|ok|d accord)\b/i.test(original) && original.length < 10) return "affirmative";
        
        if (/\b(non|nan|non merci)\b/i.test(original) && original.length < 10) return "negative";
        
        return "unknown";
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, mediaType } = input;

        try {
            this.messageCount++;
            conv.messageCount++;

            await this.whatsapp.sendTyping(phone);

            if (text) conv.history.push({ role: 'user', content: text, timestamp: Date.now() });

            if (mediaType === 'audio') {
                await this.whatsapp.sendMessage(phone, 
                    "Désolée, je ne traite que les messages texte et les images. Envoie-moi le nom du médicament par écrit 💊"
                );
                return;
            }

            if (mediaId) {
                await this.processImage(phone, mediaId, conv);
                return;
            }

            if (text) {
                const intention = this.detectIntention(text);
                const isFirstMessage = conv.history.length <= 1;

                if (isFirstMessage) {
                    await this.handleFirstMessage(phone, text, conv);
                }
                else if (intention === "affirmative" && conv.context.pendingAction) {
                    await this.handleAffirmative(phone, conv);
                }
                else if (intention === "negative" && conv.context.pendingAction) {
                    await this.handleNegative(phone, conv);
                }
                else if (intention === "search") {
                    await this.handleMedicineSearch(phone, text, conv);
                }
                else {
                    await this.handleGenericIntent(phone, text, intention, conv);
                }

                conv.lastActivity = Date.now();
                
                if (conv.history.length > 20) conv.history = conv.history.slice(-20);
            }
        } catch (error) {
            log('error', `❌ Process error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                `Désolée, un problème technique. Réessaie ou contacte le support : ${Utils.getSupportLink()}`
            );
        }
    }

    async handleFirstMessage(phone, text, conv) {
        try {
            const delivery = Utils.getDeliveryPrice();
            
            const prompt = `
                PREMIER MESSAGE: "${text}"
                
                Contexte: MARIAM à ${DELIVERY_CONFIG.ZONE}, livraison ${delivery.price}F (${delivery.period}), ${delivery.time}min
                
                GÉNÈRE UNE RÉPONSE D'ACCUEIL QUI:
                1. Te présente brièvement
                2. Explique ton rôle (médicaments, prix, livraison)
                3. Propose ton aide (nom ou photo)
                
                SOIS UNIQUE, utilise 💊 📸 🚚, max 3 phrases.
            `;
            
            const response = await this.llm.analyzeMessage(prompt, "greet");
            await this.whatsapp.sendMessage(phone, response.reponse);
            conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
            
        } catch (error) {
            const fallback = `Salut ! Je suis MARIAM, ton assistante santé à ${DELIVERY_CONFIG.ZONE}. 💊 Envoie-moi un nom de médicament ou une photo pour commencer !`;
            await this.whatsapp.sendMessage(phone, fallback);
        }
    }

    async handleAffirmative(phone, conv) {
        try {
            const delivery = Utils.getDeliveryPrice();
            
            const prompt = `
                L'utilisateur a dit OUI.
                Contexte: ${JSON.stringify(conv.context.pendingData)}
                
                Génère une réponse qui:
                1. Confirme avec enthousiasme 😊
                2. Donne les prochaines étapes
                3. Redirige vers le support: ${Utils.getSupportLink()}
                4. Rappelle livraison: ${delivery.price}F, ${delivery.time}min
            `;
            
            const response = await this.llm.analyzeMessage(prompt, "support");
            await this.whatsapp.sendMessage(phone, response.reponse);
            
            conv.context.pendingAction = null;
            conv.context.pendingData = null;
            
        } catch (error) {
            await this.whatsapp.sendMessage(phone, 
                `Super ! Pour commander, contacte le support : ${Utils.getSupportLink()} 📲`
            );
        }
    }

    async handleNegative(phone, conv) {
        try {
            const delivery = Utils.getDeliveryPrice();
            
            const prompt = `
                L'utilisateur a dit NON.
                Contexte: ${JSON.stringify(conv.context.pendingData)}
                
                Génère une réponse qui:
                1. Accepte poliment
                2. Propose alternatives: autre médicament, photo 📸, support
                3. Rappelle livraison: ${delivery.price}F, ${delivery.time}min
            `;
            
            const response = await this.llm.analyzeMessage(prompt, "unknown");
            await this.whatsapp.sendMessage(phone, response.reponse);
            
            conv.context.pendingAction = null;
            conv.context.pendingData = null;
            
        } catch (error) {
            await this.whatsapp.sendMessage(phone, 
                `Pas de problème ! Tu veux essayer un autre médicament ou envoyer une photo ? 📸`
            );
        }
    }

    async handleMedicineSearch(phone, text, conv) {
        try {
            const searchTerm = Utils.extractSearchTerm(text);
            const delivery = Utils.getDeliveryPrice();
            
            const results = await this.fuse.search(searchTerm, 5);
            
            if (results.length > 0) {
                conv.context.pendingAction = "search_results";
                conv.context.pendingData = {
                    searchTerm,
                    results: results.map(r => ({
                        nom: r.nom_commercial,
                        prix: r.prix,
                        dci: r.dci
                    }))
                };
                
                const prompt = `
                    RECHERCHE: "${searchTerm}"
                    RÉSULTATS (${results.length}):
                    ${results.map((r, i) => `${i+1}. ${r.nom_commercial} - ${r.prix}F`).join('\n')}
                    
                    RÈGLES STRICTES:
                    1. ✅ Mentionne UNIQUEMENT ces médicaments
                    2. ✅ Donne les prix EXACTS
                    3. ❌ N'invente RIEN
                    
                    GÉNÈRE UNE RÉPONSE QUI:
                    1. Confirme les résultats
                    2. Liste clairement les options
                    3. Demande si l'un intéresse
                    4. Mentionne le support: ${Utils.getSupportLink()}
                    5. Rappelle livraison: ${delivery.price}F, ${delivery.time}min
                `;

                const response = await this.llm.analyzeMessage(prompt, "search");
                await this.whatsapp.sendMessage(phone, response.reponse);
                
            } else {
                const prompt = `
                    RECHERCHE: "${searchTerm}"
                    AUCUN RÉSULTAT
                    
                    GÉNÈRE UNE RÉPONSE HONNÊTE:
                    1. Dis que ce médicament n'est pas dans la base
                    2. Propose: vérifier orthographe, envoyer photo 📸, support
                    3. Donne exemples (Doliprane, Amoxicilline)
                    4. Rappelle livraison: ${delivery.price}F, ${delivery.time}min
                `;

                const response = await this.llm.analyzeMessage(prompt, "unknown");
                await this.whatsapp.sendMessage(phone, response.reponse);
                
                const suggestions = await this.fuse.search(searchTerm, 3);
                if (suggestions.length > 0) {
                    await Utils.sleep(1500);
                    
                    conv.context.pendingAction = "suggestions";
                    conv.context.pendingData = {
                        original: searchTerm,
                        suggestions: suggestions.map(s => s.nom_commercial)
                    };
                    
                    const suggestPrompt = `
                        SUGGESTIONS PROCHES: ${suggestions.map(s => s.nom_commercial).join(', ')}
                        
                        Propose-les et demande si l'une correspond.
                        Rappelle livraison: ${delivery.price}F, ${delivery.time}min
                    `;
                    
                    const suggestResponse = await this.llm.analyzeMessage(suggestPrompt, "search");
                    await this.whatsapp.sendMessage(phone, suggestResponse.reponse);
                }
            }
            
            conv.history.push({ role: 'assistant', content: `[Recherche: ${searchTerm}]`, timestamp: Date.now() });
            
        } catch (error) {
            log('error', `❌ Search error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                `Je cherche mais j'ai un petit problème. Contacte le support : ${Utils.getSupportLink()} 📲`
            );
        }
    }

    async handleGenericIntent(phone, text, intention, conv) {
        try {
            const delivery = Utils.getDeliveryPrice();
            
            const prompt = `
                INTENTION: ${intention}
                MESSAGE: "${text}"
                
                Contexte: ${DELIVERY_CONFIG.ZONE}, livraison ${delivery.price}F (${delivery.period}), ${delivery.time}min
                Support: ${Utils.getSupportLink()}
                
                Génère une réponse naturelle et appropriée.
                Utilise des émojis, max 3 phrases.
            `;
            
            const response = await this.llm.analyzeMessage(prompt, intention);
            await this.whatsapp.sendMessage(phone, response.reponse);
            
            conv.context.lastIntent = intention;
            conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
            
        } catch (error) {
            await this.whatsapp.sendMessage(phone, 
                `Je n'ai pas bien compris. Envoie un nom de médicament ou une photo 💊 Support: ${Utils.getSupportLink()}`
            );
        }
    }

    async processImage(phone, mediaId, conv) {
        try {
            const delivery = Utils.getDeliveryPrice();
            
            await this.whatsapp.sendMessage(phone, 
                "📸 J'analyse ta photo... 30 secondes s'il te plaît !"
            );
            
            const media = await this.whatsapp.downloadMedia(mediaId);
            
            if (!media.success) {
                await this.whatsapp.sendMessage(phone, 
                    `Impossible de télécharger l'image. Envoie le nom en texte ou contacte le support : ${Utils.getSupportLink()}`
                );
                return;
            }

            const visionResult = await this.vision.analyzeImage(media.buffer);
            
            if (visionResult.medicaments && visionResult.medicaments.length > 0) {
                const foundMedicines = [];
                
                for (const med of visionResult.medicaments) {
                    const results = await this.fuse.search(med.nom, 1);
                    if (results.length > 0) foundMedicines.push(results[0]);
                }

                if (foundMedicines.length > 0) {
                    const prompt = `
                        ANALYSE IMAGE: ${visionResult.type}
                        DÉTECTÉ: ${visionResult.medicaments.map(m => m.nom).join(', ')}
                        TROUVÉS: ${foundMedicines.map(m => `${m.nom_commercial} (${m.prix}F)`).join(', ')}
                        
                        GÉNÈRE UNE RÉPONSE QUI:
                        1. Confirme l'analyse 📸
                        2. Donne les prix trouvés
                        3. Explique comment commander via support: ${Utils.getSupportLink()}
                        4. Rappelle livraison: ${delivery.price}F, ${delivery.time}min
                    `;
                    
                    const response = await this.llm.analyzeMessage(prompt, "image");
                    await this.whatsapp.sendMessage(phone, response.reponse);
                    
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        `J'ai vu ${visionResult.medicaments[0].nom} sur la photo, mais ce médicament n'est pas dans ma base. Envoie le nom exact ou contacte le support : ${Utils.getSupportLink()}`
                    );
                }
            } else {
                await this.whatsapp.sendMessage(phone, 
                    `Je n'ai pas reconnu de médicament sur cette photo. Prends une photo plus nette de la boîte ou envoie le nom en texte. 📸`
                );
            }

            conv.lastActivity = Date.now();

        } catch (error) {
            log('error', `❌ Image error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                `Erreur technique. Envoie le nom du médicament en texte : ${Utils.getSupportLink()}`
            );
        }
    }

    getStats() {
        return {
            conversations: this.conversations.size,
            messages: this.messageCount,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            cache: cache.getStats(),
            memory: process.memoryUsage()
        };
    }
}

// ===========================================
// BASE DE DONNÉES - INITIALISATION (sans données de test)
// ===========================================
async function initDatabase() {
    try {
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

        const count = await pool.query(`SELECT COUNT(*) FROM medicaments`);
        if (parseInt(count.rows[0].count) === 0) {
            log('warn', '⚠️ La table medicaments est vide - veuillez importer les données manuellement');
        } else {
            log('info', `✅ ${count.rows[0].count} médicaments dans la base de données`);
        }

        log('info', '✅ Base de données prête');
    } catch (error) {
        log('error', `❌ Database init error: ${error.message}`);
        throw error;
    }
}

// ===========================================
// SERVEUR EXPRESS
// ===========================================
const app = express();
const bot = new ConversationManager();

app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300
}));

app.get('/health', async (req, res) => {
    const dbOk = await pool.query('SELECT 1').then(() => true).catch(() => false);
    
    res.json({
        status: 'healthy',
        version: '2.0.0',
        bot: 'MARIAM - 100% IA',
        uptime: process.uptime(),
        stats: bot.getStats(),
        connections: {
            redis: redis ? 'connected' : 'fallback',
            database: dbOk ? 'connected' : 'error'
        }
    });
});

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        log('info', '✅ Webhook verified');
        res.status(200).send(challenge);
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
        
        log('info', `📩 Message reçu de ${phone}: ${msg.type}`);

        if (msg.type === 'text') {
            await bot.process(phone, { text: msg.text.body });
        } else if (msg.type === 'image') {
            await bot.process(phone, { 
                mediaId: msg.image.id, 
                mediaType: 'image' 
            });
        } else if (msg.type === 'audio') {
            await bot.process(phone, { mediaType: 'audio' });
        }
    } catch (error) {
        log('error', `❌ Webhook error: ${error.message}`);
    }
});

app.get('/stats', (req, res) => {
    res.json(bot.getStats());
});

setInterval(async () => {
    const now = Date.now();
    const timeout = 30 * 60 * 1000;

    for (const [phone, conv] of bot.conversations) {
        if (now - conv.lastActivity > timeout) {
            bot.conversations.delete(phone);
            log('info', `🧹 Conversation expirée: ${phone}`);
        }
    }
}, 600000);

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        await initDatabase();
        await bot.init();
        
        app.listen(PORT, '0.0.0.0', () => {
            const banner = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🚀 MARIAM - BOT WHATSAPP 100% IA                          ║
║   📍 ${DELIVERY_CONFIG.ZONE}, Côte d'Ivoire                             ║
║                                                              ║
║   🤖 Moteur: Groq LLM                                       ║
║   👁️ Vision: meta-llama-4-scout-17b                         ║
║   🔍 Recherche: Fuse.js (${bot.fuse.medicaments.length || '?'} médicaments)                ║
║                                                              ║
║   ✅ 100% IA - AUCUN message en dur                         ║
║   ✅ Réponses uniques et naturelles                         ║
║   ✅ Support: ${Utils.getSupportLink()}          ║
║                                                              ║
║   📱 Port: ${PORT}                                            ║
║                                                              ║
║   👨‍💻 Créé par Youssef - UPSP 2026                          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
            `;
            console.log(banner);
        });
    } catch (error) {
        log('error', `❌ Fatal error: ${error.message}`);
        process.exit(1);
    }
}

process.on('SIGTERM', async () => {
    log('info', '📴 Arrêt...');
    await pool.end();
    if (redis) await redis.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    log('info', '📴 Arrêt...');
    await pool.end();
    if (redis) await redis.quit();
    process.exit(0);
});

if (isMainThread) {
    start();
}
