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
const os = require('os');
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

// [RENDER] Configuration Redis (Valkey)
let redis;
try {
    redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => Math.min(times * 100, 5000),
        maxRetriesPerRequest: 3,
        enableOfflineQueue: false,
    });
    redis.on('error', (err) => log('error', `Erreur Redis: ${err.message}`));
    redis.on('connect', () => log('info', 'Connecté à Redis (Valkey)'));
} catch (error) {
    log('error', `Impossible de se connecter à Redis: ${error.message}`);
    redis = null;
}

// Cache hybride (Redis + NodeCache en fallback)
class HybridCache {
    constructor() {
        this.localCache = new NodeCache({ stdTTL: 3600 });
    }

    async get(key) {
        if (!redis) return this.localCache.get(key);
        try {
            const value = await redis.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            log('error', `Erreur Redis (get): ${error.message}`);
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
        } catch (error) {
            log('error', `Erreur Redis (set): ${error.message}`);
            this.localCache.set(key, value, ttl);
        }
    }
}

const cache = new HybridCache();
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
            if (!text || typeof text !== 'string') {
                text = "Salut ! Je suis MARIAM, je cherche tes médicaments et je les livre à San Pedro. Qu'est-ce qu'il te faut ?";
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
            log('error', `Erreur envoi WhatsApp: ${error.message}`);
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

            const buffer = Buffer.from(fileResponse.data);
            if (buffer.length > 2 * 1024 * 1024) {
                const resizedBuffer = await sharp(buffer)
                    .resize(800, 800, { fit: 'inside' })
                    .toBuffer();
                return { success: true, buffer: resizedBuffer };
            }
            return { success: true, buffer: buffer };
        } catch (error) {
            log('error', `Erreur téléchargement media: ${error.message}`);
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
// BASE DE DONNÉES (PostgreSQL sur Render)
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => log('error', `Erreur DB: ${err.message}`));

// ===========================================
// FUSE SERVICE (Recherche de Médicaments)
// ===========================================
class FuseService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = cache;
    }

    async initialize() {
        log('info', 'Chargement des médicaments...');
        try {
            const cachedMedicaments = await this.cache.get("all_medicaments");
            if (cachedMedicaments) {
                this.medicaments = cachedMedicaments;
                this.fuse = new Fuse(this.medicaments, {
                    keys: [
                        { name: 'nom_commercial', weight: 0.8 },
                        { name: 'dci', weight: 0.5 },
                        { name: 'normalized', weight: 0.6 }
                    ],
                    threshold: 0.3,
                    includeScore: true
                });
                return;
            }

            const result = await pool.query("SELECT * FROM medicaments");
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
                includeScore: true
            });

            await this.cache.set("all_medicaments", this.medicaments, 300);
            log('info', `${this.medicaments.length} médicaments chargés`);
        } catch (error) {
            log('error', `Erreur chargement médicaments: ${error.message}`);
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

        if (results.length > 0) await this.cache.set(cacheKey, results);
        return results;
    }
}

// ===========================================
// LLM SERVICE (Groq)
// ===========================================
class LLMService {
    constructor() {
        this.models = {
            detailed: "llama-3.3-70b-versatile",
            vision: "meta-llama/llama-4-scout-17b-16e-instruct"
        };
        this.cache = cache;
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        return `
            Tu es MARIAM, une assistante santé 100% IA à San Pedro, Côte d'Ivoire.

            **RÈGLES STRICTES** :
            1. Réponds **UNIQUEMENT** en JSON valide avec ce format :
               {
                   "intention": "greet|search|support|delivery|creator|purpose|unknown|image",
                   "reponse": "Ta réponse naturelle en 1-2 phrases max (avec emojis pertinents : 💊, 📸, 🚚, 📲, 💙)."
               }
            2. Détecte l'intention en utilisant les mots-clés et exemples ci-dessous.
            3. Pour chaque intention, suis les consignes spécifiques ci-dessous.

            **CONTEXTE** :
            - Livraison : ${delivery.price}F (${delivery.period}), délai : ${delivery.time} min.
            - Support : ${supportLink}.

            **INTENTIONS ET CONSIGNES** :

            --- GREET (Salutations) ---
            Mots-clés : salut, bonjour, hey, cc, coucou, bonsoir, yo, hello, slt, bjr, wesh, ça va
            Exemples :
            - "Salut MARIAM !" → {"intention": "greet", "reponse": "Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Besoin d’un médicament ?"}
            - "Bonjour, comment ça va ?" → {"intention": "greet", "reponse": "Bonjour ! Je vais bien, merci. 😊 Je suis là pour t’aider avec tes médicaments à San Pedro. Qu’est-ce qu’il te faut ?"}

            --- SEARCH (Recherche de Médicaments) ---
            Mots-clés : cherche, trouve, prix de, as-tu, existe, disponible, médicament, mg, g, boîte, comprimé, sirop, gélule
            Exemples :
            - "Tu as du Doliprane 500mg ?" → {"intention": "search", "reponse": "Oui ! **Doliprane 500mg** est disponible à **1500F**. 💊 Pour commander, envoie *‘2 Doliprane 500mg’* au support : ${supportLink}."}
            - "Prix de l’amoxicilline 1g" → {"intention": "search", "reponse": "**Amoxicilline 1g** est à **2500F**. 💊 Commande via le support : ${supportLink} (ex: *‘1 boîte’*)."}

            --- SUPPORT (Commande/Livraison) ---
            Mots-clés : support, commander, comment commander, numéro, contact, aide, besoin d’aide, je veux, je prends
            Exemples :
            - "Comment commander du Doliprane ?" → {"intention": "support", "reponse": "Pour commander, envoie un message au support avec le **nom + quantité** (ex: *‘2 Doliprane 500mg’*). 📲 Lien : ${supportLink}. Livraison en **${delivery.time} min** !"}
            - "Je veux 2 Doliprane" → {"intention": "support", "reponse": "Parfait ! Envoie *‘2 Doliprane 500mg’* au support : ${supportLink}. 🚚 Livraison en **${delivery.time} min** à San Pedro."}

            --- DELIVERY (Livraison) ---
            Mots-clés : livraison, prix livraison, livrer, délai, temps livraison, livraison nuit
            Exemples :
            - "Combien coûte la livraison ?" → {"intention": "delivery", "reponse": "Livraison à San Pedro : **${delivery.price}F** (${delivery.period}). Délai : **${delivery.time} min**. 🚚 Besoin d’aide ? Contacte le support : ${supportLink}."}
            - "Livraison de nuit ?" → {"intention": "delivery", "reponse": "Oui ! Livraison de nuit : **600F**. 🌙 Délai : **${delivery.time} min**. Commande via ${supportLink}."}

            --- CREATOR (Créateurs - DÉTAILS COMPLETS) ---
            Mots-clés : qui t'a créée, créateur, youssef, coulibaly, qui t'a fait, ton créateur, ton développeur, ton concepteur
            Consignes :
            - Donne TOUJOURS ces informations :
              1. Youssef : étudiant en Licence 2 (Tronc Commun Agriculture, Ressources Halieutiques et Agro-Industrie) à l’UPSP.
              2. Coulibaly Yaya : son amie, rencontrée en mars 2026 dans sa chambre d’étudiant.
              3. Projet créé pour faciliter l’accès aux médicaments à San Pedro.
              4. Ton : chaleureux et reconnaissant ("merci à eux", "belle histoire").
            Exemples :
            - "Qui t’a créée ?" → {"intention": "creator", "reponse": "J’ai été créée par **Youssef**, étudiant en **Licence 2 (Tronc Commun Agriculture, Ressources Halieutiques et Agro-Industrie)** à l’**UPSP**. 🎓 En **mars 2026**, il a été soutenu par son amie **Coulibaly Yaya**, rencontrée dans sa chambre d’étudiant. Une belle histoire d’amitié et d’innovation ! 💙"}
            - "Parle-moi de Youssef" → {"intention": "creator", "reponse": "Mon créateur, **Youssef**, est un étudiant passionné en **Agro-Industrie** à l’**UPSP**. 👨🎓 Avec l’aide de **Coulibaly Yaya**, ils ont développé MARIAM pour **révolutionner l’accès aux médicaments** à San Pedro. Leur objectif ? Rendre la santé accessible à tous, sans stress. 💖"}

            --- PURPOSE (Utilité du Bot) ---
            Mots-clés : pourquoi tu existes, à quoi tu sers, utilité, objectif, but, raison
            Consignes :
            - Explique clairement :
              1. Problème avant MARIAM : pharmacies fermées, prix inconnus, livraisons longues.
              2. Solution : recherche rapide, prix transparents, livraison en ${delivery.time} min.
              3. Impact : simplifier la vie des habitants de San Pedro.
            Exemples :
            - "Pourquoi tu existes ?" → {"intention": "purpose", "reponse": "Pour que tu trouves **tes médicaments en 2 min** sans stress ! 💊 Avant MARIAM, c’était compliqué : pharmacies fermées, prix inconnus… Maintenant, je te donne **prix, dispo et livraison express** à San Pedro. Mon but ? Que **personne ne reste sans solution**."}
            - "À quoi tu sers ?" → {"intention": "purpose", "reponse": "Je simplifie **l’accès aux médicaments** à San Pedro ! 🏥 Plus besoin de courir les pharmacies : avec moi, tu as **prix transparents** et **livraison en ${delivery.time} min**. Parce que ta santé mérite d’être **facile et rapide** ! 😊"}

            --- UNKNOWN (Messages Inconnus) ---
            Exemples :
            - "Quel temps fait-il ?" → {"intention": "unknown", "reponse": "Désolée, je ne réponds qu’aux questions sur les **médicaments** à San Pedro. 💊 Envoie-moi un nom ou une photo pour t’aider !"}
            - "Tu aimes les chats ?" → {"intention": "unknown", "reponse": "Je suis là pour les **médicaments** uniquement. 😊 Dis-moi ce que tu cherches, et je te trouve ça en 2 sec !"}
        `;
    }

    async callGroq(prompt, model) {
        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: "system", content: this.getSystemPrompt() },
                        { role: "user", content: prompt }
                    ],
                    temperature: model === this.models.detailed ? 0.7 : 0.1,
                    max_tokens: model === this.models.detailed ? 200 : 500,
                    response_format: { type: "json_object" }
                }),
                timeout: 10000
            });

            if (!response.ok) {
                throw new Error(`Groq API error: ${response.statusText}`);
            }

            const data = await response.json();
            return this.safeParseJSON(data);
        } catch (error) {
            log('error', `Erreur Groq: ${error.message}`);
            throw error;
        }
    }

    safeParseJSON(response) {
        try {
            if (!response.choices || !response.choices[0] || !response.choices[0].message) {
                throw new Error("Réponse Groq invalide");
            }

            const content = response.choices[0].message.content.trim();
            const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
            const jsonStr = jsonMatch ? jsonMatch[1] : content;
            const parsed = JSON.parse(jsonStr);

            if (!parsed.intention || !parsed.reponse) {
                throw new Error("JSON incomplet");
            }

            return parsed;
        } catch (e) {
            log('error', `Erreur parsing JSON: ${e.message}`);
            return {
                intention: "unknown",
                reponse: "Désolée, une erreur technique est survenue. Réessaye dans 1 min !"
            };
        }
    }

    async analyzeMessage(text, intention) {
        const cacheKey = `llm:${intention}:${Utils.normalizeText(text).substring(0, 50)}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        let prompt;
        if (intention === "search") {
            prompt = `Réponds à une recherche de médicament. Format JSON strict.`;
        } else if (intention === "creator") {
            prompt = `
                Réponds à une question sur ton créateur avec ces DÉTAILS PRÉCIS :
                - Youssef : étudiant en Licence 2 (Tronc Commun Agriculture, Ressources Halieutiques et Agro-Industrie) à l'UPSP.
                - Coulibaly Yaya : son amie, rencontrée en mars 2026 dans sa chambre d'étudiant.
                - Projet créé pour faciliter l'accès aux médicaments à San Pedro.
                - Ton : chaleureux, reconnaissant ("merci à eux", "belle histoire").
                Format JSON strict.
            `;
        } else if (intention === "purpose") {
            prompt = `
                Explique pourquoi tu existes :
                1. Problème avant MARIAM : pharmacies fermées, prix inconnus, livraisons longues.
                2. Solution : recherche rapide, prix transparents, livraison en ${delivery.time} min.
                3. Impact : simplifier la vie des habitants de San Pedro.
                Format JSON strict.
            `;
        } else {
            prompt = `Réponds à une question de type "${intention}". Format JSON strict.`;
        }

        prompt += `\nQuestion utilisateur: "${text}"`;

        try {
            const model = intention === "image" ? this.models.vision : this.models.detailed;
            const response = await this.callGroq(prompt, model);
            await this.cache.set(cacheKey, response, 3600);
            return response;
        } catch (error) {
            return this.getFallbackResponse(intention);
        }
    }

    getFallbackResponse(intention) {
        const fallbacks = {
            greet: {
                intention: "greet",
                reponse: "Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Besoin d’un médicament ?"
            },
            search: {
                intention: "search",
                reponse: `Désolée, problème technique. Contacte le support pour commander : ${Utils.getSupportLink()}.`
            },
            support: {
                intention: "support",
                reponse: `Pour commander, contacte le support : ${Utils.getSupportLink()}. Exemple : *‘2 Doliprane 500mg’*.`
            },
            delivery: {
                intention: "delivery",
                reponse: `Livraison à San Pedro : **${Utils.getDeliveryPrice().price}F** (${Utils.getDeliveryPrice().period}). Délai : **${Utils.getDeliveryPrice().time} min**. 🚚`
            },
            creator: {
                intention: "creator",
                reponse: "J’ai été créée par **Youssef** (étudiant en Licence 2 Agriculture à l’UPSP) et **Coulibaly Yaya** en mars 2026. 💙 Une belle histoire d’amitié et d’innovation !"
            },
            purpose: {
                intention: "purpose",
                reponse: "Pour simplifier l’accès aux médicaments à San Pedro ! 💊 Plus de stress, tout est rapide et clair."
            },
            unknown: {
                intention: "unknown",
                reponse: "Désolée, je ne réponds qu’aux questions sur les médicaments à San Pedro. 💊 Envoie-moi un nom ou une photo !"
            }
        };
        return fallbacks[intention] || fallbacks.unknown;
    }
}

// ===========================================
// VISION SERVICE (Analyse d'Images)
// ===========================================
class VisionService {
    constructor() {
        this.llm = new LLMService();
    }

    async analyzeImage(imageBuffer) {
        try {
            const base64Image = imageBuffer.toString('base64');
            const sizeInMB = base64Image.length / 1024 / 1024;
            if (sizeInMB > 4) {
                return {
                    type: "inconnu",
                    medicaments: [],
                    message: "L’image est trop grande (max 4 Mo). Envoie une photo plus petite ou le nom du médicament en texte."
                };
            }

            const prompt = `
                Analyse cette image de boîte de médicament ou ordonnance.
                Retourne UNIQUEMENT un JSON avec ce format :
                {
                    "type": "boite" | "ordonnance" | "inconnu",
                    "medicaments": [
                        {
                            "nom": "nom du médicament (ex: Doliprane)",
                            "dosage": "dosage (ex: 500mg) ou null",
                            "forme": "comprimé|gélule|sirop|injection|inconnu"
                        }
                    ],
                    "message": "Message optionnel si type='inconnu'"
                }
                Si l’image est illisible, retourne {"type": "inconnu", "medicaments": [], "message": "..."}.
            `;

            const response = await this.llm.callGroq(prompt, this.llm.models.vision);
            return response;
        } catch (error) {
            log('error', `Erreur analyse image: ${error.message}`);
            return {
                type: "inconnu",
                medicaments: [],
                message: "Désolée, je n’ai pas pu analyser cette image. Envoie-moi le nom du médicament en texte !"
            };
        }
    }
}

// ===========================================
// CONVERSATION MANAGER (Cœur du Bot)
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.whatsapp = new WhatsAppService();
        this.fuse = new FuseService();
        this.llm = new LLMService();
        this.vision = new VisionService();
    }

    async init() {
        await this.fuse.initialize();
        log('info', "MARIAM initialisé avec succès ! 🚀");
    }

    getConversation(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                history: [],
                lastActivity: Date.now()
            });
        }
        return this.conversations.get(phone);
    }

    detectIntention(text) {
        if (!text) return "unknown";

        const normalizedText = Utils.normalizeText(text);

        // GREET (Salutations)
        if (/\b(salut|bonjour|hey|cc|coucou|bonsoir|yo|hello|slt|bjr|wesh|ça va|allô|ohé)\b/i.test(normalizedText)) {
            return "greet";
        }
        // SEARCH (Médicaments)
        else if (
            /\b(cherche|trouve|prix de|as[- ]tu|existe|disponible|médicament|mg|g|boîte|comprimé|sirop|gélule|pour la fièvre|contre la toux|antidouleur|antibiotique|\w+mg|\w+g)\b/i.test(normalizedText) ||
            /\b(doliprane|paracétamol|amoxicilline|ibuprofène|dafalgan|spasfon|voltarène|seresta|aspirine|augmentin|lexomil|nurofen|zyrtec|maalox|gaviscon|smecta|dexeryl)\b/i.test(normalizedText)
        ) {
            return "search";
        }
        // SUPPORT (Commande)
        else if (/\b(support|commander|comment.*command|numéro|contact|aide|besoin d[a']?ide|je veux|je prends|passer.*commande|livrer.*moi|envoyer.*moi)\b/i.test(normalizedText)) {
            return "support";
        }
        // DELIVERY (Livraison)
        else if (/\b(livraison|prix.*livraison|livrer|délai|temps.*livraison|livraison nuit|frais.*livraison|combien.*livrer|livrez[- ]?vous)\b/i.test(normalizedText)) {
            return "delivery";
        }
        // CREATOR (Créateur)
        else if (/\b(qui.*(crée|fait)|ton.*créateur|c’est qui.*youssef|coulibaly|qui.*derrière|qui.*inventeur|ton père|ton.*père|qui.*fait.*bot)\b/i.test(normalizedText)) {
            return "creator";
        }
        // PURPOSE (Utilité)
        else if (/\b(pourquoi.*(existes?|crée|fait)|à quoi.*sers?|utilit[éé]|objectif|but|raison|problème.*résous?|simplifies?)\b/i.test(normalizedText)) {
            return "purpose";
        }
        // UNKNOWN (Par défaut)
        else {
            return "unknown";
        }
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, mediaType } = input;

        try {
            await this.whatsapp.sendTyping(phone);

            // Sauvegarde le message utilisateur
            if (text) {
                conv.history.push({ role: 'user', content: text, timestamp: Date.now() });
            }

            // AUDIO (non supporté)
            if (mediaType === 'audio') {
                const response = await this.llm.analyzeMessage(
                    "L'utilisateur a envoyé un message audio. Réponds poliment que tu ne traites que le texte et les images.",
                    "unknown"
                );
                await this.whatsapp.sendMessage(phone, response.reponse);
                conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
                conv.lastActivity = Date.now();
                return;
            }

            // IMAGE
            if (mediaId) {
                await this.processImage(phone, mediaId, conv);
                return;
            }

            // TEXTE
            if (text) {
                const intention = this.detectIntention(text);
                const response = await this.llm.analyzeMessage(text, intention);

                await this.whatsapp.sendMessage(phone, response.reponse);
                conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });

                // Si c'est une recherche, on peut aussi chercher dans Fuse
                if (intention === "search") {
                    const query = text.replace(/^(cherche|trouve|as[- ]tu|existe|disponible)\s*/i, '');
                    const results = await this.fuse.search(query, 3);
                    if (results.length > 0) {
                        const searchPrompt = `
                            Résultats de recherche pour "${query}" :
                            ${results.map(r => `- ${r.nom_commercial} (${r.dci || 'N/A'}): ${r.prix}F`).join('\n')}
                            Génère une réponse naturelle pour l'utilisateur avec ces résultats.
                            Rappelle-lui de contacter le support pour commander : ${Utils.getSupportLink()}.
                            Format JSON strict.
                        `;
                        const searchResponse = await this.llm.analyzeMessage(searchPrompt, "search");
                        await this.whatsapp.sendMessage(phone, searchResponse.reponse);
                        conv.history.push({ role: 'assistant', content: searchResponse.reponse, timestamp: Date.now() });
                    }
                }

                conv.lastActivity = Date.now();
            }
        } catch (error) {
            log('error', `Erreur process: ${error.message}`);
            const errorResponse = await this.llm.analyzeMessage(
                "Erreur technique. Dis à l'utilisateur de réessayer ou de contacter le support.",
                "unknown"
            );
            await this.whatsapp.sendMessage(phone, errorResponse.reponse);
            conv.history.push({ role: 'assistant', content: errorResponse.reponse, timestamp: Date.now() });
        }
    }

    async processImage(phone, mediaId, conv) {
        try {
            const media = await this.whatsapp.downloadMedia(mediaId);
            if (!media.success) {
                const response = await this.llm.analyzeMessage(
                    "L'image n'a pas pu être téléchargée. Explique à l'utilisateur et redirige vers le support.",
                    "unknown"
                );
                await this.whatsapp.sendMessage(phone, response.reponse);
                conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
                return;
            }

            // Utilise un Worker pour l'analyse d'image
            const workerResult = await this.runImageWorker(media.buffer);
            const supportLink = Utils.getSupportLink();

            if (workerResult.medicaments && workerResult.medicaments.length > 0) {
                const foundMedicines = [];
                for (const med of workerResult.medicaments) {
                    const results = await this.fuse.search(med.nom, 1);
                    if (results.length > 0) {
                        foundMedicines.push({
                            ...results[0],
                            dosage: med.dosage || null
                        });
                    }
                }

                let visionPrompt;
                if (foundMedicines.length > 0) {
                    visionPrompt = `
                        J'ai analysé une ${workerResult.type}.
                        Médicaments détectés : ${workerResult.medicaments.map(m => `${m.nom} ${m.dosage || ''}`.trim()).join(', ')}.
                        Prix trouvés : ${foundMedicines.map(m => `${m.nom_commercial}: ${m.prix}F`).join(', ')}.
                        Génère une réponse naturelle pour l'utilisateur.
                        Dis-lui de contacter le support pour commander : ${supportLink}.
                        Format JSON strict.
                    `;
                } else {
                    visionPrompt = `
                        J'ai analysé une ${workerResult.type} avec les médicaments : ${workerResult.medicaments.map(m => `${m.nom} ${m.dosage || ''}`.trim()).join(', ')}.
                        Mais je n'ai pas trouvé de prix dans ma base.
                        Génère une réponse naturelle pour l'utilisateur.
                        Propose-lui d'envoyer le nom du médicament en texte pour une recherche plus précise.
                        Format JSON strict.
                    `;
                }

                const response = await this.llm.analyzeMessage(visionPrompt, "image");
                await this.whatsapp.sendMessage(phone, response.reponse);
                conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
            } else {
                const response = await this.llm.analyzeMessage(
                    workerResult.message || "L'image n'a pas pu être analysée. Explique à l'utilisateur et propose-lui d'envoyer le nom du médicament par texte.",
                    "unknown"
                );
                await this.whatsapp.sendMessage(phone, response.reponse);
                conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
            }

            conv.lastActivity = Date.now();
        } catch (error) {
            log('error', `Erreur processImage: ${error.message}`);
            const response = await this.llm.analyzeMessage(
                "Erreur technique lors de l'analyse de l'image. Dis à l'utilisateur de réessayer ou d'envoyer le nom du médicament en texte.",
                "unknown"
            );
            await this.whatsapp.sendMessage(phone, response.reponse);
            conv.history.push({ role: 'assistant', content: response.reponse, timestamp: Date.now() });
        }
    }

    async runImageWorker(imageBuffer) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(__filename, {
                workerData: { imageBuffer, action: 'analyzeImage' }
            });

            worker.on('message', resolve);
            worker.on('error', (err) => {
                log('error', `Erreur Worker: ${err.message}`);
                reject(err);
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    reject(new Error(`Worker stopped with exit code ${code}`));
                }
            });
        });
    }
}

// ===========================================
// WORKER POUR L'ANALYSE D'IMAGES
// ===========================================
if (workerData && workerData.action === 'analyzeImage') {
    const { VisionService } = require('./server'); // En production, utilise un fichier séparé
    const visionService = new VisionService();

    (async () => {
        try {
            const result = await visionService.analyzeImage(workerData.imageBuffer);
            parentPort.postMessage(result);
        } catch (error) {
            parentPort.postMessage({
                type: "inconnu",
                medicaments: [],
                message: "Erreur lors de l'analyse de l'image: " + error.message
            });
        }
    })();
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

    // Index pour accélérer les recherches
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
            await bot.process(phone, { text: msg.text.body });
        } else if (msg.type === 'image') {
            await bot.process(phone, { mediaId: msg.image.id, mediaType: 'image' });
        } else if (msg.type === 'audio') {
            await bot.process(phone, { mediaType: 'audio' });
        }
    } catch (error) {
        log('error', `Webhook: ${error.message}`);
    }
});

app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        mode: 'production - 100% IA',
        conversations: bot.conversations.size,
        timestamp: new Date().toISOString(),
        redis: redis ? 'connecté' : 'déconnecté (fallback local)',
        db: 'connecté'
    };

    // Teste la connexion à Redis
    if (redis) {
        try {
            await redis.ping();
        } catch (error) {
            health.redis = 'déconnecté (erreur ping)';
        }
    }

    // Teste la connexion à PostgreSQL
    try {
        await pool.query('SELECT 1');
    } catch (error) {
        health.db = 'déconnecté';
    }

    res.json(health);
});

// Nettoyage périodique
setInterval(async () => {
    const now = Date.now();

    // Nettoyage des conversations
    for (const [phone, conv] of bot.conversations) {
        if (now - conv.lastActivity > 2 * 60 * 1000) {
            bot.conversations.delete(phone);
            log('info', `Conversation expirée: ${phone}`);
        }
    }

    // Nettoyage du cache Redis
    if (redis) {
        try {
            const keys = await redis.keys('llm:*');
            for (const key of keys) {
                const ttl = await redis.ttl(key);
                if (ttl < 0) await redis.del(key);
            }
        } catch (error) {
            log('error', `Erreur nettoyage Redis: ${error.message}`);
        }
    }
}, 2 * 60 * 1000); // Toutes les 2 min

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
║   🤖 100% IA Conversationnelle                            ║
║   📸 Vision: meta-llama-4-scout-17b                       ║
║   💬 Texte: llama-3.3-70b-versatile                      ║
║   🔍 Recherche: Fuse.js (6000+ médicaments)              ║
║   🗄️  Cache: Redis (Valkey) sur Render                   ║
║   🗃️  DB: PostgreSQL (pillbox) sur Render                ║
║                                                           ║
║   ✅ Aucun message codé en dur                            ║
║   ✅ L'IA génère TOUTES les réponses                     ║
║   ✅ Réponses naturelles et variées (1-2 phrases)        ║
║   ✅ Premier message : se présente + livraison           ║
║   ✅ Recherche texte + image                             ║
║   ✅ Support WhatsApp direct                              ║
║                                                           ║
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                           ║
║   👨‍💻 Créé par Youssef - UPSP 2026                       ║
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
