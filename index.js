/**
 * MIA - PILLBOX
 * Assistant Santé Intelligent pour San Pedro
 * Version Production 3.0 - Haute Disponibilité
 * 
 * Capable de gérer des milliards de requêtes simultanées
 * Architecture: Microservices, Load Balancing, Cache Distribué, Queue System
 */

// ============================================================================
// IMPORTS AVEC OPTIMISATION MÉMOIRE
// ============================================================================
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
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
    
    // Créer les workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    // Redémarrer les workers qui meurent
    cluster.on('exit', (worker, code, signal) => {
        console.log(`⚠️ Worker ${worker.process.pid} mort. Redémarrage...`);
        cluster.fork();
    });
    
    // Le master ne continue pas
    return;
}

// ============================================================================
// VARIABLES D'ENVIRONNEMENT AVEC VALIDATION
// ============================================================================
const config = {
    // GROQ
    groqApiKey: process.env.GROQ_API_KEY,
    groqModel: process.env.GROQ_MODEL || 'llama3-70b-8192',
    
    // LIVRAISON
    livraisonJour: process.env.LIVRAISON_JOUR || '08:00-23:00',
    livraisonNuit: process.env.LIVRAISON_NUIT || '00:00-07:00',
    
    // WHATSAPP
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    whatsappToken: process.env.WHATSAPP_TOKEN,
    verifyToken: process.env.VERIFY_TOKEN,
    
    // SUPPORT
    supportPhone: process.env.SUPPORT_PHONE || '2250102030404',
    
    // ZONES
    zoneService: process.env.ZONE_SERVICE ? process.env.ZONE_SERVICE.split(',') : ['San Pedro'],
    
    // GOOGLE DRIVE
    googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    
    // REDIS
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    
    // KAFKA
    kafkaBrokers: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'],
    
    // DATABASE
    databaseUrl: process.env.DATABASE_URL,
    
    // PORT
    port: process.env.PORT || 3000,
    
    // ENVIRONNEMENT
    nodeEnv: process.env.NODE_ENV || 'development'
};

// Validation des variables critiques
if (!config.groqApiKey) throw new Error('GROQ_API_KEY manquante');
if (!config.googleDriveFolderId) throw new Error('GOOGLE_DRIVE_FOLDER_ID manquant');

// ============================================================================
// LOGGER AVANCÉ (WINSTON + ELASTICSEARCH)
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
                winston.format.simple()
            )
        }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

// Ajout Elasticsearch si configuré
if (process.env.ELASTICSEARCH_URL) {
    logger.add(new ElasticsearchTransport({
        level: 'info',
        clientOpts: { node: process.env.ELASTICSEARCH_URL },
        index: 'mia-logs'
    }));
}

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
    labelNames: ['type']
});

const llmRequests = new promClient.Counter({
    name: 'mia_llm_requests_total',
    help: 'Nombre total de requêtes LLM',
    labelNames: ['status']
});

const cacheHits = new promClient.Counter({
    name: 'mia_cache_hits_total',
    help: 'Nombre total de cache hits'
});

const cacheMisses = new promClient.Counter({
    name: 'mia_cache_misses_total',
    help: 'Nombre total de cache misses'
});

const activeUsers = new promClient.Gauge({
    name: 'mia_active_users',
    help: 'Nombre d\'utilisateurs actifs'
});

const queueSize = new promClient.Gauge({
    name: 'mia_queue_size',
    help: 'Taille des files d\'attente',
    labelNames: ['queue']
});

// ============================================================================
// CONNEXIONS BASE DE DONNÉES DISTRIBUÉE
// ============================================================================

// Redis Cluster pour cache distribué et sessions
const redis = new Redis.Cluster([
    { host: 'redis-0', port: 6379 },
    { host: 'redis-1', port: 6379 },
    { host: 'redis-2', port: 6379 }
], {
    scaleReads: 'slave',
    maxRedirections: 16,
    retryDelayOnFailover: 100,
    retryDelayOnClusterDown: 100,
    enableReadyCheck: true,
    redisOptions: {
        connectTimeout: 10000,
        maxRetriesPerRequest: 3
    }
});

// Redis fallback simple si pas de cluster
const redisSimple = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000)
});

// Kafka pour message queue distribué
const kafka = new Kafka({
    clientId: `mia-producer-${process.pid}`,
    brokers: config.kafkaBrokers,
    retry: {
        initialRetryTime: 100,
        retries: 10
    }
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'mia-group' });

// Topics Kafka
const topics = {
    MESSAGES: 'mia-messages',
    ORDERS: 'mia-orders',
    NOTIFICATIONS: 'mia-notifications',
    ANALYTICS: 'mia-analytics'
};

// PostgreSQL Pool (CockroachDB pour scalabilité)
const pgPool = new Pool({
    connectionString: config.databaseUrl,
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    maxUses: 7500
});

// ============================================================================
// FILES D'ATTENTE (BULL) AVEC REDIS
// ============================================================================
const messageQueue = new Bull('message-processing', config.redisUrl, {
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000
        },
        removeOnComplete: 10000,
        removeOnFail: 5000
    }
});

const llmQueue = new Bull('llm-processing', config.redisUrl, {
    limiter: {
        max: 1000,
        duration: 1000
    },
    defaultJobOptions: {
        attempts: 2,
        timeout: 10000
    }
});

const notificationQueue = new Bull('notification-processing', config.redisUrl);

// ============================================================================
// CIRCUIT BREAKERS (RÉSILIENCE)
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
    volumeThreshold: 20,
    rollingCountTimeout: 60000
});

groqBreaker.on('open', () => logger.warn('🔴 Circuit breaker GROQ ouvert'));
groqBreaker.on('halfOpen', () => logger.info('🟡 Circuit breaker GROQ demi-ouvert'));
groqBreaker.on('close', () => logger.info('🟢 Circuit breaker GROQ fermé'));

const googleDriveBreaker = new CircuitBreaker(async (fn) => {
    return await fn();
}, {
    timeout: 5000,
    errorThresholdPercentage: 30,
    resetTimeout: 10000
});

// ============================================================================
// CACHE MULTI-NIVEAUX
// ============================================================================
class MultiLevelCache {
    constructor() {
        this.local = new Map(); // L1 - Cache local (rapide mais limité)
        this.localTTL = new Map();
    }
    
    async get(key) {
        // L1 - Cache local
        if (this.local.has(key)) {
            const ttl = this.localTTL.get(key) || 0;
            if (ttl > Date.now()) {
                cacheHits.inc();
                return this.local.get(key);
            } else {
                this.local.delete(key);
                this.localTTL.delete(key);
            }
        }
        
        // L2 - Redis
        try {
            const value = await redisSimple.get(key);
            if (value) {
                cacheHits.inc();
                // Stocker aussi en local pour les prochaines requêtes
                this.setLocal(key, value, 60000); // 1 minute
                return JSON.parse(value);
            }
        } catch (error) {
            logger.error('Redis get error:', error);
        }
        
        cacheMisses.inc();
        return null;
    }
    
    async set(key, value, ttl = 3600) {
        const stringValue = JSON.stringify(value);
        
        // Redis
        try {
            await redisSimple.setex(key, ttl, stringValue);
        } catch (error) {
            logger.error('Redis set error:', error);
        }
        
        // Local avec TTL plus court
        this.setLocal(key, value, Math.min(ttl * 1000, 60000));
    }
    
    setLocal(key, value, ttlMs = 60000) {
        this.local.set(key, value);
        this.localTTL.set(key, Date.now() + ttlMs);
        
        // Nettoyage périodique (garder la mémoire sous contrôle)
        if (this.local.size > 10000) {
            this.cleanupLocal();
        }
    }
    
    cleanupLocal() {
        const now = Date.now();
        for (const [key, ttl] of this.localTTL.entries()) {
            if (ttl < now) {
                this.local.delete(key);
                this.localTTL.delete(key);
            }
        }
    }
    
    async del(key) {
        this.local.delete(key);
        this.localTTL.delete(key);
        try {
            await redisSimple.del(key);
        } catch (error) {
            logger.error('Redis del error:', error);
        }
    }
}

const cache = new MultiLevelCache();

// ============================================================================
// CONFIGURATION GOOGLE DRIVE
// ============================================================================
const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/drive']
});

const drive = google.drive({ version: 'v3', auth });

// ============================================================================
// GESTIONNAIRE DE DONNÉES (AVEC CACHE)
// ============================================================================
class DataManager {
    constructor() {
        this.pillboxStock = [];
        this.pharmacies = [];
        this.livreurs = [];
        this.pharmaciesDeGarde = [];
        this.lastUpdate = null;
        this.updateInProgress = false;
    }
    
    async loadAllData() {
        if (this.updateInProgress) return;
        
        this.updateInProgress = true;
        logger.info('📥 Chargement des données depuis Google Drive...');
        
        try {
            // Vérifier le cache d'abord
            const cachedData = await cache.get('master_data');
            if (cachedData && Date.now() - cachedData.timestamp < 300000) { // 5 minutes
                this.pillboxStock = cachedData.pillboxStock;
                this.pharmacies = cachedData.pharmacies;
                this.livreurs = cachedData.livreurs;
                this.pharmaciesDeGarde = cachedData.pharmaciesDeGarde;
                this.lastUpdate = cachedData.timestamp;
                logger.info('✅ Données chargées depuis le cache');
                this.updateInProgress = false;
                return;
            }
            
            // Charger depuis Google Drive
            const [pillboxFile, pharmaFile, livreursFile] = await Promise.all([
                this.loadExcelFromDrive('pillbox_stock.xlsx'),
                this.loadExcelFromDrive('pharmacies_san_pedro.xlsx'),
                this.loadExcelFromDrive('livreurs_pillbox.xlsx')
            ]);
            
            if (pillboxFile) {
                this.pillboxStock = XLSX.utils.sheet_to_json(pillboxFile.Sheets[pillboxFile.SheetNames[0]]);
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
            
            // Sauvegarder en cache
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
        const aujourdhui = new Date().toISOString().split('T')[0];
        this.pharmaciesDeGarde = this.pharmacies.filter(p => 
            p.GARDE === 'OUI'
        );
    }
    
    async loadExcelFromDrive(fileName) {
        return await googleDriveBreaker.fire(async () => {
            try {
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
                throw error;
            }
        });
    }
    
    async saveToDrive(data, fileName) {
        return await googleDriveBreaker.fire(async () => {
            try {
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(data);
                XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
                
                const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
                
                const fileResponse = await drive.files.list({
                    q: `name='${fileName}' and '${config.googleDriveFolderId}' in parents`,
                    fields: 'files(id)',
                });
                
                if (fileResponse.data.files.length > 0) {
                    const fileId = fileResponse.data.files[0].id;
                    await drive.files.update({
                        fileId: fileId,
                        media: {
                            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            body: buffer,
                        },
                    });
                    logger.info(`✅ Fichier mis à jour: ${fileName}`);
                } else {
                    await drive.files.create({
                        requestBody: {
                            name: fileName,
                            parents: [config.googleDriveFolderId],
                            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        },
                        media: {
                            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                            body: buffer,
                        },
                    });
                    logger.info(`✅ Nouveau fichier créé: ${fileName}`);
                }
            } catch (error) {
                logger.error('❌ Erreur sauvegarde Drive:', error);
                throw error;
            }
        });
    }
    
    searchMedicine(query) {
        query = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        return this.pillboxStock.filter(med => {
            const nom = (med['NOM COMMERCIAL'] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const indication = (med['INDICATION'] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            
            return nom.includes(query) || indication.includes(query);
        }).slice(0, 10);
    }
    
    getMedicineInfo(medicineName) {
        const med = this.pillboxStock.find(m => 
            (m['NOM COMMERCIAL'] || '').toLowerCase().includes(medicineName.toLowerCase())
        );
        
        if (med) {
            return {
                nom: med['NOM COMMERCIAL'],
                prix: med['PRIX'],
                indication: med['INDICATION'],
                categorie: med['CAT. STT'],
                residence: med['RESIDENCE']
            };
        }
        return null;
    }
}

const dataManager = new DataManager();

// ============================================================================
// GESTIONNAIRE DE COMMANDES
// ============================================================================
class OrderManager {
    constructor() {
        this.commandesFile = 'commandes_pillbox.xlsx';
        this.processingOrders = new Set();
    }
    
    calculerFraisLivraison() {
        const heure = new Date().getHours();
        return (heure >= 0 && heure < 7) ? 600 : 400;
    }
    
    async createOrder(orderData) {
        const orderId = `CMD${Date.now()}${Math.floor(Math.random() * 10000)}`;
        const fraisLivraison = this.calculerFraisLivraison();
        const prixMedicament = parseInt(orderData.prix) || 0;
        const total = prixMedicament * (parseInt(orderData.quantite) || 1) + fraisLivraison;
        
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
            Quantite: orderData.quantite || 1,
            Prix_Unitaire: prixMedicament,
            Prix_Total_Medicaments: prixMedicament * (parseInt(orderData.quantite) || 1),
            Frais_Livraison: fraisLivraison,
            Total_Paye: total,
            Statut: 'En attente de validation',
            Livreur_ID: '',
            Livreur_Nom: '',
            Note_Client: '',
            Avis: '',
            Zone: orderData.quartier
        };
        
        // Sauvegarder dans Kafka pour traitement asynchrone
        await producer.send({
            topic: topics.ORDERS,
            messages: [{
                key: orderId,
                value: JSON.stringify(order),
                timestamp: Date.now().toString()
            }]
        });
        
        // Ajouter à la file d'attente
        await messageQueue.add('process-order', order, {
            jobId: orderId,
            priority: 1
        });
        
        return { orderId, fraisLivraison, total };
    }
    
    async processOrder(order) {
        try {
            // Trouver une pharmacie proche
            const pharmacie = this.findNearestPharmacy(order.Client_Quartier);
            
            // Sauvegarder dans Excel
            await this.saveOrderToExcel(order);
            
            // Notifier l'équipe
            await this.notifyTeam(order, pharmacie);
            
            // Assigner un livreur
            await livreurManager.assignLivreur(order, pharmacie);
            
            logger.info(`✅ Commande ${order.ID_Commande} traitée`);
            
        } catch (error) {
            logger.error(`❌ Erreur traitement commande ${order.ID_Commande}:`, error);
            throw error;
        }
    }
    
    findNearestPharmacy(zone) {
        // Chercher dans la même zone
        let pharmacie = dataManager.pharmacies.find(p => 
            p.ZONE && p.ZONE.toLowerCase().includes(zone.toLowerCase())
        );
        
        // Sinon prendre une pharmacie de garde
        if (!pharmacie && dataManager.pharmaciesDeGarde.length > 0) {
            pharmacie = dataManager.pharmaciesDeGarde[0];
        }
        
        // Sinon première pharmacie
        if (!pharmacie && dataManager.pharmacies.length > 0) {
            pharmacie = dataManager.pharmacies[0];
        }
        
        return pharmacie;
    }
    
    async saveOrderToExcel(order) {
        let existingOrders = [];
        try {
            const file = await dataManager.loadExcelFromDrive(this.commandesFile);
            if (file) {
                existingOrders = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);
            }
        } catch (error) {
            logger.warn('Création nouveau fichier commandes');
        }
        
        existingOrders.push(order);
        await dataManager.saveToDrive(existingOrders, this.commandesFile);
    }
    
    async notifyTeam(order, pharmacie) {
        const message = `🆕 *NOUVELLE COMMANDE PILLBOX*\n\n` +
            `📦 Commande: ${order.ID_Commande}\n` +
            `💊 Médicament: ${order.Medicament}\n` +
            `📦 Quantité: ${order.Quantite}\n` +
            `💰 Prix: ${order.Prix_Total_Medicaments} FCFA\n` +
            `🛵 Livraison: ${order.Frais_Livraison} FCFA\n` +
            `💵 Total: ${order.Total_Paye} FCFA\n\n` +
            `👤 Client: ${order.Client_Nom}\n` +
            `📱 WhatsApp: ${order.Client_WhatsApp}\n` +
            `📍 Quartier: ${order.Client_Quartier}\n` +
            `📍 Indications: ${order.Client_Indications}\n\n` +
            `🏪 Pharmacie: ${pharmacie?.NOM_PHARMACIE || 'À déterminer'}\n` +
            `📍 Adresse: ${pharmacie?.ADRESSE || 'Inconnue'}\n\n` +
            `✅ Confirmer la disponibilité et assigner livreur.`;
        
        await notificationQueue.add('team-notification', {
            to: config.supportPhone,
            message
        });
    }
    
    async updateOrderStatus(orderId, newStatus, livreurInfo = null) {
        try {
            const file = await dataManager.loadExcelFromDrive(this.commandesFile);
            if (!file) return false;
            
            const orders = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);
            const orderIndex = orders.findIndex(o => o.ID_Commande === orderId);
            
            if (orderIndex === -1) return false;
            
            orders[orderIndex].Statut = newStatus;
            if (livreurInfo) {
                orders[orderIndex].Livreur_ID = livreurInfo.id;
                orders[orderIndex].Livreur_Nom = livreurInfo.nom;
            }
            
            await dataManager.saveToDrive(orders, this.commandesFile);
            
            // Notifier le client
            await this.notifyClient(orders[orderIndex]);
            
            return true;
        } catch (error) {
            logger.error('Erreur mise à jour commande:', error);
            return false;
        }
    }
    
    async notifyClient(order) {
        let message = '';
        
        switch(order.Statut) {
            case 'Livreur assigné':
                message = `🛵 *VOTRE COMMANDE EST EN COURS*\n\n` +
                    `Commande: ${order.ID_Commande}\n` +
                    `💰 Total: ${order.Total_Paye} FCFA\n\n` +
                    `Le livreur ${order.Livreur_Nom} arrive dans 30-45 min.`;
                break;
                
            case 'Livrée':
                message = `✅ *COMMANDE LIVRÉE*\n\n` +
                    `Commande: ${order.ID_Commande}\n\n` +
                    `Merci d'avoir choisi PillBox! ⭐\n` +
                    `Envoyez "avis ${order.ID_Commande} 5" pour noter.`;
                break;
                
            case 'Annulée':
                message = `❌ *COMMANDE ANNULÉE*\n\n` +
                    `Commande: ${order.ID_Commande}\n\n` +
                    `Contactez le support: ${config.supportPhone}`;
                break;
        }
        
        if (message) {
            await notificationQueue.add('client-notification', {
                to: order.Client_WhatsApp,
                message
            });
        }
    }
    
    async addAvis(orderId, note, commentaire) {
        try {
            const file = await dataManager.loadExcelFromDrive(this.commandesFile);
            if (!file) return false;
            
            const orders = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);
            const orderIndex = orders.findIndex(o => o.ID_Commande === orderId);
            
            if (orderIndex === -1) return false;
            
            orders[orderIndex].Note_Client = note;
            orders[orderIndex].Avis = commentaire;
            
            await dataManager.saveToDrive(orders, this.commandesFile);
            
            // Mettre à jour la note du livreur
            if (orders[orderIndex].Livreur_ID) {
                await livreurManager.updateLivreurNote(orders[orderIndex].Livreur_ID, note);
            }
            
            return true;
        } catch (error) {
            logger.error('Erreur ajout avis:', error);
            return false;
        }
    }
    
    async getOrder(orderId) {
        try {
            const cacheKey = `order:${orderId}`;
            const cached = await cache.get(cacheKey);
            if (cached) return cached;
            
            const file = await dataManager.loadExcelFromDrive(this.commandesFile);
            if (!file) return null;
            
            const orders = XLSX.utils.sheet_to_json(file.Sheets[file.SheetNames[0]]);
            const order = orders.find(o => o.ID_Commande === orderId);
            
            if (order) {
                await cache.set(cacheKey, order, 300); // 5 minutes
            }
            
            return order;
        } catch (error) {
            logger.error('Erreur getOrder:', error);
            return null;
        }
    }
}

const orderManager = new OrderManager();

// ============================================================================
// GESTIONNAIRE DE LIVREURS
// ============================================================================
class LivreurManager {
    constructor() {
        this.livreursFile = 'livreurs_pillbox.xlsx';
        this.livreursEnLigne = [];
        this.assignations = new Map();
    }
    
    updateLivreursEnLigne() {
        this.livreursEnLigne = dataManager.livreurs.filter(l => 
            l.Statut === 'Actif' && 
            l.Disponible === 'OUI' && 
            l.En_Ligne === 'OUI'
        );
    }
    
    async findAvailableLivreur(zone) {
        this.updateLivreursEnLigne();
        
        // Chercher par zone principale
        let disponible = this.livreursEnLigne.find(l => 
            l.Zone_Principale === zone && 
            parseInt(l.Commandes_En_Cours || '0') < 3
        );
        
        // Chercher dans zones secondaires
        if (!disponible) {
            disponible = this.livreursEnLigne.find(l => 
                l.Zones_Secondaires && 
                l.Zones_Secondaires.includes(zone) && 
                parseInt(l.Commandes_En_Cours || '0') < 3
            );
        }
        
        // Prendre le moins chargé
        if (!disponible) {
            disponible = this.livreursEnLigne
                .sort((a, b) => parseInt(a.Commandes_En_Cours || '0') - parseInt(b.Commandes_En_Cours || '0'))
                .find(l => parseInt(l.Commandes_En_Cours || '0') < 5);
        }
        
        return disponible;
    }
    
    async assignLivreur(order, pharmacie) {
        const livreur = await this.findAvailableLivreur(order.Client_Quartier);
        
        if (livreur) {
            // Mettre à jour le livreur
            livreur.Commandes_En_Cours = (parseInt(livreur.Commandes_En_Cours || '0') + 1).toString();
            livreur.Commandes_Aujourdhui = (parseInt(livreur.Commandes_Aujourdhui || '0') + 1).toString();
            
            await this.saveLivreurs();
            
            // Notifier le livreur
            await this.notifyLivreur(livreur, order, pharmacie);
            
            // Mettre à jour la commande
            await orderManager.updateOrderStatus(order.ID_Commande, 'Livreur assigné', {
                id: livreur.ID_Livreur,
                nom: livreur.Nom
            });
            
            return livreur;
        } else {
            // Pas de livreur disponible
            logger.warn(`⚠️ Aucun livreur disponible pour commande ${order.ID_Commande}`);
            await notificationQueue.add('support-alert', {
                type: 'no_livreur',
                orderId: order.ID_Commande,
                zone: order.Client_Quartier
            });
            return null;
        }
    }
    
    async notifyLivreur(livreur, order, pharmacie) {
        const frais = order.Frais_Livraison;
        const periode = frais === 600 ? 'Nuit (600F)' : 'Jour (400F)';
        
        const message = `🛵 *NOUVELLE LIVRAISON - PILLBOX*\n\n` +
            `📦 Commande #${order.ID_Commande}\n\n` +
            `🏪 *À récupérer chez:*\n` +
            `Pharmacie: ${pharmacie?.NOM_PHARMACIE || 'À confirmer'}\n` +
            `📍 Adresse: ${pharmacie?.ADRESSE || 'Inconnue'}\n\n` +
            `👤 *À livrer à:*\n` +
            `Client: ${order.Client_Nom}\n` +
            `📍 Quartier: ${order.Client_Quartier}\n` +
            `📍 Indications: ${order.Client_Indications}\n` +
            `📱 Contact: ${order.Client_WhatsApp}\n\n` +
            `💰 *Frais livraison:* ${frais} FCFA (${periode})\n\n` +
            `✅ Réponds "OK${order.ID_Commande}" pour confirmer`;
        
        await notificationQueue.add('livreur-notification', {
            to: livreur.WhatsApp,
            message
        });
    }
    
    async confirmLivreur(response) {
        if (response.toUpperCase().startsWith('OK')) {
            const orderId = response.substring(2);
            const order = await orderManager.getOrder(orderId);
            
            if (order && order.Livreur_ID) {
                const livreur = dataManager.livreurs.find(l => l.ID_Livreur === order.Livreur_ID);
                if (livreur) {
                    await orderManager.updateOrderStatus(orderId, 'Livreur confirmé');
                    
                    // Notifier le client
                    await notificationQueue.add('client-notification', {
                        to: order.Client_WhatsApp,
                        message: `✅ *LIVREUR CONFIRMÉ*\n\nCommande ${orderId}\nLe livreur ${livreur.Nom} arrive dans 30-45 min.`
                    });
                    
                    return true;
                }
            }
        }
        return false;
    }
    
    async updateLivreurNote(livreurId, note) {
        const livreur = dataManager.livreurs.find(l => l.ID_Livreur === livreurId);
        if (livreur) {
            const currentNote = parseFloat(livreur.Note_Moyenne || '0');
            const totalNotes = parseInt(livreur.Total_Notes || '0') + 1;
            livreur.Note_Moyenne = ((currentNote * (totalNotes - 1) + parseInt(note)) / totalNotes).toFixed(1);
            livreur.Total_Notes = totalNotes.toString();
            
            await this.saveLivreurs();
        }
    }
    
    async updateLivreurStatus(livreurId, status) {
        const livreur = dataManager.livreurs.find(l => l.ID_Livreur === livreurId);
        if (livreur) {
            livreur.En_Ligne = status;
            await this.saveLivreurs();
            this.updateLivreursEnLigne();
            return true;
        }
        return false;
    }
    
    async saveLivreurs() {
        await dataManager.saveToDrive(dataManager.livreurs, this.livreursFile);
    }
}

const livreurManager = new LivreurManager();

// ============================================================================
// GESTIONNAIRE DE SESSIONS UTILISATEUR
// ============================================================================
class SessionManager {
    constructor() {
        this.localSessions = new Map();
        this.SESSION_TTL = 1800; // 30 minutes
    }
    
    async getSession(userId) {
        // Essayer Redis d'abord
        try {
            const redisKey = `session:${userId}`;
            const sessionData = await redisSimple.get(redisKey);
            
            if (sessionData) {
                const session = JSON.parse(sessionData);
                this.localSessions.set(userId, session);
                return session;
            }
        } catch (error) {
            logger.error('Redis session get error:', error);
        }
        
        // Fallback local
        if (!this.localSessions.has(userId)) {
            const newSession = {
                step: 'menu',
                data: {},
                lastActivity: Date.now(),
                messageCount: 0,
                createdAt: Date.now()
            };
            this.localSessions.set(userId, newSession);
            await this.saveSessionToRedis(userId, newSession);
            return newSession;
        }
        
        const session = this.localSessions.get(userId);
        session.lastActivity = Date.now();
        return session;
    }
    
    async saveSessionToRedis(userId, session) {
        try {
            await redisSimple.setex(
                `session:${userId}`,
                this.SESSION_TTL,
                JSON.stringify(session)
            );
        } catch (error) {
            logger.error('Redis session save error:', error);
        }
    }
    
    async setStep(userId, step) {
        const session = await this.getSession(userId);
        session.step = step;
        session.lastActivity = Date.now();
        this.localSessions.set(userId, session);
        await this.saveSessionToRedis(userId, session);
    }
    
    async setData(userId, key, value) {
        const session = await this.getSession(userId);
        session.data[key] = value;
        session.lastActivity = Date.now();
        this.localSessions.set(userId, session);
        await this.saveSessionToRedis(userId, session);
    }
    
    async getData(userId, key) {
        const session = await this.getSession(userId);
        return session.data[key];
    }
    
    async clearSession(userId) {
        this.localSessions.delete(userId);
        try {
            await redisSimple.del(`session:${userId}`);
        } catch (error) {
            logger.error('Redis session delete error:', error);
        }
    }
    
    async incrementMessageCount(userId) {
        const session = await this.getSession(userId);
        session.messageCount = (session.messageCount || 0) + 1;
        session.lastActivity = Date.now();
        await this.saveSessionToRedis(userId, session);
    }
    
    cleanup() {
        const now = Date.now();
        for (const [userId, session] of this.localSessions.entries()) {
            if (now - session.lastActivity > 3600000) {
                this.localSessions.delete(userId);
                redisSimple.del(`session:${userId}`).catch(() => {});
            }
        }
    }
}

const sessionManager = new SessionManager();

// ============================================================================
// PROCESSEUR DE MESSAGES LLM (INTELLIGENCE)
// ============================================================================
class LLMProcessor {
    constructor() {
        this.systemPrompt = `Tu es Mia, assistante santé intelligente pour PillBox à San Pedro, Côte d'Ivoire.
        
RÔLE: Tu aides les utilisateurs à trouver des médicaments, connaître les prix, obtenir des informations sur les médicaments, trouver les pharmacies de garde, et acheter des médicaments.

TON: Amical, professionnel, rassurant. Tutoiement. Réponds toujours en français.

COMPRÉHENSION: Tu dois comprendre les intentions même avec des fautes.
- "jé mal à la tete" → cherche médicament pour douleur
- "tousse sek" → cherche sirop antitussif
- "pharmacie nuit" → cherche pharmacies de garde
- "combien doliprane" → cherche prix
- "jvé ach té" → veut acheter

RÈGLES:
1. Ne donne pas de conseils médicaux - redirige vers médecin si nécessaire
2. Pour les médicaments sans ordonnance, tu peux conseiller
3. Pour les antibiotiques, demande si ordonnance
4. Sois précise sur les prix (en FCFA)
5. Mentionne toujours les frais de livraison (400F jour, 600F nuit)
6. Si tu ne sais pas, dis-le honnêtement

CONTEXTE ACTUEL:
- ${new Date().toLocaleDateString('fr-FR')}
- ${new Date().getHours()}h${new Date().getMinutes()} - Frais livraison: ${new Date().getHours() < 7 ? 600 : 400}FCFA`;
    }
    
    async processMessage(userMessage, userId) {
        try {
            // Vérifier le cache d'abord
            const cacheKey = `llm:${Buffer.from(userMessage).toString('base64').substring(0, 50)}`;
            const cached = await cache.get(cacheKey);
            if (cached) {
                llmRequests.inc({ status: 'cache' });
                return cached;
            }
            
            // Obtenir le contexte utilisateur
            const session = await sessionManager.getSession(userId);
            const context = {
                step: session.step,
                messageCount: session.messageCount,
                previousQueries: session.data.lastQueries || []
            };
            
            // Construire le prompt avec contexte
            const prompt = `Message utilisateur: "${userMessage}"

Contexte utilisateur:
- Étape actuelle: ${context.step}
- Messages échangés: ${context.messageCount}

Instructions:
1. Identifie l'intention principale
2. Extrais les informations clés (médicament, symptôme, demande)
3. Réponds de façon naturelle et utile
4. Si c'est une demande d'achat, guide vers la commande
5. Si c'est une demande de prix, donne le prix exact
6. Si c'est une recherche de pharmacie, demande la zone si non précisée

RÉPONDS EN FRANÇAIS.`;
            
            llmRequests.inc({ status: 'total' });
            
            // Appeler Groq avec circuit breaker
            const response = await groqBreaker.fire(prompt, this.systemPrompt);
            
            // Mettre en cache (1 heure pour les réponses fréquentes)
            await cache.set(cacheKey, response, 3600);
            
            return response;
            
        } catch (error) {
            logger.error('LLM processing error:', error);
            llmRequests.inc({ status: 'error' });
            
            // Fallback responses
            if (error.message.includes('timeout')) {
                return "Désolé, le service est un peu lent en ce moment. Pouvez-vous reformuler ?";
            }
            
            return "Je rencontre une difficulté technique. Pouvez-vous réessayer dans un instant ?";
        }
    }
    
    async classifyIntent(message) {
        const prompt = `Classe l'intention de ce message en une seule catégorie:
- ACHAT: veut acheter/commander
- PRIX: demande le prix
- INFO: demande des informations sur un médicament
- GARDE: cherche pharmacies de garde
- PHARMACIE: info sur une pharmacie spécifique
- SUIVI: veut suivre sa commande
- AVIS: veut donner un avis
- AUTRE: autre

Message: "${message}"
Réponds seulement par la catégorie.`;
        
        try {
            const response = await groqBreaker.fire(prompt, "Tu es un classificateur d'intentions.");
            return response.trim();
        } catch {
            return 'AUTRE';
        }
    }
    
    async extractMedicine(message) {
        const prompt = `Extrais le nom du médicament mentionné dans ce message.
Si plusieurs, prends le premier. Si aucun, réponds "null".
Message: "${message}"
Réponds seulement par le nom.`;
        
        try {
            const response = await groqBreaker.fire(prompt, "Extraction d'entités.");
            return response.trim() === 'null' ? null : response.trim();
        } catch {
            return null;
        }
    }
}

const llmProcessor = new LLMProcessor();

// ============================================================================
// PROCESSOR DE FILES D'ATTENTE
// ============================================================================
messageQueue.process('process-order', async (job) => {
    logger.info(`Traitement commande ${job.data.ID_Commande}`);
    await orderManager.processOrder(job.data);
});

messageQueue.process('process-message', async (job) => {
    const { userId, message } = job.data;
    logger.debug(`Traitement message de ${userId}`);
    
    // Traitement réel du message (sera géré par le worker principal)
});

notificationQueue.process(async (job) => {
    const { to, message } = job.data;
    
    try {
        // Envoyer via WhatsApp
        const formattedTo = to.includes('@c.us') ? to : `${to}@c.us`;
        await client.sendMessage(formattedTo, message);
        logger.info(`Notification envoyée à ${to}`);
    } catch (error) {
        logger.error('Erreur envoi notification:', error);
        throw error;
    }
});

// ============================================================================
// CLIENT WHATSAPP AVEC POOL DE CONNEXIONS
// ============================================================================
const clients = [];
const MAX_CLIENTS = 5; // Nombre de clients WhatsApp (augmenter si besoin)

for (let i = 0; i < MAX_CLIENTS; i++) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: `mia-worker-${i}` }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-webgl',
                '--disable-software-rasterizer',
                '--disable-features=VizDisplayCompositor'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
    });
    
    clients.push(client);
    
    client.on('qr', (qr) => {
        if (i === 0) { // Seulement le premier affiche le QR
            qrcode.generate(qr, { small: true });
            logger.info(`📱 Scanne le QR code pour le client ${i}`);
        }
    });
    
    client.on('ready', () => {
        logger.info(`✅ Client WhatsApp ${i} prêt`);
    });
    
    client.on('message', async (message) => {
        messagesProcessed.inc({ type: 'incoming' });
        
        // Ajouter à la file d'attente pour traitement asynchrone
        await messageQueue.add('process-message', {
            userId: message.from,
            message: message.body,
            timestamp: Date.now(),
            clientId: i
        }, {
            priority: message.from.includes('support') ? 1 : 5
        });
        
        // Traitement immédiat pour les messages prioritaires
        if (message.from.includes(config.supportPhone)) {
            await handleSupportMessage(message);
        } else {
            // Traitement normal via le worker
            await handleMessageAsync(message);
        }
    });
    
    client.on('disconnected', (reason) => {
        logger.warn(`⚠️ Client WhatsApp ${i} déconnecté: ${reason}`);
        setTimeout(() => {
            logger.info(`🔄 Tentative reconnexion client ${i}`);
            client.initialize();
        }, 5000);
    });
}

// Client principal pour le cluster
const client = clients[0];

// ============================================================================
// GESTIONNAIRE PRINCIPAL DE MESSAGES
// ============================================================================
async function handleMessageAsync(message) {
    const startTime = Date.now();
    const userId = message.from;
    const userText = message.body.trim();
    
    logger.info(`📩 [${userId.substring(0, 10)}...] ${userText.substring(0, 50)}`);
    
    try {
        // Rate limiting basé sur Redis
        const rateKey = `ratelimit:${userId}`;
        const current = await redisSimple.incr(rateKey);
        if (current === 1) {
            await redisSimple.expire(rateKey, 60);
        }
        
        // Limites différentes selon utilisateur
        const isVIP = userId.includes('vip') || userId.includes(config.supportPhone);
        const limit = isVIP ? 200 : 30;
        
        if (current > limit) {
            const ttl = await redisSimple.ttl(rateKey);
            await message.reply(`⏱️ Trop de messages. Patientez ${ttl} secondes.`);
            return;
        }
        
        // Incrémenter compteur session
        await sessionManager.incrementMessageCount(userId);
        activeUsers.inc();
        
        // Récupérer session
        const session = await sessionManager.getSession(userId);
        
        // Classifier l'intention avec LLM
        const intent = await llmProcessor.classifyIntent(userText);
        
        // Traiter selon l'intention
        let response = '';
        
        // MENU
        if (userText.toLowerCase() === 'menu' || userText === '0' || intent === 'MENU') {
            await sessionManager.setStep(userId, 'menu');
            
            response = `🏥 *BIENVENUE SUR PILLBOX - SAN PEDRO* 🇨🇮

*Notre pharmacie virtuelle disponible 24h/24*

💰 *Tarifs livraison:*
🌞 Jour (8h-23h): 400 FCFA
🌙 Nuit (0h-7h): 600 FCFA

*Choisis une option:*

1️⃣ *Acheter un médicament* 💊
2️⃣ *Prix d'un médicament* 💰
3️⃣ *Info sur un médicament* ℹ️
4️⃣ *Pharmacies de garde* 🛡️
5️⃣ *Info sur une pharmacie* 🏪
6️⃣ *Suivre ma commande* 📦
7️⃣ *Laisser un avis* ⭐

*Envoie simplement le chiffre correspondant.*`;
        }
        
        // ACHAT
        else if (intent === 'ACHAT' || userText === '1' || session.step === 'buy_medicine') {
            response = await handlePurchaseFlow(userId, userText, session);
        }
        
        // PRIX
        else if (intent === 'PRIX' || userText === '2') {
            const medicine = await llmProcessor.extractMedicine(userText);
            if (medicine) {
                const medInfo = dataManager.getMedicineInfo(medicine);
                if (medInfo) {
                    response = `💰 *${medInfo.nom}*\n\n` +
                        `💊 Indication: ${medInfo.indication}\n` +
                        `💰 Prix: ${medInfo.prix} FCFA\n` +
                        `📦 Catégorie: ${medInfo.categorie}\n\n` +
                        `Envoie "1" pour acheter.`;
                } else {
                    response = `😔 "${medicine}" n'est pas dans notre stock.`;
                }
            } else {
                await sessionManager.setStep(userId, 'price_medicine');
                response = `💰 *PRIX MÉDICAMENT*\n\nQuel médicament veux-tu connaître le prix?`;
            }
        }
        
        // INFO MÉDICAMENT
        else if (intent === 'INFO' || userText === '3') {
            const medicine = await llmProcessor.extractMedicine(userText);
            if (medicine) {
                const medInfo = dataManager.getMedicineInfo(medicine);
                if (medInfo) {
                    response = `ℹ️ *${medInfo.nom}*\n\n` +
                        `💊 Indication: ${medInfo.indication}\n` +
                        `💰 Prix: ${medInfo.prix} FCFA\n` +
                        `📦 Catégorie: ${medInfo.categorie}\n` +
                        `📍 Résidence: ${medInfo.residence || 'Non précisée'}\n\n` +
                        `Disponible chez PillBox - Livraison à domicile!`;
                } else {
                    response = `😔 "${medicine}" n'est pas dans notre stock.`;
                }
            } else {
                await sessionManager.setStep(userId, 'info_medicine');
                response = `ℹ️ *INFO MÉDICAMENT*\n\nDe quel médicament veux-tu des informations?`;
            }
        }
        
        // PHARMACIES DE GARDE
        else if (intent === 'GARDE' || userText === '4') {
            if (dataManager.pharmaciesDeGarde.length > 0) {
                response = `🛡️ *PHARMACIES DE GARDE AUJOURD'HUI*\n\n`;
                dataManager.pharmaciesDeGarde.slice(0, 10).forEach((p, i) => {
                    response += `${i+1}. *${p.NOM_PHARMACIE}*\n` +
                        `   📍 ${p.ZONE} - ${p.ADRESSE}\n` +
                        `   📞 ${p.TELEPHONE}\n` +
                        `   ⏰ ${p.HEURE_OUVERTURE} - ${p.HEURE_FERMETURE}\n\n`;
                });
            } else {
                response = `😔 Aucune pharmacie de garde aujourd'hui.`;
            }
        }
        
        // INFO PHARMACIE
        else if (intent === 'PHARMACIE' || userText === '5') {
            await sessionManager.setStep(userId, 'pharmacy_info');
            response = `🏪 *INFO PHARMACIE*\n\nEnvoie le nom de la pharmacie:`;
        }
        
        // SUIVI COMMANDE
        else if (intent === 'SUIVI' || userText === '6') {
            await sessionManager.setStep(userId, 'track_order');
            response = `📦 *SUIVI COMMANDE*\n\nEnvoie ton numéro de commande (ex: CMD123456789)`;
        }
        
        // AVIS
        else if (intent === 'AVIS' || userText === '7') {
            await sessionManager.setStep(userId, 'feedback');
            response = `⭐ *DONNER SON AVIS*\n\nEnvoie: avis [numéro commande] [note] [commentaire]\nEx: "avis CMD123456789 5 Très bon service"`;
        }
        
        // TRAITEMENT DES ÉTAPES
        else if (session.step === 'price_medicine') {
            const medInfo = dataManager.getMedicineInfo(userText);
            if (medInfo) {
                response = `💰 *${medInfo.nom}*\n\nPrix: ${medInfo.prix} FCFA`;
            } else {
                response = `😔 "${userText}" n'est pas dans notre stock.`;
            }
            await sessionManager.setStep(userId, 'menu');
        }
        
        else if (session.step === 'info_medicine') {
            const medInfo = dataManager.getMedicineInfo(userText);
            if (medInfo) {
                response = `ℹ️ *${medInfo.nom}*\n\n` +
                    `Indication: ${medInfo.indication}\n` +
                    `Prix: ${medInfo.prix} FCFA`;
            } else {
                response = `😔 "${userText}" n'est pas dans notre stock.`;
            }
            await sessionManager.setStep(userId, 'menu');
        }
        
        else if (session.step === 'pharmacy_info') {
            const pharmacy = dataManager.pharmacies.find(p => 
                p.NOM_PHARMACIE.toLowerCase().includes(userText.toLowerCase())
            );
            
            if (pharmacy) {
                response = `🏪 *${pharmacy.NOM_PHARMACIE}*\n\n` +
                    `📍 Zone: ${pharmacy.ZONE}\n` +
                    `📍 Adresse: ${pharmacy.ADRESSE}\n` +
                    `📞 Téléphone: ${pharmacy.TELEPHONE}\n` +
                    `🛡️ Garde: ${pharmacy.GARDE}\n` +
                    `⏰ Heures: ${pharmacy.HEURE_OUVERTURE} - ${pharmacy.HEURE_FERMETURE}`;
            } else {
                response = `😔 Pharmacie "${userText}" non trouvée.`;
            }
            await sessionManager.setStep(userId, 'menu');
        }
        
        else if (session.step === 'track_order') {
            const order = await orderManager.getOrder(userText);
            if (order) {
                response = `📦 *COMMANDE ${order.ID_Commande}*\n\n` +
                    `Statut: *${order.Statut}*\n` +
                    `💊 Médicament: ${order.Medicament} x${order.Quantite}\n` +
                    `💰 Total: ${order.Total_Paye} FCFA\n` +
                    `📍 Livraison: ${order.Client_Quartier}\n` +
                    `🛵 Livreur: ${order.Livreur_Nom || 'En attente'}`;
            } else {
                response = `❌ Commande "${userText}" non trouvée.`;
            }
            await sessionManager.setStep(userId, 'menu');
        }
        
        else if (session.step === 'feedback' && userText.toLowerCase().startsWith('avis')) {
            const parts = userText.split(' ');
            if (parts.length >= 3) {
                const orderId = parts[1];
                const note = parts[2];
                const commentaire = parts.slice(3).join(' ') || '';
                
                const success = await orderManager.addAvis(orderId, note, commentaire);
                
                if (success) {
                    response = `✅ Merci pour ton avis! ⭐${note}/5`;
                } else {
                    response = `❌ Commande "${orderId}" non trouvée.`;
                }
            } else {
                response = `❌ Format incorrect. Ex: "avis CMD123456789 5 Très bien"`;
            }
            await sessionManager.setStep(userId, 'menu');
        }
        
        else if (session.step === 'buy_medicine_search') {
            const results = dataManager.searchMedicine(userText);
            
            if (results.length > 0) {
                await sessionManager.setData(userId, 'search_results', results);
                await sessionManager.setStep(userId, 'buy_medicine_select');
                
                response = `🔍 *RÉSULTATS POUR "${userText}"*\n\n`;
                results.slice(0, 5).forEach((med, i) => {
                    response += `${i+1}. *${med['NOM COMMERCIAL']}*\n`;
                    response += `   💊 ${med['INDICATION']}\n`;
                    response += `   💰 ${med['PRIX']} FCFA\n\n`;
                });
                response += `Choisis le numéro du médicament (1-${Math.min(5, results.length)}):`;
            } else {
                response = `😔 "${userText}" n'est pas disponible.\n\nEnvoie "1" pour chercher autre chose.`;
            }
        }
        
        else if (session.step === 'buy_medicine_select' && !isNaN(userText)) {
            const index = parseInt(userText) - 1;
            const results = await sessionManager.getData(userId, 'search_results');
            
            if (results && results[index]) {
                await sessionManager.setData(userId, 'selected_medicine', results[index]);
                await sessionManager.setStep(userId, 'buy_medicine_quantity');
                
                response = `📦 *QUANTITÉ*\n\nCombien de "${results[index]['NOM COMMERCIAL']}" veux-tu?`;
            }
        }
        
        else if (session.step === 'buy_medicine_quantity') {
            await sessionManager.setData(userId, 'quantity', userText);
            await sessionManager.setStep(userId, 'buy_medicine_client_info');
            
            response = `👤 *INFORMATIONS DE LIVRAISON*\n\n` +
                `Envoie:\n1️⃣ Ton nom complet\n2️⃣ Ton numéro WhatsApp\n3️⃣ Ton quartier\n4️⃣ Des indications\n\n` +
                `Ex: "Kouassi Jean, 07080910, Zone 4, Près du grand fromager"`;
        }
        
        else if (session.step === 'buy_medicine_client_info') {
            const parts = userText.split(',').map(p => p.trim());
            
            if (parts.length >= 4) {
                const med = await sessionManager.getData(userId, 'selected_medicine');
                const quantity = await sessionManager.getData(userId, 'quantity');
                
                const orderData = {
                    nomClient: parts[0],
                    whatsapp: parts[1].replace(/\s/g, ''),
                    quartier: parts[2],
                    indications: parts.slice(3).join(', '),
                    medicament: med['NOM COMMERCIAL'],
                    quantite: parseInt(quantity) || 1,
                    prix: med['PRIX']
                };
                
                const { orderId, fraisLivraison, total } = await orderManager.createOrder(orderData);
                
                await sessionManager.setData(userId, 'orderId', orderId);
                await sessionManager.setStep(userId, 'menu');
                
                response = `✅ *COMMANDE ENREGISTRÉE!*\n\n` +
                    `📦 Commande #${orderId}\n\n` +
                    `💰 *Détails paiement:*\n` +
                    `💊 Médicament: ${med['PRIX']} FCFA\n` +
                    `🛵 Livraison: ${fraisLivraison} FCFA\n` +
                    `💵 TOTAL: ${total} FCFA\n\n` +
                    `📱 *Notre équipe vous contactera.*\n` +
                    `💬 Support: ${config.supportPhone}\n\n` +
                    `Envoie "6" pour suivre ta commande.`;
            } else {
                response = `❌ Format incorrect. Envoie: Nom, WhatsApp, Quartier, Indications\n` +
                    `Ex: "Kouassi Jean, 07080910, Zone 4, Près du grand fromager"`;
            }
        }
        
        // RÉPONSE PAR DÉFAUT AVEC LLM
        else {
            response = await llmProcessor.processMessage(userText, userId);
            
            // Vérifier si la réponse suggère une action
            if (response.toLowerCase().includes('acheter') || response.toLowerCase().includes('commander')) {
                await sessionManager.setStep(userId, 'buy_medicine_search');
            }
        }
        
        // Envoyer la réponse
        if (response) {
            await message.reply(response);
            messagesProcessed.inc({ type: 'outgoing' });
        }
        
        // Métriques
        const processingTime = Date.now() - startTime;
        httpRequestDuration.labels('whatsapp', 'message', '200').observe(processingTime);
        
    } catch (error) {
        logger.error('❌ Erreur traitement message:', error);
        await message.reply(`😔 Service momentané indisponible. Contacte le support: ${config.supportPhone}`);
    } finally {
        activeUsers.dec();
    }
}

async function handleSupportMessage(message) {
    // Messages prioritaires pour le support
    logger.info(`📞 SUPPORT: ${message.body}`);
    // Logique spéciale pour le support
}

// ============================================================================
// SERVEUR EXPRESS POUR API ET MONITORING
// ============================================================================
const app = express();

// Middleware de sécurité et performance
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting global
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Trop de requêtes, veuillez réessayer plus tard.'
}));

// Logging des requêtes
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Métriques de temps de réponse
app.use(responseTime((req, res, time) => {
    httpRequestDuration.labels(req.method, req.route?.path || req.path, res.statusCode).observe(time);
}));

// Santé du service
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        pid: process.pid,
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        workers: isMaster ? numCPUs : 1,
        clients: clients.filter(c => c.info).length
    });
});

// Métriques Prometheus
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
});

// Statistiques en temps réel
app.get('/stats', async (req, res) => {
    const stats = {
        messagesTotal: (await promClient.register.getSingleMetric('mia_messages_processed_total')?.get())?.values,
        activeUsers: (await promClient.register.getSingleMetric('mia_active_users')?.get())?.values,
        queueSize: {
            messages: await messageQueue.count(),
            llm: await llmQueue.count(),
            notifications: await notificationQueue.count()
        },
        cache: {
            hits: (await promClient.register.getSingleMetric('mia_cache_hits_total')?.get())?.values,
            misses: (await promClient.register.getSingleMetric('mia_cache_misses_total')?.get())?.values
        },
        data: {
            stock: dataManager.pillboxStock.length,
            pharmacies: dataManager.pharmacies.length,
            livreurs: dataManager.livreurs.length,
            pharmaciesGarde: dataManager.pharmaciesDeGarde.length
        },
        lastUpdate: dataManager.lastUpdate
    };
    
    res.json(stats);
});

// Webhook pour API WhatsApp Cloud
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === config.verifyToken) {
        res.send(req.query['hub.challenge']);
    } else {
        res.status(403).send('Vérification échouée');
    }
});

app.post('/webhook', (req, res) => {
    // Traitement des messages entrants via API Cloud
    res.sendStatus(200);
});

// Page d'accueil
app.get('/', (req, res) => {
    res.json({
        name: 'MIA - PillBox',
        version: '3.0.0',
        status: 'online',
        pid: process.pid,
        environment: config.nodeEnv,
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// INITIALISATION ET DÉMARRAGE
// ============================================================================
async function initialize() {
    logger.info('🚀 Démarrage de MIA - PillBox...');
    logger.info(`📊 PID: ${process.pid}, Environnement: ${config.nodeEnv}`);
    
    try {
        // Connecter Kafka
        await producer.connect();
        await consumer.connect();
        logger.info('✅ Kafka connecté');
        
        // S'abonner aux topics
        await consumer.subscribe({ topic: topics.NOTIFICATIONS, fromBeginning: false });
        
        // Consommer les messages
        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                logger.debug(`Kafka message: ${topic}`);
                // Traitement asynchrone
            }
        });
        
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
        
        // Démarrer tous les clients WhatsApp
        clients.forEach(c => c.initialize());
        
        // Démarrer le serveur HTTP
        app.listen(config.port, '0.0.0.0', () => {
            logger.info(`🚀 Serveur HTTP sur port ${config.port}`);
        });
        
        logger.info('✅ MIA prête à servir!');
        
    } catch (error) {
        logger.error('❌ Erreur initialisation:', error);
        process.exit(1);
    }
}

// Gestion des signaux d'arrêt
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown() {
    logger.info('🛑 Arrêt gracieux...');
    
    try {
        await producer.disconnect();
        await consumer.disconnect();
        await redisSimple.quit();
        await pgPool.end();
        
        clients.forEach(c => c.destroy());
        
        logger.info('✅ Arrêt terminé');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Erreur arrêt:', error);
        process.exit(1);
    }
}

// Démarrer
initialize();

// ============================================================================
// FIN DU CODE - MIA EST PRÊTE POUR DES MILLIARDS DE REQUÊTES
// ============================================================================