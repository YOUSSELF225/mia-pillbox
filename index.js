// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version 4.0 - 100% Conversationnel via GROQ
// Optimisé pour Render (512MB RAM, 0.1 CPU)
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

// Sécurité
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Trop de requêtes' }
});
app.use('/webhook', limiter);

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// GROQ
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Cloudinary (tes identifiants)
const CLOUDINARY_CONFIG = {
    cloudName: 'dwq4ituxr',
    apiKey: '488853969793132',
    apiSecret: 'xdq4IuLgflGIBioX4uD0p50wWFA',
    folder: 'pillbox_floder'
};

// URLs Cloudinary
const CLOUDINARY_URLS = {
    pharmacies: `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/raw/upload/v1/${CLOUDINARY_CONFIG.folder}/pharmacies_san_pedro.xlsx`,
    livreurs: `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/raw/upload/v1/${CLOUDINARY_CONFIG.folder}/livreurs_pillbox.xlsx`,
    medicaments: `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/raw/upload/v1/${CLOUDINARY_CONFIG.folder}/pillbox_stock.xlsx`
};

// Support
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';

// ============ CACHES ============
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false, maxKeys: 500 });
const fileCache = new NodeCache({ stdTTL: 1800, useClones: false, maxKeys: 20 });
const sessionCache = new NodeCache({ stdTTL: 1800, checkperiod: 300, maxKeys: 5000 });
const processedMessages = new NodeCache({ stdTTL: 60, maxKeys: 5000 });

// ============ STATISTIQUES ============
const stats = {
    messages: 0,
    commands: 0,
    groqCalls: 0,
    cloudinaryCalls: 0,
    whatsappCalls: 0,
    errors: 0,
    startTime: Date.now()
};

// ============ STOCKAGE CLOUDINARY ============
class CloudinaryStorage {
    async downloadFile(url, fileName) {
        const cacheKey = `file_${fileName}`;
        const cached = fileCache.get(cacheKey);
        if (cached) return cached;

        try {
            stats.cloudinaryCalls++;
            console.log(`📥 Téléchargement: ${fileName}`);

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: { 'Accept-Encoding': 'gzip,deflate' }
            });

            const workbook = XLSX.read(response.data, { type: 'buffer' });
            const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            
            fileCache.set(cacheKey, data);
            console.log(`✅ ${fileName}: ${data.length} lignes`);
            return data;
        } catch (error) {
            console.error(`❌ Erreur ${fileName}:`, error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ BASE DE DONNÉES ============
class Database {
    constructor(storage) {
        this.storage = storage;
        this.pharmacies = [];
        this.livreurs = [];
        this.medicaments = [];
        this.lastUpdate = 0;
    }

    async loadAll() {
        try {
            console.log('📥 Chargement des données...');
            
            const [pharma, livreurs, meds] = await Promise.all([
                this.storage.downloadFile(CLOUDINARY_URLS.pharmacies, 'pharmacies.xlsx'),
                this.storage.downloadFile(CLOUDINARY_URLS.livreurs, 'livreurs.xlsx'),
                this.storage.downloadFile(CLOUDINARY_URLS.medicaments, 'medicaments.xlsx')
            ]);

            if (pharma) this.pharmacies = pharma;
            if (livreurs) this.livreurs = livreurs;
            if (meds) this.medicaments = meds;

            this.lastUpdate = Date.now();
            
            console.log(`✅ Données: ${this.pharmacies.length} pharmacies, ${this.livreurs.length} livreurs, ${this.medicaments.length} médicaments`);
            
            // Mettre en cache
            cache.set('db', {
                pharmacies: this.pharmacies,
                livreurs: this.livreurs,
                medicaments: this.medicaments,
                lastUpdate: this.lastUpdate
            });

            return true;
        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            return false;
        }
    }

    // Recherche de médicaments
    searchMedicaments(term) {
        if (!term || !this.medicaments.length) return [];
        
        const terms = term.toLowerCase().split(' ').filter(t => t.length > 1);
        
        return this.medicaments
            .filter(med => {
                const nom = (med['NOM COMMERCIAL'] || med.nom || '').toLowerCase();
                const dci = (med['DCI'] || med.dci || '').toLowerCase();
                const searchText = `${nom} ${dci}`;
                return terms.some(t => searchText.includes(t));
            })
            .slice(0, 10);
    }

    // Recherche de pharmacies
    searchPharmacies(quartier = null, gardeOnly = false) {
        let results = this.pharmacies;
        
        if (gardeOnly) {
            results = results.filter(p => 
                (p.GARDE || p.garde || 'NON').toString().toUpperCase() === 'OUI'
            );
        }
        
        if (quartier && quartier !== 'toute la ville') {
            const q = quartier.toLowerCase();
            results = results.filter(p => 
                (p.QUARTIER || p.quartier || '').toLowerCase().includes(q)
            );
        }
        
        return results.slice(0, 15);
    }

    // Recherche de livreurs disponibles
    getLivreursDisponibles() {
        return this.livreurs.filter(l => 
            (l.En_Ligne || 'NON').toString().toUpperCase() === 'OUI' &&
            (l.Disponible || 'NON').toString().toUpperCase() === 'OUI'
        );
    }

    // Assigner un livreur
    assignLivreur() {
        const dispo = this.getLivreursDisponibles();
        return dispo.length > 0 ? dispo[Math.floor(Math.random() * dispo.length)] : null;
    }
}

// ============ GESTIONNAIRE COMMANDES ============
class OrderManager {
    constructor() {
        this.orders = new Map();
        this.counter = 0;
    }

    generateId() {
        this.counter++;
        const date = new Date();
        return `CMD${date.getFullYear().toString().slice(-2)}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}${this.counter.toString().padStart(4,'0')}`;
    }

    createOrder(data) {
        const id = this.generateId();
        const order = {
            id,
            ...data,
            status: 'EN_ATTENTE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.orders.set(id, order);
        
        // Nettoyer
        if (this.orders.size > 500) {
            const keys = Array.from(this.orders.keys()).slice(0, 100);
            keys.forEach(k => this.orders.delete(k));
        }
        
        return order;
    }

    getOrder(id) {
        return this.orders.get(id);
    }

    updateOrder(id, status) {
        const order = this.orders.get(id);
        if (order) {
            order.status = status;
            order.updatedAt = new Date().toISOString();
            return true;
        }
        return false;
    }
}

// ============ SERVICE WHATSAPP ============
class WhatsAppService {
    async sendMessage(to, text) {
        if (!text) return;

        try {
            stats.whatsappCalls++;
            
            // Limiter la taille
            if (text.length > 4000) {
                text = text.substring(0, 3900) + '...';
            }

            await axios.post(
                WHATSAPP_API_URL,
                {
                    messaging_product: 'whatsapp',
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
        } catch (error) {
            console.error('❌ WhatsApp error:', error.response?.data || error.message);
            stats.errors++;
        }
    }
}

// ============ SERVICE GROQ ============
class GroqService {
    constructor(db) {
        this.db = db;
    }

    async generateResponse(userMessage, userId, session) {
        try {
            stats.groqCalls++;

            // Construire le contexte à partir de la base de données
            const pharmaciesGarde = this.db.pharmacies.filter(p => 
                (p.GARDE || p.garde || 'NON').toString().toUpperCase() === 'OUI'
            ).slice(0, 5);

            const livreursDispo = this.db.getLivreursDisponibles().slice(0, 5);

            // Créer un prompt système riche avec les données réelles
            const systemPrompt = `Tu es MIA, assistant santé pour San Pedro, Côte d'Ivoire.

CONTEXTE ACTUEL (DONNÉES RÉELLES):
- ${this.db.pharmacies.length} pharmacies à San Pedro
- ${pharmaciesGarde.length} pharmacies de garde aujourd'hui
- ${this.db.livreurs.length} livreurs partenaires
- ${livreursDispo.length} livreurs disponibles maintenant
- ${this.db.medicaments.length} médicaments référencés

PHARMACIES DE GARDE AUJOURD'HUI:
${pharmaciesGarde.map(p => `- ${p.NOM_PHARMACIE || p.nom} (${p.QUARTIER || p.quartier || 'Centre-ville'}) - ${p.TELEPHONE || p.telephone || 'Contact sur place'}`).join('\n') || 'Aucune pharmacie de garde aujourdhui'}

LIVREURS DISPONIBLES:
${livreursDispo.map(l => `- ${l.Nom || l.nom} - Note: ${l.Note_Moyenne || '4.5'}/5`).join('\n') || 'Aucun livreur disponible pour le moment'}

INFORMATIONS SUR L'UTILISATEUR:
- ID: ${userId.substring(0, 10)}...
- Étape actuelle: ${session.step}
- Données session: ${JSON.stringify(session.data)}

RÈGLES DE CONVERSATION:
1. Réponds TOUJOURS en français, de façon naturelle et chaleureuse
2. Utilise des émojis pour rendre la conversation vivante 🏥 💊 🛵
3. Adapte ton langage au contexte ivoirien
4. Si l'utilisateur veut acheter un médicament, guide-le étape par étape
5. Propose toujours des options concrètes basées sur les données réelles
6. Sois concise mais complète (max 300 mots)
7. Termine toujours par une question ouverte pour continuer la conversation
8. Ne donne JAMAIS d'informations fictives - si tu ne sais pas, dis-le honnêtement

HISTORIQUE DE CONVERSATION RÉCENT:
${session.lastResponse ? `Dernière réponse: ${session.lastResponse}` : 'Début de conversation'}`;

            const response = await axios.post(
                GROQ_API_URL,
                {
                    model: GROQ_MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: 0.7,
                    max_tokens: 500,
                    top_p: 0.9
                },
                {
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            const reply = response.data.choices[0]?.message?.content;
            
            // Sauvegarder la réponse dans la session
            session.lastResponse = reply;
            session.lastUserMessage = userMessage;
            
            return reply;

        } catch (error) {
            console.error('❌ GROQ error:', error.response?.data || error.message);
            stats.errors++;
            return "😔 Désolé, je rencontre une difficulté technique. Peux-tu reformuler ta demande ?";
        }
    }
}

// ============ GESTIONNAIRE DE SESSIONS ============
class SessionManager {
    getSession(userId) {
        const key = `session_${userId}`;
        let session = sessionCache.get(key);
        
        if (!session) {
            session = {
                step: 'conversation',
                data: {},
                messages: [],
                lastResponse: null,
                lastUserMessage: null,
                createdAt: Date.now(),
                lastActivity: Date.now()
            };
            sessionCache.set(key, session);
        }
        
        session.lastActivity = Date.now();
        return session;
    }

    updateSession(userId, updates) {
        const key = `session_${userId}`;
        const session = this.getSession(userId);
        Object.assign(session, updates);
        sessionCache.set(key, session);
    }

    addMessage(userId, role, content) {
        const session = this.getSession(userId);
        session.messages.push({ role, content, timestamp: Date.now() });
        if (session.messages.length > 10) session.messages.shift();
        this.updateSession(userId, { messages: session.messages });
    }
}

// ============ INITIALISATION ============
const cloudinary = new CloudinaryStorage();
const db = new Database(cloudinary);
const orders = new OrderManager();
const whatsapp = new WhatsAppService();
const groq = new GroqService(db);
const sessions = new SessionManager();

// Charger les données au démarrage
db.loadAll().then(success => {
    if (success) {
        console.log('🚀 MIA est prête !');
    }
});

// Rafraîchir toutes les 30 minutes
setInterval(() => db.loadAll(), 30 * 60 * 1000);

// ============ WEBHOOK WHATSAPP ============
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        console.log('✅ Webhook vérifié');
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        const entry = req.body.entry?.[0];
        const change = entry?.changes?.[0];
        if (!change || change.field !== 'messages') return;

        const message = change.value?.messages?.[0];
        if (!message || message.type !== 'text') return;

        const from = message.from;
        const text = message.text.body.trim();
        const msgId = message.id;

        // Éviter les doublons
        if (processedMessages.has(msgId)) return;
        processedMessages.set(msgId, true);

        stats.messages++;
        console.log(`📩 [${from.slice(-8)}] ${text.slice(0, 50)}`);

        // Obtenir la session
        const session = sessions.getSession(from);
        sessions.addMessage(from, 'user', text);

        // Traiter avec GROQ
        const response = await groq.generateResponse(text, from, session);

        // Sauvegarder la réponse
        sessions.addMessage(from, 'assistant', response);

        // Détecter les intentions pour actions spécifiques
        const lowerText = text.toLowerCase();
        
        // ACHAT DE MÉDICAMENTS
        if (lowerText.includes('acheter') || lowerText.includes('commander') || 
            (lowerText.includes('médicament') && !session.data.orderStarted)) {
            
            // Chercher des médicaments
            const searchTerms = text.replace(/acheter|commander|je veux|j'aimerais|s'il vous plaît/gi, '').trim();
            if (searchTerms.length > 3) {
                const meds = db.searchMedicaments(searchTerms);
                if (meds.length > 0) {
                    session.data.lastSearch = searchTerms;
                    session.data.medicines = meds.slice(0, 3);
                    session.data.orderStarted = true;
                }
            }
        }

        // RECHERCHE DE PHARMACIES DE GARDE
        if (lowerText.includes('garde') || lowerText.includes('gardes')) {
            const garde = db.pharmacies.filter(p => 
                (p.GARDE || p.garde || 'NON').toString().toUpperCase() === 'OUI'
            );
            session.data.lastGarde = garde.slice(0, 5);
        }

        // SUIVI DE COMMANDE
        if (lowerText.includes('suivi') || lowerText.includes('commande') || lowerText.includes('cmd')) {
            const match = text.match(/CMD\d+/i);
            if (match) {
                const order = orders.getOrder(match[0]);
                if (order) {
                    session.data.lastOrder = order;
                }
            }
        }

        // LIVREURS DISPONIBLES
        if (lowerText.includes('livreur') || lowerText.includes('livraison')) {
            session.data.lastLivreurs = db.getLivreursDisponibles().slice(0, 5);
        }

        // Envoyer la réponse
        await whatsapp.sendMessage(from, response);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ ENDPOINTS ============
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - San Pedro',
        version: '4.0',
        status: 'online',
        stats: {
            messages: stats.messages,
            groqCalls: stats.groqCalls,
            cache: sessionCache.keys().length,
            uptime: Math.floor((Date.now() - stats.startTime) / 1000)
        }
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: process.memoryUsage(),
        data: {
            pharmacies: db.pharmacies.length,
            livreurs: db.livreurs.length,
            medicaments: db.medicaments.length,
            lastUpdate: db.lastUpdate
        }
    });
});

app.get('/stats', (req, res) => {
    res.json(stats);
});

// ============ DÉMARRAGE ============
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   MIA - San Pedro 🇨🇮                  ║
║   Version 4.0 - 100% Conversationnel  ║
║   Modèle: ${GROQ_MODEL.slice(0, 20).padEnd(20)}   ║
║   Pharmacies: ${String(db.pharmacies.length).padEnd(10)}                  ║
║   Livreurs: ${String(db.livreurs.length).padEnd(11)}                    ║
║   Médicaments: ${String(db.medicaments.length).padEnd(8)}                  ║
║   Port: ${String(PORT).padEnd(34)}           ║
║   RAM: 512MB | CPU: 0.1               ║
╚═══════════════════════════════════════╝
    `);
});

// Gestion arrêt
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
