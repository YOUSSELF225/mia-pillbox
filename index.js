// ===================================================
// MIA - Assistant Santé San Pedro 🇨🇮
// Version Production - LLM Conversationnel Pur
// Architecture: Groq (Llama 3) comme cerveau principal
// Optimisé pour Render (512MB RAM, 0.1 CPU)
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

// ============ CONSTANTES ============
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Support
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';

// Cloudinary URLs (fichiers exacts)
const CLOUDINARY_BASE = 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1/pillbox_floder';
const FILES = {
    pharmacies: `${CLOUDINARY_BASE}/pharmacies_san_pedro.xlsx`,
    livreurs: `${CLOUDINARY_BASE}/livreurs_pillbox.xlsx`,
    medicaments: `${CLOUDINARY_BASE}/pillbox_stock.xlsx`
};

// ============ CACHES ============
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false, maxKeys: 1000 });
const fileCache = new NodeCache({ stdTTL: 1800, useClones: false, maxKeys: 50 });
const sessionCache = new NodeCache({ stdTTL: 3600, checkperiod: 300, maxKeys: 10000 });
const processedMessages = new NodeCache({ stdTTL: 60, useClones: false, maxKeys: 10000 });

// ============ STATISTIQUES ============
const stats = {
    messagesProcessed: 0,
    commandsExecuted: 0,
    cacheHits: 0,
    cacheMisses: 0,
    groqCalls: 0,
    whatsappCalls: 0,
    errors: 0,
    startTime: Date.now()
};

// ============ STOCKAGE DE DONNÉES ============
class DataStore {
    constructor() {
        this.pharmacies = [];
        this.pharmaciesDeGarde = [];
        this.pharmaciesByQuartier = new Map();
        this.pharmaciesById = new Map();
        this.livreurs = [];
        this.livreursDisponibles = [];
        this.medicaments = [];
        this.medicamentsByNom = new Map();
        this.lastUpdate = 0;
    }

    async loadAllData() {
        try {
            console.log('📥 Chargement des données depuis Cloudinary...');

            const [pharmaData, livreursData, medsData] = await Promise.all([
                this.downloadExcel(FILES.pharmacies, 'pharmacies'),
                this.downloadExcel(FILES.livreurs, 'livreurs'),
                this.downloadExcel(FILES.medicaments, 'medicaments')
            ]);

            // Pharmacies
            if (pharmaData) {
                this.pharmacies = pharmaData;
                this.pharmaciesDeGarde = [];
                this.pharmaciesByQuartier.clear();
                this.pharmaciesById.clear();

                for (const p of this.pharmacies) {
                    const id = p.ID || p.id || `P${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                    this.pharmaciesById.set(id, p);

                    const quartier = p.QUARTIER || p.quartier || p.Quartier || 'Non précisé';
                    if (!this.pharmaciesByQuartier.has(quartier)) {
                        this.pharmaciesByQuartier.set(quartier, []);
                    }
                    this.pharmaciesByQuartier.get(quartier).push(p);

                    const garde = (p.GARDE || p.garde || p.Garde || 'NON').toString().toUpperCase();
                    if (garde === 'OUI' || garde === 'YES' || garde === '1') {
                        this.pharmaciesDeGarde.push(p);
                    }
                }
                console.log(`✅ ${this.pharmacies.length} pharmacies (${this.pharmaciesDeGarde.length} de garde)`);
            }

            // Livreurs
            if (livreursData) {
                this.livreurs = livreursData;
                this.livreursDisponibles = this.livreurs.filter(l => {
                    const enLigne = (l.En_Ligne || l.en_ligne || l.Statut || '').toString().toUpperCase();
                    const disponible = (l.Disponible || l.disponible || '').toString().toUpperCase();
                    return (enLigne === 'OUI' || enLigne === 'YES' || enLigne === '1') &&
                           (disponible === 'OUI' || disponible === 'YES' || disponible === '1');
                });
                console.log(`✅ ${this.livreurs.length} livreurs (${this.livreursDisponibles.length} disponibles)`);
            }

            // Médicaments
            if (medsData) {
                this.medicaments = medsData;
                this.medicamentsByNom.clear();
                for (const m of this.medicaments) {
                    const nom = (m['NOM COMMERCIAL'] || m.nom || m.Nom || '').toLowerCase();
                    if (nom) {
                        this.medicamentsByNom.set(nom, m);
                    }
                }
                console.log(`✅ ${this.medicaments.length} médicaments référencés`);
            }

            this.lastUpdate = Date.now();
            cache.set('master_data', {
                pharmacies: this.pharmacies,
                pharmaciesDeGarde: this.pharmaciesDeGarde,
                pharmaciesByQuartier: this.pharmaciesByQuartier,
                livreurs: this.livreurs,
                livreursDisponibles: this.livreursDisponibles,
                medicaments: this.medicaments,
                lastUpdate: this.lastUpdate
            });

            return true;

        } catch (error) {
            console.error('❌ Erreur chargement:', error);
            stats.errors++;
            return false;
        }
    }

    async downloadExcel(url, type) {
        try {
            const cacheKey = `file_${type}`;
            const cached = fileCache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            console.log(`📥 Téléchargement: ${type}`);
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
            return data;

        } catch (error) {
            console.error(`❌ Erreur téléchargement ${type}:`, error.message);
            stats.errors++;
            return null;
        }
    }

    searchMedicines(term) {
        if (!term) return [];
        const termLower = term.toLowerCase();
        const results = [];
        
        for (const med of this.medicaments) {
            const nom = (med['NOM COMMERCIAL'] || med.nom || med.Nom || '').toLowerCase();
            const dci = (med['DCI'] || med.dci || '').toLowerCase();
            if (nom.includes(termLower) || dci.includes(termLower)) {
                results.push({
                    nom: med['NOM COMMERCIAL'] || med.nom || med.Nom || 'Médicament',
                    dci: med['DCI'] || med.dci || '',
                    prix: med['PRIX'] || med.prix || med.Prix || 0,
                    type: med['TYPE'] || med.type || 'Standard'
                });
            }
            if (results.length >= 10) break;
        }
        return results;
    }

    findPharmaciesByQuartier(quartier) {
        if (!quartier) return this.pharmacies.slice(0, 10);
        const quartierLower = quartier.toLowerCase();
        for (const [key, value] of this.pharmaciesByQuartier) {
            if (key.toLowerCase().includes(quartierLower)) {
                return value;
            }
        }
        return this.pharmacies.slice(0, 10);
    }
}

// ============ GESTIONNAIRE DE COMMANDES ============
class OrderManager {
    constructor() {
        this.orders = new Map();
        this.counter = 0;
    }

    generateOrderId() {
        this.counter++;
        const date = new Date();
        const y = date.getFullYear().toString().slice(-2);
        const m = (date.getMonth() + 1).toString().padStart(2, '0');
        const d = date.getDate().toString().padStart(2, '0');
        return `CMD${y}${m}${d}${this.counter.toString().padStart(4, '0')}`;
    }

    createOrder(data) {
        const orderId = this.generateOrderId();
        const order = {
            id: orderId,
            ...data,
            status: 'EN_ATTENTE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.orders.set(orderId, order);
        
        if (this.orders.size > 1000) {
            const keys = Array.from(this.orders.keys()).slice(0, 500);
            keys.forEach(k => this.orders.delete(k));
        }
        return order;
    }

    getOrder(orderId) {
        return this.orders.get(orderId);
    }

    updateOrder(orderId, updates) {
        const order = this.orders.get(orderId);
        if (order) {
            Object.assign(order, updates, { updatedAt: new Date().toISOString() });
            this.orders.set(orderId, order);
            return true;
        }
        return false;
    }

    addRating(orderId, note, comment) {
        const order = this.orders.get(orderId);
        if (order) {
            order.rating = { note, comment, date: new Date().toISOString() };
            order.status = 'TERMINEE';
            this.orders.set(orderId, order);
            return true;
        }
        return false;
    }
}

// ============ SERVICES ============
class WhatsAppService {
    async sendMessage(to, text) {
        if (!text) return null;
        try {
            stats.whatsappCalls++;
            const response = await axios.post(
                WHATSAPP_API_URL,
                {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: to.replace(/\D/g, ''),
                    type: 'text',
                    text: { body: text.substring(0, 4096) }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );
            return response.data;
        } catch (error) {
            console.error('❌ WhatsApp error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

class GroqService {
    async generateResponse(messages, tools = null) {
        try {
            stats.groqCalls++;
            
            const payload = {
                model: GROQ_MODEL,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.content.substring(0, 2000)
                })),
                temperature: 0.7,
                max_tokens: 800,
                top_p: 0.9
            };

            if (tools) {
                payload.tools = tools;
                payload.tool_choice = 'auto';
            }

            const response = await axios.post(GROQ_API_URL, payload, {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000
            });

            return response.data.choices[0].message;
        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }
}

// ============ INITIALISATION ============
const store = new DataStore();
const orderManager = new OrderManager();
const whatsapp = new WhatsAppService();
const groq = new GroqService();

store.loadAllData().then(success => {
    if (success) console.log('🚀 Mia est prête!');
    else console.warn('⚠️ Mia démarre avec données limitées');
});

setInterval(() => store.loadAllData().catch(console.error), 30 * 60 * 1000);

// ============ OUTILS (FONCTIONS QUE LE LLM PEUT APPELER) ============
const tools = [
    {
        type: 'function',
        function: {
            name: 'search_medicines',
            description: 'Rechercher des médicaments par nom',
            parameters: {
                type: 'object',
                properties: {
                    term: {
                        type: 'string',
                        description: 'Le nom du médicament à rechercher'
                    }
                },
                required: ['term']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_pharmacies_de_garde',
            description: 'Obtenir la liste des pharmacies de garde',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'find_pharmacies_by_quartier',
            description: 'Trouver des pharmacies dans un quartier',
            parameters: {
                type: 'object',
                properties: {
                    quartier: {
                        type: 'string',
                        description: 'Le nom du quartier'
                    }
                },
                required: ['quartier']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_livreurs_disponibles',
            description: 'Obtenir la liste des livreurs disponibles',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_order',
            description: 'Créer une nouvelle commande',
            parameters: {
                type: 'object',
                properties: {
                    nom_client: { type: 'string' },
                    telephone: { type: 'string' },
                    quartier: { type: 'string' },
                    indications: { type: 'string' },
                    medicament: { type: 'string' },
                    pharmacie: { type: 'string' }
                },
                required: ['nom_client', 'quartier', 'medicament']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'track_order',
            description: 'Suivre une commande par son ID',
            parameters: {
                type: 'object',
                properties: {
                    order_id: {
                        type: 'string',
                        description: 'L\'ID de la commande'
                    }
                },
                required: ['order_id']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'rate_order',
            description: 'Donner une note et un avis sur une commande',
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
    }
];

// ============ IMPLÉMENTATION DES OUTILS ============
async function executeToolCall(toolCall) {
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = JSON.parse(args);

    console.log(`🔧 Tool call: ${name}`, parsedArgs);

    switch (name) {
        case 'search_medicines': {
            const results = store.searchMedicines(parsedArgs.term);
            return JSON.stringify(results.slice(0, 5));
        }

        case 'get_pharmacies_de_garde': {
            return JSON.stringify(store.pharmaciesDeGarde.slice(0, 10).map(p => ({
                nom: p.NOM_PHARMACIE || p.nom,
                telephone: p.TELEPHONE || p.telephone,
                quartier: p.QUARTIER || p.quartier,
                adresse: p.ADRESSE || p.adresse
            })));
        }

        case 'find_pharmacies_by_quartier': {
            const pharmacies = store.findPharmaciesByQuartier(parsedArgs.quartier);
            return JSON.stringify(pharmacies.slice(0, 10).map(p => ({
                nom: p.NOM_PHARMACIE || p.nom,
                telephone: p.TELEPHONE || p.telephone,
                quartier: p.QUARTIER || p.quartier,
                adresse: p.ADRESSE || p.adresse,
                garde: (p.GARDE || p.garde) === 'OUI'
            })));
        }

        case 'get_livreurs_disponibles': {
            return JSON.stringify(store.livreursDisponibles.slice(0, 10).map(l => ({
                nom: l.Nom || l.nom,
                telephone: l.Telephone || l.telephone,
                note: l.Note_Moyenne || '4.5'
            })));
        }

        case 'create_order': {
            const order = orderManager.createOrder({
                ...parsedArgs,
                telephone: parsedArgs.telephone || parsedArgs.telephone,
                status: 'EN_ATTENTE_LIVREUR'
            });
            
            // Assigner un livreur si disponible
            if (store.livreursDisponibles.length > 0) {
                const livreur = store.livreursDisponibles[0];
                order.livreur = {
                    nom: livreur.Nom || livreur.nom,
                    telephone: livreur.Telephone || livreur.telephone
                };
                order.status = 'LIVREUR_ASSIGNE';
                orderManager.updateOrder(order.id, { status: 'LIVREUR_ASSIGNE', livreur: order.livreur });
            }
            
            return JSON.stringify(order);
        }

        case 'track_order': {
            const order = orderManager.getOrder(parsedArgs.order_id);
            return JSON.stringify(order || { error: 'Commande non trouvée' });
        }

        case 'rate_order': {
            const success = orderManager.addRating(
                parsedArgs.order_id,
                parsedArgs.note,
                parsedArgs.commentaire || ''
            );
            return JSON.stringify({ 
                success, 
                message: success ? 'Merci pour votre avis !' : 'Commande non trouvée' 
            });
        }

        default:
            return JSON.stringify({ error: 'Outil non trouvé' });
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
            await whatsapp.sendMessage(from, "❌ Mia ne comprend que les messages texte. Envoyez votre message.");
            return;
        }

        const userText = message.text.body.trim();
        stats.messagesProcessed++;

        console.log(`📩 [${from.substring(0, 8)}] ${userText.substring(0, 50)}`);

        // === RÉCUPÉRER L'HISTORIQUE DE CONVERSATION ===
        const sessionKey = `conv_${from}`;
        let conversation = sessionCache.get(sessionKey) || [];
        
        // Limiter l'historique aux 10 derniers messages
        if (conversation.length > 20) {
            conversation = conversation.slice(-20);
        }

        // === CONSTRUIRE LE CONTEXTE POUR LE LLM ===
        const systemPrompt = `Tu es Mia, l'assistante santé officielle de San Pedro, Côte d'Ivoire.

INFORMATIONS DISPONIBLES:
- ${store.pharmacies.length} pharmacies à San Pedro
- ${store.pharmaciesDeGarde.length} pharmacies de garde actuellement
- ${store.livreurs.length} livreurs partenaires
- ${store.medicaments.length} médicaments référencés

TON RÔLE:
1. Tu dialogues naturellement avec les utilisateurs en français
2. Tu les aides à trouver des médicaments
3. Tu les informes sur les pharmacies de garde
4. Tu gères les commandes et les livreurs
5. Tu prends les avis après livraison

RÈGLES CONVERSATIONNELLES:
- Sois chaleureuse et professionnelle
- Utilise des émojis adaptés 🩺💊🛵
- Demande les informations nécessaires une par une
- Confirme toujours les commandes
- Propose de l'aide si l'utilisateur semble perdu

COMMANDES:
Quand un utilisateur veut commander:
1. Demande le médicament exact
2. Demande le quartier de livraison
3. Demande son nom
4. Demande un point de repère
5. Confirme et crée la commande (utilise create_order)

AVIS:
Après livraison, demande une note (1-5) et un commentaire

Utilise les outils à ta disposition pour obtenir des informations précises.`;

        // === PRÉPARER LES MESSAGES POUR GROQ ===
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversation.map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            { role: 'user', content: userText }
        ];

        // === APPEL À GROQ AVEC OUTILS ===
        let response = await groq.generateResponse(messages, tools);

        // === GESTION DES APPELS D'OUTILS ===
        if (response?.tool_calls) {
            const toolResponses = [];
            
            for (const toolCall of response.tool_calls) {
                const toolResult = await executeToolCall(toolCall);
                toolResponses.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolResult
                });
            }

            // Deuxième appel avec les résultats des outils
            messages.push(response);
            messages.push(...toolResponses);
            
            const finalResponse = await groq.generateResponse(messages);
            response = finalResponse;
        }

        // === SAUVEGARDER LA CONVERSATION ===
        if (response?.content) {
            conversation.push(
                { role: 'user', content: userText },
                { role: 'assistant', content: response.content }
            );
            sessionCache.set(sessionKey, conversation);

            // === ENVOYER LA RÉPONSE ===
            await whatsapp.sendMessage(from, response.content);
            stats.commandsExecuted++;
        } else {
            await whatsapp.sendMessage(from, "❌ Désolé, je n'ai pas pu traiter votre demande. Veuillez réessayer.");
        }

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ ENDPOINTS ============
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - San Pedro',
        version: '4.0.0',
        status: 'online',
        stats: {
            messages: stats.messagesProcessed,
            commands: stats.commandsExecuted,
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
                lastUpdate: new Date(store.lastUpdate).toISOString()
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
    ║   LLM: ${GROQ_MODEL}                    ║
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
