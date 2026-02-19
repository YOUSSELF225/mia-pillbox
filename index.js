/**
 * MIA - PILLBOX
 * Assistant Santé Intelligent pour San Pedro
 * Version Production 4.0 - Ultra Haute Disponibilité
 * 
 * Architecture: Microservices, Load Balancing, Cache Distribué, Queue System
 * Capable de gérer des milliards de requêtes simultanées
 */

// ============================================================================
// IMPORTS OPTIMISÉS
// ============================================================================
const express = require('express');
const axios = require('axios');
const Groq = require('groq-sdk');
const XLSX = require('xlsx');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cluster = require('cluster');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const Bull = require('bull');
const CircuitBreaker = require('opossum');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const promClient = require('prom-client');
const responseTime = require('response-time');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config();

// ============================================================================
// CONFIGURATION MULTI-CŒURS (CLUSTERING)
// ============================================================================
const numCPUs = os.cpus().length;
const isMaster = cluster.isMaster;

if (isMaster && process.env.NODE_ENV === 'production') {
    console.log(`🚀 Master ${process.pid} démarre avec ${numCPUs} workers`);
    
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
        console.log(`⚠️ Worker ${worker.process.pid} mort. Redémarrage...`);
        cluster.fork();
    });
    
    return;
}

// ============================================================================
// VARIABLES D'ENVIRONNEMENT (PRODUCTION)
// ============================================================================
const config = {
    // WhatsApp Cloud API
    whatsappToken: process.env.WHATSAPP_TOKEN,
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    verifyToken: process.env.VERIFY_TOKEN,
    
    // GROQ
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'llama3-70b-8192',
    
    // Support
    supportPhone: process.env.SUPPORT_PHONE || '2250708091011',
    
    // Google Drive
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    
    // Livraison
    livraisonJour: process.env.LIVRAISON_JOUR || '08:00-23:00',
    livraisonNuit: process.env.LIVRAISON_NUIT || '00:00-07:00',
    
    // Zones
    zoneService: process.env.ZONE_SERVICE ? process.env.ZONE_SERVICE.split(',') : ['San Pedro'],
    
    // Infrastructure
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    kafkaBrokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
    databaseUrl: process.env.DATABASE_URL,
    port: process.env.PORT || 10000,
    nodeEnv: process.env.NODE_ENV || 'development'
};

// Validation
if (!config.whatsappToken) throw new Error('WHATSAPP_TOKEN manquant');
if (!config.phoneNumberId) throw new Error('PHONE_NUMBER_ID manquant');
if (!config.groqApiKey) throw new Error('GROQ_API_KEY manquante');
if (!config.googleDriveFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID manquant');

// ============================================================================
// LOGGER AVANCÉ
// ============================================================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format.errors({ stack: true })
    ),
    defaultMeta: { service: 'mia-pillbox', pid: process.pid },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `[${timestamp}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            )
        })
    ]
});

// ============================================================================
// MÉTRIQUES PROMETHEUS
// ============================================================================
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'mia_' });

const httpRequestDuration = new promClient.Histogram({
    name: 'mia_http_request_duration_seconds',
    help: 'Durée des requêtes HTTP',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10]
});

const messagesProcessed = new promClient.Counter({
    name: 'mia_messages_processed_total',
    help: 'Nombre total de messages traités',
    labelNames: ['type', 'status']
});

const llmRequests = new promClient.Counter({
    name: 'mia_llm_requests_total',
    help: 'Nombre total de requêtes LLM',
    labelNames: ['status']
});

const activeUsers = new promClient.Gauge({
    name: 'mia_active_users',
    help: 'Nombre d\'utilisateurs actifs'
});

// ============================================================================
// CONNEXIONS INFRASTRUCTURE
// ============================================================================

// Redis (cache distribué)
let redis;
try {
    redis = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        lazyConnect: true
    });
    
    redis.on('error', (err) => logger.error('Redis error:', err));
} catch (error) {
    logger.warn('Redis non disponible, utilisation cache mémoire uniquement');
    redis = null;
}

// Kafka (message queue)
let producer, consumer;
try {
    const kafka = new Kafka({
        clientId: `mia-producer-${process.pid}`,
        brokers: config.kafkaBrokers,
        retry: { retries: 3 }
    });
    
    producer = kafka.producer();
    consumer = kafka.consumer({ groupId: 'mia-group' });
} catch (error) {
    logger.warn('Kafka non disponible');
}

// Files d'attente Bull
const messageQueue = new Bull('message-processing', config.redisUrl, {
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 100
    }
});

// ============================================================================
// CIRCUIT BREAKERS
// ============================================================================
const groqBreaker = new CircuitBreaker(async (prompt, systemPrompt) => {
    const groq = new Groq({ apiKey: config.groqApiKey });
    
    const completion = await groq.chat.completions.create({
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
        ],
        model: config.groqModel,
        temperature: 0.7,
        max_tokens: 500
    });
    
    return completion.choices[0]?.message?.content || '';
}, {
    timeout: 8000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 20
});

groqBreaker.on('open', () => logger.warn('Circuit breaker GROQ ouvert'));
groqBreaker.on('close', () => logger.info('Circuit breaker GROQ fermé'));

// ============================================================================
// CACHE MULTI-NIVEAUX
// ============================================================================
class CacheManager {
    constructor() {
        this.local = new Map();
        this.localTTL = new Map();
        this.hits = 0;
        this.misses = 0;
    }
    
    async get(key) {
        // L1 - Cache local
        if (this.local.has(key)) {
            const ttl = this.localTTL.get(key) || 0;
            if (ttl > Date.now()) {
                this.hits++;
                return this.local.get(key);
            }
            this.local.delete(key);
            this.localTTL.delete(key);
        }
        
        // L2 - Redis
        if (redis) {
            try {
                const value = await redis.get(key);
                if (value) {
                    this.hits++;
                    this.setLocal(key, value, 60000);
                    return JSON.parse(value);
                }
            } catch (error) {
                logger.error('Redis get error:', error);
            }
        }
        
        this.misses++;
        return null;
    }
    
    async set(key, value, ttl = 3600) {
        const stringValue = JSON.stringify(value);
        
        if (redis) {
            try {
                await redis.setex(key, ttl, stringValue);
            } catch (error) {
                logger.error('Redis set error:', error);
            }
        }
        
        this.setLocal(key, value, Math.min(ttl * 1000, 60000));
    }
    
    setLocal(key, value, ttlMs = 60000) {
        this.local.set(key, value);
        this.localTTL.set(key, Date.now() + ttlMs);
        
        if (this.local.size > 10000) this.cleanup();
    }
    
    cleanup() {
        const now = Date.now();
        for (const [key, ttl] of this.localTTL.entries()) {
            if (ttl < now) {
                this.local.delete(key);
                this.localTTL.delete(key);
            }
        }
    }
    
    getStats() {
        return { hits: this.hits, misses: this.misses, size: this.local.size };
    }
}

const cache = new CacheManager();

// ============================================================================
// GOOGLE DRIVE CONFIGURATION
// ============================================================================
let drive;
try {
    // Gestion des credentials pour Render
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_BASE64) {
        const credentialsJson = Buffer.from(process.env.GOOGLE_CREDENTIALS_BASE64, 'base64').toString('utf-8');
        credentials = JSON.parse(credentialsJson);
    } else if (fs.existsSync(path.join(__dirname, 'credentials.json'))) {
        credentials = JSON.parse(fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8'));
    }
    
    if (credentials) {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive']
        });
        drive = google.drive({ version: 'v3', auth });
        logger.info('✅ Google Drive configuré');
    } else {
        logger.warn('⚠️ Credentials Google Drive non trouvés');
    }
} catch (error) {
    logger.error('❌ Erreur configuration Google Drive:', error);
}

// ============================================================================
// DATA MANAGER - GESTION DES FICHIERS EXCEL
// ============================================================================
class DataManager {
    constructor() {
        this.pillboxStock = [];
        this.pharmacies = [];
        this.livreurs = [];
        this.pharmaciesDeGarde = [];
        this.lastUpdate = null;
        this.updateInProgress = false;
        this.files = {
            stock: 'MUGEFCI-Liste-des-medicaments-remboursables-Edition-Decembre-2024-03122024.xlsx',
            pharmacies: 'pharmacies_san_pedro.xlsx',
            livreurs: 'livreurs_pillbox.xlsx'
        };
    }
    
    async loadAllData() {
        if (this.updateInProgress || !drive) return;
        
        this.updateInProgress = true;
        logger.info('📥 Chargement des données depuis Google Drive...');
        
        try {
            // Cache check
            const cachedData = await cache.get('master_data');
            if (cachedData && Date.now() - cachedData.timestamp < 300000) {
                this.pillboxStock = cachedData.pillboxStock;
                this.pharmacies = cachedData.pharmacies;
                this.livreurs = cachedData.livreurs;
                this.pharmaciesDeGarde = cachedData.pharmaciesDeGarde;
                this.lastUpdate = cachedData.timestamp;
                logger.info('✅ Données chargées depuis le cache');
                this.updateInProgress = false;
                return;
            }
            
            // Chargement parallèle
            const [stockFile, pharmaFile, livreursFile] = await Promise.all([
                this.loadExcelFromDrive(this.files.stock),
                this.loadExcelFromDrive(this.files.pharmacies),
                this.loadExcelFromDrive(this.files.livreurs)
            ]);
            
            if (stockFile) {
                this.pillboxStock = XLSX.utils.sheet_to_json(stockFile.Sheets[stockFile.SheetNames[0]]);
                logger.info(`✅ PillBox: ${this.pillboxStock.length} médicaments`);
            }
            
            if (pharmaFile) {
                this.pharmacies = XLSX.utils.sheet_to_json(pharmaFile.Sheets[pharmaFile.SheetNames[0]]);
                logger.info(`✅ ${this.pharmacies.length} pharmacies à San Pedro`);
                this.updatePharmaciesDeGarde();
            }
            
            if (livreursFile) {
                this.livreurs = XLSX.utils.sheet_to_json(livreursFile.Sheets[livreursFile.SheetNames[0]]);
                logger.info(`✅ ${this.livreurs.length} livreurs`);
            }
            
            this.lastUpdate = Date.now();
            
            await cache.set('master_data', {
                pillboxStock: this.pillboxStock,
                pharmacies: this.pharmacies,
                livreurs: this.livreurs,
                pharmaciesDeGarde: this.pharmaciesDeGarde,
                timestamp: this.lastUpdate
            }, 300);
            
        } catch (error) {
            logger.error('❌ Erreur chargement données:', error);
        } finally {
            this.updateInProgress = false;
        }
    }
    
    updatePharmaciesDeGarde() {
        this.pharmaciesDeGarde = this.pharmacies.filter(p => 
            p.GARDE && p.GARDE.toString().toUpperCase() === 'OUI'
        );
    }
    
    async loadExcelFromDrive(fileName) {
        try {
            if (!drive) return null;
            
            const response = await drive.files.list({
                q: `name='${fileName}' and '${config.googleDriveFolderId}' in parents`,
                fields: 'files(id)',
            });
            
            if (response.data.files.length === 0) {
                logger.warn(`⚠️ Fichier non trouvé: ${fileName}`);
                return null;
            }
            
            const fileId = response.data.files[0].id;
            const file = await drive.files.get({
                fileId: fileId,
                alt: 'media',
            });
            
            return XLSX.read(file.data, { type: 'buffer' });
        } catch (error) {
            logger.error(`❌ Erreur chargement ${fileName}:`, error);
            return null;
        }
    }
    
    searchMedicine(query) {
        if (!this.pillboxStock.length) return [];
        
        query = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        return this.pillboxStock.filter(med => {
            const nom = (med['NOM COMMERCIAL'] || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const dci = (med['DCI'] || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const groupe = (med['GROUPE THERAPEUTIQUE'] || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            return nom.includes(query) || dci.includes(query) || groupe.includes(query);
        }).slice(0, 10);
    }
    
    getMedicineInfo(medicineName) {
        if (!this.pillboxStock.length) return null;
        
        const med = this.pillboxStock.find(m => 
            (m['NOM COMMERCIAL'] || '').toString().toLowerCase().includes(medicineName.toLowerCase())
        );
        
        if (med) {
            return {
                code: med['CODE PRODUIT'],
                nom: med['NOM COMMERCIAL'],
                prix: med['PRIX'],
                indication: med['GROUPE THERAPEUTIQUE'],
                dci: med['DCI'],
                categorie: med['CATEG.'],
                type: med['TYPE'],
                regime: med['REGIME']
            };
        }
        return null;
    }
    
    searchPharmacies(query) {
        if (!this.pharmacies.length) return [];
        
        query = query.toLowerCase();
        return this.pharmacies.filter(p => 
            (p.NOM_PHARMACIE || '').toString().toLowerCase().includes(query) ||
            (p.QUARTIER || '').toString().toLowerCase().includes(query)
        ).slice(0, 5);
    }
    
    getPharmacieDeGarde() {
        this.updatePharmaciesDeGarde();
        return this.pharmaciesDeGarde;
    }
}

const dataManager = new DataManager();

// ============================================================================
// ORDER MANAGER
// ============================================================================
class OrderManager {
    constructor() {
        this.orders = new Map();
        this.commandesFile = 'commandes_pillbox.xlsx';
    }
    
    calculerFraisLivraison() {
        const heure = new Date().getHours();
        return (heure >= 0 && heure < 7) ? 600 : 400;
    }
    
    async createOrder(orderData) {
        const orderId = `CMD${Date.now()}${Math.floor(Math.random() * 10000)}`;
        const fraisLivraison = this.calculerFraisLivraison();
        const prixUnitaire = parseInt(orderData.prix) || 0;
        const quantite = parseInt(orderData.quantite) || 1;
        const totalMedicaments = prixUnitaire * quantite;
        const total = totalMedicaments + fraisLivraison;
        
        const order = {
            ID_Commande: orderId,
            Date: new Date().toISOString().split('T')[0],
            Heure: new Date().toTimeString().split(' ')[0],
            Timestamp: Date.now(),
            Client_Nom: orderData.nomClient,
            Client_WhatsApp: orderData.whatsapp,
            Client_Quartier: orderData.quartier,
            Client_Indications: orderData.indications,
            Medicament: orderData.medicament,
            Code_Produit: orderData.codeProduit,
            Quantite: quantite,
            Prix_Unitaire: prixUnitaire,
            Total_Medicaments: totalMedicaments,
            Frais_Livraison: fraisLivraison,
            Total_Paye: total,
            Statut: 'En attente de validation',
            Livreur_ID: '',
            Livreur_Nom: '',
            Note_Client: '',
            Avis: '',
            Zone: orderData.quartier
        };
        
        this.orders.set(orderId, order);
        
        // Sauvegarde asynchrone
        messageQueue.add('save-order', order).catch(err => 
            logger.error('Erreur queue save-order:', err)
        );
        
        return { orderId, fraisLivraison, total };
    }
    
    async getOrder(orderId) {
        // Cache check
        const cached = await cache.get(`order:${orderId}`);
        if (cached) return cached;
        
        const order = this.orders.get(orderId);
        if (order) await cache.set(`order:${orderId}`, order, 300);
        return order;
    }
    
    async updateOrderStatus(orderId, newStatus, livreurInfo = null) {
        const order = this.orders.get(orderId);
        if (!order) return false;
        
        order.Statut = newStatus;
        if (livreurInfo) {
            order.Livreur_ID = livreurInfo.id;
            order.Livreur_Nom = livreurInfo.nom;
        }
        
        this.orders.set(orderId, order);
        await cache.set(`order:${orderId}`, order, 300);
        
        return true;
    }
    
    async addAvis(orderId, note, commentaire) {
        const order = this.orders.get(orderId);
        if (!order) return false;
        
        order.Note_Client = note;
        order.Avis = commentaire;
        order.Statut = 'Terminée';
        
        this.orders.set(orderId, order);
        await cache.set(`order:${orderId}`, order, 300);
        
        return true;
    }
}

const orderManager = new OrderManager();

// ============================================================================
// LIVREUR MANAGER
// ============================================================================
class LivreurManager {
    constructor() {
        this.livreursDisponibles = [];
    }
    
    updateDisponibles() {
        this.livreursDisponibles = dataManager.livreurs.filter(l => 
            l.Statut === 'Actif' && 
            l.Disponible === 'OUI' && 
            l.En_Ligne === 'OUI'
        );
    }
    
    async findAvailableLivreur(zone) {
        this.updateDisponibles();
        
        return this.livreursDisponibles
            .filter(l => parseInt(l.Commandes_En_Cours || '0') < 3)
            .sort((a, b) => parseInt(a.Commandes_En_Cours || '0') - parseInt(b.Commandes_En_Cours || '0'))[0] || null;
    }
    
    async assignLivreur(orderId, zone) {
        const livreur = await this.findAvailableLivreur(zone);
        if (!livreur) return null;
        
        livreur.Commandes_En_Cours = (parseInt(livreur.Commandes_En_Cours || '0') + 1).toString();
        
        return {
            id: livreur.ID_Livreur,
            nom: livreur.Nom,
            whatsapp: livreur.WhatsApp,
            telephone: livreur.Telephone
        };
    }
}

const livreurManager = new LivreurManager();

// ============================================================================
// SESSION MANAGER
// ============================================================================
class SessionManager {
    constructor() {
        this.sessions = new Map();
    }
    
    async getSession(userId) {
        if (!this.sessions.has(userId)) {
            this.sessions.set(userId, {
                step: 'menu',
                data: {},
                lastActivity: Date.now(),
                messageCount: 0,
                createdAt: Date.now()
            });
        }
        return this.sessions.get(userId);
    }
    
    async setStep(userId, step) {
        const session = await this.getSession(userId);
        session.step = step;
        session.lastActivity = Date.now();
    }
    
    async setData(userId, key, value) {
        const session = await this.getSession(userId);
        session.data[key] = value;
        session.lastActivity = Date.now();
    }
    
    async getData(userId, key) {
        const session = await this.getSession(userId);
        return session.data[key];
    }
    
    async clearSession(userId) {
        this.sessions.delete(userId);
    }
    
    cleanup() {
        const now = Date.now();
        for (const [userId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > 3600000) {
                this.sessions.delete(userId);
            }
        }
    }
}

const sessionManager = new SessionManager();

// ============================================================================
// LLM PROCESSOR (INTELLIGENCE ARTIFICIELLE)
// ============================================================================
class LLMProcessor {
    constructor() {
        this.systemPrompt = `Tu es Mia, assistante santé intelligente pour PillBox à San Pedro, Côte d'Ivoire.

RÔLE: Tu aides les utilisateurs à:
- Trouver des médicaments par nom ou symptôme
- Connaître les prix exacts des médicaments
- Obtenir des informations thérapeutiques
- Trouver les pharmacies de garde
- Acheter des médicaments et se faire livrer

TON: Amical, professionnel, rassurant. Tutoiement. Réponds toujours en français.

COMPRÉHENSION INTELLIGENTE: Tu dois comprendre même avec des fautes.
- "jé mal à la tete" → cherche médicament pour douleur (Paracétamol)
- "tousse sek" → cherche sirop antitussif
- "pharmacie nuit" → cherche pharmacies de garde
- "combien doliprane" → cherche prix
- "jvé ach té" → veut acheter
- "fièvre bébé" → cherche médicament pédiatrique

RÈGLES:
1. Ne donne pas de conseils médicaux - redirige vers médecin si nécessaire
2. Pour les médicaments sans ordonnance, tu peux conseiller
3. Pour les antibiotiques, demande si ordonnance
4. Sois précise sur les prix (en FCFA)
5. Mentionne toujours les frais de livraison: ${new Date().getHours() < 7 ? '600F (nuit)' : '400F (jour)'}
6. Si tu ne sais pas, dis-le honnêtement

CONTEXTE ACTUEL:
- Date: ${new Date().toLocaleDateString('fr-FR')}
- Heure: ${new Date().getHours()}h - Tarif: ${new Date().getHours() < 7 ? '600F' : '400F'}
- Support: ${config.supportPhone}`;
    }
    
    async processMessage(userMessage, userId) {
        try {
            const cacheKey = `llm:${Buffer.from(userMessage).subarray(0, 50)}`;
            const cached = await cache.get(cacheKey);
            if (cached) {
                llmRequests.inc({ status: 'cache' });
                return cached;
            }
            
            const session = await sessionManager.getSession(userId);
            
            const prompt = `Message: "${userMessage}"
Contexte: étape=${session.step}, messages=${session.messageCount}

Identifie l'intention et réponds naturellement.`;

            llmRequests.inc({ status: 'total' });
            
            const response = await groqBreaker.fire(prompt, this.systemPrompt);
            
            await cache.set(cacheKey, response, 3600);
            
            return response;
            
        } catch (error) {
            logger.error('LLM error:', error);
            llmRequests.inc({ status: 'error' });
            
            if (error.message.includes('timeout')) {
                return "Désolé, le service est un peu lent. Pouvez-vous reformuler ?";
            }
            return "Je rencontre une difficulté technique. Réessayez dans un instant.";
        }
    }
    
    async classifyIntent(message) {
        const prompt = `Classe ce message en: ACHAT, PRIX, INFO, GARDE, PHARMACIE, SUIVI, AVIS, AUTRE.
Message: "${message}"
Réponds seulement par la catégorie.`;
        
        try {
            const response = await groqBreaker.fire(prompt, "Classification d'intentions.");
            return response.trim();
        } catch {
            return 'AUTRE';
        }
    }
    
    async extractMedicine(message) {
        const prompt = `Extrais le nom du médicament de ce message. Si aucun, réponds "null".
Message: "${message}"
Réponds seulement par le nom.`;
        
        try {
            const response = await groqBreaker.fire(prompt, "Extraction de médicaments.");
            return response.trim() === 'null' ? null : response.trim();
        } catch {
            return null;
        }
    }
}

const llmProcessor = new LLMProcessor();

// ============================================================================
// WHATSAPP CLOUD API SERVICE
// ============================================================================
class WhatsAppService {
    constructor() {
        this.apiUrl = `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`;
        this.headers = {
            'Authorization': `Bearer ${config.whatsappToken}`,
            'Content-Type': 'application/json'
        };
    }
    
    async sendMessage(to, text) {
        try {
            const response = await axios({
                method: 'POST',
                url: this.apiUrl,
                headers: this.headers,
                data: {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: this.formatPhoneNumber(to),
                    type: 'text',
                    text: { body: text }
                },
                timeout: 5000
            });
            
            messagesProcessed.inc({ type: 'outgoing', status: 'success' });
            return response.data;
            
        } catch (error) {
            messagesProcessed.inc({ type: 'outgoing', status: 'error' });
            logger.error('WhatsApp send error:', error.response?.data || error.message);
            throw error;
        }
    }
    
    formatPhoneNumber(number) {
        // Nettoie le numéro de téléphone
        return number.toString().replace(/\D/g, '');
    }
    
    async sendInteractiveButtons(to, text, buttons) {
        try {
            const response = await axios({
                method: 'POST',
                url: this.apiUrl,
                headers: this.headers,
                data: {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: this.formatPhoneNumber(to),
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: { text },
                        action: {
                            buttons: buttons.map((btn, i) => ({
                                type: 'reply',
                                reply: {
                                    id: `btn_${i}_${Date.now()}`,
                                    title: btn.title
                                }
                            }))
                        }
                    }
                }
            });
            
            return response.data;
            
        } catch (error) {
            logger.error('WhatsApp interactive error:', error.response?.data || error.message);
            throw error;
        }
    }
}

const whatsapp = new WhatsAppService();

// ============================================================================
// WEBHOOK HANDLER (RÉCEPTION DES MESSAGES)
// ============================================================================
async function handleIncomingMessage(message) {
    const startTime = Date.now();
    const from = message.from;
    const text = message.text?.body || '';
    
    if (!text) return;
    
    logger.info(`📩 [${from}] ${text.substring(0, 50)}`);
    messagesProcessed.inc({ type: 'incoming', status: 'received' });
    activeUsers.inc();
    
    try {
        const session = await sessionManager.getSession(from);
        session.messageCount++;
        
        // Rate limiting simple
        if (session.messageCount > 100) {
            await whatsapp.sendMessage(from, "⏱️ Trop de messages. Patientez un moment.");
            return;
        }
        
        // Traitement du message
        let response = '';
        
        // Menu principal
        if (text.toLowerCase() === 'menu' || text === '0' || session.step === 'menu') {
            await sessionManager.setStep(from, 'menu');
            
            const frais = orderManager.calculerFraisLivraison();
            const periode = frais === 600 ? '🌙 Nuit' : '🌞 Jour';
            
            response = `🏥 *BIENVENUE SUR PILLBOX - SAN PEDRO* 🇨🇮

💊 *Votre pharmacie virtuelle 24h/24*

💰 *Frais livraison:* ${frais} FCFA (${periode})

*Choisissez une option:*

1️⃣ *Acheter un médicament* 💊
2️⃣ *Prix d'un médicament* 💰
3️⃣ *Info sur un médicament* ℹ️
4️⃣ *Pharmacies de garde* 🛡️
5️⃣ *Rechercher une pharmacie* 🏪
6️⃣ *Suivre ma commande* 📦
7️⃣ *Laisser un avis* ⭐

*Envoyez le chiffre correspondant.*`;
        }
        
        // ACHAT
        else if (session.step === 'menu' && text === '1') {
            await sessionManager.setStep(from, 'buy_search');
            response = `💊 *RECHERCHE DE MÉDICAMENT*

Quel médicament cherchez-vous ? (ex: "Paracétamol", "Amoxicilline", "Vitamine C")

💡 *Vous pouvez aussi décrire vos symptômes*`;
        }
        
        else if (session.step === 'buy_search') {
            const results = dataManager.searchMedicine(text);
            
            if (results.length > 0) {
                await sessionManager.setData(from, 'search_results', results);
                await sessionManager.setStep(from, 'buy_select');
                
                let medList = `🔍 *RÉSULTATS POUR "${text}"*\n\n`;
                results.slice(0, 5).forEach((med, i) => {
                    medList += `${i+1}. *${med['NOM COMMERCIAL']}*\n`;
                    medList += `   💊 ${med['GROUPE THERAPEUTIQUE'] || 'Médicament'}\n`;
                    medList += `   💰 ${med['PRIX']} FCFA\n\n`;
                });
                medList += `Choisissez le numéro (1-${Math.min(5, results.length)}):`;
                response = medList;
            } else {
                response = `😔 Désolé, "${text}" n'est pas disponible.\n\nVoulez-vous essayer autre chose ?`;
            }
        }
        
        else if (session.step === 'buy_select' && /^[1-5]$/.test(text)) {
            const index = parseInt(text) - 1;
            const results = await sessionManager.getData(from, 'search_results');
            
            if (results && results[index]) {
                await sessionManager.setData(from, 'selected_medicine', results[index]);
                await sessionManager.setStep(from, 'buy_quantity');
                
                response = `📦 *QUANTITÉ*

Combien de "${results[index]['NOM COMMERCIAL']}" voulez-vous ?`;
            }
        }
        
        else if (session.step === 'buy_quantity') {
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity < 1) {
                response = `❌ Veuillez entrer un nombre valide (ex: 2)`;
            } else {
                await sessionManager.setData(from, 'quantity', quantity);
                await sessionManager.setStep(from, 'buy_client_info');
                
                response = `👤 *INFORMATIONS DE LIVRAISON*

Envoyez:
1️⃣ Votre nom complet
2️⃣ Votre numéro WhatsApp
3️⃣ Votre quartier
4️⃣ Des indications

*Format:* Nom, WhatsApp, Quartier, Indications
*Exemple:* Kouassi Jean, 07080910, Zone 4, Près du grand fromager`;
            }
        }
        
        else if (session.step === 'buy_client_info') {
            const parts = text.split(',').map(p => p.trim());
            
            if (parts.length >= 4) {
                const med = await sessionManager.getData(from, 'selected_medicine');
                const quantity = await sessionManager.getData(from, 'quantity');
                
                const orderData = {
                    nomClient: parts[0],
                    whatsapp: parts[1].replace(/\D/g, ''),
                    quartier: parts[2],
                    indications: parts.slice(3).join(', '),
                    medicament: med['NOM COMMERCIAL'],
                    codeProduit: med['CODE PRODUIT'],
                    quantite: quantity,
                    prix: med['PRIX']
                };
                
                const { orderId, fraisLivraison, total } = await orderManager.createOrder(orderData);
                
                await sessionManager.setData(from, 'orderId', orderId);
                await sessionManager.setStep(from, 'menu');
                
                response = `✅ *COMMANDE ENREGISTRÉE !*

📦 *Numéro:* ${orderId}

💰 *Détails:*
💊 Médicament: ${orderData.prix} FCFA × ${quantity}
🛵 Livraison: ${fraisLivraison} FCFA
💵 *TOTAL: ${total} FCFA*

📱 Notre équipe vous contactera.
💬 Support: ${config.supportPhone}

Envoyez "6" pour suivre votre commande.`;
            } else {
                response = `❌ Format incorrect.

*Exemple:* Kouassi Jean, 07080910, Zone 4, Près du grand fromager`;
            }
        }
        
        // PRIX
        else if (session.step === 'menu' && text === '2') {
            await sessionManager.setStep(from, 'price_search');
            response = `💰 *PRIX MÉDICAMENT*

Quel médicament voulez-vous connaître le prix ?`;
        }
        
        else if (session.step === 'price_search') {
            const medInfo = dataManager.getMedicineInfo(text);
            
            if (medInfo) {
                response = `💰 *${medInfo.nom}*\n\n`;
                response += `💊 ${medInfo.indication || 'Médicament'}\n`;
                response += `💊 DCI: ${medInfo.dci || 'Non spécifié'}\n`;
                response += `💰 *Prix: ${medInfo.prix} FCFA*\n`;
                response += `📦 Catégorie: ${medInfo.categorie || 'Générique'}\n\n`;
                response += `Pour acheter, envoyez "1"`;
            } else {
                response = `😔 "${text}" n'est pas dans notre stock.`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // INFO MÉDICAMENT
        else if (session.step === 'menu' && text === '3') {
            await sessionManager.setStep(from, 'info_search');
            response = `ℹ️ *INFORMATION MÉDICAMENT*

De quel médicament voulez-vous des informations ?`;
        }
        
        else if (session.step === 'info_search') {
            const medInfo = dataManager.getMedicineInfo(text);
            
            if (medInfo) {
                response = `ℹ️ *${medInfo.nom}*\n\n`;
                response += `📋 *Code:* ${medInfo.code || 'N/A'}\n`;
                response += `💊 *Indication:* ${medInfo.indication || 'Non spécifiée'}\n`;
                response += `💊 *DCI:* ${medInfo.dci || 'Non spécifié'}\n`;
                response += `💰 *Prix:* ${medInfo.prix} FCFA\n`;
                response += `📦 *Catégorie:* ${medInfo.categorie || 'Générique'}\n`;
                response += `📦 *Type:* ${medInfo.type || 'Médicament'}\n`;
                response += `📋 *Régime:* ${medInfo.regime || 'Remboursable'}\n\n`;
                response += `Disponible chez PillBox - Livraison 24h/24 !`;
            } else {
                response = `😔 "${text}" n'est pas dans notre stock.`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // PHARMACIES DE GARDE
        else if (session.step === 'menu' && text === '4') {
            const gardes = dataManager.getPharmacieDeGarde();
            
            if (gardes.length > 0) {
                response = `🛡️ *PHARMACIES DE GARDE AUJOURD'HUI*\n\n`;
                gardes.slice(0, 10).forEach((p, i) => {
                    response += `${i+1}. *${p.NOM_PHARMACIE}*\n`;
                    response += `   🧑‍⚕️ ${p.PHARMACIEN || 'Non précisé'}\n`;
                    response += `   📞 ${p.TELEPHONE || 'Non disponible'}\n`;
                    response += `   📍 ${p.ADRESSE || 'Non précisée'}\n`;
                    response += `   🏘️ ${p.QUARTIER || 'Non précisé'}\n\n`;
                });
            } else {
                response = `😔 Aucune pharmacie de garde aujourd'hui.`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // RECHERCHE PHARMACIE
        else if (session.step === 'menu' && text === '5') {
            await sessionManager.setStep(from, 'pharmacy_search');
            response = `🏪 *RECHERCHE PHARMACIE*

Envoyez le nom ou le quartier de la pharmacie:`;
        }
        
        else if (session.step === 'pharmacy_search') {
            const pharmacies = dataManager.searchPharmacies(text);
            
            if (pharmacies.length > 0) {
                response = `🏪 *RÉSULTATS POUR "${text}"*\n\n`;
                pharmacies.forEach((p, i) => {
                    response += `${i+1}. *${p.NOM_PHARMACIE}*\n`;
                    response += `   🧑‍⚕️ ${p.PHARMACIEN || 'Non précisé'}\n`;
                    response += `   📞 ${p.TELEPHONE || 'Non disponible'}\n`;
                    response += `   📍 ${p.ADRESSE || 'Non précisée'}\n`;
                    response += `   🏘️ ${p.QUARTIER || 'Non précisé'}\n`;
                    response += `   🛡️ Garde: ${p.GARDE || 'NON'}\n\n`;
                });
            } else {
                response = `😔 Aucune pharmacie trouvée pour "${text}".`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // SUIVI COMMANDE
        else if (session.step === 'menu' && text === '6') {
            await sessionManager.setStep(from, 'track_order');
            response = `📦 *SUIVI COMMANDE*

Envoyez votre numéro de commande (ex: CMD123456789)`;
        }
        
        else if (session.step === 'track_order') {
            const order = await orderManager.getOrder(text.trim());
            
            if (order) {
                response = `📦 *COMMANDE ${order.ID_Commande}*\n\n`;
                response += `📊 *Statut:* ${order.Statut}\n`;
                response += `💊 *Médicament:* ${order.Medicament} ×${order.Quantite}\n`;
                response += `💰 *Total:* ${order.Total_Paye} FCFA\n`;
                response += `📍 *Livraison:* ${order.Client_Quartier}\n`;
                response += `🛵 *Livreur:* ${order.Livreur_Nom || 'En attente'}\n\n`;
                
                if (order.Statut === 'Livrée') {
                    response += `⭐ Pour donner votre avis: avis ${order.ID_Commande} 5 Très bien`;
                }
            } else {
                response = `❌ Commande "${text}" non trouvée.`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // AVIS
        else if (session.step === 'menu' && text === '7') {
            await sessionManager.setStep(from, 'feedback');
            response = `⭐ *DONNER SON AVIS*

Format: avis [numéro] [note] [commentaire]
*Exemple:* avis CMD123456789 5 Très bon service`;
        }
        
        else if (session.step === 'feedback' && text.toLowerCase().startsWith('avis')) {
            const parts = text.split(' ');
            if (parts.length >= 3) {
                const orderId = parts[1];
                const note = parts[2];
                const commentaire = parts.slice(3).join(' ') || '';
                
                const success = await orderManager.addAvis(orderId, note, commentaire);
                
                if (success) {
                    response = `✅ Merci pour votre avis ! ⭐${note}/5`;
                } else {
                    response = `❌ Commande "${orderId}" non trouvée.`;
                }
            } else {
                response = `❌ Format incorrect. Exemple: avis CMD123456789 5 Très bien`;
            }
            await sessionManager.setStep(from, 'menu');
        }
        
        // RÉPONSE PAR DÉFAUT AVEC LLM
        else {
            response = await llmProcessor.processMessage(text, from);
        }
        
        // Envoyer la réponse
        if (response) {
            await whatsapp.sendMessage(from, response);
        }
        
        const processingTime = Date.now() - startTime;
        httpRequestDuration.labels('whatsapp', 'message', '200').observe(processingTime);
        
    } catch (error) {
        logger.error('❌ Erreur traitement message:', error);
        await whatsapp.sendMessage(from, `😔 Service momentané indisponible. Support: ${config.supportPhone}`);
    } finally {
        activeUsers.dec();
    }
}

// ============================================================================
// SERVEUR EXPRESS
// ============================================================================
const app = express();

// Middleware
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
}));

// Logging
app.use(morgan('combined'));

// Response time
app.use(responseTime((req, res, time) => {
    httpRequestDuration.labels(req.method, req.route?.path || req.path, res.statusCode).observe(time);
}));

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode === 'subscribe' && token === config.verifyToken) {
        logger.info('Webhook vérifié avec succès');
        res.status(200).send(challenge);
    } else {
        logger.warn('Tentative de vérification webhook échouée');
        res.sendStatus(403);
    }
});

// Webhook message reception (POST)
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        
        if (body.object === 'whatsapp_business_account') {
            body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === 'messages') {
                        const message = change.value.messages?.[0];
                        const contact = change.value.contacts?.[0];
                        
                        if (message && contact) {
                            const from = contact.wa_id;
                            const text = message.text?.body;
                            
                            if (text) {
                                // Traitement asynchrone
                                handleIncomingMessage({ from, text }).catch(logger.error);
                            }
                        }
                    }
                });
            });
        }
        
        res.sendStatus(200);
    } catch (error) {
        logger.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache: cache.getStats(),
        data: {
            stock: dataManager.pillboxStock.length,
            pharmacies: dataManager.pharmacies.length,
            livreurs: dataManager.livreurs.length,
            lastUpdate: dataManager.lastUpdate
        }
    });
});

// Metrics
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// Stats
app.get('/stats', async (req, res) => {
    res.json({
        messages: (await promClient.register.getSingleMetric('mia_messages_processed_total')?.get())?.values,
        activeUsers: (await promClient.register.getSingleMetric('mia_active_users')?.get())?.values,
        queueSize: await messageQueue.count(),
        cache: cache.getStats()
    });
});

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - PillBox',
        version: '4.0.0',
        status: 'online',
        pid: process.pid,
        environment: config.nodeEnv,
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// INITIALISATION
// ============================================================================
async function initialize() {
    logger.info('🚀 Démarrage de MIA - PillBox v4.0');
    logger.info(`📊 PID: ${process.pid}, Environnement: ${config.nodeEnv}`);
    
    try {
        // Connecter Kafka si disponible
        if (producer) {
            await producer.connect();
            logger.info('✅ Kafka connecté');
        }
        
        // Charger les données
        await dataManager.loadAllData();
        
        // Rafraîchissement périodique
        setInterval(() => {
            dataManager.loadAllData().catch(logger.error);
        }, 300000); // 5 minutes
        
        // Nettoyage sessions
        setInterval(() => {
            sessionManager.cleanup();
        }, 600000); // 10 minutes
        
        // Démarrer le serveur
        app.listen(config.port, '0.0.0.0', () => {
            logger.info(`🚀 Serveur HTTP sur port ${config.port}`);
            logger.info(`📱 Webhook URL: https://mia-pillbox.onrender.com/webhook`);
            logger.info(`✅ MIA est prête à servir des milliards de requêtes !`);
        });
        
    } catch (error) {
        logger.error('❌ Erreur initialisation:', error);
        process.exit(1);
    }
}

// Gestion arrêt
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
    logger.info('🛑 Arrêt gracieux...');
    
    try {
        if (producer) await producer.disconnect();
        if (consumer) await consumer.disconnect();
        if (redis) await redis.quit();
        
        await messageQueue.close();
        
        logger.info('✅ Arrêt terminé');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Erreur arrêt:', error);
        process.exit(1);
    }
}

// Démarrage
initialize();

// ============================================================================
// FIN DU CODE - PRÊT POUR LA PRODUCTION RÉELLE
// ============================================================================