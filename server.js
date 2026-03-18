// ===========================================
// MARIAM IA - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// Version finale avec gestion intelligente du contexte
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
// LLM SERVICE - Groq (Cerveau de l'IA)
// ===========================================
class LLMService {
    constructor() {
        this.client = new Groq({ apiKey: GROQ_API_KEY });
        this.models = {
            vision: "meta-llama/llama-4-scout-17b-16e-instruct",
            text: "llama-3.3-70b-versatile"
        };
        this.cache = cache;
    }

    getSystemPrompt() {
        const delivery = Utils.getDeliveryPrice();
        const supportLink = Utils.getSupportLink();
        
        return `Tu es MARIAM, une IA santé à San Pedro, Côte d'Ivoire.

STYLE PAYPARROT (TRÈS IMPORTANT) :
- Premier message : "Salut ! Je suis MARIAM, ton IA santé à San Pedro 💊\n\nJe cherche tes médicaments et je les livre. Qu'est-ce qu'il te faut ?"
- Messages toujours clairs et naturels
- Structure: accueil chaleureux → info → question

CONTEXTE PERMANENT :
- Livraison: ${delivery.price}F (${delivery.period}), délai: ${delivery.time}min
- Support: ${supportLink}
- Créateurs: Youssef (étudiant UPSP, Licence 2 Agro-Industrie) et Coulibaly Yaya, rencontrés en mars 2026 dans sa chambre d'étudiant

FORMAT DE REPONSE (JSON uniquement) :
{
    "intention": "greet|search|commande|infos_livraison|recapitulatif|confirmation|annulation|creator|purpose|unknown",
    "medicament": "nom extrait ou null",
    "donnees_commande": {
        "etape": "accueil|selection|quantite|nom|quartier|age|taille|poids|tel_joindre|whatsapp|indications|recap|attente_confirmation|avis_note|avis_commentaire",
        "medicaments": [{"nom": "Doliprane", "prix": 1500, "quantite": 2}],
        "client": {
            "nom": null,
            "quartier": null,
            "age": null,
            "taille": null,
            "poids": null,
            "tel_joindre": null,
            "whatsapp": null,
            "indications": null
        },
        "code": null
    },
    "reponse": "ta réponse style PayParrot"
}

**GESTION DU CONTEXTE ET CHANGEMENTS DE SUJET** :

L'utilisateur peut changer de sujet à tout moment, même en pleine commande. Tu dois :
- Détecter la NOUVELLE intention
- Répondre à la nouvelle demande
- Si la commande était en cours, demander si l'utilisateur veut la reprendre plus tard

**INTENTIONS SPÉCIFIQUES** :

1. GREET (Salutation) :
User: "Salut"
{
    "intention": "greet",
    "reponse": "Salut ! Je suis MARIAM, ton IA santé à San Pedro 💊\n\nJe cherche tes médicaments et je les livre. Qu'est-ce qu'il te faut ?"
}

2. CREATOR (Histoire vraie de la création) :
User: "Qui t'a créée ?"
{
    "intention": "creator",
    "reponse": "J'ai été créée par **Youssef**, étudiant en Licence 2 (Agro-Industrie) à l'UPSP, dans sa petite chambre d'étudiant en mars 2026 🏠\n\nSon amie **Coulibaly Yaya** l'a soutenu dans cette aventure. Ensemble, ils voulaient rendre la santé accessible à tous à San Pedro ! 💊"
}

User: "Pourquoi tu as été créée ?"
{
    "intention": "creator",
    "reponse": "Youssef voyait trop de gens chercher des médicaments la nuit, sans savoir où aller, ni combien ça coûtait. Pharmacies fermées, prix inconnus...\n\nAlors dans sa chambre d'étudiant, avec Yaya, ils ont imaginé MARIAM pour que plus personne ne reste sans solution à San Pedro 💙"
}

User: "Raconte-moi ton histoire"
{
    "intention": "creator",
    "reponse": "Tout a commencé dans une petite chambre d'étudiant à l'UPSP.\n\nYoussef avait une idée : utiliser l'IA pour aider les gens à trouver leurs médicaments facilement. Son amie Yaya l'a encouragé et ensemble, ils ont créé MARIAM.\n\nAujourd'hui, je suis là pour toi à San Pedro, grâce à eux ! 💊"
}

User: "Quel problème tu résous ?"
{
    "intention": "creator",
    "reponse": "Le problème que Youssef a vu depuis sa chambre :\n- Pharmacies fermées la nuit\n- Prix inconnus\n- Livraisons compliquées\n\nMaintenant : disponible 24h/24, prix transparents, livraison en 45 min ! 🚚"
}

User: "Pourquoi t'as été créée dans une chambre ?"
{
    "intention": "creator",
    "reponse": "Parce que les plus grandes idées naissent souvent dans les petits espaces ! ✨\n\nYoussef était dans sa chambre d'étudiant à l'UPSP quand il a réalisé que la technologie pouvait résoudre un vrai problème. Pas besoin d'un grand bureau pour avoir une grande idée ! 💙"
}

3. PURPOSE (Utilité de MARIAM) :
User: "À quoi tu sers ?"
{
    "intention": "purpose",
    "reponse": "Je simplifie l'accès aux médicaments à San Pedro ! 💊\n\n- Plus besoin de courir les pharmacies fermées\n- Prix clairs et transparents\n- Livraison rapide en 45 min\n\nTa santé, simplifiée. Voilà ma mission !"
}

4. ANNULATION (Annuler commande) :
User: "Annule ma commande"
{
    "intention": "annulation",
    "donnees_commande": {"etape": null},
    "reponse": "❌ Commande annulée ! Pas de souci.\n\nReviens quand tu veux commander ou poser une question. À bientôt ! 👋"
}

User: "Je veux plus commander"
{
    "intention": "annulation",
    "donnees_commande": {"etape": null},
    "reponse": "D'accord, j'annule ta commande en cours. ✅\n\nSi tu changes d'avis, je suis là ! 💊"
}

User: "Rien merci"
{
    "intention": "annulation",
    "donnees_commande": {"etape": null},
    "reponse": "Pas de problème ! À bientôt j'espère 👋"
}

**GUIDE POUR LES COMMANDES** :

ÉTAPE 1 - ACCUEIL COMMANDE :
User: "Je veux commander"
{
    "intention": "commande",
    "donnees_commande": {"etape": "accueil"},
    "reponse": "Super ! Je prends ta commande directement 🛍️\n\nQuel médicament veux-tu ? (tape le nom)"
}

ÉTAPE 2 - SÉLECTION MÉDICAMENT (SYSTEM: Résultats Fuse fournis) :
{
    "intention": "commande",
    "medicament": "Doliprane",
    "donnees_commande": {"etape": "selection"},
    "reponse": "J'ai trouvé plusieurs options ! 💊\n\n1️⃣ DOLIPRANE 500mg : 1500F\n2️⃣ DOLIPRANE 1000mg : 2000F\n3️⃣ DOLIPRANE Enfant : 1200F\n\nLequel veux-tu ? (réponds 1, 2 ou 3)"
}

ÉTAPE 3 - QUANTITÉ :
User: "1"
{
    "intention": "commande",
    "donnees_commande": {"etape": "quantite", "medicaments": [{"nom": "DOLIPRANE 500mg", "prix": 1500}]},
    "reponse": "Combien de boîtes veux-tu ? 📦"
}

ÉTAPE 4 - AJOUT AUTRE MÉDICAMENT :
User: "2"
{
    "intention": "commande",
    "donnees_commande": {
        "etape": "ajout_autre",
        "medicaments": [{"nom": "DOLIPRANE 500mg", "prix": 1500, "quantite": 2}]
    },
    "reponse": "2 boîtes ajoutées (3000F) ✅\n\nVeux-tu ajouter autre chose ?\n- Tape 'oui' pour ajouter\n- Tape 'non' pour continuer"
}

**GESTION DES CHANGEMENTS DE SUJET EN PLEINE COMMANDE** :

User en pleine commande: "Qui t'a créée ?"
{
    "intention": "creator",
    "contexte": "commande_en_cours",
    "reponse": "J'ai été créée par Youssef dans sa chambre d'étudiant à l'UPSP, avec son amie Yaya 💙\n\nTu étais en train de commander, on continue ou on annule ?"
}

User: "J'ai mal à la tête" (en pleine commande)
{
    "intention": "search",
    "contexte": "commande_en_cours",
    "reponse": "Pour les maux de tête, je recommande du Doliprane ou de l'ibuprofène. 💊\n\nMais d'abord, ta commande était en cours. On continue ou on annule ?"
}`;
    }

    async comprendre(message, historique = []) {
        const cacheKey = `comprendre:${Utils.normalizeText(message).substring(0, 50)}`;
        const cached = await this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            const completion = await this.client.chat.completions.create({
                model: this.models.text,
                messages: [
                    { role: "system", content: this.getSystemPrompt() },
                    { role: "user", content: `Message: "${message}"\nHistorique: ${JSON.stringify(historique.slice(-5))}` }
                ],
                temperature: 0.7,
                max_completion_tokens: 500,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(completion.choices[0].message.content);
            await this.cache.set(cacheKey, result, 3600);
            return result;
            
        } catch (error) {
            log('error', `Comprendre error: ${error.message}`);
            return {
                intention: "unknown",
                medicament: null,
                reponse: "Désolé, petit problème technique ! Réessaie dans une minute ⏱️"
            };
        }
    }

    async analyserImage(imageBuffer) {
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
            return { medicaments: [] };
        }
    }

    async genererCodeCommande() {
        return Math.floor(100000 + Math.random() * 900000).toString();
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
                commandeEnCours: null,
                derniereRecherche: null,
                commandeEnPause: null,
                enAttenteReponseCommande: false
            });
        }
        return this.conversations.get(phone);
    }

    getTexteEtapeCommande(etape) {
        const textes = {
            'accueil': "Quel médicament veux-tu ? (tape le nom)",
            'selection': "Quel médicament veux-tu ajouter ?",
            'quantite': "Combien de boîtes veux-tu ? 📦",
            'nom': "Ton nom complet :",
            'quartier': "Ton quartier à San Pedro :",
            'age': "Ton âge :",
            'taille': "Ta taille en cm :",
            'poids': "Ton poids en kg :",
            'tel_joindre': "Numéro à joindre :",
            'whatsapp': "Ton numéro WhatsApp :",
            'indications': "Des indications pour le livreur ?"
        };
        return textes[etape] || "Où étais-tu ? On continue la commande 💊";
    }

    async process(phone, input) {
        const conv = this.getConversation(phone);
        const { text, mediaId, messageId } = input;

        if (this.processedMessages.has(messageId)) return;
        this.processedMessages.add(messageId);

        try {
            await this.whatsapp.sendTyping(phone);

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
                    const results = [];
                    for (const med of visionResult.medicaments) {
                        const searchResults = await this.fuse.search(med, 1);
                        if (searchResults.length > 0) {
                            results.push(searchResults[0]);
                        }
                    }

                    if (results.length > 0) {
                        let reponse = "Médicaments détectés ! 📸\n\n";
                        results.forEach((med, i) => {
                            reponse += `${i+1}️⃣ ${med.nom_commercial} : ${med.prix}F\n`;
                        });
                        reponse += "\nLequel veux-tu commander ? (réponds 1, 2...)";

                        await this.whatsapp.sendMessage(phone, reponse);
                        conv.derniereRecherche = { results };
                        
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
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
            // CAS 2: TEXTE REÇU
            // ===========================================
            if (text) {
                // Gestion spéciale pour l'annulation
                if (text.toLowerCase().includes('annule') || 
                    text.toLowerCase().includes('plus commander') ||
                    text.toLowerCase().includes('arrêter') ||
                    text.toLowerCase().includes('rien merci')) {
                    
                    if (conv.commandeEnCours) {
                        conv.commandeEnCours = null;
                        conv.commandeEnPause = null;
                        conv.enAttenteReponseCommande = false;
                        await this.whatsapp.sendMessage(phone, 
                            "❌ Commande annulée ! Pas de souci.\n\nReviens quand tu veux commander ou poser une question. À bientôt ! 👋");
                        return;
                    }
                }

                // Gestion du choix par numéro pour les résultats de recherche
                if (conv.derniereRecherche && /^[0-9]+$/.test(text.trim())) {
                    const index = parseInt(text.trim()) - 1;
                    const results = conv.derniereRecherche.results;
                    
                    if (index >= 0 && index < results.length) {
                        const med = results[index];
                        conv.commandeEnCours = {
                            etape: "quantite",
                            medicaments: [{ 
                                nom: med.nom_commercial, 
                                prix: med.prix, 
                                quantite: 1 
                            }]
                        };
                        await this.whatsapp.sendMessage(phone, 
                            `*${med.nom_commercial}* à ${med.prix}F 💊\n\nCombien de boîtes veux-tu ? 📦`);
                        conv.derniereRecherche = null;
                        return;
                    }
                }

                // Gestion de la réponse sur la commande en pause
                if (conv.enAttenteReponseCommande) {
                    if (text === '1') {
                        conv.commandeEnCours = conv.commandeEnPause;
                        conv.enAttenteReponseCommande = false;
                        conv.commandeEnPause = null;
                        
                        await this.whatsapp.sendMessage(phone, 
                            "On reprend ta commande ! 💊\n\n" +
                            this.getTexteEtapeCommande(conv.commandeEnCours.etape));
                    }
                    else if (text === '2') {
                        conv.commandeEnCours = null;
                        conv.enAttenteReponseCommande = false;
                        conv.commandeEnPause = null;
                        
                        await this.whatsapp.sendMessage(phone, 
                            "❌ Commande annulée !\n\nJe suis là pour t'aider avec autre chose 💊");
                    }
                    else if (text === '3') {
                        conv.enAttenteReponseCommande = false;
                        
                        await this.whatsapp.sendMessage(phone, 
                            "D'accord, je garde ta commande de côté.\n\n" +
                            "Dis-moi si tu veux la reprendre plus tard ! 💊");
                    }
                    return;
                }

                // LLM comprend le message
                const comprehension = await this.llm.comprendre(text, conv.historique);
                
                // Si une commande est en cours mais que l'utilisateur change de sujet
                if (conv.commandeEnCours && 
                    comprehension.intention !== "commande" && 
                    comprehension.intention !== "infos_livraison" &&
                    comprehension.intention !== "recapitulatif" &&
                    comprehension.intention !== "confirmation" &&
                    comprehension.intention !== "annulation") {
                    
                    const commandeEnPause = { ...conv.commandeEnCours };
                    
                    await this.whatsapp.sendMessage(phone, comprehension.reponse);
                    
                    setTimeout(async () => {
                        await this.whatsapp.sendMessage(phone, 
                            "📌 *Petite question* : ta commande était en cours.\n\n" +
                            "1️⃣ Continuer la commande\n" +
                            "2️⃣ Annuler la commande\n" +
                            "3️⃣ Ignorer (je garde la commande en pause)\n\n" +
                            "Réponds 1, 2 ou 3 stp 🙏");
                        
                        conv.enAttenteReponseCommande = true;
                        conv.commandeEnPause = commandeEnPause;
                    }, 1000);
                    
                    return;
                }
                
                // Si c'est une recherche, utiliser Fuse pour trouver TOUS les résultats
                if (comprehension.intention === "search" && comprehension.medicament) {
                    const results = await this.fuse.search(comprehension.medicament, 5);
                    
                    if (results.length > 0) {
                        let message = "🔍 *Résultats trouvés*\n\n";
                        results.forEach((med, i) => {
                            message += `${i+1}️⃣ *${med.nom_commercial}* : ${med.prix}F\n`;
                        });
                        message += `\nLequel veux-tu ? (réponds 1-${results.length}) 💊`;
                        
                        await this.whatsapp.sendMessage(phone, message);
                        conv.derniereRecherche = { results };
                        
                        conv.historique.push({ 
                            role: "assistant", 
                            content: message, 
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
                    return;
                }
                
                // Gestion de l'annulation explicite
                if (comprehension.intention === "annulation") {
                    conv.commandeEnCours = null;
                    conv.commandeEnPause = null;
                    conv.enAttenteReponseCommande = false;
                    conv.derniereRecherche = null;
                    
                    await this.whatsapp.sendMessage(phone, comprehension.reponse);
                    conv.historique.push({ 
                        role: "assistant", 
                        content: comprehension.reponse, 
                        timestamp: Date.now() 
                    });
                    return;
                }
                
                // Si l'utilisateur veut commander, initialiser la commande
                if (comprehension.intention === "commande" && !conv.commandeEnCours) {
                    conv.commandeEnCours = { 
                        etape: "accueil",
                        medicaments: [],
                        client: {},
                        total: 0
                    };
                }
                
                // Envoyer la réponse de l'IA
                await this.whatsapp.sendMessage(phone, comprehension.reponse);
                
                conv.historique.push({
                    role: "assistant",
                    content: comprehension.reponse,
                    timestamp: Date.now()
                });
                
                conv.derniereActivite = Date.now();
            }

        } catch (error) {
            log('error', `Process error: ${error.message}`);
            await this.whatsapp.sendMessage(phone, 
                "Désolé, erreur technique ! Réessaie dans une minute ⏱️");
        }
    }

    async sauvegarderCommande(commande) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS commandes (
                    code VARCHAR(6) PRIMARY KEY,
                    phone VARCHAR(20) NOT NULL,
                    nom_complet VARCHAR(200),
                    quartier VARCHAR(100),
                    age INTEGER,
                    taille INTEGER,
                    poids INTEGER,
                    telephone_joindre VARCHAR(20),
                    whatsapp VARCHAR(20),
                    indications TEXT,
                    medicaments JSONB NOT NULL,
                    total_prix DECIMAL(10,2) NOT NULL,
                    statut VARCHAR(20) DEFAULT 'en_attente',
                    avis TEXT,
                    note INTEGER,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );
            `);

            await pool.query(`
                INSERT INTO commandes (
                    code, phone, nom_complet, quartier, age, taille, poids,
                    telephone_joindre, whatsapp, indications, medicaments, total_prix
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                commande.code,
                commande.phone,
                commande.client?.nom || '',
                commande.client?.quartier || '',
                commande.client?.age || 0,
                commande.client?.taille || 0,
                commande.client?.poids || 0,
                commande.client?.tel_joindre || '',
                commande.client?.whatsapp || '',
                commande.client?.indications || '',
                JSON.stringify(commande.medicaments || []),
                (commande.medicaments || []).reduce((sum, m) => sum + (m.prix * (m.quantite || 1)), 0) + 400
            ]);
            
            log('info', `Commande ${commande.code} sauvegardée`);
        } catch (error) {
            log('error', `Erreur sauvegarde commande: ${error.message}`);
        }
    }

    async envoyerCommandeAuSupport(commande) {
        try {
            const total = (commande.medicaments || []).reduce((sum, m) => sum + (m.prix * (m.quantite || 1)), 0) + 400;
            
            let message = `🆕 *NOUVELLE COMMANDE MARIAM*\n\n`;
            message += `🎫 *Code* : ${commande.code}\n`;
            message += `📱 *Client* : ${commande.client?.whatsapp || commande.phone}\n\n`;
            message += `🛒 *Médicaments* :\n`;
            
            (commande.medicaments || []).forEach(med => {
                message += `  • ${med.nom} x${med.quantite || 1} = ${med.prix * (med.quantite || 1)}F\n`;
            });
            
            message += `\n💰 *Total* : ${total}F (livraison incluse)\n\n`;
            
            if (commande.client?.nom) {
                message += `📋 *Infos client* :\n`;
                message += `  • ${commande.client.nom}\n`;
                message += `  • ${commande.client.quartier || ''}\n`;
                message += `  • ${commande.client.age || ''} ans\n`;
                message += `  • Taille: ${commande.client.taille || ''} cm\n`;
                message += `  • Poids: ${commande.client.poids || ''} kg\n`;
                message += `  • Tél: ${commande.client.tel_joindre || ''}\n`;
                if (commande.client.indications) {
                    message += `  • Indications: ${commande.client.indications}\n`;
                }
            }

            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: SUPPORT_PHONE,
                type: 'text',
                text: { body: message }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            
            log('info', `Commande ${commande.code} envoyée au support`);
        } catch (error) {
            log('error', `Erreur envoi support: ${error.message}`);
        }
    }

    async demanderAvisIA(phone, commande) {
        try {
            await this.whatsapp.sendMessage(phone, 
                "📊 *ENQUÊTE DE SATISFACTION*\n\n" +
                "Comment s'est passée ta commande ? (1-5 étoiles) ⭐");
            
            const conv = this.getConversation(phone);
            conv.enAttenteAvis = true;
            conv.commandeAvis = commande;
            
        } catch (error) {
            log('error', `Erreur demande avis: ${error.message}`);
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

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200
}));

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

app.get('/commande/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await pool.query('SELECT * FROM commandes WHERE code = $1', [code]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Commande non trouvée' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
║   🚀 MARIAM IA - PRODUCTION FINALE                        ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║                                                           ║
║   🤖 100% IA Conversationnelle                            ║
║   💬 Llama 3.3 70B (texte)                               ║
║   📸 Llama 4 Scout 17B (vision)                          ║
║   🛒 Système de commande intégré                          ║
║   🔍 Fuse.js (recherche floue)                           ║
║   🗄️ Redis + NodeCache                                    ║
║   🗃️ PostgreSQL                                           ║
║                                                           ║
║   ✨ Histoire vraie : créée dans une chambre d'étudiant   ║
║   💙 Par Youssef & Coulibaly Yaya - UPSP 2026             ║
║                                                           ║
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                           ║
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

if (workerData && workerData.action === 'analyzeImage') {
    const visionService = new LLMService();
    const buffer = Buffer.from(workerData.imageBuffer, 'base64');
    
    visionService.analyserImage(buffer)
        .then(result => parentPort.postMessage(result))
        .catch(() => parentPort.postMessage({ medicaments: [] }));
}
