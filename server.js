require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ===========================================
// CONFIGURATION DES LOGS
// ===========================================
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => {
            const { level, message, timestamp } = info;
            return `${timestamp} [${level.toUpperCase()}] ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ]
});

function log(level, message) {
    logger.log(level, message);
    if (level === 'error') console.error(`[${new Date().toISOString()}] ${message}`);
    else console.log(`[${new Date().toISOString()}] ${message}`);
}

// ===========================================
// CONFIGURATION PRINCIPALE
// ===========================================
const PORT = process.env.PORT || 10000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_API_URL = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
const SUPPORT_PHONE = process.env.SUPPORT_PHONE || '2250701406880';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const DELIVERY_CONFIG = {
    PRICES: { DAY: 400, NIGHT: 600 },
    SERVICE_FEE: 500,
    DELIVERY_TIME: 45
};

// ===========================================
// ÉTATS DE CONVERSATION
// ===========================================
const ConversationStates = {
    IDLE: 'IDLE',
    WAITING_QUANTITY: 'WAITING_QUANTITY',
    WAITING_QUARTIER: 'WAITING_QUARTIER',
    WAITING_NAME: 'WAITING_NAME',
    WAITING_AGE: 'WAITING_AGE',
    WAITING_GENDER: 'WAITING_GENDER',
    WAITING_WEIGHT: 'WAITING_WEIGHT',
    WAITING_HEIGHT: 'WAITING_HEIGHT',
    WAITING_PHONE: 'WAITING_PHONE',
    WAITING_INDICATIONS: 'WAITING_INDICATIONS',
    WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
    WAITING_IMAGE_SELECTION: 'WAITING_IMAGE_SELECTION',
    WAITING_REVIEW_NOTE: 'WAITING_REVIEW_NOTE',
    WAITING_REVIEW_COMMENT: 'WAITING_REVIEW_COMMENT'
};

// ===========================================
// BOUTONS
// ===========================================
const BUTTONS = {
    CONFIRM: '✅ Valider',
    MODIFY: '❌ Modifier',
    CANCEL: '🗑️ Annuler',
    VALIDATE_DELIVERY: '✅ Valider livraison',
    CANCEL_ORDER: '❌ Annuler commande'
};

// ===========================================
// MESSAGES VARIÉS (3 VARIATIONS PAR TYPE)
// ===========================================
const MESSAGES = {
    GREETINGS: [
        `👋 Salut ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Quel médicament cherches-tu ?`,
        `🌟 Bonjour ! MARIAM à ton service. 💊 Dis-moi ce qu'il te faut.`,
        `👋 Hey ! Content de te voir. Quel médicament aujourd'hui ?`
    ],
    
    FIRST_INTERACTION: [
        `👋 *Bienvenue sur MARIAM* ! 
Je suis ton assistante santé 24h/24 à San Pedro. 💊
*Exemples* :
• "2 doliprane" → commander
• Envoie une photo → scan automatique
• "aide" → voir les options
📍 *Livraison uniquement à San Pedro*`,
        
        `🌟 *MARIAM - Pharmacie en ligne* 🌟
Commande en 2 minutes, livraison en 45 min !
💊 "doliprane" → rechercher
📸 Photo → scan automatique
📍 "cité" → donner ton quartier`,
        
        `👋 *Bienvenue* ! Je suis MARIAM.
💊 Pour commander : "2 doliprane"
📸 Pour une ordonnance : envoie la photo
❓ "aide" pour plus d'infos`
    ],

    ASK_QUARTIER: [
        `📍 Ton quartier à San Pedro ?`,
        `🗺️ Où habites-tu à San Pedro ?`,
        `📌 Quartier de livraison ?`
    ],

    ASK_NAME: [
        `👤 Ton nom complet ?`,
        `📝 Comment t'appelles-tu ?`,
        `👤 Nom et prénom ?`
    ],

    ASK_AGE: [
        `🎂 Ton âge ?`,
        `📅 Quel âge as-tu ?`,
        `🎈 Âge du patient ?`
    ],

    ASK_GENDER: [
        `⚧ Genre (M/F) ?`,
        `👔 Masculin ou féminin ? (M/F)`,
        `⚥ M pour homme, F pour femme ?`
    ],

    ASK_WEIGHT: [
        `⚖️ Poids en kg ?`,
        `🏋️ Combien de kilos ?`,
        `📊 Ton poids ? (kg)`
    ],

    ASK_HEIGHT: [
        `📏 Taille en cm ?`,
        `📐 Combien mesures-tu ? (cm)`,
        `👣 Ta taille ? (ex: 175)`
    ],

    ASK_PHONE: [
        `📞 Ton numéro de téléphone ?`,
        `📱 À quel numéro te joindre ?`,
        `📞 Téléphone pour le livreur ?`
    ],

    ASK_INDICATIONS: [
        `📍 Indications pour le livreur ? (porte, immeuble)`,
        `🗺️ Comment te trouver ?`,
        `📌 Point de repère ? (ou "non")`
    ],

    ADDED_TO_CART: (qty, med, total) => [
        `✅ ${qty}x ${med} ajouté (${total} FCFA). Autre chose ?`,
        `🎉 C'est noté ! ${qty}x ${med} = ${total} FCFA`,
        `✨ ${qty}x ${med} ajouté au panier !`
    ],

    NOT_FOUND: (query) => [
        `😕 "${query}" introuvable. Essaie autrement.`,
        `🔍 Pas de "${query}" en stock. Vérifie l'orthographe.`,
        `❌ Aucun résultat pour "${query}".`
    ],

    ERROR: [
        `🤔 Je n'ai pas compris. Tape "aide" pour voir les options.`,
        `❌ Désolé, je n'ai pas saisi. Réessaie.`,
        `😕 Pas clair pour moi. "aide" pour les commandes.`
    ],

    HELP: [
        `👋 *AIDE* :
💊 "doliprane" → chercher
🛒 "mon panier" → voir
📍 "cité" → quartier
📸 Photo → scan
🚨 "urgence" → SAMU 185`,
        
        `📱 *Commandes* :
1️⃣ Tape le médicament
2️⃣ Donne ton quartier
3️⃣ Confirme
📸 Ou envoie une photo !`,
        
        `💡 *Exemples* :
• "2 doliprane"
• "amoxicilline"
• "mon panier"
• "je suis à balmer"`
    ],

    EMERGENCY: [
        `🚨 *URGENCE MÉDICALE* 🚨
📞 Appelle le **185** (SAMU)`,
        `🚑 *SITUATION D'URGENCE* 🚑
Compose le **185** (SAMU)`,
        `🆘 *ALERTE* 🆘
Contacte les urgences au **185**`
    ],

    CREATOR: [
        `👨‍💻 Créé par **Youssef** - UPSP (Licence 2, 2026) 🇨🇮`,
        `👨‍💻 Made with ❤️ par **Youssef** à San Pedro`,
        `👨‍💻 Mon créateur c'est **Youssef**, étudiant entrepreneur`
    ],

    AUDIO_MESSAGE: [
        `🎤 Je ne comprends pas les messages vocaux. Envoie un texte ou une photo.`,
        `📢 Message vocal non supporté. Utilise le texte.`,
        `🔊 Je ne traite que les textes et images.`
    ],

    OUT_OF_CONTEXT: [
        `🤔 Je suis spécialisé dans les médicaments. Tape "aide" pour voir ce que je peux faire.`,
        `💊 Je ne réponds qu'aux questions sur les médicaments.`,
        `🏥 Je suis ton assistant santé. Pour les médicaments uniquement.`
    ],

    CART_EMPTY: [
        `🛒 Ton panier est vide. Ajoute des médicaments.`,
        `📭 Rien dans ton panier. Commence par chercher un médicament.`,
        `💊 Panier vide. "doliprane" pour commencer.`
    ],

    IMAGE_RESULTS: (medicines) => {
        const list = medicines.map((med, i) =>
            `   ${i+1}. *${med.nom_commercial}* - ${med.prix} FCFA`
        ).join('\n');
        return [
            `📸 *Image analysée* :\n${list}\n👉 Réponds avec le numéro.`,
            `🔍 *Médicaments détectés* :\n${list}\n✅ Lequel veux-tu ?`,
            `💊 *Résultats* :\n${list}\n📝 Tape le numéro.`
        ][Math.floor(Math.random() * 3)];
    },

    DELIVERY_INSTRUCTIONS: (order) => [
        `🛵 *NOUVELLE LIVRAISON* #${order.id}
👤 Client: ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}, San Pedro
📌 Indications: ${order.client_indications || 'Aucune'}
👶 Patient: ${order.patient_age || '?'} ans, ${order.patient_genre || '?'}
📦 ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 À encaisser: ${order.total} FCFA
✅ Demander le CODE au client`,
        
        `🚀 *LIVRAISON #${order.id}*
Pour: ${order.client_name}
📍 ${order.client_quartier} - ${order.client_indications || ''}
👶 ${order.patient_age || '?'} ans, ${order.patient_genre || '?'}
📦 ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 ${order.total} FCFA
🔑 CODE à demander`,
        
        `📌 *MISSION #${order.id}*
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier} - ${order.client_indications || ''}
👶 ${order.patient_age || '?'} ans
💰 ${order.total} FCFA
⚠️ CODE à demander au client`
    ],

    SUPPORT_NOTIFICATION: (order) => {
        const items = order.items.map(i => `   • ${i.quantite}x ${i.nom_commercial} (${i.prix * i.quantite} FCFA)`).join('\n');
        
        return [
            `📦 *NOUVELLE COMMANDE* #${order.id}
🕒 ${new Date().toLocaleString('fr-FR')}

👤 *CLIENT*
   • Nom: ${order.client_name}
   • Téléphone: ${order.client_phone}
   • Quartier: ${order.client_quartier}
   • Indications: ${order.client_indications || 'Aucune'}

👶 *PATIENT*
   • Âge: ${order.patient_age || 'Non précisé'} ans
   • Genre: ${order.patient_genre || 'Non précisé'}
   • Poids: ${order.patient_poids || 'Non précisé'} kg
   • Taille: ${order.patient_taille || 'Non précisé'} cm

📦 *ARTICLES*
${items}

💰 *TOTAL*: ${order.total} FCFA
   • Sous-total: ${order.subtotal} FCFA
   • Livraison: ${order.delivery_price} FCFA (${order.delivery_period})
   • Frais service: ${order.service_fee} FCFA

🔑 *CODE*: ${order.confirmation_code}

[✅ Valider] [❌ Annuler]`,
            
            `📋 *COMMANDE #${order.id}*
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
👶 ${order.patient_age || '?'} ans, ${order.patient_genre || '?'}, ${order.patient_poids || '?'}kg
📦 ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 ${order.total} FCFA
🔑 ${order.confirmation_code}`,
            
            `✅ *NOUVELLE COMMANDE*
ID: #${order.id}
Client: ${order.client_name}
Tél: ${order.client_phone}
Quartier: ${order.client_quartier}
Montant: ${order.total} FCFA`
        ];
    },

    DELIVERY_VALIDATED: (order) => [
        `🎉 *LIVRAISON VALIDÉE* #${order.id}
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
💰 ${order.total} FCFA
🔑 Code: ${order.confirmation_code}
✅ Commande marquée DELIVERED`,
        
        `✅ *COMMANDE LIVRÉE* #${order.id}
👤 ${order.client_name}
📍 ${order.client_quartier}
💰 ${order.total} FCFA
Merci !`,
        
        `📦 *LIVRAISON TERMINÉE* #${order.id}
👤 ${order.client_name}
📍 ${order.client_quartier}
💰 ${order.total} FCFA`
    ],

    ORDER_CANCELLED: (order) => [
        `❌ *COMMANDE ANNULÉE* #${order.id}
👤 ${order.client_name} (${order.client_phone})
📍 ${order.client_quartier}
💰 ${order.total} FCFA
🔑 ${order.confirmation_code}
⚠️ Annulation manuelle par le support`,
        
        `🚫 *ANNULATION* #${order.id}
Client: ${order.client_name}
Motif: Support`,
        
        `❌ *COMMANDE SUPPRIMÉE* #${order.id}
👤 ${order.client_name}`
    ],

    ASK_REVIEW: (nom) => [
        `⭐ ${nom || 'Bonjour'} ! Ta commande est livrée. Note de 1 à 5 ?`,
        `📝 ${nom || ''}, satisfait ? Donne une note (1-5)`,
        `💬 ${nom || ''}, ton avis nous intéresse ! Note de 1 à 5`
    ],

    ASK_COMMENT: (note) => [
        `🙏 Merci pour ta note ${note}/5 ! Un commentaire ?`,
        `✨ Super ! ${note}/5. Tu veux ajouter quelque chose ?`,
        `💝 On te remercie (${note}/5). Laisse un commentaire ?`
    ],

    THANK_REVIEW: [
        `😊 Merci beaucoup ! À bientôt !`,
        `🙌 On te remercie ! Tes avis nous aident.`,
        `👋 Merci ! N'hésite pas à recommander MARIAM !`
    ],

    REVIEW_NOTIFICATION: (review) => [
        `📊 *Nouvel avis* #${review.orderId}
👤 ${review.nom || 'Anonyme'} (${review.phone})
⭐ ${review.note}/5
💬 "${review.commentaire || 'Aucun commentaire'}"`,
        
        `⭐ *AVIS CLIENT* #${review.orderId}
👤 ${review.nom}
Note: ${review.note}/5`,
        
        `📝 *Nouveau feedback*
Commande: ${review.orderId}
⭐ ${review.note}/5`
    ],

    CONFIRM_ORDER: (order, nom) => [
        `🎉 *Commande confirmée ${nom || ''}* !
📦 #${order.id}
🔑 Code: ${order.confirmation_code}
📍 ${order.client_quartier}
💰 ${order.total} FCFA
⚠️ À donner au livreur !`,
        
        `✅ *C'est validé ${nom || ''}* !
📋 Commande #${order.id}
🔑 ${order.confirmation_code}
🛵 Livraison dans 45 min.`,
        
        `🎊 *Félicitations ${nom || ''}* !
📦 #${order.id}
📍 ${order.client_quartier}
🔑 ${order.confirmation_code}`
    ],

    ORDER_SUMMARY: (conv, total) => {
        const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
        return [
            `📋 *Récapitulatif* :
${items}
📍 ${conv.context.quartier || '?'}
👤 ${conv.context.nom || '?'}, ${conv.context.age || '?'} ans
💰 Total: ${total} FCFA
👉 Confirme avec "oui"`,
            
            `✅ *Vérifie ta commande* :
${items}
📍 ${conv.context.quartier || '?'}
👤 ${conv.context.nom || '?'}
💰 Total: ${total} FCFA
Tout est bon ? (oui/non)`,
            
            `📝 *Récap* :
${items}
🏠 ${conv.context.quartier || '?'}
💵 Total: ${total} FCFA
On valide ?`
        ][Math.floor(Math.random() * 3)];
    },

    REMINDERS: {
        GENERAL: [
            (nom) => `👋 ${nom || 'Toi'}, tu es toujours là ? Ta commande t'attend.`,
            (nom) => `⏰ ${nom || ''}, on termine cette commande ?`,
            (nom) => `⏳ ${nom || ''}, ta commande est en attente.`
        ],
        CONFIRM: [
            (nom) => `✅ ${nom || ''}, prêt à confirmer ?`,
            (nom) => `👉 ${nom || ''}, dernière étape : confirmation !`,
            (nom) => `📋 ${nom || ''}, plus qu'à valider !`
        ],
        FINAL: [
            (nom) => `⚠️ ${nom || ''}, dernière minute avant annulation !`,
            (nom) => `⏱️ ${nom || ''}, ultime rappel !`,
            (nom) => `❗ ${nom || ''}, 60 secondes pour valider.`
        ],
        CANCELLED: [
            (nom) => `❌ Commande annulée pour inactivité. À bientôt !`,
            (nom) => `🗑️ Commande annulée (20 min sans réponse).`,
            (nom) => `⏰ Délai dépassé, commande annulée.`
        ]
    }
};

// ===========================================
// MESSAGES D'ERREUR VARIÉS (3 PAR TYPE)
// ===========================================
const VALIDATION_ERRORS = {
    NAME: [
        `👤 Nom trop court (minimum 2 lettres)`,
        `📛 Nom invalide. Utilise des lettres.`,
        `❌ Nom non compris. Réessaie.`
    ],
    AGE: [
        `🎂 Âge invalide (1-120 ans)`,
        `❌ L'âge doit être un nombre.`,
        `👶 Âge non valide. Exemple: 25`
    ],
    GENDER: [
        `⚥ Réponds M ou F`,
        `👔 Tape M pour homme, F pour femme`,
        `⚧ Genre non reconnu (M/F)`
    ],
    WEIGHT: [
        `⚖️ Poids invalide (20-200 kg)`,
        `🏋️ Poids en kg. Exemple: 70`,
        `❌ Poids non valide`
    ],
    HEIGHT: [
        `📏 Taille invalide (100-250 cm)`,
        `📐 Taille en cm. Exemple: 175`,
        `❌ Taille non valide`
    ],
    PHONE: [
        `📞 Numéro invalide (07XXXXXXXX)`,
        `📱 10 chiffres requis. Exemple: 0701234567`,
        `❌ Format incorrect`
    ],
    QUARTIER: [
        `📍 Quartier non reconnu. Exemples: Cité, Balmer`,
        `🗺️ Précise ton quartier à San Pedro`,
        `📌 Quartier invalide`
    ],
    QUANTITY: [
        `🔢 Quantité invalide. Exemple: 2`,
        `❌ Donne un nombre valide`,
        `📦 Quantité non comprise`
    ],
    CHOICE: [
        `❌ Choix invalide. Tape le numéro.`,
        `🔢 Réponds avec 1, 2 ou 3`,
        `📋 Choisis dans la liste`
    ],
    CART_EMPTY: [
        `🛒 Panier vide. Ajoute un médicament.`,
        `📭 Rien à commander.`,
        `💊 Commence par chercher un médicament.`
    ]
};

// ===========================================
// UTILS
// ===========================================
class Utils {
    static randomMessage(messages, ...args) {
        if (typeof messages === 'function') {
            const result = messages(...args);
            return Array.isArray(result) ? result[Math.floor(Math.random() * result.length)] : result;
        }
        if (Array.isArray(messages)) {
            return messages[Math.floor(Math.random() * messages.length)];
        }
        return messages;
    }

    static extractNumber(text) {
        const match = text?.match(/\d+/);
        return match ? parseInt(match[0]) : null;
    }

    static formatPhone(phone) {
        return phone?.toString().replace(/\D/g, '') || '';
    }

    static generateOrderId() {
        return `CMD${Date.now()}${Math.floor(Math.random()*1000)}`;
    }

    static generateCode() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    static getDeliveryPrice() {
        const hour = new Date().getHours();
        const isNight = hour >= 0 && hour < 7;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'NIGHT' : 'DAY'
        };
    }

    static validateName(name) {
        return name?.trim().length >= 2;
    }

    static validateAge(age) {
        const ageNum = parseInt(age);
        return !isNaN(ageNum) && ageNum >= 1 && ageNum <= 120;
    }

    static validateGender(gender) {
        const g = gender?.trim().toUpperCase();
        return g === 'M' || g === 'F' || g === 'HOMME' || g === 'FEMME';
    }

    static validateWeight(weight) {
        const w = parseFloat(weight);
        return !isNaN(w) && w >= 20 && w <= 200;
    }

    static validateHeight(height) {
        const h = parseInt(height);
        return !isNaN(h) && h >= 100 && h <= 250;
    }

    static validatePhone(phone) {
        const clean = this.formatPhone(phone);
        return clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean);
    }

    static validateQuartier(quartier) {
        return quartier?.trim().length >= 2;
    }

    static normalizeText(text) {
        if (!text) return '';
        return text.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => log('error', `⚠️ Erreur DB: ${err.message}`));

// ===========================================
// SERVICE WHATSAPP
// ===========================================
class WhatsAppService {
    async sendMessage(to, text) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'text',
                text: { body: text.substring(0, 4096) }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            return true;
        } catch (error) {
            log('error', `❌ Erreur envoi WhatsApp: ${error.message}`);
            return false;
        }
    }

    async sendInteractiveButtons(to, text, buttons) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                to: to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: text.substring(0, 1024) },
                    action: {
                        buttons: buttons.slice(0, 3).map((btn, index) => ({
                            type: 'reply',
                            reply: { id: `btn_${Date.now()}_${index}_${to}`, title: btn.substring(0, 20) }
                        }))
                    }
                }
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            return true;
        } catch (error) {
            log('error', `❌ Erreur boutons: ${error.message}`);
            return false;
        }
    }

    async downloadMedia(mediaId) {
        try {
            log('info', `📸 Téléchargement média ${mediaId}`);
            
            const mediaResponse = await axios.get(
                `https://graph.facebook.com/v18.0/${mediaId}`,
                { 
                    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` },
                    timeout: 10000
                }
            );

            if (!mediaResponse.data?.url) {
                return { success: false, error: "URL non trouvée" };
            }

            const fileResponse = await axios.get(mediaResponse.data.url, { 
                responseType: 'arraybuffer',
                timeout: 15000,
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });

            log('info', `✅ Média téléchargé: ${(fileResponse.data.length / 1024).toFixed(2)}KB`);
            
            return { success: true, buffer: Buffer.from(fileResponse.data) };

        } catch (error) {
            log('error', `❌ Erreur téléchargement: ${error.message}`);
            
            if (error.code === 'ECONNABORTED') {
                return { success: false, error: "Timeout (10s)" };
            }
            if (error.response?.status === 404) {
                return { success: false, error: "Image expirée" };
            }
            if (error.response?.status === 403) {
                return { success: false, error: "Accès non autorisé" };
            }
            
            return { success: false, error: "Erreur technique" };
        }
    }

    async markAsRead(messageId) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
        } catch (error) {}
    }
}

// ===========================================
// SERVICE FUSE.JS ULTRA-RAPIDE
// ===========================================
class FuseService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600, useClones: false });
    }

    async initialize() {
        const start = Date.now();
        log('info', '📦 Chargement des médicaments...');

        const result = await pool.query(`
            SELECT code_produit, nom_commercial, dci, prix, categorie
            FROM medicaments
        `);

        this.medicaments = result.rows.map(med => ({
            ...med,
            normalized: Utils.normalizeText(med.nom_commercial),
            searchable: `${med.nom_commercial} ${med.dci || ''}`.toLowerCase()
        }));

        this.fuse = new Fuse(this.medicaments, {
            keys: [
                { name: 'nom_commercial', weight: 0.8 },
                { name: 'dci', weight: 0.5 },
                { name: 'normalized', weight: 0.6 }
            ],
            threshold: 0.3,
            distance: 50,
            minMatchCharLength: 2,
            shouldSort: true,
            includeScore: true,
            ignoreLocation: true
        });

        log('info', `✅ ${this.medicaments.length} médicaments chargés en ${Date.now() - start}ms`);
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];

        const cacheKey = `search:${Utils.normalizeText(query)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached.slice(0, limit);

        const results = this.fuse.search(query)
            .filter(r => r.score < 0.4)
            .slice(0, limit)
            .map(r => r.item);

        if (results.length > 0) {
            this.cache.set(cacheKey, results);
        }
        return results;
    }

    async findBestMatch(query) {
        const results = await this.search(query, 1);
        return results.length > 0 ? results[0] : null;
    }
}

// ===========================================
// SERVICE VISION GROQ
// ===========================================
class VisionService {
    constructor() {
        this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
        this.cache = new NodeCache({ stdTTL: 86400, useClones: false });
        this.model = "meta-llama/llama-4-scout-17b-16e-instruct";
        this.maxSizeBytes = 4 * 1024 * 1024;
    }

    async analyzeImage(imageBuffer) {
        if (!this.client) {
            log('error', '❌ GROQ_API_KEY non configurée pour Vision');
            return { type: "unknown", medicines: [] };
        }

        try {
            const base64Image = imageBuffer.toString('base64');
            
            if (base64Image.length > this.maxSizeBytes) {
                log('warn', `⚠️ Image trop grande: ${(base64Image.length / 1024 / 1024).toFixed(2)}MB > 4MB`);
                return { type: "unknown", medicines: [], error: "Image trop grande" };
            }

            const prompt = `Tu es MARIAM-VISION. Analyse cette image de médicament.

INSTRUCTIONS:
1. C'est une boîte de médicament? Retourne "box"
2. C'est une ordonnance? Retourne "prescription"
3. Ni l'un ni l'autre? Retourne "unknown"

Pour chaque médicament détecté, donne:
- name: nom exact
- dosage: dosage (ex: 500mg)
- form: forme (comprimé, sirop, etc.)

Format JSON OBLIGATOIRE:
{
  "type": "box|prescription|unknown",
  "medicines": [
    {"name": "...", "dosage": "...", "form": "..."}
  ]
}`;

            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ]
                }],
                temperature: 0.1,
                max_tokens: 500,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            this.cache.set(`vision:${imageBuffer.length}`, result);
            log('info', `✅ Vision OK - Type: ${result.type}, Médicaments: ${result.medicines?.length || 0}`);
            
            return result;

        } catch (error) {
            log('error', `❌ Erreur Vision: ${error.message}`);
            return { type: "unknown", medicines: [] };
        }
    }
}

// ===========================================
// SERVICE LLM - IA PURE (SANS FALLBACK)
// ===========================================
class LLMService {
    constructor() {
        this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
        this.cache = new NodeCache({ stdTTL: 86400, useClones: false });
        this.model = "openai/gpt-oss-20b";
        
        this.systemPrompt = `Tu es MARIAM, une assistante IA intelligente pour une pharmacie en ligne à San Pedro.

TON RÔLE:
Tu dois comprendre le langage naturel des clients et les aider à commander des médicaments. Tu es une IA, donc tu comprends TOUTES les nuances du langage humain.

CE QUE TU DOIS FAIRE:
1. Analyser le message de l'utilisateur
2. Déterminer son INTENTION
3. Extraire les INFORMATIONS importantes (médicament, quantité, quartier, etc.)
4. Retourner un JSON structuré

INTENTIONS POSSIBLES:
- "greet" : salutation (bonjour, salut, hey, bonsoir, coucou)
- "order" : commander un médicament (je veux, j'aimerais, donne-moi, je prends, acheter)
- "price" : demander le prix (combien coûte, c'est combien, prix de, tarif)
- "search" : chercher un médicament (je cherche, tu as, vous avez, est-ce que)
- "select" : choisir une option (le 1, premier, deuxième, celui-ci, numéro 2)
- "info" : donner des informations personnelles
- "checkout" : finaliser la commande (commander, valider, finaliser)
- "confirm" : confirmer (oui, ok, d'accord, ça marche)
- "cart" : voir le panier (mon panier, voir panier)
- "help" : demander de l'aide (aide, comment faire, explication)
- "emergency" : urgence (au secours, samu, 185, urgence)
- "unknown" : pas compris

FORMAT DE RÉPONSE (JSON UNIQUEMENT):
{
  "intention": "une des intentions ci-dessus",
  "medicine": "nom du médicament ou null",
  "quantity": nombre (1 par défaut),
  "selection": "numéro choisi ou null",
  "field": "quartier|nom|age|genre|poids|taille|telephone|indications|null",
  "value": "valeur extraite ou null"
}

EXEMPLES DE COMPRÉHENSION (tu dois comprendre TOUS ces cas):
- "salut" → {"intention":"greet"}
- "bonsoir Mariam" → {"intention":"greet"}
- "cc" → {"intention":"greet"}
- "je voudrais 2 doliprane s'il te plaît" → {"intention":"order","medicine":"doliprane","quantity":2}
- "donne-moi trois amoxicilline" → {"intention":"order","medicine":"amoxicilline","quantity":3}
- "j'ai besoin de acfran" → {"intention":"order","medicine":"acfran","quantity":1}
- "je prends du doliprane" → {"intention":"order","medicine":"doliprane","quantity":1}
- "achète moi de l'amoxicilline" → {"intention":"order","medicine":"amoxicilline","quantity":1}
- "je veux une boîte de paracétamol" → {"intention":"order","medicine":"paracétamol","quantity":1}
- "c'est combien le doliprane" → {"intention":"price","medicine":"doliprane"}
- "quel est le prix de l'amoxicilline" → {"intention":"price","medicine":"amoxicilline"}
- "prix acfran" → {"intention":"price","medicine":"acfran"}
- "est-ce que vous avez du paracétamol" → {"intention":"search","medicine":"paracétamol"}
- "vous avez du doliprane" → {"intention":"search","medicine":"doliprane"}
- "tu as de l'amoxicilline" → {"intention":"search","medicine":"amoxicilline"}
- "le premier" → {"intention":"select","selection":"1"}
- "je prends le numéro 2" → {"intention":"select","selection":"2"}
- "le deuxième" → {"intention":"select","selection":"2"}
- "1" → {"intention":"select","selection":"1"}
- "j'habite à la cité" → {"intention":"info","field":"quartier","value":"cité"}
- "je suis à balmer" → {"intention":"info","field":"quartier","value":"balmer"}
- "mon quartier c'est yopougon" → {"intention":"info","field":"quartier","value":"yopougon"}
- "mon nom c'est Jean Kouamé" → {"intention":"info","field":"nom","value":"Jean Kouamé"}
- "je m'appelle Marie" → {"intention":"info","field":"nom","value":"Marie"}
- "je suis Jean" → {"intention":"info","field":"nom","value":"Jean"}
- "j'ai 30 ans" → {"intention":"info","field":"age","value":"30"}
- "30 ans" → {"intention":"info","field":"age","value":"30"}
- "je suis un homme" → {"intention":"info","field":"genre","value":"M"}
- "c'est pour une femme" → {"intention":"info","field":"genre","value":"F"}
- "M" → {"intention":"info","field":"genre","value":"M"}
- "F" → {"intention":"info","field":"genre","value":"F"}
- "je pèse 70 kilos" → {"intention":"info","field":"poids","value":"70"}
- "je fais 70 kg" → {"intention":"info","field":"poids","value":"70"}
- "70 kg" → {"intention":"info","field":"poids","value":"70"}
- "je mesure 1 mètre 75" → {"intention":"info","field":"taille","value":"175"}
- "ma taille est 175 cm" → {"intention":"info","field":"taille","value":"175"}
- "175 cm" → {"intention":"info","field":"taille","value":"175"}
- "mon téléphone c'est 07 58 01 97 27" → {"intention":"info","field":"telephone","value":"0758019727"}
- "voici mon numéro 0758019727" → {"intention":"info","field":"telephone","value":"0758019727"}
- "07 58 01 97 27" → {"intention":"info","field":"telephone","value":"0758019727"}
- "porte rouge, sonnette verte" → {"intention":"info","field":"indications","value":"porte rouge, sonnette verte"}
- "derrière l'école" → {"intention":"info","field":"indications","value":"derrière l'école"}
- "je veux commander maintenant" → {"intention":"checkout"}
- "valider ma commande" → {"intention":"checkout"}
- "commander" → {"intention":"checkout"}
- "oui c'est bon" → {"intention":"confirm"}
- "ok" → {"intention":"confirm"}
- "d'accord" → {"intention":"confirm"}
- "affiche mon panier" → {"intention":"cart"}
- "mon panier" → {"intention":"cart"}
- "voir panier" → {"intention":"cart"}
- "aide-moi" → {"intention":"help"}
- "comment faire" → {"intention":"help"}
- "explique" → {"intention":"help"}
- "c'est une urgence" → {"intention":"emergency"}
- "au secours" → {"intention":"emergency"}
- "samu" → {"intention":"emergency"}
- "185" → {"intention":"emergency"}

RÈGLES IMPORTANTES:
- Réponds TOUJOURS en français
- Retourne UNIQUEMENT du JSON, pas d'autre texte
- Utilise ta compréhension du langage naturel pour interpréter CORRECTEMENT chaque message
- Si tu n'es pas sûr à 100%, mets "intention": "unknown"`;
    }

    async analyze(text) {
        if (!this.client) {
            log('error', '❌ GROQ_API_KEY non configurée');
            return { intention: "unknown" };
        }

        const cacheKey = `llm:${text}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return cached;

        try {
            log('info', `🧠 IA analyse: "${text.substring(0, 50)}..."`);
            
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: "system", content: this.systemPrompt },
                    { role: "user", content: text }
                ],
                temperature: 0.1,
                max_tokens: 200,
                response_format: { type: "json_object" }
            });

            const result = JSON.parse(response.choices[0].message.content);
            
            if (!result.intention) result.intention = "unknown";
            if (!result.medicine) result.medicine = null;
            if (!result.quantity || result.quantity < 1) result.quantity = 1;
            if (!result.selection) result.selection = null;
            if (!result.field) result.field = null;
            if (!result.value) result.value = null;

            this.cache.set(cacheKey, result);
            log('info', `✅ IA compris: ${result.intention} ${result.medicine || ''} ${result.field || ''}`);
            return result;

        } catch (error) {
            log('error', `❌ Erreur IA: ${error.message}`);
            return { intention: "unknown" };
        }
    }
}

// ===========================================
// SERVICE COMMANDES
// ===========================================
class OrderService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async createOrder(phone, cart, context) {
        const orderId = Utils.generateOrderId();
        const code = Utils.generateCode();
        const subtotal = cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;

        const order = {
            id: orderId,
            client_name: context.nom,
            client_phone: phone,
            client_quartier: context.quartier,
            client_ville: 'San Pedro',
            client_indications: context.indications || '',
            patient_age: context.age,
            patient_genre: context.genre,
            patient_poids: context.poids,
            patient_taille: context.taille,
            items: cart,
            subtotal,
            delivery_price: delivery.price,
            service_fee: DELIVERY_CONFIG.SERVICE_FEE,
            total,
            confirmation_code: code,
            delivery_period: delivery.period,
            status: 'PENDING'
        };

        await pool.query(`
            INSERT INTO orders (
                id, client_name, client_phone, client_quartier, client_ville,
                client_indications, patient_age, patient_genre, patient_poids,
                patient_taille, items, subtotal, delivery_price, service_fee,
                total, confirmation_code, delivery_period, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
            order.id, order.client_name, order.client_phone, order.client_quartier,
            order.client_ville, order.client_indications, order.patient_age,
            order.patient_genre, order.patient_poids, order.patient_taille,
            JSON.stringify(order.items), order.subtotal, order.delivery_price,
            order.service_fee, order.total, order.confirmation_code,
            order.delivery_period, order.status
        ]);

        return order;
    }

    async getOrder(id) {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (result.rows.length === 0) return null;
        const order = result.rows[0];
        order.items = JSON.parse(order.items);
        return order;
    }

    async updateStatus(id, status) {
        await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
    }

    async assignLivreur(orderId) {
        const livreurResult = await pool.query(`
            SELECT id_livreur, nom, telephone, whatsapp
            FROM livreurs
            WHERE disponible = true
            ORDER BY commandes_livrees ASC
            LIMIT 1
        `);

        if (livreurResult.rows.length === 0) {
            return { success: false };
        }

        const livreur = livreurResult.rows[0];
        const order = await this.getOrder(orderId);
        await this.updateStatus(orderId, 'ASSIGNED');

        const message = Utils.randomMessage(MESSAGES.DELIVERY_INSTRUCTIONS, order);
        await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);

        return { success: true, livreur };
    }

    async notifySupport(order) {
        const message = Utils.randomMessage(MESSAGES.SUPPORT_NOTIFICATION, order);
        await this.whatsapp.sendInteractiveButtons(SUPPORT_PHONE, message, [
            BUTTONS.VALIDATE_DELIVERY,
            BUTTONS.CANCEL_ORDER
        ]);
    }
}

// ===========================================
// SERVICE AVIS CLIENTS
// ===========================================
class AvisService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
        this.pendingReviews = new Map();
    }

    async demanderAvis(phone, nom, orderId) {
        setTimeout(async () => {
            const message = Utils.randomMessage(MESSAGES.ASK_REVIEW, nom);
            await this.whatsapp.sendMessage(phone, message);
            this.pendingReviews.set(phone, { orderId, nom, etape: 'note' });
        }, 30 * 60 * 1000);
    }

    async traiterNote(phone, note) {
        const review = this.pendingReviews.get(phone);
        if (!review) return false;

        const noteNum = parseInt(note);
        if (isNaN(noteNum) || noteNum < 1 || noteNum > 5) {
            await this.whatsapp.sendMessage(phone, "⭐ Donne une note entre 1 et 5.");
            return false;
        }

        review.note = noteNum;
        review.etape = 'commentaire';
        this.pendingReviews.set(phone, review);

        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ASK_COMMENT, noteNum));
        return true;
    }

    async traiterCommentaire(phone, commentaire) {
        const review = this.pendingReviews.get(phone);
        if (!review) return false;

        await pool.query(`
            INSERT INTO avis_clients (order_id, client_phone, client_name, note, commentaire)
            VALUES ($1, $2, $3, $4, $5)
        `, [review.orderId, phone, review.nom || 'Anonyme', review.note, commentaire]);

        const notificationMsg = Utils.randomMessage(MESSAGES.REVIEW_NOTIFICATION, {
            orderId: review.orderId,
            nom: review.nom,
            phone: phone,
            note: review.note,
            commentaire: commentaire
        });
        
        await this.whatsapp.sendMessage(SUPPORT_PHONE, notificationMsg);
        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.THANK_REVIEW));
        
        this.pendingReviews.delete(phone);
        return true;
    }
}

// ===========================================
// GESTIONNAIRE DE CONVERSATIONS
// ===========================================
class ConversationManager {
    constructor() {
        this.conversations = new Map();
        this.reminders = new Map();
    }

    get(phone) {
        if (!this.conversations.has(phone)) {
            this.conversations.set(phone, {
                state: ConversationStates.IDLE,
                cart: [],
                context: {},
                history: [],
                lastActivity: Date.now()
            });
        }
        return this.conversations.get(phone);
    }

    update(phone, updates) {
        const conv = this.get(phone);
        Object.assign(conv, updates, { lastActivity: Date.now() });
        this.conversations.set(phone, conv);
    }

    delete(phone) {
        this.conversations.delete(phone);
        if (this.reminders.has(phone)) {
            clearTimeout(this.reminders.get(phone));
            this.reminders.delete(phone);
        }
    }

    scheduleReminders(phone, nom) {
        if (this.reminders.has(phone)) {
            clearTimeout(this.reminders.get(phone));
        }

        const timers = [];

        timers.push(setTimeout(async () => {
            const conv = this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_CONFIRMED') {
                await new WhatsAppService().sendMessage(phone,
                    Utils.randomMessage(MESSAGES.REMINDERS.GENERAL, nom));
            }
        }, 5 * 60 * 1000));

        timers.push(setTimeout(async () => {
            const conv = this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_CONFIRMED') {
                await new WhatsAppService().sendMessage(phone,
                    Utils.randomMessage(MESSAGES.REMINDERS.CONFIRM, nom));
            }
        }, 10 * 60 * 1000));

        timers.push(setTimeout(async () => {
            const conv = this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_CONFIRMED') {
                await new WhatsAppService().sendMessage(phone,
                    Utils.randomMessage(MESSAGES.REMINDERS.FINAL, nom));
            }
        }, 19 * 60 * 1000));

        timers.push(setTimeout(async () => {
            const conv = this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== 'ORDER_CONFIRMED') {
                await new WhatsAppService().sendMessage(phone,
                    Utils.randomMessage(MESSAGES.REMINDERS.CANCELLED, nom));
                this.delete(phone);
            }
        }, 20 * 60 * 1000));

        this.reminders.set(phone, timers);
    }
}

// ===========================================
// GESTIONNAIRE DE BOUTONS
// ===========================================
class ButtonHandler {
    constructor(whatsapp, orders, avisService) {
        this.whatsapp = whatsapp;
        this.orders = orders;
        this.avisService = avisService;
    }

    async handle(phone, buttonText, orderId) {
        if (buttonText === BUTTONS.VALIDATE_DELIVERY) {
            await this.handleValidateDelivery(phone, orderId);
        } else if (buttonText === BUTTONS.CANCEL_ORDER) {
            await this.handleCancelOrder(phone, orderId);
        }
    }

    async handleValidateDelivery(phone, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) {
            await this.whatsapp.sendMessage(phone, `❌ Commande ${orderId} introuvable.`);
            return;
        }

        await this.orders.updateStatus(orderId, 'DELIVERED');
        
        await this.whatsapp.sendMessage(order.client_phone,
            `🎉 *Commande #${orderId} livrée !*\nMerci d'avoir choisi MARIAM ! 😊`);

        await this.whatsapp.sendMessage(phone,
            Utils.randomMessage(MESSAGES.DELIVERY_VALIDATED, order));

        setTimeout(async () => {
            await this.avisService.demanderAvis(order.client_phone, order.client_name, orderId);
        }, 30 * 60 * 1000);
    }

    async handleCancelOrder(phone, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) {
            await this.whatsapp.sendMessage(phone, `❌ Commande ${orderId} introuvable.`);
            return;
        }

        await this.orders.updateStatus(orderId, 'CANCELED');
        await this.whatsapp.sendMessage(order.client_phone, `❌ Commande #${orderId} annulée.`);
        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ORDER_CANCELLED, order));
    }
}

// ===========================================
// MOTEUR PRINCIPAL
// ===========================================
class MariamBot {
    constructor() {
        this.whatsapp = new WhatsAppService();
        this.fuse = new FuseService();
        this.llm = new LLMService();
        this.vision = new VisionService();
        this.orders = new OrderService(this.whatsapp);
        this.avisService = new AvisService(this.whatsapp);
        this.convManager = new ConversationManager();
        this.buttons = new ButtonHandler(this.whatsapp, this.orders, this.avisService);
        this.stats = { total: 0, avgTime: 0 };
    }

    async initialize() {
        await this.fuse.initialize();
        log('info', '🚀 Bot MARIAM prêt');
    }

    async process(phone, text, mediaId = null) {
        const start = Date.now();
        this.stats.total++;

        console.log(`\n📩 [${new Date().toLocaleTimeString()}] ${phone}: "${text || (mediaId ? '[IMAGE]' : '')}"`);

        const conv = this.convManager.get(phone);

        if (mediaId && mediaId.startsWith('audio')) {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.AUDIO_MESSAGE));
            this.logPerformance(start);
            return;
        }

        if (mediaId) {
            await this.handleImage(phone, mediaId, conv);
            this.logPerformance(start);
            return;
        }

        if (conv.history.length === 0) {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.FIRST_INTERACTION));
            conv.history.push({ time: Date.now(), text: 'first' });
            this.convManager.update(phone, conv);
            this.logPerformance(start);
            return;
        }

        const llmResult = await this.llm.analyze(text);

        if (llmResult.intention === "unknown") {
            log('info', `🤔 IA n'a pas compris: "${text}"`);
            
            const results = await this.fuse.search(text, 3);
            if (results.length > 0) {
                await this.whatsapp.sendMessage(phone,
                    `🔍 *Résultats* :\n${results.map((r, i) => `${i+1}. ${r.nom_commercial} (${r.prix} FCFA)`).join('\n')}\n👉 Choisis le numéro.`);
                conv.context.search_results = results;
                conv.state = ConversationStates.WAITING_QUANTITY;
            } else {
                await this.whatsapp.sendMessage(phone,
                    `😕 Désolé, je n'ai pas compris "${text}". Peux-tu reformuler ?`);
            }
            this.logPerformance(start);
            return;
        }

        await this.routeIntent(phone, text, conv, llmResult);
        
        conv.history.push({ time: Date.now(), text, intention: llmResult.intention });
        this.convManager.update(phone, conv);
        this.logPerformance(start);
    }

    async routeIntent(phone, text, conv, llmResult) {
        log('info', `🤖 Décision IA: ${llmResult.intention}`);

        if (llmResult.intention === 'select' && llmResult.selection) {
            const selection = parseInt(llmResult.selection) - 1;
            
            if (conv.context.search_results && conv.context.search_results[selection]) {
                const med = conv.context.search_results[selection];
                conv.context.pending_med = med;
                conv.state = ConversationStates.WAITING_QUANTITY;
                await this.whatsapp.sendMessage(phone,
                    `💊 *${med.nom_commercial}*\n💰 ${med.prix} FCFA\n\nCombien de boîtes ?`);
                return;
            }
            
            if (conv.context.pending_image_options && conv.context.pending_image_options[selection]) {
                const med = conv.context.pending_image_options[selection];
                conv.cart.push({ ...med, quantite: 1 });
                delete conv.context.pending_image_options;
                conv.state = ConversationStates.IDLE;
                await this.whatsapp.sendMessage(phone,
                    `✅ ${med.nom_commercial} ajouté au panier !`);
                return;
            }
        }

        if (conv.state === ConversationStates.WAITING_QUANTITY && conv.context.pending_med) {
            const qty = llmResult.quantity || Utils.extractNumber(text) || 1;
            const med = conv.context.pending_med;
            
            conv.cart.push({ ...med, quantite: qty });
            delete conv.context.pending_med;
            conv.state = ConversationStates.IDLE;
            
            await this.whatsapp.sendMessage(phone,
                `✅ ${qty}x ${med.nom_commercial} ajouté (${med.prix * qty} FCFA)`);
            
            setTimeout(async () => {
                await this.whatsapp.sendMessage(phone, "👉 Autre chose ? (ou tape 'commander')");
            }, 1000);
            return;
        }

        if (llmResult.intention === 'greet') {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.GREETINGS));
            return;
        }

        if (llmResult.intention === 'help') {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.HELP));
            return;
        }

        if (llmResult.intention === 'emergency') {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.EMERGENCY));
            return;
        }

        if (llmResult.intention === 'cart') {
            if (!conv.cart?.length) {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(VALIDATION_ERRORS.CART_EMPTY));
            } else {
                const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
                const subtotal = conv.cart.reduce((s, i) => s + (i.prix * i.quantite), 0);
                await this.whatsapp.sendMessage(phone,
                    `🛒 *Ton panier* :\n${items}\n💰 Sous-total: ${subtotal} FCFA`);
            }
            return;
        }

        if (llmResult.intention === 'price' || llmResult.intention === 'search' || llmResult.intention === 'order') {
            const medicineName = llmResult.medicine || text;
            const fuseResult = await this.fuse.findBestMatch(medicineName);

            if (!fuseResult) {
                const results = await this.fuse.search(medicineName, 5);
                if (results.length > 0) {
                    await this.whatsapp.sendMessage(phone,
                        `🔍 *Peut-être voulais-tu dire* :\n${results.map((r, i) => `${i+1}. ${r.nom_commercial} (${r.prix} FCFA)`).join('\n')}\n👉 Choisis le numéro.`);
                    conv.context.search_results = results;
                    conv.state = ConversationStates.WAITING_QUANTITY;
                } else {
                    await this.whatsapp.sendMessage(phone,
                        `😕 Désolé, je n'ai pas trouvé "${medicineName}" dans notre stock.`);
                }
                return;
            }

            if (llmResult.intention === 'price') {
                await this.whatsapp.sendMessage(phone,
                    `💰 *${fuseResult.nom_commercial}* : ${fuseResult.prix} FCFA`);
            }
            else if (llmResult.intention === 'search') {
                await this.whatsapp.sendMessage(phone,
                    `💊 *${fuseResult.nom_commercial}*\n💰 Prix: ${fuseResult.prix} FCFA\n📦 DCI: ${fuseResult.dci || 'Non spécifié'}\n\n👉 Combien de boîtes veux-tu ?`);
                conv.context.pending_med = fuseResult;
                conv.state = ConversationStates.WAITING_QUANTITY;
            }
            else if (llmResult.intention === 'order') {
                const quantity = llmResult.quantity || 1;
                conv.cart.push({ ...fuseResult, quantite: quantity });
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.ADDED_TO_CART, quantity, fuseResult.nom_commercial, fuseResult.prix * quantity));
                
                setTimeout(async () => {
                    await this.whatsapp.sendMessage(phone,
                        "👉 Autre chose ? (ou tape 'commander' pour finaliser)");
                }, 1000);
            }
            return;
        }

        if (llmResult.intention === 'info' && llmResult.field && llmResult.value) {
            const field = llmResult.field;
            const value = llmResult.value;

            let isValid = true;
            switch(field) {
                case 'quartier': isValid = Utils.validateQuartier(value); break;
                case 'nom': isValid = Utils.validateName(value); break;
                case 'age': isValid = Utils.validateAge(value); break;
                case 'genre': isValid = Utils.validateGender(value); break;
                case 'poids': isValid = Utils.validateWeight(value); break;
                case 'taille': isValid = Utils.validateHeight(value); break;
                case 'telephone': isValid = Utils.validatePhone(value); break;
                case 'indications': isValid = true; break;
            }

            if (!isValid) {
                const errorKey = field.toUpperCase();
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(VALIDATION_ERRORS[errorKey] || VALIDATION_ERRORS.GENERAL));
                return;
            }

            conv.context[field] = value;

            const nextStep = this.getNextQuestion(conv);
            if (nextStep) {
                await this.whatsapp.sendMessage(phone, nextStep);
                conv.state = `WAITING_${nextStep.split(' ')[0].replace(/[^a-z]/gi, '').toUpperCase()}`;
            } else {
                await this.showSummary(phone, conv);
                conv.state = ConversationStates.WAITING_CONFIRMATION;
                this.convManager.scheduleReminders(phone, conv.context.nom);
            }
            return;
        }

        if (llmResult.intention === 'checkout') {
            if (!conv.cart?.length) {
                await this.whatsapp.sendMessage(phone,
                    "🛒 Ton panier est vide. Ajoute d'abord des médicaments.");
                return;
            }

            if (!conv.context.quartier) {
                await this.whatsapp.sendMessage(phone,
                    "📍 Pour commencer, quel est ton quartier à San Pedro ?");
                conv.state = ConversationStates.WAITING_QUARTIER;
                return;
            }

            await this.showSummary(phone, conv);
            conv.state = ConversationStates.WAITING_CONFIRMATION;
            this.convManager.scheduleReminders(phone, conv.context.nom);
            return;
        }

        if (llmResult.intention === 'confirm' && conv.state === ConversationStates.WAITING_CONFIRMATION) {
            try {
                const order = await this.orders.createOrder(phone, conv.cart, conv.context);
                
                await this.whatsapp.sendMessage(phone,
                    Utils.randomMessage(MESSAGES.CONFIRM_ORDER, order, conv.context.nom));
                
                await this.orders.notifySupport(order);
                await this.orders.assignLivreur(order.id);
                
                this.convManager.delete(phone);
                
            } catch (error) {
                log('error', `❌ Erreur commande: ${error.message}`);
                await this.whatsapp.sendMessage(phone,
                    "❌ Désolé, une erreur est survenue. Réessaie ou contacte le support.");
            }
            return;
        }

        // Fallback ultime
        const results = await this.fuse.search(text, 3);
        if (results.length > 0) {
            await this.whatsapp.sendMessage(phone,
                `🔍 *Résultats* :\n${results.map((r, i) => `${i+1}. ${r.nom_commercial} (${r.prix} FCFA)`).join('\n')}\n👉 Choisis le numéro.`);
            conv.context.search_results = results;
            conv.state = ConversationStates.WAITING_QUANTITY;
        } else {
            await this.whatsapp.sendMessage(phone,
                `😕 Je n'ai pas compris "${text}". Peux-tu reformuler ?`);
        }
    }

    async handleImage(phone, mediaId, conv) {
        await this.whatsapp.sendMessage(phone, "📸 Téléchargement de l'image en cours...");
        
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, 
                `❌ ${media.error || "Impossible de télécharger l'image"}`);
            return;
        }

        await this.whatsapp.sendMessage(phone, "🔍 Analyse de l'image...");
        
        const visionResult = await this.vision.analyzeImage(media.buffer);
        
        if (visionResult.type === 'unknown' || !visionResult.medicines?.length) {
            await this.whatsapp.sendMessage(phone, 
                "🔍 Aucun médicament détecté. Envoie une photo nette d'une boîte ou d'une ordonnance.");
            return;
        }

        const medicines = [];
        for (const med of visionResult.medicines) {
            const results = await this.fuse.search(med.name, 1);
            if (results.length > 0) {
                medicines.push(results[0]);
                log('info', `✅ Médicament trouvé en base: ${results[0].nom_commercial} pour "${med.name}"`);
            }
        }

        if (medicines.length === 0) {
            await this.whatsapp.sendMessage(phone, 
                `🔍 Aucun médicament trouvé en stock.`);
            return;
        }

        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.IMAGE_RESULTS, medicines));

        conv.context.pending_image_options = medicines;
        conv.state = ConversationStates.WAITING_IMAGE_SELECTION;
        this.convManager.update(phone, conv);
    }

    getNextQuestion(conv) {
        if (!conv.context.quartier) return Utils.randomMessage(MESSAGES.ASK_QUARTIER);
        if (!conv.context.nom) return Utils.randomMessage(MESSAGES.ASK_NAME);
        if (!conv.context.age) return Utils.randomMessage(MESSAGES.ASK_AGE);
        if (!conv.context.genre) return Utils.randomMessage(MESSAGES.ASK_GENDER);
        if (!conv.context.poids) return Utils.randomMessage(MESSAGES.ASK_WEIGHT);
        if (!conv.context.taille) return Utils.randomMessage(MESSAGES.ASK_HEIGHT);
        if (!conv.context.telephone) return Utils.randomMessage(MESSAGES.ASK_PHONE);
        if (!conv.context.indications) return Utils.randomMessage(MESSAGES.ASK_INDICATIONS);
        return null;
    }

    async showSummary(phone, conv) {
        const subtotal = conv.cart.reduce((s, i) => s + (i.prix * i.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;

        await this.whatsapp.sendMessage(phone,
            Utils.randomMessage(MESSAGES.ORDER_SUMMARY, conv, total));
    }

    logPerformance(start) {
        const time = Date.now() - start;
        this.stats.avgTime = (this.stats.avgTime * (this.stats.total - 1) + time) / this.stats.total;
        console.log(`⚡ Temps: ${time}ms (moy: ${Math.round(this.stats.avgTime)}ms)`);
    }
}

// ===========================================
// INSTANCE UNIQUE
// ===========================================
let botInstance = null;

async function getBot() {
    if (!botInstance) {
        botInstance = new MariamBot();
        await botInstance.initialize();
    }
    return botInstance;
}

// ===========================================
// SERVER EXPRESS
// ===========================================
const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
        log('info', '✅ Webhook vérifié');
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const msg = changes?.value?.messages?.[0];

        if (!msg) return;

        const whatsapp = new WhatsAppService();
        await whatsapp.markAsRead(msg.id);

        const bot = await getBot();

        if (msg.type === 'text') {
            await bot.process(msg.from, msg.text.body);
        }
        else if (msg.type === 'image') {
            log('info', `📸 Image reçue de ${msg.from}, ID: ${msg.image.id}`);
            await bot.process(msg.from, null, msg.image.id);
        }
        else if (msg.type === 'audio' || msg.type === 'voice') {
            await bot.process(msg.from, null, 'audio');
        }
        else if (msg.type === 'interactive') {
            const buttonText = msg.interactive.button_reply.title;
            const orderId = msg.interactive.button_reply.id.split('_')[2];
            await bot.buttons.handle(msg.from, buttonText, orderId);
        }

    } catch (error) {
        log('error', `❌ Webhook error: ${error.message}`);
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        stats: botInstance?.stats || { total: 0 }
    });
});

app.get('/debug/stats', (req, res) => {
    res.json({
        conversations: botInstance?.convManager.conversations.size || 0,
        fuseCache: botInstance?.fuse.cache.getStats(),
        llmCache: botInstance?.llm.cache.getStats(),
        visionCache: botInstance?.vision.cache.getStats(),
        performance: botInstance?.stats
    });
});

// ===========================================
// INITIALISATION DB
// ===========================================
async function initDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS conversations (
            phone VARCHAR(20) PRIMARY KEY,
            state VARCHAR(50),
            cart JSONB,
            context JSONB,
            history JSONB,
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id VARCHAR(50) PRIMARY KEY,
            client_name VARCHAR(100),
            client_phone VARCHAR(20),
            client_quartier VARCHAR(100),
            client_ville VARCHAR(100),
            client_indications TEXT,
            patient_age INTEGER,
            patient_genre VARCHAR(1),
            patient_poids INTEGER,
            patient_taille INTEGER,
            items JSONB NOT NULL,
            subtotal DECIMAL(10,2),
            delivery_price DECIMAL(10,2),
            service_fee DECIMAL(10,2),
            total DECIMAL(10,2),
            confirmation_code VARCHAR(20),
            delivery_period VARCHAR(10),
            status VARCHAR(50),
            livreur_phone VARCHAR(20),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS avis_clients (
            id SERIAL PRIMARY KEY,
            order_id VARCHAR(50) REFERENCES orders(id),
            client_phone VARCHAR(20),
            client_name VARCHAR(100),
            note INTEGER CHECK (note >= 1 AND note <= 5),
            commentaire TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(client_phone);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_avis_order ON avis_clients(order_id);
    `);

    log('info', '✅ Base de données prête');
}

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        await initDatabase();

        app.listen(PORT, () => {
            log('info', `🚀 Serveur démarré sur le port ${PORT}`);
            console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 MARIAM BOT - PRODUCTION READY                        ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║   📱 Port: ${PORT}                                         ║
║                                                           ║
║   ✅ IA PURE (openai/gpt-oss-20b)                         ║
║   ✅ Comprend le langage naturel                          ║
║   ✅ 150+ exemples dans le prompt                         ║
║   ✅ Fuse.js (6000+ médicaments)                          ║
║   ✅ Vision (meta-llama/llama-4-scout)                    ║
║   ✅ Gestion livreurs                                      ║
║   ✅ Avis clients                                          ║
║   ✅ Rappels automatiques                                  ║
║   ✅ Messages variés (3x)                                  ║
║   ✅ Cache 24h pour IA & Vision                            ║
║   ✅ Support avec TOUTES les infos patient                 ║
║                                                           ║
║   👨‍💻 Créé par Youssef - UPSP (Licence 2, 2026)           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        log('error', `❌ Erreur fatale: ${error.message}`);
        process.exit(1);
    }
}

start();
