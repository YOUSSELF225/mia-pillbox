require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const NodeCache = require('node-cache');
const { NlpManager } = require('node-nlp');
const Groq = require('groq-sdk');
const Fuse = require('fuse.js');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ===========================================
// CONFIGURATION DES LOGS
// ===========================================
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => {
            const { level, message, timestamp, ...meta } = info;
            let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
            if (Object.keys(meta).length > 0) {
                logMessage += ` | ${JSON.stringify(meta)}`;
            }
            return logMessage;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.File({ filename: 'error.log', level: 'error' })
    ]
});

function log(level, message, metadata = {}) {
    logger.log(level, message, metadata);
    if (level === 'error') console.error(`[${new Date().toISOString()}] ${message}`, metadata);
    else if (level === 'info') console.log(`[${new Date().toISOString()}] ${message}`);
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
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

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
    SELECTING_MEDICINE: 'SELECTING_MEDICINE',
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
    WAITING_IMAGE_SELECTION: 'WAITING_IMAGE_SELECTION'
};

// ===========================================
// BOUTONS
// ===========================================
const BUTTONS = {
    CONFIRM: '✅ Valider',
    MODIFY: '❌ Modifier',
    CANCEL: '🗑️ Annuler',
    VALIDATE_DELIVERY: '✅ Valider la livraison',
    CANCEL_ORDER: '❌ Annuler la commande'
};

// ===========================================
// MESSAGES VARIÉS (3 VARIATIONS PAR TYPE)
// ===========================================
const MESSAGES = {
    // ACCUEIL
    GREETINGS: [
        (nom) => `👋 Salut ${nom || 'toi'} ! Je suis MARIAM, ton assistante santé à San Pedro. 💊 Qu'est-ce que je peux faire pour toi aujourd'hui ?`,
        (nom) => `🌟 Bonjour ${nom || ''} ! MARIAM à ton service. 💊 Tu cherches un médicament ou tu veux passer une commande ?`,
        (nom) => `👋 Hey ${nom || ''} ! 💊 Content de te voir ! Dis-moi ce dont tu as besoin, je suis là pour t'aider.`
    ],

    // PREMIÈRE INTERACTION
    FIRST_INTERACTION: [
        `👋 *Bienvenue sur MARIAM* ! 
Je suis ton assistante santé 24h/24 à San Pedro. 💊
*Exemples de commandes* :
• "2 doliprane" → pour commander
• Envoie une photo de ta boîte → je détecte automatiquement
• "aide" → pour voir toutes les options
📍 *Livraison rapide à San Pedro uniquement*`,
        
        `🌟 *Salut ! Moi c'est MARIAM* 🌟
Ta pharmacienne virtuelle à San Pedro. Voici comment ça marche :
1️⃣ Dis-moi le médicament (ex: "doliprane")
2️⃣ Donne ton quartier (ex: "cité")
3️⃣ Reçois ta commande en 45 min chrono ! ⏱️
💡 *Astuce* : Envoie une photo, je reconnais le médicament !`,
        
        `👋 *Bienvenue sur MARIAM BOT* ! 
Je suis là pour te faciliter la vie 💊
*Commandes simples* :
• "je veux 2 doliprane"
• "amoxicilline 500mg"
• Photo de ton ordonnance
🛵 *Livraison express à San Pedro*
👉 Commence par me dire ce qu'il te faut !`
    ],

    // DEMANDE QUARTIER
    ASK_QUARTIER: [
        (nom) => `📍 ${nom || 'Mon ami'}, c'est dans quel quartier à San Pedro qu'on te livre ?`,
        (nom) => `🗺️ ${nom || ''}, dis-moi ton quartier pour préparer la livraison.`,
        (nom) => `📌 ${nom || ''}, où se trouve l'adresse de livraison ? (quartier)`
    ],

    // DEMANDE NOM
    ASK_NAME: [
        (nom) => `👤 ${nom || ''}, c'est quoi ton nom complet pour la commande ?`,
        (nom) => `📝 ${nom || ''}, je note la commande à quel nom ?`,
        (nom) => `👤 ${nom || ''}, peux-tu me donner ton nom et prénom ?`
    ],

    // DEMANDE ÂGE
    ASK_AGE: [
        (nom) => `🎂 ${nom || ''}, quel âge as-tu ? (pour le dossier patient)`,
        (nom) => `📅 ${nom || ''}, c'est quoi ton âge ? (ex: 25 ans)`,
        (nom) => `🎈 ${nom || ''}, ton âge stp ? (entre 1 et 120 ans)`
    ],

    // DEMANDE GENRE
    ASK_GENDER: [
        (nom) => `⚧ ${nom || ''}, tu es un homme (M) ou une femme (F) ?`,
        (nom) => `👔 ${nom || ''}, précise ton genre : M ou F`,
        (nom) => `⚥ ${nom || ''}, M pour masculin ou F pour féminin ?`
    ],

    // DEMANDE POIDS
    ASK_WEIGHT: [
        (nom) => `⚖️ ${nom || ''}, quel est ton poids en kg ? (ex: 70)`,
        (nom) => `🏋️ ${nom || ''}, combien de kilos pèses-tu ?`,
        (nom) => `📊 ${nom || ''}, ton poids stp ? (en kilogrammes)`
    ],

    // DEMANDE TAILLE
    ASK_HEIGHT: [
        (nom) => `📏 ${nom || ''}, quelle est ta taille en cm ? (ex: 175)`,
        (nom) => `📐 ${nom || ''}, tu mesures combien ? (en centimètres)`,
        (nom) => `👣 ${nom || ''}, ta taille stp ? (ex: 168 cm)`
    ],

    // DEMANDE TÉLÉPHONE
    ASK_PHONE: [
        (nom) => `📞 ${nom || ''}, ton numéro de téléphone pour le livreur ?`,
        (nom) => `📱 ${nom || ''}, à quel numéro on peut te joindre ?`,
        (nom) => `📞 ${nom || ''}, le numéro où te contacter ? (ex: 0701234567)`
    ],

    // DEMANDE INDICATIONS
    ASK_INDICATIONS: [
        (nom) => `📍 ${nom || ''}, des indications pour trouver la maison ? (porte, immeuble) ou "non"`,
        (nom) => `🗺️ ${nom || ''}, comment le livreur peut te trouver facilement ?`,
        (nom) => `📌 ${nom || ''}, un point de repère ou des indications ? (sinon réponds "non")`
    ],

    // AJOUT AU PANIER
    ADDED_TO_CART: (qty, med, total, nom) => [
        `✅ Super ! ${qty}x ${med} ajouté (${total} FCFA). ${nom ? `${nom}, ` : ''}autre chose ?`,
        `🎉 C'est noté ! ${qty}x ${med} dans ton panier (${total} FCFA). On continue ?`,
        `✨ Parfait ! ${qty}x ${med} = ${total} FCFA. ${nom ? `${nom}, ` : ''}tu veux autre chose ?`
    ],

    // PANIER VIDE
    CART_EMPTY: [
        `🛒 Ton panier est vide pour l'instant. Quel médicament te faut-il ?`,
        `📭 Rien dans ton panier. Dis-moi ce que tu cherches !`,
        `💊 Panier vide. Envoie le nom d'un médicament ou une photo.`
    ],

    // MÉDICAMENT NON TROUVÉ
    NOT_FOUND: (query) => [
        `😕 Désolé, je n'ai pas trouvé "${query}". Tu peux essayer autrement ou envoyer une photo.`,
        `🔍 "${query}" ? Je ne connais pas ce médicament. Vérifie l'orthographe ou envoie une photo.`,
        `❌ Pas de résultat pour "${query}". Essaie avec un autre nom ou une photo.`
    ],

    // SÉLECTION DE MÉDICAMENTS
    MEDICINE_SELECTION: (results) => [
        `🔍 *Voici ce que j'ai trouvé* :
${results.map((med, i) => `${i+1}. *${med.nom_commercial}* - ${med.prix} FCFA`).join('\n')}
👉 Réponds avec le *numéro* ou le nom exact.`,
        
        `📋 *Résultats de recherche* :
${results.map((med, i) => `   ${i+1}. ${med.nom_commercial} (${med.prix} FCFA)`).join('\n')}
✅ Choisis en répondant avec le numéro.`,
        
        `🔎 *Médicaments trouvés* :
${results.map((med, i) => `   ${i+1}. ${med.nom_commercial} — ${med.prix} FCFA`).join('\n')}
💬 Tape le numéro pour sélectionner.`
    ],

    // RÉSULTATS IMAGE
    IMAGE_RESULTS: (medicines) => {
        const list = medicines.map((med, i) => 
            `   ${i+1}. *${med.name}*\n      💊 ${med.dosage || 'dosage?'} | ${med.form || 'forme?'}`
        ).join('\n');
        
        return [
            `📸 *Image analysée* ! Voici ce que j'ai détecté :\n${list}\n👉 Réponds avec le numéro à ajouter.`,
            `🔍 *Résultats de l'analyse* :\n${list}\n✅ Lequel veux-tu ajouter au panier ?`,
            `💊 *Médicaments détectés* :\n${list}\n📝 Tape le numéro de ton choix.`
        ][Math.floor(Math.random() * 3)];
    },

    // CONFIRMATION COMMANDE
    CONFIRM_ORDER: (order, nom) => {
        const items = order.items.map(item => `   • ${item.quantite}x ${item.nom_commercial}`).join('\n');
        
        return [
            `🎉 *Commande confirmée ${nom || ''}* ! 🎉
📦 N°: ${order.id}
📍 Adresse: ${order.client_quartier}, San Pedro
📦 Articles:
${items}
💰 Total: ${order.total} FCFA
🔑 *Code secret* : ${order.confirmation_code}
⚠️ À donner au livreur !
📱 Il t'appellera au ${order.client_phone}`,
            
            `✅ *C'est validé ${nom || ''}* ! 
📋 Récap :
• Commande #${order.id}
• Livraison à ${order.client_quartier}
• Code : ${order.confirmation_code}
🛵 Arrivée prévue dans 45 min environ.
💬 Le livreur te contactera.`,
            
            `🎊 *Félicitations ${nom || ''}* ! Ta commande est partie !
📦 #${order.id}
📍 ${order.client_quartier}
💰 ${order.total} FCFA
🔑 Code : ${order.confirmation_code}
⏱️ Livraison : ~45 min
📞 Le livreur t'appelle avant d'arriver.`
        ];
    },

    // RÉCAPITULATIF COMMANDE
    ORDER_SUMMARY: (conv, total) => {
        const items = conv.cart.map(item => 
            `   • ${item.quantite}x ${item.nom_commercial} (${item.prix * item.quantite} FCFA)`
        ).join('\n');
        
        return [
            `📋 *Récapitulatif de ta commande* :
${items}
📍 Livraison : ${conv.context.client_quartier || '?'}, San Pedro
👤 Patient : ${conv.context.client_nom || '?'}, ${conv.context.patient_age || '?'} ans
💰 *Total* : ${total} FCFA
-------------------
👉 Confirme avec "oui" ou modifie avec "non"`,
            
            `✅ *Vérifie ta commande* :
${items}
📍 Adresse : ${conv.context.client_quartier || '?'}
👤 Pour : ${conv.context.client_nom || '?'}
💰 À payer : ${total} FCFA
-------------------
Tout est bon ? (oui/non)`,
            
            `📝 *Récap avant validation* :
${items}
🏠 Quartier : ${conv.context.client_quartier || '?'}
💵 Total : ${total} FCFA
-------------------
On valide ? Réponds "oui" pour confirmer.`
        ];
    },

    // ERREUR GÉNÉRALE
    ERROR: [
        `🤔 Désolé, je n'ai pas compris. Tu peux reformuler ou taper "aide" pour voir les options.`,
        `❌ Oups ! Je n'ai pas saisi ta demande. Essaie autrement ou envoie "aide".`,
        `😕 Pas clair pour moi. Réessaie ou tape "aide" pour comprendre comment je fonctionne.`
    ],

    // AIDE
    HELP: [
        `👋 *AIDE - Mode d'emploi* :
💊 "doliprane" → chercher un médicament
🛒 "mon panier" → voir ma sélection
📍 "cité" → donner mon quartier
📸 Photo → scan automatique
❌ "annuler" → tout annuler
🚨 "urgence" → appeler le SAMU (185)`,
        
        `📱 *Comment commander ?* :
1️⃣ Tape le médicament (ex: "2 doliprane")
2️⃣ Donne ton quartier (ex: "cité")
3️⃣ Confirme la commande
📸 Ou envoie une photo de ta boîte !`,
        
        `💡 *Exemples de messages* :
• "2 doliprane"
• "je veux de l'amoxicilline"
• "mon panier"
• "je suis à balmer"
• "j'ai 30 ans"
• Envoie une photo de ton ordonnance`
    ],

    // URGENCE
    EMERGENCY: [
        `🚨 *URGENCE MÉDICALE* 🚨
📞 Appelle immédiatement le **185** (SAMU)
⏱️ Chaque seconde compte !`,
        
        `🚑 *SITUATION D'URGENCE* 🚑
Compose le **185** (SAMU) tout de suite !
Ne perds pas de temps sur WhatsApp.`,
        
        `🆘 *ALERTE MÉDICALE* 🆘
Contacte les urgences au **185** (SAMU)
Je ne peux pas gérer les urgences ici.`
    ],

    // REMERCIEMENTS
    THANKS: [
        `🙏 Merci à toi ! À bientôt sur MARIAM 😊`,
        `✨ Avec plaisir ! Bonne journée et à très vite 🌟`,
        `💝 Merci pour ta confiance ! Reviens quand tu veux 👋`
    ],

    // AU REVOIR
    GOODBYE: [
        `👋 Au revoir ! Prends soin de toi.`,
        `✨ À bientôt ! N'hésite pas à revenir.`,
        `👋 Bye bye ! Porte-toi bien.`
    ],

    // CRÉATEUR
    CREATOR: [
        `👨‍💻 J'ai été créé par **Youssef**, étudiant en Licence 2 à l'UPSP (Agriculture). Développé à San Pedro avec ❤️ !`,
        `👨‍💻 Mon créateur c'est **Youssef**, un jeune entrepreneur de San Pedro passionné par la tech et la santé ! 🇨🇮`,
        `👨‍💻 Je suis le bébé de **Youssef** (UPSP, Licence 2). Il a codé ce bot pour aider sa communauté !`
    ],

    // RAPPELS
    REMINDERS: {
        GENERAL: [
            (nom) => `👋 ${nom || 'Toi'}, tu es toujours là ? Ta commande t'attend !`,
            (nom) => `⏰ ${nom || ''}, on termine cette commande ? Je suis toujours là !`,
            (nom) => `⏳ ${nom || ''}, il reste quelques minutes pour finaliser ta commande.`
        ],
        CONFIRM: [
            (nom) => `✅ ${nom || ''}, ta commande est prête à être confirmée ! On valide ?`,
            (nom) => `👉 ${nom || ''}, plus qu'une étape : la confirmation !`,
            (nom) => `📋 ${nom || ''}, tout est bon. Dernière étape : valider la commande.`
        ],
        FINAL: [
            (nom) => `⚠️ ${nom || ''}, dernière minute avant annulation !`,
            (nom) => `⏱️ ${nom || ''}, ultime rappel : valide maintenant !`,
            (nom) => `❗ ${nom || ''}, 60 secondes pour sauver ta commande !`
        ],
        CANCELLED: [
            (nom) => `❌ Commande annulée pour inactivité. Tu peux recommencer quand tu veux !`,
            (nom) => `🗑️ Ta commande a été annulée (20 min sans réponse). Reviens vite !`,
            (nom) => `⏰ Délai dépassé, commande annulée. N'hésite pas à repasser commande !`
        ]
    },

    // AUDIO MESSAGE
    AUDIO_MESSAGE: [
        `🎤 Désolé, je ne comprends pas les messages vocaux. Envoie-moi un texte ou une photo stp ! 📝`,
        `📢 Je ne traite que les textes et les images. Réécris-moi ton message en texte 👆`,
        `🎵 Message vocal reçu ! Mais je ne sais lire que les textes et les photos. Envoie-moi un message écrit 😊`
    ],

    // POUR LE LIVREUR
    DELIVERY_INSTRUCTIONS: (order) => [
        `🛵 *NOUVELLE COMMANDE #${order.id}*
👤 Client : ${order.client_name}
📞 ${order.client_phone}
📍 ${order.client_quartier}, San Pedro
📦 ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 ${order.total} FCFA
✅ À faire :
1. Livrer au client
2. Demander le CODE à 6 chiffres
3. Envoyer au support : #${order.id} + CODE`,
        
        `🚀 *LIVRAISON À EFFECTUER* 🚀
Commande #${order.id}
Pour : ${order.client_name} (${order.client_phone})
À : ${order.client_quartier}
📦 Articles : ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 Total : ${order.total} FCFA
🔑 N'oublie pas de demander le CODE au client !`,
        
        `📌 *MISSION LIVRAISON* #${order.id}
👤 Destinataire : ${order.client_name}
📍 Quartier : ${order.client_quartier}
📞 Contact : ${order.client_phone}
📦 Contenu : ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 À encaisser : ${order.total} FCFA
⚠️ Demande le CODE de confirmation au client !`
    ],

    // NOTIFICATION SUPPORT
    SUPPORT_NOTIFICATION: (order) => [
        `📦 *NOUVELLE COMMANDE* #${order.id}
👤 Client : ${order.client_name} (${order.client_phone})
📍 Quartier : ${order.client_quartier}
📦 Articles : ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 Total : ${order.total} FCFA
🔑 Code : ${order.confirmation_code}
🕒 ${new Date().toLocaleString('fr-FR')}`,
        
        `📋 *COMMANDE À TRAITER* #${order.id}
👤 ${order.client_name} - ${order.client_phone}
📍 ${order.client_quartier}
📦 ${order.items.map(i => `${i.quantite}x ${i.nom_commercial}`).join(', ')}
💰 ${order.total} FCFA
🔑 ${order.confirmation_code}
👉 En attente de validation`,
        
        `✅ *NOUVELLE COMMANDE ENREGISTRÉE*
ID : #${order.id}
Client : ${order.client_name}
Tél : ${order.client_phone}
Quartier : ${order.client_quartier}
Montant : ${order.total} FCFA
Code : ${order.confirmation_code}
🕒 ${new Date().toLocaleTimeString('fr-FR')}`
    ],

    // VALIDATION LIVRAISON
    DELIVERY_VALIDATED: (order) => [
        `🎉 *LIVRAISON VALIDÉE* #${order.id}
👤 ${order.client_name}
📍 ${order.client_quartier}
💰 ${order.total} FCFA
✅ Commande terminée avec succès !`,
        
        `✅ *COMMANDE LIVRÉE* #${order.id}
Client : ${order.client_name}
Montant : ${order.total} FCFA
Merci pour votre confiance ! 🙏`,
        
        `📦 *LIVRAISON TERMINÉE* #${order.id}
👤 ${order.client_name}
📍 ${order.client_quartier}
💰 ${order.total} FCFA encaissés
👍 Client satisfait !`
    ],

    // ANNULATION
    CANCELLED: (order) => [
        `❌ *COMMANDE ANNULÉE* #${order.id}
👤 ${order.client_name}
📍 ${order.client_quartier}
💰 ${order.total} FCFA
🗑️ Commande supprimée.`,
        
        `🚫 *ANNULATION* #${order.id}
Client : ${order.client_name}
Motif : Annulé par le support
📦 Commande retirée du système.`,
        
        `⚠️ *COMMANDE ANNULLÉE* #${order.id}
👤 ${order.client_name}
📞 ${order.client_phone}
❌ Opération annulée.`
    ],

    // DEMANDE D'AVIS
    ASK_REVIEW: (nom) => [
        `⭐ ${nom || 'Bonjour'} ! Ta commande est livrée. Comment s'est passée l'expérience ? Note de 1 à 5.`,
        `📝 ${nom || ''}, on peut améliorer notre service ? Donne-nous une note sur 5 !`,
        `💬 ${nom || ''}, satisfait de ta commande ? Note-la de 1 à 5 ⭐`
    ],

    ASK_COMMENT: (note) => [
        `🙏 Merci pour ta note ${note}/5 ! Un petit commentaire pour nous aider à progresser ?`,
        `✨ Super ! ${note}/5 c'est noté. Tu veux ajouter quelque chose ?`,
        `💝 On te remercie (${note}/5) ! Laisse-nous un commentaire si tu veux.`
    ],

    THANK_REVIEW: [
        `😊 Merci beaucoup pour ton retour ! À bientôt !`,
        `🙌 On te remercie ! Tes avis nous aident à progresser.`,
        `👋 Merci ! N'hésite pas à recommander MARIAM à tes proches !`
    ]
};

// ===========================================
// MESSAGES D'ERREUR (3 VARIATIONS PAR TYPE)
// ===========================================
const VALIDATION_ERRORS = {
    NAME: [
        `👤 Nom trop court (minimum 2 lettres). Exemple: "Jean K"`,
        `📛 Nom invalide. Utilise seulement des lettres. Ex: "Marie"`,
        `❌ Je n'ai pas compris ton nom. Réponds avec ton prénom et nom.`
    ],
    AGE: [
        `🎂 Âge invalide. Doit être entre 1 et 120 ans. Exemple: "25"`,
        `❌ L'âge doit être un nombre (ex: 30). Réessaie.`,
        `👶 Âge non valide. Donne un âge réaliste entre 1 et 120.`
    ],
    GENDER: [
        `⚥ Réponds avec M (homme) ou F (femme) stp.`,
        `👔 Je n'ai pas compris. Tape M ou F.`,
        `⚧ Genre non reconnu. Réponds M ou F.`
    ],
    WEIGHT: [
        `⚖️ Poids invalide. Entre 20 et 200 kg. Exemple: "70"`,
        `🏋️ Le poids doit être un nombre en kg. Ex: 65`,
        `❌ Poids non valide. Donne un poids entre 20 et 200 kg.`
    ],
    HEIGHT: [
        `📏 Taille invalide. Entre 100 et 250 cm. Exemple: "175"`,
        `📐 La taille doit être en cm. Ex: 168`,
        `❌ Taille non valide. Donne une taille entre 100 et 250 cm.`
    ],
    PHONE: [
        `📞 Numéro invalide. Format: 07XXXXXXXX ou 01XXXXXXXX`,
        `📱 10 chiffres requis. Exemple: 0701234567`,
        `❌ Mauvais format. Utilise un numéro ivoirien (07,01,05).`
    ],
    QUARTIER: [
        `📍 Quartier non reconnu. Exemples: Cité, Balmer, Sogefiha`,
        `🗺️ Précise ton quartier à San Pedro. Ex: "cité"`,
        `📌 Quartier invalide. Donne un nom de quartier valide.`
    ],
    QUANTITY: [
        `🔢 Quantité invalide. Exemple: "2"`,
        `❌ Donne un nombre valide (ex: 1, 2, 3...)`,
        `📦 Je n'ai pas compris la quantité. Réponds avec un chiffre.`
    ],
    CHOICE: [
        `❌ Choix invalide. Réponds avec le numéro affiché.`,
        `🔢 Tape le chiffre correspondant à ton choix.`,
        `📋 Je n'ai pas compris. Choisis un numéro dans la liste.`
    ],
    MEDICINE_NOT_FOUND: (query) => [
        `😕 "${query}" introuvable. Vérifie l'orthographe.`,
        `🔍 Pas de "${query}" en stock. Essaie autrement.`,
        `❌ Aucun médicament "${query}". Envoie une photo peut-être ?`
    ],
    IMAGE_ERROR: [
        `📸 Image non reconnue. Envoie une photo nette de boîte ou d'ordonnance.`,
        `🔍 Je n'ai rien détecté sur cette image. Essaie avec une photo plus claire.`,
        `❌ Photo trop floue ou sans médicament. Réessaie stp.`
    ],
    AUDIO_ERROR: [
        `🎤 Désolé, je ne lis que les textes et les images. Envoie un message écrit.`,
        `📢 Message vocal non supporté. Utilise le texte stp.`,
        `🔊 Je ne comprends pas l'audio. Réponds-moi par écrit.`
    ],
    CART_EMPTY: [
        `🛒 Ton panier est vide. Ajoute un médicament d'abord !`,
        `📭 Rien à commander pour l'instant. Dis-moi ce qu'il te faut.`,
        `💊 Panier vide. Commence par chercher un médicament.`
    ],
    ORDER_PENDING: [
        `⏳ Tu as déjà une commande en cours. Termine-la d'abord.`,
        `📦 Une commande est déjà en préparation. Patiente un peu.`,
        `🔄 Commande en cours. Finis celle-ci avant d'en créer une nouvelle.`
    ],
    NO_DELIVERY: [
        `😕 Aucun livreur disponible pour le moment. Réessaie dans 30 min.`,
        `🛵 Tous nos livreurs sont occupés. Patientez un peu.`,
        `⏱️ Pas de livreur dispo maintenant. On te notifie dès que possible.`
    ],
    INVALID_CODE: [
        `❌ Code incorrect. Vérifie avec le client et réessaie.`,
        `🔑 Mauvais code de confirmation. Demande encore au client.`,
        `⚠️ Le code ne correspond pas. Réessaie avec le bon code.`
    ],
    GENERAL: [
        `❌ Une erreur est survenue. Réessaie ou contacte le support.`,
        `😵 Oups ! Quelque chose s'est mal passé. On recommence ?`,
        `⚠️ Erreur technique. Patientez un instant et réessayez.`
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
        const date = new Date();
        return `CMD${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    }

    static generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    static getDeliveryPrice() {
        const hour = new Date().getHours();
        const isNight = hour >= 0 && hour < 7;
        return {
            price: isNight ? DELIVERY_CONFIG.PRICES.NIGHT : DELIVERY_CONFIG.PRICES.DAY,
            period: isNight ? 'NIGHT' : 'DAY'
        };
    }

    static validatePhone(phone) {
        const clean = this.formatPhone(phone);
        const isValid = clean.length === 10 && /^(07|01|05)\d{8}$/.test(clean);
        return { valid: isValid, phone: clean };
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

    static validateQuartier(quartier) {
        return quartier?.trim().length >= 2;
    }
}

// ===========================================
// BASE DE DONNÉES
// ===========================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => log('error', '⚠️ Erreur pool DB:', err));

// ===========================================
// SERVICE DE RECHERCHE ULTRA-PERFORMANT
// ===========================================
class SearchService {
    constructor() {
        this.fuse = null;
        this.medicaments = [];
        this.cache = new NodeCache({ stdTTL: 3600 });
        this.searchStats = { total: 0, cacheHits: 0, cacheMisses: 0 };
    }

    async initialize() {
        log('info', 'Initialisation du service de recherche...');
        const start = Date.now();
        
        const result = await pool.query(`
            SELECT code_produit, nom_commercial, dci, prix, categorie
            FROM medicaments
        `);
        
        this.medicaments = result.rows.map(med => ({
            ...med,
            searchable: `${med.nom_commercial} ${med.dci || ''}`.toLowerCase(),
            keywords: this.extractKeywords(med),
            simple: this.normalize(med.nom_commercial)
        }));

        this.fuse = new Fuse(this.medicaments, {
            keys: [
                { name: 'nom_commercial', weight: 0.8 },
                { name: 'dci', weight: 0.5 },
                { name: 'searchable', weight: 0.4 },
                { name: 'keywords', weight: 0.3 }
            ],
            threshold: 0.4,
            distance: 50,
            minMatchCharLength: 2,
            shouldSort: true,
            includeScore: true,
            ignoreLocation: true,
            findAllMatches: true
        });

        log('info', `✅ Service recherche initialisé avec ${this.medicaments.length} médicaments en ${Date.now() - start}ms`);
    }

    extractKeywords(med) {
        const text = `${med.nom_commercial} ${med.dci || ''}`.toLowerCase();
        return text.split(/[\s-]+/).filter(k => k.length > 1);
    }

    normalize(text) {
        if (!text) return '';
        return text.toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    async search(query, limit = 5) {
        if (!query || query.length < 2) return [];
        
        const cleanQuery = this.normalize(query);
        const cacheKey = `search:${cleanQuery}`;
        
        const cached = this.cache.get(cacheKey);
        if (cached) {
            this.searchStats.cacheHits++;
            return cached.slice(0, limit);
        }
        
        this.searchStats.cacheMisses++;
        this.searchStats.total++;

        const results = this.fuse.search(cleanQuery)
            .filter(r => r.score < 0.5)
            .map(r => r.item)
            .slice(0, limit);

        this.cache.set(cacheKey, results);
        log('debug', `🔍 Recherche "${query}" → ${results.length} résultats`);
        
        return results;
    }

    async quickSearch(query, limit = 3) {
        const cleanQuery = this.normalize(query);
        return this.medicaments
            .filter(med => med.simple.includes(cleanQuery))
            .slice(0, limit)
            .map(med => ({
                nom: med.nom_commercial,
                prix: med.prix,
                code: med.code_produit
            }));
    }
}

// ===========================================
// SERVICE VISION GROQ
// ===========================================
class VisionService {
    constructor() {
        this.client = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;
        log('info', `Groq Vision ${this.client ? '✅ activé' : '❌ désactivé'}`);
    }

    async analyzeImage(imageBuffer) {
        if (!this.client) return { success: false, error: "Groq non configuré" };

        try {
            const base64Image = imageBuffer.toString('base64');
            if (base64Image.length > 4 * 1024 * 1024) {
                return { success: false, error: "Image trop grande (max 4MB)" };
            }

            const prompt = `Tu es MARIAM-VISION, assistant médical.
Analyse l'image et retourne UNIQUEMENT un JSON avec:
{
  "type": "box|prescription",
  "medicines": [
    {
      "name": "NOM_EXACT",
      "dosage": "DOSAGE",
      "form": "FORME"
    }
  ]
}
Si aucun médicament: {"type": "unknown"}`;

            const response = await this.client.chat.completions.create({
                model: VISION_MODEL,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
                    ]
                }],
                temperature: 0.1,
                max_tokens: 1024,
                response_format: { type: "json_object" }
            });

            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            log('error', '❌ Erreur Groq Vision:', error);
            return { success: false, error: "Échec analyse" };
        }
    }
}

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
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            log('info', `✅ Message envoyé à ${to}`);
            return true;
        } catch (error) {
            log('error', `❌ Erreur envoi à ${to}:`, error.message);
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
                            reply: { id: `btn_${Date.now()}_${index}`, title: btn.substring(0, 20) }
                        }))
                    }
                }
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
            log('info', `🔘 Boutons envoyés à ${to}`);
            return true;
        } catch (error) {
            log('error', `❌ Erreur boutons:`, error.message);
            return false;
        }
    }

    async downloadMedia(mediaId) {
        try {
            const media = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
            });
            const file = await axios.get(media.data.url, { responseType: 'arraybuffer' });
            return { success: true, buffer: Buffer.from(file.data) };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async markAsRead(messageId) {
        try {
            await axios.post(WHATSAPP_API_URL, {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId
            }, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` } });
        } catch (error) {}
    }
}

// ===========================================
// SERVICE NLP
// ===========================================
class NLPService {
    constructor() {
        this.nlp = null;
    }

    async initialize() {
        log('info', 'Chargement du modèle NLP...');
        const modelPath = path.join(__dirname, 'model.nlp');
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Modèle NLP introuvable: ${modelPath}`);
        }
        this.nlp = new NlpManager({ languages: ['fr'] });
        await this.nlp.load(modelPath);
        log('info', '✅ Modèle NLP chargé');
    }

    async process(text) {
        if (!this.nlp) return { intent: 'none', entities: [] };
        const result = await this.nlp.process('fr', text);
        log('info', `🧠 NLP - Intention: "${result.intent}", Entités: ${JSON.stringify(result.entities)}`);
        return result;
    }
}

// ===========================================
// SERVICE COMMANDES
// ===========================================
class OrderService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async createOrder(data, phone) {
        const orderId = Utils.generateOrderId();
        const code = Utils.generateCode();
        const subtotal = data.items.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
        const delivery = Utils.getDeliveryPrice();
        const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;

        const order = {
            id: orderId,
            client_name: data.client.nom,
            client_phone: data.client.telephone || phone,
            client_quartier: data.client.quartier,
            client_ville: 'San Pedro',
            client_indications: data.client.indications || '',
            patient_age: data.client.patient_age,
            patient_genre: data.client.patient_genre,
            patient_poids: data.client.patient_poids,
            patient_taille: data.client.patient_taille,
            items: data.items,
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

        log('info', `📦 Commande créée: #${order.id}`);
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
        log('info', `📦 Commande #${id} → ${status}`);
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
            log('warn', '⚠️ Aucun livreur disponible');
            return { success: false };
        }

        const livreur = livreurResult.rows[0];
        const order = await this.getOrder(orderId);
        await this.updateStatus(orderId, 'ASSIGNED');

        const message = Utils.randomMessage(MESSAGES.DELIVERY_INSTRUCTIONS, order);
        await this.whatsapp.sendMessage(livreur.whatsapp || livreur.telephone, message);
        log('info', `🛵 Livreur assigné: ${livreur.nom}`);
        return { success: true, livreur };
    }
}

// ===========================================
// SERVICE AVIS CLIENTS
// ===========================================
class AvisService {
    constructor(whatsapp) {
        this.whatsapp = whatsapp;
    }

    async demanderAvis(phone, nom, orderId) {
        setTimeout(async () => {
            const message = Utils.randomMessage(MESSAGES.ASK_REVIEW, nom);
            await this.whatsapp.sendMessage(phone, message);
            
            // Stocker en cache que cet avis est en attente
            cache.set(`avis:${orderId}`, { phone, nom, orderId, etape: 'note' }, 3600);
        }, 30 * 60 * 1000); // 30 minutes
    }

    async traiterNote(phone, note, orderId) {
        if (note < 1 || note > 5) {
            await this.whatsapp.sendMessage(phone, `⭐ Donne une note entre 1 et 5 stp.`);
            return false;
        }

        cache.set(`avis:${orderId}`, { phone, note, etape: 'commentaire' }, 3600);
        
        const message = Utils.randomMessage(MESSAGES.ASK_COMMENT, note);
        await this.whatsapp.sendMessage(phone, message);
        return true;
    }

    async traiterCommentaire(phone, commentaire, orderId) {
        const avisData = cache.get(`avis:${orderId}`);
        if (!avisData) return false;

        await pool.query(`
            INSERT INTO avis_clients (order_id, client_phone, client_name, note, commentaire)
            VALUES ($1, $2, $3, $4, $5)
        `, [orderId, phone, avisData.nom || 'Anonyme', avisData.note, commentaire]);

        log('info', `⭐ Nouvel avis: ${avisData.note}/5 pour commande #${orderId}`);
        
        // Notification au support
        const supportMsg = `
📊 *NOUVEL AVIS CLIENT*
📦 Commande: #${orderId}
👤 Client: ${avisData.nom || 'Anonyme'} (${phone})
⭐ Note: ${avisData.note}/5
💬 Commentaire: "${commentaire || 'Aucun'}"
        `;
        await this.whatsapp.sendMessage(SUPPORT_PHONE, supportMsg);
        
        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.THANK_REVIEW));
        cache.del(`avis:${orderId}`);
        return true;
    }
}

// ===========================================
// GESTION DES CONVERSATIONS
// ===========================================
class ConversationManager {
    constructor() {
        this.cache = new NodeCache({ stdTTL: 3600 });
        this.reminderTimers = new Map();
    }

    async get(phone) {
        let conv = this.cache.get(phone);
        if (!conv) {
            conv = { 
                state: ConversationStates.IDLE, 
                cart: [], 
                context: {}, 
                history: [],
                lastActivity: new Date()
            };
            this.cache.set(phone, conv);
        }
        return conv;
    }

    async update(phone, updates) {
        const conv = this.cache.get(phone) || {};
        this.cache.set(phone, { 
            ...conv, 
            ...updates, 
            lastActivity: new Date() 
        });
    }

    async clear(phone) {
        this.cache.del(phone);
        if (this.reminderTimers.has(phone)) {
            clearTimeout(this.reminderTimers.get(phone));
            this.reminderTimers.delete(phone);
        }
    }

    async scheduleReminders(phone, nom) {
        // Annuler les anciens rappels
        if (this.reminderTimers.has(phone)) {
            clearTimeout(this.reminderTimers.get(phone));
        }

        // Rappel 5 min
        const timer5 = setTimeout(async () => {
            const conv = await this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== ConversationStates.ORDER_CONFIRMED) {
                await new WhatsAppService().sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.REMINDERS.GENERAL, nom));
            }
        }, 5 * 60 * 1000);

        // Rappel 10 min
        const timer10 = setTimeout(async () => {
            const conv = await this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== ConversationStates.ORDER_CONFIRMED) {
                await new WhatsAppService().sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.REMINDERS.CONFIRM, nom));
            }
        }, 10 * 60 * 1000);

        // Rappel 19 min (dernier)
        const timer19 = setTimeout(async () => {
            const conv = await this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== ConversationStates.ORDER_CONFIRMED) {
                await new WhatsAppService().sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.REMINDERS.FINAL, nom));
            }
        }, 19 * 60 * 1000);

        // Annulation 20 min
        const timer20 = setTimeout(async () => {
            const conv = await this.get(phone);
            if (conv.state !== ConversationStates.IDLE && conv.state !== ConversationStates.ORDER_CONFIRMED) {
                await new WhatsAppService().sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.REMINDERS.CANCELLED, nom));
                await this.clear(phone);
            }
        }, 20 * 60 * 1000);

        this.reminderTimers.set(phone, { timer5, timer10, timer19, timer20 });
    }
}

// ===========================================
// GESTION DES BOUTONS
// ===========================================
class ButtonHandler {
    constructor(whatsapp, orders, convManager, avisService) {
        this.whatsapp = whatsapp;
        this.orders = orders;
        this.convManager = convManager;
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
        
        // Message au client
        await this.whatsapp.sendMessage(order.client_phone,
            `🎉 *Commande #${orderId} livrée avec succès !*\nMerci d'avoir choisi MARIAM ! 😊`
        );

        // Message au support
        await this.whatsapp.sendMessage(phone,
            Utils.randomMessage(MESSAGES.DELIVERY_VALIDATED, order)
        );

        // Demander avis après 30 min
        await this.avisService.demanderAvis(order.client_phone, order.client_name, orderId);
    }

    async handleCancelOrder(phone, orderId) {
        const order = await this.orders.getOrder(orderId);
        if (!order) {
            await this.whatsapp.sendMessage(phone, `❌ Commande ${orderId} introuvable.`);
            return;
        }

        await this.orders.updateStatus(orderId, 'CANCELED');
        await this.whatsapp.sendMessage(order.client_phone, `❌ Commande #${orderId} annulée.`);
        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.CANCELLED, order));
    }
}

// ===========================================
// MOTEUR PRINCIPAL
// ===========================================
class MariamBot {
    constructor() {
        this.whatsapp = new WhatsAppService();
        this.vision = new VisionService();
        this.search = new SearchService();
        this.nlp = new NLPService();
        this.orders = new OrderService(this.whatsapp);
        this.avisService = new AvisService(this.whatsapp);
        this.convManager = new ConversationManager();
        this.buttons = new ButtonHandler(this.whatsapp, this.orders, this.convManager, this.avisService);
    }

    async initialize() {
        await this.search.initialize();
        await this.nlp.initialize();
        log('info', '🚀 Bot MARIAM prêt');
    }

    extractEntities(entities) {
        const result = {};
        entities.forEach(e => {
            if (e.entity === 'medicine') result.medicine = e.sourceText;
            if (e.entity === 'quantity') result.quantity = parseInt(e.sourceText) || 1;
            if (e.entity === 'number') result.quantity = parseInt(e.sourceText) || 1;
            if (e.entity === 'quartier') result.quartier = e.sourceText;
        });
        return result;
    }

    async process(phone, text, mediaId = null) {
        // Afficher le message reçu
        console.log('\n' + '='.repeat(60));
        console.log(`📩 [${new Date().toLocaleTimeString()}] CLIENT → BOT (${phone})`);
        console.log(`📝 Message: "${text || (mediaId ? '[IMAGE]' : '')}"`);
        console.log('='.repeat(60));

        let conv = await this.convManager.get(phone);
        const context = { nom: conv.context?.client_nom || '' };

        // Message audio/vocal
        if (mediaId && mediaId.startsWith('audio')) {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(VALIDATION_ERRORS.AUDIO_ERROR));
            return;
        }

        // Image
        if (mediaId) {
            log('info', `📸 Image reçue de ${phone}`);
            await this.handleImage(phone, mediaId, conv);
            return;
        }

        // Traitement NLP
        const nlpResult = await this.nlp.process(text);
        const entities = this.extractEntities(nlpResult.entities || []);

        // Afficher état conversation
        console.log(`\n📊 ÉTAT: ${conv.state} | Panier: ${conv.cart?.length || 0} article(s)`);

        // PREMIÈRE INTERACTION
        if (conv.history.length === 0) {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.FIRST_INTERACTION));
            conv.history.push({ time: new Date(), text: 'première interaction' });
            await this.convManager.update(phone, { history: conv.history });
            return;
        }

        // GESTION DES ÉTATS
        if (conv.state === ConversationStates.IDLE) {
            if (nlpResult.intent === 'greet') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.GREETINGS, context.nom));
            }
            else if (nlpResult.intent === 'search_medicine' || nlpResult.intent === 'order_medicine') {
                const medicine = entities.medicine || text;
                const results = await this.search.search(medicine);
                
                if (results.length === 0) {
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(VALIDATION_ERRORS.MEDICINE_NOT_FOUND, medicine));
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(MESSAGES.MEDICINE_SELECTION, results));
                    conv.context.search_results = results;
                    conv.state = ConversationStates.SELECTING_MEDICINE;
                    await this.convManager.update(phone, conv);
                }
            }
            else if (nlpResult.intent === 'provide_quartier' || text.toLowerCase().includes('quartier')) {
                const quartier = entities.quartier || text;
                if (Utils.validateQuartier(quartier)) {
                    conv.context.client_quartier = quartier.trim();
                    conv.state = ConversationStates.WAITING_NAME;
                    await this.convManager.update(phone, conv);
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(MESSAGES.ASK_NAME, context.nom));
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(VALIDATION_ERRORS.QUARTIER));
                }
            }
            else if (nlpResult.intent === 'view_cart') {
                if (!conv.cart || conv.cart.length === 0) {
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(VALIDATION_ERRORS.CART_EMPTY));
                } else {
                    const subtotal = conv.cart.reduce((s, i) => s + (i.prix * i.quantite), 0);
                    const items = conv.cart.map(i => `• ${i.quantite}x ${i.nom_commercial}`).join('\n');
                    await this.whatsapp.sendMessage(phone, 
                        `🛒 *Ton panier*\n\n${items}\n\n💰 *Sous-total* : ${subtotal} FCFA`);
                }
            }
            else if (nlpResult.intent === 'help') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.HELP));
            }
            else if (nlpResult.intent === 'emergency') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.EMERGENCY));
            }
            else if (nlpResult.intent === 'thanks') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.THANKS));
            }
            else if (nlpResult.intent === 'goodbye') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.GOODBYE));
                await this.convManager.clear(phone);
            }
            else if (nlpResult.intent === 'ask_bot_creation') {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.CREATOR));
            }
            else {
                await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.ERROR));
            }
        }

        else if (conv.state === ConversationStates.SELECTING_MEDICINE) {
            const results = conv.context.search_results || [];
            const choice = Utils.extractNumber(text);
            
            if (choice && choice >= 1 && choice <= results.length) {
                conv.context.pending_med = results[choice - 1];
                conv.state = ConversationStates.WAITING_QUANTITY;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    `💊 *${conv.context.pending_med.nom_commercial}*\n💰 ${conv.context.pending_med.prix} FCFA\n\nCombien de boîtes ?`);
            } else {
                const meds = await this.search.search(text, 1);
                if (meds.length > 0) {
                    conv.context.pending_med = meds[0];
                    conv.state = ConversationStates.WAITING_QUANTITY;
                    await this.convManager.update(phone, conv);
                    await this.whatsapp.sendMessage(phone, 
                        `💊 *${meds[0].nom_commercial}*\n💰 ${meds[0].prix} FCFA\n\nCombien de boîtes ?`);
                } else {
                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(VALIDATION_ERRORS.CHOICE));
                }
            }
        }

        else if (conv.state === ConversationStates.WAITING_QUANTITY) {
            const qty = Utils.extractNumber(text);
            if (qty && qty > 0) {
                if (!conv.cart) conv.cart = [];
                conv.cart.push({ ...conv.context.pending_med, quantite: qty });
                
                const total = conv.context.pending_med.prix * qty;
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ADDED_TO_CART, qty, conv.context.pending_med.nom_commercial, total, context.nom));
                
                delete conv.context.pending_med;
                conv.state = ConversationStates.IDLE;
                await this.convManager.update(phone, conv);
                
                setTimeout(async () => {
                    await this.whatsapp.sendMessage(phone, 
                        "👉 Autre chose ? (ou tape 'commander' pour finaliser)");
                }, 1000);
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.QUANTITY));
            }
        }

        else if (conv.state === ConversationStates.WAITING_NAME) {
            if (Utils.validateName(text)) {
                conv.context.client_nom = text.trim();
                conv.state = ConversationStates.WAITING_AGE;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_AGE, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.NAME));
            }
        }

        else if (conv.state === ConversationStates.WAITING_AGE) {
            if (Utils.validateAge(text)) {
                conv.context.patient_age = parseInt(text);
                conv.state = ConversationStates.WAITING_GENDER;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_GENDER, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.AGE));
            }
        }

        else if (conv.state === ConversationStates.WAITING_GENDER) {
            if (Utils.validateGender(text)) {
                const g = text.trim().toUpperCase();
                conv.context.patient_genre = (g === 'M' || g === 'HOMME') ? 'M' : 'F';
                conv.state = ConversationStates.WAITING_WEIGHT;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_WEIGHT, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.GENDER));
            }
        }

        else if (conv.state === ConversationStates.WAITING_WEIGHT) {
            if (Utils.validateWeight(text)) {
                conv.context.patient_poids = parseFloat(text);
                conv.state = ConversationStates.WAITING_HEIGHT;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_HEIGHT, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.WEIGHT));
            }
        }

        else if (conv.state === ConversationStates.WAITING_HEIGHT) {
            if (Utils.validateHeight(text)) {
                conv.context.patient_taille = parseInt(text);
                conv.state = ConversationStates.WAITING_PHONE;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_PHONE, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.HEIGHT));
            }
        }

        else if (conv.state === ConversationStates.WAITING_PHONE) {
            const phoneValidation = Utils.validatePhone(text);
            if (phoneValidation.valid) {
                conv.context.client_telephone = phoneValidation.phone;
                conv.state = ConversationStates.WAITING_INDICATIONS;
                await this.convManager.update(phone, conv);
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(MESSAGES.ASK_INDICATIONS, context.nom));
            } else {
                await this.whatsapp.sendMessage(phone, 
                    Utils.randomMessage(VALIDATION_ERRORS.PHONE));
            }
        }

        else if (conv.state === ConversationStates.WAITING_INDICATIONS) {
            conv.context.client_indications = text.toLowerCase() === 'non' ? '' : text;
            
            // Calcul du total
            const subtotal = conv.cart.reduce((sum, i) => sum + (i.prix * i.quantite), 0);
            const delivery = Utils.getDeliveryPrice();
            const total = subtotal + delivery.price + DELIVERY_CONFIG.SERVICE_FEE;
            
            conv.state = ConversationStates.WAITING_CONFIRMATION;
            await this.convManager.update(phone, conv);
            
            const summary = Utils.randomMessage(MESSAGES.ORDER_SUMMARY, conv, total);
            await this.whatsapp.sendMessage(phone, summary);
            
            // Programmer les rappels
            await this.convManager.scheduleReminders(phone, context.nom);
        }

        else if (conv.state === ConversationStates.WAITING_CONFIRMATION) {
            if (text.toLowerCase() === 'oui') {
                try {
                    const order = await this.orders.createOrder({
                        client: {
                            nom: conv.context.client_nom,
                            telephone: conv.context.client_telephone || phone,
                            quartier: conv.context.client_quartier,
                            indications: conv.context.client_indications || '',
                            patient_age: conv.context.patient_age,
                            patient_genre: conv.context.patient_genre,
                            patient_poids: conv.context.patient_poids,
                            patient_taille: conv.context.patient_taille
                        },
                        items: conv.cart
                    }, phone);

                    await this.whatsapp.sendMessage(phone, 
                        Utils.randomMessage(MESSAGES.CONFIRM_ORDER, order, context.nom));

                    // Notification au support
                    const supportMsg = Utils.randomMessage(MESSAGES.SUPPORT_NOTIFICATION, order);
                    await this.whatsapp.sendInteractiveButtons(SUPPORT_PHONE, supportMsg, [
                        BUTTONS.VALIDATE_DELIVERY,
                        BUTTONS.CANCEL_ORDER
                    ]);

                    // Assigner livreur
                    const assignResult = await this.orders.assignLivreur(order.id);
                    if (!assignResult.success) {
                        await this.whatsapp.sendMessage(SUPPORT_PHONE, 
                            `⚠️ *AUCUN LIVREUR DISPONIBLE* pour la commande #${order.id}`);
                    }

                    await this.convManager.clear(phone);

                } catch (error) {
                    log('error', `❌ Erreur création commande:`, error);
                    await this.whatsapp.sendMessage(phone, Utils.randomMessage(VALIDATION_ERRORS.GENERAL));
                }
            } else if (text.toLowerCase() === 'non') {
                await this.whatsapp.sendMessage(phone, 
                    `✏️ D'accord, on modifie. Dis-moi ce que tu veux changer.`);
                conv.state = ConversationStates.IDLE;
                await this.convManager.update(phone, conv);
            } else {
                await this.whatsapp.sendMessage(phone, 
                    `❌ Réponds par "oui" pour confirmer ou "non" pour modifier.`);
            }
        }

        else if (conv.state === ConversationStates.WAITING_IMAGE_SELECTION) {
            if (text.toLowerCase() === 'aucun') {
                await this.whatsapp.sendMessage(phone, 
                    `❌ Commande annulée. Envoie une nouvelle image ou écris le nom.`);
                conv.state = ConversationStates.IDLE;
                delete conv.context.pending_image_options;
                await this.convManager.update(phone, conv);
                return;
            }
            
            if (text.toLowerCase() === 'tout') {
                for (const med of conv.context.pending_image_options) {
                    if (!conv.cart) conv.cart = [];
                    conv.cart.push({ ...med, quantite: 1 });
                }
                await this.whatsapp.sendMessage(phone, 
                    `✅ Tous les médicaments ajoutés ! Panier: ${conv.cart.length} article(s)`);
                conv.state = ConversationStates.IDLE;
                delete conv.context.pending_image_options;
                await this.convManager.update(phone, conv);
                return;
            }

            const choice = parseInt(text);
            if (choice && choice > 0 && choice <= conv.context.pending_image_options.length) {
                const selectedMed = conv.context.pending_image_options[choice - 1];
                if (!conv.cart) conv.cart = [];
                conv.cart.push({ ...selectedMed, quantite: 1 });
                await this.whatsapp.sendMessage(phone, 
                    `✅ ${selectedMed.nom_commercial} ajouté !`);
                conv.state = ConversationStates.IDLE;
                delete conv.context.pending_image_options;
                await this.convManager.update(phone, conv);
            } else {
                await this.whatsapp.sendMessage(phone, 
                    `❌ Choix invalide. Réponds avec 1-${conv.context.pending_image_options.length} ou "tout"/"aucun".`);
            }
        }

        // Ajouter à l'historique
        conv.history.push({ text, intent: nlpResult.intent, time: new Date() });
        await this.convManager.update(phone, { history: conv.history });

        // Afficher la réponse envoyée
        console.log(`\n📤 [${new Date().toLocaleTimeString()}] BOT → CLIENT (${phone})`);
        console.log('='.repeat(60) + '\n');
    }

    async handleImage(phone, mediaId, conv) {
        const media = await this.whatsapp.downloadMedia(mediaId);
        if (!media.success) {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(VALIDATION_ERRORS.IMAGE_ERROR));
            return;
        }

        const visionResult = await this.vision.analyzeImage(media.buffer);
        if (!visionResult || visionResult.type === 'unknown') {
            await this.whatsapp.sendMessage(phone, Utils.randomMessage(VALIDATION_ERRORS.IMAGE_ERROR));
            return;
        }

        // Chercher les médicaments dans la base
        const medicines = [];
        for (const med of visionResult.medicines) {
            const results = await this.search.search(med.name, 1);
            if (results.length > 0) {
                medicines.push(results[0]);
            }
        }

        if (medicines.length === 0) {
            await this.whatsapp.sendMessage(phone, 
                `🔍 Aucun médicament détecté en stock. Essaie avec une autre photo.`);
            return;
        }

        await this.whatsapp.sendMessage(phone, Utils.randomMessage(MESSAGES.IMAGE_RESULTS, medicines));
        
        conv.context.pending_image_options = medicines;
        conv.state = ConversationStates.WAITING_IMAGE_SELECTION;
        await this.convManager.update(phone, conv);
    }
}

// ===========================================
// SERVER EXPRESS
// ===========================================
const app = express();
app.use(express.json({ limit: '5mb' }));

// Webhook verification
app.get('/webhook', (req, res) => {
    if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
        log('info', '✅ Webhook vérifié');
    } else {
        res.sendStatus(403);
        log('warn', '❌ Échec vérification webhook');
    }
});

// Webhook messages
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    try {
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const msg = changes?.value?.messages?.[0];
        
        if (!msg) return;

        const whatsapp = new WhatsAppService();
        await whatsapp.markAsRead(msg.id);

        const bot = new MariamBot();
        await bot.initialize();

        if (msg.type === 'text') {
            await bot.process(msg.from, msg.text.body);
        }
        else if (msg.type === 'image') {
            await bot.process(msg.from, null, msg.image.id);
        }
        else if (msg.type === 'audio' || msg.type === 'voice') {
            await bot.process(msg.from, null, 'audio');
        }
        else if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
            const buttonText = msg.interactive.button_reply.title;
            const orderId = msg.interactive.button_reply.id.split('_')[2];
            await bot.buttons.handle(msg.from, buttonText, orderId);
        }
        
    } catch (error) {
        log('error', '❌ Erreur webhook:', error);
    }
});

// Health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            bot: 'MARIAM'
        });
    } catch (error) {
        res.status(503).json({ status: 'unhealthy', error: error.message });
    }
});

// ===========================================
// DÉMARRAGE
// ===========================================
async function start() {
    try {
        // Vérifier les tables
        log('info', '🔍 Vérification base de données...');
        
        const bot = new MariamBot();
        await bot.initialize();

        app.listen(PORT, () => {
            log('info', `🚀 Serveur démarré sur le port ${PORT}`);
            console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 MARIAM BOT - PRODUCTION READY                        ║
║   📍 San Pedro, Côte d'Ivoire                             ║
║   📱 Port: ${PORT}                                         ║
║                                                           ║
║   ✅ 23 intentions NLP                                     ║
║   ✅ 100+ messages variés                                  ║
║   ✅ 51 messages d'erreur                                  ║
║   ✅ 6000+ médicaments                                     ║
║   ✅ Gestion commandes complète                            ║
║   ✅ Avis clients automatiques                             ║
║   ✅ Rappels intelligents                                  ║
║                                                           ║
║   👨‍💻 Créé par Youssef - UPSP (Licence 2, 2026)           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
            `);
        });
    } catch (error) {
        log('error', '❌ Erreur fatale:', error);
        process.exit(1);
    }
}

start();

// Gestion arrêt gracieux
process.on('SIGTERM', () => {
    log('info', '🛑 Arrêt du serveur...');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('info', '🛑 Arrêt du serveur...');
    process.exit(0);
});
