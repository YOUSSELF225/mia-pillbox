// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version Production Finale - 100% Conversationnelle
// ===================================================

const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();

// ============ INITIALISATION EXPRESS ============
const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuration des en-têtes de sécurité
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Rate limiting pour éviter les abus
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Trop de requêtes' }
});
app.use('/webhook', limiter);

// ============ CONSTANTES ET CONFIGURATION ============
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// WhatsApp Cloud API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq AI
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Support client (numéro WhatsApp du support Pillbox)
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';

// URLs Cloudinary des fichiers (CORRECTES)
const CLOUDINARY_URLS = {
    pharmacies: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/Pharmacies_San_Pedro_n1rvcs.xlsx',
    livreurs: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/livreurs_pillbox_c7emb2.xlsx',
    medicaments: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/pillbox_stock_cxn5aw.xlsx'
};

// ============ CACHES OPTIMISÉS ============
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false, maxKeys: 1000 });
const fileCache = new NodeCache({ stdTTL: 1800, useClones: false, maxKeys: 50 });
const sessionCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, maxKeys: 10000 });
const processedMessages = new NodeCache({ stdTTL: 60, useClones: false, maxKeys: 10000 });

// ============ STATISTIQUES ============
const stats = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cloudinaryCalls: 0,
    groqCalls: 0,
    whatsappCalls: 0,
    ordersCreated: 0,
    errors: 0,
    startTime: Date.now()
};

// ============ STOCKAGE CLOUDINARY ============
class CloudinaryStorage {
    async downloadFile(url, fileName) {
        try {
            const cacheKey = `cloud_${fileName}`;
            const cached = fileCache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            console.log(`📥 Téléchargement: ${fileName}`);
            stats.cloudinaryCalls++;

            const response = await axios.get(url, { 
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: { 'Accept-Encoding': 'gzip,deflate' }
            });

            const workbook = XLSX.read(response.data, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

            fileCache.set(cacheKey, data);
            stats.cacheMisses++;
            console.log(`✅ ${fileName}: ${data.length} lignes`);
            return data;
        } catch (error) {
            console.error(`❌ Erreur téléchargement ${fileName}:`, error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ DATA STORE ============
class DataStore {
    constructor(storage) {
        this.storage = storage;
        this.pharmacies = [];
        this.pharmaciesDeGarde = [];
        this.pharmaciesByQuartier = new Map();
        this.livreurs = [];
        this.livreursDisponibles = [];
        this.medicaments = [];
        this.lastUpdate = 0;
    }

    async loadAllData() {
        try {
            console.log('📥 Chargement des données depuis Cloudinary...');
            
            const [pharmaData, livreursData, medsData] = await Promise.all([
                this.storage.downloadFile(CLOUDINARY_URLS.pharmacies, 'pharmacies.xlsx'),
                this.storage.downloadFile(CLOUDINARY_URLS.livreurs, 'livreurs.xlsx'),
                this.storage.downloadFile(CLOUDINARY_URLS.medicaments, 'medicaments.xlsx')
            ]);

            if (pharmaData) {
                this.pharmacies = pharmaData;
                this.pharmaciesDeGarde = [];
                this.pharmaciesByQuartier.clear();

                for (const p of this.pharmacies) {
                    const garde = (p.GARDE || p.garde || '').toString().toUpperCase();
                    if (garde === 'OUI') this.pharmaciesDeGarde.push(p);

                    const quartier = p.QUARTIER || p.quartier || 'Non précisé';
                    if (!this.pharmaciesByQuartier.has(quartier)) {
                        this.pharmaciesByQuartier.set(quartier, []);
                    }
                    this.pharmaciesByQuartier.get(quartier).push(p);
                }
                console.log(`✅ ${this.pharmacies.length} pharmacies (${this.pharmaciesDeGarde.length} de garde)`);
            }

            if (livreursData) {
                this.livreurs = livreursData;
                this.livreursDisponibles = this.livreurs.filter(l => {
                    const enLigne = (l.En_Ligne || l.en_ligne || '').toString().toUpperCase();
                    const disponible = (l.Disponible || l.disponible || '').toString().toUpperCase();
                    return enLigne === 'OUI' && disponible === 'OUI';
                });
                console.log(`✅ ${this.livreurs.length} livreurs (${this.livreursDisponibles.length} disponibles)`);
            }

            if (medsData) {
                this.medicaments = medsData;
                console.log(`✅ ${this.medicaments.length} médicaments`);
            }

            this.lastUpdate = Date.now();
            cache.set('master_data', {
                pharmacies: this.pharmacies,
                pharmaciesDeGarde: this.pharmaciesDeGarde,
                pharmaciesByQuartier: this.pharmaciesByQuartier,
                livreurs: this.livreurs,
                livreursDisponibles: this.livreursDisponibles,
                medicaments: this.medicaments
            });

            return true;
        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            stats.errors++;
            return false;
        }
    }

    async searchMedicine(searchTerm) {
        const cacheKey = `search_${searchTerm.toLowerCase()}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            stats.cacheHits++;
            return cached;
        }

        try {
            const terms = searchTerm.toLowerCase().split(' ').filter(t => t.length > 1);
            if (terms.length === 0) return [];

            const matchingMeds = this.medicaments
                .filter(med => {
                    const nom = (med['NOM COMMERCIAL'] || '').toLowerCase();
                    const dci = (med['DCI'] || '').toLowerCase();
                    return terms.some(term => nom.includes(term) || dci.includes(term));
                })
                .slice(0, 10)
                .map(m => ({
                    nom: m['NOM COMMERCIAL'] || 'Médicament',
                    prix: m['PRIX'] || 0,
                    dosage: m['TYPE'] || '',
                    dci: m['DCI'] || ''
                }));

            cache.set(cacheKey, matchingMeds, 300);
            stats.cacheMisses++;
            return matchingMeds;
        } catch (error) {
            console.error('❌ Erreur recherche:', error);
            return [];
        }
    }

    getPharmaciesByQuartier(quartier) {
        if (!quartier) return this.pharmacies;
        const normalizedQuartier = quartier.toLowerCase().trim();
        for (const [key, value] of this.pharmaciesByQuartier) {
            if (key.toLowerCase().includes(normalizedQuartier)) {
                return value;
            }
        }
        return this.pharmacies;
    }

    assignLivreur() {
        if (this.livreursDisponibles.length > 0) {
            const livreur = this.livreursDisponibles[0];
            this.livreursDisponibles.push(this.livreursDisponibles.shift());
            return livreur;
        }
        return null;
    }
}

// ============ GESTIONNAIRE DE COMMANDES ============
class OrderManager {
    constructor(store, whatsapp) {
        this.store = store;
        this.whatsapp = whatsapp;
        this.activeOrders = new Map();
        this.orderCounter = 0;
    }

    generateOrderId() {
        this.orderCounter++;
        const date = new Date();
        return `CMD${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${this.orderCounter.toString().padStart(4, '0')}`;
    }

    async createOrder(userId, orderData) {
        const orderId = this.generateOrderId();
        const timestamp = new Date();

        const order = {
            ID_Commande: orderId,
            Date: timestamp.toISOString().split('T')[0],
            Heure: timestamp.toTimeString().split(' ')[0].substring(0, 5),
            Client_ID: userId,
            ...orderData,
            Statut: 'EN_ATTENTE_VALIDATION',
            createdAt: timestamp.toISOString()
        };

        // Assigner un livreur si disponible
        const livreur = this.store.assignLivreur();
        if (livreur) {
            order.ID_Livreur = livreur.ID_Livreur || `LIV${Math.floor(Math.random() * 1000)}`;
            order.Nom_Livreur = livreur.Nom || 'Livreur';
            order.Telephone_Livreur = livreur.Telephone || '';
            order.Statut = 'LIVREUR_ASSIGNE';
        }

        this.activeOrders.set(orderId, order);
        stats.ordersCreated++;

        // Envoyer la commande au support Pillbox
        await this.notifySupport(order);

        // Envoyer la commande au livreur si assigné
        if (livreur) {
            await this.notifyLivreur(order, livreur);
        }

        // Nettoyer les vieilles commandes
        if (this.activeOrders.size > 500) {
            const keys = Array.from(this.activeOrders.keys());
            const toDelete = keys.slice(0, keys.length - 500);
            toDelete.forEach(key => this.activeOrders.delete(key));
        }

        return order;
    }

    async notifySupport(order) {
        const message = `🏢 *NOUVELLE COMMANDE PILLBOX*\n\n` +
            `📋 *Numéro:* ${order.ID_Commande}\n` +
            `👤 *Client:* ${order.Nom_Client}\n` +
            `📞 *WhatsApp:* ${order.WhatsApp_Client || order.Client_ID}\n` +
            `📍 *Quartier:* ${order.Quartier}\n` +
            `📍 *Indications:* ${order.Indications}\n` +
            `💊 *Médicament:* ${order.Medicament}\n` +
            `💰 *Montant:* ${order.Montant || 'À confirmer'} FCFA\n` +
            `🛵 *Livreur:* ${order.Nom_Livreur || 'Non assigné'}\n\n` +
            `Action requise: Valider la disponibilité et préparer les fonds.`;

        await this.whatsapp.sendMessage(SUPPORT_PHONE, message);
    }

    async notifyLivreur(order, livreur) {
        const whatsappNumber = livreur.WhatsApp || livreur.whatsapp || livreur.Telephone;
        if (!whatsappNumber) return;

        const message = `🛵 *NOUVELLE LIVRAISON*\n\n` +
            `📋 *Commande:* ${order.ID_Commande}\n` +
            `👤 *Client:* ${order.Nom_Client}\n` +
            `📍 *Quartier:* ${order.Quartier}\n` +
            `📍 *Indications:* ${order.Indications}\n` +
            `💊 *Médicament:* ${order.Medicament}\n\n` +
            `🔔 Rends-toi à la pharmacie pour acheter et livrer.\n` +
            `💰 Le client paiera à la livraison.`;

        await this.whatsapp.sendMessage(whatsappNumber, message);
    }

    async updateOrderStatus(orderId, status, data = {}) {
        const order = this.activeOrders.get(orderId);
        if (order) {
            order.Statut = status;
            order.updatedAt = new Date().toISOString();
            Object.assign(order, data);
            this.activeOrders.set(orderId, order);

            // Notifier le client du changement de statut
            if (order.Client_ID) {
                let message = '';
                if (status === 'LIVREUR_EN_ROUTE') {
                    message = `🛵 *Bonne nouvelle!*\n\nVotre livreur ${order.Nom_Livreur} est en route pour la livraison.`;
                } else if (status === 'LIVREE') {
                    message = `✅ *Commande livrée avec succès!*\n\nMerci d'avoir choisi Pillbox. N'hésitez pas à nous donner votre avis.`;
                }
                if (message) {
                    await this.whatsapp.sendMessage(order.Client_ID, message);
                }
            }
            return true;
        }
        return false;
    }

    getOrder(orderId) {
        return this.activeOrders.get(orderId);
    }
}

// ============ SERVICE WHATSAPP ============
class WhatsAppService {
    constructor() {
        this.apiUrl = WHATSAPP_API_URL;
        this.token = WHATSAPP_TOKEN;
    }

    async sendMessage(to, text) {
        if (!text) return null;
        try {
            stats.whatsappCalls++;
            if (text.length > 4096) text = text.substring(0, 4000) + '...';

            const response = await axios.post(this.apiUrl, {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to.replace(/\D/g, ''),
                type: 'text',
                text: { body: text }
            }, {
                headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            return response.data;
        } catch (error) {
            console.error('❌ WhatsApp error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ SERVICE GROQ ============
class GroqService {
    constructor() {
        this.apiUrl = GROQ_API_URL;
        this.apiKey = GROQ_API_KEY;
        this.model = GROQ_MODEL;
    }

    async generateResponse(systemPrompt, userMessage, context = '') {
        try {
            stats.groqCalls++;
            const response = await axios.post(this.apiUrl, {
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt.substring(0, 3000) },
                    ...(context ? [{ role: 'assistant', content: context }] : []),
                    { role: 'user', content: userMessage.substring(0, 1000) }
                ],
                temperature: 0.7,
                max_tokens: 500,
                top_p: 0.9
            }, {
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                timeout: 5000
            });
            return response.data.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ INITIALISATION ============
const cloudinary = new CloudinaryStorage();
const store = new DataStore(cloudinary);
const whatsapp = new WhatsAppService();
const groq = new GroqService();
const orderManager = new OrderManager(store, whatsapp);

// Charger les données
store.loadAllData().then(success => {
    if (success) console.log('🚀 Mia est prête!');
    else console.warn('⚠️ Mia démarre avec données limitées');
});

// Rafraîchir toutes les 30 minutes
setInterval(() => store.loadAllData().catch(console.error), 30 * 60 * 1000);

// ============ SYSTÈME PROMPT DE MIA ============
const MIA_SYSTEM_PROMPT = `Tu es Mia, l'assistante santé officielle de Pillbox à San Pedro, Côte d'Ivoire.

🌍 CONTEXTE:
- Ville: San Pedro
- Service: Achat et livraison de médicaments
- Tu parles à des utilisateurs WhatsApp

💊 FONCTIONNALITÉS:
1. Recherche de médicaments dans notre base de données
2. Pharmacies de garde
3. Prise de commande avec livraison
4. Suivi des commandes
5. Information sur les livreurs

📋 INFORMATIONS DISPONIBLES:
- ${store.pharmacies.length} pharmacies partenaires
- ${store.livreurs.length} livreurs (${store.livreursDisponibles.length} disponibles)
- ${store.medicaments.length} médicaments référencés

🎯 RÈGLES DE CONVERSATION:
1. Sois chaleureuse, amicale et professionnelle
2. Parle UNIQUEMENT en français
3. Pour une recherche de médicament, demande le nom exact
4. Pour une commande, collecte: nom, quartier, points de repère
5. Utilise les données réelles des pharmacies pour orienter
6. Si un médicament n'est pas trouvé, propose des alternatives proches
7. Mentionne toujours les pharmacies de garde quand disponibles
8. Donne les prix en FCFA quand disponibles
9. Pour les commandes, confirme toujours les détails avant validation
10. Propose le menu quand l'utilisateur semble perdu

📊 STATUT ACTUEL:
- Pharmacies de garde aujourd'hui: ${store.pharmaciesDeGarde.length}
- Livreurs disponibles: ${store.livreursDisponibles.length}

N'INVENTE PAS d'informations. Utilise les données réelles. Si tu ne sais pas, dis-le honnêtement.`;

// ============ WEBHOOK WHATSAPP ============
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        const { entry } = req.body;
        if (!entry?.[0]?.changes?.[0]) return;

        const change = entry[0].changes[0];
        if (change.field !== 'messages') return;

        const messageData = change.value;
        if (!messageData.messages?.[0]) return;

        const message = messageData.messages[0];
        const from = message.from;
        const messageId = message.id;

        if (processedMessages.has(messageId)) return;
        processedMessages.set(messageId, true);

        if (message.type !== 'text') {
            await whatsapp.sendMessage(from, "❌ Envoie un message texte s'il te plaît.");
            return;
        }

        const text = message.text.body.trim();
        stats.messagesProcessed++;
        console.log(`📩 [${from.substring(0, 8)}...] ${text.substring(0, 50)}`);

        // Récupérer la session
        const sessionKey = `session_${from}`;
        let session = sessionCache.get(sessionKey) || {
            history: [],
            context: {},
            lastActivity: Date.now()
        };

        // Ajouter le message à l'historique
        session.history.push({ role: 'user', content: text });
        if (session.history.length > 10) session.history.shift();
        session.lastActivity = Date.now();

        // Construire le contexte pour Groq
        const contextHistory = session.history
            .slice(-5)
            .map(msg => `${msg.role === 'user' ? 'Utilisateur' : 'Mia'}: ${msg.content}`)
            .join('\n');

        // Mettre à jour les stats du système prompt
        const updatedPrompt = MIA_SYSTEM_PROMPT.replace(
            /Pharmacies de garde aujourd'hui: \d+/,
            `Pharmacies de garde aujourd'hui: ${store.pharmaciesDeGarde.length}`
        ).replace(
            /Livreurs disponibles: \d+/,
            `Livreurs disponibles: ${store.livreursDisponibles.length}`
        );

        // Ajouter les résultats de recherche si en cours
        let searchContext = '';
        if (session.context.lastSearch) {
            searchContext = `\n\nRésultats de la recherche pour "${session.context.lastSearch}":\n${
                session.context.lastResults?.map(m => `- ${m.nom} (${m.prix} FCFA)`).join('\n')
            }`;
        }

        // Obtenir la réponse de Mia
        const miaResponse = await groq.generateResponse(
            updatedPrompt + searchContext,
            text,
            contextHistory
        );

        if (!miaResponse) {
            await whatsapp.sendMessage(from, "😔 Désolé, je rencontre une difficulté technique. Réessaie dans un instant.");
            return;
        }

        // Analyser si l'utilisateur veut commander
        const lowerText = text.toLowerCase();
        const lowerResponse = miaResponse.toLowerCase();

        // Détection d'intention de commande
        if ((lowerText.includes('acheter') || lowerText.includes('commander') || lowerResponse.includes('commande')) &&
            !session.context.awaitingOrder) {
            
            session.context.awaitingOrder = true;
            session.context.orderStep = 'collecting_info';
        }

        // Collecte des informations de commande
        if (session.context.awaitingOrder) {
            if (!session.context.orderInfo) session.context.orderInfo = {};

            // Extraire les informations avec Groq
            const extractionPrompt = `Extrais les informations de cette conversation pour une commande de médicaments.
            Retourne UNIQUEMENT un JSON valide avec:
            {
                "nom": "nom du client ou null",
                "quartier": "quartier ou null",
                "indications": "points de repère ou null",
                "medicament": "médicament demandé ou null"
            }
            
            Conversation:
            ${contextHistory}
            
            Dernier message utilisateur: ${text}`;

            const extraction = await groq.generateResponse(extractionPrompt, text);
            try {
                const extracted = JSON.parse(extraction.match(/\{.*\}/s)?.[0] || '{}');
                
                if (extracted.nom && extracted.nom !== 'null') session.context.orderInfo.nom = extracted.nom;
                if (extracted.quartier && extracted.quartier !== 'null') session.context.orderInfo.quartier = extracted.quartier;
                if (extracted.indications && extracted.indications !== 'null') session.context.orderInfo.indications = extracted.indications;
                if (extracted.medicament && extracted.medicament !== 'null') session.context.orderInfo.medicament = extracted.medicament;
            } catch (e) {
                // Ignorer les erreurs de parsing
            }

            // Vérifier si toutes les infos sont collectées
            if (session.context.orderInfo.nom && 
                session.context.orderInfo.quartier && 
                session.context.orderInfo.indications && 
                session.context.orderInfo.medicament) {
                
                // Créer la commande
                const order = await orderManager.createOrder(from, {
                    Nom_Client: session.context.orderInfo.nom,
                    WhatsApp_Client: from.replace(/\D/g, ''),
                    Quartier: session.context.orderInfo.quartier,
                    Indications: session.context.orderInfo.indications,
                    Medicament: session.context.orderInfo.medicament,
                    Montant: session.context.lastResults?.[0]?.prix || 'À confirmer'
                });

                // Ajouter la confirmation à la réponse de Mia
                const confirmation = `\n\n✅ *COMMANDE ENREGISTRÉE!*\nNuméro: ${order.ID_Commande}\nUn livreur sera assigné sous peu.`;
                
                // Envoyer la réponse avec confirmation
                await whatsapp.sendMessage(from, miaResponse + confirmation);
                
                // Réinitialiser l'état de commande
                delete session.context.awaitingOrder;
                delete session.context.orderInfo;
                delete session.context.orderStep;
                
                sessionCache.set(sessionKey, session);
                return;
            }
        }

        // Envoyer la réponse normale
        await whatsapp.sendMessage(from, miaResponse);

        // Sauvegarder la session
        session.history.push({ role: 'assistant', content: miaResponse });
        sessionCache.set(sessionKey, session);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ ENDPOINTS ============
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - San Pedro',
        version: '3.0.0',
        status: 'online',
        stats: {
            messages: stats.messagesProcessed,
            orders: stats.ordersCreated,
            cache: {
                hits: stats.cacheHits,
                misses: stats.cacheMisses,
                rate: stats.cacheHits + stats.cacheMisses > 0 
                    ? Math.round((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100) 
                    : 0
            },
            data: {
                pharmacies: store.pharmacies.length,
                livreurs: store.livreurs.length,
                medicaments: store.medicaments.length,
                garde: store.pharmaciesDeGarde.length,
                livreursDispo: store.livreursDisponibles.length
            },
            uptime: Math.floor((Date.now() - stats.startTime) / 1000)
        }
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        cache: {
            size: cache.keys().length,
            sessions: sessionCache.keys().length
        }
    });
});

app.get('/stats', (req, res) => {
    res.json(stats);
});

// ============ GESTION DES ERREURS ============
app.use((err, req, res, next) => {
    console.error('🔥 Erreur serveur:', err);
    stats.errors++;
    res.status(500).json({ error: 'Erreur interne' });
});

// ============ DÉMARRAGE ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   MIA - San Pedro 🇨🇮                  ║
    ║   Version Production 3.0              ║
    ║   Environnement: ${NODE_ENV.padEnd(15)}       ║
    ║   Stockage: Cloudinary                ║
    ║   LLM: Groq (${GROQ_MODEL})           ║
    ║   RAM: 512MB | CPU: 0.1               ║
    ║   Support: ${SUPPORT_PHONE}            ║
    ╚═══════════════════════════════════════╝
    `);
});

// Gestion de l'arrêt
process.on('SIGTERM', () => {
    console.log('📴 Arrêt...');
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('💥 Exception:', err);
    stats.errors++;
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Rejection:', err);
    stats.errors++;
});
