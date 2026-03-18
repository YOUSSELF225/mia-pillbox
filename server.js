// ===========================================
// MARIAM IA - PRODUCTION READY
// San Pedro, Côte d'Ivoire
// Version avec système de commande IA
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

STYLE PAYPARROT :
- Messages courts et clairs (max 3-4 lignes)
- Emojis discrets (💊 🚚 📲)
- Options avec tirets
- Structure: accueil → info → question

CONTEXTE :
- Livraison: ${delivery.price}F (${delivery.period}), délai: ${delivery.time}min
- Support: ${supportLink}

**NOUVELLE FONCTIONNALITÉ : PRISE DE COMMANDE COMPLÈTE**

Tu peux maintenant prendre les commandes directement, sans renvoyer vers le support.

FORMAT DE REPONSE (JSON uniquement) :
{
    "intention": "greet|search|commande|infos_livraison|recapitulatif|confirmation|avis",
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

**GUIDE POUR LES COMMANDES** :

1. DÉTECTION : Si l'utilisateur veut commander ("je veux commander", "j'aimerais acheter", etc.), intention = "commande"

2. DÉROULEMENT NATUREL DE LA COMMANDE :

ÉTAPE 1 - ACCUEIL COMMANDE :
User: "Je veux commander"
{
    "intention": "commande",
    "donnees_commande": {"etape": "accueil"},
    "reponse": "Super ! Je prends ta commande directement 🛍️\n\nQuel médicament veux-tu ? (tape le nom)"
}

ÉTAPE 2 - SÉLECTION MÉDICAMENT (après recherche Fuse) :
User: "Doliprane"
{
    "intention": "commande",
    "medicament": "Doliprane",
    "donnees_commande": {"etape": "selection"},
    "reponse": "J'ai trouvé le Doliprane ! 💊\n\n- Doliprane 500mg (1500F)\n- Doliprane 1000mg (2000F)\n\nLequel veux-tu ?"
}

ÉTAPE 3 - QUANTITÉ :
User: "Le 500mg"
{
    "intention": "commande",
    "medicament": "Doliprane 500mg",
    "donnees_commande": {"etape": "quantite", "medicaments": [{"nom": "Doliprane 500mg", "prix": 1500}]},
    "reponse": "Combien de boîtes de Doliprane 500mg veux-tu ? 📦"
}

ÉTAPE 4 - AJOUT AUTRE MÉDICAMENT :
User: "2 boîtes"
{
    "intention": "commande",
    "donnees_commande": {
        "etape": "ajout_autre",
        "medicaments": [{"nom": "Doliprane 500mg", "prix": 1500, "quantite": 2}]
    },
    "reponse": "2 Doliprane 500mg ajoutés (3000F) ✅\n\nVeux-tu ajouter autre chose ?\n- Tape 'oui' pour ajouter\n- Tape 'non' pour continuer"
}

ÉTAPE 5 - INFOS PERSONNELLES :
User: "Non"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "nom"},
    "reponse": "Parfait ! Pour la livraison, j'ai besoin de quelques infos 📝\n\nTon nom complet :"
}

User: "Kouadio Paul"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "quartier", "client": {"nom": "Kouadio Paul"}},
    "reponse": "Ton quartier à San Pedro :"
}

User: "Port"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "age", "client": {"quartier": "Port"}},
    "reponse": "Ton âge :"
}

User: "25"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "taille", "client": {"age": 25}},
    "reponse": "Ta taille en cm (ex: 175) :"
}

User: "175"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "poids", "client": {"taille": 175}},
    "reponse": "Ton poids en kg (ex: 70) :"
}

User: "70"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "tel_joindre", "client": {"poids": 70}},
    "reponse": "Numéro à joindre pour le livreur (ex: 0701406880) :"
}

User: "0701406880"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "whatsapp", "client": {"tel_joindre": "0701406880"}},
    "reponse": "Ton numéro WhatsApp (pour la confirmation) :"
}

User: "0701406880"
{
    "intention": "infos_livraison",
    "donnees_commande": {"etape": "indications", "client": {"whatsapp": "0701406880"}},
    "reponse": "Des indications pour le livreur ? (maison rouge, près du marché...)\nTape 'aucune' si besoin :"
}

User: "Maison rouge près du marché"
{
    "intention": "recapitulatif",
    "donnees_commande": {
        "etape": "recap",
        "client": {"indications": "Maison rouge près du marché"}
    },
    "reponse": "📋 *RÉCAPITULATIF*\n\nMédicaments :\n- Doliprane 500mg x2 = 3000F\n\nInfos :\n- Kouadio Paul, 25 ans\n- Quartier Port\n- Tél: 0701406880\n- Indications: Maison rouge\n\nTotal avec livraison: 3000 + 400 = 3400F\n\nConfirmer ? (oui/non/modifier)"
}

ÉTAPE 6 - CONFIRMATION :
User: "Oui"
{
    "intention": "confirmation",
    "donnees_commande": {"etape": "confirmation"},
    "reponse": "✅ *COMMANDE CONFIRMÉE !*\n\nTon code de suivi est *473291*\n📌 RETIENS CE CODE ! Le livreur te le demandera.\n\nLe support te contacte dans 2 min. Livraison dans 45 min 🚚\n\nMerci ! 💙"
}

ÉTAPE 7 - AVIS (1 heure après) :
{
    "intention": "avis",
    "donnees_commande": {"etape": "avis_note"},
    "reponse": "Comment s'est passée ta commande ? (1-5 étoiles) ⭐"
}

User: "5"
{
    "intention": "avis",
    "donnees_commande": {"etape": "avis_commentaire", "note": 5},
    "reponse": "Super ! Un petit commentaire ? 😊"
}

User: "Très satisfait, livraison rapide"
{
    "intention": "avis",
    "donnees_commande": {"etape": "fin", "commentaire": "Très satisfait, livraison rapide"},
    "reponse": "Merci beaucoup ! Ton retour m'aide à m'améliorer 💙\n\nÀ bientôt !"
}

**RÈGLES IMPORTANTES** :
- TOUJOURS garder le contexte de la commande en cours
- Mettre à jour "donnees_commande" à chaque étape
- Valider les données (âge entre 1-120, taille entre 50-250, poids entre 10-300)
- À la confirmation, laisse le système générer le code unique
- Ne pas inventer de médicaments, utiliser Fuse pour les recherches`;
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
                    { role: "user", content: `Message: "${message}"\nHistorique: ${JSON.stringify(historique.slice(-3))}` }
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

    async gererCommande(message, historique, commandeEnCours = null) {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.models.text,
                messages: [
                    { role: "system", content: this.getSystemPrompt() },
                    { role: "user", content: `Message: "${message}"
Historique: ${JSON.stringify(historique.slice(-5))}
Commande en cours: ${JSON.stringify(commandeEnCours)}

Gère cette étape de commande naturellement.` }
                ],
                temperature: 0.7,
                max_completion_tokens: 500,
                response_format: { type: "json_object" }
            });

            return JSON.parse(completion.choices[0].message.content);
            
        } catch (error) {
            log('error', `Erreur commande: ${error.message}`);
            return {
                intention: "commande",
                donnees_commande: { etape: "accueil" },
                reponse: "Désolé, petit problème. On recommence ? Quel médicament veux-tu ? 💊"
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

    async integrerResultats(resultats, question, historique) {
        try {
            const completion = await this.client.chat.completions.create({
                model: this.models.text,
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
            log('error', `Intégration error: ${error.message}`);
            return {
                reponse: "Voici ce que j'ai trouvé ! Contacte le support pour commander 📲"
            };
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
                commandeEnCours: null
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
                            reponse += `- ${med.nom_commercial} : ${med.prix}F\n`;
                        });
                        reponse += "\nTu veux les commander ? Dis-moi 'oui' ou 'non'";

                        await this.whatsapp.sendMessage(phone, reponse);
                        
                        conv.historique.push({
                            role: "assistant",
                            content: reponse,
                            timestamp: Date.now()
                        });
                        
                        // Initialiser commande avec les médicaments détectés
                        if (text && text.toLowerCase() === 'oui') {
                            conv.commandeEnCours = {
                                etape: "quantite",
                                medicaments: results.map(med => ({
                                    nom: med.nom_commercial,
                                    prix: med.prix,
                                    quantite: 1
                                }))
                            };
                        }
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
                let reponseIA;
                
                // Si une commande est en cours, l'IA la gère
                if (conv.commandeEnCours) {
                    reponseIA = await this.llm.gererCommande(
                        text, 
                        conv.historique, 
                        conv.commandeEnCours
                    );
                    
                    // Mettre à jour la commande en cours
                    if (reponseIA.donnees_commande) {
                        conv.commandeEnCours = {
                            ...conv.commandeEnCours,
                            ...reponseIA.donnees_commande
                        };
                    }
                    
                    // Si confirmation finale, sauvegarder et envoyer au support
                    if (reponseIA.intention === "confirmation" && 
                        reponseIA.donnees_commande?.etape === "confirmation") {
                        
                        const code = await this.llm.genererCodeCommande();
                        conv.commandeEnCours.code = code;
                        conv.commandeEnCours.phone = phone;
                        
                        await this.sauvegarderCommande(conv.commandeEnCours);
                        await this.envoyerCommandeAuSupport(conv.commandeEnCours);
                        
                        // Programmer la demande d'avis dans 1 heure
                        setTimeout(() => {
                            this.demanderAvisIA(phone, conv.commandeEnCours);
                        }, 60 * 60 * 1000);
                        
                        conv.commandeEnCours = null;
                    }
                    
                    // Si fin d'avis, réinitialiser
                    if (reponseIA.intention === "avis" && 
                        reponseIA.donnees_commande?.etape === "fin") {
                        conv.commandeEnCours = null;
                    }
                } 
                else {
                    // Pas de commande en cours, comportement normal
                    reponseIA = await this.llm.comprendre(text, conv.historique);
                    
                    // Si l'utilisateur veut commander, initialiser la commande
                    if (reponseIA.intention === "commande") {
                        conv.commandeEnCours = { 
                            etape: "accueil",
                            medicaments: [],
                            client: {},
                            total: 0
                        };
                    }
                    
                    // Si c'est une recherche, utiliser Fuse
                    if (reponseIA.intention === "search" && reponseIA.medicament) {
                        const results = await this.fuse.search(reponseIA.medicament, 3);
                        if (results.length > 0) {
                            const reponseAvecResultats = await this.llm.integrerResultats(
                                results, text, conv.historique
                            );
                            await this.whatsapp.sendMessage(phone, reponseAvecResultats.reponse);
                            
                            conv.historique.push({
                                role: "assistant",
                                content: reponseAvecResultats.reponse,
                                timestamp: Date.now()
                            });
                            return;
                        }
                    }
                }
                
                // Envoyer la réponse de l'IA
                if (reponseIA) {
                    await this.whatsapp.sendMessage(phone, reponseIA.reponse);
                    
                    conv.historique.push({
                        role: "assistant",
                        content: reponseIA.reponse,
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

    async sauvegarderCommande(commande) {
        try {
            // Créer la table si elle n'existe pas
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
            const reponseIA = await this.llm.gererCommande(
                "SYSTEM: Demande d'avis après commande",
                [],
                { ...commande, etape: "avis_note" }
            );
            
            await this.whatsapp.sendMessage(phone, reponseIA.reponse);
            
            // Mettre à jour l'état pour la suite de l'avis
            const conv = this.getConversation(phone);
            conv.commandeEnCours = { ...commande, etape: "avis_note" };
            
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

// Route pour vérifier une commande par code
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
║   🚀 MARIAM IA - PRODUCTION                              ║
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
║   📱 Port: ${PORT}                                        ║
║   📞 Support: ${SUPPORT_PHONE}                           ║
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
