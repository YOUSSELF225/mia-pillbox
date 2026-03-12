// ==================== MARIAM - BOT WHATSAPP 🇨🇮 ====================
// Auteur: Youssef - Université Polytechnique de San Pedro (Licence 2, 2026)
// Description: Bot WhatsApp santé pour San Pedro avec Groq, PostgreSQL
// Style: PayParrot - Conversations naturelles et courtes
// Version: 9.0.0 - Production Finale - 2 Modèles

// ==================== IMPORTS ====================
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const Groq = require('groq-sdk');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const Fuse = require('fuse.js');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');

// ==================== CONSTANTES ====================
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const IS_PRODUCTION = NODE_ENV === 'production';

// WhatsApp API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq API
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // Modèle 1: Vision + Extraction
const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"; // Modèle 2: Chat + Réponses

// Tarifs livraison
const DELIVERY_PRICES = {
    NIGHT: { startHour: 0, endHour: 7, price: 600 },
    DAY: { startHour: 8, endHour: 23, price: 400 }
};

// Frais de service
const SERVICE_FEE = 500;

// Contacts
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';
const SUPPORT_WHATSAPP = '2250701406880';

// Configuration pool DB
const POOL_CONFIG = {
    max: IS_PRODUCTION ? 50 : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    maxUses: 7500
};

// TTL cache
const CACHE_TTL = {
    MEDICAMENTS: 86400,
    CONVERSATIONS: 3600,
    SEARCH: 1800
};

// ==================== LOGGER ====================
const logLevels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

const logger = winston.createLogger({
    levels: logLevels,
    level: IS_PRODUCTION ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'mariam-bot' },
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error', maxsize: 5242880, maxFiles: 5 }),
        new winston.transports.File({ filename: 'combined.log', maxsize: 5242880, maxFiles: 5 })
    ]
});

if (!IS_PRODUCTION) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

function log(level, message, data = null) {
    const icons = { 
        INFO: '📘', SUCCESS: '✅', ERROR: '❌', USER: '👤', BOT: '🤖', 
        GROQ: '🔥', WEBHOOK: '📨', CACHE: '📦', DB: '💾', ORDER: '📦', 
        SEARCH: '🔍', LIVREUR: '🛵', WARN: '⚠️', URGENT: '🚨', BUTTON: '🔘',
        DEBUG: '🐛', INTENT: '🎯', VISION: '👁️', CHAT: '💬'
    };
    
    const winstonLevel = {
        'ERROR': 'error', 'WARN': 'warn', 'SUCCESS': 'info', 
        'INFO': 'info', 'DEBUG': 'debug'
    }[level] || 'info';
    
    logger.log(winstonLevel, `${icons[level] || '📌'} ${message}`, { data, worker: process.pid });
    
    if (!IS_PRODUCTION) {
        const colors = {
            ERROR: '\x1b[31m', SUCCESS: '\x1b[32m', WARN: '\x1b[33m',
            INFO: '\x1b[36m', DEBUG: '\x1b[90m', INTENT: '\x1b[35m',
            VISION: '\x1b[33m', CHAT: '\x1b[34m'
        };
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        const color = colors[level] || '\x1b[0m';
        console.log(`\x1b[90m[${timestamp}]\x1b[0m ${color}${icons[level] || '📌'} ${message}\x1b[0m`, data ? data : '');
    }
}

// ==================== CLUSTERING ====================
const numCPUs = IS_PRODUCTION ? Math.min(os.cpus().length, 2) : 1;

if (cluster.isPrimary && IS_PRODUCTION) {
    log('INFO', `🚀 Master PID ${process.pid} - Lancement de ${numCPUs} workers...`);
    for (let i = 0; i < numCPUs; i++) cluster.fork();
    
    cluster.on('exit', (worker) => {
        log('ERROR', `Worker ${worker.id} mort. Redémarrage...`);
        cluster.fork();
    });
    
    module.exports = (req, res) => {
        res.status(200).json({ status: 'master', workers: numCPUs });
    };
    
} else {
    // ==================== EXPRESS ====================
    const app = express();
    
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
    app.use(compression({ level: 9 }));
    app.use(express.json({ limit: '5mb' }));
    app.use(express.urlencoded({ extended: true, limit: '5mb' }));
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    
    app.use(morgan('combined', {
        stream: { write: message => logger.info(message.trim()) },
        skip: (req) => req.path === '/health'
    }));
    
    const webhookLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: IS_PRODUCTION ? 300 : 1000,
        keyGenerator: (req) => req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip
    });
    
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: IS_PRODUCTION ? 100 : 500
    });
    
    app.use('/webhook', webhookLimiter);
    app.use('/api/', apiLimiter);

    // ==================== CACHES ====================
    const memoryCache = new NodeCache({ stdTTL: 300, checkperiod: 60, maxKeys: 50000 });
    const processedMessages = new NodeCache({ stdTTL: 300, maxKeys: 50000 });

    // ==================== STATISTIQUES ====================
    const stats = {
        messagesProcessed: 0, cacheHits: 0, cacheMisses: 0,
        groqCalls: 0, groqVision: 0, groqChat: 0,
        errors: 0, ordersCreated: 0, startTime: Date.now(),
        activeUsersSet: new Set(), workerId: cluster.worker?.id || 0
    };

    // ==================== RATE LIMIT UTILISATEUR ====================
    const userRateLimit = new Map();

    function checkUserRateLimit(phone) {
        const now = Date.now();
        const userLimits = userRateLimit.get(phone) || { count: 0, resetTime: now + 60000 };
        
        if (now > userLimits.resetTime) {
            userLimits.count = 1;
            userLimits.resetTime = now + 60000;
        } else {
            userLimits.count++;
        }
        
        userRateLimit.set(phone, userLimits);
        return userLimits.count <= 30;
    }

    // ==================== BASE DE DONNÉES ====================
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: IS_PRODUCTION ? { rejectUnauthorized: false } : false,
        ...POOL_CONFIG
    });

    pool.on('error', (err) => {
        log('ERROR', 'Erreur pool PostgreSQL:', err);
        stats.errors++;
    });

    // ==================== FILES D'ATTENTE MÉMOIRE ====================
    class MemoryQueue {
        constructor(name) {
            this.name = name;
            this.jobs = [];
            log('INFO', `Queue ${name} créée`);
        }
        
        async add(type, data) {
            const job = { id: Date.now() + Math.random(), type, data };
            this.jobs.push(job);
            setImmediate(() => this.processJob(job));
            return job;
        }
        
        async processJob(job) {
            try {
                if (job.type === 'text-message') {
                    await conversationEngine?.process(job.data.from, job.data.text);
                } else if (job.type === 'image-message') {
                    await conversationEngine?.process(job.data.from, null, job.data.mediaId);
                } else if (job.type === 'order-notification') {
                    await this.sendOrderNotification(job.data);
                } else if (job.type === 'notify-livreurs') {
                    await this.notifyLivreur(job.data);
                }
            } catch (error) {
                log('ERROR', `Erreur queue ${this.name}:`, error);
            }
        }
        
        async sendOrderNotification(data) {
            const { order } = data;
            const items = order.items.map(i => `   • ${i.quantite}x ${i.nom_commercial}`).join('\n');
            const message = 
                `📦 *NOUVELLE COMMANDE*\nID: ${order.id}\nCode: ${order.confirmation_code}\n\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 ${order.client_name}\n` +
                `🎂 ${order.patient_age} ans\n⚖️ ${order.patient_poids}kg · 📏 ${order.patient_taille}cm\n` +
                `📞 ${order.client_phone}\n📍 ${order.client_quartier}, San Pedro\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n📦 *Articles:*\n${items}\n\n💰 *Total: ${order.total} FCFA*`;
            await whatsappService.sendUrgentMessage(SUPPORT_PHONE, message);
        }
        
        async notifyLivreur(data) {
            const { order } = data;
            try {
                const livreurResult = await pool.query('SELECT * FROM livreurs WHERE disponible = true LIMIT 1');
                if (livreurResult.rows.length === 0) {
                    log('ERROR', '❌ Aucun livreur disponible');
                    return;
                }
                const livreur = livreurResult.rows[0];
                const items = order.items.map(i => `   • ${i.quantite}x ${i.nom_commercial}`).join('\n');
                const message = 
                    `🛵 *NOUVELLE LIVRAISON*\nID: ${order.id}\n\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n👤 ${order.client_name}\n` +
                    `📞 ${order.client_phone}\n📍 ${order.client_quartier}, San Pedro\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n\n📦 *Articles:*\n${items}\n\n💰 *À encaisser: ${order.total} FCFA*`;
                await whatsappService.sendUrgentMessage(livreur.whatsapp || livreur.telephone, message);
                await orderService.updateOrder(order.id, { livreur_phone: livreur.telephone, status: 'ASSIGNED' });
                await pool.query('UPDATE livreurs SET commandes_livrees = commandes_livrees + 1 WHERE id_livreur = $1', [livreur.id_livreur]);
                log('SUCCESS', `✅ Commande ${order.id} assignée à ${livreur.nom}`);
            } catch (error) {
                log('ERROR', 'Erreur notification livreur:', error);
            }
        }
        
        async close() { this.jobs = []; }
    }

    const messageQueue = new MemoryQueue('message');
    const notificationQueue = new MemoryQueue('notification');

    // ==================== ÉTATS DE CONVERSATION ====================
    const ConversationStates = {
        IDLE: 'IDLE',
        WAITING_MEDICINE: 'WAITING_MEDICINE',
        SELECTING_MEDICINE: 'SELECTING_MEDICINE',
        WAITING_QUANTITY: 'WAITING_QUANTITY',
        WAITING_QUARTIER: 'WAITING_QUARTIER',
        WAITING_VILLE: 'WAITING_VILLE',
        WAITING_NAME: 'WAITING_NAME',
        WAITING_PATIENT_AGE: 'WAITING_PATIENT_AGE',
        WAITING_PATIENT_GENRE: 'WAITING_PATIENT_GENRE',
        WAITING_PATIENT_POIDS: 'WAITING_PATIENT_POIDS',
        WAITING_PATIENT_TAILLE: 'WAITING_PATIENT_TAILLE',
        WAITING_PHONE: 'WAITING_PHONE',
        WAITING_INDICATIONS: 'WAITING_INDICATIONS',
        WAITING_CONFIRMATION: 'WAITING_CONFIRMATION'
    };

    // ==================== UTILITAIRES ====================
    class Utils {
        static cleanText(text) { return text?.replace(/\s+/g, ' ').trim() || ''; }
        
        static getCurrentDeliveryPrice() {
            const hour = new Date().getHours();
            return hour >= DELIVERY_PRICES.NIGHT.startHour && hour < DELIVERY_PRICES.NIGHT.endHour
                ? { price: DELIVERY_PRICES.NIGHT.price, period: 'NIGHT' }
                : { price: DELIVERY_PRICES.DAY.price, period: 'DAY' };
        }

        static extractNumber(text) {
            const match = text?.match(/\d+/);
            return match ? parseInt(match[0]) : null;
        }

        static formatPhoneNumber(phone) { return phone?.replace(/\D/g, '') || ''; }

        static validatePhone(phone) {
            if (!phone) return false;
            const clean = this.formatPhoneNumber(phone);
            return (clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean)) ||
                   (clean.length === 12 && clean.startsWith('225') && /^(07|01|05)\d{8}$/.test(clean.substring(3)));
        }

        static cleanPhone(phone) {
            const clean = this.formatPhoneNumber(phone);
            return clean.length === 12 && clean.startsWith('225') ? clean.substring(3) : clean;
        }

        static generateId(prefix) {
            const date = new Date();
            return `${prefix}${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
        }

        static generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

        static async cacheGet(key) {
            const val = memoryCache.get(key);
            if (val) { stats.cacheHits++; return val; }
            stats.cacheMisses++;
            return null;
        }

        static async cacheSet(key, value, ttl = 300) { memoryCache.set(key, value, ttl); }

        static getEstimatedDeliveryTime() {
            const date = new Date(Date.now() + 30 * 60000);
            return `${date.getHours()}h${date.getMinutes().toString().padStart(2,'0')}`;
        }
    }

    // ==================== SERVICE DE RECHERCHE ====================
    class SearchService {
        constructor(pool) {
            this.pool = pool;
            this.fuseIndex = null;
            this.medicamentsList = [];
            this.lastUpdate = 0;
            this.cache = new NodeCache({ stdTTL: 1800 });
        }

        async initFuseIndex() {
            try {
                const result = await this.pool.query(
                    'SELECT code_produit, nom_commercial, dci, prix::float FROM medicaments'
                );
                this.medicamentsList = result.rows;
                this.fuseIndex = new Fuse(this.medicamentsList, {
                    keys: [{ name: 'nom_commercial', weight: 0.7 }, { name: 'dci', weight: 0.3 }],
                    threshold: 0.4, distance: 100, minMatchCharLength: 2,
                    shouldSort: true, ignoreLocation: true
                });
                this.lastUpdate = Date.now();
                log('SUCCESS', `✅ Index FUSE créé avec ${this.medicamentsList.length} médicaments`);
            } catch (error) {
                log('ERROR', '❌ Erreur création index FUSE:', error);
            }
        }

        async search(query, limit = 5) {
            if (!query || query.length < 2) return [];
            
            const cleanQuery = query.toLowerCase().trim();
            const cacheKey = `search:${cleanQuery}`;
            
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;

            try {
                if (!this.fuseIndex || Date.now() - this.lastUpdate > 3600000) await this.initFuseIndex();

                // Recherche exacte
                let results = this.medicamentsList.filter(m => 
                    m.nom_commercial.toLowerCase() === cleanQuery
                );
                
                // Commence par
                if (results.length === 0) {
                    results = this.medicamentsList.filter(m => 
                        m.nom_commercial.toLowerCase().startsWith(cleanQuery)
                    );
                }
                
                // Recherche floue
                if (results.length === 0 && this.fuseIndex) {
                    results = this.fuseIndex.search(cleanQuery).slice(0, limit).map(r => r.item);
                }

                if (results.length > 0) {
                    this.cache.set(cacheKey, results);
                }

                return results.slice(0, limit);

            } catch (error) {
                log('ERROR', 'Erreur recherche:', error);
                return [];
            }
        }

        async getMedicineByCode(code) {
            try {
                const result = await this.pool.query('SELECT * FROM medicaments WHERE code_produit = $1', [code]);
                return result.rows[0];
            } catch (error) {
                log('ERROR', 'Erreur getMedicineByCode:', error);
                return null;
            }
        }
    }

    // ==================== SERVICE DE COMMANDES ====================
    class OrderService {
        constructor(pool, whatsappService) {
            this.pool = pool;
            this.whatsapp = whatsappService;
        }

        async createOrder(data, userPhone) {
            const client = await this.pool.connect();
            try {
                const orderId = Utils.generateId('CMD');
                const code = Utils.generateCode();
                const subtotal = data.items.reduce((sum, item) => sum + (item.prix * (item.quantite || 1)), 0);
                const deliveryPrice = Utils.getCurrentDeliveryPrice().price;
                const total = subtotal + deliveryPrice + SERVICE_FEE;

                const order = {
                    id: orderId, 
                    client_name: data.client.nom, 
                    client_phone: data.client.telephone || userPhone,
                    client_quartier: data.client.quartier, 
                    client_ville: 'San Pedro',
                    client_indications: data.client.indications || '',
                    patient_age: data.client.patient_age, 
                    patient_genre: data.client.patient_genre,
                    patient_poids: data.client.patient_poids, 
                    patient_taille: data.client.patient_taille,
                    items: data.items, 
                    subtotal, 
                    delivery_price: deliveryPrice,
                    service_fee: SERVICE_FEE, 
                    total, 
                    status: 'PENDING', 
                    confirmation_code: code,
                    delivery_period: Utils.getCurrentDeliveryPrice().period
                };

                await client.query('BEGIN');
                await client.query(`
                    INSERT INTO orders (
                        id, client_name, client_phone, client_quartier, client_ville, client_indications,
                        patient_age, patient_genre, patient_poids, patient_taille,
                        items, subtotal, delivery_price, service_fee, total, confirmation_code, status, delivery_period
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
                `, [
                    order.id, order.client_name, order.client_phone, order.client_quartier, order.client_ville,
                    order.client_indications, order.patient_age, order.patient_genre,
                    order.patient_poids, order.patient_taille, JSON.stringify(order.items),
                    order.subtotal, order.delivery_price, order.service_fee,
                    order.total, order.confirmation_code, order.status, order.delivery_period
                ]);
                await client.query('COMMIT');

                log('DB', `✅ Commande ${order.id} enregistrée`);
                stats.ordersCreated++;
                notificationQueue.add('order-notification', { order });
                notificationQueue.add('notify-livreurs', { order });
                return order;

            } catch (error) {
                await client.query('ROLLBACK');
                log('ERROR', 'Erreur création commande:', error);
                throw error;
            } finally {
                client.release();
            }
        }

        async getOrderById(orderId) {
            try {
                const result = await this.pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
                if (result.rows.length === 0) return null;
                const order = result.rows[0];
                order.items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
                return order;
            } catch (error) {
                log('ERROR', 'Erreur getOrderById:', error);
                return null;
            }
        }

        async updateOrder(orderId, data) {
            try {
                const updates = [];
                const values = [];
                let i = 1;
                if (data.status) { updates.push(`status = $${i++}`); values.push(data.status); }
                if (data.livreur_phone) { updates.push(`livreur_phone = $${i++}`); values.push(data.livreur_phone); }
                updates.push(`updated_at = NOW()`);
                const result = await this.pool.query(
                    `UPDATE orders SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
                    [...values, orderId]
                );
                return result.rows[0];
            } catch (error) {
                log('ERROR', 'Erreur updateOrder:', error);
                return null;
            }
        }
    }

    // ==================== WHATSAPP SERVICE ====================
    class WhatsAppService {
        constructor() {
            this.apiUrl = WHATSAPP_API_URL;
            this.token = WHATSAPP_TOKEN;
        }

        async sendMessage(to, text) {
            if (!text || !to) return;
            try {
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp', to: Utils.formatPhoneNumber(to),
                    type: 'text', text: { body: text.substring(0, 4096) }
                }, { headers: { 'Authorization': `Bearer ${this.token}` }, timeout: 5000 });
                log('BOT', `📤 Message envoyé à ${to}`);
                return true;
            } catch (error) {
                log('ERROR', `❌ Erreur envoi: ${error.message}`);
                stats.errors++;
                return false;
            }
        }

        async sendUrgentMessage(to, text) {
            return this.sendMessage(to, text);
        }

        async sendInteractiveButtons(to, text, buttons) {
            if (!text || !to || !buttons?.length) return false;
            try {
                const maxButtons = buttons.slice(0, 3);
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp', recipient_type: 'individual',
                    to: Utils.formatPhoneNumber(to), type: 'interactive',
                    interactive: {
                        type: 'button', body: { text: text.substring(0, 1024) },
                        action: {
                            buttons: maxButtons.map((btn, idx) => ({
                                type: 'reply',
                                reply: { id: `btn_${Date.now()}_${idx}`, title: btn.substring(0, 20) }
                            }))
                        }
                    }
                }, { headers: { 'Authorization': `Bearer ${this.token}` }, timeout: 5000 });
                log('BUTTON', `✅ Boutons envoyés: ${maxButtons.join(' | ')}`);
                return true;
            } catch (error) {
                log('ERROR', `❌ Erreur boutons: ${error.message}`);
                return false;
            }
        }

        async markAsRead(messageId) {
            try {
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp', status: 'read', message_id: messageId
                }, { headers: { 'Authorization': `Bearer ${this.token}` }, timeout: 2000 });
            } catch (error) {}
        }

        async getUserName(phone) {
            try {
                const response = await axios.get(
                    `https://graph.facebook.com/v18.0/${phone}?fields=profile,name`,
                    { headers: { 'Authorization': `Bearer ${this.token}` }, timeout: 2000 }
                );
                return response.data?.profile?.name || response.data?.name || null;
            } catch { return null; }
        }

        async sendTypingIndicator(to) {
            try {
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp',
                    to: Utils.formatPhoneNumber(to),
                    type: 'typing',
                    typing: { action: 'typing' }
                }, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    timeout: 2000
                });
            } catch (error) {}
        }
    }

    // ==================== WHATSAPP MEDIA HANDLER ====================
    class WhatsAppMediaHandler {
        async downloadMedia(mediaId) {
            try {
                const mediaResponse = await axios.get(
                    `https://graph.facebook.com/v18.0/${mediaId}`,
                    { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }, timeout: 5000 }
                );
                const fileResponse = await axios.get(mediaResponse.data.url, {
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                    responseType: 'arraybuffer', timeout: 10000
                });
                return {
                    success: true,
                    buffer: Buffer.from(fileResponse.data),
                    mimeType: mediaResponse.data.mime_type,
                    size: fileResponse.data.length
                };
            } catch (error) {
                log('ERROR', 'Erreur téléchargement média:', error);
                return { success: false, error: error.message };
            }
        }

        isSupportedImage(mimeType) {
            return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType);
        }
    }

    // ==================== MODÈLE 1: LLAMA-4-SCOUT (Vision + Extraction) ====================
    class GroqVisionService {
        constructor() {
            this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
            this.model = GROQ_VISION_MODEL;
        }

        // ✅ Extraction d'intention avec 100+ exemples
        async extractIntent(message, conv = null) {
            if (!this.client) return { intent: 'unknown', entities: {}, confidence: 0 };

            try {
                stats.groqCalls++;
                stats.groqVision++;
                const start = Date.now();

                const prompt = `Tu es MARIAM-INTENT, un extracteur d'intention expert pour assistant santé à San Pedro.

### 🎯 RÔLE
Tu analyses les messages des utilisateurs pour détecter leur intention et extraire TOUTES les entités pertinentes avec une précision absolue.

### 📋 RÈGLES ABSOLUES
- N'invente JAMAIS d'informations
- Extrait UNIQUEMENT ce qui est dans le message
- Si une info n'est pas présente, mets null
- Retourne UNIQUEMENT du JSON valide
- Sois exhaustif dans l'extraction

### 🚨 URGENCE (priorité absolue)
Dès que tu vois ces mots, intention = "emergency"
- "185", "samu", "urgence", "accident", "vomi", "blessé", "saigne", "évanoui", "crise", "ambulance"

### 📚 EXEMPLES D'EXTRACTION (100+ cas)

#### SALUTATIONS (greet)
"Salut" → {"intent":"greet"}
"Bonjour MARIAM" → {"intent":"greet"}
"Coucou" → {"intent":"greet"}
"Hey" → {"intent":"greet"}
"Bonsoir" → {"intent":"greet"}
"Bonne nuit" → {"intent":"greet"}
"Hello" → {"intent":"greet"}
"Cc" → {"intent":"greet"}
"Slt" → {"intent":"greet"}
"Bjr" → {"intent":"greet"}

#### RECHERCHE (search)
"Doliprane" → {"intent":"search", "medicines":["doliprane"]}
"Acfran sirop" → {"intent":"search", "medicines":["acfran sirop"]}
"Amoxicilline" → {"intent":"search", "medicines":["amoxicilline"]}
"Tu as du doliprane ?" → {"intent":"search", "medicines":["doliprane"]}
"Je cherche acfran" → {"intent":"search", "medicines":["acfran"]}
"T'as de l'amoxicilline ?" → {"intent":"search", "medicines":["amoxicilline"]}
"Je voudrais du doliprane" → {"intent":"search", "medicines":["doliprane"]}
"Montre-moi les médicaments" → {"intent":"search"}
"Liste les médicaments" → {"intent":"search"}
"Qu'est-ce que vous avez ?" → {"intent":"search"}

#### PRIX / DISPONIBILITÉ (availability)
"Prix doliprane" → {"intent":"availability", "medicines":["doliprane"], "price_query":"simple"}
"Combien coûte l'acfran ?" → {"intent":"availability", "medicines":["acfran"], "price_query":"simple"}
"Est-ce que l'amoxicilline est disponible ?" → {"intent":"availability", "medicines":["amoxicilline"]}
"C'est combien le doliprane ?" → {"intent":"availability", "medicines":["doliprane"], "price_query":"simple"}
"Le doliprane est en stock ?" → {"intent":"availability", "medicines":["doliprane"]}
"Prix doliprane et amoxicilline" → {"intent":"availability", "medicines":["doliprane","amoxicilline"], "price_query":"comparatif"}
"Tarif acfran" → {"intent":"availability", "medicines":["acfran"], "price_query":"simple"}
"Combien pour doliprane 1000 ?" → {"intent":"availability", "medicines":["doliprane 1000"], "price_query":"simple"}
"Le prix de l'acfran sirop ?" → {"intent":"availability", "medicines":["acfran sirop"], "price_query":"simple"}
"Disponibilité amoxicilline" → {"intent":"availability", "medicines":["amoxicilline"]}

#### COMMANDE (order)
"Je veux 2 doliprane" → {"intent":"order", "medicines":["doliprane"], "quantities":{"doliprane":2}}
"J'aimerais 1 amoxicilline" → {"intent":"order", "medicines":["amoxicilline"], "quantities":{"amoxicilline":1}}
"Prends 3 doliprane pour moi" → {"intent":"order", "medicines":["doliprane"], "quantities":{"doliprane":3}}
"Donne-moi 2 acfran" → {"intent":"order", "medicines":["acfran"], "quantities":{"acfran":2}}
"Je veux 2 doliprane et 1 amoxicilline" → {"intent":"order", "medicines":["doliprane","amoxicilline"], "quantities":{"doliprane":2,"amoxicilline":1}}
"Commande-moi 1 doliprane" → {"intent":"order", "medicines":["doliprane"], "quantities":{"doliprane":1}}
"Achète 2 boîtes de doliprane" → {"intent":"order", "medicines":["doliprane"], "quantities":{"doliprane":2}}
"Je prends 1 amoxicilline" → {"intent":"order", "medicines":["amoxicilline"], "quantities":{"amoxicilline":1}}
"2 doliprane 1000" → {"intent":"order", "medicines":["doliprane 1000"], "quantities":{"doliprane 1000":2}}
"1 acfran sirop" → {"intent":"order", "medicines":["acfran sirop"], "quantities":{"acfran sirop":1}}

#### AJOUT AU PANIER (add_to_cart)
"Ajoute 1 doliprane" → {"intent":"add_to_cart", "medicines":["doliprane"], "quantities":{"doliprane":1}, "cart_action":"add"}
"Mets 2 amoxicilline dans le panier" → {"intent":"add_to_cart", "medicines":["amoxicilline"], "quantities":{"amoxicilline":2}, "cart_action":"add"}
"Ajoute encore 1 doliprane" → {"intent":"add_to_cart", "medicines":["doliprane"], "quantities":{"doliprane":1}, "cart_action":"add"}
"Rajoute 1 acfran" → {"intent":"add_to_cart", "medicines":["acfran"], "quantities":{"acfran":1}, "cart_action":"add"}
"Ajoute 2 doliprane dans mon panier" → {"intent":"add_to_cart", "medicines":["doliprane"], "quantities":{"doliprane":2}, "cart_action":"add"}
"Mets 1 amoxicilline" → {"intent":"add_to_cart", "medicines":["amoxicilline"], "quantities":{"amoxicilline":1}, "cart_action":"add"}

#### VOIR PANIER (view_cart)
"Mon panier" → {"intent":"view_cart", "cart_action":"view"}
"Voir panier" → {"intent":"view_cart", "cart_action":"view"}
"Affiche mon panier" → {"intent":"view_cart", "cart_action":"view"}
"Que j'ai dans mon panier ?" → {"intent":"view_cart", "cart_action":"view"}
"Montre-moi mon panier" → {"intent":"view_cart", "cart_action":"view"}
"Panier s'il te plaît" → {"intent":"view_cart", "cart_action":"view"}
"Je veux voir mon panier" → {"intent":"view_cart", "cart_action":"view"}

#### VIDER PANIER (clear_cart)
"Vide mon panier" → {"intent":"clear_cart", "cart_action":"clear"}
"Supprime tout" → {"intent":"clear_cart", "cart_action":"clear"}
"Enlève tous les articles" → {"intent":"clear_cart", "cart_action":"clear"}
"Vider le panier" → {"intent":"clear_cart", "cart_action":"clear"}
"Supprime tout du panier" → {"intent":"clear_cart", "cart_action":"clear"}

#### ENLEVER ARTICLE (remove_from_cart)
"Enlève le doliprane" → {"intent":"remove_from_cart", "medicines":["doliprane"], "cart_action":"remove"}
"Supprime l'article 1" → {"intent":"remove_from_cart", "selected_index":1, "cart_action":"remove"}
"Retire le 2ème article" → {"intent":"remove_from_cart", "selected_index":2, "cart_action":"remove"}
"Enlève le premier" → {"intent":"remove_from_cart", "selected_index":1, "cart_action":"remove"}
"Supprime amoxicilline" → {"intent":"remove_from_cart", "medicines":["amoxicilline"], "cart_action":"remove"}
"Retire l'article 3" → {"intent":"remove_from_cart", "selected_index":3, "cart_action":"remove"}

#### CHOIX DANS LISTE (select_option)
"1" → {"intent":"select_option", "selected_index":1, "selection_type":"medicine"}
"le premier" → {"intent":"select_option", "selected_index":1, "selection_type":"medicine"}
"choisis 2" → {"intent":"select_option", "selected_index":2, "selection_type":"medicine"}
"le 3" → {"intent":"select_option", "selected_index":3, "selection_type":"medicine"}
"numéro 1" → {"intent":"select_option", "selected_index":1, "selection_type":"medicine"}
"option 2" → {"intent":"select_option", "selected_index":2, "selection_type":"medicine"}
"premier" → {"intent":"select_option", "selected_index":1, "selection_type":"medicine"}
"deuxième" → {"intent":"select_option", "selected_index":2, "selection_type":"medicine"}
"troisième" → {"intent":"select_option", "selected_index":3, "selection_type":"medicine"}

#### INFOS LIVRAISON (provide_delivery_info)
"Je suis à Cocody" → {"intent":"provide_delivery_info", "quartier":"Cocody"}
"Mon quartier c'est Angré" → {"intent":"provide_delivery_info", "quartier":"Angré"}
"San Pedro" → {"intent":"provide_delivery_info", "ville":"San Pedro"}
"Cocody Angré" → {"intent":"provide_delivery_info", "quartier":"Cocody Angré"}
"J'habite à San Pedro" → {"intent":"provide_delivery_info", "ville":"San Pedro"}
"Marcory" → {"intent":"provide_delivery_info", "quartier":"Marcory"}
"Yopougon" → {"intent":"provide_delivery_info", "quartier":"Yopougon"}
"Je suis à Yopougon" → {"intent":"provide_delivery_info", "quartier":"Yopougon"}
"Adjamé" → {"intent":"provide_delivery_info", "quartier":"Adjamé"}

#### INDICATIONS (provide_indications)
"C'est au 3ème étage" → {"intent":"provide_indications", "indications":"3ème étage"}
"Sonnette rouge" → {"intent":"provide_indications", "indications":"sonnette rouge"}
"Entrée B, porte gauche" → {"intent":"provide_indications", "indications":"entrée B, porte gauche"}
"Près du marché" → {"intent":"provide_indications", "indications":"près du marché"}
"non" → {"intent":"provide_indications", "indications":""}
"Pas d'indications" → {"intent":"provide_indications", "indications":""}
"Derrière l'école" → {"intent":"provide_indications", "indications":"derrière l'école"}
"Immeuble bleu" → {"intent":"provide_indications", "indications":"immeuble bleu"}
"Code 1234" → {"intent":"provide_indications", "indications":"code 1234"}

#### INFOS PATIENT (provide_patient_info)
"Je m'appelle Jean Kouassi" → {"intent":"provide_patient_info", "patient_name":"Jean Kouassi"}
"Mon nom c'est Marie Claire" → {"intent":"provide_patient_info", "patient_name":"Marie Claire"}
"J'ai 25 ans" → {"intent":"provide_patient_info", "patient_age":25}
"Je suis un homme" → {"intent":"provide_patient_info", "patient_gender":"M"}
"Je suis une femme" → {"intent":"provide_patient_info", "patient_gender":"F"}
"Je pèse 70kg" → {"intent":"provide_patient_info", "patient_weight":70}
"Je mesure 175cm" → {"intent":"provide_patient_info", "patient_height":175}
"Mon poids 70 kg" → {"intent":"provide_patient_info", "patient_weight":70}
"Ma taille 175 cm" → {"intent":"provide_patient_info", "patient_height":175}
"Jean, 25 ans" → {"intent":"provide_patient_info", "patient_name":"Jean", "patient_age":25}
"Marie, F, 30 ans" → {"intent":"provide_patient_info", "patient_name":"Marie", "patient_gender":"F", "patient_age":30}
"J'ai 25 ans, je pèse 70kg et je mesure 175cm" → {"intent":"provide_patient_info", "patient_age":25, "patient_weight":70, "patient_height":175}
"Jean Kouassi, 25 ans, homme, 70kg, 175cm" → {"intent":"provide_patient_info", "patient_name":"Jean Kouassi", "patient_age":25, "patient_gender":"M", "patient_weight":70, "patient_height":175}

#### CONTACT (provide_contact_info)
"Mon téléphone c'est 0701020304" → {"intent":"provide_contact_info", "phone_number":"0701020304"}
"07 58 01 97 27" → {"intent":"provide_contact_info", "phone_number":"0758019727"}
"Appelle-moi au 0701020304" → {"intent":"provide_contact_info", "phone_number":"0701020304"}
"Mon numéro c'est 2250701020304" → {"intent":"provide_contact_info", "phone_number":"2250701020304"}
"0701020304" → {"intent":"provide_contact_info", "phone_number":"0701020304"}
"07.58.01.97.27" → {"intent":"provide_contact_info", "phone_number":"0758019727"}
"07 58 01 97 27" → {"intent":"provide_contact_info", "phone_number":"0758019727"}

#### CONFIRMATION (confirm_order)
"Je confirme" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"Oui c'est bon" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"Valide la commande" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"OK" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"C'est parfait" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"Oui" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"Confirme" → {"intent":"confirm_order", "confirmation_action":"confirm"}
"Commande confirmée" → {"intent":"confirm_order", "confirmation_action":"confirm"}

#### MODIFICATION (modify_order)
"Je veux modifier" → {"intent":"modify_order", "confirmation_action":"modify"}
"Change la quantité" → {"intent":"modify_order", "confirmation_action":"modify"}
"Je voudrais changer" → {"intent":"modify_order", "confirmation_action":"modify"}
"Modifier ma commande" → {"intent":"modify_order", "confirmation_action":"modify"}
"Je veux changer quelque chose" → {"intent":"modify_order", "confirmation_action":"modify"}

#### ANNULATION (cancel_order)
"Annule" → {"intent":"cancel_order", "confirmation_action":"cancel"}
"Non merci" → {"intent":"cancel_order", "confirmation_action":"cancel"}
"Pas maintenant" → {"intent":"cancel_order", "confirmation_action":"cancel"}
"Laisse tomber" → {"intent":"cancel_order", "confirmation_action":"cancel"}
"Annuler la commande" → {"intent":"cancel_order", "confirmation_action":"cancel"}
"Finalement non" → {"intent":"cancel_order", "confirmation_action":"cancel"}

#### STATUT COMMANDE (order_status)
"Où est ma commande CMD202603121234 ?" → {"intent":"order_status", "order_id":"CMD202603121234"}
"Suivi commande 584721" → {"intent":"order_status", "confirmation_code":"584721"}
"Ma commande est où ?" → {"intent":"order_status"}
"État de ma commande" → {"intent":"order_status"}
"Où est ma commande ?" → {"intent":"order_status"}
"Commande CMD1234" → {"intent":"order_status", "order_id":"CMD1234"}

#### DEMANDER INFOS LIVRAISON (ask_delivery_info)
"Où livrez-vous ?" → {"intent":"ask_delivery_info"}
"Vous livrez à Cocody ?" → {"intent":"ask_delivery_info", "quartier":"Cocody"}
"Quels quartiers livrez-vous ?" → {"intent":"ask_delivery_info"}
"Est-ce que vous livrez à Marcory ?" → {"intent":"ask_delivery_info", "quartier":"Marcory"}
"Livraison possible où ?" → {"intent":"ask_delivery_info"}

#### DEMANDER INFOS PATIENT (ask_patient_info)
"Quelles infos vous faut-il ?" → {"intent":"ask_patient_info"}
"De quoi avez-vous besoin ?" → {"intent":"ask_patient_info"}
"Qu'est-ce que je dois donner comme infos ?" → {"intent":"ask_patient_info"}
"Quelles informations personnelles ?" → {"intent":"ask_patient_info"}

#### AIDE (help)
"Aide" → {"intent":"help"}
"Comment ça marche ?" → {"intent":"help"}
"Je ne comprends pas" → {"intent":"help"}
"Tutoriel" → {"intent":"help"}
"Comment commander ?" → {"intent":"help"}
"Guide" → {"intent":"help"}
"Explication" → {"intent":"help"}

#### URGENCE (emergency)
"Urgence !" → {"intent":"emergency"}
"Appelle le 185" → {"intent":"emergency"}
"SAMU" → {"intent":"emergency"}
"Accident" → {"intent":"emergency"}
"Vomissements" → {"intent":"emergency"}
"Mon enfant est malade" → {"intent":"emergency"}
"Besoin d'un médecin" → {"intent":"emergency"}
"Crise cardiaque" → {"intent":"emergency"}

#### NON RECONNU (unknown)
"Blabla" → {"intent":"unknown"}
"..." → {"intent":"unknown"}
"Test" → {"intent":"unknown"}
"123" → {"intent":"unknown"}
"A" → {"intent":"unknown"}

### 📊 FORMAT DE SORTIE (JSON UNIQUEMENT)

{
  "intent": "greet|search|availability|order|add_to_cart|view_cart|clear_cart|remove_from_cart|select_option|provide_delivery_info|provide_indications|provide_patient_info|provide_contact_info|confirm_order|modify_order|cancel_order|order_status|ask_delivery_info|ask_patient_info|help|emergency|unknown",
  
  "entities": {
    "medicines": ["doliprane"] | null,
    "quantities": {"doliprane": 2} | null,
    "selected_index": 1 | null,
    "price_query": "simple" | "comparatif" | null,
    "quartier": "Cocody" | null,
    "ville": "San Pedro" | null,
    "indications": "3ème étage" | null,
    "patient_name": "Jean Kouassi" | null,
    "patient_age": 25 | null,
    "patient_gender": "M" | "F" | null,
    "patient_weight": 70 | null,
    "patient_height": 175 | null,
    "phone_number": "0701020304" | null,
    "order_id": "CMD202603121234" | null,
    "confirmation_code": "584721" | null,
    "confirmation_action": "confirm" | "modify" | "cancel" | null,
    "cart_action": "add" | "remove" | "clear" | "view" | null,
    "selection_type": "medicine" | "option" | "quantity" | null
  },
  
  "confidence": 1.0,
  "has_image": false
}

Message à analyser: "${message}"
État conversation: ${conv?.state || 'IDLE'}`;

                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.0,
                    max_tokens: 800,
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0]?.message?.content || 
                    '{"intent":"unknown","entities":{},"confidence":0}');
                
                log('INTENT', `✅ ${result.intent} (${Date.now() - start}ms)`, result.entities);
                
                return result;

            } catch (error) {
                log('ERROR', '❌ Erreur extraction:', error);
                return { intent: 'unknown', entities: {}, confidence: 0 };
            }
        }

        // ✅ Analyse d'image
        async analyzeImage(imageBuffer) {
            if (!this.client || !imageBuffer) return { medicine: null, confidence: 0 };

            try {
                stats.groqCalls++;
                stats.groqVision++;
                const start = Date.now();

                const base64Image = imageBuffer.toString('base64');
                
                const prompt = `Tu es MARIAM-VISION, un expert en identification de médicaments.

### 🎯 TÂCHE
Analyse cette image et identifie le médicament présent.

### 📋 RÈGLES
- Identifie le nom commercial exact du médicament
- Détecte le dosage si visible
- Détecte la forme (comprimé, sirop, gélule...)
- Si tu vois plusieurs médicaments, identifie le principal
- Si aucun médicament, retourne null

### 📦 EXEMPLES D'IDENTIFICATION

IMAGE: Boîte blanche avec "DOLIPRANE 1000mg" écrit
→ {"medicine":"DOLIPRANE", "dosage":"1000mg", "forme":"comprimé", "confidence":0.95}

IMAGE: Flacon de sirop avec "ACFRAN SIROP 200ml"
→ {"medicine":"ACFRAN SIROP", "dosage":"200ml", "forme":"sirop", "confidence":0.95}

IMAGE: Boîte bleue "AMOXICILLINE 500mg"
→ {"medicine":"AMOXICILLINE", "dosage":"500mg", "forme":"comprimé", "confidence":0.95}

IMAGE: Boîte "IBUPROFENE 400mg"
→ {"medicine":"IBUPROFENE", "dosage":"400mg", "forme":"comprimé", "confidence":0.95}

IMAGE: Tube de crème "VOLTARENE 1%"
→ {"medicine":"VOLTARENE", "dosage":"1%", "forme":"crème", "confidence":0.95}

IMAGE: Boîte "PARACETAMOL BIOGARAN 1000mg"
→ {"medicine":"PARACETAMOL BIOGARAN", "dosage":"1000mg", "forme":"comprimé", "confidence":0.95}

IMAGE: Flacon "DAFALGAN sirop 150ml"
→ {"medicine":"DAFALGAN", "dosage":"150ml", "forme":"sirop", "confidence":0.95}

IMAGE: Pas de médicament (paysage, personne...)
→ {"medicine":null, "confidence":0}

### 📊 FORMAT DE SORTIE (JSON UNIQUEMENT)
{
  "medicine": "nom du médicament" | null,
  "dosage": "dosage détecté" | null,
  "forme": "comprimé|sirop|gélule|crème|pommade|injectable" | null,
  "confidence": 0.0 à 1.0
}`;

                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages: [
                        { role: 'system', content: prompt },
                        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }] }
                    ],
                    temperature: 0.0,
                    max_tokens: 300,
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0]?.message?.content || '{"medicine":null,"confidence":0}');
                
                log('VISION', `✅ Image analysée en ${Date.now() - start}ms`, result);
                
                return result;

            } catch (error) {
                log('ERROR', '❌ Erreur vision:', error);
                return { medicine: null, confidence: 0 };
            }
        }
    }

    // ==================== MODÈLE 2: LLAMA-3.3-70B (Chat) ====================
    class GroqChatService {
        constructor() {
            this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
            this.model = GROQ_CHAT_MODEL;
        }

        async generateResponse(context) {
            if (!this.client) return "";

            try {
                stats.groqCalls++;
                stats.groqChat++;
                const start = Date.now();

                const {
                    intent,
                    entities,
                    message,
                    state,
                    cart,
                    searchResults,
                    order,
                    userName,
                    ville
                } = context;

                // Construction du prompt avec les données réelles
                let prompt = `Tu es MARIAM, assistante santé à San Pedro, Côte d'Ivoire.\n\n`;

                if (userName) prompt += `Utilisateur: ${userName}\n`;
                prompt += `État: ${state || 'IDLE'}\n`;

                // Données du panier (RÉELLES)
                if (cart?.length > 0) {
                    prompt += `\nPANIER (données réelles):\n`;
                    cart.forEach(item => {
                        prompt += `- ${item.quantite}x ${item.nom_commercial} (${item.prix * item.quantite} FCFA)\n`;
                    });
                }

                // Résultats de recherche (RÉELS)
                if (searchResults?.length > 0) {
                    prompt += `\nRÉSULTATS RECHERCHE (données réelles):\n`;
                    searchResults.slice(0, 3).forEach((med, i) => {
                        prompt += `${i+1}. ${med.nom_commercial} - ${med.prix} FCFA\n`;
                    });
                }

                // Infos commande (RÉELLES)
                if (order) {
                    prompt += `\nCOMMANDE (données réelles):\n`;
                    prompt += `ID: ${order.id}\n`;
                    prompt += `Total: ${order.total} FCFA\n`;
                    prompt += `Livraison: ${order.client_quartier}, San Pedro\n`;
                }

                // Intention détectée
                prompt += `\nIntention détectée: ${intent}\n`;
                if (entities) {
                    prompt += `Entités extraites: ${JSON.stringify(entities)}\n`;
                }

                // Message utilisateur
                prompt += `\nMessage: "${message || 'Génère une réponse appropriée'}"\n\n`;

                prompt += `Génère une réponse naturelle, courte (2-3 phrases) et utile en français.
Utilise UNIQUEMENT les données fournies ci-dessus - N'invente RIEN.
Sois chaleureuse et naturelle.`;

                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 300
                });

                const response = completion.choices[0]?.message?.content || "";
                
                log('CHAT', `✅ Réponse générée en ${Date.now() - start}ms`);
                
                return response;

            } catch (error) {
                log('ERROR', '❌ Erreur chat:', error);
                return "";
            }
        }

        // ✅ Générer une relance
        async generateReminder(context) {
            const { cartItems, userName, inactiveTime } = context;
            
            const prompt = `Tu es MARIAM. L'utilisateur ${userName || ''} a laissé sa commande (${cartItems}) en suspens depuis ${inactiveTime}.
Génère un message amical pour lui demander s'il veut continuer.
2 phrases max, naturel.`;

            try {
                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 150
                });

                return completion.choices[0]?.message?.content || "";

            } catch (error) {
                log('ERROR', '❌ Erreur relance:', error);
                return "";
            }
        }

        // ✅ Générer une demande d'avis
        async generateReviewRequest(context) {
            const { order, clientName } = context;
            
            const prompt = `Tu es MARIAM. La commande de ${clientName} (${order.items.length} articles) a été livrée il y a 30 minutes.
Demande-lui son avis de façon naturelle et chaleureuse.
2-3 phrases max.`;

            try {
                const completion = await this.client.chat.completions.create({
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7,
                    max_tokens: 150
                });

                return completion.choices[0]?.message?.content || "";

            } catch (error) {
                log('ERROR', '❌ Erreur avis:', error);
                return "";
            }
        }
    }

    // ==================== GESTIONNAIRE DE CONVERSATIONS ====================
    class ConversationManager {
        constructor(pool) {
            this.pool = pool;
        }

        async getConversation(phone) {
            const cacheKey = `conv:${phone}`;
            const cached = await Utils.cacheGet(cacheKey);
            if (cached) return cached;

            try {
                const result = await this.pool.query('SELECT * FROM conversations WHERE phone = $1', [phone]);
                let conv;
                if (result.rows.length === 0) {
                    const newConv = await this.pool.query(`
                        INSERT INTO conversations (phone, state, cart, context, history) 
                        VALUES ($1, $2, $3, $4, $5) RETURNING *
                    `, [phone, ConversationStates.IDLE, '[]', '{}', '[]']);
                    conv = this._parseConversation(newConv.rows[0]);
                } else {
                    conv = this._parseConversation(result.rows[0]);
                }
                await Utils.cacheSet(cacheKey, conv, 300);
                return conv;
            } catch (error) {
                log('ERROR', 'Erreur récupération conversation:', error);
                return { phone, state: ConversationStates.IDLE, cart: [], context: {}, history: [] };
            }
        }

        _parseConversation(row) {
            return {
                ...row,
                cart: typeof row.cart === 'string' ? JSON.parse(row.cart) : row.cart,
                context: typeof row.context === 'string' ? JSON.parse(row.context) : row.context,
                history: typeof row.history === 'string' ? JSON.parse(row.history) : row.history
            };
        }

        async updateState(phone, newState, data = {}) {
            try {
                const updates = [];
                const values = [];
                let i = 1;
                if (newState) { updates.push(`state = $${i++}`); values.push(newState); }
                if (data.cart !== undefined) { updates.push(`cart = $${i++}`); values.push(JSON.stringify(data.cart)); }
                if (data.context) { updates.push(`context = $${i++}`); values.push(JSON.stringify(data.context)); }
                if (data.history) { updates.push(`history = $${i++}`); values.push(JSON.stringify(data.history)); }
                updates.push(`updated_at = NOW()`);
                await this.pool.query(`UPDATE conversations SET ${updates.join(', ')} WHERE phone = $${i}`, [...values, phone]);
                await Utils.cacheDel(`conv:${phone}`);
                return true;
            } catch (error) {
                log('ERROR', 'Erreur mise à jour conversation:', error);
                return false;
            }
        }

        async addToHistory(phone, role, message) {
            try {
                const conv = await this.getConversation(phone);
                const history = conv.history || [];
                history.push({ role, message, time: new Date().toISOString() });
                if (history.length > 10) history.shift();
                await this.updateState(phone, null, { history });
            } catch (error) {
                log('ERROR', 'Erreur ajout historique:', error);
            }
        }

        async clearContext(phone) {
            await this.updateState(phone, ConversationStates.IDLE, { context: {}, cart: [] });
        }
    }

    // ==================== BOUTON HANDLER ====================
    class ButtonHandler {
        constructor(convManager, whatsapp, chatService) {
            this.convManager = convManager;
            this.whatsapp = whatsapp;
            this.chatService = chatService;
        }

        async showPostAddButtons(phone, cart) {
            const total = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
            const text = `✅ Ajouté ! 🛒 ${cart.length} art. - ${total} FCFA\n\nAutre chose ?`;
            
            await this.whatsapp.sendInteractiveButtons(phone, text, 
                ['➕ Ajouter', '🛒 Voir panier', '✅ Commander']
            );
        }

        async showOrderSummaryButtons(phone, summary) {
            const text = `📋 *Résumé*\n\n${summary}\n\nÇa te va ?`;
            
            await this.whatsapp.sendInteractiveButtons(phone, text, 
                ['✅ Confirmer', '✏️ Modifier', '❌ Annuler']
            );
        }

        async handleButton(phone, buttonText, conv) {
            log('BUTTON', `🔘 ${buttonText}`);

            if (buttonText === '➕ Ajouter') {
                await this.convManager.updateState(phone, 'WAITING_MEDICINE');
                const response = await this.chatService.generateResponse({
                    intent: 'add_more',
                    userName: conv.context?.userName
                });
                await this.whatsapp.sendMessage(phone, response || "💊 Quel autre médicament ?");
            }
            else if (buttonText === '🛒 Voir panier') {
                const items = conv.cart.map(i => `   • ${i.quantite}x ${i.nom_commercial} - ${i.prix * i.quantite} FCFA`).join('\n');
                const total = conv.cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
                const text = `🛒 *Ton panier*\n\n${items}\n\n💰 Total: ${total} FCFA`;
                
                setTimeout(() => {
                    this.showPostAddButtons(phone, conv.cart);
                }, 1000);
                
                await this.whatsapp.sendMessage(phone, text);
            }
            else if (buttonText === '✅ Commander') {
                await this.convManager.updateState(phone, 'WAITING_QUARTIER');
                const response = await this.chatService.generateResponse({
                    intent: 'ask_quartier',
                    userName: conv.context?.userName
                });
                await this.whatsapp.sendMessage(phone, response || "📍 Ton quartier ?");
            }
            else if (buttonText === '✅ Confirmer') {
                try {
                    const order = await orderService.createOrder({
                        client: {
                            nom: conv.context.client_nom,
                            telephone: conv.context.client_telephone || phone,
                            quartier: conv.context.client_quartier,
                            ville: 'San Pedro',
                            indications: conv.context.client_indications || '',
                            patient_age: conv.context.patient_age,
                            patient_genre: conv.context.patient_genre,
                            patient_poids: conv.context.patient_poids,
                            patient_taille: conv.context.patient_taille
                        },
                        items: conv.cart
                    }, phone);

                    await this.convManager.clearContext(phone);

                    // ✅ Vérification BDD
                    const savedOrder = await orderService.getOrderById(order.id);
                    if (!savedOrder) {
                        log('ERROR', `❌ Commande ${order.id} non trouvée en BDD`);
                        return;
                    }

                    log('SUCCESS', `✅ Commande ${order.id} vérifiée en BDD`);

                    // ✅ Message de confirmation (LLM)
                    const heure = Utils.getEstimatedDeliveryTime();
                    const response = await this.chatService.generateResponse({
                        intent: 'order_confirmed',
                        order: savedOrder,
                        deliveryTime: heure,
                        userName: conv.context?.userName
                    });

                    await this.whatsapp.sendMessage(phone, response || 
                        `🎉 *Commande confirmée !*\nN°: ${order.id}\n📍 ${order.client_quartier}, San Pedro\n💰 ${order.total} FCFA\n\n🛵 Livraison vers ${heure}\n📱 Klove te contactera.\n\nMerci ! 🙏`
                    );

                    // ✅ Démarrer la collecte d'avis (30 min)
                    setTimeout(async () => {
                        const reviewResponse = await this.chatService.generateReviewRequest({
                            order: savedOrder,
                            clientName: savedOrder.client_name
                        });
                        if (reviewResponse) {
                            await this.whatsapp.sendMessage(phone, reviewResponse);
                        }
                    }, 30 * 60 * 1000);

                } catch (error) {
                    log('ERROR', '❌ Erreur confirmation:', error);
                    const errorResponse = await this.chatService.generateResponse({
                        intent: 'order_error',
                        userName: conv.context?.userName
                    });
                    await this.whatsapp.sendMessage(phone, errorResponse || "❌ Erreur. Réessaie.");
                }
            }
            else if (buttonText === '✏️ Modifier' || buttonText === '❌ Annuler') {
                await this.convManager.clearContext(phone);
                const response = await this.chatService.generateResponse({
                    intent: 'cancelled',
                    userName: conv.context?.userName
                });
                await this.whatsapp.sendMessage(phone, response || "❌ Annulé. Comment puis-je t'aider ?");
            }
        }
    }

    // ==================== RELANCE SERVICE ====================
    class RelanceService {
        constructor(pool, whatsapp, chatService) {
            this.pool = pool;
            this.whatsapp = whatsapp;
            this.chatService = chatService;
            this.remindedUsers = new Map();
        }

        async checkIncompleteOrders() {
            try {
                const result = await this.pool.query(`
                    SELECT phone, state, cart, context, updated_at 
                    FROM conversations 
                    WHERE state != 'IDLE' 
                    AND updated_at < NOW() - INTERVAL '5 minutes'
                    AND phone NOT IN (
                        SELECT phone FROM reminded_users 
                        WHERE reminded_at > NOW() - INTERVAL '1 hour'
                    )
                `);

                for (const row of result.rows) {
                    await this.sendReminder(row);
                }

            } catch (error) {
                log('ERROR', '❌ Erreur vérification commandes:', error);
            }
        }

        async sendReminder(conv) {
            try {
                const cartItems = conv.cart?.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ') || 'rien';
                const userName = conv.context?.userName || '';

                const response = await this.chatService.generateReminder({
                    cartItems: cartItems,
                    userName: userName,
                    inactiveTime: 'quelques minutes'
                });

                if (response) {
                    await this.whatsapp.sendMessage(conv.phone, response);
                }

                await this.pool.query(`
                    INSERT INTO reminded_users (phone, reminded_at) 
                    VALUES ($1, NOW())
                    ON CONFLICT (phone) DO UPDATE 
                    SET reminded_at = NOW()
                `, [conv.phone]);

                log('INFO', `⏰ Relance envoyée à ${conv.phone}`);

            } catch (error) {
                log('ERROR', '❌ Erreur envoi relance:', error);
            }
        }

        startMonitoring() {
            setInterval(() => this.checkIncompleteOrders(), 2 * 60 * 1000);
            log('INFO', '✅ Surveillance des commandes activée');
        }
    }

    // ==================== MOTEUR DE CONVERSATION PRINCIPAL ====================
    class ConversationEngine {
        constructor(visionService, chatService, searchService, orderService, 
                    convManager, whatsapp, mediaHandler, buttonHandler, relanceService) {
            this.visionService = visionService;      // Modèle 1: Llama-4-Scout
            this.chatService = chatService;          // Modèle 2: Llama-3.3-70B
            this.searchService = searchService;
            this.orderService = orderService;
            this.convManager = convManager;
            this.whatsapp = whatsapp;
            this.mediaHandler = mediaHandler;
            this.buttonHandler = buttonHandler;
            this.relanceService = relanceService;
        }

        async process(phone, message, mediaId = null) {
            try {
                const conv = await this.convManager.getConversation(phone);

                // ✅ Premier message - présentation
                if (conv.history.length === 0 && !mediaId) {
                    const welcome = await this.chatService.generateResponse({
                        intent: 'welcome',
                        userName: conv.context?.userName
                    });
                    await this.whatsapp.sendMessage(phone, welcome || "👋 Salut ! Je suis MARIAM. Tu veux chercher un médicament ?");
                    await this.convManager.addToHistory(phone, 'bot', welcome);
                    return;
                }

                await this.whatsapp.sendTypingIndicator(phone);

                // ✅ IMAGE → Modèle 1 (Vision)
                if (mediaId) {
                    await this.handleImage(phone, mediaId, conv);
                    return;
                }

                // ✅ BOUTON
                if (message?.startsWith('btn_')) {
                    await this.buttonHandler.handleButton(phone, message.substring(4), conv);
                    return;
                }

                // ✅ TEXTE → Modèle 1 (Extraction)
                const analysis = await this.visionService.extractIntent(message, conv);
                
                log('DEBUG', `📊 Intention: ${analysis.intent}`, analysis.entities);

                // ✅ URGENCE
                if (analysis.intent === 'emergency' || message.toLowerCase().includes('185')) {
                    const response = await this.chatService.generateResponse({
                        intent: 'emergency',
                        userName: conv.context?.userName
                    });
                    await this.whatsapp.sendMessage(phone, response || "🚨 *URGENCE*\n📞 Appelez le **185** (SAMU) !");
                    return;
                }

                // ✅ RECHERCHE MÉDICAMENT
                if (analysis.entities?.medicines?.length > 0) {
                    const medicineName = analysis.entities.medicines[0];
                    const results = await this.searchService.search(medicineName);
                    
                    if (results.length === 0) {
                        const response = await this.chatService.generateResponse({
                            intent: 'not_found',
                            entities: { medicine: medicineName },
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, response || `😕 Désolé, je n'ai pas trouvé "${medicineName}" dans notre base.`);
                        return;
                    }

                    // ✅ PRIX uniquement
                    if (analysis.intent === 'availability' || analysis.entities?.price_query) {
                        if (results.length === 1) {
                            const response = await this.chatService.generateResponse({
                                intent: 'price_single',
                                searchResults: results,
                                userName: conv.context?.userName
                            });
                            await this.whatsapp.sendMessage(phone, response || `💰 *${results[0].nom_commercial}* → ${results[0].prix} FCFA`);
                        } else {
                            const response = await this.chatService.generateResponse({
                                intent: 'price_multiple',
                                searchResults: results,
                                userName: conv.context?.userName
                            });
                            
                            let fallback = `💰 *Plusieurs prix*\n\n`;
                            results.slice(0, 3).forEach(m => {
                                fallback += `   • *${m.nom_commercial}* → ${m.prix} FCFA\n`;
                            });
                            await this.whatsapp.sendMessage(phone, response || fallback);
                        }
                        return;
                    }

                    // ✅ COMMANDE directe
                    if (analysis.intent === 'order' && analysis.entities?.quantities) {
                        const cart = conv.cart || [];
                        const qty = analysis.entities.quantities[medicineName] || 1;
                        cart.push({ ...results[0], quantite: qty });
                        await this.convManager.updateState(phone, null, { cart });

                        const response = await this.chatService.generateResponse({
                            intent: 'added_to_cart',
                            cart: cart,
                            entities: { medicine: results[0], quantity: qty },
                            userName: conv.context?.userName
                        });
                        
                        await this.whatsapp.sendMessage(phone, response || `✅ ${qty}x ${results[0].nom_commercial} ajouté !`);
                        
                        setTimeout(() => {
                            this.buttonHandler.showPostAddButtons(phone, cart);
                        }, 1000);
                        return;
                    }

                    // ✅ RECHERCHE normale
                    await this.convManager.updateState(phone, 'SELECTING_MEDICINE', {
                        context: { ...conv.context, search_results: results }
                    });

                    const response = await this.chatService.generateResponse({
                        intent: 'search_results',
                        searchResults: results,
                        query: medicineName,
                        userName: conv.context?.userName
                    });
                    
                    let fallback = `🔍 *Résultats pour "${medicineName}"*\n\n`;
                    results.slice(0, 3).forEach((m, i) => {
                        fallback += `   ${i+1}. *${m.nom_commercial}*\n`;
                        fallback += `      💰 ${m.prix} FCFA\n`;
                    });
                    fallback += `\n👉 *Réponds avec le numéro*`;
                    
                    await this.whatsapp.sendMessage(phone, response || fallback);
                    return;
                }

                // ✅ GESTION PAR ÉTAT
                if (conv.state !== 'IDLE') {
                    await this.handleState(phone, message, conv, analysis);
                    return;
                }

                // ✅ INTENTIONS SANS MÉDICAMENT
                const response = await this.chatService.generateResponse({
                    intent: analysis.intent,
                    message: message,
                    state: conv.state,
                    cart: conv.cart,
                    userName: conv.context?.userName
                });
                
                if (response) {
                    await this.whatsapp.sendMessage(phone, response);
                    await this.convManager.addToHistory(phone, 'bot', response);
                }

            } catch (error) {
                log('ERROR', '❌ Erreur moteur:', error);
                stats.errors++;
            }
        }

        async handleState(phone, message, conv, analysis) {
            let context = {
                intent: 'state_handler',
                state: conv.state,
                message: message,
                cart: conv.cart,
                userName: conv.context?.userName
            };

            switch (conv.state) {
                case 'SELECTING_MEDICINE':
                    const num = Utils.extractNumber(message);
                    const results = conv.context.search_results || [];
                    
                    if (num && num >= 1 && num <= results.length) {
                        const selected = results[num - 1];
                        await this.convManager.updateState(phone, 'WAITING_QUANTITY', {
                            pending_medicament: selected,
                            context: { ...conv.context, search_results: null }
                        });
                        
                        const response = await this.chatService.generateResponse({
                            intent: 'ask_quantity',
                            entities: { medicine: selected },
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, response || `💊 *${selected.nom_commercial}*\n💰 ${selected.prix} FCFA\n\nCombien ?`);
                    } else {
                        const response = await this.chatService.generateResponse({
                            intent: 'invalid_selection',
                            max: results.length,
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, response || `❌ Choisis 1-${results.length}`);
                    }
                    break;

                case 'WAITING_QUANTITY':
                    const qty = Utils.extractNumber(message);
                    if (qty && qty > 0) {
                        const cart = conv.cart || [];
                        cart.push({ ...conv.pending_medicament, quantite: qty });
                        await this.convManager.updateState(phone, null, { 
                            cart, pending_medicament: null 
                        });

                        const response = await this.chatService.generateResponse({
                            intent: 'added_to_cart',
                            cart: cart,
                            entities: { medicine: conv.pending_medicament, quantity: qty },
                            userName: conv.context?.userName
                        });
                        
                        await this.whatsapp.sendMessage(phone, response || `✅ ${qty}x ${conv.pending_medicament.nom_commercial} ajouté !`);
                        
                        setTimeout(() => {
                            this.buttonHandler.showPostAddButtons(phone, cart);
                        }, 1000);
                    } else {
                        const response = await this.chatService.generateResponse({
                            intent: 'invalid_quantity',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, response || "❌ Nombre valide ? (ex: 2)");
                    }
                    break;

                case 'WAITING_QUARTIER':
                    await this.convManager.updateState(phone, 'WAITING_VILLE', {
                        context: { ...conv.context, client_quartier: message }
                    });
                    
                    const responseQuartier = await this.chatService.generateResponse({
                        intent: 'ask_city',
                        userName: conv.context?.userName
                    });
                    await this.whatsapp.sendMessage(phone, responseQuartier || "📍 Ville ? (San Pedro uniquement)");
                    break;

                case 'WAITING_VILLE':
                    if (message.toLowerCase().includes('san pedro')) {
                        await this.convManager.updateState(phone, 'WAITING_NAME', {
                            context: { ...conv.context, client_ville: 'San Pedro' }
                        });
                        
                        const responseVille = await this.chatService.generateResponse({
                            intent: 'ask_name',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseVille || "👤 Ton nom complet ?");
                    } else {
                        const responseVille = await this.chatService.generateResponse({
                            intent: 'wrong_city',
                            city: message,
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseVille || "🚚 On livre seulement à San Pedro.");
                        // Rester dans le même état
                    }
                    break;

                case 'WAITING_NAME':
                    if (message.split(' ').length >= 2 && message.length >= 6) {
                        await this.convManager.updateState(phone, 'WAITING_PATIENT_AGE', {
                            context: { ...conv.context, client_nom: message }
                        });
                        
                        const responseNom = await this.chatService.generateResponse({
                            intent: 'ask_age',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseNom || "🎂 Âge ?");
                    } else {
                        const responseNom = await this.chatService.generateResponse({
                            intent: 'invalid_name',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseNom || "❌ Prénom et nom (min 6 caractères) ?");
                    }
                    break;

                case 'WAITING_PATIENT_AGE':
                    const age = parseInt(message);
                    if (age >= 1 && age <= 120) {
                        await this.convManager.updateState(phone, 'WAITING_PATIENT_GENRE', {
                            context: { ...conv.context, patient_age: age }
                        });
                        
                        const responseAge = await this.chatService.generateResponse({
                            intent: 'ask_gender',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseAge || "⚥ Genre ? (M/F)");
                    } else {
                        const responseAge = await this.chatService.generateResponse({
                            intent: 'invalid_age',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseAge || "❌ Âge (1-120) ?");
                    }
                    break;

                case 'WAITING_PATIENT_GENRE':
                    const genre = message.toUpperCase();
                    if (genre === 'M' || genre === 'F') {
                        await this.convManager.updateState(phone, 'WAITING_PATIENT_POIDS', {
                            context: { ...conv.context, patient_genre: genre }
                        });
                        
                        const responseGenre = await this.chatService.generateResponse({
                            intent: 'ask_weight',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseGenre || "⚖️ Poids ? (kg)");
                    } else {
                        const responseGenre = await this.chatService.generateResponse({
                            intent: 'invalid_gender',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responseGenre || "❌ M ou F ?");
                    }
                    break;

                case 'WAITING_PATIENT_POIDS':
                    const poids = parseInt(message);
                    if (poids >= 20 && poids <= 200) {
                        await this.convManager.updateState(phone, 'WAITING_PATIENT_TAILLE', {
                            context: { ...conv.context, patient_poids: poids }
                        });
                        
                        const responsePoids = await this.chatService.generateResponse({
                            intent: 'ask_height',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responsePoids || "📏 Taille ? (cm)");
                    } else {
                        const responsePoids = await this.chatService.generateResponse({
                            intent: 'invalid_weight',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, responsePoids || "❌ Poids (20-200 kg) ?");
                    }
                    break;

                case 'WAITING_PATIENT_TAILLE':
                    const taille = parseInt(message);
                    if (taille >= 100 && taille <= 250) {
                        await this.convManager.updateState(phone, 'WAITING_PHONE', {
                            context: { ...conv.context, patient_taille: taille }
                        });
                        
                        const reponseTaille = await this.chatService.generateResponse({
                            intent: 'ask_phone',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, reponseTaille || "📞 Téléphone ? (07, 01, 05)");
                    } else {
                        const reponseTaille = await this.chatService.generateResponse({
                            intent: 'invalid_height',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, reponseTaille || "❌ Taille (100-250 cm) ?");
                    }
                    break;

                case 'WAITING_PHONE':
                    if (Utils.validatePhone(message)) {
                        await this.convManager.updateState(phone, 'WAITING_INDICATIONS', {
                            context: { ...conv.context, client_telephone: Utils.cleanPhone(message) }
                        });
                        
                        const reponsePhone = await this.chatService.generateResponse({
                            intent: 'ask_indications',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, reponsePhone || "📍 Indications ? (entrée) ou 'non'");
                    } else {
                        const reponsePhone = await this.chatService.generateResponse({
                            intent: 'invalid_phone',
                            userName: conv.context?.userName
                        });
                        await this.whatsapp.sendMessage(phone, reponsePhone || "❌ Numéro invalide (07, 01, 05)");
                    }
                    break;

                case 'WAITING_INDICATIONS':
                    const indications = message.toLowerCase() === 'non' ? '' : message;
                    await this.convManager.updateState(phone, 'WAITING_CONFIRMATION', {
                        context: { ...conv.context, client_indications: indications }
                    });

                    // Résumé de commande
                    const items = conv.cart.map(i => 
                        `   • ${i.quantite}x ${i.nom_commercial} - ${i.prix * i.quantite} FCFA`
                    ).join('\n');
                    
                    const subtotal = conv.cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
                    const delivery = Utils.getCurrentDeliveryPrice();
                    const total = subtotal + delivery.price + SERVICE_FEE;
                    const heure = Utils.getEstimatedDeliveryTime();
                    
                    const summary = `${items}

📍 *Livraison*
   • Quartier: ${conv.context.client_quartier}
   • Ville: San Pedro
   • Indications: ${indications || 'Aucune'}

👤 *Client*
   • ${conv.context.client_nom}
   • 📞 ${conv.context.client_telephone}
   • 🎂 ${conv.context.patient_age} ans · ⚖️ ${conv.context.patient_poids}kg · 📏 ${conv.context.patient_taille}cm

💰 *Détails*
   • Sous-total: ${subtotal} FCFA
   • Livraison (${delivery.period === 'NIGHT' ? '🌙 nuit' : '☀️ jour'}): ${delivery.price} FCFA
   • Frais de service: ${SERVICE_FEE} FCFA
   • *TOTAL: ${total} FCFA*

💵 Paiement à la livraison
🕐 Livraison prévue vers ${heure}`;

                    setTimeout(() => {
                        this.buttonHandler.showOrderSummaryButtons(phone, summary);
                    }, 500);
                    break;

                case 'WAITING_CONFIRMATION':
                    // Les boutons gèrent
                    break;
            }
        }

        async handleImage(phone, mediaId, conv) {
            await this.whatsapp.sendMessage(phone, "📸 Je regarde...");
            
            const media = await this.mediaHandler.downloadMedia(mediaId);
            if (!media.success) {
                await this.whatsapp.sendMessage(phone, "❌ Image non téléchargée.");
                return;
            }

            if (!this.mediaHandler.isSupportedImage(media.mimeType)) {
                await this.whatsapp.sendMessage(phone, "📸 Format non supporté. Envoie JPG ou PNG.");
                return;
            }

            if (media.size > 4 * 1024 * 1024) {
                await this.whatsapp.sendMessage(phone, "📸 Image trop volumineuse (max 4MB).");
                return;
            }

            // ✅ Modèle 1: Analyse l'image
            const visionResult = await this.visionService.analyzeImage(media.buffer);
            
            if (visionResult.medicine && visionResult.confidence > 0.7) {
                // Recherche dans la base
                const results = await this.searchService.search(visionResult.medicine);
                
                if (results.length > 0) {
                    await this.convManager.updateState(phone, 'WAITING_QUANTITY', {
                        pending_medicament: results[0]
                    });

                    const response = await this.chatService.generateResponse({
                        intent: 'image_identified',
                        searchResults: [results[0]],
                        imageInfo: visionResult,
                        userName: conv.context?.userName
                    });
                    
                    await this.whatsapp.sendMessage(phone, response || 
                        `✅ *${results[0].nom_commercial}* identifié !\n💰 ${results[0].prix} FCFA\n\nCombien ?`
                    );
                } else {
                    const response = await this.chatService.generateResponse({
                        intent: 'image_not_found',
                        imageInfo: visionResult,
                        userName: conv.context?.userName
                    });
                    await this.whatsapp.sendMessage(phone, response || 
                        `🔍 J'ai détecté "${visionResult.medicine}" mais ce médicament n'est pas dans notre base.`
                    );
                }
            } else {
                const response = await this.chatService.generateResponse({
                    intent: 'image_not_recognized',
                    userName: conv.context?.userName
                });
                await this.whatsapp.sendMessage(phone, response || "🔍 Pas de médicament identifié. Écris le nom ?");
            }
        }
    }

    // ==================== TABLES SUPPLÉMENTAIRES ====================
    async function createAdditionalTables() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS reminded_users (
                    phone VARCHAR(20) PRIMARY KEY,
                    reminded_at TIMESTAMP DEFAULT NOW(),
                    reminder_count INTEGER DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS avis (
                    id SERIAL PRIMARY KEY,
                    order_id VARCHAR(50) NOT NULL,
                    client_phone VARCHAR(20) NOT NULL,
                    client_name VARCHAR(100),
                    review_text TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_reminded_phone ON reminded_users(phone);
                CREATE INDEX IF NOT EXISTS idx_avis_order ON avis(order_id);
            `);
            log('SUCCESS', '✅ Tables supplémentaires créées');
        } catch (error) {
            log('ERROR', '❌ Erreur création tables:', error);
        }
    }

    // ==================== WEBHOOK WHATSAPP ====================
    app.get('/webhook', (req, res) => {
        if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
            res.send(req.query['hub.challenge']);
        } else {
            res.sendStatus(403);
        }
    });

    app.post('/webhook', async (req, res) => {
        res.sendStatus(200);

        try {
            const entry = req.body.entry?.[0];
            const change = entry?.changes?.[0];
            const msg = change.value?.messages?.[0];
            const from = msg?.from;

            if (!from) return;

            console.log('\n' + '='.repeat(60));
            console.log(`📨 ${new Date().toLocaleTimeString()} - Message de [${from}]`);
            console.log('='.repeat(60));

            if (!checkUserRateLimit(from)) {
                await whatsappService.sendMessage(from, "⏰ Trop de messages. Attends un peu.");
                return;
            }

            await whatsappService.markAsRead(msg.id);
            if (processedMessages.has(msg.id)) return;
            processedMessages.set(msg.id, true);

            stats.messagesProcessed++;
            stats.activeUsersSet.add(from);

            if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
                messageQueue.add('text-message', { from, text: `btn_${msg.interactive.button_reply.title}` });
            } 
            else if (msg.type === 'text') {
                messageQueue.add('text-message', { from, text: msg.text.body.trim() });
            }
            else if (msg.type === 'image') {
                messageQueue.add('image-message', { from, mediaId: msg.image.id });
            }
            else if (msg.type === 'voice') {
                await whatsappService.sendMessage(from, "Désolé, je ne traite pas les messages vocaux.");
            }

        } catch (error) {
            log('ERROR', '❌ Erreur webhook:', error);
            stats.errors++;
        }
    });

    // ==================== PROCESSUS DE MESSAGE ====================
    messageQueue.processJob = async (job) => {
        try {
            if (job.type === 'text-message') {
                await conversationEngine.process(job.data.from, job.data.text);
            } else if (job.type === 'image-message') {
                await conversationEngine.process(job.data.from, null, job.data.mediaId);
            }
        } catch (error) {
            log('ERROR', '❌ Erreur traitement:', error);
        }
    };

    // ==================== ROUTES API ====================
    app.get('/', (req, res) => {
        res.json({
            name: 'MARIAM - Bot Santé San Pedro',
            creator: 'Youssef - Univ. San Pedro (Licence 2, 2026)',
            version: '9.0.0',
            models: {
                vision: GROQ_VISION_MODEL,
                chat: GROQ_CHAT_MODEL
            },
            stats: {
                messages: stats.messagesProcessed,
                orders: stats.ordersCreated,
                groqCalls: stats.groqCalls,
                groqVision: stats.groqVision,
                groqChat: stats.groqChat,
                errors: stats.errors,
                uptime: Math.floor((Date.now() - stats.startTime) / 1000)
            }
        });
    });

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/verify-order/:orderId', async (req, res) => {
        const orderId = req.params.orderId;
        
        try {
            const order = await orderService.getOrderById(orderId);
            
            if (!order) {
                return res.json({
                    success: false,
                    message: `❌ Commande ${orderId} non trouvée en BDD`
                });
            }

            res.json({
                success: true,
                order: {
                    id: order.id,
                    client: order.client_name,
                    phone: order.client_phone,
                    total: order.total,
                    status: order.status,
                    created_at: order.created_at
                }
            });

        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    // ==================== INITIALISATION DB ====================
    async function initDatabase() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS medicaments (
                    code_produit VARCHAR(50) PRIMARY KEY,
                    nom_commercial VARCHAR(200) NOT NULL,
                    dci VARCHAR(200),
                    prix DECIMAL(10, 2) NOT NULL
                );

                CREATE TABLE IF NOT EXISTS conversations (
                    phone VARCHAR(20) PRIMARY KEY,
                    state VARCHAR(50) DEFAULT 'IDLE',
                    cart JSONB DEFAULT '[]',
                    context JSONB DEFAULT '{}',
                    history JSONB DEFAULT '[]',
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS orders (
                    id VARCHAR(50) PRIMARY KEY,
                    client_name VARCHAR(100),
                    client_phone VARCHAR(20),
                    client_quartier VARCHAR(100),
                    client_ville VARCHAR(100) DEFAULT 'San Pedro',
                    client_indications TEXT,
                    patient_age INTEGER,
                    patient_genre VARCHAR(1),
                    patient_poids INTEGER,
                    patient_taille INTEGER,
                    items JSONB NOT NULL,
                    subtotal DECIMAL(10, 2) NOT NULL,
                    delivery_price DECIMAL(10, 2) NOT NULL,
                    service_fee DECIMAL(10, 2) NOT NULL,
                    total DECIMAL(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'PENDING',
                    livreur_phone VARCHAR(20),
                    confirmation_code VARCHAR(20),
                    delivery_period VARCHAR(10),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_orders_client_phone ON orders(client_phone);
                CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

                CREATE TABLE IF NOT EXISTS livreurs (
                    id_livreur VARCHAR(10) PRIMARY KEY,
                    nom VARCHAR(100) NOT NULL,
                    telephone VARCHAR(20) NOT NULL,
                    whatsapp VARCHAR(20),
                    disponible BOOLEAN DEFAULT true,
                    commandes_livrees INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_livreurs_disponible ON livreurs(disponible);

                INSERT INTO livreurs (id_livreur, nom, telephone, whatsapp, disponible)
                VALUES ('LIV001', 'Klove Komla Elia', '0758019727', '2250758019727', true)
                ON CONFLICT (id_livreur) DO NOTHING;
            `);

            await createAdditionalTables();

            log('SUCCESS', '✅ Base de données initialisée');
        } catch (err) {
            log('ERROR', '❌ Erreur DB:', err);
        }
    }

    // ==================== INITIALISATION SERVICES ====================
    const whatsappService = new WhatsAppService();
    const mediaHandler = new WhatsAppMediaHandler();
    const visionService = new GroqVisionService();    // Modèle 1: Llama-4-Scout
    const chatService = new GroqChatService();        // Modèle 2: Llama-3.3-70B
    const searchService = new SearchService(pool);
    const convManager = new ConversationManager(pool);
    const orderService = new OrderService(pool, whatsappService);
    const buttonHandler = new ButtonHandler(convManager, whatsappService, chatService);
    const relanceService = new RelanceService(pool, whatsappService, chatService);
    
    const conversationEngine = new ConversationEngine(
        visionService, chatService, searchService, orderService, convManager,
        whatsappService, mediaHandler, buttonHandler, relanceService
    );

    // ==================== DÉMARRER LA SURVEILLANCE ====================
    relanceService.startMonitoring();

    // ==================== DÉMARRAGE ====================
    const server = app.listen(PORT, '0.0.0.0', async () => {
        await initDatabase();
        setTimeout(() => searchService.initFuseIndex(), 2000);

        console.log('\n' + '🚀'.repeat(40));
        console.log('🚀 MARIAM BOT DÉMARRÉ - 2 MODÈLES');
        console.log('🚀'.repeat(40) + '\n');
        console.log(`📱 Bot actif sur le port ${PORT}`);
        console.log(`📊 Version: 9.0.0`);
        console.log(`\n🎯 MODÈLE 1: ${GROQ_VISION_MODEL} (Vision + Extraction)`);
        console.log(`💬 MODÈLE 2: ${GROQ_CHAT_MODEL} (Chat + Réponses)`);
        console.log(`\n✅ Prêt à servir !\n`);
    });

    // ==================== GESTION ERREURS ====================
    process.on('unhandledRejection', (err) => {
        log('ERROR', 'Unhandled Rejection:', err);
        stats.errors++;
    });

    process.on('uncaughtException', (err) => {
        log('ERROR', 'Uncaught Exception:', err);
        stats.errors++;
        if (IS_PRODUCTION) process.exit(1);
    });

    process.on('SIGTERM', () => {
        log('INFO', 'SIGTERM reçu, arrêt...');
        server.close(() => {
            pool.end();
            process.exit(0);
        });
    });
    
    module.exports = app;
}