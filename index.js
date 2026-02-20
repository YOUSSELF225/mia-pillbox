// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version Production - Optimisé Render (512MB/0.1CPU)
// ===================================================

const express = require('express');
const axios = require('axios');
const XLSX = require('xlsx');
const { google } = require('googleapis');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
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
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Configuration Google Drive
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE;

// ============ CACHES OPTIMISÉS ============
const cache = new NodeCache({
    stdTTL: 300, // 5 minutes
    checkperiod: 60,
    useClones: false,
    maxKeys: 1000
});

const fileCache = new NodeCache({
    stdTTL: 1800, // 30 minutes
    useClones: false,
    maxKeys: 50
});

const sessionCache = new NodeCache({
    stdTTL: 1800, // 30 minutes
    checkperiod: 300,
    maxKeys: 10000
});

// Cache pour les IDs de messages déjà traités (évite les doublons)
const processedMessages = new NodeCache({
    stdTTL: 60, // 1 minute
    useClones: false,
    maxKeys: 10000
});

// ============ STATISTIQUES EN TEMPS RÉEL ============
const stats = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    driveCalls: 0,
    groqCalls: 0,
    whatsappCalls: 0,
    errors: 0,
    startTime: Date.now()
};

// ============ AUTHENTIFICATION GOOGLE DRIVE ============
let drive;
try {
    // Pour Render, on utilise les variables d'environnement pour les credentials
    if (process.env.GOOGLE_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        drive = google.drive({ version: 'v3', auth });
    } else {
        // Fallback pour le développement local
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        drive = google.drive({ version: 'v3', auth });
    }
    console.log('✅ Google Drive authentifié');
} catch (error) {
    console.error('❌ Erreur auth Google Drive:', error.message);
    process.exit(1);
}

// ============ STRUCTURES DE DONNÉES OPTIMISÉES ============
class OptimizedDataStore {
    constructor() {
        this.pharmacies = [];
        this.pharmaciesDeGarde = [];
        this.pharmaciesByQuartier = new Map();
        this.pharmaciesById = new Map();
        this.livreurs = [];
        this.livreursDisponibles = [];
        this.livreursByZone = new Map();
        this.medicamentsCache = new Map();
        this.lastUpdate = 0;
    }

    // Chargement optimisé des index
    async loadIndexes() {
        try {
            const cacheKey = 'master_indexes';
            const cached = cache.get(cacheKey);
            if (cached) {
                Object.assign(this, cached);
                stats.cacheHits++;
                return true;
            }

            console.log('📥 Chargement des index depuis Google Drive...');
            stats.driveCalls += 2;

            // Charger les pharmacies
            const pharmaWorkbook = await this.loadExcelFromDrive('pharmacies_san_pedro.xlsx');
            if (pharmaWorkbook) {
                this.pharmacies = XLSX.utils.sheet_to_json(pharmaWorkbook.Sheets[pharmaWorkbook.SheetNames[0]]);
                
                // Optimisation: créer des maps pour recherche O(1)
                this.pharmaciesById.clear();
                this.pharmaciesByQuartier.clear();
                this.pharmaciesDeGarde = [];
                
                for (const p of this.pharmacies) {
                    const id = p.ID || p.id || `P${Math.random().toString(36).substr(2, 9)}`;
                    this.pharmaciesById.set(id, p);
                    
                    const quartier = p.QUARTIER || p.quartier || 'Non précisé';
                    if (!this.pharmaciesByQuartier.has(quartier)) {
                        this.pharmaciesByQuartier.set(quartier, []);
                    }
                    this.pharmaciesByQuartier.get(quartier).push(p);
                    
                    if ((p.GARDE || p.garde || '').toString().toUpperCase() === 'OUI') {
                        this.pharmaciesDeGarde.push(p);
                    }
                }
            }

            // Charger les livreurs
            const livreursWorkbook = await this.loadExcelFromDrive('livreurs_pillbox.xlsx');
            if (livreursWorkbook) {
                this.livreurs = XLSX.utils.sheet_to_json(livreursWorkbook.Sheets[livreursWorkbook.SheetNames[0]]);
                
                // Optimisation livreurs
                this.livreursDisponibles = [];
                this.livreursByZone.clear();
                
                for (const l of this.livreurs) {
                    if ((l.En_Ligne || 'NON').toString().toUpperCase() === 'OUI' && 
                        (l.Disponible || 'NON').toString().toUpperCase() === 'OUI') {
                        this.livreursDisponibles.push(l);
                    }
                    
                    // Simplification: on suppose que le livreur couvre toutes les zones
                    // Dans une vraie implémentation, utiliser la colonne Zone_Couverture
                    const zone = 'Toutes';
                    if (!this.livreursByZone.has(zone)) {
                        this.livreursByZone.set(zone, []);
                    }
                    this.livreursByZone.get(zone).push(l);
                }
            }

            this.lastUpdate = Date.now();
            
            // Mettre en cache
            cache.set(cacheKey, {
                pharmacies: this.pharmacies,
                pharmaciesDeGarde: this.pharmaciesDeGarde,
                pharmaciesByQuartier: this.pharmaciesByQuartier,
                pharmaciesById: this.pharmaciesById,
                livreurs: this.livreurs,
                livreursDisponibles: this.livreursDisponibles,
                livreursByZone: this.livreursByZone,
                lastUpdate: this.lastUpdate
            });

            console.log(`✅ Index chargés: ${this.pharmacies.length} pharmacies, ${this.livreurs.length} livreurs`);
            stats.cacheMisses++;
            return true;

        } catch (error) {
            console.error('❌ Erreur chargement index:', error);
            stats.errors++;
            return false;
        }
    }

    async loadExcelFromDrive(fileName) {
        try {
            const cacheKey = `file_${fileName}`;
            const cached = fileCache.get(cacheKey);
            if (cached) return cached;

            const response = await drive.files.list({
                q: `name='${fileName}' and '${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed=false`,
                fields: 'files(id, name)',
                pageSize: 1
            });

            if (!response.data.files || response.data.files.length === 0) {
                console.log(`⚠️ Fichier non trouvé: ${fileName}`);
                return null;
            }

            const fileId = response.data.files[0].id;
            const file = await drive.files.get({
                fileId: fileId,
                alt: 'media',
            });

            const workbook = XLSX.read(file.data, { type: 'buffer' });
            fileCache.set(cacheKey, workbook);
            return workbook;

        } catch (error) {
            console.error(`❌ Erreur chargement ${fileName}:`, error.message);
            stats.errors++;
            return null;
        }
    }

    async searchMedicine(medicament, quartier = null, useGardeOnly = true) {
        const startTime = Date.now();
        const cacheKey = `med_${medicament}_${quartier || 'all'}_${useGardeOnly}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            stats.cacheHits++;
            return cached;
        }

        try {
            // Déterminer les pharmacies à interroger
            let pharmaciesToSearch = useGardeOnly && this.pharmaciesDeGarde.length > 0 
                ? this.pharmaciesDeGarde 
                : this.pharmacies;

            if (quartier && this.pharmaciesByQuartier.has(quartier)) {
                pharmaciesToSearch = this.pharmaciesByQuartier.get(quartier);
            }

            // Limiter le nombre de pharmacies pour la recherche (optimisation)
            const searchLimit = useGardeOnly ? 20 : 10;
            pharmaciesToSearch = pharmaciesToSearch.slice(0, searchLimit);

            const results = [];
            const searchTerms = medicament.toLowerCase().split(' ');

            // Rechercher le fichier des médicaments
            const workbook = await this.loadExcelFromDrive('pillbox_stock.xlsx');
            
            if (!workbook) {
                return [];
            }

            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const allMedicines = XLSX.utils.sheet_to_json(sheet);
            
            // Filtrer les médicaments correspondant à la recherche
            const matchingMedicines = allMedicines.filter(med => {
                const nom = (med['NOM COMMERCIAL'] || '').toLowerCase();
                const dci = (med['DCI'] || '').toLowerCase();
                return searchTerms.some(term => nom.includes(term) || dci.includes(term));
            }).slice(0, 5); // Top 5 médicaments

            // Simuler la disponibilité dans les pharmacies
            for (const pharma of pharmaciesToSearch) {
                const availableMeds = matchingMedicines.map(med => ({
                    nom: med['NOM COMMERCIAL'],
                    dosage: med['TYPE'] || 'Standard',
                    prix: med['PRIX'] || 0,
                    stock: Math.floor(Math.random() * 50) + 1 // Simulation
                }));

                if (availableMeds.length > 0) {
                    results.push({
                        pharmacie: pharma.NOM_PHARMACIE || pharma.nom || 'Pharmacie',
                        pharmacien: pharma.PHARMACIEN || '',
                        telephone: pharma.TELEPHONE || pharma.telephone || '',
                        quartier: pharma.QUARTIER || pharma.quartier || 'Non précisé',
                        garde: (pharma.GARDE || pharma.garde || 'NON') === 'OUI',
                        medicaments: availableMeds.slice(0, 3) // Top 3 par pharmacie
                    });
                }
            }

            // Mettre en cache
            cache.set(cacheKey, results, 120); // 2 minutes
            stats.cacheMisses++;
            
            console.log(`🔍 Recherche "${medicament}" en ${Date.now() - startTime}ms: ${results.length} résultats`);
            return results;

        } catch (error) {
            console.error('❌ Erreur searchMedicine:', error);
            stats.errors++;
            return [];
        }
    }

    assignLivreur(zone) {
        if (this.livreursDisponibles.length > 0) {
            // Rotation simple des livreurs
            const livreur = this.livreursDisponibles[0];
            
            // Mettre à jour ses stats (simulé)
            livreur.Commandes_En_Cours = (parseInt(livreur.Commandes_En_Cours || 0) + 1).toString();
            livreur.Commandes_Aujourdhui = (parseInt(livreur.Commandes_Aujourdhui || 0) + 1).toString();
            
            // Le retirer temporairement des disponibles si trop de commandes
            if (parseInt(livreur.Commandes_En_Cours) >= 3) {
                this.livreursDisponibles.shift();
            }
            
            return livreur;
        }
        return null;
    }
}

// ============ GESTIONNAIRE DE COMMANDES ============
class OrderManager {
    constructor(store) {
        this.store = store;
        this.activeOrders = new Map();
    }

    generateOrderId() {
        return `CMD${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    }

    async createOrder(orderData) {
        const orderId = this.generateOrderId();
        const timestamp = new Date().toISOString();
        
        const order = {
            ID_Commande: orderId,
            Date: timestamp.split('T')[0],
            Heure: timestamp.split('T')[1].substring(0, 8),
            ...orderData,
            Statut: 'EN_ATTENTE_LIVREUR',
            createdAt: timestamp,
            updatedAt: timestamp
        };

        // Assigner un livreur
        const livreur = this.store.assignLivreur(orderData.Quartier || 'Centre');
        if (livreur) {
            order.ID_Livreur = livreur.ID_Livreur || livreur.id || 'LIV000';
            order.Nom_Livreur = livreur.Nom || livreur.nom || 'Livreur';
            order.Telephone_Livreur = livreur.Telephone || livreur.telephone || '';
            order.Statut = 'LIVREUR_ASSIGNE';
        }

        this.activeOrders.set(orderId, order);
        
        // Limiter la taille de la map (garder seulement les 1000 dernières commandes)
        if (this.activeOrders.size > 1000) {
            const oldestKey = this.activeOrders.keys().next().value;
            this.activeOrders.delete(oldestKey);
        }

        return order;
    }

    getOrder(orderId) {
        return this.activeOrders.get(orderId);
    }

    updateOrderStatus(orderId, status, additionalData = {}) {
        const order = this.activeOrders.get(orderId);
        if (order) {
            order.Statut = status;
            order.updatedAt = new Date().toISOString();
            Object.assign(order, additionalData);
            this.activeOrders.set(orderId, order);
            return true;
        }
        return false;
    }
}

// ============ GESTIONNAIRE DE SESSIONS ============
class SessionManager {
    constructor() {
        this.sessions = new Map();
    }

    getSession(userId) {
        const cacheKey = `session_${userId}`;
        let session = sessionCache.get(cacheKey);
        
        if (!session) {
            session = {
                step: 'menu',
                data: {},
                lastActivity: Date.now(),
                messageCount: 0
            };
            sessionCache.set(cacheKey, session);
        }
        
        session.lastActivity = Date.now();
        session.messageCount++;
        return session;
    }

    setStep(userId, step) {
        const cacheKey = `session_${userId}`;
        const session = this.getSession(userId);
        session.step = step;
        sessionCache.set(cacheKey, session);
    }

    setData(userId, key, value) {
        const cacheKey = `session_${userId}`;
        const session = this.getSession(userId);
        session.data[key] = value;
        sessionCache.set(cacheKey, session);
    }

    getData(userId, key) {
        return this.getSession(userId).data[key];
    }

    clearData(userId) {
        const cacheKey = `session_${userId}`;
        const session = this.getSession(userId);
        session.data = {};
        sessionCache.set(cacheKey, session);
    }

    resetToMenu(userId) {
        const cacheKey = `session_${userId}`;
        sessionCache.set(cacheKey, {
            step: 'menu',
            data: {},
            lastActivity: Date.now(),
            messageCount: 0
        });
    }
}

// ============ SERVICE WHATSAPP ============
class WhatsAppService {
    constructor() {
        this.apiUrl = WHATSAPP_API_URL;
        this.token = WHATSAPP_TOKEN;
    }

    async sendMessage(to, text) {
        try {
            stats.whatsappCalls++;
            
            const response = await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to.replace(/\D/g, ''),
                    type: 'text',
                    text: { body: text }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ WhatsApp send error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }

    async sendTemplate(to, templateName, language = 'fr') {
        try {
            stats.whatsappCalls++;
            
            const response = await axios.post(
                this.apiUrl,
                {
                    messaging_product: 'whatsapp',
                    to: to.replace(/\D/g, ''),
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: language }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            return response.data;
        } catch (error) {
            console.error('❌ WhatsApp template error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ SERVICE GROQ AI ============
class GroqService {
    constructor() {
        this.apiUrl = GROQ_API_URL;
        this.apiKey = GROQ_API_KEY;
        this.model = GROQ_MODEL;
    }

    async generateResponse(systemPrompt, userMessage) {
        try {
            stats.groqCalls++;
            
            const response = await axios.post(
                this.apiUrl,
                {
                    model: this.model,
                    messages: [
                        { role: 'system', content: systemPrompt.substring(0, 2000) },
                        { role: 'user', content: userMessage.substring(0, 500) }
                    ],
                    temperature: 0.7,
                    max_tokens: 300,
                    top_p: 0.9,
                    stream: false
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 3000
                }
            );

            return response.data.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }

    async extractMedicineAndZone(userMessage) {
        const systemPrompt = `Extrais de cette demande le médicament recherché et éventuellement le quartier.
        Réponds UNIQUEMENT au format JSON: {"medicament": "...", "zone": "..."}
        Si pas de zone, mets "zone": null
        Exemple: "Je cherche du paracétamol à Zone 4" -> {"medicament": "paracétamol", "zone": "Zone 4"}`;
        
        const response = await this.generateResponse(systemPrompt, userMessage);
        
        try {
            if (response) {
                // Nettoyer la réponse pour extraire le JSON
                const jsonMatch = response.match(/\{.*\}/s);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            }
        } catch (e) {
            console.error('❌ Parse error:', e);
        }
        
        // Fallback
        return { medicament: userMessage, zone: null };
    }
}

// ============ INITIALISATION DES SERVICES ============
const store = new OptimizedDataStore();
const orderManager = new OrderManager(store);
const sessionManager = new SessionManager();
const whatsapp = new WhatsAppService();
const groq = new GroqService();

// Charger les données au démarrage
store.loadIndexes().then(success => {
    if (success) {
        console.log('🚀 Mia est prête à servir San Pedro!');
    } else {
        console.warn('⚠️ Mia démarre sans données fraîches');
    }
});

// Rafraîchir les données périodiquement
setInterval(() => {
    store.loadIndexes().catch(console.error);
}, 15 * 60 * 1000); // 15 minutes

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
    // Répondre immédiatement pour éviter timeout
    res.sendStatus(200);

    try {
        const { entry } = req.body;
        if (!entry || !entry[0] || !entry[0].changes || !entry[0].changes[0]) {
            return;
        }

        const change = entry[0].changes[0];
        if (change.field !== 'messages') return;

        const messageData = change.value;
        if (!messageData.messages || !messageData.messages[0]) return;

        const message = messageData.messages[0];
        const from = message.from;
        const messageId = message.id;

        // Éviter de traiter le même message plusieurs fois
        if (processedMessages.has(messageId)) {
            return;
        }
        processedMessages.set(messageId, true);

        let text = '';
        if (message.type === 'text') {
            text = message.text.body.trim();
        } else {
            // Ne répondre qu'aux messages texte
            await whatsapp.sendMessage(from, "❌ Désolé, je ne comprends que les messages texte. Envoie '0' pour le menu.");
            return;
        }

        stats.messagesProcessed++;

        // Log pour debugging
        console.log(`📩 [${from}] ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

        // Traiter le message
        await processMessage(from, text);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ LOGIQUE PRINCIPALE ============
async function processMessage(userId, text) {
    const session = sessionManager.getSession(userId);
    let response = '';

    try {
        // === COMMANDES RAPIDES ===
        const lowerText = text.toLowerCase();

        if (lowerText === '0' || lowerText === 'menu') {
            sessionManager.resetToMenu(userId);
            response = getMenuMessage();
        }

        else if (lowerText === 'stats' && userId.includes('2250708091011')) { // Admin only
            const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            
            response = `📊 *STATISTIQUES MIA*\n\n` +
                `Messages: ${stats.messagesProcessed}\n` +
                `Commandes: ${stats.commandsExecuted}\n` +
                `Cache hits: ${stats.cacheHits}\n` +
                `Cache misses: ${stats.cacheMisses}\n` +
                `Drive calls: ${stats.driveCalls}\n` +
                `Groq calls: ${stats.groqCalls}\n` +
                `WhatsApp calls: ${stats.whatsappCalls}\n` +
                `Erreurs: ${stats.errors}\n` +
                `Uptime: ${hours}h ${minutes}min\n` +
                `Pharmacies: ${store.pharmacies.length}\n` +
                `Livreurs: ${store.livreurs.length}`;
        }

        // === GESTION DES ÉTAPES ===
        else if (session.step === 'menu') {
            stats.commandsExecuted++;

            if (lowerText === '1' || lowerText === 'acheter' || lowerText.includes('médicament')) {
                sessionManager.setStep(userId, 'ask_medicine');
                response = `💊 *ACHAT DE MÉDICAMENTS*\n\n` +
                    `Quel médicament cherches-tu ?\n` +
                    `Exemple: *Paracétamol 500mg* ou *Amoxicilline*\n\n` +
                    `0️⃣ Menu principal`;
            }
            else if (lowerText === '2' || lowerText.includes('pharmacie de garde')) {
                await showPharmaciesGarde(userId);
                return;
            }
            else if (lowerText === '3' || lowerText.includes('suivi') || lowerText.includes('commande')) {
                sessionManager.setStep(userId, 'track_order');
                response = `📦 *SUIVI DE COMMANDE*\n\n` +
                    `Envoie ton numéro de commande (ex: CMD170123ABC)\n\n` +
                    `0️⃣ Menu principal`;
            }
            else if (lowerText === '4' || lowerText.includes('livreur')) {
                await showLivreurs(userId);
                return;
            }
            else if (lowerText === '5' || lowerText.includes('support') || lowerText.includes('aide')) {
                response = `🆘 *SUPPORT CLIENT*\n\n` +
                    `📞 Téléphone: ${SUPPORT_PHONE}\n` +
                    `💬 WhatsApp: ${SUPPORT_PHONE}\n` +
                    `⏰ Disponible: 24h/24, 7j/7\n\n` +
                    `0️⃣ Menu principal`;
            }
            else {
                // Utiliser Groq pour les questions générales
                const systemPrompt = `Tu es Mia, assistant santé pour San Pedro, Côte d'Ivoire.
                Tu aides pour: achat médicaments, pharmacies de garde, suivi commandes.
                Sois amical, réponds en français, reste concis (max 100 mots).
                Si la demande n'est pas claire, redirige vers le menu.`;
                
                const aiResponse = await groq.generateResponse(systemPrompt, text);
                if (aiResponse) {
                    response = aiResponse + '\n\n0️⃣ Menu principal';
                } else {
                    response = getMenuMessage();
                }
            }
        }

        else if (session.step === 'ask_medicine') {
            sessionManager.setData(userId, 'searchQuery', text);
            sessionManager.setStep(userId, 'confirm_zone');
            
            response = `📍 Dans quel quartier es-tu ?\n` +
                `(ou envoie "toute la ville" pour chercher partout)\n\n` +
                `Exemples: Zone 4, Centre-ville, Toute la ville\n\n` +
                `0️⃣ Annuler`;
        }

        else if (session.step === 'confirm_zone') {
            const searchQuery = sessionManager.getData(userId, 'searchQuery');
            const zone = text.toLowerCase() === 'toute la ville' ? null : text;
            
            await whatsapp.sendMessage(userId, "🔍 Recherche en cours... Un instant ⏳");
            
            const results = await store.searchMedicine(searchQuery, zone, true);
            
            if (results.length === 0) {
                // Réessayer sans filtre garde
                const allResults = await store.searchMedicine(searchQuery, zone, false);
                
                if (allResults.length === 0) {
                    response = `😔 Désolé, je n'ai pas trouvé "${searchQuery}" à San Pedro.\n\n` +
                        `Suggestions:\n` +
                        `• Vérifie l'orthographe\n` +
                        `• Essaie le nom générique\n` +
                        `• Contacte le support: ${SUPPORT_PHONE}\n\n` +
                        `0️⃣ Menu principal`;
                } else {
                    response = formatMedicineResults(allResults, searchQuery, false);
                }
            } else {
                response = formatMedicineResults(results, searchQuery, true);
            }
            
            sessionManager.setData(userId, 'lastResults', results);
            sessionManager.setStep(userId, 'after_search');
        }

        else if (session.step === 'after_search') {
            if (lowerText === '1' || lowerText.includes('acheter')) {
                sessionManager.setStep(userId, 'collect_name');
                response = `👤 Pour finaliser ta commande, j'ai besoin de:\n\n` +
                    `1. Ton *nom complet*\n` +
                    `2. Ton *numéro WhatsApp* (si différent)\n` +
                    `3. Ton *quartier*\n` +
                    `4. Des *indications* (points de repère)\n\n` +
                    `Envoie ces infos séparées par des virgules:\n` +
                    `Exemple: *Kouassi Jean, 07080910, Zone 4, Près du marché*\n\n` +
                    `0️⃣ Annuler`;
            }
            else {
                sessionManager.resetToMenu(userId);
                response = getMenuMessage();
            }
        }

        else if (session.step === 'collect_name') {
            if (lowerText === '0') {
                sessionManager.resetToMenu(userId);
                response = getMenuMessage();
            } else {
                const parts = text.split(',').map(p => p.trim());
                if (parts.length >= 4) {
                    const clientInfo = {
                        Nom_Client: parts[0],
                        WhatsApp_Client: parts[1].replace(/\D/g, ''),
                        Quartier: parts[2],
                        Indications: parts.slice(3).join(', ')
                    };
                    
                    sessionManager.setData(userId, 'clientInfo', clientInfo);
                    
                    // Créer la commande
                    const lastResults = sessionManager.getData(userId, 'lastResults');
                    const searchQuery = sessionManager.getData(userId, 'searchQuery');
                    
                    const orderData = {
                        ...clientInfo,
                        Medicaments: searchQuery,
                        Pharmacie: lastResults && lastResults[0] ? lastResults[0].pharmacie : 'À confirmer'
                    };
                    
                    const order = await orderManager.createOrder(orderData);
                    
                    response = `✅ *COMMANDE ENREGISTRÉE!*\n\n` +
                        `📋 *Numéro:* ${order.ID_Commande}\n` +
                        `📦 *Statut:* ${order.Statut}\n` +
                        `👤 *Client:* ${order.Nom_Client}\n` +
                        `📍 *Quartier:* ${order.Quartier}\n\n`;
                    
                    if (order.ID_Livreur) {
                        response += `🛵 *Livreur assigné:* ${order.Nom_Livreur}\n` +
                            `📞 *Contact:* ${order.Telephone_Livreur}\n\n`;
                    }
                    
                    response += `🔔 Tu recevras une confirmation dès que le livreur part.\n\n` +
                        `Pour suivre ta commande, envoie "3" puis ton numéro.\n\n` +
                        `0️⃣ Menu principal`;
                    
                    sessionManager.resetToMenu(userId);
                } else {
                    response = `❌ Format incorrect. Envoie: *Nom, WhatsApp, Quartier, Indications*\n` +
                        `Exemple: *Kouassi Jean, 07080910, Zone 4, Près du marché*\n\n` +
                        `0️⃣ Annuler`;
                }
            }
        }

        else if (session.step === 'track_order') {
            if (lowerText === '0') {
                sessionManager.resetToMenu(userId);
                response = getMenuMessage();
            } else {
                const order = orderManager.getOrder(text);
                
                if (order) {
                    response = `📦 *COMMANDE ${order.ID_Commande}*\n\n` +
                        `📊 *Statut:* ${order.Statut}\n` +
                        `💊 *Médicaments:* ${order.Medicaments}\n` +
                        `🏪 *Pharmacie:* ${order.Pharmacie}\n` +
                        `👤 *Client:* ${order.Nom_Client}\n` +
                        `📍 *Quartier:* ${order.Quartier}\n`;
                    
                    if (order.ID_Livreur) {
                        response += `\n🛵 *Livreur:* ${order.Nom_Livreur}\n` +
                            `📞 *Contact:* ${order.Telephone_Livreur}\n`;
                    }
                    
                    response += `\n⏱️ *Créée le:* ${order.Date} à ${order.Heure}\n\n` +
                        `0️⃣ Menu principal`;
                } else {
                    response = `❌ Commande non trouvée. Vérifie le numéro.\n\n` +
                        `0️⃣ Menu principal`;
                }
                
                sessionManager.resetToMenu(userId);
            }
        }

        else {
            // Fallback - retour au menu
            sessionManager.resetToMenu(userId);
            response = getMenuMessage();
        }

        // Envoyer la réponse si elle n'a pas déjà été envoyée
        if (response) {
            await whatsapp.sendMessage(userId, response);
        }

    } catch (error) {
        console.error('❌ Process error:', error);
        stats.errors++;
        await whatsapp.sendMessage(userId, "😔 Désolé, une erreur technique. Réessaie ou contacte le support.");
    }
}

// ============ FONCTIONS D'AFFICHAGE ============
function getMenuMessage() {
    const now = new Date();
    const heure = now.getHours();
    const salutation = heure < 12 ? 'Bonjour' : heure < 18 ? 'Bon après-midi' : 'Bonsoir';
    
    return `🩺 *${salutation} ! Je suis MIA, ton assistant santé à San Pedro* 🇨🇮

*Menu principal:*

1️⃣ *Acheter des médicaments* 💊
   - Recherche dans nos pharmacies
   - Livraison rapide

2️⃣ *Pharmacies de garde* 🛡️
   - Celles ouvertes maintenant

3️⃣ *Suivre ma commande* 📦
   - Vérifier le statut

4️⃣ *Nos livreurs* 🛵
   - Disponibilité en temps réel

5️⃣ *Support client* 🆘
   - Aide et assistance

0️⃣ *Répéter ce menu*

*Envoie simplement le chiffre correspondant.*`;
}

async function showPharmaciesGarde(userId) {
    await store.loadIndexes(); // Rafraîchir les données
    
    if (store.pharmaciesDeGarde.length === 0) {
        await whatsapp.sendMessage(userId, 
            `😔 Aucune pharmacie de garde aujourd'hui.\n\n` +
            `Utilise l'option 1️⃣ pour chercher dans toutes les pharmacies.\n\n` +
            `0️⃣ Menu principal`);
        return;
    }

    let message = `🛡️ *PHARMACIES DE GARDE ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}*\n\n`;

    store.pharmaciesDeGarde.slice(0, 10).forEach((p, i) => {
        message += `${i+1}. *${p.NOM_PHARMACIE || p.nom || 'Pharmacie'}*\n`;
        message += `   👨‍⚕️ ${p.PHARMACIEN || 'Pharmacien'}\n`;
        message += `   📞 ${p.TELEPHONE || p.telephone || 'Non communiqué'}\n`;
        message += `   📍 ${p.ADRESSE || p.adresse || 'Adresse non précisée'}\n`;
        if (p.QUARTIER || p.quartier) {
            message += `   🏘️ Quartier: ${p.QUARTIER || p.quartier}\n`;
        }
        message += `   ⏰ Ouvert 24h/24 pendant la garde\n\n`;
    });

    message += `Pour acheter dans l'une de ces pharmacies, envoie *1*\n\n`;
    message += `0️⃣ Menu principal`;

    await whatsapp.sendMessage(userId, message);
}

async function showLivreurs(userId) {
    await store.loadIndexes();
    
    const dispo = store.livreursDisponibles;
    const total = store.livreurs.length;
    
    let message = `🛵 *NOS LIVREURS À SAN PEDRO*\n\n`;
    message += `📊 *Statistiques:*\n`;
    message += `• Total: ${total} livreurs\n`;
    message += `• Disponibles: ${dispo.length}\n`;
    message += `• En livraison: ${total - dispo.length}\n\n`;
    
    if (dispo.length > 0) {
        message += `✅ *Livreurs disponibles maintenant:*\n\n`;
        dispo.slice(0, 5).forEach((l, i) => {
            message += `${i+1}. *${l.Nom || l.nom || 'Livreur'}*\n`;
            message += `   📞 ${l.Telephone || l.telephone || 'Non communiqué'}\n`;
            message += `   ⭐ Note: ${l.Note_Moyenne || '4.5'}/5\n`;
            message += `   🛵 Engin: ${l.Engin || 'Moto'}\n\n`;
        });
    }
    
    message += `0️⃣ Menu principal`;
    
    await whatsapp.sendMessage(userId, message);
}

function formatMedicineResults(results, searchQuery, gardeOnly) {
    let message = gardeOnly 
        ? `✅ *TROUVÉ DANS PHARMACIES DE GARDE*\n\n` 
        : `⚠️ *AUCUNE PHARMACIE DE GARDE*\nRecherche élargie à toutes les pharmacies:\n\n`;
    
    results.slice(0, 5).forEach((r, i) => {
        message += `${i+1}. *${r.pharmacie}*\n`;
        message += `   📍 ${r.quartier}\n`;
        if (r.garde) message += `   🛡️ *Pharmacie de garde*\n`;
        message += `   💊 *Médicaments disponibles:*\n`;
        
        r.medicaments.forEach(m => {
            message += `      • ${m.nom} - ${m.prix} FCFA (stock: ${m.stock})\n`;
        });
        
        message += `   📞 ${r.telephone || 'Appeler pour confirmation'}\n\n`;
    });
    
    message += `Pour commander, envoie *1*.\n`;
    message += `Pour une nouvelle recherche, envoie *0*.\n\n`;
    message += `0️⃣ Menu principal`;
    
    return message;
}

// ============ ENDPOINTS DE MONITORING ============
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - San Pedro',
        version: '3.0.0',
        status: 'online',
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        stats: {
            messagesProcessed: stats.messagesProcessed,
            commandsExecuted: stats.commandsExecuted,
            cacheHitRate: stats.cacheHits + stats.cacheMisses > 0 
                ? Math.round((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100) 
                : 0,
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
            keys: cache.keys().length,
            fileCache: fileCache.keys().length,
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
    res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ============ DÉMARRAGE DU SERVEUR ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   MIA - San Pedro 🇨🇮                  ║
    ║   Version Production 3.0              ║
    ║   Environnement: ${NODE_ENV.padEnd(15)}       ║
    ║   Port: ${PORT.toString().padEnd(32)}           ║
    ║   RAM: 512MB | CPU: 0.1               ║
    ╚═══════════════════════════════════════╝
    `);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('📴 Arrêt signalé, fermeture propre...');
    server.close(() => {
        console.log('✅ Serveur arrêté');
        process.exit(0);
    });
});

process.on('uncaughtException', (err) => {
    console.error('💥 Exception non capturée:', err);
    stats.errors++;
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Rejet non géré:', err);
    stats.errors++;
});

// ============ FIN DU CODE ============
