// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version Production Finale - 100% Conversationnel
// Optimisé pour des milliers de requêtes simultanées
// AVEC CACHE PARTAGÉ ENTRE WORKERS
// ===================================================

const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ============ CLUSTERING AMÉLIORÉ AVEC CACHE PARTAGÉ ============
const numCPUs = os.cpus().length;
const SHARED_CACHE_FILE = '/tmp/mia_shared_cache.json';

if (cluster.isMaster && process.env.NODE_ENV === 'production') {
    console.log(`🚀 Maître PID ${process.pid} - Lancement de ${numCPUs} workers...`);
    
    // Nettoyer l'ancien cache au démarrage
    try {
        if (fs.existsSync(SHARED_CACHE_FILE)) {
            fs.unlinkSync(SHARED_CACHE_FILE);
            console.log('🧹 Ancien cache partagé supprimé');
        }
    } catch (error) {
        console.error('❌ Erreur nettoyage cache:', error.message);
    }
    
    // Lancer les workers avec un délai pour éviter la surcharge
    for (let i = 0; i < numCPUs; i++) {
        setTimeout(() => {
            cluster.fork();
        }, i * 2000); // 2 secondes entre chaque worker
    }
    
    // Redémarrer les workers qui meurent
    cluster.on('exit', (worker, code, signal) => {
        console.log(`⚠️ Worker ${worker.process.pid} mort. Redémarrage dans 5 secondes...`);
        setTimeout(() => {
            cluster.fork();
        }, 5000);
    });
    
    // Serveur de monitoring pour le maître
    const masterApp = express();
    masterApp.get('/health', (req, res) => {
        res.json({ 
            status: 'master', 
            workers: Object.keys(cluster.workers).length,
            pid: process.pid,
            cache: fs.existsSync(SHARED_CACHE_FILE) ? 'present' : 'absent'
        });
    });
    masterApp.listen(PORT + 1, '0.0.0.0', () => {
        console.log(`📊 Maître en écoute sur le port ${PORT + 1} pour monitoring`);
    });
    
    return; // Le maître s'arrête ici
}

// ============ CACHE PARTAGÉ (via fichier) ============
class SharedCache {
    constructor() {
        this.cache = {};
        this.lastSave = 0;
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(SHARED_CACHE_FILE)) {
                const data = fs.readFileSync(SHARED_CACHE_FILE, 'utf8');
                this.cache = JSON.parse(data);
                console.log(`📦 Cache partagé chargé: ${Object.keys(this.cache).length} entrées`);
            }
        } catch (error) {
            console.error('❌ Erreur chargement cache partagé:', error.message);
        }
    }

    save() {
        try {
            // Sauvegarder seulement toutes les 10 secondes max
            if (Date.now() - this.lastSave > 10000) {
                fs.writeFileSync(SHARED_CACHE_FILE, JSON.stringify(this.cache, null, 0));
                this.lastSave = Date.now();
            }
        } catch (error) {
            console.error('❌ Erreur sauvegarde cache partagé:', error.message);
        }
    }

    get(key) {
        return this.cache[key];
    }

    set(key, value) {
        this.cache[key] = value;
        this.save();
    }

    has(key) {
        return key in this.cache;
    }

    clear() {
        this.cache = {};
        this.save();
    }
}

// ============ INITIALISATION EXPRESS ============
const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Configuration des en-têtes de sécurité
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Rate limiting avancé
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requêtes par minute
    message: { error: 'Trop de requêtes, veuillez réessayer dans une minute' },
    standardHeaders: true,
    legacyHeaders: false
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
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Support client
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';
// URLs Cloudinary (fournies)
const CLOUDINARY_FILES = {
    pharmacies: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771639219/Pharmacies_San_Pedro_wnabnk.xlsx',
    livreurs: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771639222/livreurs_pillbox_lmtjl9.xlsx',
    medicaments: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771639221/pillbox_stock_k7tzot.xlsx'
};

// ============ CACHES HAUTES PERFORMANCES ============
const cache = new NodeCache({
    stdTTL: 300, // 5 minutes
    checkperiod: 60,
    useClones: false,
    maxKeys: 2000,
    deleteOnExpire: true
});

const fileCache = new NodeCache({
    stdTTL: 1800, // 30 minutes
    useClones: false,
    maxKeys: 100,
    deleteOnExpire: true
});

const conversationCache = new NodeCache({
    stdTTL: 3600, // 1 heure
    checkperiod: 300,
    useClones: false,
    maxKeys: 10000,
    deleteOnExpire: true
});

const processedMessages = new NodeCache({
    stdTTL: 60, // 1 minute
    useClones: false,
    maxKeys: 20000,
    deleteOnExpire: true
});

// ============ STATISTIQUES EN TEMPS RÉEL ============
const stats = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    apiCalls: 0,
    errors: 0,
    ordersCreated: 0,
    startTime: Date.now(),
    lastError: null,
    lastErrorTime: null
};

// ============ STOCKAGE CLOUDINARY AVEC CACHE PARTAGÉ ============
class CloudinaryStorage {
    constructor(sharedCache) {
        this.files = CLOUDINARY_FILES;
        this.loadingPromises = new Map();
        this.sharedCache = sharedCache;
    }

    async downloadFile(fileName, url) {
        try {
            const cacheKey = `file_${fileName}`;
            
            // 1. Vérifier le cache partagé (entre workers)
            const sharedData = this.sharedCache.get(cacheKey);
            if (sharedData) {
                console.log(`📦 Cache partagé hit: ${fileName} (worker ${process.pid})`);
                stats.cacheHits++;
                
                // Mettre aussi dans le cache local
                fileCache.set(cacheKey, sharedData);
                return sharedData;
            }
            
            // 2. Vérifier le cache local (mémoire)
            const cached = fileCache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            // 3. Éviter les téléchargements parallèles du même fichier
            if (this.loadingPromises.has(fileName)) {
                console.log(`⏳ Attente téléchargement en cours: ${fileName} (worker ${process.pid})`);
                return this.loadingPromises.get(fileName);
            }

            console.log(`📥 Téléchargement: ${fileName} (worker ${process.pid})`);
            stats.apiCalls++;

            const promise = axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: { 
                    'Accept-Encoding': 'gzip,deflate',
                    'User-Agent': 'MIA-SanPedro/5.0'
                }
            }).then(async response => {
                const workbook = XLSX.read(response.data, { type: 'buffer' });
                const sheetName = workbook.SheetNames[0];
                const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
                
                // Mettre dans les deux caches
                fileCache.set(cacheKey, data);
                this.sharedCache.set(cacheKey, data);
                
                this.loadingPromises.delete(fileName);
                stats.cacheMisses++;
                
                console.log(`✅ ${fileName}: ${data.length} lignes (worker ${process.pid})`);
                return data;
            }).catch(error => {
                this.loadingPromises.delete(fileName);
                throw error;
            });

            this.loadingPromises.set(fileName, promise);
            return promise;

        } catch (error) {
            console.error(`❌ Erreur téléchargement ${fileName}:`, error.message);
            stats.errors++;
            stats.lastError = error.message;
            stats.lastErrorTime = Date.now();
            return null;
        }
    }
}

// ============ STRUCTURES DE DONNÉES OPTIMISÉES ============
class DataStore {
    constructor(storage, sharedCache) {
        this.storage = storage;
        this.sharedCache = sharedCache;
        this.pharmacies = [];
        this.pharmaciesDeGarde = [];
        this.pharmaciesByQuartier = new Map();
        this.pharmaciesById = new Map();
        this.livreurs = [];
        this.livreursDisponibles = [];
        this.medicaments = [];
        this.medicamentIndex = new Map();
        this.lastUpdate = 0;
        this.initialized = false;
        this.initPromise = null;
    }

    async initialize() {
        if (this.initialized) return true;
        
        // Vérifier si un autre worker a déjà initialisé
        const sharedInit = this.sharedCache.get('initialized');
        if (sharedInit) {
            console.log(`📦 Données déjà initialisées par un autre worker (worker ${process.pid})`);
            await this.loadFromSharedCache();
            this.initialized = true;
            return true;
        }
        
        // Vérifier si un chargement est en cours
        const loadingLock = this.sharedCache.get('loading');
        if (loadingLock) {
            console.log(`⏳ Attente du chargement par un autre worker (worker ${process.pid})...`);
            // Attendre que le chargement soit fini (max 30 secondes)
            for (let i = 0; i < 30; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (this.sharedCache.get('initialized')) {
                    await this.loadFromSharedCache();
                    this.initialized = true;
                    return true;
                }
            }
        }
        
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInitialize();
        return this.initPromise;
    }

    async loadFromSharedCache() {
        this.pharmacies = this.sharedCache.get('pharmacies') || [];
        this.pharmaciesDeGarde = this.sharedCache.get('pharmaciesDeGarde') || [];
        this.livreurs = this.sharedCache.get('livreurs') || [];
        this.livreursDisponibles = this.sharedCache.get('livreursDisponibles') || [];
        this.medicaments = this.sharedCache.get('medicaments') || [];
        this.lastUpdate = this.sharedCache.get('lastUpdate') || Date.now();
        
        // Reconstruire les maps
        this.pharmaciesByQuartier.clear();
        for (const p of this.pharmacies) {
            const quartier = p.QUARTIER || p.quartier || 'Non précisé';
            if (!this.pharmaciesByQuartier.has(quartier)) {
                this.pharmaciesByQuartier.set(quartier, []);
            }
            this.pharmaciesByQuartier.get(quartier).push(p);
        }
        
        // Reconstruire l'index des médicaments
        this.medicamentIndex.clear();
        for (const med of this.medicaments) {
            const nom = (med['NOM COMMERCIAL'] || med.nom || '').toLowerCase();
            const dci = (med['DCI'] || med.dci || '').toLowerCase();
            const mots = [...new Set([...nom.split(' '), ...dci.split(' ')])].filter(m => m.length > 2);
            
            mots.forEach(mot => {
                if (!this.medicamentIndex.has(mot)) {
                    this.medicamentIndex.set(mot, []);
                }
                this.medicamentIndex.get(mot).push(med);
            });
        }
        
        console.log(`📦 Données chargées depuis cache partagé: ${this.pharmacies.length} pharmacies, ${this.livreurs.length} livreurs, ${this.medicaments.length} médicaments`);
    }

    async _doInitialize() {
        try {
            console.log(`📥 Chargement des données (worker ${process.pid})...`);
            
            // Lock pour éviter que plusieurs workers chargent en même temps
            this.sharedCache.set('loading', true);
            
            const [pharmaData, livreursData, medsData] = await Promise.all([
                this.storage.downloadFile('pharmacies.xlsx', this.storage.files.pharmacies),
                this.storage.downloadFile('livreurs.xlsx', this.storage.files.livreurs),
                this.storage.downloadFile('medicaments.xlsx', this.storage.files.medicaments)
            ]);

            if (pharmaData) {
                this.pharmacies = pharmaData;
                this.pharmaciesDeGarde = [];
                this.pharmaciesByQuartier.clear();
                this.pharmaciesById.clear();

                for (const p of this.pharmacies) {
                    const id = p.ID || p.id || `P${crypto.randomBytes(3).toString('hex')}`;
                    this.pharmaciesById.set(id, p);

                    const quartier = p.QUARTIER || p.quartier || 'Non précisé';
                    if (!this.pharmaciesByQuartier.has(quartier)) {
                        this.pharmaciesByQuartier.set(quartier, []);
                    }
                    this.pharmaciesByQuartier.get(quartier).push(p);

                    const garde = (p.GARDE || p.garde || 'NON').toString().toUpperCase();
                    if (garde === 'OUI') {
                        this.pharmaciesDeGarde.push(p);
                    }
                }
                
                // Sauvegarder dans le cache partagé
                this.sharedCache.set('pharmacies', this.pharmacies);
                this.sharedCache.set('pharmaciesDeGarde', this.pharmaciesDeGarde);
            }

            if (livreursData) {
                this.livreurs = livreursData;
                this.updateLivreursDisponibles();
                this.sharedCache.set('livreurs', this.livreurs);
                this.sharedCache.set('livreursDisponibles', this.livreursDisponibles);
            }

            if (medsData) {
                this.medicaments = medsData;
                this.medicamentIndex.clear();

                for (const med of this.medicaments) {
                    const nom = (med['NOM COMMERCIAL'] || med.nom || '').toLowerCase();
                    const dci = (med['DCI'] || med.dci || '').toLowerCase();
                    const mots = [...new Set([...nom.split(' '), ...dci.split(' ')])].filter(m => m.length > 2);
                    
                    mots.forEach(mot => {
                        if (!this.medicamentIndex.has(mot)) {
                            this.medicamentIndex.set(mot, []);
                        }
                        this.medicamentIndex.get(mot).push(med);
                    });
                }
                
                this.sharedCache.set('medicaments', this.medicaments);
            }

            this.lastUpdate = Date.now();
            this.initialized = true;
            
            // Marquer comme initialisé et enlever le lock
            this.sharedCache.set('initialized', true);
            this.sharedCache.set('loading', false);
            this.sharedCache.set('lastUpdate', this.lastUpdate);
            
            console.log(`✅ Données: ${this.pharmacies.length} pharmacies, ${this.livreurs.length} livreurs, ${this.medicaments.length} médicaments (worker ${process.pid})`);
            return true;

        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            stats.errors++;
            stats.lastError = error.message;
            stats.lastErrorTime = Date.now();
            this.sharedCache.set('loading', false);
            this.initPromise = null;
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
        if (!term || term.length < 2) return [];
        
        const cacheKey = `search_${term.toLowerCase()}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            stats.cacheHits++;
            return cached;
        }

        const searchTerm = term.toLowerCase();
        const mots = searchTerm.split(' ').filter(m => m.length > 2);
        
        const resultMap = new Map();
        
        mots.forEach(mot => {
            const meds = this.medicamentIndex.get(mot) || [];
            meds.forEach(med => {
                const id = med['CODE PRODUIT'] || med.code || JSON.stringify(med);
                if (!resultMap.has(id)) {
                    resultMap.set(id, med);
                }
            });
        });

        // Recherche approximative si pas de résultats
        if (resultMap.size === 0) {
            for (const [key, meds] of this.medicamentIndex.entries()) {
                if (key.includes(searchTerm) || searchTerm.includes(key)) {
                    meds.forEach(med => {
                        const id = med['CODE PRODUIT'] || med.code || JSON.stringify(med);
                        resultMap.set(id, med);
                    });
                }
            }
        }

        const results = Array.from(resultMap.values()).slice(0, 10);
        
        cache.set(cacheKey, results, 600); // 10 minutes
        stats.cacheMisses++;
        
        return results;
    }

    assignLivreur() {
        this.updateLivreursDisponibles();
        if (this.livreursDisponibles.length > 0) {
            const livreur = this.livreursDisponibles[0];
            this.livreursDisponibles.push(this.livreursDisponibles.shift());
            return livreur;
        }
        return null;
    }

    getQuartiersList() {
        return Array.from(this.pharmaciesByQuartier.keys()).filter(q => q !== 'Non précisé');
    }

    getContext() {
        return {
            pharmacies: {
                total: this.pharmacies.length,
                deGarde: this.pharmaciesDeGarde.length,
                quartiers: this.getQuartiersList().slice(0, 10)
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
            updatedAt: timestamp.toISOString(),
            notifications: {
                support: false,
                livreur: false
            }
        };

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

        if (this.activeOrders.size > 1000) {
            const keys = Array.from(this.activeOrders.keys());
            const toDelete = keys.slice(0, keys.length - 1000);
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
}

// ============ GESTIONNAIRE DE CONVERSATIONS ============
class ConversationManager {
    constructor() {
        this.cleanupInterval = setInterval(() => this.cleanup(), 30 * 60 * 1000);
    }

    getConversation(userId) {
        const key = `conv_${userId}`;
        let conv = conversationCache.get(key);
        
        if (!conv) {
            conv = {
                id: userId,
                messages: [],
                context: {},
                flow: null,
                lastActivity: Date.now(),
                messageCount: 0
            };
            conversationCache.set(key, conv);
        }
        
        conv.lastActivity = Date.now();
        conv.messageCount++;
        return conv;
    }

    addMessage(userId, role, content) {
        const conv = this.getConversation(userId);
        conv.messages.push({
            role,
            content,
            timestamp: Date.now()
        });
        
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
        conv.flow = null;
        conversationCache.set(`conv_${userId}`, conv);
    }

    setFlow(userId, flowData) {
        const conv = this.getConversation(userId);
        conv.flow = flowData;
        conversationCache.set(`conv_${userId}`, conv);
    }

    getFlow(userId) {
        return this.getConversation(userId).flow;
    }

    clearFlow(userId) {
        const conv = this.getConversation(userId);
        conv.flow = null;
        conversationCache.set(`conv_${userId}`, conv);
    }

    getRecentMessages(userId, count = 8) {
        const conv = this.getConversation(userId);
        return conv.messages.slice(-count).map(m => ({
            role: m.role,
            content: m.content
        }));
    }

    cleanup() {
        const now = Date.now();
        const keys = conversationCache.keys();
        let deleted = 0;

        for (const key of keys) {
            const conv = conversationCache.get(key);
            if (conv && now - conv.lastActivity > 6 * 60 * 60 * 1000) { // 6 heures
                conversationCache.del(key);
                deleted++;
            }
        }

        if (deleted > 0) {
            console.log(`🧹 Nettoyage: ${deleted} conversations supprimées`);
        }
    }
}

// ============ GESTIONNAIRE DE FLUX DE COMMANDE ============
class OrderFlowManager {
    constructor() {
        this.steps = {
            IDLE: 'idle',
            SEARCHING: 'searching',
            ASK_NAME: 'ask_name',
            ASK_QUARTIER: 'ask_quartier',
            ASK_INDICATIONS: 'ask_indications',
            ASK_PHONE: 'ask_phone',
            CONFIRM: 'confirm'
        };
    }

    startFlow(userId, medicament, searchResults) {
        convManager.setFlow(userId, {
            step: this.steps.ASK_NAME,
            data: {
                medicament,
                searchResults,
                startTime: Date.now()
            }
        });
        return this.steps.ASK_NAME;
    }

    getStep(userId) {
        const flow = convManager.getFlow(userId);
        return flow?.step || this.steps.IDLE;
    }

    getData(userId) {
        const flow = convManager.getFlow(userId);
        return flow?.data || {};
    }

    updateData(userId, updates) {
        const flow = convManager.getFlow(userId);
        if (flow) {
            flow.data = { ...flow.data, ...updates };
            convManager.setFlow(userId, flow);
        }
    }

    nextStep(userId) {
        const flow = convManager.getFlow(userId);
        if (!flow) return null;

        const stepOrder = [
            this.steps.ASK_NAME,
            this.steps.ASK_QUARTIER,
            this.steps.ASK_INDICATIONS,
            this.steps.ASK_PHONE,
            this.steps.CONFIRM
        ];

        const currentIndex = stepOrder.indexOf(flow.step);
        if (currentIndex < stepOrder.length - 1) {
            flow.step = stepOrder[currentIndex + 1];
            convManager.setFlow(userId, flow);
            return flow.step;
        }
        return null;
    }

    canCreateOrder(userId) {
        const data = this.getData(userId);
        return data.nom && data.quartier && data.telephone && data.medicament;
    }

    getNextQuestion(userId) {
        const step = this.getStep(userId);
        const data = this.getData(userId);

        const questions = {
            [this.steps.ASK_NAME]: "👤 Pour commencer, quel est votre nom complet ?",
            [this.steps.ASK_QUARTIER]: "📍 Dans quel quartier habitez-vous ?",
            [this.steps.ASK_INDICATIONS]: "🗺️ Avez-vous des points de repère pour faciliter la livraison ? (ou envoyez 'non')",
            [this.steps.ASK_PHONE]: "📱 Quel est votre numéro WhatsApp ? (ex: 07080910)",
            [this.steps.CONFIRM]: () => {
                return `📋 *RÉCAPITULATIF* :
• Médicament: ${data.medicament}
• Nom: ${data.nom}
• Quartier: ${data.quartier}
• Repère: ${data.indications || 'Non précisé'}
• Téléphone: ${data.telephone}

Tout est correct ? (oui/non)`;
            }
        };

        if (questions[step]) {
            return typeof questions[step] === 'function' ? questions[step]() : questions[step];
        }
        return null;
    }

    reset(userId) {
        convManager.clearFlow(userId);
    }
}

// ============ SERVICE WHATSAPP ============
class WhatsAppService {
    constructor() {
        this.apiUrl = WHATSAPP_API_URL;
        this.token = WHATSAPP_TOKEN;
        this.queue = [];
        this.processing = false;
    }

    async sendMessage(to, text) {
        if (!text || !to) return false;

        // Ajouter à la queue
        this.queue.push({ to, text });
        
        if (!this.processing) {
            this.processQueue();
        }
        
        return true;
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const { to, text } = this.queue.shift();

        try {
            stats.apiCalls++;

            // Limiter la taille du message
            const maxLength = 4096;
            const finalText = text.length > maxLength ? text.substring(0, maxLength - 100) + '...' : text;

            await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to.replace(/\D/g, ''),
                    type: 'text',
                    text: { body: finalText }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                }
            );

        } catch (error) {
            console.error('❌ WhatsApp error:', error.response?.data || error.message);
            stats.errors++;
            stats.lastError = error.message;
            stats.lastErrorTime = Date.now();
        }

        // Traiter le prochain message après un petit délai
        setTimeout(() => this.processQueue(), 100);
    }

    async markAsRead(messageId) {
        try {
            await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 3000
                }
            );
        } catch (error) {
            // Ignorer les erreurs de lecture
        }
    }
}

// ============ SERVICE GROQ ============
class GroqService {
    constructor() {
        this.apiUrl = GROQ_API_URL;
        this.apiKey = GROQ_API_KEY;
        this.model = GROQ_MODEL;
        this.queue = [];
        this.processing = false;
    }

    async generateResponse(messages, functions = null) {
        return new Promise((resolve) => {
            this.queue.push({ messages, functions, resolve });
            
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    async processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const { messages, functions, resolve } = this.queue.shift();

        try {
            stats.apiCalls++;

            const payload = {
                model: this.model,
                messages: messages,
                temperature: 0.7,
                max_tokens: 800,
                top_p: 0.9
            };

            if (functions) {
                payload.functions = functions;
                payload.function_call = 'auto';
            }

            const response = await axios.post(
                this.apiUrl,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 8000
                }
            );

            resolve(response.data.choices[0].message);

        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            stats.lastError = error.message;
            stats.lastErrorTime = Date.now();
            resolve(null);
        }

        // Petit délai entre les requêtes
        setTimeout(() => this.processQueue(), 200);
    }
}

// ============ FONCTIONS DISPONIBLES ============
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
        description: 'Créer une nouvelle commande',
        parameters: {
            type: 'object',
            properties: {
                client_nom: { type: 'string' },
                client_whatsapp: { type: 'string' },
                client_quartier: { type: 'string' },
                client_indications: { type: 'string' },
                medicament: { type: 'string' }
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
                order_id: { type: 'string' }
            },
            required: ['order_id']
        }
    },
    {
        name: 'submit_feedback',
        description: 'Soumettre un avis',
        parameters: {
            type: 'object',
            properties: {
                order_id: { type: 'string' },
                note: { type: 'number', minimum: 1, maximum: 5 },
                commentaire: { type: 'string' }
            },
            required: ['order_id', 'note']
        }
    }
];

// ============ INITIALISATION ============
const sharedCache = new SharedCache();
const storage = new CloudinaryStorage(sharedCache);
const store = new DataStore(storage, sharedCache);
const orderManager = new OrderManager(store);
const convManager = new ConversationManager();
const orderFlow = new OrderFlowManager();
const whatsapp = new WhatsAppService();
const groq = new GroqService();

// Délai aléatoire pour éviter que tous les workers chargent en même temps
const startupDelay = Math.floor(Math.random() * 5000); // 0-5 secondes
console.log(`⏱️ Worker ${process.pid} démarre dans ${startupDelay}ms`);

setTimeout(() => {
    store.initialize().then(success => {
        if (success) {
            console.log(`🚀 Mia prête (worker ${process.pid})`);
        } else {
            console.error(`❌ Échec initialisation worker ${process.pid}`);
        }
    });
}, startupDelay);

// Rafraîchir toutes les 30 minutes (seulement si c'est le premier worker)
setInterval(() => {
    // Vérifier si c'est le worker avec le PID le plus bas
    const shouldRefresh = !sharedCache.get('refreshing') && 
                          (Date.now() - (sharedCache.get('lastRefresh') || 0) > 25 * 60 * 1000);
    
    if (shouldRefresh) {
        sharedCache.set('refreshing', true);
        store.initialize().then(() => {
            sharedCache.set('lastRefresh', Date.now());
            sharedCache.set('refreshing', false);
        }).catch(() => {
            sharedCache.set('refreshing', false);
        });
    }
}, 5 * 60 * 1000); // Vérifier toutes les 5 minutes

// ============ PROMPT SYSTÈME ULTIME ============
function getSystemPrompt(userId) {
    const context = store.getContext();
    
    return `Tu es MIA, l'assistant santé officiel de San Pedro, Côte d'Ivoire. 🇨🇮

CONTEXTE ACTUEL:
- ${context.pharmacies.total} pharmacies à San Pedro
- ${context.pharmacies.deGarde} pharmacies de garde aujourd'hui
- ${context.livreurs.total} livreurs (${context.livreurs.disponibles} disponibles)

RÈGLES ABSOLUES:
1. 🚫 JAMAIS inventer d'informations
2. 🚫 JAMAIS montrer de JSON ou code
3. ✅ TOUJOURS utiliser les fonctions pour les données réelles
4. ✅ ADAPTATION: l'utilisateur peut changer de sujet à tout moment

GESTION DE TOUS LES CAS:

1. SALUTATIONS: Sois chaleureuse, propose ton aide

2. RECHERCHE MÉDICAMENT:
   - Si nom approximatif ("amox"): cherche avec search_medicine
   - Si trouvé: montre les options avec prix
   - Si non trouvé: propose support

3. COMMANDES (FLOW STRICT):
   Après choix du médicament:
   a) Demander nom
   b) Demander quartier
   c) Demander indications (optionnel)
   d) Demander téléphone
   e) Récapituler et confirmer
   f) UNIQUEMENT APRÈS CONFIRMATION → create_order()

4. ANNULATION À TOUT MOMENT:
   Si "annuler", "stop", "non merci" → stoppe le flow

5. PRODUITS ILLICITES:
   Refuser poliment: "Les pharmacies ne vendent pas ce type de produits"

6. SUPPORT:
   Si problème: "Contactez le support au ${SUPPORT_PHONE}"

7. MESSAGES INCOMPRÉHENSIBLES:
   "Désolé, je n'ai pas compris. Que puis-je faire pour vous ?"

8. CHANGEMENT DE SUJET:
   S'adapter immédiatement, réinitialiser le flow si nécessaire

MAINTENANT, RÉPONDS DE MANIÈRE NATURELLE.`;
}

// ============ EXÉCUTEUR DE FONCTIONS ============
async function executeFunction(name, args, userId) {
    console.log(`⚡ Exécution: ${name}`, args);

    try {
        switch (name) {
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
                    data: store.pharmaciesDeGarde.slice(0, 15).map(p => ({
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
                        note: l.Note_Moyenne || l.note_moyenne || '4.5'
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

                return {
                    success: true,
                    data: {
                        order_id: order.id,
                        status: order.status,
                        livreur_nom: order.livreur?.nom,
                        livreur_tel: order.livreur?.telephone
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
                return { success: false, error: 'Commande non trouvée' };

            case 'submit_feedback':
                const fbOrder = orderManager.getOrder(args.order_id);
                if (fbOrder) {
                    return {
                        success: true,
                        message: 'Merci pour votre avis !'
                    };
                }
                return { success: false, error: 'Commande non trouvée' };

            default:
                return { success: false, error: 'Fonction inconnue' };
        }
    } catch (error) {
        console.error('❌ Erreur fonction:', error);
        return { success: false, error: error.message };
    }
}

// ============ GESTIONNAIRE DE FLOW ============
async function handleOrderFlow(userId, message) {
    const step = orderFlow.getStep(userId);
    const data = orderFlow.getData(userId);
    const lowerMsg = message.toLowerCase().trim();

    // Vérifier annulation
    if (lowerMsg === 'annuler' || lowerMsg === 'stop' || lowerMsg === 'non merci') {
        orderFlow.reset(userId);
        await whatsapp.sendMessage(userId, "❌ Commande annulée. Que puis-je faire d'autre ?");
        return true;
    }

    // Étape: ASK_NAME
    if (step === 'ask_name') {
        if (message.length < 2) {
            await whatsapp.sendMessage(userId, "👤 Veuillez entrer un nom valide.");
            return true;
        }
        orderFlow.updateData(userId, { nom: message });
        orderFlow.nextStep(userId);
        await whatsapp.sendMessage(userId, orderFlow.getNextQuestion(userId));
        return true;
    }

    // Étape: ASK_QUARTIER
    if (step === 'ask_quartier') {
        if (message.length < 2) {
            await whatsapp.sendMessage(userId, "📍 Veuillez entrer un quartier valide.");
            return true;
        }
        orderFlow.updateData(userId, { quartier: message });
        orderFlow.nextStep(userId);
        await whatsapp.sendMessage(userId, orderFlow.getNextQuestion(userId));
        return true;
    }

    // Étape: ASK_INDICATIONS
    if (step === 'ask_indications') {
        if (lowerMsg !== 'non' && lowerMsg !== 'non merci' && lowerMsg !== 'aucune') {
            orderFlow.updateData(userId, { indications: message });
        }
        orderFlow.nextStep(userId);
        await whatsapp.sendMessage(userId, orderFlow.getNextQuestion(userId));
        return true;
    }

    // Étape: ASK_PHONE
    if (step === 'ask_phone') {
        const phone = message.replace(/\D/g, '');
        if (phone.length < 8) {
            await whatsapp.sendMessage(userId, "📱 Numéro invalide. Entrez 8 chiffres (ex: 07080910)");
            return true;
        }
        orderFlow.updateData(userId, { telephone: phone });
        orderFlow.nextStep(userId);
        await whatsapp.sendMessage(userId, orderFlow.getNextQuestion(userId));
        return true;
    }

    // Étape: CONFIRM
    if (step === 'confirm') {
        if (lowerMsg === 'oui' || lowerMsg === 'o' || lowerMsg === 'yes') {
            const allData = orderFlow.getData(userId);
            
            const result = await executeFunction('create_order', {
                client_nom: allData.nom,
                client_whatsapp: allData.telephone,
                client_quartier: allData.quartier,
                client_indications: allData.indications || '',
                medicament: allData.medicament
            }, userId);

            if (result.success) {
                const order = result.data;
                await whatsapp.sendMessage(userId, 
                    `✅ *COMMANDE CONFIRMÉE !*\n\n` +
                    `📋 Numéro: ${order.order_id}\n` +
                    `🚚 Statut: ${order.status}\n` +
                    `🛵 Livreur: ${order.livreur_nom || 'En attente d\'assignation'}\n\n` +
                    `Vous recevrez une confirmation quand le livreur part.`
                );
            } else {
                await whatsapp.sendMessage(userId, "❌ Erreur lors de la création. Contactez le support.");
            }
            
            orderFlow.reset(userId);
        } else if (lowerMsg === 'non' || lowerMsg === 'n') {
            orderFlow.reset(userId);
            await whatsapp.sendMessage(userId, "❌ Commande annulée. Que puis-je faire d'autre ?");
        } else {
            await whatsapp.sendMessage(userId, "Veuillez répondre par 'oui' ou 'non'");
        }
        return true;
    }

    return false;
}

// ============ LOGIQUE PRINCIPALE ============
async function processWithLLM(userId, userMessage) {
    try {
        // Vérifier si en flow de commande
        if (orderFlow.getStep(userId) !== 'idle') {
            const handled = await handleOrderFlow(userId, userMessage);
            if (handled) return;
        }

        // Obtenir le contexte
        const context = store.getContext();
        const recentMessages = convManager.getRecentMessages(userId, 8);

        // Construire les messages pour le LLM
        const messages = [
            { role: 'system', content: getSystemPrompt(userId) },
            ...recentMessages,
            { role: 'user', content: userMessage }
        ];

        // Appeler Groq
        const response = await groq.generateResponse(messages, functions);

        if (!response) {
            await whatsapp.sendMessage(userId, "😔 Désolé, je rencontre une difficulté. Réessaie dans un instant.");
            return;
        }

        // Gérer l'appel de fonction
        if (response.function_call) {
            const { name, arguments: argsString } = response.function_call;
            let args = {};

            try {
                args = JSON.parse(argsString);
            } catch (e) {
                console.error('❌ Parse error:', e);
            }

            // Exécuter la fonction
            const result = await executeFunction(name, args, userId);

            // Cas spécial: search_medicine - démarrer le flow
            if (name === 'search_medicine' && result.success && result.data.length > 0) {
                const meds = result.data;
                
                if (meds.length === 1) {
                    // Un seul résultat, demander si l'utilisateur veut commander
                    const med = meds[0];
                    const msg = `💊 *${med.nom}*\n💰 ${med.prix || '?'} FCFA\n\nVoulez-vous commander ce médicament ? (oui/non)`;
                    
                    convManager.setContext(userId, 'pendingMed', med);
                    await whatsapp.sendMessage(userId, msg);
                    
                } else {
                    // Plusieurs résultats
                    let medList = `💊 *Plusieurs options trouvées:*\n\n`;
                    meds.slice(0, 5).forEach((med, i) => {
                        medList += `${i+1}. *${med.nom}*\n   💰 ${med.prix || '?'} FCFA\n`;
                    });
                    medList += `\nChoisissez un numéro (1-${Math.min(5, meds.length)}) pour commander, ou envoyez le nom exact.`;
                    
                    convManager.setContext(userId, 'searchResults', meds);
                    await whatsapp.sendMessage(userId, medList);
                }
                
                convManager.addMessage(userId, 'assistant', response.content || 'Voici les résultats.');
                return;
            }

            // Pour les autres fonctions, laisser le LLM formuler
            const functionMessage = {
                role: 'function',
                name: name,
                content: JSON.stringify(result)
            };

            const finalResponse = await groq.generateResponse([
                ...messages,
                response,
                functionMessage
            ]);

            if (finalResponse?.content) {
                await whatsapp.sendMessage(userId, finalResponse.content);
                convManager.addMessage(userId, 'assistant', finalResponse.content);
            }

        } else if (response.content) {
            // Réponse directe
            await whatsapp.sendMessage(userId, response.content);
            convManager.addMessage(userId, 'assistant', response.content);
        }

    } catch (error) {
        console.error('❌ LLM error:', error);
        stats.errors++;
        stats.lastError = error.message;
        stats.lastErrorTime = Date.now();
        await whatsapp.sendMessage(userId, "😔 Erreur technique. Contacte le support au " + SUPPORT_PHONE);
    }
}

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

        // Marquer comme lu (asynchrone, ne pas attendre)
        whatsapp.markAsRead(messageId).catch(() => {});

        // Éviter les doublons
        if (processedMessages.has(messageId)) return;
        processedMessages.set(messageId, true);

        // Ignorer les messages non-texte
        if (message.type !== 'text') {
            await whatsapp.sendMessage(from, "👋 Mia ne traite que les messages texte. Envoyez 'bonjour' pour commencer.");
            return;
        }

        const text = message.text.body.trim();
        stats.messagesProcessed++;

        // Ajouter à la conversation
        convManager.addMessage(from, 'user', text);

        // Traiter avec le LLM (ne pas attendre)
        processWithLLM(from, text).catch(error => {
            console.error('❌ Process error:', error);
            stats.errors++;
        });

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
        stats.lastError = error.message;
        stats.lastErrorTime = Date.now();
    }
});

// ============ ENDPOINTS DE MONITORING ============
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    res.json({
        name: 'MIA - San Pedro',
        version: '5.0.0',
        status: 'online',
        worker: process.pid,
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
    const memory = process.memoryUsage();
    const memoryMB = {
        rss: Math.round(memory.rss / 1024 / 1024 * 100) / 100,
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024 * 100) / 100,
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100,
        external: Math.round(memory.external / 1024 / 1024 * 100) / 100
    };

    res.json({
        status: 'healthy',
        worker: process.pid,
        timestamp: new Date().toISOString(),
        memory: memoryMB,
        cache: {
            file: fileCache.keys().length,
            conversation: conversationCache.keys().length,
            processed: processedMessages.keys().length
        },
        stats: {
            messages: stats.messagesProcessed,
            errors: stats.errors,
            lastError: stats.lastError,
            lastErrorTime: stats.lastErrorTime
        }
    });
});

// ============ GESTION DES ERREURS ============
app.use((err, req, res, next) => {
    console.error('🔥 Erreur serveur:', err);
    stats.errors++;
    stats.lastError = err.message;
    stats.lastErrorTime = Date.now();
    res.status(500).json({ error: 'Erreur interne' });
});

// ============ DÉMARRAGE ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   MIA - San Pedro 🇨🇮                  ║
    ║   Version Production 5.0              ║
    ║   Worker PID: ${process.pid.toString().padEnd(24)}      ║
    ║   Environnement: ${NODE_ENV.padEnd(21)}      ║
    ║   Port: ${PORT.toString().padEnd(28)}      ║
    ║   RAM: 512MB | CPU: 0.1               ║
    ║   Support: ${SUPPORT_PHONE}            ║
    ╚═══════════════════════════════════════╝
    `);
});

// Gestion de l'arrêt
process.on('SIGTERM', () => {
    console.log('📴 Arrêt du worker', process.pid);
    server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
    console.error('💥 Exception:', err);
    stats.errors++;
    stats.lastError = err.message;
    stats.lastErrorTime = Date.now();
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Rejection:', err);
    stats.errors++;
    stats.lastError = err.message;
    stats.lastErrorTime = Date.now();
});

// ============ FIN ============
