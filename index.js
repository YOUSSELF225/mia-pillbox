// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version Production - 100% Conversationnel (LLM Only)
// Optimisé Render (512MB/0.1CPU)
// ===================================================

const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
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
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requêtes par minute
    message: { error: 'Trop de requêtes, veuillez réessayer dans une minute' }
});
app.use('/webhook', limiter);

// ============ CONSTANTES ET CONFIGURATION ============
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Configuration WhatsApp Cloud API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Configuration Groq AI
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Support client (WhatsApp du support Pillbox)
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';

// URLs des fichiers sur Cloudinary (fournies)
const CLOUDINARY_FILES = {
    pharmacies: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/Pharmacies_San_Pedro_n1rvcs.xlsx',
    livreurs: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/livreurs_pillbox_c7emb2.xlsx',
    medicaments: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/pillbox_stock_cxn5aw.xlsx'
};

// ============ CACHES OPTIMISÉS ============
const cache = new NodeCache({
    stdTTL: 300, // 5 minutes
    checkperiod: 60,
    useClones: false,
    maxKeys: 500
});

const fileCache = new NodeCache({
    stdTTL: 1800, // 30 minutes
    useClones: false,
    maxKeys: 20
});

const conversationCache = new NodeCache({
    stdTTL: 3600, // 1 heure
    checkperiod: 300,
    useClones: false,
    maxKeys: 5000
});

// Cache pour les IDs de messages WhatsApp
const processedMessages = new NodeCache({
    stdTTL: 60, // 1 minute
    useClones: false,
    maxKeys: 10000
});

// ============ STATISTIQUES ============
const stats = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    apiCalls: 0,
    errors: 0,
    ordersCreated: 0,
    startTime: Date.now()
};

// ============ STOCKAGE CLOUDINARY ============
class CloudinaryStorage {
    constructor() {
        this.files = CLOUDINARY_FILES;
    }

    async downloadFile(fileName, url) {
        try {
            const cacheKey = `file_${fileName}`;
            const cached = fileCache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            console.log(`📥 Téléchargement: ${fileName}`);
            stats.apiCalls++;

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

// ============ STRUCTURES DE DONNÉES ============
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
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return true;
        
        try {
            console.log('📥 Chargement des données...');
            
            const [pharmaData, livreursData, medsData] = await Promise.all([
                this.storage.downloadFile('pharmacies.xlsx', this.storage.files.pharmacies),
                this.storage.downloadFile('livreurs.xlsx', this.storage.files.livreurs),
                this.storage.downloadFile('medicaments.xlsx', this.storage.files.medicaments)
            ]);

            if (pharmaData) {
                this.pharmacies = pharmaData;
                this.pharmaciesDeGarde = [];
                this.pharmaciesByQuartier.clear();

                for (const p of this.pharmacies) {
                    // Index par quartier
                    const quartier = p.QUARTIER || p.quartier || 'Non précisé';
                    if (!this.pharmaciesByQuartier.has(quartier)) {
                        this.pharmaciesByQuartier.set(quartier, []);
                    }
                    this.pharmaciesByQuartier.get(quartier).push(p);

                    // Pharmacies de garde
                    const garde = (p.GARDE || p.garde || 'NON').toString().toUpperCase();
                    if (garde === 'OUI') {
                        this.pharmaciesDeGarde.push(p);
                    }
                }
            }

            if (livreursData) {
                this.livreurs = livreursData;
                this.updateLivreursDisponibles();
            }

            if (medsData) {
                this.medicaments = medsData;
                
                // Créer un index de recherche pour les médicaments
                this.medicamentIndex = new Map();
                this.medicaments.forEach(med => {
                    const nom = (med['NOM COMMERCIAL'] || med.nom || '').toLowerCase();
                    const dci = (med['DCI'] || med.dci || '').toLowerCase();
                    if (nom) {
                        const mots = nom.split(' ');
                        mots.forEach(mot => {
                            if (mot.length > 2) {
                                if (!this.medicamentIndex.has(mot)) {
                                    this.medicamentIndex.set(mot, []);
                                }
                                this.medicamentIndex.get(mot).push(med);
                            }
                        });
                    }
                });
            }

            this.lastUpdate = Date.now();
            this.initialized = true;
            
            console.log(`✅ Données: ${this.pharmacies.length} pharmacies, ${this.livreurs.length} livreurs, ${this.medicaments.length} médicaments`);
            return true;

        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            stats.errors++;
            return false;
        }
    }

    updateLivreursDisponibles() {
        this.livreursDisponibles = this.livreurs.filter(l => {
            const enLigne = (l.En_Ligne || l.en_ligne || 'NON').toString().toUpperCase() === 'OUI';
            const disponible = (l.Disponible || l.disponible || 'NON').toString().toUpperCase() === 'OUI';
            return enLigne && disponible;
        });
    }

    async searchMedicine(term) {
        const cacheKey = `search_${term.toLowerCase()}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            stats.cacheHits++;
            return cached;
        }

        const searchTerm = term.toLowerCase();
        const mots = searchTerm.split(' ').filter(m => m.length > 2);
        
        const results = new Map();
        
        mots.forEach(mot => {
            const meds = this.medicamentIndex.get(mot) || [];
            meds.forEach(med => {
                const id = med['CODE PRODUIT'] || med.code || JSON.stringify(med);
                if (!results.has(id)) {
                    results.set(id, med);
                }
            });
        });

        const finalResults = Array.from(results.values()).slice(0, 20);
        
        cache.set(cacheKey, finalResults, 600); // 10 minutes
        stats.cacheMisses++;
        
        return finalResults;
    }

    assignLivreur() {
        this.updateLivreursDisponibles();
        if (this.livreursDisponibles.length > 0) {
            // Rotation
            const livreur = this.livreursDisponibles[0];
            this.livreursDisponibles.push(this.livreursDisponibles.shift());
            return livreur;
        }
        return null;
    }

    getPharmaciesByQuartier(quartier) {
        return this.pharmaciesByQuartier.get(quartier) || this.pharmacies;
    }

    getContextForLLM() {
        return {
            pharmacies: {
                total: this.pharmacies.length,
                deGarde: this.pharmaciesDeGarde.length,
                quartiers: Array.from(this.pharmaciesByQuartier.keys())
            },
            livreurs: {
                total: this.livreurs.length,
                disponibles: this.livreursDisponibles.length
            },
            medicaments: {
                total: this.medicaments.length
            }
        };
    }
}

// ============ GESTIONNAIRE DE COMMANDES ============
class OrderManager {
    constructor(store) {
        this.store = store;
        this.activeOrders = new Map();
        this.orderCounter = 0;
    }

    generateOrderId() {
        this.orderCounter++;
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const seq = this.orderCounter.toString().padStart(4, '0');
        return `CMD${year}${month}${day}${seq}`;
    }

    createOrder(orderData) {
        const orderId = this.generateOrderId();
        const timestamp = new Date();

        const order = {
            id: orderId,
            date: timestamp.toISOString().split('T')[0],
            time: timestamp.toTimeString().split(' ')[0].substring(0, 5),
            ...orderData,
            status: 'EN_ATTENTE',
            createdAt: timestamp.toISOString(),
            notifications: {
                support: false,
                livreur: false,
                client: false
            }
        };

        // Assigner un livreur si disponible
        const livreur = this.store.assignLivreur();
        if (livreur) {
            order.livreur = {
                id: livreur.ID_Livreur || livreur.id,
                nom: livreur.Nom || livreur.nom,
                telephone: livreur.Telephone || livreur.telephone,
                whatsapp: livreur.WhatsApp || livreur.whatsapp
            };
            order.status = 'LIVREUR_ASSIGNE';
        }

        this.activeOrders.set(orderId, order);
        stats.ordersCreated++;

        // Nettoyer les vieilles commandes
        if (this.activeOrders.size > 500) {
            const keys = Array.from(this.activeOrders.keys());
            const toDelete = keys.slice(0, keys.length - 500);
            toDelete.forEach(key => this.activeOrders.delete(key));
        }

        return order;
    }

    getOrder(orderId) {
        return this.activeOrders.get(orderId);
    }

    updateOrder(orderId, updates) {
        const order = this.activeOrders.get(orderId);
        if (order) {
            Object.assign(order, updates);
            order.updatedAt = new Date().toISOString();
            this.activeOrders.set(orderId, order);
            return true;
        }
        return false;
    }

    async notifySupport(order) {
        if (order.notifications.support) return;

        const message = `🆕 *NOUVELLE COMMANDE*\n\n` +
            `📋 *ID:* ${order.id}\n` +
            `👤 *Client:* ${order.client.nom}\n` +
            `📞 *WhatsApp:* ${order.client.whatsapp}\n` +
            `📍 *Quartier:* ${order.client.quartier}\n` +
            `📍 *Indications:* ${order.client.indications}\n` +
            `💊 *Médicament:* ${order.medicament}\n` +
            `💰 *Montant:* À confirmer par la pharmacie\n\n` +
            `👉 Le livreur a été notifié et viendra chercher l'argent.`;

        try {
            await sendWhatsAppMessage(SUPPORT_PHONE, message);
            order.notifications.support = true;
            return true;
        } catch (error) {
            console.error('❌ Erreur notification support:', error);
            return false;
        }
    }

    async notifyLivreur(order) {
        if (!order.livreur || order.notifications.livreur) return;

        const message = `🛵 *NOUVELLE LIVRAISON*\n\n` +
            `📋 *Commande:* ${order.id}\n` +
            `👤 *Client:* ${order.client.nom}\n` +
            `📍 *Quartier:* ${order.client.quartier}\n` +
            `📍 *Indications:* ${order.client.indications}\n` +
            `💊 *Médicament:* ${order.medicament}\n\n` +
            `👉 Rends-toi chez Pillbox pour prendre l'argent avant d'acheter le médicament.`;

        try {
            await sendWhatsAppMessage(order.livreur.whatsapp, message);
            order.notifications.livreur = true;
            return true;
        } catch (error) {
            console.error('❌ Erreur notification livreur:', error);
            return false;
        }
    }
}

// ============ GESTIONNAIRE DE CONVERSATIONS ============
class ConversationManager {
    constructor() {
        this.history = new Map();
    }

    getConversation(userId) {
        const key = `conv_${userId}`;
        let conv = conversationCache.get(key);
        
        if (!conv) {
            conv = {
                id: userId,
                messages: [],
                context: {},
                step: null,
                data: {},
                lastActivity: Date.now()
            };
            conversationCache.set(key, conv);
        }
        
        conv.lastActivity = Date.now();
        return conv;
    }

    addMessage(userId, role, content) {
        const conv = this.getConversation(userId);
        conv.messages.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // Garder seulement les 20 derniers messages
        if (conv.messages.length > 20) {
            conv.messages = conv.messages.slice(-20);
        }
        
        conversationCache.set(`conv_${userId}`, conv);
    }

    setContext(userId, key, value) {
        const conv = this.getConversation(userId);
        conv.context[key] = value;
        conversationCache.set(`conv_${userId}`, conv);
    }

    getContext(userId, key) {
        return this.getConversation(userId).context[key];
    }

    clearContext(userId) {
        const conv = this.getConversation(userId);
        conv.context = {};
        conv.step = null;
        conv.data = {};
        conversationCache.set(`conv_${userId}`, conv);
    }

    getMessagesForLLM(userId, maxMessages = 10) {
        const conv = this.getConversation(userId);
        return conv.messages.slice(-maxMessages).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content
        }));
    }
}

// ============ SERVICE WHATSAPP ============
async function sendWhatsAppMessage(to, text) {
    if (!text) return null;

    try {
        stats.apiCalls++;

        // Marquer comme en train d'écrire
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to.replace(/\D/g, ''),
                type: 'text',
                text: { body: text }
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            }
        );

        return true;
    } catch (error) {
        console.error('❌ WhatsApp error:', error.response?.data || error.message);
        stats.errors++;
        return false;
    }
}

async function markAsRead(messageId) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {
        // Ignorer les erreurs de lecture
    }
}

async function typingOn(to) {
    try {
        await axios.post(
            `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to.replace(/\D/g, ''),
                type: 'text',
                text: { body: '...' } // Envoie un message vide pour activer l'indicateur
            },
            {
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (error) {
        // Ignorer
    }
}

// ============ SERVICE GROQ ============
class GroqService {
    constructor() {
        this.apiUrl = GROQ_API_URL;
        this.apiKey = GROQ_API_KEY;
        this.model = GROQ_MODEL;
    }

    async generateResponse(messages, functions = null, functionCall = null) {
        try {
            stats.apiCalls++;

            const payload = {
                model: this.model,
                messages: messages,
                temperature: 0.7,
                max_tokens: 1024,
                top_p: 0.9
            };

            if (functions) {
                payload.functions = functions;
                payload.function_call = functionCall || 'auto';
            }

            const response = await axios.post(
                this.apiUrl,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            return response.data.choices[0].message;

        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ FONCTIONS DISPONIBLES POUR LE LLM ============
const functions = [
    {
        name: 'search_medicine',
        description: 'Rechercher un médicament dans la base de données',
        parameters: {
            type: 'object',
            properties: {
                medicament: {
                    type: 'string',
                    description: 'Le nom du médicament recherché'
                }
            },
            required: ['medicament']
        }
    },
    {
        name: 'get_pharmacies_garde',
        description: 'Obtenir la liste des pharmacies de garde',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'get_livreurs_disponibles',
        description: 'Obtenir la liste des livreurs disponibles',
        parameters: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'create_order',
        description: 'Créer une nouvelle commande de médicaments',
        parameters: {
            type: 'object',
            properties: {
                client_nom: {
                    type: 'string',
                    description: 'Nom complet du client'
                },
                client_whatsapp: {
                    type: 'string',
                    description: 'Numéro WhatsApp du client'
                },
                client_quartier: {
                    type: 'string',
                    description: 'Quartier de livraison'
                },
                client_indications: {
                    type: 'string',
                    description: 'Points de repère pour trouver le client'
                },
                medicament: {
                    type: 'string',
                    description: 'Le médicament commandé'
                }
            },
            required: ['client_nom', 'client_whatsapp', 'client_quartier', 'medicament']
        }
    },
    {
        name: 'get_order_status',
        description: 'Obtenir le statut d\'une commande',
        parameters: {
            type: 'object',
            properties: {
                order_id: {
                    type: 'string',
                    description: 'Numéro de la commande'
                }
            },
            required: ['order_id']
        }
    },
    {
        name: 'submit_feedback',
        description: 'Soumettre un avis après une commande',
        parameters: {
            type: 'object',
            properties: {
                order_id: {
                    type: 'string',
                    description: 'Numéro de la commande'
                },
                note: {
                    type: 'number',
                    description: 'Note de 1 à 5'
                },
                commentaire: {
                    type: 'string',
                    description: 'Commentaire sur la commande'
                }
            },
            required: ['order_id', 'note']
        }
    }
];

// ============ EXÉCUTEUR DES FONCTIONS ============
async function executeFunction(functionName, args, userId) {
    console.log(`⚡ Exécution: ${functionName}`, args);

    switch (functionName) {
        case 'search_medicine':
            const meds = await store.searchMedicine(args.medicament);
            return {
                success: true,
                data: meds.map(m => ({
                    nom: m['NOM COMMERCIAL'] || m.nom,
                    prix: m['PRIX'] || m.prix,
                    type: m['TYPE'] || m.type
                }))
            };

        case 'get_pharmacies_garde':
            return {
                success: true,
                data: store.pharmaciesDeGarde.map(p => ({
                    nom: p.NOM_PHARMACIE || p.nom,
                    telephone: p.TELEPHONE || p.telephone,
                    quartier: p.QUARTIER || p.quartier,
                    adresse: p.ADRESSE || p.adresse
                }))
            };

        case 'get_livreurs_disponibles':
            store.updateLivreursDisponibles();
            return {
                success: true,
                data: store.livreursDisponibles.map(l => ({
                    nom: l.Nom || l.nom,
                    telephone: l.Telephone || l.telephone,
                    note: l.Note_Moyenne || l.note_moyenne
                }))
            };

        case 'create_order':
            const orderData = {
                client: {
                    nom: args.client_nom,
                    whatsapp: args.client_whatsapp.replace(/\D/g, ''),
                    quartier: args.client_quartier,
                    indications: args.client_indications || ''
                },
                medicament: args.medicament
            };

            const order = orderManager.createOrder(orderData);

            // Notifier le support et le livreur
            await orderManager.notifySupport(order);
            if (order.livreur) {
                await orderManager.notifyLivreur(order);
            }

            // Sauvegarder l'ordre dans la conversation
            convManager.setContext(userId, 'lastOrder', order.id);

            return {
                success: true,
                data: {
                    order_id: order.id,
                    status: order.status,
                    livreur: order.livreur ? order.livreur.nom : null
                }
            };

        case 'get_order_status':
            const existingOrder = orderManager.getOrder(args.order_id);
            if (existingOrder) {
                return {
                    success: true,
                    data: {
                        order_id: existingOrder.id,
                        status: existingOrder.status,
                        client: existingOrder.client.nom,
                        medicament: existingOrder.medicament,
                        livreur: existingOrder.livreur?.nom
                    }
                };
            }
            return {
                success: false,
                error: 'Commande non trouvée'
            };

        case 'submit_feedback':
            const feedbackOrder = orderManager.getOrder(args.order_id);
            if (feedbackOrder) {
                const feedback = {
                    order_id: args.order_id,
                    note: args.note,
                    commentaire: args.commentaire || '',
                    date: new Date().toISOString()
                };
                // Sauvegarder le feedback (dans une vraie BDD)
                convManager.setContext(userId, 'lastFeedback', feedback);
                return {
                    success: true,
                    message: 'Merci pour votre avis !'
                };
            }
            return {
                success: false,
                error: 'Commande non trouvée'
            };

        default:
            return {
                success: false,
                error: 'Fonction inconnue'
            };
    }
}

// ============ INITIALISATION ============
const storage = new CloudinaryStorage();
const store = new DataStore(storage);
const orderManager = new OrderManager(store);
const convManager = new ConversationManager();
const groq = new GroqService();

// Charger les données au démarrage
store.initialize().then(success => {
    if (success) {
        console.log('🚀 Mia est prête !');
    }
});

// Rafraîchir toutes les 30 minutes
setInterval(() => store.initialize(), 30 * 60 * 1000);

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
    // Répondre immédiatement
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

        // Marquer comme lu
        await markAsRead(messageId);

        // Éviter les doublons
        if (processedMessages.has(messageId)) return;
        processedMessages.set(messageId, true);

        // Ignorer les messages non-texte
        if (message.type !== 'text') {
            await sendWhatsAppMessage(from, "👋 Mia ne traite que les messages texte. Envoie 'bonjour' pour commencer.");
            return;
        }

        const text = message.text.body.trim();
        stats.messagesProcessed++;

        // Ajouter le message à l'historique
        convManager.addMessage(from, 'user', text);

        // Statistiques
        if (stats.messagesProcessed % 100 === 0) {
            console.log(`📊 Messages: ${stats.messagesProcessed}, Commandes: ${stats.ordersCreated}`);
        }

        // Traiter avec le LLM
        await processWithLLM(from, text);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ LOGIQUE PRINCIPALE LLM ============
async function processWithLLM(userId, userMessage) {
    try {
        // Simuler "en train d'écrire"
        await typingOn(userId);

        // Préparer le contexte pour le LLM
        const context = store.getContextForLLM();
        const conversation = convManager.getMessagesForLLM(userId, 10);

        // Construire le prompt système
        const systemPrompt = `Tu es MIA, l'assistant santé officiel de San Pedro, Côte d'Ivoire. 🇨🇮

INFORMATIONS CONTEXTE:
- ${context.pharmacies.total} pharmacies à San Pedro
- ${context.pharmacies.deGarde} pharmacies de garde aujourd'hui
- Quartiers: ${context.pharmacies.quartiers.slice(0, 5).join(', ')}
- ${context.livreurs.total} livreurs (${context.livreurs.disponibles} disponibles)
- ${context.medicaments.total} médicaments référencés

RÈGLES DE CONDUITE:
1. Sois chaleureuse, amicale et professionnelle
2. Réponds TOUJOURS en français
3. Reste concise et va à l'essentiel
4. Si tu as besoin d'informations, demande-les poliment
5. N'invente JAMAIS d'informations. Utilise les fonctions pour obtenir des données réelles
6. Après une commande, propose de prendre un avis

FONCTIONS DISPONIBLES:
- search_medicine(medicament): Rechercher un médicament
- get_pharmacies_garde(): Liste des pharmacies de garde
- get_livreurs_disponibles(): Livreurs disponibles
- create_order(client_nom, client_whatsapp, client_quartier, client_indications, medicament): Créer une commande
- get_order_status(order_id): Suivre une commande
- submit_feedback(order_id, note, commentaire): Donner un avis

COMMENT UTILISER LES FONCTIONS:
- Pour chercher un médicament: Appelle search_medicine
- Pour une commande: Collecte les infos d'abord, puis appelle create_order
- Pour suivre: Demande l'ID de commande puis get_order_status

Ton objectif: Aider les habitants de San Pedro à trouver leurs médicaments et se faire livrer rapidement.`;

        // Messages pour le LLM
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversation
        ];

        // Appeler Groq
        const response = await groq.generateResponse(messages, functions, 'auto');

        if (!response) {
            await sendWhatsAppMessage(userId, "😔 Désolé, je rencontre une difficulté technique. Réessaie dans un instant.");
            return;
        }

        // Vérifier si le LLM veut appeler une fonction
        if (response.function_call) {
            const { name, arguments: argsString } = response.function_call;
            let args = {};

            try {
                args = JSON.parse(argsString);
            } catch (e) {
                console.error('❌ Erreur parse arguments:', e);
            }

            // Exécuter la fonction
            const result = await executeFunction(name, args, userId);

            // Ajouter le résultat à la conversation
            const functionMessage = {
                role: 'function',
                name: name,
                content: JSON.stringify(result)
            };

            // Demander au LLM de formuler une réponse basée sur le résultat
            const finalResponse = await groq.generateResponse([
                ...messages,
                response,
                functionMessage
            ]);

            if (finalResponse?.content) {
                await sendWhatsAppMessage(userId, finalResponse.content);
                convManager.addMessage(userId, 'assistant', finalResponse.content);
            }

        } else if (response.content) {
            // Réponse directe
            await sendWhatsAppMessage(userId, response.content);
            convManager.addMessage(userId, 'assistant', response.content);
        }

    } catch (error) {
        console.error('❌ LLM error:', error);
        stats.errors++;
        await sendWhatsAppMessage(userId, "😔 Oups ! Une erreur s'est produite. Contacte le support au " + SUPPORT_PHONE);
    }
}

// ============ ENDPOINTS DE MONITORING ============
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    res.json({
        name: 'MIA - San Pedro',
        version: '4.0.0',
        status: 'online',
        environment: NODE_ENV,
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
            errors: stats.errors,
            uptime: `${hours}h ${minutes}min`
        },
        data: store.initialized ? {
            pharmacies: store.pharmacies.length,
            livreurs: store.livreurs.length,
            medicaments: store.medicaments.length,
            lastUpdate: new Date(store.lastUpdate).toISOString()
        } : 'Chargement...'
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        cache: {
            file: fileCache.keys().length,
            conversation: conversationCache.keys().length
        }
    });
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
    ║   Version Production 4.0              ║
    ║   100% Conversationnel (LLM Only)     ║
    ║   Modèle: ${GROQ_MODEL}                ║
    ║   Environnement: ${NODE_ENV}           ║
    ║   Port: ${PORT}                        ║
    ║   RAM: 512MB | CPU: 0.1               ║
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

// ============ FIN ============
