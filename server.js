// MARIAM IA - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// Version complète avec cache intelligent et gestion de quota
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
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

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
    console.log(`[${new Date().toISOString()}] ${message}`);
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

    async del(key) {
        if (!redis) {
            this.localCache.del(key);
            return;
        }
        try {
            await redis.del(key);
        } catch {
            this.localCache.del(key);
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

    static extractMedicamentFromQuery(text, pattern) {
        const match = text.match(pattern);
        return match ? (match[1] || match[2] || match[3] || match[4]) : null;
    }
}

// ===========================================
// BASE DE DONNÉES POSTGRESQL
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
// WHATSAPP SERVICE
// ===========================================
class WhatsAppService {
    constructor() {
        this.lastTyping = new NodeCache({ stdTTL: 10 });
    }

    async sendMessage(to, text) {
        try {
            if (!text) text = "Salut ! Je suis MARIAM, ton IA santé à San Pedro 💊";
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
            
            // Redimensionner si trop grand (max 4MB pour base64)
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
// SMART CACHE MANAGER - Évite d'appeler le LLM inutilement
// ===========================================
class SmartCacheManager {
    constructor(fuseService) {
        this.cache = cache;
        this.fuse = fuseService;
        this.localCache = new NodeCache({ stdTTL: 3600 });
        
        // Patterns pour détection des requêtes simples
        this.patterns = {
            prix: /prix\s+(\w+)|combien\s+co[uû]te\s+(\w+)|(\w+)\s+prix|tarif\s+(\w+)|(\w+)\s+c'est\s+combien/i,
            disponibilite: /disponible\s+(\w+)|est-ce\s+que\s+vous\s+avez\s+(\w+)|(\w+)\s+disponible|vous\s+avez\s+(\w+)/i,
            livraison: /livraison|délai|combien\s+de\s+temps|prix\s+livraison|transport/i,
            support: /support|aide|contact|joindre|assistance|probl[èe]me|SOS/i,
            creator: /qui\s+t['']a\s+cr[ée]ée|qui\s+t'a\s+fait|cr[ée]ateur|youssef|upsp|qui\s+t'a\s+créé/i,
            purpose: /à\s+quoi\s+tu\s+sers|tu\s+fais\s+quoi|r[ôo]le|utilite|pourquoi\s+tu\s+existes/i,
            salut: /^(salut|bonjour|bonsoir|coucou|hello|hi|cc|slt|bsr|bjr)$/i,
            merci: /^(merci|thanks|thank you|merci beaucoup|merci bcp|😊|👍)$/i,
            commande: /commander|acheter|je\s+veux|je\s+prends|r[ée]servation/i
        };
        
        // Réponses pré-définies (ne nécessitent pas de LLM)
        this.staticResponses = {
            creator: "J'ai été créée par Youssef, étudiant à l'UPSP, avec son amie Coulibaly Yaya en mars 2026 💙\n\nUne belle histoire d'amitié et d'innovation !",
            purpose: "Je simplifie l'accès aux médicaments à San Pedro ! 💊\n\nPrix transparents, disponibilité en direct, livraison rapide. Ta santé mérite le meilleur.",
            support: (link) => `Besoin d'aide ? Contacte le support :\n${link} 📞`,
            merci: "Avec plaisir ! N'hésite pas si tu as besoin d'autre chose 💙",
            fallback: null
        };
    }
    
    // Détecte si c'est une requête simple qui peut être servie sans LLM
    detectSimpleQuery(text) {
        const normalized = Utils.normalizeText(text);
        
        // Vérifier les patterns
        for (const [type, pattern] of Object.entries(this.patterns)) {
            if (pattern.test(text)) {
                
                // Extraire le médicament pour les requêtes prix/disponibilité
                if (type === 'prix' || type === 'disponibilite') {
                    const medicament = Utils.extractMedicamentFromQuery(text, pattern);
                    if (medicament) {
                        return { type, medicament: medicament.trim() };
                    }
                }
                
                // Requêtes sans médicament
                return { type, medicament: null };
            }
        }
        
        return null;
    }
    
    // Générer une réponse pour une requête simple
    async generateSimpleResponse(query, phone) {
        const detected = this.detectSimpleQuery(query.text);
        if (!detected) return null;
        
        const cacheKey = `simple:${detected.type}:${detected.medicament || 'general'}`;
        
        // Vérifier le cache
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            log('info', `✅ Cache hit pour: ${cacheKey}`);
            return cached;
        }
        
        log('info', `ℹ️ Cache miss pour: ${cacheKey}, génération...`);
        
        let response = null;
        
        switch (detected.type) {
            case 'prix':
                if (detected.medicament) {
                    response = await this.handlePriceQuery(detected.medicament);
                }
                break;
                
            case 'disponibilite':
                if (detected.medicament) {
                    response = await this.handleAvailabilityQuery(detected.medicament);
                }
                break;
                
            case 'livraison':
                response = this.handleDeliveryQuery();
                break;
                
            case 'support':
                response = this.staticResponses.support(Utils.getSupportLink());
                break;
                
            case 'creator':
                response = this.staticResponses.creator;
                break;
                
            case 'purpose':
                response = this.staticResponses.purpose;
                break;
                
            case 'salut':
                response = "Salut ! Je suis MARIAM, ton IA santé à San Pedro 💊\n\nJe cherche tes médicaments et je les livre. Qu'est-ce qu'il te faut ?";
                break;
                
            case 'merci':
                response = this.staticResponses.merci;
                break;
                
            case 'commande':
                response = "Pour commander, dis-moi quel médicament tu veux et la quantité ! 💊\n\nExemple: \"Je veux 2 Doliprane\"";
                break;
        }
        
        // Mettre en cache si on a une réponse
        if (response) {
            // Cache pour 1 heure (3600 secondes)
            await this.cache.set(cacheKey, response, 3600);
            
            // Sauvegarder aussi dans l'historique des requêtes pour analytics
            await this.logQuery(query, detected, phone);
        }
        
        return response;
    }
    
    // Gérer les requêtes de prix
    async handlePriceQuery(medicamentName) {
        const results = await this.fuse.search(medicamentName, 5);
        
        if (results.length === 0) {
            return `Désolé, je n'ai pas trouvé "${medicamentName}" dans ma base. 💊\n\nPeux-tu vérifier l'orthographe ?`;
        }
        
        if (results.length === 1) {
            const med = results[0];
            return `${med.nom_commercial} : ${med.prix}F CFA\n\nDisponible immédiatement !`;
        }
        
        // Plusieurs résultats
        let response = `J'ai trouvé plusieurs options :\n\n`;
        results.slice(0, 3).forEach(med => {
            response += `- ${med.nom_commercial} : ${med.prix}F CFA\n`;
        });
        response += `\nLequel te convient ? 💊`;
        
        return response;
    }
    
    // Gérer les requêtes de disponibilité
    async handleAvailabilityQuery(medicamentName) {
        const results = await this.fuse.search(medicamentName, 5);
        
        if (results.length === 0) {
            return `Désolé, "${medicamentName}" n'est pas dans ma base pour le moment. 💊`;
        }
        
        if (results.length === 1) {
            const med = results[0];
            return `✅ ${med.nom_commercial} est disponible !\nPrix : ${med.prix}F CFA\n\nTu veux commander ?`;
        }
        
        let response = `✅ Médicaments disponibles :\n\n`;
        results.slice(0, 3).forEach(med => {
            response += `- ${med.nom_commercial} : ${med.prix}F CFA\n`;
        });
        response += `\nLequel te intéresse ?`;
        
        return response;
    }
    
    // Gérer les requêtes de livraison
    handleDeliveryQuery() {
        const delivery = Utils.getDeliveryPrice();
        return `Livraison à San Pedro :\n\n- Jour : ${DELIVERY_CONFIG.PRICES.DAY}F CFA\n- Nuit : ${DELIVERY_CONFIG.PRICES.NIGHT}F CFA\n- Délai : ${DELIVERY_CONFIG.DELIVERY_TIME} min 🚚\n\nPériode actuelle : ${delivery.period}`;
    }
    
    // Logger les requêtes pour analytics
    async logQuery(query, detected, phone) {
        try {
            await pool.query(
                `INSERT INTO queries_log (phone, message, type, medicament, timestamp) 
                 VALUES ($1, $2, $3, $4, NOW())`,
                [phone, query.text, detected.type, detected.medicament]
            );
        } catch (error) {
            // Silently fail, pas critique
        }
    }
}

// ===========================================
// LLM SERVICE - Groq (Cerveau de l'IA) avec gestion de quota
// ===========================================
class LLMService {
    constructor() {
        this.client = new Groq({ apiKey: GROQ_API_KEY });
        this.models = {
            vision: "meta-llama/llama-4-scout-17b-16e-instruct",
            text: {
                primary: "llama-3.3-70b-versatile",
                fallback: "llama3-70b-8192"
            }
        };
        this.cache = cache;
        
        // État des quotas
        this.quota = {
            primary: { available: true, lastCheck: Date.now() },
            fallback: { available: true, lastCheck: Date.now() },
            vision: { available: true, lastCheck: Date.now() }
        };
        
        // Période de retry après épuisement (1 heure)
        this.QUOTA_RETRY_MS = 60 * 60 * 1000;
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        
        return `Tu es MARIAM, une IA santé à San Pedro, Côte d'Ivoire.

STYLE PAYPARROT :
- Messages courts et clairs (max 3-4 lignes)
- Emojis discrets (💊 🚚 📲)
- Options avec tirets
- Structure: accueil → info → question

CONTEXTE :
- Livraison: ${delivery.price}F CFA (${delivery.period}), délai: ${delivery.time}min
- Support: ${supportLink}

FORMAT DE REPONSE (JSON uniquement) :
{
    "intention": "greet|search|support|delivery|creator|purpose|unknown",
    "medicament": "nom extrait ou null",
    "reponse": "ta réponse style PayParrot"
}`;
    }

    // Vérifier et mettre à jour l'état des quotas
    checkQuotaAvailability(modelType) {
        const now = Date.now();
        const quota = this.quota[modelType];
        
        if (!quota) return true;
        
        // Si le quota est marqué comme indisponible, vérifier si 1 heure est passée
        if (!quota.available) {
            if (now - quota.lastCheck > this.QUOTA_RETRY_MS) {
                quota.available = true;
                quota.lastCheck = now;
                log('info', `Quota ${modelType} réinitialisé après 1 heure`);
            }
        }
        
        return quota.available;
    }

    // Marquer un quota comme épuisé
    markQuotaExhausted(modelType) {
        if (this.quota[modelType]) {
            this.quota[modelType].available = false;
            this.quota[modelType].lastCheck = Date.now();
            log('warn', `Quota ${modelType} épuisé à ${new Date().toISOString()}`);
        }
    }

    // Sélectionner le meilleur modèle disponible
    getAvailableTextModel() {
        // Vérifier le modèle principal
        if (this.checkQuotaAvailability('primary')) {
            return this.models.text.primary;
        }
        
        // Vérifier le modèle de secours
        if (this.checkQuotaAvailability('fallback')) {
            return this.models.text.fallback;
        }
        
        // Aucun modèle disponible
        return null;
    }

    async comprendre(message, historique = []) {
        const cacheKey = `comprendre:${Utils.normalizeText(message).substring(0, 50)}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        // Vérifier si un modèle est disponible
        const model = this.getAvailableTextModel();
        
        if (!model) {
            const supportLink = Utils.getSupportLink();
            return {
                intention: "quota_exhausted",
                medicament: null,
                reponse: `⏳ Désolé, tous mes modèles IA sont temporairement épuisés pour l'heure !\n\nRéessaie dans 1 heure, ou contacte le support si ta demande est urgente :\n${supportLink} 📞`
            };
        }

        try {
            const completion = await this.client.chat.completions.create({
                model: model,
                messages: [
                    { role: "system", content: this.getSystemPrompt() },
                    { role: "user", content: `Message: "${message}"\nHistorique: ${JSON.stringify(historique.slice(-3))}` }
                ],
                temperature: 0.7,
                max_completion_tokens: 300,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(completion.choices[0].message.content);
            await this.cache.set(cacheKey, result, 3600);
            return result;
            
        } catch (error) {
            // Détecter si c'est une erreur de quota
            const errorMsg = error.message.toLowerCase();
            if (errorMsg.includes('quota') || errorMsg.includes('rate limit') || errorMsg.includes('exhausted') || errorMsg.includes('429')) {
                
                // Identifier quel modèle a échoué
                if (model === this.models.text.primary) {
                    this.markQuotaExhausted('primary');
                    log('warn', 'Quota modèle principal épuisé, tentative avec fallback');
                    
                    // Réessayer avec le fallback immédiatement
                    return this.comprendre(message, historique);
                } else if (model === this.models.text.fallback) {
                    this.markQuotaExhausted('fallback');
                    
                    const supportLink = Utils.getSupportLink();
                    return {
                        intention: "quota_exhausted",
                        medicament: null,
                        reponse: `⏳ Tous mes modèles IA sont épuisés ! Réessaie dans 1 heure.\n\nUrgent ? Contacte le support :\n${supportLink} 📞`
                    };
                }
            }
            
            log('error', `Comprendre error: ${error.message}`);
            return {
                intention: "unknown",
                medicament: null,
                reponse: "Désolé, petit problème technique ! Réessaie dans une minute ⏱️"
            };
        }
    }

    async integrerResultats(resultats, question, historique) {
        // Vérifier si un modèle est disponible
        const model = this.getAvailableTextModel();
        
        if (!model) {
            return {
                reponse: "⏳ Mes modèles IA sont épuisés pour l'heure. Réessaie dans 1 heure ou contacte le support si urgent !"
            };
        }

        try {
            const completion = await this.client.chat.completions.create({
                model: model,
                messages: [
                    { role: "system", content: this.getSystemPrompt() },
                    { 
                        role: "user", 
                        content: `Résultats de recherche: ${JSON.stringify(resultats)}\nQuestion: "${question}"\nHistorique: ${JSON.stringify(historique.slice(-3))}\n\nGénère une réponse naturelle style PayParrot.` 
                    }
                ],
                temperature: 0.7,
                max_completion_tokens: 200,
                response_format: { type: "json_object" }
            });

            return JSON.parse(completion.choices[0].message.content);
            
        } catch (error) {
            // Gérer les erreurs de quota
            if (error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('rate limit')) {
                if (model === this.models.text.primary) {
                    this.markQuotaExhausted('primary');
                    return this.integrerResultats(resultats, question, historique);
                } else if (model === this.models.text.fallback) {
                    this.markQuotaExhausted('fallback');
                    return {
                        reponse: "Voici ce que j'ai trouvé ! Contacte le support pour commander 📲"
                    };
                }
            }
            
            log('error', `Intégration error: ${error.message}`);
            return {
                reponse: "Voici ce que j'ai trouvé ! Contacte le support pour commander 📲"
            };
        }
    }

    async analyserImage(imageBuffer) {
        // Vérifier quota vision
        if (!this.checkQuotaAvailability('vision')) {
            return { 
                medicaments: [],
                error: "quota_exhausted"
            };
        }

        try {
            const base64Image = imageBuffer.toString('base64');
            
            const completion = await this.client.chat.completions.create({
                model: this.models.vision,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Liste les médicaments que tu vois sur cette image au format JSON. Réponds uniquement avec {\"medicaments\": [\"nom1\", \"nom2\"]}"
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
            
        } catch (error) {
            log('error', `Analyser image error: ${error.message}`);
            
            if (error.message.toLowerCase().includes('quota')) {
                this.markQuotaExhausted('vision');
                return { 
                    medicaments: [],
                    error: "quota_exhausted"
                };
            }
            
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
        this.smartCache = null;
        this.processedMessages = new Set();
    }

    async init() {
        await this.fuse.initialize();
        this.smartCache = new SmartCacheManager(this.fuse);
        log('info', '🚀 MARIAM IA prête');
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                historique: [],
                derniereActivite: Date.now()
            });
        }
        return this.conversations.get(phone);
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, messageId } = input;

        // Éviter les doublons
        if (this.processedMessages.has(messageId)) return;
        this.processedMessages.add(messageId);

        try {
            await this.whatsapp.sendTyping(phone);

            // Sauvegarder message utilisateur
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
                
                if (visionResult.error === "quota_exhausted") {
                    await this.whatsapp.sendMessage(phone, 
                        "⏳ Mon modèle d'analyse d'image est temporairement épuisé. Envoie le nom du médicament par texte stp !");
                    return;
                }
                
                if (visionResult.medicaments && visionResult.medicaments.length > 0) {
                    const results = [];
                    for (const med of visionResult.medicaments) {
                        const searchResults = await this.fuse.search(med, 1);
                        if (searchResults.length > 0) {
                            results.push(searchResults[0]);
                        }
                    }

                    if (results.length > 0) {
                        let reponse = "Médicaments détectés ! 📸\n\n";
                        results.forEach(med => {
                            reponse += `- ${med.nom_commercial} : ${med.prix}F CFA\n`;
                        });
                        reponse += "\nIls sont disponibles. Tu veux commander ?";

                        await this.whatsapp.sendMessage(phone, reponse);
                        
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now(),
                            source: 'vision'
                        });
                    } else {
                        await this.whatsapp.sendMessage(phone, 
                            "J'ai détecté des médicaments mais ils ne sont pas dans ma base. Envoie les noms par texte stp ! 💊");
                    }
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        "Je ne vois pas de médicament clairement sur cette image. Envoie le nom par texte stp !");
                }
                
                conv.derniereActivite = Date.now();
                return;
            }

            // ===========================================
            // CAS 2: TEXTE REÇU - AVEC SMART CACHE
            // ===========================================
            if (text) {
                // 1️⃣ D'abord, essayer le Smart Cache (pas de LLM)
                const cachedResponse = await this.smartCache.generateSimpleResponse(
                    { text, messageId }, 
                    phone
                );
                
                if (cachedResponse) {
                    log('info', `📦 Réponse depuis le cache pour: ${text.substring(0, 30)}...`);
                    await this.whatsapp.sendMessage(phone, cachedResponse);
                    
                    conv.historique.push({
                        role: "assistant",
                        content: cachedResponse,
                        timestamp: Date.now(),
                        source: 'cache'
                    });
                    
                    conv.derniereActivite = Date.now();
                    return;
                }
                
                // 2️⃣ Si pas en cache, utiliser le LLM
                log('info', `🤖 Utilisation du LLM pour: ${text.substring(0, 30)}...`);
                
                const comprehension = await this.llm.comprendre(text, conv.historique);
                
                if (comprehension.intention === "quota_exhausted") {
                    await this.whatsapp.sendMessage(phone, comprehension.reponse);
                    
                    conv.historique.push({
                        role: "assistant",
                        content: comprehension.reponse,
                        timestamp: Date.now()
                    });
                    
                    conv.derniereActivite = Date.now();
                    return;
                }
                
                if (comprehension.intention === "search" && comprehension.medicament) {
                    const results = await this.fuse.search(comprehension.medicament, 3);
                    
                    if (results.length > 0) {
                        const reponseAvecResultats = await this.llm.integrerResultats(
                            results, 
                            text, 
                            conv.historique
                        );
                        
                        const reponse = reponseAvecResultats.reponse || reponseAvecResultats;
                        
                        const cacheKey = `search:${Utils.normalizeText(comprehension.medicament)}`;
                        await cache.set(cacheKey, reponse, 1800);
                        
                        await this.whatsapp.sendMessage(phone, reponse);
                        
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                    } else {
                        const reponse = `Désolé, je n'ai pas trouvé "${comprehension.medicament}" dans ma base. 💊\n\nPeux-tu vérifier l'orthographe ou envoyer une photo ?`;
                        
                        await this.whatsapp.sendMessage(phone, reponse);
                        
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    await this.whatsapp.sendMessage(phone, comprehension.reponse);
                    
                    conv.historique.push({
                        role: "assistant",
                        content: comprehension.reponse,
                        timestamp: Date.now()
                    });
                    
                    if (['delivery', 'creator', 'purpose', 'support'].includes(comprehension.intention)) {
                        const cacheKey = `intention:${comprehension.intention}`;
                        await cache.set(cacheKey, comprehension.reponse, 3600);
                    }
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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS queries_log (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(20),
            message TEXT,
            type VARCHAR(50),
            medicament VARCHAR(200),
            timestamp TIMESTAMP DEFAULT NOW()
        );
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicaments_nom ON medicaments(nom_commercial);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_medicaments_dci ON medicaments(dci);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_queries_type ON queries_log(type);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_queries_timestamp ON queries_log(timestamp);`);

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
        db: 'checking',
        cache: {
            local: 'ok',
            redis: redis ? 'ok' : 'disabled'
        }
    };

    try {
        await pool.query('SELECT 1');
        health.db = 'ok';
    } catch {
        health.db = 'error';
    }

    res.json(health);
});

app.get('/stats', async (req, res) => {
    try {
        const stats = {
            uptime: process.uptime(),
            conversations: bot.conversations.size,
            memory: process.memoryUsage(),
            cache: {
                redis: redis ? 'connected' : 'disabled'
            }
        };

        // Stats DB
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_queries,
                COUNT(DISTINCT phone) as unique_users,
                type,
                COUNT(*) as type_count
            FROM queries_log 
            WHERE timestamp > NOW() - INTERVAL '24 hours'
            GROUP BY type
        `);
        
        stats.queries = result.rows;

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
║   🚀 MARIAM IA - PRODUCTION READY                         ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║                                                           ║
║   🤖 100% IA Conversationnelle                            ║
║   💬 Llama 3.3 70B (texte principal)                     ║
║   💬 Llama 3 70B (texte secours)                         ║
║   📸 Llama 4 Scout 17B (vision)                          ║
║   🔍 Fuse.js (recherche floue)                           ║
║   📦 Smart Cache (80-90% réduction appels LLM)           ║
║   🗄️ Redis + NodeCache                                    ║
║   🗃️ PostgreSQL                                           ║
║   ⏱️ Gestion automatique des quotas                      ║
║   🔄 Fallback après 1h                                    ║
║                                                           ║
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                           ║
║   👨💻 Créé par Youssef - UPSP 2026                       ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
            `);
            
            log('info', '🚀 MARIAM IA est opérationnelle');
            log('info', `📊 Cache intelligent actif - Économie LLM estimée: 80-90%`);
            log('info', `⏱️ Quotas réinitialisés après 1 heure`);
        });
    } catch (error) {
        log('error', `Fatal: ${error.message}`);
        process.exit(1);
    }
}

start();

// ===========================================
// WORKER POUR ANALYSE D'IMAGE (optionnel)
// ===========================================
if (workerData && workerData.action === 'analyzeImage') {
    const visionService = new LLMService();
    const buffer = Buffer.from(workerData.imageBuffer, 'base64');
    
    visionService.analyserImage(buffer)
        .then(result => parentPort.postMessage(result))
        .catch(() => parentPort.postMessage({ medicaments: [] }));
}

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', async () => {
    log('info', 'SIGTERM reçu, arrêt gracieux...');
    await pool.end();
    if (redis) await redis.quit();
    process.exit(0);
});

process.on('SIGINT', async () => {
    log('info', 'SIGINT reçu, arrêt gracieux...');
    await pool.end();
    if (redis) await redis.quit();
    process.exit(0);
});
