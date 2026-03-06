const path = require('path');
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const compression = require('compression');
const cluster = require('cluster');
const os = require('os');
const cheerio = require('cheerio');
const { NlpManager } = require('node-nlp');
const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const rateLimitPkg = require('express-rate-limit');
const { ipKeyGenerator } = rateLimitPkg;

// Constantes de productions
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// WhatsApp API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq API
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Configuration de recherche simplifiée (Fuse.js uniquement)
const SEARCH_CONFIG = {
    MIN_TERM_LENGTH: 2,
    MAX_RESULTS: 20,
    FUSE_THRESHOLD: 0.4,  // Tolérance aux fautes
    FUSE_DISTANCE: 100
};

// Sources de données scraping
const SOURCES = {
    PHARMACIES_GARDE: {
        url: process.env.PHARMACIES_URL || 'https://annuaireci.com/pharmacies-de-garde/',
        type: 'pharmacies'
    }
};

// Tarifs livraison
const DELIVERY_PRICES = {
    NIGHT: { startHour: 0, endHour: 7, price: 600 },
    DAY: { startHour: 8, endHour: 23, price: 400 }
};

// Contacts
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';
const CLINIC_NOTIFICATION_PHONE = process.env.CLINIC_NOTIFICATION_PHONE || '2250701406880';

// Clustering
const numCPUs = Math.min(os.cpus().length, 2);
if (cluster.isPrimary && NODE_ENV === 'production') {
    console.log(`Master PID ${process.pid} - Lancement de ${numCPUs} workers...`);
    for (let i = 0; i < numCPUs; i++) cluster.fork();
    cluster.on('exit', (worker) => {
        console.log(`Worker ${worker.process.pid} mort. Redémarrage...`);
        cluster.fork();
    });
} else {
    // Express
    const app = express();
    app.use(compression());
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    // Rate Limiting
    const limiter = rateLimitPkg({
        windowMs: 60000,
        max: 200,
        keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress),
        skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1'
    });
    app.use('/webhook', limiter);

    // Caches
    const cache = new NodeCache({ stdTTL: 300 });
    const processedMessages = new NodeCache({ stdTTL: 300 });

    // Statistiques
    const stats = {
        messagesProcessed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        nlpCalls: 0,
        groqCalls: 0,
        scrapes: 0,
        errors: 0,
        ordersCreated: 0,
        appointmentsCreated: 0,
        startTime: Date.now(),
        activeUsers: new Set()
    };

    // Pool PostgreSQL
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
    });

    pool.on('error', (err) => {
        console.error('Erreur pool PostgreSQL:', err);
        stats.errors++;
    });

    // Logging
    function log(level, message, data = null) {
        const icons = { INFO: '📘', SUCCESS: '✅', ERROR: '❌', USER: '👤', BOT: '🤖', 
                       NLP: '🧠', GROQ: '🔥', SCRAPE: '🕷️', WEBHOOK: '📨', CACHE: '📦',
                       DB: '💾', ORDER: '📦', APPT: '📅', SEARCH: '🔍', LIVREUR: '🛵' };
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${icons[level] || '📌'} ${message}`);
        if (data && NODE_ENV !== 'production') console.log('   📎 Data:', JSON.stringify(data, null, 2));
    }

    // États de conversation
    const ConversationStates = {
        IDLE: 'IDLE',
        GREETED: 'GREETED',
        SEARCHING: 'SEARCHING',
        WAITING_MEDICINE: 'WAITING_MEDICINE',
        WAITING_QUARTIER: 'WAITING_QUARTIER',
        WAITING_NAME: 'WAITING_NAME',
        WAITING_PHONE: 'WAITING_PHONE',
        WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
        ORDER_COMPLETED: 'ORDER_COMPLETED',
        WAITING_CLINIC: 'WAITING_CLINIC',
        WAITING_SPECIALITE: 'WAITING_SPECIALITE',
        WAITING_DATE: 'WAITING_DATE',
        WAITING_HEURE: 'WAITING_HEURE',
        WAITING_RDV_CONFIRMATION: 'WAITING_RDV_CONFIRMATION',
        RDV_COMPLETED: 'RDV_COMPLETED',
        WAITING_COMMANDE_ID: 'WAITING_COMMANDE_ID',
        WAITING_RDV_ID: 'WAITING_RDV_ID',
        WAITING_MODIFICATION: 'WAITING_MODIFICATION',
        WAITING_VILLE: 'WAITING_VILLE',
        WAITING_LIVREUR_CODE: 'WAITING_LIVREUR_CODE'
    };

    // Utilitaires
    class Utils {
        static cleanText(text) {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').trim();
        }

        static normalizeLocation(location) {
            if (!location) return '';
            return location.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').trim();
        }

        static extractPrice(priceText) {
            if (!priceText) return 0;
            return parseInt(priceText.replace(/[^\d]/g, '')) || 0;
        }

        static getCurrentDeliveryPrice() {
            const now = new Date();
            const hour = now.getHours();
            if (hour >= DELIVERY_PRICES.NIGHT.startHour && hour < DELIVERY_PRICES.NIGHT.endHour) {
                return { price: DELIVERY_PRICES.NIGHT.price, period: 'NIGHT' };
            }
            return { price: DELIVERY_PRICES.DAY.price, period: 'DAY' };
        }

        static extractNumber(text) {
            const match = text.match(/\d+/);
            return match ? parseInt(match[0]) : null;
        }

        static extractCommandId(text) {
            const match = text.match(/CMD\d{12,}/i);
            return match ? match[0] : null;
        }

        static extractRdvId(text) {
            const match = text.match(/RDV\d{12,}/i);
            return match ? match[0] : null;
        }

        static extractDate(text) {
            const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            return match ? match[0] : null;
        }

        static extractTime(text) {
            const match = text.match(/(\d{1,2})[h:](\d{2})?/);
            if (match) {
                return match[1] + ':' + (match[2] || '00');
            }
            return null;
        }
    }

    // Moteur de recherche simplifié avec Fuse.js
    class SimpleSearchEngine {
        constructor(pool) {
            this.pool = pool;
            this.fuse = null;
            this.medicaments = [];
            this.fuseOptions = {
                includeScore: true,
                threshold: SEARCH_CONFIG.FUSE_THRESHOLD,
                distance: SEARCH_CONFIG.FUSE_DISTANCE,
                minMatchCharLength: 2,
                keys: [
                    { name: 'nom_commercial', weight: 2 },
                    { name: 'dci', weight: 1 },
                    { name: 'categorie', weight: 0.5 }
                ]
            };
        }

        async buildIndex() {
            try {
                log('INFO', 'Construction index Fuse.js...');
                const result = await this.pool.query(`
                    SELECT code_produit, nom_commercial, dci, prix, categorie
                    FROM medicaments_cache
                    WHERE nom_commercial IS NOT NULL
                `);
                
                this.medicaments = result.rows;
                this.fuse = new Fuse(this.medicaments, this.fuseOptions);
                log('SUCCESS', `Index Fuse.js créé avec ${this.medicaments.length} médicaments`);
            } catch (error) {
                log('ERROR', 'Erreur construction index:', error);
            }
        }

        async search(query, limit = 10) {
            if (!this.fuse || !query || query.length < 2) {
                return { results: [], suggestions: [] };
            }

            const fuseResults = this.fuse.search(query);
            
            const results = fuseResults.slice(0, limit).map(result => ({
                doc: result.item,
                score: 1 - (result.score || 0)
            }));

            const suggestions = this.medicaments
                .filter(m => m.nom_commercial.toLowerCase().startsWith(query.toLowerCase()))
                .slice(0, 5)
                .map(m => m.nom_commercial);

            return { results, suggestions: [...new Set(suggestions)], total: results.length };
        }
    }

    // Scraper pharmacies simplifié
    class SimplePharmacyScraper {
        constructor() {
            this.config = SOURCES.PHARMACIES_GARDE;
            this.timeout = 10000;
        }

        async fetch() {
            const cacheKey = 'scrape_pharmacies';
            const cached = cache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            try {
                log('SCRAPE', 'Récupération des pharmacies de garde...');
                stats.scrapes++;

                const response = await axios.get(this.config.url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: this.timeout
                });
                
                const $ = cheerio.load(response.data);
                const pharmacies = [];

                $('.pharmacy-section, .pharmacy-card, .card').each((i, section) => {
                    const nom = $(section).find('h4, h3, .title').first().text().trim();
                    if (!nom) return;

                    const localite = $(section).find('.location, .ville, .localite').first().text().trim() ||
                                    $(section).find('p:contains("quartier")').text().replace('quartier:', '').trim();

                    const adresse = $(section).find('.address, .adresse').first().text().trim() ||
                                   $(section).find('p:contains("adresse")').text().replace('adresse:', '').trim();

                    const telephone = $(section).find('a[href^="tel:"]').first().text().trim() ||
                                     $(section).find('.phone, .tel').first().text().trim();

                    pharmacies.push({
                        nom,
                        localite: localite || 'Abidjan',
                        adresse: adresse || 'Non spécifiée',
                        telephone: telephone || 'Non disponible'
                    });
                });

                cache.set(cacheKey, pharmacies, 1800);
                stats.cacheMisses++;
                log('SUCCESS', `${pharmacies.length} pharmacies de garde scrapées`);
                return pharmacies;

            } catch (error) {
                log('ERROR', 'Erreur scraping pharmacies:', error.message);
                return [];
            }
        }

        async searchByLocation(term) {
            if (!term) return [];
            const pharmacies = await this.fetch();
            const searchTerm = term.toLowerCase();

            return pharmacies.filter(p =>
                p.localite.toLowerCase().includes(searchTerm) ||
                p.adresse.toLowerCase().includes(searchTerm) ||
                p.nom.toLowerCase().includes(searchTerm)
            ).slice(0, 5);
        }
    }

    // Service clinique
    class ClinicService {
        constructor(pool) {
            this.pool = pool;
        }

        async getAllClinics(ville = null) {
            let query = 'SELECT * FROM cliniques';
            let params = [];

            if (ville) {
                query += ' WHERE LOWER(ville) = LOWER($1) ORDER BY nom_clinique';
                params = [ville];
            } else {
                query += ' ORDER BY ville, nom_clinique';
            }

            const result = await this.pool.query(query, params);
            return result.rows;
        }

        async getMedecinsByClinic(clinicId) {
            const result = await this.pool.query(
                `SELECT m.*, c.nom_clinique, c.quartier, c.ville, c.telephone
                 FROM medecins_clinique m
                 JOIN cliniques c ON m.id_clinique = c.id_clinique
                 WHERE m.id_clinique = $1
                 ORDER BY m.specialite, m.medecin`,
                [clinicId]
            );
            return result.rows;
        }

        async getMedecinsBySpecialite(specialite, ville = null) {
            let query = `
                SELECT m.*, c.nom_clinique, c.quartier, c.ville, c.telephone
                FROM medecins_clinique m
                JOIN cliniques c ON m.id_clinique = c.id_clinique
                WHERE LOWER(m.specialite) LIKE LOWER($1)
            `;
            let params = [`%${specialite}%`];

            if (ville) {
                query += ` AND LOWER(c.ville) = LOWER($2)`;
                params.push(ville);
            }

            query += ` ORDER BY m.specialite, m.medecin`;
            const result = await this.pool.query(query, params);
            return result.rows;
        }

        async getAllSpecialites() {
            const result = await this.pool.query(`
                SELECT DISTINCT specialite
                FROM medecins_clinique
                ORDER BY specialite
            `);
            return result.rows.map(r => r.specialite);
        }

        async createAppointment(data) {
            const appointmentId = `RDV${Date.now()}${Math.floor(Math.random() * 1000)}`;

            await this.pool.query(`
                INSERT INTO rendez_vous (
                    id, id_clinique, medecin, specialite,
                    patient_nom, patient_telephone, date_rdv, heure_rdv, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                appointmentId,
                data.id_clinique,
                data.medecin,
                data.specialite,
                data.patient_nom,
                data.patient_telephone,
                data.date_rdv,
                data.heure_rdv,
                'CONFIRME'
            ]);

            stats.appointmentsCreated++;
            return appointmentId;
        }

        async getAppointmentById(id) {
            const result = await this.pool.query(
                `SELECT r.*, c.nom_clinique, c.quartier, c.ville
                 FROM rendez_vous r
                 JOIN cliniques c ON r.id_clinique = c.id_clinique
                 WHERE r.id = $1`,
                [id]
            );
            return result.rows[0];
        }

        async cancelAppointment(id) {
            const result = await this.pool.query(
                'UPDATE rendez_vous SET status = $1 WHERE id = $2 RETURNING *',
                ['ANNULE', id]
            );
            return result.rows[0];
        }

        async getAppointmentsByPhone(phone) {
            const result = await this.pool.query(
                `SELECT r.*, c.nom_clinique, c.quartier, c.ville
                 FROM rendez_vous r
                 JOIN cliniques c ON r.id_clinique = c.id_clinique
                 WHERE r.patient_telephone = $1
                 ORDER BY r.date_rdv DESC, r.heure_rdv DESC`,
                [phone]
            );
            return result.rows;
        }
    }

    // WhatsApp Service
    class WhatsAppService {
        constructor() {
            this.apiUrl = WHATSAPP_API_URL;
            this.token = WHATSAPP_TOKEN;
        }

        async sendMessage(to, text) {
            if (!text || !to) return;
            try {
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp',
                    to: to.replace(/\D/g, ''),
                    type: 'text',
                    text: { body: text }
                }, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    timeout: 5000
                });
                log('SUCCESS', `Message envoyé à ${to}`);
            } catch (error) {
                log('ERROR', `Erreur WhatsApp: ${error.response?.data?.error?.message || error.message}`);
            }
        }

        async sendInteractiveButtons(to, text, buttons) {
            if (!text || !to || !buttons || buttons.length === 0) return;
            
            try {
                const interactiveMessage = {
                    messaging_product: 'whatsapp',
                    to: to.replace(/\D/g, ''),
                    type: 'interactive',
                    interactive: {
                        type: 'button',
                        body: { text: text },
                        action: {
                            buttons: buttons.slice(0, 3).map((btn, idx) => ({
                                type: 'reply',
                                reply: {
                                    id: `btn_${idx}_${Date.now()}`,
                                    title: btn.substring(0, 20)
                                }
                            }))
                        }
                    }
                };

                await axios.post(this.apiUrl, interactiveMessage, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    timeout: 5000
                });
                log('SUCCESS', `Message interactif envoyé à ${to}`);
            } catch (error) {
                log('ERROR', `Erreur message interactif: ${error.message}`);
                // Fallback au message texte simple
                await this.sendMessage(to, text + "\n\n" + buttons.join(" - "));
            }
        }

        async markAsRead(messageId) {
            try {
                await axios.post(this.apiUrl, {
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId
                }, {
                    headers: { 'Authorization': `Bearer ${this.token}` },
                    timeout: 2000
                });
            } catch (error) {}
        }
    }

    // NLP Service
    class NLPService {
        constructor() {
            this.manager = null;
            this.modelPath = path.join(__dirname, 'model.nlp');
            this.ready = false;
        }

        async loadModel() {
            try {
                log('INFO', 'Chargement du modèle NLP...');
                this.manager = new NlpManager({ languages: ['fr'] });
                
                // Vérifier si le fichier existe avant de charger
                const fs = require('fs');
                if (fs.existsSync(this.modelPath)) {
                    this.manager.load(this.modelPath);
                    this.ready = true;
                    log('SUCCESS', 'Modèle NLP chargé avec succès');
                } else {
                    log('WARN', 'Fichier modèle NLP non trouvé, utilisation du mode fallback');
                    this.ready = false;
                }
                return true;
            } catch (error) {
                log('ERROR', 'Erreur chargement modèle NLP:', error);
                return false;
            }
        }

        async parse(message, senderId = 'default') {
            if (!this.ready) {
                await this.loadModel();
            }

            const cacheKey = `nlp_${senderId}_${message}`;
            const cached = cache.get(cacheKey);
            if (cached) {
                stats.cacheHits++;
                return cached;
            }

            try {
                stats.nlpCalls++;
                
                if (!this.ready || !this.manager) {
                    // Fallback simple basé sur des mots-clés
                    return this.fallbackParse(message);
                }
                
                const result = await this.manager.process('fr', message);

                const formattedResult = {
                    intent: result.intent || 'nlu_fallback',
                    confidence: Math.round((result.score || 0) * 100),
                    entities: {}
                };

                if (result.entities) {
                    result.entities.forEach(entity => {
                        formattedResult.entities[entity.entity] = entity.option || entity.sourceText;
                    });
                }

                cache.set(cacheKey, formattedResult, 300);
                stats.cacheMisses++;

                log('NLP', `Intention: ${formattedResult.intent} (${formattedResult.confidence}%)`);
                return formattedResult;

            } catch (error) {
                log('ERROR', 'Erreur analyse NLP:', error);
                return this.fallbackParse(message);
            }
        }

        fallbackParse(message) {
            const msg = message.toLowerCase();
            
            // Détection simple par mots-clés
            if (msg.includes('bonjour') || msg.includes('salut') || msg.includes('hello')) {
                return { intent: 'saluer', confidence: 70, entities: {} };
            }
            if (msg.includes('prix') || msg.includes('combien')) {
                return { intent: 'prix_medicament', confidence: 60, entities: {} };
            }
            if (msg.includes('pharmacie') && (msg.includes('garde') || msg.includes('ouverte'))) {
                return { intent: 'pharmacie_garde', confidence: 80, entities: {} };
            }
            if (msg.includes('commander') || msg.includes('acheter') || msg.includes('panier')) {
                return { intent: 'commander', confidence: 70, entities: {} };
            }
            if (msg.includes('rdv') || msg.includes('rendez-vous')) {
                return { intent: 'prendre_rdv', confidence: 80, entities: {} };
            }
            if (msg.includes('livraison') || msg.includes('livrer')) {
                return { intent: 'infos_livraison', confidence: 70, entities: {} };
            }
            if (msg.includes('aide') || msg.includes('help') || msg.includes('?')) {
                return { intent: 'aide', confidence: 90, entities: {} };
            }
            
            // Par défaut, on suppose que c'est une recherche de médicament
            return { intent: 'rechercher_medicament', confidence: 50, entities: {} };
        }
    }

    // Groq Service
    class GroqService {
        constructor() {
            this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY, timeout: 8000, maxRetries: 2 }) : null;
            this.model = GROQ_MODEL;
        }

        async generateResponse(messages, temperature = 0.7, maxTokens = 300) {
            if (!this.client) {
                return null;
            }
            
            try {
                stats.groqCalls++;
                const chatCompletion = await this.client.chat.completions.create({
                    messages: messages,
                    model: this.model,
                    temperature: temperature,
                    max_tokens: maxTokens
                });
                return chatCompletion.choices[0]?.message?.content || null;
            } catch (error) {
                log('ERROR', 'Erreur Groq:', error.message);
                return null;
            }
        }
    }

    // Gestionnaire de conversations
    class ConversationManager {
        constructor(pool) {
            this.pool = pool;
        }

        async getConversation(phone) {
            try {
                const result = await this.pool.query(
                    `SELECT * FROM conversations WHERE phone = $1`,
                    [phone]
                );

                if (result.rows.length === 0) {
                    const newConv = await this.pool.query(
                        `INSERT INTO conversations (phone, state, cart, context, history)
                         VALUES ($1, $2, $3, $4, $5)
                         RETURNING *`,
                        [phone, ConversationStates.IDLE, '[]', '{}', '[]']
                    );
                    return newConv.rows[0];
                }

                const conv = result.rows[0];
                conv.cart = typeof conv.cart === 'string' ? JSON.parse(conv.cart) : conv.cart;
                conv.context = typeof conv.context === 'string' ? JSON.parse(conv.context) : conv.context;
                conv.history = typeof conv.history === 'string' ? JSON.parse(conv.history) : conv.history;

                return conv;
            } catch (error) {
                log('ERROR', 'Erreur récupération conversation:', error);
                return { phone, state: ConversationStates.IDLE, cart: [], context: {}, history: [], attempts: 0 };
            }
        }

        async updateState(phone, newState, data = {}) {
            try {
                const fields = [];
                const values = [];
                let i = 1;

                if (newState) {
                    fields.push(`state = $${i++}`);
                    values.push(newState);
                }

                if (data.cart !== undefined) {
                    fields.push(`cart = $${i++}`);
                    values.push(JSON.stringify(data.cart));
                }

                if (data.context) {
                    fields.push(`context = $${i++}`);
                    values.push(JSON.stringify(data.context));
                }

                fields.push(`updated_at = NOW()`);

                const query = `
                    UPDATE conversations
                    SET ${fields.join(', ')}
                    WHERE phone = $${i}
                    RETURNING *
                `;

                await this.pool.query(query, [...values, phone]);
                return true;
            } catch (error) {
                log('ERROR', 'Erreur mise à jour conversation:', error);
                return false;
            }
        }

        async addToHistory(phone, role, message, type) {
            try {
                const conv = await this.getConversation(phone);
                const history = conv.history || [];
                history.push({ role, message, type, time: new Date().toISOString() });
                if (history.length > 5) history.shift();
                await this.updateState(phone, null, { history });
            } catch (error) {
                log('ERROR', 'Erreur ajout historique:', error);
            }
        }
    }

    // Service Livreur
    class LivreurService {
        constructor(pool, whatsappService) {
            this.pool = pool;
            this.whatsapp = whatsappService;
        }

        async registerLivreur(phone, nom, zone) {
            try {
                await this.pool.query(`
                    INSERT INTO livreurs (phone, nom, zone, disponible)
                    VALUES ($1, $2, $3, true)
                    ON CONFLICT (phone) DO UPDATE SET
                        nom = EXCLUDED.nom,
                        zone = EXCLUDED.zone,
                        disponible = true
                `, [phone, nom, zone]);
                log('SUCCESS', `Livreur enregistré: ${nom} (${phone})`);
                return true;
            } catch (error) {
                log('ERROR', 'Erreur enregistrement livreur:', error);
                return false;
            }
        }

        async getLivreurByPhone(phone) {
            const result = await this.pool.query(
                'SELECT * FROM livreurs WHERE phone = $1',
                [phone]
            );
            return result.rows[0];
        }

        async getLivreursDisponibles() {
            const result = await this.pool.query(
                'SELECT * FROM livreurs WHERE disponible = true ORDER BY commandes_livrees DESC'
            );
            return result.rows;
        }

        async assignerCommande(commandeId, livreurPhone) {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');

                await client.query(`
                    INSERT INTO commande_livreurs (commande_id, livreur_phone, status_livreur)
                    VALUES ($1, $2, 'ASSIGNED')
                `, [commandeId, livreurPhone]);

                await client.query(`
                    UPDATE orders 
                    SET status_livreur = 'ASSIGNED', livreur_phone = $1
                    WHERE id = $2
                `, [livreurPhone, commandeId]);

                await client.query(`
                    UPDATE livreurs SET disponible = false WHERE phone = $1
                `, [livreurPhone]);

                await client.query('COMMIT');
                log('SUCCESS', `Commande ${commandeId} assignée au livreur ${livreurPhone}`);
                return true;
            } catch (error) {
                await client.query('ROLLBACK');
                log('ERROR', 'Erreur assignation commande:', error);
                return false;
            } finally {
                client.release();
            }
        }

        async recupererCommande(commandeId, livreurPhone) {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');

                await client.query(`
                    UPDATE commande_livreurs 
                    SET status_livreur = 'PICKED_UP', picked_up_at = NOW()
                    WHERE commande_id = $1 AND livreur_phone = $2
                `, [commandeId, livreurPhone]);

                await client.query(`
                    UPDATE orders 
                    SET status_livreur = 'PICKED_UP'
                    WHERE id = $1
                `, [commandeId]);

                await client.query('COMMIT');
                log('SUCCESS', `Commande ${commandeId} récupérée par livreur ${livreurPhone}`);
                return true;
            } catch (error) {
                await client.query('ROLLBACK');
                log('ERROR', 'Erreur récupération commande:', error);
                return false;
            } finally {
                client.release();
            }
        }

        async livrerCommande(commandeId, livreurPhone, codeConfirmation) {
            const client = await this.pool.connect();
            try {
                const order = await this.pool.query(
                    'SELECT * FROM orders WHERE id = $1 AND confirmation_code = $2',
                    [commandeId, codeConfirmation]
                );

                if (order.rows.length === 0) {
                    return { success: false, message: "Code de confirmation invalide" };
                }

                await client.query('BEGIN');

                await client.query(`
                    UPDATE commande_livreurs 
                    SET status_livreur = 'DELIVERED', delivered_at = NOW()
                    WHERE commande_id = $1 AND livreur_phone = $2
                `, [commandeId, livreurPhone]);

                await client.query(`
                    UPDATE orders 
                    SET status_livreur = 'DELIVERED', status = 'DELIVERED'
                    WHERE id = $1
                `, [commandeId]);

                await client.query(`
                    UPDATE livreurs 
                    SET commandes_livrees = commandes_livrees + 1, disponible = true
                    WHERE phone = $1
                `, [livreurPhone]);

                await client.query('COMMIT');
                log('SUCCESS', `Commande ${commandeId} livrée par livreur ${livreurPhone}`);
                return { success: true, message: "Commande livrée avec succès" };
            } catch (error) {
                await client.query('ROLLBACK');
                log('ERROR', 'Erreur livraison commande:', error);
                return { success: false, message: "Erreur lors de la livraison" };
            } finally {
                client.release();
            }
        }

        async getCommandesLivreur(livreurPhone, status = null) {
            let query = `
                SELECT o.*, cl.status_livreur, cl.assigned_at, cl.picked_up_at
                FROM orders o
                JOIN commande_livreurs cl ON o.id = cl.commande_id
                WHERE cl.livreur_phone = $1
            `;
            const params = [livreurPhone];

            if (status) {
                query += ` AND cl.status_livreur = $2`;
                params.push(status);
            }

            query += ` ORDER BY o.created_at DESC`;

            const result = await this.pool.query(query, params);
            return result.rows.map(row => {
                row.items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
                return row;
            });
        }
    }

    // Service de commandes
    class OrderService {
        constructor(pool, whatsappService, livreurService) {
            this.pool = pool;
            this.whatsapp = whatsappService;
            this.livreurService = livreurService;
            this.counter = 0;
        }

        generateOrderId() {
            const d = new Date();
            return `CMD${d.getFullYear().toString().slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(++this.counter).padStart(4, '0')}`;
        }

        generateConfirmationCode() {
            return String(Math.floor(100000 + Math.random() * 900000));
        }

        calculateDeliveryPrice(subtotal) {
            if (subtotal >= 5000) return 0;
            return Utils.getCurrentDeliveryPrice().price;
        }

        async createOrder(data, userPhone) {
            try {
                const orderId = this.generateOrderId();
                const code = this.generateConfirmationCode();

                const subtotal = data.items.reduce((sum, item) => sum + (item.prix * (item.quantite || 1)), 0);
                const deliveryPrice = this.calculateDeliveryPrice(subtotal);
                const total = subtotal + deliveryPrice;

                const order = {
                    id: orderId,
                    client_name: data.client.nom,
                    client_phone: data.client.telephone || userPhone,
                    client_quartier: data.client.quartier,
                    client_indications: data.client.indications || '',
                    items: data.items,
                    subtotal,
                    delivery_price: deliveryPrice,
                    total,
                    delivery_period: Utils.getCurrentDeliveryPrice().period,
                    status: 'PENDING',
                    status_livreur: 'PENDING',
                    confirmation_code: code
                };

                await this.pool.query(
                    `INSERT INTO orders
                     (id, client_name, client_phone, client_quartier, client_indications,
                      items, subtotal, delivery_price, total, delivery_period, status, status_livreur, confirmation_code)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [order.id, order.client_name, order.client_phone, order.client_quartier,
                     order.client_indications, JSON.stringify(order.items), order.subtotal,
                     order.delivery_price, order.total, order.delivery_period, order.status, 
                     order.status_livreur, order.confirmation_code]
                );

                stats.ordersCreated++;
                await this.notifySupport(order);
                await this.notifyLivreursDisponibles(order);

                return order;

            } catch (error) {
                log('ERROR', 'Erreur création commande:', error);
                throw error;
            }
        }

        async getOrderById(orderId) {
            const result = await this.pool.query('SELECT * FROM orders WHERE id = $1', [orderId]);
            if (result.rows.length === 0) return null;

            const order = result.rows[0];
            order.items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
            return order;
        }

        async updateOrder(orderId, data) {
            const updates = [];
            const values = [];
            let i = 1;

            if (data.status) {
                updates.push(`status = $${i++}`);
                values.push(data.status);
            }
            if (data.status_livreur) {
                updates.push(`status_livreur = $${i++}`);
                values.push(data.status_livreur);
            }

            updates.push(`updated_at = NOW()`);

            const query = `
                UPDATE orders
                SET ${updates.join(', ')}
                WHERE id = $${i}
                RETURNING *
            `;

            const result = await this.pool.query(query, [...values, orderId]);
            return result.rows[0];
        }

        async cancelOrder(orderId) {
            return await this.updateOrder(orderId, { status: 'CANCELLED' });
        }

        async notifySupport(order) {
            const items = order.items.map(i => `• ${i.nom_commercial} (${i.prix} FCFA) x${i.quantite || 1}`).join('\n');
            const message = `📦 *NOUVELLE COMMANDE*\nID: ${order.id}\nCode: ${order.confirmation_code}\n👤 Client: ${order.client_name}\n📱 Tél: ${order.client_phone}\n📍 Quartier: ${order.client_quartier}\n📦 Articles:\n${items}\n💰 Total: ${order.total} FCFA`;

            await this.whatsapp.sendMessage(SUPPORT_PHONE, message);
        }

        async notifyLivreursDisponibles(order) {
            try {
                const livreurs = await this.livreurService.getLivreursDisponibles();
                
                if (livreurs.length === 0) {
                    log('WARN', 'Aucun livreur disponible pour la commande', order.id);
                    return;
                }

                const items = order.items.map(i => `• ${i.nom_commercial} x${i.quantite || 1}`).join('\n');
                const message = `📦 *NOUVELLE COMMANDE À LIVRER*\n\nID: ${order.id}\nCode: ${order.confirmation_code}\n👤 Client: ${order.client_name}\n📍 Quartier: ${order.client_quartier}\n📦 Articles:\n${items}\n💰 À encaisser: ${order.total} FCFA\n\n👉 Répondez: *ACCEPTER ${order.id}* pour prendre la commande`;

                for (const livreur of livreurs) {
                    await this.whatsapp.sendMessage(livreur.phone, message);
                }
                
                log('INFO', `Notification envoyée à ${livreurs.length} livreurs`);
            } catch (error) {
                log('ERROR', 'Erreur notification livreurs:', error);
            }
        }

        async handleLivreurResponse(phone, message, convManager) {
            const parts = message.split(' ');
            const action = parts[0].toUpperCase();
            const commandeId = parts[1];

            if (!commandeId || !commandeId.match(/CMD\d+/)) {
                return null;
            }

            const livreur = await this.livreurService.getLivreurByPhone(phone);
            if (!livreur) {
                await this.whatsapp.sendMessage(phone, 
                    "Vous n'êtes pas enregistré comme livreur. Contactez le support. 📞");
                return;
            }

            switch(action) {
                case 'ACCEPTER':
                    const success = await this.livreurService.assignerCommande(commandeId, phone);
                    if (success) {
                        const order = await this.getOrderById(commandeId);
                        
                        await this.whatsapp.sendMessage(phone,
                            `✅ Commande ${commandeId} assignée !\nUtilisez *RECUPERER ${commandeId}* quand vous récupérez la commande\nUtilisez *LIVRER ${commandeId}* après livraison avec le code client`);

                        await this.whatsapp.sendMessage(order.client_phone,
                            `✅ Votre commande ${commandeId} a été acceptée par un livreur !\n🚚 Livreur: ${livreur.nom || 'Livreur'}\nVous serez notifié quand il récupère la commande.`);

                        await this.whatsapp.sendMessage(SUPPORT_PHONE,
                            `📦 Commande ${commandeId}\n✅ Acceptée par livreur: ${phone}`);
                    }
                    break;

                case 'RECUPERER':
                    const recuperer = await this.livreurService.recupererCommande(commandeId, phone);
                    if (recuperer) {
                        const order = await this.getOrderById(commandeId);
                        
                        await this.whatsapp.sendMessage(phone,
                            `🛵 Commande ${commandeId} récupérée !\nUtilisez *LIVRER ${commandeId}* une fois livrée`);

                        await this.whatsapp.sendMessage(order.client_phone,
                            `🛵 Votre commande ${commandeId} est en cours de livraison !\nPréparez le code: *${order.confirmation_code}*`);

                        await this.whatsapp.sendMessage(SUPPORT_PHONE,
                            `📦 Commande ${commandeId}\n🛵 En cours de livraison`);
                    }
                    break;

                case 'LIVRER':
                    await this.whatsapp.sendMessage(phone,
                        `🔐 Entrez le code de confirmation à 6 chiffres pour la commande ${commandeId} :`);
                    
                    await convManager.updateState(phone, ConversationStates.WAITING_LIVREUR_CODE, {
                        context: { commande_en_cours: commandeId }
                    });
                    break;
            }

            return null;
        }

        async confirmLivreurDelivery(phone, code, convManager) {
            const conv = await convManager.getConversation(phone);
            const commandeId = conv.context.commande_en_cours;

            if (!commandeId) {
                return null;
            }

            const result = await this.livreurService.livrerCommande(commandeId, phone, code);
            
            if (result.success) {
                const order = await this.getOrderById(commandeId);
                
                await this.whatsapp.sendMessage(phone,
                    `✅ Livraison confirmée !\nCommande ${commandeId} marquée comme livrée.\nMerci pour votre service ! 🎉`);

                await this.whatsapp.sendMessage(order.client_phone,
                    `🎉 Votre commande ${commandeId} a été livrée avec succès !\nMerci de votre confiance. À bientôt sur Pillbox CI ! 🚀`);

                await this.whatsapp.sendMessage(SUPPORT_PHONE,
                    `📦 Commande ${commandeId}\n✅ Livrée par livreur: ${phone}\n💰 Total: ${order.total} FCFA`);

                await convManager.updateState(phone, ConversationStates.IDLE, { context: {} });
                return "Livraison confirmée avec succès";
            } else {
                await this.whatsapp.sendMessage(phone,
                    `❌ ${result.message}\nRéessayez avec *LIVRER ${commandeId}*`);
                return null;
            }
        }
    }

    // Cache Manager
    class CacheManager {
        constructor(pharmacyScraper, pool) {
            this.pharmacyScraper = pharmacyScraper;
            this.pool = pool;
        }

        async refreshAll() {
            log('INFO', 'Rafraîchissement des pharmacies...');
            try {
                const pharmacies = await this.pharmacyScraper.fetch();
                if (pharmacies.length > 0) {
                    await this.savePharmaciesToDB(pharmacies);
                    log('SUCCESS', `${pharmacies.length} pharmacies mises à jour`);
                }
            } catch (error) {
                log('ERROR', 'Erreur rafraîchissement:', error);
            }
        }

        async savePharmaciesToDB(pharmacies) {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');
                for (const pharma of pharmacies) {
                    await client.query(`
                        INSERT INTO pharmacies_cache (nom, localite, adresse, telephone_principal, last_updated)
                        VALUES ($1, $2, $3, $4, NOW())
                        ON CONFLICT (nom) DO UPDATE SET
                            localite = EXCLUDED.localite,
                            adresse = EXCLUDED.adresse,
                            telephone_principal = EXCLUDED.telephone_principal,
                            last_updated = NOW()
                    `, [pharma.nom, pharma.localite, pharma.adresse, pharma.telephone]);
                }
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                log('ERROR', 'Erreur sauvegarde:', error);
            } finally {
                client.release();
            }
        }
    }

    // Timeout Manager
    class TimeoutManager {
        constructor(convManager, whatsappService) {
            this.convManager = convManager;
            this.whatsapp = whatsappService;
            this.lastActivity = new Map();
            setInterval(() => this.checkTimeouts(), 60000);
        }

        registerActivity(phone) {
            this.lastActivity.set(phone, Date.now());
        }

        async checkTimeouts() {
            const now = Date.now();
            const timeout = 10 * 60 * 1000;

            for (const [phone, lastTime] of this.lastActivity) {
                if (now - lastTime > timeout) {
                    const conv = await this.convManager.getConversation(phone);
                    if (conv.state !== ConversationStates.IDLE) {
                        await this.whatsapp.sendMessage(phone, 
                            "⏰ Inactif depuis 10 min. Conversation remise à zéro.");
                        await this.convManager.updateState(phone, ConversationStates.IDLE, { cart: [], context: {} });
                    }
                    this.lastActivity.delete(phone);
                }
            }
        }
    }

    // Moteur de conversation principal
    class ConversationEngine {
        constructor(nlp, groq, searchService, clinicService, orderService, convManager, whatsapp, livreurService, pharmacyScraper) {
            this.nlp = nlp;
            this.groq = groq;
            this.searchService = searchService;
            this.clinicService = clinicService;
            this.orderService = orderService;
            this.convManager = convManager;
            this.whatsapp = whatsapp;
            this.livreurService = livreurService;
            this.pharmacyScraper = pharmacyScraper;
            this.states = ConversationStates;
        }

        async process(phone, message) {
            try {
                const conv = await this.convManager.getConversation(phone);
                
                // Vérifier si c'est une réponse de livreur en attente de code
                if (conv.state === this.states.WAITING_LIVREUR_CODE) {
                    if (message.match(/^\d{6}$/)) {
                        const result = await this.orderService.confirmLivreurDelivery(phone, message, this.convManager);
                        if (result) {
                            return result;
                        }
                    } else {
                        await this.whatsapp.sendMessage(phone, 
                            "Code invalide. Veuillez entrer un code à 6 chiffres.");
                        return null;
                    }
                }

                const analysis = await this.nlp.parse(message, phone);
                await this.convManager.addToHistory(phone, 'user', message, analysis.intent);
                
                const response = await this.routeIntent(analysis, conv, message);
                
                if (response) {
                    await this.convManager.addToHistory(phone, 'assistant', response, 'response');
                }
                
                return response;

            } catch (error) {
                log('ERROR', 'Erreur moteur conversation:', error);
                return "Désolé, une erreur est survenue. Veuillez réessayer. 😔";
            }
        }

        async routeIntent(analysis, conv, originalMessage) {
            // États en attente
            if (conv.state === this.states.WAITING_MEDICINE) {
                return await this.handleWaitingMedicine(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_QUARTIER) {
                return await this.handleWaitingQuartier(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_CLINIC) {
                return await this.handleWaitingClinic(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_SPECIALITE) {
                return await this.handleWaitingSpecialite(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_DATE) {
                return await this.handleWaitingDate(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_HEURE) {
                return await this.handleWaitingHeure(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_RDV_CONFIRMATION) {
                return await this.handleWaitingRdvConfirmation(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_COMMANDE_ID) {
                return await this.handleWaitingCommandeId(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_RDV_ID) {
                return await this.handleWaitingRdvId(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_MODIFICATION) {
                return await this.handleWaitingModification(conv.phone, originalMessage, conv);
            }
            if (conv.state === this.states.WAITING_VILLE) {
                conv.context.ville = originalMessage.trim();
                await this.convManager.updateState(conv.phone, null, { context: conv.context });
                return await this.handleIntentPrendreRdv(conv);
            }

            // Intentions principales
            switch(analysis.intent) {
                case 'saluer':
                    return await this.handleIntentSaluer(conv);
                case 'rechercher_medicament':
                    return await this.handleIntentRechercherMedicament(analysis, conv, originalMessage);
                case 'prix_medicament':
                    return await this.handleIntentPrixMedicament(analysis, conv, originalMessage);
                case 'pharmacie_garde':
                    return await this.handleIntentPharmacieGarde(analysis, conv);
                case 'commander':
                    return await this.handleIntentCommander(analysis, conv);
                case 'panier':
                    return await this.handleIntentPanier(conv);
                case 'choix_numero':
                    return await this.handleIntentChoixNumero(conv, originalMessage);
                case 'prendre_rdv':
                    return await this.handleIntentPrendreRdv(conv);
                case 'annuler_rdv':
                    return await this.handleIntentAnnulerRdv(analysis, conv);
                case 'clinique_proche':
                    return await this.handleIntentCliniqueProche(analysis, conv);
                case 'specialite_clinique':
                    return await this.handleIntentSpecialiteClinique(analysis, conv);
                case 'infos_livraison':
                    return await this.handleIntentInfosLivraison(analysis, conv);
                case 'aide':
                    return await this.handleIntentAide(conv);
                default:
                    return await this.handleIntentFallback(originalMessage, conv);
            }
        }

        async handleIntentSaluer(conv) {
            await this.convManager.updateState(conv.phone, this.states.GREETED);
            const delivery = Utils.getCurrentDeliveryPrice();
            
            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `Bonjour ! 👋 Je suis MIA, votre assistante santé.\n💰 Livraison: ${delivery.price} FCFA`,
                ["💊 Chercher", "🏥 Pharmacie", "📅 RDV", "🚚 Infos"]
            );
            return null;
        }

        async handleIntentRechercherMedicament(analysis, conv, originalMessage) {
            const medicineName = analysis.entities.medicament || originalMessage;

            if (!medicineName || medicineName.length < 2) {
                await this.convManager.updateState(conv.phone, this.states.WAITING_MEDICINE);
                return "Quel médicament cherchez-vous ? (ex: doliprane, amoxicilline) 💊";
            }

            const results = await this.searchService.search(medicineName);

            if (results.results.length === 0) {
                return `Désolé, je n'ai pas trouvé "${medicineName}". Vérifiez l'orthographe ou essayez autre chose. 😕`;
            }

            await this.convManager.updateState(conv.phone, this.states.SEARCHING, {
                context: { last_search: { term: medicineName, results: results.results.slice(0, 5) } }
            });

            const resultsList = results.results.slice(0, 5).map((r, i) => 
                `${i+1}. *${r.doc.nom_commercial}* : ${r.doc.prix} FCFA`
            ).join('\n');

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `Voici ce que j'ai trouvé pour "${medicineName}" :\n\n${resultsList}`,
                ["1", "2", "3", "4", "5", "🔍 Autre"]
            );
            return null;
        }

        async handleIntentPrixMedicament(analysis, conv, originalMessage) {
            const medicineName = analysis.entities.medicament || originalMessage;

            if (!medicineName || medicineName.length < 2) {
                return "De quel médicament voulez-vous connaître le prix ? 💰";
            }

            const results = await this.searchService.search(medicineName);

            if (results.results.length === 0) {
                return `Désolé, je n'ai pas trouvé de prix pour "${medicineName}". 😕`;
            }

            const pricesList = results.results.slice(0, 5).map(r => 
                `• ${r.doc.nom_commercial}: ${r.doc.prix} FCFA`
            ).join('\n');

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `💰 *Prix trouvés*\n\n${pricesList}\n\nVoulez-vous commander ?`,
                ["✅ Commander", "🔍 Voir plus", "❌ Annuler"]
            );
            return null;
        }

        async handleIntentPharmacieGarde(analysis, conv) {
            const quartier = analysis.entities.localisation || analysis.entities.quartier || analysis.entities.ville;

            if (!quartier) {
                await this.convManager.updateState(conv.phone, this.states.WAITING_QUARTIER);
                return "Dans quel quartier cherchez-vous une pharmacie de garde ? 🏥";
            }

            const pharmacies = await this.pharmacyScraper.searchByLocation(quartier);

            if (pharmacies.length === 0) {
                return `Désolé, aucune pharmacie de garde trouvée à ${quartier}. 😕`;
            }

            const pharmaciesList = pharmacies.slice(0, 3).map(p =>
                `🏥 *${p.nom}*\n📍 ${p.adresse}\n📞 ${p.telephone}`
            ).join('\n\n');

            return `Pharmacies de garde à ${quartier} :\n\n${pharmaciesList}`;
        }

        async handleIntentCommander(analysis, conv) {
            if (!conv.cart || conv.cart.length === 0) {
                return "Votre panier est vide. Cherchez d'abord un médicament à ajouter. 💊";
            }

            if (!conv.context?.client_nom) {
                await this.convManager.updateState(conv.phone, this.states.WAITING_NAME, {
                    context: { ...conv.context, ordering: true }
                });

                const subtotal = conv.cart.reduce((sum, i) => sum + (i.prix * (i.quantite || 1)), 0);
                const delivery = Utils.getCurrentDeliveryPrice();
                const deliveryPrice = subtotal >= 5000 ? 0 : delivery.price;

                const recap = `🛒 *Récapitulatif*\n${conv.cart.map((i, idx) => 
                    `${idx+1}. ${i.nom_commercial} x${i.quantite || 1}: ${i.prix * (i.quantite || 1)} FCFA`
                ).join('\n')}\n💰 Total: ${subtotal + deliveryPrice} FCFA`;

                await this.whatsapp.sendInteractiveButtons(conv.phone,
                    `${recap}\n\nQuel est votre nom pour finaliser ? 👤`,
                    ["✏️ Modifier", "✅ Confirmer", "❌ Annuler"]
                );
                return null;
            }

            const subtotal = conv.cart.reduce((sum, i) => sum + (i.prix * (i.quantite || 1)), 0);
            const delivery = Utils.getCurrentDeliveryPrice();
            const deliveryPrice = subtotal >= 5000 ? 0 : delivery.price;

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `Confirmation pour ${conv.context.client_nom} :\n${conv.cart.length} article(s)\nTotal: ${subtotal + deliveryPrice} FCFA`,
                ["✅ Confirmer", "✏️ Modifier", "❌ Annuler"]
            );
            return null;
        }

        async handleIntentPanier(conv) {
            if (!conv.cart || conv.cart.length === 0) {
                return "Votre panier est vide. 🛒";
            }

            const subtotal = conv.cart.reduce((sum, i) => sum + (i.prix * (i.quantite || 1)), 0);
            const delivery = Utils.getCurrentDeliveryPrice();
            const deliveryPrice = subtotal >= 5000 ? 0 : delivery.price;

            const cartList = conv.cart.map((i, idx) =>
                `${idx+1}. ${i.nom_commercial} x${i.quantite || 1} = ${i.prix * (i.quantite || 1)} FCFA`
            ).join('\n');

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `🛒 *Votre panier*\n\n${cartList}\n\n💰 Sous-total: ${subtotal} FCFA\n🚚 Livraison: ${deliveryPrice} FCFA\n💵 Total: ${subtotal + deliveryPrice} FCFA`,
                ["✅ Commander", "✏️ Modifier", "🗑️ Vider"]
            );
            return null;
        }

        async handleIntentChoixNumero(conv, message) {
            const number = Utils.extractNumber(message);
            const lastSearch = conv.context?.last_search;

            if (!lastSearch || !lastSearch.results || !number) {
                return "Je n'ai pas compris. Veuillez réessayer. 🤔";
            }

            if (number < 1 || number > lastSearch.results.length) {
                return `Choisissez un numéro entre 1 et ${lastSearch.results.length}.`;
            }

            const selected = lastSearch.results[number - 1];
            const cart = conv.cart || [];

            const existing = cart.find(item => item.nom_commercial === selected.doc.nom_commercial);
            if (existing) {
                existing.quantite = (existing.quantite || 1) + 1;
            } else {
                cart.push({ ...selected.doc, quantite: 1 });
            }

            await this.convManager.updateState(conv.phone, null, { cart });

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `${selected.doc.nom_commercial} ajouté au panier ! ✅`,
                ["🛒 Voir panier", "🔍 Continuer", "✅ Commander"]
            );
            return null;
        }

        async handleIntentPrendreRdv(conv) {
            try {
                const clinics = await this.clinicService.getAllClinics();

                if (clinics.length === 0) {
                    return "Désolé, aucune clinique disponible pour le moment. 🏥";
                }

                await this.convManager.updateState(conv.phone, this.states.WAITING_CLINIC, {
                    context: { appointment_step: 'clinics_listed' }
                });

                const clinicsList = clinics.slice(0, 5).map((c, i) =>
                    `${i+1}. *${c.nom_clinique}*\n   📍 ${c.quartier}, ${c.ville}\n   📞 ${c.telephone}`
                ).join('\n\n');

                await this.whatsapp.sendInteractiveButtons(conv.phone,
                    `🏥 *Cliniques disponibles*\n\n${clinicsList}`,
                    ["1", "2", "3", "4", "5", "❌ Annuler"]
                );
                return null;
            } catch (error) {
                log('ERROR', 'Erreur prise RDV:', error);
                return "Erreur lors de la récupération des cliniques. Réessayez plus tard. 😔";
            }
        }

        async handleIntentAnnulerRdv(analysis, conv) {
            const rdvId = analysis.entities.rdv_id || Utils.extractRdvId(analysis.originalMessage);

            if (!rdvId) {
                return "Veuillez fournir le numéro de rendez-vous à annuler (ex: RDV2026030201).";
            }

            const appointment = await this.clinicService.getAppointmentById(rdvId);

            if (!appointment) {
                return `Aucun rendez-vous trouvé avec l'ID ${rdvId}.`;
            }

            await this.clinicService.cancelAppointment(rdvId);
            return `Rendez-vous ${rdvId} annulé avec succès. ✅`;
        }

        async handleIntentSpecialiteClinique(analysis, conv) {
            try {
                const specialites = await this.clinicService.getAllSpecialites();
                return `🩺 *Spécialités disponibles*\n\n${specialites.slice(0, 10).map(s => `• ${s}`).join('\n')}`;
            } catch (error) {
                log('ERROR', 'Erreur spécialités:', error);
                return "Erreur lors de la récupération des spécialités.";
            }
        }

        async handleIntentCliniqueProche(analysis, conv) {
            return "Pour trouver une clinique proche, précisez votre quartier ou ville. 🏥";
        }

        async handleIntentInfosLivraison(analysis, conv) {
            const delivery = Utils.getCurrentDeliveryPrice();
            return `🚚 *Livraison*\n\n💰 Tarif actuel: ${delivery.price} FCFA (${delivery.period === 'NIGHT' ? '🌙 nuit 0h-7h' : '☀️ jour 8h-23h'})\n✅ Gratuit à partir de 5000 FCFA\n📍 Zones: Abidjan et grandes villes\n⏱️ Délais: 30-45 min Abidjan\n💵 Paiement: espèces, OM, Wave à la livraison`;
        }

        async handleIntentAide(conv) {
            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `📚 *Aide - Commandes disponibles*\n\n` +
                `💊 Chercher médicament\n💰 Prix médicament\n🏥 Pharmacie garde\n🛒 Commander\n📅 Prendre rendez-vous\n🚚 Infos livraison`,
                ["💊 Chercher", "🏥 Pharmacie", "📅 RDV", "🚚 Infos"]
            );
            return null;
        }

        async handleIntentFallback(message, conv) {
            await this.whatsapp.sendInteractiveButtons(conv.phone,
                "Désolé, je n'ai pas compris. Tapez *aide* pour voir ce que je peux faire. 🤗",
                ["💊 Chercher", "🏥 Pharmacie", "📅 RDV", "❓ Aide"]
            );
            return null;
        }

        async handleWaitingMedicine(phone, message, conv) {
            if (message.length < 2) {
                return "Veuillez donner le nom du médicament (ex: doliprane). 💊";
            }
            await this.convManager.updateState(phone, this.states.IDLE);
            const newAnalysis = await this.nlp.parse(message, phone);
            return await this.handleIntentRechercherMedicament(newAnalysis, { ...conv, state: this.states.IDLE }, message);
        }

        async handleWaitingQuartier(phone, message, conv) {
            if (message.length < 2) {
                return "Veuillez préciser le quartier. 📍";
            }
            await this.convManager.updateState(phone, this.states.IDLE);
            const pharmacies = await this.pharmacyScraper.searchByLocation(message);
            
            if (pharmacies.length === 0) {
                return `Aucune pharmacie trouvée à ${message}.`;
            }

            const pharmaciesList = pharmacies.slice(0, 3).map(p =>
                `🏥 *${p.nom}*\n📍 ${p.adresse}\n📞 ${p.telephone}`
            ).join('\n\n');

            return `Pharmacies trouvées à ${message} :\n\n${pharmaciesList}`;
        }

        async handleWaitingClinic(phone, message, conv) {
            const number = Utils.extractNumber(message);
            const clinics = await this.clinicService.getAllClinics(conv.context.ville);

            if (!number || number < 1 || number > clinics.length) {
                return "Numéro invalide. Choisissez un numéro dans la liste.";
            }

            const selectedClinic = clinics[number - 1];
            const medecins = await this.clinicService.getMedecinsByClinic(selectedClinic.id_clinique);
            const specialites = [...new Set(medecins.map(m => m.specialite))];

            await this.convManager.updateState(phone, this.states.WAITING_SPECIALITE, {
                context: { ...conv.context, selected_clinic: selectedClinic, specialites_list: specialites }
            });

            const specialitesList = specialites.slice(0, 5).map((spec, idx) => 
                `${idx+1}. ${spec}`
            ).join('\n');

            await this.whatsapp.sendInteractiveButtons(phone,
                `🏥 *${selectedClinic.nom_clinique}*\n\nSpécialités:\n${specialitesList}`,
                ["1", "2", "3", "4", "5", "❌ Annuler"]
            );
            return null;
        }

        async handleWaitingSpecialite(phone, message, conv) {
            const number = Utils.extractNumber(message);
            const specialites = conv.context.specialites_list || [];

            if (!number || number < 1 || number > specialites.length) {
                return "Numéro de spécialité invalide.";
            }

            const selectedSpecialite = specialites[number - 1];

            await this.convManager.updateState(phone, this.states.WAITING_DATE, {
                context: { ...conv.context, selected_specialite: selectedSpecialite }
            });

            return `🩺 *${selectedSpecialite}*\n\nVeuillez indiquer la date souhaitée (JJ/MM/AAAA) :`;
        }

        async handleWaitingDate(phone, message, conv) {
            const date = Utils.extractDate(message);

            if (!date) {
                return "Format de date incorrect. Utilisez JJ/MM/AAAA (ex: 15/04/2026).";
            }

            await this.convManager.updateState(phone, this.states.WAITING_HEURE, {
                context: { ...conv.context, selected_date: date }
            });

            return `📅 Date: ${date}\n\nIndiquez l'heure (HH:MM, ex: 14:30) :`;
        }

        async handleWaitingHeure(phone, message, conv) {
            const heure = Utils.extractTime(message);

            if (!heure) {
                return "Format d'heure incorrect. Utilisez HH:MM (ex: 14:30).";
            }

            await this.convManager.updateState(phone, this.states.WAITING_RDV_CONFIRMATION, {
                context: { ...conv.context, selected_heure: heure }
            });

            await this.whatsapp.sendInteractiveButtons(phone,
                `📋 *Récapitulatif*\n🏥 Clinique: ${conv.context.selected_clinic?.nom_clinique}\n🩺 Spécialité: ${conv.context.selected_specialite}\n📅 Date: ${conv.context.selected_date}\n⏰ Heure: ${heure}`,
                ["✅ Confirmer", "✏️ Modifier", "❌ Annuler"]
            );
            return null;
        }

        async handleWaitingRdvConfirmation(phone, message, conv) {
            const confirmation = message.toLowerCase();

            if (confirmation === 'oui' || confirmation === 'o' || confirmation === 'confirmer' || message === '✅ Confirmer') {
                try {
                    const medecins = await this.clinicService.getMedecinsBySpecialite(
                        conv.context.selected_specialite, 
                        conv.context.selected_clinic.ville
                    );
                    const medecin = medecins.length > 0 ? medecins[0].medecin : 'Médecin disponible';

                    const appointmentData = {
                        id_clinique: conv.context.selected_clinic.id_clinique,
                        medecin: medecin,
                        specialite: conv.context.selected_specialite,
                        patient_nom: conv.context.client_nom || 'Patient',
                        patient_telephone: phone,
                        date_rdv: conv.context.selected_date,
                        heure_rdv: conv.context.selected_heure
                    };

                    const appointmentId = await this.clinicService.createAppointment(appointmentData);

                    await this.whatsapp.sendMessage(CLINIC_NOTIFICATION_PHONE,
                        `📅 RDV: ${appointmentId}\n👤 ${phone}\n🏥 ${conv.context.selected_clinic.nom_clinique}\n🩺 ${conv.context.selected_specialite}\n👨‍⚕️ ${medecin}\n📅 ${conv.context.selected_date} ${conv.context.selected_heure}`);

                    await this.convManager.updateState(phone, this.states.RDV_COMPLETED, { context: {} });

                    await this.whatsapp.sendInteractiveButtons(phone,
                        `Rendez-vous confirmé ! 🎉\nNuméro: ${appointmentId}`,
                        ["📅 Autre RDV", "💊 Médicaments", "🏠 Accueil"]
                    );
                    return null;
                } catch (error) {
                    log('ERROR', 'Erreur création rendez-vous:', error);
                    return "Erreur lors de la confirmation. Réessayez plus tard. 😔";
                }
            } else if (confirmation === 'modifier' || message === '✏️ Modifier') {
                return await this.handleIntentPrendreRdv(conv);
            } else {
                await this.convManager.updateState(phone, this.states.IDLE, { context: {} });
                return "Rendez-vous annulé. ❌";
            }
        }

        async handleWaitingCommandeId(phone, message, conv) {
            const commandeId = Utils.extractCommandId(message) || message.trim();

            if (!commandeId || commandeId.length < 5) {
                return "Numéro de commande invalide. Vérifiez le format (ex: CMD2402150001).";
            }

            const order = await this.orderService.getOrderById(commandeId);

            if (!order) {
                return `Aucune commande trouvée avec l'ID ${commandeId}.`;
            }

            const statusMessages = {
                'PENDING': 'en attente de confirmation',
                'ASSIGNED': 'acceptée par livreur',
                'PICKED_UP': 'récupérée par livreur',
                'DELIVERED': 'livrée',
                'CANCELLED': 'annulée'
            };

            return `Commande ${commandeId} : ${statusMessages[order.status_livreur] || order.status}`;
        }

        async handleWaitingRdvId(phone, message, conv) {
            const rdvId = Utils.extractRdvId(message) || message.trim();

            if (!rdvId || rdvId.length < 5) {
                return "Numéro de rendez-vous invalide. Vérifiez le format (ex: RDV2026030201).";
            }

            const appointment = await this.clinicService.getAppointmentById(rdvId);

            if (!appointment) {
                return `Aucun rendez-vous trouvé avec l'ID ${rdvId}.`;
            }

            return `Rendez-vous ${rdvId} : ${appointment.status === 'CONFIRME' ? 'Confirmé' : appointment.status}`;
        }

        async handleWaitingModification(phone, message, conv) {
            return "Modification en cours de développement...";
        }
    }

    // Initialisation DB
    async function initDatabase() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS medicaments_cache (
                    id SERIAL PRIMARY KEY,
                    code_produit VARCHAR(50),
                    nom_commercial VARCHAR(200) NOT NULL,
                    dci VARCHAR(200),
                    prix DECIMAL(10, 2) NOT NULL,
                    categorie VARCHAR(50),
                    last_updated TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS pharmacies_cache (
                    id SERIAL PRIMARY KEY,
                    nom VARCHAR(200) UNIQUE NOT NULL,
                    localite VARCHAR(100) NOT NULL,
                    adresse TEXT,
                    telephone_principal VARCHAR(50),
                    last_updated TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS conversations (
                    phone VARCHAR(20) PRIMARY KEY,
                    state VARCHAR(50) DEFAULT 'IDLE',
                    cart JSONB DEFAULT '[]',
                    context JSONB DEFAULT '{}',
                    history JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS orders (
                    id VARCHAR(50) PRIMARY KEY,
                    client_name VARCHAR(100),
                    client_phone VARCHAR(20),
                    client_quartier VARCHAR(100),
                    client_indications TEXT,
                    items JSONB NOT NULL,
                    subtotal DECIMAL(10, 2) NOT NULL,
                    delivery_price DECIMAL(10, 2) NOT NULL,
                    total DECIMAL(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'PENDING',
                    status_livreur VARCHAR(50) DEFAULT 'PENDING',
                    confirmation_code VARCHAR(20),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS livreurs (
                    id SERIAL PRIMARY KEY,
                    phone VARCHAR(20) UNIQUE NOT NULL,
                    nom VARCHAR(100),
                    zone VARCHAR(100),
                    disponible BOOLEAN DEFAULT true,
                    commandes_livrees INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS commande_livreurs (
                    id SERIAL PRIMARY KEY,
                    commande_id VARCHAR(50) REFERENCES orders(id) ON DELETE CASCADE,
                    livreur_phone VARCHAR(20) REFERENCES livreurs(phone),
                    status_livreur VARCHAR(50) DEFAULT 'ASSIGNED',
                    assigned_at TIMESTAMP DEFAULT NOW(),
                    picked_up_at TIMESTAMP,
                    delivered_at TIMESTAMP,
                    UNIQUE(commande_id)
                );

                CREATE TABLE IF NOT EXISTS cliniques (
                    id_clinique VARCHAR(10) PRIMARY KEY,
                    nom_clinique VARCHAR(200) NOT NULL,
                    quartier VARCHAR(100),
                    ville VARCHAR(100) DEFAULT 'abidjan',
                    telephone VARCHAR(50),
                    horaires_ouverture VARCHAR(100),
                    urgences VARCHAR(10) DEFAULT '24h/24',
                    services_generaux TEXT,
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS medecins_clinique (
                    id SERIAL PRIMARY KEY,
                    id_clinique VARCHAR(10) REFERENCES cliniques(id_clinique) ON DELETE CASCADE,
                    medecin VARCHAR(100) NOT NULL,
                    specialite VARCHAR(100) NOT NULL,
                    tarif_consultation VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS rendez_vous (
                    id VARCHAR(50) PRIMARY KEY,
                    id_clinique VARCHAR(10) REFERENCES cliniques(id_clinique),
                    medecin VARCHAR(100),
                    specialite VARCHAR(100),
                    patient_nom VARCHAR(100),
                    patient_telephone VARCHAR(20),
                    date_rdv VARCHAR(20),
                    heure_rdv VARCHAR(10),
                    status VARCHAR(50) DEFAULT 'CONFIRME',
                    created_at TIMESTAMP DEFAULT NOW()
                );
            `);

            log('SUCCESS', 'Base de données initialisée');
        } catch (err) {
            log('ERROR', 'Erreur DB:', err);
        }
    }

    // Webhook WhatsApp
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

            if (!change || change.field !== 'messages') return;

            const msg = change.value?.messages?.[0];
            if (!msg || msg.type !== 'text') return;

            const from = msg.from;
            const msgId = msg.id;
            const text = msg.text.body.trim();

            if (processedMessages.has(msgId)) return;
            processedMessages.set(msgId, true);

            await whatsappService.markAsRead(msgId);

            // Vérifier si c'est une réponse de livreur
            if (text.startsWith('ACCEPTER ') || text.startsWith('RECUPERER ') || text.startsWith('LIVRER ')) {
                await orderService.handleLivreurResponse(from, text, convManager);
                return;
            }

            stats.messagesProcessed++;
            stats.activeUsers.add(from);
            timeoutManager.registerActivity(from);

            log('WEBHOOK', `Message de ${from}: ${text}`);

            const response = await conversationEngine.process(from, text);

            if (response) {
                await whatsappService.sendMessage(from, response);
            }

        } catch (error) {
            log('ERROR', 'Erreur webhook:', error);
            stats.errors++;
        }
    });

    // Routes API
    app.get('/', (req, res) => {
        const delivery = Utils.getCurrentDeliveryPrice();
        res.json({
            name: 'MIA - Pillbox CI',
            version: '7.0.0-light',
            status: 'production',
            description: 'Version allégée avec Fuse.js et gestion livreurs',
            uptime: process.uptime(),
            delivery: delivery,
            stats: {
                messages: stats.messagesProcessed,
                orders: stats.ordersCreated,
                appointments: stats.appointmentsCreated,
                activeUsers: stats.activeUsers.size,
                uptime: Math.floor((Date.now() - stats.startTime) / 1000)
            }
        });
    });

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/api/search', async (req, res) => {
        try {
            const { q } = req.query;
            if (!q || q.length < 2) {
                return res.status(400).json({ error: 'Requête trop courte' });
            }
            const results = await searchEngine.search(q);
            res.json({ success: true, ...results });
        } catch (error) {
            log('ERROR', 'Erreur API recherche:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Route pour enregistrer un livreur
    app.post('/api/livreur/register', async (req, res) => {
        try {
            const { phone, nom, zone } = req.body;
            const success = await livreurService.registerLivreur(phone, nom, zone);
            
            if (success) {
                res.json({ success: true, message: "Livreur enregistré" });
            } else {
                res.status(400).json({ success: false, message: "Erreur enregistrement" });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Route pour les commandes d'un livreur
    app.get('/api/livreur/:phone/commandes', async (req, res) => {
        try {
            const { phone } = req.params;
            const { status } = req.query;
            const commandes = await livreurService.getCommandesLivreur(phone, status);
            res.json({ success: true, commandes });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Initialisation des services
    const whatsappService = new WhatsAppService();
    const nlpService = new NLPService();
    const groqService = new GroqService();
    const pharmacyScraper = new SimplePharmacyScraper();
    const searchEngine = new SimpleSearchEngine(pool);
    const clinicService = new ClinicService(pool);
    const convManager = new ConversationManager(pool);
    const livreurService = new LivreurService(pool, whatsappService);
    const orderService = new OrderService(pool, whatsappService, livreurService);
    const cacheManager = new CacheManager(pharmacyScraper, pool);

    const conversationEngine = new ConversationEngine(
        nlpService, groqService, searchEngine, clinicService, 
        orderService, convManager, whatsappService, livreurService, pharmacyScraper
    );

    const timeoutManager = new TimeoutManager(convManager, whatsappService);

    // Démarrage
    const server = app.listen(PORT, '0.0.0.0', async () => {
        await initDatabase();
        await nlpService.loadModel();
        await searchEngine.buildIndex();

        setTimeout(async () => {
            await cacheManager.refreshAll();
            setInterval(() => cacheManager.refreshAll(), 60 * 60 * 1000);
        }, 5000);

        console.log(`
    ╔══════════════════════════════════════════════════════════════╗
    ║     🚀 MIA - Pillbox CI 🇨🇮 VERSION LIVREURS                  ║
    ╠══════════════════════════════════════════════════════════════╣
    ║  Worker: ${process.pid}                                                ║
    ║  Port: ${PORT}                                                     ║
    ║                                                              ║
    ║  🔍 Moteur de recherche: Fuse.js uniquement                 ║
    ║  ✅ Tolérance aux fautes d'orthographe                       ║
    ║                                                              ║
    ║  🛵 GESTION LIVREURS ACTIVE                                  ║
    ║  • ACCEPTER - Prendre commande                               ║
    ║  • RECUPERER - Récupérer commande                            ║
    ║  • LIVRER + code - Finaliser livraison                       ║
    ║                                                              ║
    ║  🎯 BOUTONS INTERACTIFS                                      ║
    ║  • Panier : MODIFIER / CONFIRMER / ANNULER                   ║
    ║  • RDV : MODIFIER / CONFIRMER                                ║
    ║                                                              ║
    ║  💰 Livraison: Nuit 600F | Jour 400F | Gratuit >5000F       ║
    ╚══════════════════════════════════════════════════════════════╝
        `);
    });

    // Gestion des erreurs
    process.on('unhandledRejection', (err) => {
        log('ERROR', 'Unhandled Rejection:', err);
        stats.errors++;
    });

    process.on('uncaughtException', (err) => {
        log('ERROR', 'Uncaught Exception:', err);
        stats.errors++;
        if (NODE_ENV === 'production') {
            console.error('Erreur fatale, redémarrage...');
            process.exit(1);
        }
    });

    process.on('SIGTERM', () => {
        log('INFO', 'SIGTERM reçu, arrêt gracieux...');
        server.close(() => {
            pool.end();
            process.exit(0);
        });
    });

    module.exports = app;
}
