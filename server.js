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

// ==================== CONSTANTES ====================
const PORT = process.env.PORT || 10000;
const NODE_ENV = process.env.NODE_ENV || 'production';

// WhatsApp API
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;

// Groq API - UNIQUEMENT pour générer des réponses naturelles
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Configuration de recherche Fuse.js
const SEARCH_CONFIG = {
    MIN_TERM_LENGTH: 2,
    MAX_RESULTS: 20,
    FUSE_THRESHOLD: 0.3,        // Très tolérant aux fautes
    FUSE_DISTANCE: 200,          // Distance pour fautes de frappe
    MIN_MATCH_CHARS: 2           // Commence à chercher dès 2 caractères
};

// Sources de données
const SOURCES = {
    PHARMACIES_GARDE: {
        url: process.env.PHARMACIES_URL || 'https://annuaireci.com/pharmacies-de-garde/',
        type: 'pharmacies'
    }
};

// Tarifs livraison (sans gratuité)
const DELIVERY_PRICES = {
    NIGHT: { startHour: 0, endHour: 7, price: 600 },
    DAY: { startHour: 8, endHour: 23, price: 400 }
};

// Contacts
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';
const CLINIC_NOTIFICATION_PHONE = process.env.CLINIC_NOTIFICATION_PHONE || '2250701406880';

// ==================== CLUSTERING ====================
const numCPUs = Math.min(os.cpus().length, 2);
if (cluster.isPrimary && NODE_ENV === 'production') {
    console.log(`Master PID ${process.pid} - Lancement de ${numCPUs} workers...`);
    for (let i = 0; i < numCPUs; i++) cluster.fork();
    cluster.on('exit', (worker) => {
        console.log(`Worker ${worker.process.pid} mort. Redémarrage...`);
        cluster.fork();
    });
} else {
    // ==================== EXPRESS ====================
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
        keyGenerator: (req) => req.ip || req.connection.remoteAddress,
        skip: (req) => req.ip === '::1' || req.ip === '127.0.0.1'
    });
    app.use('/webhook', limiter);

    // ==================== CACHES ====================
    const cache = new NodeCache({ stdTTL: 300 });
    const processedMessages = new NodeCache({ stdTTL: 300 });

    // ==================== STATISTIQUES ====================
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

    // ==================== BASE DE DONNÉES ====================
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

    // ==================== LOGGING ====================
    function log(level, message, data = null) {
        const icons = { 
            INFO: '📘', SUCCESS: '✅', ERROR: '❌', USER: '👤', BOT: '🤖', 
            NLP: '🧠', GROQ: '🔥', SCRAPE: '🕷️', WEBHOOK: '📨', CACHE: '📦',
            DB: '💾', ORDER: '📦', APPT: '📅', SEARCH: '🔍', LIVREUR: '🛵' 
        };
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] ${icons[level] || '📌'} ${message}`);
        if (data && NODE_ENV !== 'production') console.log('   📎 Data:', JSON.stringify(data, null, 2));
    }

    // ==================== ÉTATS DE CONVERSATION ====================
    const ConversationStates = {
        IDLE: 'IDLE',
        GREETED: 'GREETED',
        SEARCHING: 'SEARCHING',
        WAITING_MEDICINE: 'WAITING_MEDICINE',
        WAITING_QUANTITY: 'WAITING_QUANTITY',
        WAITING_QUARTIER: 'WAITING_QUARTIER',
        WAITING_NAME: 'WAITING_NAME',
        WAITING_PHONE: 'WAITING_PHONE',
        WAITING_INDICATIONS: 'WAITING_INDICATIONS',
        WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
        ORDER_COMPLETED: 'ORDER_COMPLETED',
        WAITING_CLINIC: 'WAITING_CLINIC',
        WAITING_CLINIC_SELECTION: 'WAITING_CLINIC_SELECTION',
        WAITING_SPECIALITE: 'WAITING_SPECIALITE',
        WAITING_SPECIALITE_SELECTION: 'WAITING_SPECIALITE_SELECTION',
        WAITING_PATIENT_INFO: 'WAITING_PATIENT_INFO',
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

    // ==================== UTILITAIRES ====================
    class Utils {
        static cleanText(text) {
            if (!text) return '';
            return text.replace(/\s+/g, ' ').trim();
        }

        static normalizeText(text) {
            if (!text) return '';
            return text
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
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

        static formatDate(dateStr) {
            try {
                const [day, month, year] = dateStr.split('/');
                return `${day}/${month}/${year}`;
            } catch {
                return dateStr;
            }
        }

        static formatTime(timeStr) {
            try {
                const [hours, minutes] = timeStr.split(':');
                return `${hours}h${minutes !== '00' ? minutes : ''}`;
            } catch {
                return timeStr;
            }
        }

        static formatPhoneNumber(phone) {
            return phone.replace(/\D/g, '');
        }

        static calculateAge(birthDate) {
            const today = new Date();
            const birth = new Date(birthDate.split('/').reverse().join('-'));
            let age = today.getFullYear() - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
                age--;
            }
            return age;
        }

        static formatCart(cart) {
            const subtotal = cart.reduce((sum, i) => sum + (i.prix * (i.quantite || 1)), 0);
            const delivery = this.getCurrentDeliveryPrice();
            const deliveryPrice = delivery.price;
            
            const items = cart.map((i, idx) => 
                `${idx+1} x ${i.nom_commercial} - ${i.prix * (i.quantite || 1)} FCFA`
            ).join('\n');
            
            return {
                items,
                subtotal,
                deliveryPrice,
                total: subtotal + deliveryPrice,
                formatted: `${items}\n\nSous-total : ${subtotal} FCFA\nFrais de livraison : ${deliveryPrice} FCFA\nPrix Total : ${subtotal + deliveryPrice} FCFA`
            };
        }
    }

    // ==================== MOTEUR DE RECHERCHE FUSE.js OPTIMISÉ ====================
    class SearchEngine {
        constructor(pool) {
            this.pool = pool;
            this.fuse = null;
            this.medicaments = [];
            this.indexReady = false;
            
            this.fuseOptions = {
                includeScore: true,
                threshold: SEARCH_CONFIG.FUSE_THRESHOLD,
                distance: SEARCH_CONFIG.FUSE_DISTANCE,
                minMatchCharLength: SEARCH_CONFIG.MIN_MATCH_CHARS,
                findAllMatches: true,
                ignoreLocation: true,
                shouldSort: true,
                tokenize: true,
                matchAllTokens: false,
                keys: [
                    { name: 'nom_commercial', weight: 3 },
                    { name: 'nom_sans_espace', weight: 3 },
                    { name: 'dci', weight: 1.5 },
                    { name: 'categorie', weight: 1 },
                    { name: 'code_produit', weight: 1 }
                ],
                getFn: (obj, path) => {
                    const value = this._getValue(obj, path);
                    return value ? Utils.normalizeText(value) : '';
                }
            };
        }

        _getValue(obj, path) {
            return path.split('.').reduce((current, key) => current && current[key], obj) || '';
        }

        async buildIndex() {
            try {
                log('INFO', 'Construction index de recherche Fuse.js...');
                
                const result = await this.pool.query(`
                    SELECT 
                        code_produit,
                        nom_commercial,
                        REPLACE(LOWER(nom_commercial), ' ', '') as nom_sans_espace,
                        dci,
                        prix,
                        categorie
                    FROM medicaments
                    WHERE nom_commercial IS NOT NULL
                `);
                
                this.medicaments = result.rows;
                this.fuse = new Fuse(this.medicaments, this.fuseOptions);
                this.indexReady = true;
                
                log('SUCCESS', `Index créé avec ${this.medicaments.length} médicaments`);
                return true;
            } catch (error) {
                log('ERROR', 'Erreur construction index:', error);
                return false;
            }
        }

        async search(query, limit = 10) {
            if (!this.indexReady || !query || query.length < 2) {
                return { results: [], suggestions: [] };
            }

            const start = Date.now();
            const normalized = Utils.normalizeText(query);
            
            // Recherche exacte en priorité
            const exactMatches = this.medicaments
                .filter(m => Utils.normalizeText(m.nom_commercial).includes(normalized))
                .map(m => ({ item: m, score: 1, type: 'exact' }));
            
            // Recherche floue avec Fuse
            const fuseResults = this.fuse.search(query).map(r => ({
                item: r.item,
                score: 1 - (r.score || 0),
                type: 'fuzzy'
            }));
            
            // Fusion et déduplication
            const seen = new Set();
            const results = [];
            
            [...exactMatches, ...fuseResults].forEach(r => {
                if (!seen.has(r.item.code_produit)) {
                    seen.add(r.item.code_produit);
                    results.push(r);
                }
            });
            
            const time = Date.now() - start;
            log('SEARCH', `Recherche "${query}" : ${results.length} résultats en ${time}ms`);
            
            return {
                results: results.slice(0, limit),
                suggestions: this._getSuggestions(query, results),
                total: results.length,
                time
            };
        }

        _getSuggestions(query, results) {
            const suggestions = new Set();
            const normalized = Utils.normalizeText(query);
            
            results.slice(0, 5).forEach(r => suggestions.add(r.item.nom_commercial));
            
            this.medicaments
                .filter(m => Utils.normalizeText(m.nom_commercial).startsWith(normalized))
                .slice(0, 3)
                .forEach(m => suggestions.add(m.nom_commercial));
            
            return Array.from(suggestions).slice(0, 5);
        }

        async getMedicineByName(name) {
            const results = await this.search(name, 1);
            return results.results.length > 0 ? results.results[0].item : null;
        }
    }

    // ==================== SCRAPER PHARMACIES OPTIMISÉ ====================
    class PharmacyScraper {
        constructor() {
            this.baseUrl = SOURCES.PHARMACIES_GARDE.url;
            this.timeout = 8000;
            this.cachePrefix = 'pharmacies';
            this.userAgents = [
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ];
        }

        async fetchWeek(weekId = null) {
            const cacheKey = weekId ? `${this.cachePrefix}_${weekId}` : `${this.cachePrefix}_current`;
            
            const cached = cache.get(cacheKey);
            if (cached && !this._isWeekExpired(cached.week_info)) {
                stats.cacheHits++;
                return cached;
            }

            try {
                const url = weekId ? `${this.baseUrl}?schedule=${weekId}` : this.baseUrl;
                log('SCRAPE', `Récupération semaine ${weekId || 'courante'}...`);
                
                const response = await axios.get(url, {
                    headers: {
                        'User-Agent': this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
                        'Cache-Control': 'no-cache'
                    },
                    timeout: this.timeout
                });

                const $ = cheerio.load(response.data);
                
                const [weekInfo, pharmacies, scheduleOptions] = await Promise.all([
                    this._extractWeekInfo($),
                    this._extractPharmacies($),
                    this._extractScheduleOptions($)
                ]);

                const result = {
                    week_info: weekInfo,
                    pharmacies: pharmacies,
                    schedule_options: scheduleOptions,
                    total: pharmacies.length,
                    scraped_at: new Date().toISOString()
                };

                const ttl = this._calculateTTL(weekInfo);
                cache.set(cacheKey, result, ttl);
                
                stats.cacheMisses++;
                stats.scrapes++;
                
                log('SUCCESS', `${pharmacies.length} pharmacies (semaine ${weekInfo.weekId || 'courante'})`);
                
                return result;

            } catch (error) {
                log('ERROR', `Scraping échoué: ${error.message}`);
                const expired = cache.get(cacheKey);
                if (expired) {
                    log('WARN', 'Utilisation cache expiré');
                    return { ...expired, from_expired_cache: true };
                }
                return this._getEmptyResult();
            }
        }

        async _extractPharmacies($) {
            const pharmacies = [];
            const sections = $('.pharmacy-section');
            
            sections.each((i, section) => {
                const $section = $(section);
                const localite = $section.find('h3').first().text().trim();
                const cleanLocalite = localite.replace(/\(\d+\)$/, '').trim();
                
                $section.find('.pharmacy-card').each((j, card) => {
                    const $card = $(card);
                    
                    pharmacies.push({
                        nom: this._extractNom($card),
                        localite: cleanLocalite,
                        adresse: this._extractAdresse($card),
                        telephone: this._extractTelephone($card),
                        telephones: this._extractAllTelephones($card),
                        url: this._extractUrl($card)
                    });
                });
            });
            
            return pharmacies;
        }

        _extractNom($card) {
            const nomLink = $card.find('h4 a').first();
            if (nomLink.length) {
                return nomLink.text().trim();
            }
            return $card.find('h4').first().text().trim() || 'Pharmacie sans nom';
        }

        _extractAdresse($card) {
            const mapIcon = $card.find('i.fa-map-marker-alt').first();
            if (mapIcon.length) {
                const p = mapIcon.closest('p');
                return p.find('span').first().text().trim() || p.text().replace(mapIcon.text(), '').trim();
            }
            
            const p = $card.find('p').filter((_, el) => {
                const text = $(el).text().toLowerCase();
                return text.includes('rue') || text.includes('quartier') || 
                       text.includes('carrefour') || text.includes('face');
            }).first();
            
            return p.length ? p.text().trim() : 'Adresse non spécifiée';
        }

        _extractTelephone($card) {
            const telLink = $card.find('a[href^="tel:"]').first();
            if (telLink.length) {
                return telLink.text().trim();
            }
            
            const phoneIcon = $card.find('i.fa-phone-alt').first();
            if (phoneIcon.length) {
                const p = phoneIcon.closest('p');
                const text = p.text().trim();
                const match = text.match(/(\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2})/);
                return match ? match[0] : 'Non disponible';
            }
            
            return 'Non disponible';
        }

        _extractAllTelephones($card) {
            const telephones = [];
            
            $card.find('a[href^="tel:"]').each((_, link) => {
                const tel = $(link).text().trim();
                if (tel && !telephones.includes(tel)) telephones.push(tel);
            });
            
            $card.find('i.fa-phone-alt').each((_, icon) => {
                const p = $(icon).closest('p');
                const text = p.text().trim();
                const matches = text.match(/(\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2})/g);
                if (matches) {
                    matches.forEach(m => {
                        if (!telephones.includes(m)) telephones.push(m);
                    });
                }
            });
            
            return telephones.length ? telephones : ['Non disponible'];
        }

        _extractUrl($card) {
            const link = $card.find('h4 a').first();
            if (link.length) {
                let url = link.attr('href');
                if (url && !url.startsWith('http')) {
                    url = 'https://annuaireci.com' + url;
                }
                return url;
            }
            return null;
        }

        _extractWeekInfo($) {
            const weekInfo = {
                weekId: null,
                startDate: null,
                endDate: null,
                currentWeek: false,
                expiresAt: null
            };
            
            const selected = $('.schedule-selector select option:selected');
            if (selected.length) {
                weekInfo.weekId = selected.val();
                const text = selected.text().trim();
                
                const dateMatch = text.match(/Du (\d{2}\/\d{2}\/\d{4}) au (\d{2}\/\d{2}\/\d{4})/);
                if (dateMatch) {
                    weekInfo.startDate = dateMatch[1];
                    weekInfo.endDate = dateMatch[2];
                }
                
                weekInfo.currentWeek = text.includes('Semaine actuelle');
            }
            
            if (weekInfo.endDate) {
                const [day, month, year] = weekInfo.endDate.split('/');
                const expiryDate = new Date(year, month - 1, parseInt(day) + 1);
                weekInfo.expiresAt = expiryDate.toISOString();
            }
            
            return weekInfo;
        }

        _extractScheduleOptions($) {
            const options = [];
            $('.schedule-selector select option').each((i, opt) => {
                const $opt = $(opt);
                options.push({
                    id: $opt.val(),
                    text: $opt.text().trim(),
                    selected: $opt.is(':selected'),
                    current: $opt.text().includes('Semaine actuelle')
                });
            });
            return options;
        }

        _isWeekExpired(weekInfo) {
            if (!weekInfo || !weekInfo.endDate) return true;
            
            const [day, month, year] = weekInfo.endDate.split('/');
            const endDate = new Date(year, month - 1, day);
            const now = new Date();
            
            return now > new Date(endDate.setDate(endDate.getDate() + 1));
        }

        _calculateTTL(weekInfo) {
            if (!weekInfo || !weekInfo.endDate) return 3600;
            
            const [day, month, year] = weekInfo.endDate.split('/');
            const expiryDate = new Date(year, month - 1, parseInt(day) + 1, 0, 0, 0);
            const now = new Date();
            
            const ttlSeconds = Math.floor((expiryDate - now) / 1000);
            return Math.max(300, Math.min(ttlSeconds, 7 * 24 * 3600));
        }

        _getEmptyResult() {
            return {
                week_info: { weekId: null, startDate: null, endDate: null, currentWeek: false },
                pharmacies: [],
                schedule_options: [],
                total: 0,
                error: true
            };
        }

        async searchByLocation(term, weekId = null) {
            if (!term || term.length < 2) return [];
            
            const data = await this.fetchWeek(weekId);
            const pharmacies = data.pharmacies;
            const searchTerm = Utils.normalizeText(term);
            
            return pharmacies
                .filter(p => 
                    Utils.normalizeText(p.localite).includes(searchTerm) ||
                    Utils.normalizeText(p.adresse).includes(searchTerm) ||
                    Utils.normalizeText(p.nom).includes(searchTerm)
                )
                .slice(0, 10);
        }

        async getAvailableLocations(weekId = null) {
            const data = await this.fetchWeek(weekId);
            const locations = new Set();
            
            data.pharmacies.forEach(p => {
                if (p.localite && p.localite !== 'Non spécifié') {
                    locations.add(p.localite);
                }
            });
            
            return Array.from(locations).sort();
        }
    }

    // ==================== SERVICE CLINIQUE ====================
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

        async getClinicById(id) {
            const result = await this.pool.query(
                'SELECT * FROM cliniques WHERE id_clinique = $1',
                [id]
            );
            return result.rows[0];
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
                    patient_nom, patient_telephone, patient_age, patient_poids, patient_taille,
                    date_rdv, heure_rdv, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                appointmentId,
                data.id_clinique,
                data.medecin,
                data.specialite,
                data.patient_nom,
                data.patient_telephone,
                data.patient_age,
                data.patient_poids,
                data.patient_taille,
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

        async handleVoiceMessage(to) {
            await this.sendMessage(to, 
                "Désolé, je ne peux pas traiter les messages vocaux. 🎤❌\n\n" +
                "Veuillez écrire votre demande ou utiliser les boutons interactifs, s'il vous plaît. 😊"
            );
        }
    }

    // ==================== NLP SERVICE ====================
    class NLPService {
        constructor() {
            this.manager = null;
            this.modelPath = path.join(__dirname, 'model.nlp');
            this.ready = false;
        }

        async loadModel() {
            try {
                log('INFO', 'Chargement du modèle NLP...');
                this.manager = new NlpManager({ languages: ['fr'], forceNER: true });
                
                const fs = require('fs');
                if (fs.existsSync(this.modelPath)) {
                    this.manager.load(this.modelPath);
                    this.ready = true;
                    log('SUCCESS', 'Modèle NLP chargé avec succès');
                } else {
                    log('WARN', 'Fichier modèle NLP non trouvé');
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
                    return { 
                        intent: 'nlu_fallback', 
                        confidence: 0, 
                        entities: {},
                        error: 'Modèle NLP non disponible'
                    };
                }
                
                const result = await this.manager.process('fr', message);

                const formattedResult = {
                    intent: result.intent || 'nlu_fallback',
                    confidence: Math.round((result.score || 0) * 100),
                    entities: {}
                };

                if (result.entities) {
                    result.entities.forEach(entity => {
                        if (entity.entity && entity.option) {
                            formattedResult.entities[entity.entity] = entity.option;
                        } else if (entity.entity && entity.sourceText) {
                            formattedResult.entities[entity.entity] = entity.sourceText;
                        }
                    });
                }

                cache.set(cacheKey, formattedResult, 300);
                stats.cacheMisses++;

                log('NLP', `Intention: ${formattedResult.intent} (${formattedResult.confidence}%)`);
                return formattedResult;

            } catch (error) {
                log('ERROR', 'Erreur analyse NLP:', error);
                return { 
                    intent: 'nlu_fallback', 
                    confidence: 0, 
                    entities: {}
                };
            }
        }
    }

    // ==================== GROQ SERVICE (UNIQUEMENT POUR RÉPONSES NATURELLES) ====================
    class GroqService {
        constructor() {
            this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
            this.model = GROQ_MODEL;
        }

        async generateResponse(context) {
            if (!this.client) return null;
            
            try {
                stats.groqCalls++;
                
                const messages = [
                    { 
                        role: 'system', 
                        content: `Tu es MIA, assistante santé de Pillbox CI en Côte d'Ivoire. 
                        Réponds de façon naturelle, chaleureuse et concise. 
                        Utilise des émojis adaptés. 
                        Ne répète pas les informations techniques, reformule-les de façon agréable.
                        Format de réponse simple et clair.` 
                    },
                    { role: 'user', content: this._buildPrompt(context) }
                ];

                const completion = await this.client.chat.completions.create({
                    messages: messages,
                    model: this.model,
                    temperature: 0.7,
                    max_tokens: 300
                });

                return completion.choices[0]?.message?.content || null;
            } catch (error) {
                log('ERROR', 'Erreur Groq:', error.message);
                return null;
            }
        }

        _buildPrompt(context) {
            const { intent, data, userMessage } = context;
            
            let prompt = `L'utilisateur a dit : "${userMessage}"\n`;
            prompt += `Intention détectée : ${intent}\n`;
            
            if (data) {
                prompt += `Données : ${JSON.stringify(data, null, 2)}\n`;
            }
            
            prompt += `Génère une réponse naturelle et chaleureuse.`;
            
            return prompt;
        }
    }

    // ==================== GESTIONNAIRE DE CONVERSATIONS ====================
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
                        `INSERT INTO conversations (phone, state, cart, context, history, pending_medicament)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING *`,
                        [phone, ConversationStates.IDLE, '[]', '{}', '[]', null]
                    );
                    return this._parseConversation(newConv.rows[0]);
                }

                return this._parseConversation(result.rows[0]);
            } catch (error) {
                log('ERROR', 'Erreur récupération conversation:', error);
                return { 
                    phone, 
                    state: ConversationStates.IDLE, 
                    cart: [], 
                    context: {}, 
                    history: [], 
                    pending_medicament: null 
                };
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

                if (newState) {
                    updates.push(`state = $${i++}`);
                    values.push(newState);
                }

                if (data.cart !== undefined) {
                    updates.push(`cart = $${i++}`);
                    values.push(JSON.stringify(data.cart));
                }

                if (data.context) {
                    updates.push(`context = $${i++}`);
                    values.push(JSON.stringify(data.context));
                }

                if (data.pending_medicament !== undefined) {
                    updates.push(`pending_medicament = $${i++}`);
                    values.push(data.pending_medicament);
                }

                updates.push(`updated_at = NOW()`);

                const query = `
                    UPDATE conversations
                    SET ${updates.join(', ')}
                    WHERE phone = $${i}
                `;

                await this.pool.query(query, [...values, phone]);
                return true;
            } catch (error) {
                log('ERROR', 'Erreur mise à jour conversation:', error);
                return false;
            }
        }

        async addToHistory(phone, role, message, intent) {
            try {
                const conv = await this.getConversation(phone);
                const history = conv.history || [];
                history.push({ role, message, intent, time: new Date().toISOString() });
                if (history.length > 10) history.shift();
                await this.updateState(phone, null, { history });
            } catch (error) {
                log('ERROR', 'Erreur ajout historique:', error);
            }
        }

        async clearContext(phone) {
            try {
                await this.updateState(phone, ConversationStates.IDLE, { 
                    context: {}, 
                    cart: [],
                    pending_medicament: null 
                });
                return true;
            } catch (error) {
                log('ERROR', 'Erreur nettoyage contexte:', error);
                return false;
            }
        }
    }

    // ==================== SERVICE LIVREUR ====================
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

    // ==================== SERVICE DE COMMANDES ====================
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
            return Utils.getCurrentDeliveryPrice().price; // Pas de gratuité
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

        async getOrdersByPhone(phone) {
            const result = await this.pool.query(
                'SELECT * FROM orders WHERE client_phone = $1 ORDER BY created_at DESC',
                [phone]
            );
            return result.rows.map(row => {
                row.items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items;
                return row;
            });
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
            const items = order.items.map(i => `• ${i.nom_commercial} x${i.quantite || 1}`).join('\n');
            const message = 
                `📦 *NOUVELLE COMMANDE*\n\n` +
                `ID: ${order.id}\n` +
                `Code: ${order.confirmation_code}\n\n` +
                `👤 Client: ${order.client_name}\n` +
                `📱 Tél: ${order.client_phone}\n` +
                `📍 Quartier: ${order.client_quartier}\n` +
                `📝 Indications: ${order.client_indications || 'Aucune'}\n\n` +
                `📦 Articles:\n${items}\n\n` +
                `💰 Total: ${order.total} FCFA`;

            await this.whatsapp.sendMessage(SUPPORT_PHONE, message);
        }

        async notifyLivreursDisponibles(order) {
            try {
                const livreurs = await this.livreurService.getLivreursDisponibles();
                
                if (livreurs.length === 0) {
                    log('WARN', 'Aucun livreur disponible');
                    return;
                }

                const items = order.items.map(i => `• ${i.nom_commercial} x${i.quantite || 1}`).join('\n');
                const message = 
                    `📦 *NOUVELLE COMMANDE À LIVRER*\n\n` +
                    `ID: ${order.id}\n` +
                    `Code: ${order.confirmation_code}\n\n` +
                    `👤 Client: ${order.client_name}\n` +
                    `📍 Quartier: ${order.client_quartier}\n` +
                    `📝 Indications: ${order.client_indications || 'Aucune'}\n\n` +
                    `📦 Articles:\n${items}\n\n` +
                    `💰 À encaisser: ${order.total} FCFA\n\n` +
                    `👉 Répondez: *ACCEPTER ${order.id}* pour prendre la commande`;

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
                            `✅ Commande ${commandeId} assignée !\n\n` +
                            `Utilisez *RECUPERER ${commandeId}* quand vous récupérez la commande\n` +
                            `Utilisez *LIVRER ${commandeId}* après livraison avec le code client`);

                        await this.whatsapp.sendMessage(order.client_phone,
                            `✅ Votre commande ${commandeId} a été acceptée par un livreur !\n` +
                            `🚚 Livreur: ${livreur.nom || 'Livreur'}\n` +
                            `Vous serez notifié quand il récupère la commande.`);

                        await this.whatsapp.sendMessage(SUPPORT_PHONE,
                            `📦 Commande ${commandeId}\n✅ Acceptée par livreur: ${phone}`);
                    }
                    break;

                case 'RECUPERER':
                    const recuperer = await this.livreurService.recupererCommande(commandeId, phone);
                    if (recuperer) {
                        const order = await this.getOrderById(commandeId);
                        
                        await this.whatsapp.sendMessage(phone,
                            `🛵 Commande ${commandeId} récupérée !\n` +
                            `Utilisez *LIVRER ${commandeId}* une fois livrée`);

                        await this.whatsapp.sendMessage(order.client_phone,
                            `🛵 Votre commande ${commandeId} est en cours de livraison !\n` +
                            `Préparez le code: *${order.confirmation_code}*`);

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
                    `✅ Livraison confirmée !\n` +
                    `Commande ${commandeId} marquée comme livrée.\n` +
                    `Merci pour votre service ! 🎉`);

                await this.whatsapp.sendMessage(order.client_phone,
                    `🎉 Votre commande ${commandeId} a été livrée avec succès !\n` +
                    `Merci de votre confiance. À bientôt sur Pillbox CI ! 🚀`);

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

    // ==================== TIMEOUT MANAGER ====================
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

    // ==================== MOTEUR DE CONVERSATION PRINCIPAL ====================
    class ConversationEngine {
        constructor(nlp, groq, searchEngine, clinicService, orderService, convManager, whatsapp, livreurService, pharmacyScraper) {
            this.nlp = nlp;
            this.groq = groq;
            this.searchEngine = searchEngine;
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
                // Vérifier si c'est un message vocal (géré en amont)
                
                const conv = await this.convManager.getConversation(phone);
                
                // Vérifier si c'est une réponse de livreur en attente de code
                if (conv.state === this.states.WAITING_LIVREUR_CODE) {
                    if (message.match(/^\d{6}$/)) {
                        const result = await this.orderService.confirmLivreurDelivery(phone, message, this.convManager);
                        if (result) return result;
                    } else {
                        return "Code invalide. Veuillez entrer un code à 6 chiffres.";
                    }
                }

                // Analyse NLP
                const analysis = await this.nlp.parse(message, phone);
                await this.convManager.addToHistory(phone, 'user', message, analysis.intent);
                
                // Gestion des états d'attente
                if (conv.state === this.states.WAITING_MEDICINE) {
                    return await this.handleWaitingMedicine(phone, message, conv, analysis);
                }
                if (conv.state === this.states.WAITING_QUANTITY) {
                    return await this.handleWaitingQuantity(phone, message, conv, analysis);
                }
                if (conv.state === this.states.WAITING_NAME) {
                    return await this.handleWaitingName(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_QUARTIER) {
                    return await this.handleWaitingQuartier(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_PHONE) {
                    return await this.handleWaitingPhone(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_INDICATIONS) {
                    return await this.handleWaitingIndications(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_CONFIRMATION) {
                    return await this.handleWaitingConfirmation(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_VILLE) {
                    return await this.handleWaitingVille(phone, message, conv, analysis);
                }
                if (conv.state === this.states.WAITING_CLINIC_SELECTION) {
                    return await this.handleWaitingClinicSelection(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_SPECIALITE_SELECTION) {
                    return await this.handleWaitingSpecialiteSelection(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_PATIENT_INFO) {
                    return await this.handleWaitingPatientInfo(phone, message, conv, analysis);
                }
                if (conv.state === this.states.WAITING_DATE) {
                    return await this.handleWaitingDate(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_HEURE) {
                    return await this.handleWaitingHeure(phone, message, conv);
                }
                if (conv.state === this.states.WAITING_RDV_CONFIRMATION) {
                    return await this.handleWaitingRdvConfirmation(phone, message, conv);
                }

                // Intentions principales
                return await this.routeIntent(analysis, conv, message);

            } catch (error) {
                log('ERROR', 'Erreur moteur conversation:', error);
                return "Désolé, une erreur est survenue. Veuillez réessayer. 😔";
            }
        }

        async routeIntent(analysis, conv, originalMessage) {
            const intent = analysis.intent;
            const entities = analysis.entities;
            
            // Salutations et aide
            if (intent === 'saluer') {
                return await this.handleIntentSaluer(conv);
            }
            if (intent === 'aide') {
                return await this.handleIntentAide(conv);
            }
            if (intent === 'remercier') {
                return await this.handleIntentRemercier(conv);
            }
            if (intent === 'au_revoir') {
                return await this.handleIntentAuRevoir(conv);
            }
            
            // Recherche médicaments
            if (intent === 'rechercher_medicament') {
                return await this.handleIntentRechercherMedicament(analysis, conv);
            }
            if (intent === 'prix_medicament') {
                return await this.handleIntentPrixMedicament(analysis, conv);
            }
            if (intent === 'commander') {
                return await this.handleIntentCommander(conv);
            }
            if (intent === 'panier') {
                return await this.handleIntentPanier(conv);
            }
            if (intent === 'quantite') {
                return await this.handleIntentQuantite(analysis, conv);
            }
            if (intent === 'choix_numero') {
                return await this.handleIntentChoixNumero(analysis, conv);
            }
            
            // Pharmacies
            if (intent === 'pharmacie_garde') {
                return await this.handleIntentPharmacieGarde(analysis, conv);
            }
            
            // Rendez-vous
            if (intent === 'prendre_rdv') {
                return await this.handleIntentPrendreRdv(conv);
            }
            if (intent === 'annuler_rdv') {
                return await this.handleIntentAnnulerRdv(analysis, conv);
            }
            if (intent === 'disponibilite_medecin') {
                return await this.handleIntentDisponibiliteMedecin(analysis, conv);
            }
            if (intent === 'clinique_proche') {
                return await this.handleIntentCliniqueProche(analysis, conv);
            }
            if (intent === 'specialite_clinique') {
                return await this.handleIntentSpecialiteClinique(analysis, conv);
            }
            if (intent === 'service_clinique') {
                return await this.handleIntentServiceClinique(analysis, conv);
            }
            if (intent === 'tarif_clinique') {
                return await this.handleIntentTarifClinique(analysis, conv);
            }
            
            // Commandes et livraison
            if (intent === 'infos_livraison') {
                return await this.handleIntentInfosLivraison(conv);
            }
            if (intent === 'suivre_commande') {
                return await this.handleIntentSuivreCommande(analysis, conv);
            }
            if (intent === 'annuler_commande') {
                return await this.handleIntentAnnulerCommande(analysis, conv);
            }
            
            // Autres
            if (intent === 'urgence') {
                return await this.handleIntentUrgence(conv);
            }
            if (intent === 'question_bot') {
                return await this.handleIntentQuestionBot(analysis, conv);
            }
            if (intent === 'autre_ville') {
                return await this.handleIntentAutreVille(analysis, conv);
            }
            if (intent === 'confirmer') {
                return await this.handleIntentConfirmer(conv);
            }
            if (intent === 'refuser') {
                return await this.handleIntentRefuser(conv);
            }

            // Fallback
            return await this.handleIntentFallback(analysis, conv, originalMessage);
        }

        async handleIntentSaluer(conv) {
            await this.convManager.updateState(conv.phone, this.states.GREETED);
            const delivery = Utils.getCurrentDeliveryPrice();
            
            const message = 
                `👋 Bonjour ! Je suis MIA, votre assistante santé.\n\n` +
                `💰 Livraison : ${delivery.price} FCFA\n\n` +
                `Comment puis-je vous aider aujourd'hui ?`;
            
            await this.whatsapp.sendInteractiveButtons(conv.phone, message,
                ["💊 Chercher", "🏥 Pharmacie", "🏥 Cliniques", "🚚 Infos"]
            );
            return null;
        }

        async handleIntentAide(conv) {
            const message = 
                `📚 *Aide - Commandes disponibles*\n\n` +
                `💊 *Chercher* - Rechercher un médicament\n` +
                `💰 *Prix* - Connaître le prix d'un médicament\n` +
                `🏥 *Pharmacie* - Trouver une pharmacie de garde\n` +
                `🛒 *Commander* - Passer une commande\n` +
                `📅 *RDV* - Prendre rendez-vous en clinique\n` +
                `🚚 *Infos* - En savoir sur la livraison\n` +
                `📦 *Suivre* - Suivre ma commande\n\n` +
                `👉 Vous pouvez aussi écrire votre demande naturellement !`;
            
            await this.whatsapp.sendInteractiveButtons(conv.phone, message,
                ["💊 Chercher", "🏥 Pharmacie", "📅 RDV", "🚚 Infos"]
            );
            return null;
        }

        async handleIntentRemercier(conv) {
            const context = {
                intent: 'remercier',
                userMessage: "merci"
            };
            const groqResponse = await this.groq.generateResponse(context);
            return groqResponse || "Avec plaisir ! 😊 N'hésitez pas si vous avez d'autres questions.";
        }

        async handleIntentAuRevoir(conv) {
            await this.convManager.clearContext(conv.phone);
            return "Au revoir ! 👋 Passez une excellente journée. À bientôt sur Pillbox CI !";
        }

        async handleIntentRechercherMedicament(analysis, conv) {
            const medicineName = analysis.entities.medicament;

            if (!medicineName) {
                await this.convManager.updateState(conv.phone, this.states.WAITING_MEDICINE);
                return "Quel médicament cherchez-vous ? (ex: doliprane, amoxicilline) 💊";
            }

            const results = await this.searchEngine.search(medicineName);

            if (results.results.length === 0) {
                const context = {
                    intent: 'rechercher_medicament',
                    data: { terme: medicineName, aucun: true },
                    userMessage: `chercher ${medicineName}`
                };
                const groqResponse = await this.groq.generateResponse(context);
                return groqResponse || `Désolé, je n'ai pas trouvé "${medicineName}". Vérifiez l'orthographe ou essayez autre chose. 😕`;
            }

            // Sauvegarder les résultats pour la suite
            await this.convManager.updateState(conv.phone, this.states.SEARCHING, {
                context: { 
                    last_search: { 
                        term: medicineName, 
                        results: results.results.slice(0, 10)
                    } 
                }
            });

            const resultsList = results.results.slice(0, 5).map((r, i) => 
                `${i+1}. ${r.item.nom_commercial} - ${r.item.prix} FCFA`
            ).join('\n');

            let message = `🔍 *Résultats pour "${medicineName}"*\n\n${resultsList}`;
            if (results.total > 5) {
                message += `\n\nEt ${results.total - 5} autre(s) résultat(s).`;
            }

            const buttons = ['1', '2', '3', '4', '5'];
            if (results.total > 5) buttons.push('🔍 Suite');
            buttons.push('🔍 Autre');

            await this.whatsapp.sendInteractiveButtons(conv.phone, message, buttons);
            return null;
        }

        async handleIntentPrixMedicament(analysis, conv) {
            const medicineName = analysis.entities.medicament;

            if (!medicineName) {
                return "De quel médicament voulez-vous connaître le prix ? 💰";
            }

            const results = await this.searchEngine.search(medicineName, 10);

            if (results.results.length === 0) {
                return `Désolé, je n'ai pas trouvé de prix pour "${medicineName}". 😕`;
            }

            const pricesList = results.results.slice(0, 7).map(r => 
                `• ${r.item.nom_commercial} : ${r.item.prix} FCFA`
            ).join('\n');

            const context = {
                intent: 'prix_medicament',
                data: { medicament: medicineName, prix: results.results[0].item.prix },
                userMessage: `prix ${medicineName}`
            };
            const groqResponse = await this.groq.generateResponse(context);

            if (groqResponse) {
                return groqResponse + `\n\n${pricesList}`;
            }

            return `💰 *Prix trouvés*\n\n${pricesList}`;
        }

        async handleIntentCommander(conv) {
            if (!conv.cart || conv.cart.length === 0) {
                return "Votre panier est vide. Cherchez d'abord un médicament à ajouter. 💊";
            }

            await this.convManager.updateState(conv.phone, this.states.WAITING_NAME, {
                context: { ordering: true }
            });

            const { formatted } = Utils.formatCart(conv.cart);
            
            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `${formatted}\n\nQuel est votre nom ? 👤`,
                ["✏️ Modifier", "✅ Confirmer", "❌ Annuler"]
            );
            return null;
        }

        async handleIntentPanier(conv) {
            if (!conv.cart || conv.cart.length === 0) {
                return "Votre panier est vide. 🛒";
            }

            const { formatted } = Utils.formatCart(conv.cart);

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `🛒 *Votre panier*\n\n${formatted}`,
                ["✅ Commander", "✏️ Modifier", "🗑️ Vider"]
            );
            return null;
        }

        async handleIntentQuantite(analysis, conv) {
            const quantite = analysis.entities.quantite || 1;
            
            if (!conv.pending_medicament) {
                return "Veuillez d'abord choisir un médicament. 💊";
            }

            const medicament = conv.pending_medicament;
            const cart = conv.cart || [];

            const existing = cart.find(item => item.code_produit === medicament.code_produit);
            if (existing) {
                existing.quantite = (existing.quantite || 1) + quantite;
            } else {
                cart.push({ ...medicament, quantite });
            }

            await this.convManager.updateState(conv.phone, null, { 
                cart, 
                pending_medicament: null 
            });

            const { formatted } = Utils.formatCart(cart);

            const context = {
                intent: 'ajout_panier',
                data: { 
                    medicament: medicament.nom_commercial,
                    quantite,
                    prix: medicament.prix * quantite,
                    total: cart.length
                },
                userMessage: `${quantite} ${medicament.nom_commercial}`
            };
            const groqResponse = await this.groq.generateResponse(context);

            if (groqResponse) {
                await this.whatsapp.sendMessage(conv.phone, groqResponse);
                await this.whatsapp.sendInteractiveButtons(conv.phone,
                    `🛒 *Panier actuel :*\n${formatted}`,
                    ["🛒 Voir panier", "🔍 Continuer", "✅ Commander"]
                );
                return null;
            }

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                `${quantite} x ${medicament.nom_commercial} ajouté au panier ! ✅\n\n🛒 *Panier :*\n${formatted}`,
                ["🛒 Voir panier", "🔍 Continuer", "✅ Commander"]
            );
            return null;
        }

        async handleIntentChoixNumero(analysis, conv) {
            const numero = analysis.entities.numero || analysis.entities.number;

            if (!numero) {
                return "Je n'ai pas compris. Veuillez choisir un numéro. 🤔";
            }

            if (conv.state === this.states.SEARCHING && conv.context?.last_search?.results) {
                return await this.handleMedicineSelection(conv, numero);
            }

            return "Je n'ai pas compris. Veuillez réessayer. 🤔";
        }

        async handleMedicineSelection(conv, numero) {
            const lastSearch = conv.context?.last_search;
            
            if (!lastSearch || !lastSearch.results || numero < 1 || numero > lastSearch.results.length) {
                return "Choix invalide. Veuillez réessayer.";
            }

            const selected = lastSearch.results[numero - 1].item;
            
            await this.convManager.updateState(conv.phone, this.states.WAITING_QUANTITY, {
                pending_medicament: selected
            });

            return `*${selected.nom_commercial}* sélectionné\n\nQuelle quantité souhaitez-vous ? (1, 2, 3...)`;
        }

        async handleIntentPharmacieGarde(analysis, conv) {
            const quartier = analysis.entities.localite || analysis.entities.quartier || analysis.entities.ville;

            if (!quartier) {
                await this.convManager.updateState(conv.phone, this.states.WAITING_QUARTIER, {
                    context: { recherche_pharmacie: true }
                });
                return "Dans quelle ville ou quartier cherchez-vous une pharmacie de garde ? 🏥";
            }

            // Si c'est Abidjan, on demande la commune
            if (quartier.toLowerCase() === 'abidjan') {
                await this.convManager.updateState(conv.phone, this.states.WAITING_QUARTIER, {
                    context: { recherche_pharmacie: true, ville: 'abidjan' }
                });
                return "Pour Abidjan, précisez la commune (Cocody, Marcory, Yopougon, etc.) 📍";
            }

            const pharmacies = await this.pharmacyScraper.searchByLocation(quartier);

            if (pharmacies.length === 0) {
                return `Désolé, aucune pharmacie de garde trouvée à ${quartier}. 😕`;
            }

            const pharmaciesList = pharmacies.slice(0, 5).map(p =>
                `${p.nom}\n📍 ${p.adresse}\n📞 ${p.telephone}`
            ).join('\n\n');

            const context = {
                intent: 'pharmacie_garde',
                data: { quartier, nombre: pharmacies.length },
                userMessage: `pharmacie garde ${quartier}`
            };
            const groqResponse = await this.groq.generateResponse(context);

            if (groqResponse) {
                return groqResponse + `\n\n${pharmaciesList}`;
            }

            return `Pharmacies de garde à ${quartier} :\n\n${pharmaciesList}`;
        }

        async handleIntentPrendreRdv(conv) {
            await this.convManager.updateState(conv.phone, this.states.WAITING_VILLE, {
                context: { prise_rdv: true }
            });

            return "Dans quelle ville souhaitez-vous prendre rendez-vous ? (ex: Abidjan, Bouaké) 🏥";
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

            if (appointment.patient_telephone !== conv.phone) {
                return "Vous n'êtes pas autorisé à annuler ce rendez-vous. 🔒";
            }

            await this.clinicService.cancelAppointment(rdvId);
            await this.whatsapp.sendMessage(SUPPORT_PHONE, 
                `📅 RDV ${rdvId} annulé par ${conv.phone}`);

            return `Rendez-vous ${rdvId} annulé avec succès. ✅`;
        }

        async handleIntentDisponibiliteMedecin(analysis, conv) {
            return "Pour connaître les disponibilités, veuillez d'abord prendre un rendez-vous. Je vous guiderai. 📅";
        }

        async handleIntentCliniqueProche(analysis, conv) {
            return "Pour trouver une clinique proche, veuillez d'abord prendre un rendez-vous. Je vous guiderai. 🏥";
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

        async handleIntentServiceClinique(analysis, conv) {
            return "Pour connaître les services disponibles, veuillez nous contacter ou consulter notre site web. 🌐";
        }

        async handleIntentTarifClinique(analysis, conv) {
            return "Les tarifs varient selon les cliniques. Contactez-nous pour plus d'informations. 💰";
        }

        async handleIntentInfosLivraison(conv) {
            const delivery = Utils.getCurrentDeliveryPrice();
            
            const context = {
                intent: 'infos_livraison',
                data: { 
                    tarif_jour: DELIVERY_PRICES.DAY.price,
                    tarif_nuit: DELIVERY_PRICES.NIGHT.price,
                    periode: delivery.period
                },
                userMessage: "infos livraison"
            };
            const groqResponse = await this.groq.generateResponse(context);

            if (groqResponse) {
                return groqResponse;
            }

            return `🚚 *Livraison*\n\n` +
                   `💰 Tarif ${delivery.period === 'NIGHT' ? '🌙 nuit' : '☀️ jour'} : ${delivery.price} FCFA\n` +
                   `📍 Zones : Abidjan et grandes villes\n` +
                   `⏱️ Délais : 30-45 min Abidjan\n` +
                   `💵 Paiement : espèces, OM, Wave à la livraison`;
        }

        async handleIntentSuivreCommande(analysis, conv) {
            const commandeId = analysis.entities.commande_id || Utils.extractCommandId(analysis.originalMessage);

            if (!commandeId) {
                const orders = await this.orderService.getOrdersByPhone(conv.phone);
                if (orders.length === 0) {
                    return "Vous n'avez pas de commande en cours. 📦";
                }

                const ordersList = orders.slice(0, 3).map(o =>
                    `• ${o.id} - ${o.items.length} article(s) - ${o.status_livreur}`
                ).join('\n');

                await this.convManager.updateState(conv.phone, this.states.WAITING_COMMANDE_ID);
                return `Vos commandes récentes :\n${ordersList}\n\nQuel est le numéro de la commande à suivre ?`;
            }

            const order = await this.orderService.getOrderById(commandeId);

            if (!order || order.client_phone !== conv.phone) {
                return `Commande ${commandeId} non trouvée.`;
            }

            const statusMessages = {
                'PENDING': '📝 en attente',
                'ASSIGNED': '👨‍🛵 acceptée',
                'PICKED_UP': '🛵 en route',
                'DELIVERED': '✅ livrée',
                'CANCELLED': '❌ annulée'
            };

            const status = statusMessages[order.status_livreur] || order.status;
            const items = order.items.map(i => `• ${i.nom_commercial} x${i.quantite || 1}`).join('\n');

            return `📦 *Commande ${commandeId}*\n\n` +
                   `📊 Statut : ${status}\n` +
                   `📦 Articles :\n${items}\n` +
                   `💰 Total : ${order.total} FCFA\n` +
                   `📍 Livraison : ${order.client_quartier}`;
        }

        async handleIntentAnnulerCommande(analysis, conv) {
            const commandeId = analysis.entities.commande_id || Utils.extractCommandId(analysis.originalMessage);

            if (!commandeId) {
                const orders = await this.orderService.getOrdersByPhone(conv.phone);
                const pendingOrders = orders.filter(o => o.status === 'PENDING');
                
                if (pendingOrders.length === 0) {
                    return "Vous n'avez aucune commande en cours à annuler. 📦";
                }

                const ordersList = pendingOrders.slice(0, 3).map(o =>
                    `• ${o.id} - ${o.total} FCFA`
                ).join('\n');

                await this.convManager.updateState(conv.phone, this.states.WAITING_COMMANDE_ID, {
                    context: { annulation_en_cours: true }
                });

                return `Vos commandes en cours :\n${ordersList}\n\nQuel numéro souhaitez-vous annuler ?`;
            }

            const order = await this.orderService.getOrderById(commandeId);

            if (!order || order.client_phone !== conv.phone) {
                return `Commande ${commandeId} non trouvée.`;
            }

            if (order.status !== 'PENDING') {
                return "Cette commande ne peut plus être annulée. ❌";
            }

            await this.orderService.cancelOrder(commandeId);
            await this.whatsapp.sendMessage(SUPPORT_PHONE, 
                `📦 Commande ${commandeId} annulée par le client.`);

            return `Commande ${commandeId} annulée avec succès. ✅`;
        }

        async handleIntentUrgence(conv) {
            await this.whatsapp.sendMessage(conv.phone,
                `🚨 *URGENCE MÉDICALE*\n\n` +
                `📞 Appelez immédiatement le *185* (SAMU)\n` +
                `🏥 Rendez-vous aux urgences\n` +
                `📱 Contactez le support: ${SUPPORT_PHONE}\n\n` +
                `Pour une pharmacie de garde, tapez *pharmacie de garde* suivi de votre quartier.`
            );
            return null;
        }

        async handleIntentQuestionBot(analysis, conv) {
            const context = {
                intent: 'question_bot',
                data: { question: analysis.originalMessage },
                userMessage: analysis.originalMessage
            };
            const groqResponse = await this.groq.generateResponse(context);
            return groqResponse || "Je suis MIA, votre assistante santé Pillbox CI. Comment puis-je vous aider ? 😊";
        }

        async handleIntentAutreVille(analysis, conv) {
            const ville = analysis.entities.localite || analysis.entities.ville;
            if (ville) {
                conv.context.ville = ville;
                await this.convManager.updateState(conv.phone, null, { context: conv.context });
            }
            return `D'accord, je prends en compte que vous êtes à ${ville || 'cette ville'}. Comment puis-je vous aider ?`;
        }

        async handleIntentConfirmer(conv) {
            if (conv.state === this.states.WAITING_NAME && conv.context.ordering) {
                return await this.confirmOrderName(conv);
            }
            if (conv.state === this.states.WAITING_RDV_CONFIRMATION) {
                return await this.confirmAppointment(conv);
            }
            return "Confirmation prise en compte. 😊";
        }

        async handleIntentRefuser(conv) {
            await this.convManager.clearContext(conv.phone);
            return "D'accord, j'annule l'opération. Besoin d'autre chose ?";
        }

        async handleIntentFallback(analysis, conv, message) {
            const context = {
                intent: 'fallback',
                data: { message, confidence: analysis.confidence },
                userMessage: message,
                history: conv.history?.slice(-3)
            };
            const groqResponse = await this.groq.generateResponse(context);

            if (groqResponse) {
                return groqResponse;
            }

            await this.whatsapp.sendInteractiveButtons(conv.phone,
                "Désolé, je n'ai pas bien compris. Tapez *aide* pour voir ce que je peux faire. 🤗",
                ["💊 Chercher", "🏥 Pharmacie", "📅 RDV", "❓ Aide"]
            );
            return null;
        }

        // ========== GESTION DES ÉTATS D'ATTENTE ==========

        async handleWaitingMedicine(phone, message, conv, analysis) {
            if (analysis.entities.medicament) {
                return await this.handleIntentRechercherMedicament(analysis, conv);
            }
            if (message.length < 2) {
                return "Veuillez donner le nom du médicament (ex: doliprane). 💊";
            }
            
            const newAnalysis = { 
                ...analysis, 
                entities: { ...analysis.entities, medicament: message } 
            };
            return await this.handleIntentRechercherMedicament(newAnalysis, conv);
        }

        async handleWaitingQuantity(phone, message, conv, analysis) {
            const quantite = analysis.entities.quantite || Utils.extractNumber(message);
            
            if (!quantite || quantite < 1) {
                return "Veuillez indiquer une quantité valide (ex: 2, 3...)";
            }

            analysis.entities.quantite = quantite;
            return await this.handleIntentQuantite(analysis, conv);
        }

        async handleWaitingName(phone, message, conv) {
            conv.context.client_nom = message;
            await this.convManager.updateState(phone, this.states.WAITING_QUARTIER, { context: conv.context });
            return `Merci ${message} ! Dans quel quartier habitez-vous ? 📍`;
        }

        async handleWaitingQuartier(phone, message, conv) {
            if (conv.context.recherche_pharmacie) {
                const pharmacies = await this.pharmacyScraper.searchByLocation(message);
                
                if (pharmacies.length === 0) {
                    return `Aucune pharmacie trouvée à ${message}.`;
                }

                const pharmaciesList = pharmacies.slice(0, 5).map(p =>
                    `${p.nom}\n📍 ${p.adresse}\n📞 ${p.telephone}`
                ).join('\n\n');

                await this.convManager.updateState(phone, this.states.IDLE, { context: {} });
                return `Pharmacies à ${message} :\n\n${pharmaciesList}`;
            }

            if (conv.context.ordering) {
                conv.context.client_quartier = message;
                await this.convManager.updateState(phone, this.states.WAITING_PHONE, { context: conv.context });
                return "Quel est votre numéro de téléphone ? (ex: 0701406880) 📱";
            }

            await this.convManager.updateState(phone, this.states.IDLE);
            return "Merci !";
        }

        async handleWaitingPhone(phone, message, conv) {
            const phoneNumber = message.replace(/\D/g, '');
            if (phoneNumber.length < 8) {
                return "Numéro invalide. Veuillez entrer un numéro valide (ex: 0701406880) 📱";
            }

            conv.context.client_telephone = phoneNumber;
            await this.convManager.updateState(phone, this.states.WAITING_INDICATIONS, { context: conv.context });
            
            await this.whatsapp.sendInteractiveButtons(phone,
                "Avez-vous des indications particulières pour le livreur ?\n(ex: code d'accès, sonnette, point de repère)",
                ["Non", "Oui"]
            );
            return null;
        }

        async handleWaitingIndications(phone, message, conv) {
            if (message.toLowerCase() === 'non' || message === 'Non') {
                conv.context.client_indications = '';
            } else {
                conv.context.client_indications = message;
            }

            const { items, subtotal, deliveryPrice, total } = Utils.formatCart(conv.cart);
            
            const recap = 
                `*Résumé de commande :*\n\n` +
                `${items}\n\n` +
                `À livrer à ${conv.context.client_quartier}\n` +
                `Tél : ${conv.context.client_telephone}\n` +
                `Indications : ${conv.context.client_indications || 'Aucune'}\n\n` +
                `Sous-total : ${subtotal} FCFA\n` +
                `Frais de livraison : ${deliveryPrice} FCFA\n` +
                `Prix Total : ${total} FCFA\n\n` +
                `Paiement à la livraison (espèces/OM/Wave)`;

            await this.convManager.updateState(phone, this.states.WAITING_CONFIRMATION, { context: conv.context });
            
            await this.whatsapp.sendInteractiveButtons(phone, recap,
                ["✅ Confirmer", "✏️ Modifier", "❌ Annuler"]
            );
            return null;
        }

        async handleWaitingConfirmation(phone, message, conv) {
            if (message === '✅ Confirmer' || message.toLowerCase() === 'oui' || message.toLowerCase() === 'confirmer') {
                try {
                    const order = await this.orderService.createOrder({
                        client: {
                            nom: conv.context.client_nom,
                            telephone: conv.context.client_telephone,
                            quartier: conv.context.client_quartier,
                            indications: conv.context.client_indications
                        },
                        items: conv.cart
                    }, phone);

                    await this.convManager.clearContext(phone);

                    const context = {
                        intent: 'commande_confirmee',
                        data: { 
                            id: order.id,
                            total: order.total,
                            code: order.confirmation_code
                        },
                        userMessage: "commande confirmée"
                    };
                    const groqResponse = await this.groq.generateResponse(context);

                    if (groqResponse) {
                        await this.whatsapp.sendMessage(phone, groqResponse);
                        await this.whatsapp.sendInteractiveButtons(phone,
                            `Code de confirmation : *${order.confirmation_code}*\n\n` +
                            `Vous recevrez une notification dès qu'un livreur prendra votre commande.`,
                            ["📦 Suivre", "💊 Nouvelle recherche", "🏠 Accueil"]
                        );
                        return null;
                    }

                    return `✅ Commande confirmée !\n\n` +
                           `Numéro : ${order.id}\n` +
                           `Code : ${order.confirmation_code}\n\n` +
                           `Vous serez notifié dès qu'un livreur prendra votre commande.`;
                    
                } catch (error) {
                    log('ERROR', 'Erreur confirmation commande:', error);
                    return "Erreur lors de la confirmation. Réessayez plus tard. 😔";
                }
            }
            
            if (message === '✏️ Modifier' || message.toLowerCase() === 'modifier') {
                await this.convManager.updateState(phone, this.states.IDLE);
                return "Que souhaitez-vous modifier ? Vous pouvez ajouter/supprimer des articles ou recommencer. 🛒";
            }
            
            await this.convManager.clearContext(phone);
            return "Commande annulée. ❌";
        }

        async handleWaitingVille(phone, message, conv, analysis) {
            const ville = analysis.entities.localite || analysis.entities.ville || message;
            
            conv.context.ville = ville;
            
            if (ville.toLowerCase() === 'abidjan') {
                await this.convManager.updateState(phone, this.states.WAITING_VILLE, {
                    context: { ...conv.context, besoin_commune: true }
                });
                return "Pour Abidjan, précisez la commune (Cocody, Marcory, Yopougon, etc.) 📍";
            }

            const clinics = await this.clinicService.getAllClinics(ville);

            if (clinics.length === 0) {
                return `Désolé, aucune clinique trouvée à ${ville}. 🏥`;
            }

            await this.convManager.updateState(phone, this.states.WAITING_CLINIC_SELECTION, {
                context: { ...conv.context, clinics_list: clinics }
            });

            const clinicsList = clinics.slice(0, 5).map((c, i) =>
                `${i+1}. *${c.nom_clinique}*\n   📍 ${c.quartier || ''}\n   📞 ${c.telephone || 'Non disponible'}`
            ).join('\n\n');

            let message_text = `🏥 *Cliniques à ${ville}*\n\n${clinicsList}`;
            if (clinics.length > 5) {
                message_text += `\n\nEt ${clinics.length - 5} autre(s) clinique(s).`;
            }

            const buttons = clinics.slice(0, 5).map((_, i) => String(i + 1));
            buttons.push("❌ Annuler");

            await this.whatsapp.sendInteractiveButtons(phone, message_text, buttons);
            return null;
        }

        async handleWaitingClinicSelection(phone, message, conv) {
            const numero = Utils.extractNumber(message);
            const clinics = conv.context.clinics_list;

            if (!numero || numero < 1 || numero > clinics.length) {
                return "Numéro invalide. Choisissez un numéro dans la liste.";
            }

            const selectedClinic = clinics[numero - 1];
            const medecins = await this.clinicService.getMedecinsByClinic(selectedClinic.id_clinique);
            const specialites = [...new Set(medecins.map(m => m.specialite))];

            await this.convManager.updateState(phone, this.states.WAITING_SPECIALITE_SELECTION, {
                context: { 
                    ...conv.context, 
                    selected_clinic: selectedClinic, 
                    specialites_list: specialites 
                }
            });

            const specialitesList = specialites.slice(0, 5).map((spec, idx) => 
                `${idx+1}. ${spec}`
            ).join('\n');

            let message_text = `🏥 *${selectedClinic.nom_clinique}*\n\nSpécialités disponibles :\n${specialitesList}`;
            if (specialites.length > 5) {
                message_text += `\n\nEt ${specialites.length - 5} autre(s) spécialité(s).`;
            }

            const buttons = specialites.slice(0, 5).map((_, i) => String(i + 1));
            buttons.push("❌ Annuler");

            await this.whatsapp.sendInteractiveButtons(phone, message_text, buttons);
            return null;
        }

        async handleWaitingSpecialiteSelection(phone, message, conv) {
            const numero = Utils.extractNumber(message);
            const specialites = conv.context.specialites_list || [];

            if (!numero || numero < 1 || numero > specialites.length) {
                return "Numéro de spécialité invalide.";
            }

            conv.context.selected_specialite = specialites[numero - 1];
            
            // Demander les informations patient
            await this.convManager.updateState(phone, this.states.WAITING_PATIENT_INFO, {
                context: { ...conv.context, patient_info_step: 'nom' }
            });

            return `🩺 *${conv.context.selected_specialite}*\n\n` +
                   `Pour finaliser le rendez-vous, j'ai besoin de quelques informations :\n\n` +
                   `👤 Quel est votre nom complet ?`;
        }

        async handleWaitingPatientInfo(phone, message, conv, analysis) {
            const step = conv.context.patient_info_step;

            if (step === 'nom') {
                conv.context.patient_nom = message;
                await this.convManager.updateState(phone, null, {
                    context: { ...conv.context, patient_info_step: 'naissance' }
                });
                return "📅 Votre date de naissance ? (JJ/MM/AAAA)";

            } else if (step === 'naissance') {
                const date = Utils.extractDate(message);
                if (!date) {
                    return "Format incorrect. Utilisez JJ/MM/AAAA (ex: 15/03/1994)";
                }
                conv.context.patient_naissance = date;
                conv.context.patient_age = Utils.calculateAge(date);
                await this.convManager.updateState(phone, null, {
                    context: { ...conv.context, patient_info_step: 'poids' }
                });
                return "⚖️ Votre poids ? (en kg, ex: 65)";

            } else if (step === 'poids') {
                const poids = Utils.extractNumber(message);
                if (!poids || poids < 20 || poids > 200) {
                    return "Poids invalide. Entrez un poids entre 20 et 200 kg.";
                }
                conv.context.patient_poids = poids;
                await this.convManager.updateState(phone, null, {
                    context: { ...conv.context, patient_info_step: 'taille' }
                });
                return "📏 Votre taille ? (en cm, ex: 168)";

            } else if (step === 'taille') {
                const taille = Utils.extractNumber(message);
                if (!taille || taille < 100 || taille > 250) {
                    return "Taille invalide. Entrez une taille entre 100 et 250 cm.";
                }
                conv.context.patient_taille = taille;
                await this.convManager.updateState(phone, null, {
                    context: { ...conv.context, patient_info_step: 'telephone' }
                });
                return "📱 Votre numéro de téléphone ? (ex: 0701406880)";

            } else if (step === 'telephone') {
                const phoneNumber = message.replace(/\D/g, '');
                if (phoneNumber.length < 8) {
                    return "Numéro invalide. Veuillez entrer un numéro valide.";
                }
                conv.context.patient_telephone = phoneNumber;
                
                // Passer à la demande de date
                await this.convManager.updateState(phone, this.states.WAITING_DATE, {
                    context: conv.context
                });
                return `📅 Date souhaitée pour le rendez-vous (JJ/MM/AAAA) :`;
            }

            return "Erreur dans le processus.";
        }

        async handleWaitingDate(phone, message, conv) {
            const date = Utils.extractDate(message);

            if (!date) {
                return "Format de date incorrect. Utilisez JJ/MM/AAAA (ex: 15/04/2026).";
            }

            await this.convManager.updateState(phone, this.states.WAITING_HEURE, {
                context: { ...conv.context, selected_date: date }
            });

            return `📅 Date : ${date}\n\nIndiquez l'heure (HH:MM, ex: 14:30) :`;
        }

        async handleWaitingHeure(phone, message, conv) {
            const heure = Utils.extractTime(message);

            if (!heure) {
                return "Format d'heure incorrect. Utilisez HH:MM (ex: 14:30).";
            }

            await this.convManager.updateState(phone, this.states.WAITING_RDV_CONFIRMATION, {
                context: { ...conv.context, selected_heure: heure }
            });

            const recap = 
                `*Résumé rendez-vous :*\n\n` +
                `👤 Patient : ${conv.context.patient_nom}\n` +
                `📅 Âge : ${conv.context.patient_age} ans (${conv.context.patient_naissance})\n` +
                `⚖️ Poids : ${conv.context.patient_poids} kg\n` +
                `📏 Taille : ${conv.context.patient_taille} cm\n` +
                `📱 Tél : ${conv.context.patient_telephone}\n\n` +
                `🏥 Clinique : ${conv.context.selected_clinic.nom_clinique}\n` +
                `📍 Adresse : ${conv.context.selected_clinic.quartier || ''}, ${conv.context.selected_clinic.ville}\n` +
                `🩺 Spécialité : ${conv.context.selected_specialite}\n\n` +
                `📅 Date : ${conv.context.selected_date}\n` +
                `⏰ Heure : ${heure}`;

            await this.whatsapp.sendInteractiveButtons(phone, recap,
                ["✅ Confirmer", "✏️ Modifier", "❌ Annuler"]
            );
            return null;
        }

        async handleWaitingRdvConfirmation(phone, message, conv) {
            if (message === '✅ Confirmer' || message.toLowerCase() === 'oui' || message.toLowerCase() === 'confirmer') {
                try {
                    // Récupérer un médecin pour la spécialité
                    const medecins = await this.clinicService.getMedecinsBySpecialite(
                        conv.context.selected_specialite, 
                        conv.context.ville
                    );
                    const medecin = medecins.length > 0 ? medecins[0].medecin : 'Médecin disponible';

                    const appointmentData = {
                        id_clinique: conv.context.selected_clinic.id_clinique,
                        medecin: medecin,
                        specialite: conv.context.selected_specialite,
                        patient_nom: conv.context.patient_nom,
                        patient_telephone: conv.context.patient_telephone,
                        patient_age: conv.context.patient_age,
                        patient_poids: conv.context.patient_poids,
                        patient_taille: conv.context.patient_taille,
                        date_rdv: conv.context.selected_date,
                        heure_rdv: conv.context.selected_heure
                    };

                    const appointmentId = await this.clinicService.createAppointment(appointmentData);

                    // Notification support
                    await this.whatsapp.sendMessage(CLINIC_NOTIFICATION_PHONE,
                        `📅 *NOUVEAU RENDEZ-VOUS*\n\n` +
                        `👤 Patient : ${conv.context.patient_nom}\n` +
                        `📱 Tél : ${conv.context.patient_telephone}\n` +
                        `📅 Âge : ${conv.context.patient_age} ans\n` +
                        `⚖️ Poids : ${conv.context.patient_poids} kg\n` +
                        `📏 Taille : ${conv.context.patient_taille} cm\n\n` +
                        `🏥 Clinique : ${conv.context.selected_clinic.nom_clinique}\n` +
                        `🩺 Spécialité : ${conv.context.selected_specialite}\n` +
                        `👨‍⚕️ Médecin : ${medecin}\n` +
                        `📅 Date : ${conv.context.selected_date} à ${conv.context.selected_heure}\n\n` +
                        `🆔 RDV : ${appointmentId}`
                    );

                    await this.convManager.clearContext(phone);

                    const recap = 
                        `*Rendez-vous confirmé !* 🎉\n\n` +
                        `👤 Patient : ${conv.context.patient_nom}\n` +
                        `🏥 Clinique : ${conv.context.selected_clinic.nom_clinique}\n` +
                        `🩺 Spécialité : ${conv.context.selected_specialite}\n` +
                        `👨‍⚕️ Médecin : ${medecin}\n` +
                        `📅 Date : ${conv.context.selected_date} à ${conv.context.selected_heure}\n\n` +
                        `📋 Numéro : ${appointmentId}\n\n` +
                        `Un rappel vous sera envoyé 24h avant.`;

                    await this.whatsapp.sendInteractiveButtons(phone, recap,
                        ["📅 Autre RDV", "💊 Médicaments", "🏠 Accueil"]
                    );
                    return null;

                } catch (error) {
                    log('ERROR', 'Erreur création rendez-vous:', error);
                    return "Erreur lors de la confirmation. Réessayez plus tard. 😔";
                }
            }
            
            if (message === '✏️ Modifier' || message.toLowerCase() === 'modifier') {
                await this.convManager.updateState(phone, this.states.WAITING_VILLE);
                return "Recommençons. Dans quelle ville ? 🏥";
            }
            
            await this.convManager.clearContext(phone);
            return "Rendez-vous annulé. ❌";
        }

        async confirmOrderName(conv) {
            await this.convManager.updateState(conv.phone, this.states.WAITING_NAME);
            return "Quel est votre nom ? 👤";
        }

        async confirmAppointment(conv) {
            return await this.handleWaitingRdvConfirmation(conv.phone, 'confirmer', conv);
        }
    }

    // ==================== INITIALISATION DB ====================
    async function initDatabase() {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS medicaments (
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
                    pending_medicament JSONB DEFAULT NULL,
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
                    patient_age INTEGER,
                    patient_poids INTEGER,
                    patient_taille INTEGER,
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

            if (!change || change.field !== 'messages') return;

            const msg = change.value?.messages?.[0];
            
            // Gestion des messages vocaux
            if (msg?.type === 'voice') {
                await whatsappService.handleVoiceMessage(msg.from);
                return;
            }

            if (!msg || msg.type !== 'text') return;

            const from = msg.from;
            const msgId = msg.id;
            const text = msg.text.body.trim();

            if (processedMessages.has(msgId)) return;
            processedMessages.set(msgId, true);

            await whatsappService.markAsRead(msgId);

            // Réponses livreurs
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

    // ==================== ROUTES API ====================
    app.get('/', (req, res) => {
        const delivery = Utils.getCurrentDeliveryPrice();
        res.json({
            name: 'MIA - Pillbox CI',
            version: '8.0.0-production',
            status: 'production',
            description: 'Version complète avec NLP, Groq et gestion de rendez-vous',
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

    app.get('/api/pharmacies', async (req, res) => {
        try {
            const { schedule, location } = req.query;
            
            let result;
            if (location) {
                const pharmacies = await pharmacyScraper.searchByLocation(location, schedule);
                result = { success: true, pharmacies, query: location };
            } else {
                result = await pharmacyScraper.fetchWeek(schedule);
                result.success = true;
            }
            
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

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

    app.get('/api/cliniques', async (req, res) => {
        try {
            const { ville } = req.query;
            const cliniques = await clinicService.getAllClinics(ville);
            res.json({ success: true, cliniques });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/specialites', async (req, res) => {
        try {
            const specialites = await clinicService.getAllSpecialites();
            res.json({ success: true, specialites });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // Route pour entraîner le modèle NLP (sécurisée)
    app.post('/api/nlp/train', async (req, res) => {
        const authKey = req.headers['x-api-key'];
        if (authKey !== process.env.API_KEY) {
            return res.status(403).json({ error: 'Non autorisé' });
        }

        try {
            const success = await nlpService.trainModel();
            if (success) {
                res.json({ success: true, message: 'Modèle NLP entraîné avec succès' });
            } else {
                res.status(500).json({ success: false, message: 'Erreur entraînement' });
            }
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ==================== INITIALISATION DES SERVICES ====================
    const whatsappService = new WhatsAppService();
    const nlpService = new NLPService();
    const groqService = new GroqService();
    const pharmacyScraper = new PharmacyScraper();
    const searchEngine = new SearchEngine(pool);
    const clinicService = new ClinicService(pool);
    const convManager = new ConversationManager(pool);
    const livreurService = new LivreurService(pool, whatsappService);
    const orderService = new OrderService(pool, whatsappService, livreurService);

    const conversationEngine = new ConversationEngine(
        nlpService, groqService, searchEngine, clinicService, 
        orderService, convManager, whatsappService, livreurService, pharmacyScraper
    );

    const timeoutManager = new TimeoutManager(convManager, whatsappService);

    // ==================== DÉMARRAGE ====================
    const server = app.listen(PORT, '0.0.0.0', async () => {
        await initDatabase();
        await nlpService.loadModel();
        await searchEngine.buildIndex();

        // Rafraîchissement périodique des pharmacies
        setInterval(async () => {
            await pharmacyScraper.fetchWeek();
        }, 6 * 60 * 60 * 1000); // Toutes les 6h

        console.log(`
    ╔══════════════════════════════════════════════════════════════╗
    ║     🚀 MIA - Pillbox CI 🇨🇮 VERSION PRODUCTION FINALE         ║
    ╠══════════════════════════════════════════════════════════════╣
    ║  Worker: ${process.pid}                                                ║
    ║  Port: ${PORT}                                                     ║
    ║                                                              ║
    ║  🧠 NLP : 30+ intentions, extraction d'entités              ║
    ║  🔥 Groq : Génération de réponses naturelles                 ║
    ║  🔍 Fuse.js : Recherche tolérante aux fautes                 ║
    ║                                                              ║
    ║  🛵 LIVREURS : ACCEPTER / RECUPERER / LIVRER                 ║
    ║  📅 RENDEZ-VOUS : Informations patient complètes             ║
    ║  🏥 PHARMACIES : Cache intelligent par semaine               ║
    ║                                                              ║
    ║  💰 Livraison : Nuit 600F | Jour 400F                        ║
    ╚══════════════════════════════════════════════════════════════╝
        `);
    });

    // ==================== GESTION DES ERREURS ====================
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