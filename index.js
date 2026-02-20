// ===================================================
// MIA - Assistant Santé Conversationnel San Pedro 🇨🇮
// Version Production - 100% LLM - Optimisé Render
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

// ============ CONSTANTES ============
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq AI
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama3-70b-8192';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Support
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250708091011';

// ============ URLs CLOUDINARY (FICHIERS RÉELS) ============
const CLOUDINARY_URLS = {
    pharmacie: 'https://res.cloudinary.com/dwq4ituxr/raw/upload/v1771626176/Pharmacies_San_Pedro_n1rvcs.xlsx',
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
    errors: 0,
    startTime: Date.now()
};

// ============ CLIENT CLOUDINARY ============
class CloudinaryClient {
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

// ============ STORE DE DONNÉES ============
class DataStore {
    constructor() {
        this.cloudinary = new CloudinaryClient();
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
            console.log('📥 Chargement des données Cloudinary...');

            const [pharmaData, livreursData, medsData] = await Promise.all([
                this.cloudinary.downloadFile(CLOUDINARY_URLS.pharmacie, 'pharmacies.xlsx'),
                this.cloudinary.downloadFile(CLOUDINARY_URLS.livreurs, 'livreurs.xlsx'),
                this.cloudinary.downloadFile(CLOUDINARY_URLS.medicaments, 'medicaments.xlsx')
            ]);

            if (pharmaData) {
                this.pharmacies = pharmaData;
                this.pharmaciesDeGarde = [];
                this.pharmaciesByQuartier.clear();

                for (const p of this.pharmacies) {
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
                console.log(`✅ ${this.pharmacies.length} pharmacies (${this.pharmaciesDeGarde.length} de garde)`);
            }

            if (livreursData) {
                this.livreurs = livreursData;
                this.livreursDisponibles = this.livreurs.filter(l => {
                    const enLigne = (l.En_Ligne || l.en_ligne || 'NON').toString().toUpperCase() === 'OUI';
                    const disponible = (l.Disponible || l.disponible || 'NON').toString().toUpperCase() === 'OUI';
                    return enLigne && disponible;
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

    searchMedicines(term) {
        if (!this.medicaments.length) return [];
        
        const terms = term.toLowerCase().split(' ').filter(t => t.length > 1);
        return this.medicaments
            .filter(med => {
                const nom = (med['NOM COMMERCIAL'] || med.nom || '').toLowerCase();
                const dci = (med['DCI'] || med.dci || '').toLowerCase();
                const text = `${nom} ${dci}`;
                return terms.some(t => text.includes(t));
            })
            .slice(0, 10);
    }

    findPharmacies(quartier = null, gardeOnly = false) {
        let result = gardeOnly && this.pharmaciesDeGarde.length > 0 
            ? [...this.pharmaciesDeGarde]
            : [...this.pharmacies];

        if (quartier && this.pharmaciesByQuartier.has(quartier)) {
            result = this.pharmaciesByQuartier.get(quartier);
        }

        return result.slice(0, 15);
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
    constructor() {
        this.orders = new Map();
        this.counter = 0;
    }

    generateId() {
        this.counter++;
        const d = new Date();
        return `CMD${d.getFullYear().toString().slice(-2)}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}${this.counter.toString().padStart(4,'0')}`;
    }

    createOrder(data) {
        const id = this.generateId();
        const order = {
            id,
            ...data,
            status: 'EN_ATTENTE',
            date: new Date().toISOString(),
            avis: null
        };
        this.orders.set(id, order);
        
        if (this.orders.size > 500) {
            const keys = Array.from(this.orders.keys()).slice(0, this.orders.size - 500);
            keys.forEach(k => this.orders.delete(k));
        }
        
        return order;
    }

    getOrder(id) {
        return this.orders.get(id);
    }

    updateOrder(id, updates) {
        const order = this.orders.get(id);
        if (order) {
            Object.assign(order, updates);
            this.orders.set(id, order);
            return true;
        }
        return false;
    }

    addAvis(id, note, commentaire) {
        return this.updateOrder(id, { avis: { note, commentaire, date: new Date().toISOString() } });
    }
}

// ============ GESTIONNAIRE DE SESSIONS ============
class SessionManager {
    get(userId) {
        const key = `session_${userId}`;
        let session = sessionCache.get(key);
        if (!session) {
            session = {
                step: 'conversation',
                context: {},
                lastActivity: Date.now(),
                messageCount: 0
            };
            sessionCache.set(key, session);
        }
        session.lastActivity = Date.now();
        session.messageCount++;
        return session;
    }

    set(userId, data) {
        const key = `session_${userId}`;
        const session = this.get(userId);
        Object.assign(session, data);
        sessionCache.set(key, session);
    }

    updateContext(userId, newContext) {
        const session = this.get(userId);
        session.context = { ...session.context, ...newContext };
        sessionCache.set(`session_${userId}`, session);
    }

    clear(userId) {
        sessionCache.del(`session_${userId}`);
    }
}

// ============ SERVICES EXTERNES ============
class WhatsAppService {
    async send(to, text) {
        if (!text) return null;
        try {
            stats.whatsappCalls++;
            const response = await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to.replace(/\D/g, ''),
                type: 'text',
                text: { body: text.substring(0, 4096) }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
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

class GroqService {
    async generate(systemPrompt, userMessage, context = {}) {
        try {
            stats.groqCalls++;
            
            const messages = [
                { role: 'system', content: systemPrompt },
                ...(context.history || []).slice(-5).map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                { role: 'user', content: userMessage }
            ];

            const response = await axios.post(GROQ_API_URL, {
                model: GROQ_MODEL,
                messages,
                temperature: 0.7,
                max_tokens: 500,
                top_p: 0.9
            }, {
                headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
                timeout: 5000
            });

            return response.data.choices[0]?.message?.content || '';

        } catch (error) {
            console.error('❌ Groq error:', error.response?.data || error.message);
            stats.errors++;
            return null;
        }
    }

    async extractIntent(text) {
        const prompt = `Analyse ce message et retourne UNIQUEMENT un objet JSON avec:
        - intent: "ACHAT" | "GARDE" | "SUIVI" | "LIVREURS" | "AUTRE"
        - medicament: nom du médicament si intent=ACHAT, sinon null
        - quartier: quartier mentionné ou null
        - confiance: 0-1
        
        Message: "${text}"`;
        
        try {
            const response = await this.generate('Tu es un extracteur d'intention.', prompt);
            const jsonMatch = response.match(/\{.*\}/s);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } catch (e) {}
        
        return { intent: 'AUTRE', medicament: null, quartier: null, confiance: 0.5 };
    }
}

// ============ INITIALISATION ============
const store = new DataStore();
const orders = new OrderManager();
const sessions = new SessionManager();
const whatsapp = new WhatsAppService();
const groq = new GroqService();

// Chargement initial
store.loadAllData().then(success => {
    if (success) console.log('🚀 Mia est prête!');
    else console.warn('⚠️ Mia démarre sans données');
});

// Rafraîchissement
setInterval(() => store.loadAllData().catch(console.error), 30 * 60 * 1000);

// ============ SYSTÈME PROMPT PRINCIPAL ============
const BASE_SYSTEM_PROMPT = `Tu es MIA, assistante santé conversationnelle pour San Pedro, Côte d'Ivoire.

CONTEXTE ACTUEL:
- Pharmacies: {{pharmaciesCount}} (dont {{gardesCount}} de garde aujourd'hui)
- Livreurs: {{livreursCount}} ({{disponiblesCount}} disponibles)
- Médicaments référencés: {{medicamentsCount}}

INSTRUCTIONS:
1. Sois naturelle, chaleureuse et conversationnelle en français ivoirien
2. Aide à acheter des médicaments, trouver pharmacies de garde, suivre commandes
3. Pour un achat: demande le médicament, le quartier, puis les infos (nom, WhatsApp, quartier, indications)
4. Après livraison, demande un avis (note/commentaire)
5. Utilise les données fournies pour être précise
6. Si tu ne sais pas, propose d'appeler le support au {{support}}

RÉPONDS comme une vraie personne, pas comme un robot.`;

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

        const msg = change.value?.messages?.[0];
        if (!msg) return;

        const from = msg.from;
        const msgId = msg.id;

        if (processedMessages.has(msgId)) return;
        processedMessages.set(msgId, true);

        if (msg.type !== 'text') {
            await whatsapp.send(from, "Je ne comprends que les messages texte. Envoie-moi un message 😊");
            return;
        }

        const text = msg.text.body.trim();
        stats.messagesProcessed++;

        console.log(`📩 [${from.slice(-8)}] ${text.slice(0, 50)}`);

        // Traitement conversationnel
        await processConversation(from, text);

    } catch (error) {
        console.error('❌ Webhook error:', error);
        stats.errors++;
    }
});

// ============ MOTEUR CONVERSATIONNEL PRINCIPAL ============
async function processConversation(userId, text) {
    const session = sessions.get(userId);
    const lowerText = text.toLowerCase();

    try {
        // Construire le contexte pour l'IA
        const contextData = {
            pharmaciesCount: store.pharmacies.length,
            gardesCount: store.pharmaciesDeGarde.length,
            livreursCount: store.livreurs.length,
            disponiblesCount: store.livreursDisponibles.length,
            medicamentsCount: store.medicaments.length,
            support: SUPPORT_PHONE
        };

        // Remplacer les variables dans le prompt
        let systemPrompt = BASE_SYSTEM_PROMPT;
        for (const [key, value] of Object.entries(contextData)) {
            systemPrompt = systemPrompt.replace(`{{${key}}}`, value);
        }

        // Ajouter les données pertinentes si nécessaire
        if (text.toLowerCase().includes('médicament') || text.toLowerCase().includes('acheter')) {
            const intent = await groq.extractIntent(text);
            if (intent.medicament) {
                const meds = store.searchMedicines(intent.medicament);
                if (meds.length > 0) {
                    systemPrompt += `\n\nMédicaments trouvés pour "${intent.medicament}":\n`;
                    meds.slice(0, 5).forEach((m, i) => {
                        systemPrompt += `${i+1}. ${m['NOM COMMERCIAL'] || m.nom} - ${m['PRIX'] || m.prix || '?'} FCFA\n`;
                    });
                }
            }
        }

        // Ajouter l'historique
        const history = session.context.history || [];
        
        // Appeler Groq
        const response = await groq.generate(systemPrompt, text, { history });

        if (response) {
            // Sauvegarder dans l'historique
            history.push({ role: 'user', content: text });
            history.push({ role: 'assistant', content: response });
            sessions.updateContext(userId, { history: history.slice(-10) });

            // Détecter les intentions d'achat
            if (response.toLowerCase().includes('commande') || response.toLowerCase().includes('enregistrée')) {
                // Essayer d'extraire les infos de commande
                const orderMatch = response.match(/commande[:\s]*([A-Z0-9]+)/i);
                if (orderMatch) {
                    const orderId = orderMatch[1];
                    const existing = orders.getOrder(orderId);
                    if (!existing) {
                        // Créer une commande
                        orders.createOrder({
                            userId,
                            text: text,
                            status: 'EN_COURS',
                            date: new Date().toISOString()
                        });
                    }
                }
            }

            // Détecter les avis
            if (response.toLowerCase().includes('avis') || response.toLowerCase().includes('note')) {
                const noteMatch = response.match(/(\d+)\s*[\/\s]*5/);
                if (noteMatch) {
                    const note = parseInt(noteMatch[1]);
                    const orderId = session.context.lastOrderId;
                    if (orderId) {
                        orders.addAvis(orderId, note, text);
                    }
                }
            }

            await whatsapp.send(userId, response);
            stats.commandsExecuted++;
        } else {
            await whatsapp.send(userId, "Désolé, je rencontre une difficulté technique. Réessaie ou contacte le support au " + SUPPORT_PHONE);
        }

    } catch (error) {
        console.error('❌ Conversation error:', error);
        stats.errors++;
        await whatsapp.send(userId, "Oups! Une erreur s'est produite. Le support va être notifié.");
    }
}

// ============ ENDPOINTS DE MONITORING ============
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - San Pedro',
        version: '4.0.0',
        status: 'online',
        conversationnel: true,
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
            calls: {
                groq: stats.groqCalls,
                whatsapp: stats.whatsappCalls,
                cloudinary: stats.cloudinaryCalls
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
        data: {
            pharmacies: store.pharmacies.length,
            gardes: store.pharmaciesDeGarde.length,
            livreurs: store.livreurs.length,
            disponibles: store.livreursDisponibles.length,
            medicaments: store.medicaments.length,
            lastUpdate: store.lastUpdate
        },
        cache: {
            sessions: sessionCache.keys().length,
            files: fileCache.keys().length,
            general: cache.keys().length
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
    ║   Version 4.0 - 100% Conversationnel  ║
    ║   Environnement: ${NODE_ENV.padEnd(15)}       ║
    ║   Modèle IA: ${GROQ_MODEL.slice(0, 20)}     ║
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
