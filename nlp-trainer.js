// ============================================
// nlp-trainer.js - Entraîneur de modèle NLP avec node-nlp
// Version 2.0.0 - Pour MIA Assistant Santé Pillbox CI 🇨🇮
// Avec toutes les intentions pour gestion commandes et RDV
// ============================================

const { NlpManager } = require('node-nlp');
const fs = require('fs');
const path = require('path');
const { ConversationStates } = require('./conversation-states');

class NLPTrainer {
    constructor() {
        this.manager = new NlpManager({
            languages: ['fr'],
            forceNER: true,
            nlu: { 
                log: true,
                useNoneFeature: true // Active la détection des intentions "none"
            },
            ner: { 
                builtins: ['number', 'date', 'time', 'email', 'url', 'phone'],
                threshold: 0.85, // Augmenté pour réduire les faux positifs
                // Désactiver les entités trop génériques qui causent des problèmes
                disabled: ['boolean', 'dimension'] 
            },
            settings: {
                nlu: {
                    log: true,
                    noneLabels: ['nlu_fallback', 'inconnu'] // Labels considérés comme "none"
                }
            }
        });
        
        this.modelPath = path.join(__dirname, 'model.nlp');
        this.trainingData = [];
    }


    // ============================================
    // CHARGEMENT DES DONNÉES D'ENTRAÎNEMENT
    // ============================================
    loadTrainingData() {
        console.log('📚 Chargement des données d\'entraînement...');
  // ============================================
// INTENTION: SALUTATIONS (200 exemples avec abréviations)
// ============================================
const saluer = [
    // Formes standards (50)
    'bonjour', 'salut', 'hello', 'coucou', 'bonsoir', 'bonne nuit', 'bonjour MIA',
    'salut MIA', 'bonjour l\'assistant', 'salut la team', 'bonjour à tous',
    'bonsoir à vous', 'bonne après-midi', 'bonne journée', 'bonne soirée',
    'bien le bonjour', 'enchanté', 'ravi de te parler', 'content de te voir',
    'me voilà', 'me revoilà', 'je reviens', 'content de te retrouver',
    
    // Abréviations courantes CI (30)
    'bjr', 'bsr', 'bn', 'bjr MIA', 'bsr MIA', 'bn MIA', 'bjr à tous',
    'bsr la famille', 'bn les amis', 'bjr les gens', 'bsr la team',
    'wesh', 'wsh', 'wesh MIA', 'wsh MIA', 'yop', 'yop MIA',
    'cc', 'cc MIA', 'kikou', 'kikoo', 'Hey', 'hé',
    'ohé', 'ho', 'hé MIA', 'ho MIA', 'allô', 'allo MIA',
    
    // Expressions familières (40)
    'ça va ?', 'comment ça va ?', 'comment tu vas ?', 'ça roule ?',
    'bien ou bien ?', 'bien ou quoi ?', 'comment tu te sens ?',
    'la forme ?', 'tranquille ?', 'calme ?', 'paisible ?',
    'comment c\'est ?', 'comment ça se passe ?', 'quoi de neuf ?',
    'quoi de 9 ?', 'quoi d\'neuf ?', 'des nouvelles ?',
    'tu es là ?', 't\'es là MIA ?', 'MIA t\'es là ?',
    'tu m\'entends ?', 'tu captes ?', 'tu reçois ?',
    'en ligne ?', 'dispo ?', 't\'es dispo ?',
    
    // Formules de politesse (30)
    'salutations distinguées', 'mes respects', 'bien le bonjour chez vous',
    'bonjour l\'équipe', 'bonsoir la compagnie', 'bonne nuit à tous',
    'passez une bonne journée', 'passe une bonne soirée',
    'je vous salue', 'je te salue', 'salut à toi', 'salut à vous',
    'bonjour docteur', 'bonsoir pharmacien', 'bonjour infirmier',
    'bonjour professionnel de santé', 'salut le soignant',
    
    // Anglicismes et mix (30)
    'good morning', 'good evening', 'good night', 'good afternoon',
    'hi', 'hi MIA', 'hello there', 'hey there', 'hi everyone',
    'morning', 'evening', 'night', 'sup', 'wassup',
    'what\'s up', 'howdy', 'greetings', 'salutations',
    'hello world', 'hi buddy', 'hey friend', 'bonjour friend',
    
    // Expressions régionales (20)
    'mon vieux', 'ma vieille', 'mon frère',
    'ma sœur', 'frérot', 'soeurette', 'mon gars', 'ma fille',
    'mon fils', 'papa MIA', 'maman MIA', 'tonton', 'tata',
    'grand frère', 'grande sœur', 'le sage', 'la sage',
    
    // Contextes médicaux (10)
    'bonjour pour une consultation', 'salut j\'ai besoin d\'aide',
    'bonsoir c\'est pour une urgence', 'bonjour je suis malade',
    'salut j\'ai un problème', 'bonsoir je ne me sens pas bien',
    'bonjour docteur j\'ai besoin de vous', 'salut infirmier',
    'bonsoir pharmacien de garde', 'bonjour MIA santé'
];
saluer.forEach(phrase => this.manager.addDocument('fr', phrase, 'saluer'));

// ============================================
// INTENTION: REMERCIEMENTS (200 exemples avec abréviations)
// ============================================
const remercier = [
    // Formes standards (50)
    'merci', 'merci beaucoup', 'merci infiniment', 'merci mille fois',
    'je te remercie', 'je vous remercie', 'nous vous remercions',
    'un grand merci', 'tous mes remerciements', 'avec mes remerciements',
    'c\'est gentil', 'c\'est très gentil', 'c\'est aimable à vous',
    'c\'est vraiment gentil', 'c\'est super gentil', 'c\'est tellement gentil',
    'merci pour ton aide', 'merci pour votre aide', 'merci pour ta réponse',
    'merci pour votre réponse', 'merci pour les infos', 'merci pour l\'info',
    'merci pour ton temps', 'merci pour votre temps', 'merci pour ta patience',
    'merci pour votre patience', 'merci pour ton service', 'merci pour votre service',
    
    // Abréviations courantes (40)
    'thx', 'thx MIA', 'merci bcp', 'merci bcp MIA', 'merki', 'merki MIA',
    'mci', 'mci MIA', '10/10', 'top', 'parfait', 'impeccable',
    'nickel', 'nickel chrome', 'parfait merci', 'top merci',
    'ok merci', 'dac merci', 'd\'accord merci', 'entendu merci',
    'bien reçu merci', 'reçu 5/5', 'reçu merci', 'noté merci',
    'pris en compte merci', 'c\'est noté merci', 'parfaitement merci',
    'exactement merci', 'voilà merci', 'ça marche merci',
    
    // Formules appuyées (30)
    'merci du fond du cœur', 'merci du fond du coeur', 'merci de tout cœur',
    'merci de tout coeur', 'merci énormément', 'vraiment merci',
    'un énorme merci', 'mille mercis', 'milles mercis',
    'merci mille fois', 'encore merci', 'merci encore',
    'je ne sais pas comment te remercier', 'je ne sais pas comment vous remercier',
    'je tiens à te remercier', 'je tiens à vous remercier',
    'je t\'en suis reconnaissant', 'je vous en suis reconnaissant',
    'je t\'en suis très reconnaissant', 'je vous en suis très reconnaissant',
    'je suis touché par ton aide', 'je suis touché par votre aide',
    
    // Expressions religieuses (20)
    'Dieu te bénisse', 'Dieu vous bénisse', 'Que Dieu te bénisse',
    'Que Dieu vous bénisse', 'Bonne continuation', 'Bon courage',
    'Que Dieu te protège', 'Que Dieu vous protège', 'Merci mon Dieu',
    'Dieu merci', 'Grâce à Dieu', 'Merci Seigneur',
    'Inchallah', 'Machallah', 'Alhamdoulillah',
    'Allah te bénisse', 'Allah vous bénisse', 'Barakallah',
    
    // Remerciements spécifiques médicaux (30)
    'merci docteur', 'merci Dr', 'merci Professeur', 'merci Pr',
    'merci infirmier', 'merci infirmière', 'merci pharmacien',
    'merci à toute l\'équipe médicale', 'merci au personnel soignant',
    'merci pour les soins', 'merci pour les médicaments',
    'merci pour la consultation', 'merci pour le rendez-vous',
    'merci pour la prescription', 'merci pour l\'ordonnance',
    'merci pour le diagnostic', 'merci pour le conseil',
    'merci pour la livraison rapide', 'merci pour la rapidité',
    'merci pour le service', 'merci pour la qualité',
    'merci pour votre professionnalisme', 'merci pour votre compétence',
    'merci pour votre gentillesse', 'merci pour votre écoute',
    'merci pour votre disponibilité', 'merci pour votre accompagnement',
    'merci pour votre soutien', 'merci pour votre aide précieuse',
    
    // Remerciements informels (30)
    'chapeau', 'chapeau bas', 'bravo', 'félicitations',
    't’es un chef', 'vous êtes des chefs', 't’es le boss',
    'vous êtes les boss', 't’es top', 'vous êtes tops',
    't’es génial', 'vous êtes géniaux', 't’es super',
    'vous êtes supers', 't’es formidable', 'vous êtes formidables',
    't’es incroyable', 'vous êtes incroyables', 't’est le meilleur',
    'vous êtes les meilleurs', 't’es au top', 'vous êtes au top',
    'respect', 'respect MIA', 'grand respect', 'tout mon respect'
];
remercier.forEach(phrase => this.manager.addDocument('fr', phrase, 'remercier'));

// ============================================
// INTENTION: AU REVOIR (200 exemples avec abréviations)
// ============================================
const auRevoir = [
    // Formes standards (40)
    'au revoir', 'au revoir MIA', 'au revoir et merci',
    'je dois y aller', 'je dois partir', 'je dois vous laisser',
    'je te laisse', 'je vous laisse', 'je m\'en vais',
    'je quitte', 'je me casse', 'je file', 'je me sauve',
    'je dois filer', 'je dois me sauver', 'je suis pressé',
    'je repars', 'je te quitte', 'je vous quitte', 'je ferme',
    'je déconnecte', 'je me déconnecte', 'je coupe', 'je raccroche',
    
    // Abréviations et formes courtes (40)
    'bye', 'bye bye', 'byebye', 'B.B.', 'biz', 'bizz',
    'ciao', 'c', 'tchao', 'tchao bye', 'à plus', 'A+',
    'à+', 'a+', 'a plus tard', 'à plus tard', 'à tout',
    'à tt', 'à tte', 'à t', 'à tout', 'à toute',
    'à demain', 'à2m1', 'à 2main', 'à 2m', 'à dem',
    'à la prochaine', 'à la proch', 'à la pro', 'à la suivante',
    'à la revoyure', 'à un de ces quatre', 'à un de ces 4',
    
    // Expressions temporelles (30)
    'à bientôt', 'à très bientôt', 'à tout à l\'heure',
    'à toute à l\'heure', 'à tout de suite', 'à de suite',
    'à dans une heure', 'à dans deux heures', 'à dans la journée',
    'à ce soir', 'à cette nuit', 'à demain matin',
    'à demain après-midi', 'à demain soir', 'à après-demain',
    'à la semaine prochaine', 'au mois prochain', 'à l\'année prochaine',
    'à lundi', 'à mardi', 'à mercredi', 'à jeudi',
    'à vendredi', 'à samedi', 'à dimanche', 'à la prochaine fois',
    
    // Souhaits (30)
    'bonne journée', 'bonne journée à vous', 'bonne journée MIA',
    'bonne soirée', 'bonne soirée à vous', 'bonne soirée MIA',
    'bonne nuit', 'bonne nuit à vous', 'bonne nuit MIA',
    'passe une bonne journée', 'passez une bonne journée',
    'passe une bonne soirée', 'passez une bonne soirée',
    'passe une bonne nuit', 'passez une bonne nuit',
    'fais de beaux rêves', 'faites de beaux rêves',
    'bonne continuation', 'bonne chance', 'bon courage',
    'bon week-end', 'bon weekend', 'bonne fin de journée',
    'bonne fin de semaine', 'bonnes vacances', 'bon appétit',
    
    // Anglicismes (20)
    'goodbye', 'good bye', 'see you', 'see ya', 'see you later',
    'see you soon', 'take care', 'tchao', 'cheers', 'peace',
    'peace out', 'laters', 'later', 'catch you later',
    'gotta go', 'g2g', 'gtg', 'have a nice day',
    'have a good one', 'take it easy',
    
    // Expressions familières CI (20)
    'on se capte plus tard', 'on se capte', 'on se voit plus tard',
    'on se voit', 'on se reparle', 'on se recontacte',
    'on s\'appelle', 'on s\'écrit', 'on se dit à plus',
    'je te dis à plus', 'je vous dis à plus', 'je te dis à bientôt',
    'je vous dis à bientôt', 'allez salut', 'allez bye',
    'allez à plus', 'allez je me casse', 'allez je file',
    'allez bonne continuation', 'allez bon courage',
    
    // Contextes médicaux (20)
    'au revoir docteur', 'au revoir Dr', 'au revoir infirmier',
    'au revoir pharmacien', 'bonne continuation des soins',
    'bon rétablissement à vous', 'prompt rétablissement',
    'je reviens pour le suivi', 'je reviens pour les résultats',
    'je passe plus tard', 'je reviens tout à l\'heure',
    'je repasserai demain', 'je reviendrai la semaine prochaine',
    'à la prochaine consultation', 'au prochain rendez-vous',
    'au prochain RDV', 'au prochain RV',
    'à bientôt pour le suivi', 'à très vite pour les analyses',
    'je vous laisse avec les autres patients'
];
auRevoir.forEach(phrase => this.manager.addDocument('fr', phrase, 'au_revoir'));

// ============================================
// INTENTION: AIDE (200 exemples avec abréviations)
// ============================================
const aide = [
    // Demandes d'aide générales (40)
    'aide', 'help', 'SOS', 'à l\'aide', 'au secours',
    'j\'ai besoin d\'aide', 'besoin d\'aide', 'besoin d\'assistance',
    'je requiers de l\'aide', 'je sollicite votre aide',
    'peux-tu m\'aider', 'pouvez-vous m\'aider', 'est-ce que tu peux m\'aider',
    'est-ce que vous pouvez m\'aider', 'tu peux m\'aider stp',
    'vous pouvez m\'aider svp', 'aide moi', 'aidez-moi',
    'aide moi s\'il te plaît', 'aidez-moi s\'il vous plaît',
    'un peu d\'aide', 'un coup de main', 'coup de main',
    'besoin d\'un coup de main', 'j\'ai besoin d\'un coup de main',
    'je suis perdu aide-moi', 'je suis paumé aide-moi',
    
    // Questions sur les fonctionnalités (30)
    'que pouvez-vous faire', 'qu\'est-ce que tu sais faire',
    'quelles sont tes fonctionnalités', 'quels sont tes services',
    'ce que tu peux faire', 'ce que vous pouvez faire',
    'liste des commandes', 'liste des options', 'menu principal',
    'commandes disponibles', 'services disponibles',
    'à quoi tu sers', 'à quoi vous servez',
    'quelle est ta fonction', 'quelle est votre fonction',
    'en quoi pouvez-vous m\'aider', 'en quoi tu peux m\'aider',
    'dis-moi ce que tu peux faire', 'dites-moi ce que vous pouvez faire',
    'prépare-moi la liste', 'fais-moi la liste',
    
    // Abréviations (20)
    'help me', 'helpe-moi', 'au secours MIA', 'SOS MIA',
    'help svp', 'help stp', 'aide svp', 'aide stp',
    'AU SECOURS', 'SOS AMBULANCE', 'URGENT', 'URGENCE',
    'comment faire', 'cmt faire', 'comment ça marche',
    'cmt ça marche', 'mode d\'emploi', 'manuel', 'tuto',
    'guide', 'notice', 'documentation', 'doc',
    
    // Guide d'utilisation (30)
    'comment utiliser ce bot', 'comment utiliser MIA',
    'comment ça fonctionne', 'comment fonctionne l\'application',
    'comment fonctionne Pillbox', 'comment utiliser Pillbox',
    'guide d\'utilisation', 'mode d\'emploi', 'manuel d\'utilisation',
    'tutoriel', 'tutoriel pour débutant', 'guide pour débutant',
    'par où commencer', 'par quoi commencer', 'comment débuter',
    'premiers pas', 'comment démarrer', 'guide de démarrage',
    'instructions', 'consignes', 'procédure', 'processus',
    'étapes à suivre', 'marche à suivre', 'comment procéder',
    
    // Questions sur Pillbox (20)
    'c\'est quoi Pillbox', 'qu\'est-ce que Pillbox',
    'présentation de Pillbox', 'présentation du service',
    'Pillbox c\'est quoi', 'Pillbox explication',
    'à quoi sert Pillbox', 'Pillbox à quoi ça sert',
    'Pillbox présentation', 'parle-moi de Pillbox',
    'parlez-moi de Pillbox', 'dis-moi ce qu\'est Pillbox',
    'dites-moi ce qu\'est Pillbox', 'explique-moi Pillbox',
    'expliquez-moi Pillbox', 'Pillbox c\'est une pharmacie',
    
    // Demandes spécifiques (30)
    'comment chercher un médicament', 'comment trouver un médicament',
    'comment connaître le prix', 'comment voir les prix',
    'comment passer commande', 'comment acheter',
    'comment prendre rendez-vous', 'comment réserver un RDV',
    'comment suivre ma commande', 'comment tracker ma commande',
    'comment annuler une commande', 'comment modifier une commande',
    'comment voir mon panier', 'comment vider mon panier',
    'comment ajouter au panier', 'comment retirer du panier',
    'comment trouver une pharmacie de garde', 'pharmacie de garde comment',
    'comment trouver une clinique', 'comment trouver un médecin',
    'comment consulter un spécialiste', 'comment voir un docteur',
    'comment contacter le service client', 'comment avoir du support',
    
    // FAQ et assistance (30)
    'questions fréquentes', 'FAQ', 'foire aux questions',
    'questions courantes', 'problèmes fréquents',
    'besoin d\'information', 'besoin de renseignements',
    'j\'ai une question', 'j\'ai une interrogation',
    'je voudrais des informations', 'je voudrais des précisions',
    'je veux en savoir plus', 'j\'aimerais comprendre',
    'éclaircis-moi', 'éclairez-moi', 'renseigne-moi',
    'renseignez-moi', 'informe-moi', 'informez-moi',
    'explique-moi le fonctionnement', 'expliquez-moi le processus',
    'détaille-moi les étapes', 'détaillez-moi les étapes',
    'pas à pas', 'étape par étape', 'guide pas à pas'
];
aide.forEach(phrase => this.manager.addDocument('fr', phrase, 'aide'));

// ============================================
// INTENTION: QUESTION BOT (200 exemples avec abréviations)
// ============================================
const questionBot = [
    // Questions sur l'identité (30)
    'qui es-tu', 'qui êtes-vous', 'c\'est quoi MIA',
    'MIA c\'est quoi', 'tu es qui', 'vous êtes qui',
    'présente-toi', 'présentez-vous', 'parle-moi de toi',
    'parlez-moi de vous', 'dis-moi qui tu es', 'dites-moi qui vous êtes',
    'je veux savoir qui tu es', 'j\'aimerais te connaître',
    'fais-toi connaître', 'faites-vous connaître',
    'ton identité', 'votre identité', 'ta nature', 'votre nature',
    'quelle est ton identité', 'quelle est votre identité',
    'qui se cache derrière toi', 'qui se cache derrière vous',
    
    // Questions sur la nature (30)
    'tu es un robot', 'vous êtes un robot', 'tu es une IA',
    'vous êtes une IA', 'est-ce que tu es un humain',
    'est-ce que vous êtes humains', 'tu es humain ou robot',
    'vous êtes humains ou robots', 'tu es une machine',
    'vous êtes des machines', 'tu as une conscience',
    'vous avez une conscience', 'tu penses', 'vous pensez',
    'tu es intelligent', 'vous êtes intelligents',
    'est-ce que tu es intelligent', 'est-ce que vous êtes intelligents',
    'tu es artificiel', 'vous êtes artificiels',
    'tu es virtuel', 'vous êtes virtuels', 'tu existes vraiment',
    
    // Questions sur les créateurs (30)
    'qui t\'a créé', 'qui vous a créés', 'qui est ton créateur',
    'qui sont vos créateurs', 'qui est derrière toi',
    'qui est derrière vous', 'qui a développé MIA',
    'qui a programmé MIA', 'qui a conçu MIA',
    'les développeurs', 'les programmeurs', 'les créateurs',
    'l\'équipe de développement', 'la team de dév',
    'les fondateurs', 'les concepteurs', 'les designers',
    'qui sont les gens derrière', 'qui a eu cette idée',
    'c\'est qui le boss', 'c\'est qui le patron',
    
    // Abréviations et surnoms (20)
    't\'es qui', 'v\'s êtes qui', 'c\'est quoi ce bot',
    'c\'est quoi cette appli', 'kess t\'es', 'kess vous êtes',
    't\'es MIA', 'c\'est MIA', 'appelle-toi comment',
    'ton blaze', 'ton nom', 'ton pseudo', 'ton surnom',
    'comment tu t\'appelles en vrai', 'ton vrai nom',
    'MIA ça veut dire quoi', 'MIA signification',
    
    // Questions sur l'équipe étudiante (30)
    'vous êtes des étudiants', 'tu es un étudiant',
    'c\'est un projet étudiant', 'c\'est un projet d\'école',
    'c\'est un projet universitaire', 'c\'est pour vos études',
    'vous êtes de l\'université', 'vous êtes de quelle école',
    'vous êtes de San Pedro', 'vous êtes de l\'UPSP',
    'Université Polytechnique de San Pedro', 'UPSP c\'est ça',
    'Yousself et Delphin', 'Yousself c\'est qui',
    'Delphin c\'est qui', 'les deux étudiants',
    'Yousself et Delphin sont vos créateurs',
    'c\'est vous qui avez codé', 'vous avez tout fait seuls',
    'vous avez créé ça en 2026', 'projet de fin d\'études',
    'c\'est votre projet de classe', 'c\'est votre mémoire',
    
    // Questions sur la technologie (20)
    'comment tu fonctionnes', 'comment ça marche derrière',
    'quelle technologie utilises-tu', 'quel langage',
    'programmé en quoi', 'codé en quoi',
    'Node.js c\'est ça', 'JavaScript', 'NLP c\'est quoi',
    'traitement du langage naturel', 'machine learning',
    'intelligence artificielle', 'IA', 'comment tu comprends',
    'comment tu analyses', 'comment tu réponds',
    
    // Questions sur l'utilité (20)
    'à quoi tu sers vraiment', 'quelle est ta mission',
    'quel est ton but', 'pourquoi tu existes',
    'dans quel but as-tu été créé', 'objectif de MIA',
    'tu aides les malades', 'tu aides les patients',
    'tu es pour la santé', 'tu es médical',
    'assistant santé', 'bot médical', 'pharmacie en ligne',
    'tu remplaces le pharmacien', 'tu remplaces le docteur',
    
    // Questions diverses (20)
    'quel âge as-tu', 'ton âge', 'depuis quand tu existes',
    'tu es né quand', 'date de création',
    'tu es gratuit', 'c\'est payant', 'combien ça coûte',
    'tu es disponible 24h/24', 'tu travailles la nuit',
    'tu es toujours là', 'tu réponds toujours',
    'tu as des limites', 'tu peux tout faire',
    'tu fais les ordonnances', 'tu prescris des médicaments'
];
questionBot.forEach(phrase => this.manager.addDocument('fr', phrase, 'question_bot'));

// ============================================
// INTENTION: RECHERCHER MEDICAMENT (200 exemples avec abréviations)
// ============================================
const rechercherMedicament = [
    // Recherches générales (30)
    'je cherche un médicament', 'je recherche un médicament',
    'je veux un médicament', 'j\'ai besoin d\'un médicament',
    'vous avez des médicaments', 'est-ce que vous avez des médicaments',
    'vous vendez des médicaments', 'je voudrais des médicaments',
    'où trouver des médicaments', 'où puis-je trouver des médicaments',
    'disponibilité médicaments', 'stock médicaments',
    'ce que vous avez en stock', 'ce que vous vendez',
    'liste des médicaments', 'catalogue médicaments',
    'vos produits pharmaceutiques', 'votre pharmacie',
    'vous êtes pharmacien', 'vous vendez quoi',
    'vous avez quoi comme médicaments', 'qu\'avez-vous en stock',
    'montrez-moi vos médicaments', 'affichez vos produits',
    'inventaire médicaments', 'pharmacie Pillbox',
     "je cherche du doliprane",
    "je recherche du doliprane",
    "je suis à la recherche de doliprane",
    "doliprane je cherche",
    "c'est doliprane que je cherche",
    "je voudrais trouver du doliprane",
    "avez-vous amoxicilline",
    "est-ce que vous avez amoxicilline",
    "vous avez de l'amoxicilline",
    "vous disposez d'amoxicilline",
    "est-ce que l'amoxicilline est en stock",
    "amoxicilline disponible chez vous",
    "vous vendez amoxicilline",
    "est-ce que je peux trouver amoxicilline chez vous",
    "amoxicilline en vente",
    "vous avez reçu amoxicilline",
    "est-ce que votre pharmacie a amoxicilline",
    "amoxicilline dans votre stock",
    "vous avez amoxicilline en ce moment",
    "disponibilité amoxicilline dans votre officine",
    "est-ce que vous proposez amoxicilline",
    
    // Renforcer les autres phrases faibles
    "je veux du spasfon",
    "je voudrais du spasfon s'il vous plaît",
    "spasfon je cherche à acheter",
    "est-ce que le spasfon est disponible",
    "vous avez spasfon en stock",
    "flagyl est disponible maintenant",
    "est-ce que flagyl est en rayon",
    "flagyl vous en avez",
    "je cherche flagyl",
    "vous avez flagyl à vendre",
    "disponibilité flagyl",
    "le flagyl est dans votre pharmacie",
    "je veux acheter flagyl",
    "flagyl c'est pour quand",
    "flagyl en stock aujourd'hui",
    // Renforcer "avez-vous amoxicilline" (actuellement 63%)
    "est-ce que vous avez de l'amoxicilline",
    "vous avez de l'amoxicilline en stock",
    "avez-vous de l'amoxicilline disponible",
    "est-ce que l'amoxicilline est disponible chez vous",
    "vous vendez l'amoxicilline",
    "l'amoxicilline est en vente chez vous",
    
    // Renforcer "je veux du spasfon" (actuellement 54%)
    "je voudrais du spasfon",
    "j'aimerais avoir du spasfon",
    "je désire acheter du spasfon",
    "spasfon je veux m'en procurer",
    "je cherche à me procurer du spasfon",
    "pour avoir du spasfon",
    
    // Phrases ambiguës avec "est-ce que flagyl est disponible" (actuellement prix_medicament)
    "le flagyl est-il disponible",
    "est-ce que le flagyl est en stock",
    "flagyl disponibilité",
    "flagyl en stock maintenant",
    "vous avez du flagyl en ce moment",
    "le flagyl se trouve chez vous",
    // Abréviations médicaments (20)
    'doli dispo', 'doliprane dispo', 'doli en stock',
    'amox dispo', 'amoxicilline stock', 'augmentin dispo',
    'flagyl dispo', 'spasfon dispo', 'ventoline dispo',
    'smecta dispo', 'dafalgan dispo', 'efferalgan dispo',
    'ibu dispo', 'ibuprofène stock', 'para dispo',
    'paracétamol stock', 'nivaquine dispo', 'quinine stock',
    'artesunate dispo', 'ctm dispo', 'dexaméthasone dispo',
    
    // Recherches par nom spécifique (50)
    'doliprane', 'doliprane 500', 'doliprane 1000',
    'doliprane enfant', 'doliprane bébé', 'doliprane adulte',
    'amoxicilline', 'amoxicilline 500', 'amoxicilline 1g',
    'amoxicilline sirop', 'amoxicilline bébé', 'amoxicilline adulte',
    'paracétamol', 'paracétamol 500', 'paracétamol 1000',
    'paracétamol enfant', 'paracétamol bébé', 'efferalgan',
    'efferalgan 500', 'efferalgan enfant', 'dafalgan',
    'dafalgan 500', 'dafalgan 1000', 'ibuprofène',
    'ibuprofène 200', 'ibuprofène 400', 'advil',
    'advil 200', 'advil 400', 'nurofen',
    'nurofen enfant', 'nurofen bébé', 'flagyl',
    'flagyl 125', 'flagyl 250', 'flagyl 500',
    'augmentin', 'augmentin 500', 'augmentin 1g',
    'spasfon', 'spasfon 80', 'spasfon comprimé',
    'spasfon sirop', 'ventoline', 'ventoline spray',
    'ventoline inhalateur', 'smecta', 'smecta sachet',
    'smecta poudre', 'clamoxyl', 'clamoxyl 500',
    
    // Recherches par catégorie (30)
    'antibiotique', 'antibiotiques', 'antibiothérapie',
    'antipaludique', 'antipaludéens', 'traitement palu',
    'antalgique', 'antalgiques', 'antidouleur',
    'anti-inflammatoire', 'anti-inflammatoires', 'AINS',
    'antiviral', 'antiviraux', 'antifongique',
    'antifongiques', 'antihistaminique', 'antihistaminiques',
    'antidiabétique', 'antidiabétiques', 'antihypertenseur',
    'antihypertenseurs', 'hypotenseur', 'hypotenseurs',
    'anticoagulant', 'anticoagulants', 'fluidifiant sanguin',
    'antispasmodique', 'antispasmodiques', 'antidiarrhéique',
    
    // Recherches par symptôme/formes (30)
    'médicament pour la fièvre', 'contre la fièvre',
    'médicament pour la douleur', 'contre la douleur',
    'médicament pour la toux', 'sirop pour la toux',
    'médicament pour le rhume', 'traitement rhume',
    'médicament pour la grippe', 'traitement grippe',
    'médicament pour les maux de tête', 'contre la migraine',
    'médicament pour le paludisme', 'traitement palu',
    'médicament pour la tension', 'traitement hypertension',
    'médicament pour le diabète', 'traitement diabète',
    'médicament pour l\'estomac', 'traitement gastrite',
    'médicament pour les nausées', 'anti-vomitif',
    'médicament pour la diarrhée', 'traitement diarrhée',
    'médicament pour la constipation', 'laxatif',
    'médicament pour les allergies', 'antiallergique',
    'médicament pour l\'asthme', 'traitement asthme',
    
    // Recherches pour populations spécifiques (20)
    'médicament pour enfant', 'médicament pour bébé',
    'médicament nourrisson', 'médicament pédiatrique',
    'médicament pour femme enceinte', 'médicament grossesse',
    'médicament pour allaitement', 'médicament maman',
    'médicament pour personne âgée', 'médicament gériatrique',
    'médicament pour adulte', 'médicament homme',
    'médicament femme', 'médicament mixte',
    'médicament adolescent', 'médicament senior',
    'médicament nourrisson', 'médicament prématuré',
    
    // Recherches urgentes (20)
    'je cherche en urgence', 'besoin urgent médicament',
    'il me faut maintenant', 'c\'est pour tout de suite',
    'urgence médicamenteuse', 'besoin immédiat',
    'dispo maintenant', 'livraison urgente',
    'pharmacie ouverte maintenant', 'ouvert maintenant',
    'médicament de toute urgence', 'très très urgent',
    'cas urgent', 'situation urgente', 'c\'est pressé',
    'rapidement svp', 'vite svp', 'je suis malade maintenant'
];
rechercherMedicament.forEach(phrase => {
    // Ajout automatique des entités médicament quand détectées
    if (phrase.includes('doliprane') || phrase.includes('doli')) {
        this.manager.addDocument('fr', phrase, 'rechercher_medicament');
        this.manager.addNamedEntityText('medicament', 'doliprane', ['fr'], ['doliprane', 'doli', 'doliprane 500', 'doliprane 1000', 'doliprane enfant']);
    } else if (phrase.includes('amoxicilline') || phrase.includes('amox')) {
        this.manager.addDocument('fr', phrase, 'rechercher_medicament');
        this.manager.addNamedEntityText('medicament', 'amoxicilline', ['fr'], ['amoxicilline', 'amox', 'amoxicilline 500', 'amoxicilline 1g']);
    } else {
        this.manager.addDocument('fr', phrase, 'rechercher_medicament');
    }
});

// ============================================
// INTENTION: PRIX MEDICAMENT (200 exemples avec abréviations)
// ============================================
const prixMedicament = [
    // Demandes générales de prix (30)
    'c\'est combien', 'combien ça coûte', 'quel est le prix',
    'le prix c\'est combien', 'tarif', 'coût', 'montant',
    'à quel prix', 'combien pour', 'prix de', 'tarif de',
    'coût de', 'c\'est cher', 'combien', 'prix',
    'donne-moi le prix', 'indique-moi le prix', 'dis-moi le prix',
    'je veux connaître le prix', 'j\'aimerais savoir le prix',
    'est-ce que c\'est cher', 'c\'est abordable',
    'c\'est donné', 'c\'est coûteux', 'combien ça vaut',
    
    // Demandes pour médicaments spécifiques (50)
    'prix doliprane', 'doliprane combien', 'c\'est combien doliprane',
    'doliprane 500 prix', 'doliprane 1000 combien',
    'doliprane enfant tarif', 'doliprane bébé prix',
    'amoxicilline combien', 'prix amoxicilline', 'amoxicilline 500 prix',
    'amoxicilline 1g tarif', 'amoxicilline sirop combien',
    'paracétamol prix', 'paracétamol combien', 'efferalgan tarif',
    'efferalgan 500 prix', 'dafalgan combien', 'dafalgan 1000 prix',
    'ibuprofène combien', 'advil prix', 'nurofen tarif',
    'flagyl combien', 'flagyl 500 prix', 'augmentin tarif',
    'augmentin 1g combien', 'spasfon prix', 'spasfon 80 combien',
    'ventoline spray prix', 'ventoline combien', 'smecta tarif',
    'smecta sachet prix', 'clamoxyl combien', 'clamoxyl 500 prix',
    'nivaquine combien', 'quinine prix', 'artesunate tarif',
    'metformine combien', 'metformine 500 prix', 'amlodipine prix',
    'amlodipine 10 combien', 'lasilix tarif', 'lasilix 40 prix',
    
    // Abréviations (20)
    'doli c\'est combien', 'doli prix', 'doli tarif',
    'amox prix', 'amox combien', 'flag prix', 'flag tarif',
    'spas c\'est combien', 'vent prix', 'vent tarif',
    'smec combien', 'dafa prix', 'efferal prix',
    'ibu prix', 'ibu combien', 'para prix',
    'ctm prix', 'dex prix', 'pred prix',
    
    // Demandes avec conditionnement (30)
    'prix boîte doliprane', 'doliprane boîte prix',
    'amoxicilline boîte combien', 'boîte flagyl prix',
    'plaquette spasfon combien', 'tube ventoline prix',
    'sachet smecta combien', 'flacon sirop prix',
    'comprimé doliprane prix', 'gélule amoxicilline combien',
    'ampoule quinine prix', 'spray ventoline tarif',
    'injection dexaméthasone prix', 'perfusion combien',
    'suppositoire enfant prix', 'sirop bébé combien',
    'crème dermatologique prix', 'pommade tarif',
    'collyre combien', 'gouttes yeux prix',
    
    // Demandes comparatives (20)
    'c\'est moins cher où', 'meilleur prix', 'prix le plus bas',
    'promotion médicaments', 'réduction', 'soldé',
    'en promotion', 'en solde', 'prix discount',
    'prix cassé', 'moins cher', 'plus économique',
    'rapport qualité prix', 'bon marché', 'abordable',
    'compétitif', 'prix concurrentiel', 'tarif préférentiel',
    'prix groupe', 'prix de gros',
    
    // Demandes pour médicaments génériques (20)
    'générique doliprane prix', 'prix générique paracétamol',
    'générique amoxicilline combien', 'générique augmentin tarif',
    'équivalent flagyl prix', 'générique ibuprofène combien',
    'générique spasfon prix', 'générique ventoline tarif',
    'version générique prix', 'copie moins chère',
    'générique disponible', 'princeps ou générique',
    'différence de prix', 'écart de prix',
    
    // Demandes pour frais et suppléments (15)
    'prix avec ordonnance', 'prix sans ordonnance',
    'prix avec assurance', 'prix avec mutuelle',
    'prix avec CMU', 'prix avec police',
    'frais de livraison inclus', 'livraison comprise',
    'taxes comprises', 'TVA incluse',
    'prix hors taxes', 'HT', 'TTC',
    
    // Questions sur les variations (15)
    'prix fixe ou variable', 'prix selon pharmacie',
    'même prix partout', 'prix réglementé',
    'prix libre', 'prix encadré',
    'changement de prix', 'augmentation prix',
    'baisse de prix', 'prix stable',
    'prix récent', 'dernier prix', 'prix actuel',
    "c'est combien le flagyl",
    "c'est combien la boîte de doliprane",
    "c'est combien l'amoxicilline",
    "c'est combien le spasfon",
    "c'est combien la ventoline",
    "c'est combien l'ibuprofène",
    "c'est combien le paracétamol",
    "c'est combien l'augmentin",
    "c'est combien le smecta",
    "c'est combien le dafalgan",
    "c'est combien l'efferalgan",
    "c'est combien le clamoxyl",
    "c'est combien la nivaquine",
    "c'est combien la quinine",
    "c'est combien le métronidazole",
    
    // Formulations avec "prix de" (10)
    "le prix de l'augmentin c'est combien",
    "quel est le prix du doliprane",
    "le prix du flagyl s'il vous plaît",
    "vous pouvez me donner le prix de l'amoxicilline",
    "j'aimerais connaître le tarif du spasfon",
    "je veux savoir le prix de la ventoline",
    "donne-moi le prix de l'ibuprofène",
    "indiquez-moi le tarif du paracétamol",
    "je cherche le prix du smecta",
    "pour connaître le prix du dafalgan",
    
    // Formulations avec "coûte" (10)
    "combien coûte une boîte de doliprane",
    "ça coûte combien l'ibuprofène",
    "le doliprane ça coûte combien",
    "l'amoxicilline coûte cher",
    "est-ce que le flagyl coûte moins cher",
    "combien coûte le spasfon en pharmacie",
    "la ventoline coûte combien",
    "à combien coûte l'augmentin",
    "combien coûte le traitement avec smecta",
    "ça coûte cher le paracétamol",
      "ibuprofène c'est combien",
    "c'est combien l'ibuprofène",
    "l'ibuprofène ça coûte combien",
    "combien pour l'ibuprofène",
    "prix de l'ibuprofène s'il vous plaît",
    "le prix de l'ibuprofène c'est quoi",
    "je veux savoir le prix de l'ibuprofène",
    "tarif ibuprofène en pharmacie",
    "l'ibuprofène est à combien",
    "à combien est l'ibuprofène",
    "donne-moi le prix de l'ibuprofène",
    "indiquez-moi le tarif de l'ibuprofène",
    "combien coûte une boîte d'ibuprofène",
    "l'ibuprofène 400 c'est combien",
    "prix ibuprofène 200 mg",
    
    // Variantes pour autres médicaments faibles
    "c'est combien le métronidazole",
    "le métronidazole prix",
    "prix de la quinine",
    "la quinine c'est combien",
    "c'est combien le cotrimoxazole",
    "prix du bactrim",
    "le nivaquine tarif",
    "combien coûte la nivaquine",
    "prix de l'aspirine du matin",
    "l'aspirine c'est combien",
    "c'est combien le ginseng",
    "prix des vitamines",
    "combien la boîte de fer",
    "le zinc c'est combien",
    "prix du magnésium",
    // Questions directes (10)
    "augmentin prix",  // Renforcement
    "tarif spasfon",   // Renforcement
    "le tarif du flagyl",
    "prix du doliprane en pharmacie",
    "flagyl quel tarif",
    "amoxicilline prix en pharmacie",
    "spasfon tarif officine",
    "ventoline combien en ce moment",
    "ibuprofène prix actuel",
    "doliprane tarif promotion",
    
    // Questions indirectes (5)
    "je voudrais savoir le montant pour le doliprane",
    "pour le flagyl c'est à combien",
    "l'ibuprofène 400 c'est combien",
    "doliprane 1000 quel prix",
    "amoxicilline 500mg tarif"
];
prixMedicament.forEach(phrase => this.manager.addDocument('fr', phrase, 'prix_medicament'));

// ============================================
// INTENTION: PHARMACIE DE GARDE (200 exemples avec abréviations)
// ============================================
const pharmacieGarde = [
    // Demandes générales (30)
    'pharmacie de garde', 'garde pharmaceutique',
    'pharmacie de garde aujourd\'hui', 'garde du jour',
    'pharmacie de garde cette nuit', 'garde de nuit',
    'pharmacie de garde ce soir', 'garde ce soir',
    'pharmacie de garde maintenant', 'garde maintenant',
    'qui garde aujourd\'hui', 'qui garde cette nuit',
    'qui garde ce soir', 'pharmacie ouverte maintenant',
    'pharmacie ouverte 24h/24', 'pharmacie 24h',
    'pharmacie 24/24', 'pharma 24h',
    'pharmacie de nuit', 'pharmacie nocturne',
    'pharmacie de week-end', 'pharmacie dimanche',
    'pharmacie jour férié', 'pharmacie férié',
     "où trouver une pharmacie à yopougon",
    "pharmacie de garde à yopougon ce soir",
    "je cherche une pharmacie ouverte à yopougon",
    "y a-t-il une pharmacie de garde à yopougon",
    "pharmacie ouverte maintenant à yopougon",
    "où est la pharmacie de garde à yopougon",
    "pharmacie de nuit à yopougon",
    "pharmacie 24h/24 à yopougon",
    "quelle pharmacie garde à yopougon cette nuit",
    "adresse pharmacie de garde yopougon",
    
    // Formulations avec autres villes (5)
    "pharmacie de garde à bouaké",
    "où trouver une pharmacie à san-pedro",
    "pharmacie ouverte à korhogo",
    "pharmacie de garde à daloa",
    "pharmacie de nuit à man",
    
    // Questions indirectes (5)
    "pour trouver une pharmacie ouverte",
    "je voudrais connaître la pharmacie de garde",
    "c'est quelle pharmacie qui garde cette nuit",
    "qui assure la garde ce soir dans mon quartier",
    "la pharmacie la plus proche ouverte maintenant",
    // Abréviations (20)
    'pharma garde', 'phar garde', 'ph garde',
    'PG', 'pharma de garde', 'garde pharma',
    'qui garde', 'QG', 'q garde',
    'ph ouvert', 'pharma ouvert', 'phar ouvert',
    '24h/24', '24/24', '24/7',
    'pharma nuit', 'phar nuit', 'ph nuit',
    
    // Par communes Abidjan (40)
    'pharmacie garde cocody', 'pharmacie garde marcory',
    'pharmacie garde yopougon', 'pharmacie garde plateau',
    'pharmacie garde treichville', 'pharmacie garde koumassi',
    'pharmacie garde abobo', 'pharmacie garde adjame',
    'pharmacie garde port-bouet', 'pharmacie garde bingerville',
    'pharmacie garde anyama', 'pharmacie garde songon',
    'garde à cocody', 'garde à marcory',
    'garde à yopougon', 'garde au plateau',
    'garde à treichville', 'garde à koumassi',
    'garde à abobo', 'garde à adjame',
    'garde à port-bouet', 'garde à bingerville',
    'cocody qui garde', 'marcory qui garde',
    'yopougon qui garde', 'plateau qui garde',
    'treichville qui garde', 'koumassi qui garde',
    'abobo qui garde', 'adjame qui garde',
    
    // Par quartiers Abidjan (30)
    'pharmacie garde deux plateaux', 'pharmacie garde riviera',
    'pharmacie garde palmeraie', 'pharmacie garde angré',
    'pharmacie garde williamsville', 'pharmacie garde belleville',
    'pharmacie garde vridi', 'pharmacie garde zonago',
    'pharmacie garde blocauss', 'pharmacie garde Niangon',
    'garde deux plateaux', 'garde riviera',
    'garde palmeraie', 'garde angré',
    'garde williamsville', 'garde belleville',
    'garde vridi', 'garde zonago',
    'qui garde à deux plateaux', 'qui garde à riviera',
    'qui garde à palmeraie', 'qui garde à angré',
    
    // Par villes de l'intérieur (30)
    'pharmacie garde bouaké', 'pharmacie garde korhogo',
    'pharmacie garde san-pedro', 'pharmacie garde yamoussoukro',
    'pharmacie garde daloa', 'pharmacie garde man',
    'pharmacie garde gagnoa', 'pharmacie garde odienné',
    'pharmacie garde bondoukou', 'pharmacie garde abengourou',
    'garde à bouaké', 'garde à korhogo',
    'garde à san-pedro', 'garde à yamoussoukro',
    'garde à daloa', 'garde à man',
    'garde à gagnoa', 'garde à odienné',
    'bouaké qui garde', 'korhogo qui garde',
    'san-pedro qui garde', 'yamoussoukro qui garde',
    'pharmacie de garde bouaké', 'pharma garde korhogo',
    
    // Par périodes (30)
    'pharmacie garde lundi', 'pharmacie garde mardi',
    'pharmacie garde mercredi', 'pharmacie garde jeudi',
    'pharmacie garde vendredi', 'pharmacie garde samedi',
    'pharmacie garde dimanche', 'garde lundi',
    'garde mardi', 'garde mercredi',
    'garde jeudi', 'garde vendredi',
    'garde samedi', 'garde dimanche',
    'pharmacie garde Noël', 'pharmacie garde Nouvel An',
    'pharmacie garde Pâques', 'pharmacie garde Tabaski',
    'pharmacie garde Ramadan', 'pharmacie garde Korité',
    'garde jour férié', 'garde fête nationale',
    'garde 1er mai', 'garde 15 août',
    
    // Urgences (20)
    'besoin pharmacie urgente', 'pharmacie d\'urgence',
    'urgence pharmaceutique', 'besoin médicaments urgence',
    'pharmacie ouverte urgence', 'pharmacie nuit urgence',
    'garde de nuit urgence', 'urgence cette nuit',
    'urgence maintenant', 'urgence absolue',
    'cas urgent pharmacie', 'pharmacie pour urgence',
    'où aller en urgence', 'pharmacie proche urgence',
    'plus proche pharmacie', 'pharmacie à côté urgence',
    'à côté de moi urgence', 'près de chez moi urgence',
    
    // Proximité (20)
    'pharmacie proche de moi', 'pharmacie près de chez moi',
    'pharmacie à côté de moi', 'pharmacie dans ma zone',
    'pharma proche', 'phar proche', 'ph proche',
    'pharmacie dans mon quartier', 'pharmacie pas loin',
    'pharmacie à proximité', 'pharmacie autour de moi',
    'où se trouve la pharmacie', 'adresse pharmacie',
    'pharmacie la plus proche', 'pharmacie plus proche',
    'pharmacie à 5 minutes', 'pharmacie à côté',
    'pharmacie voisine', 'pharmacie du coin'
];
pharmacieGarde.forEach(phrase => {
    if (phrase.includes('cocody') || phrase.includes('deux plateaux') || phrase.includes('riviera')) {
        this.manager.addDocument('fr', phrase, 'pharmacie_garde');
        this.manager.addNamedEntityText('localite', 'cocody', ['fr'], ['cocody', 'cocody-ango', 'deux plateaux', 'riviera']);
    } else {
        this.manager.addDocument('fr', phrase, 'pharmacie_garde');
    }
});

// ============================================
// INTENTION: COMMANDER (200 exemples avec abréviations)
// ============================================
const commander = [
    // Intentions d'achat générales (30)
    'je veux commander', 'je souhaite commander',
    'je voudrais commander', 'j\'aimerais commander',
    'je veux acheter', 'je souhaite acheter',
    'je voudrais acheter', 'j\'aimerais acheter',
    'passer commande', 'faire une commande',
    'effectuer une commande', 'réaliser un achat',
    'je prends', 'je veux prendre',
    'je vais prendre', 'je compte prendre',
    'je désire acheter', 'je désire commander',
    'je suis intéressé par', 'ça m\'intéresse',
    'je me procure', 'je me fournis',
    'acquisition médicaments', 'achat médicaments',
       "je souhaite commander du doliprane",
         "je veux acheter des médicaments",
    "j'aimerais acheter des médicaments",
    "je souhaite faire l'achat de médicaments",
    "procéder à l'achat de médicaments",
    "effectuer un achat de médicaments",
    "réaliser un achat de produits pharmaceutiques",
    "je souhaite commander doliprane",
    "je veux commander du doliprane",
    "j'aimerais commander doliprane",
    "je voudrais passer commande pour doliprane",
    "commander doliprane en ligne",
    "est-ce que je peux commander doliprane",
    "je désire commander doliprane",
    "pour commander doliprane",
    "commande de doliprane à passer",
    "je cherche à commander doliprane",
    "doliprane commande maintenant",
    "faire une commande de doliprane",
    "passer une commande pour doliprane",
    "commander du doliprane s'il vous plaît",
    "je souhaite acheter doliprane",
    
    // Renforcer "acheter des médicaments"
    "acheter des médicaments",
    "je veux acheter des médicaments en ligne",
    "achat de médicaments en ligne",
    "faire l'achat de médicaments",
    "procéder à l'achat de médicaments",
    "effectuer des achats de médicaments",
    "se procurer des médicaments",
    "acquisition de médicaments",
    "je cherche à acheter des médicaments",
    "pour l'achat de médicaments",
    "médicaments à acheter",
    "commande groupée de médicaments",
    "passer commande pour plusieurs médicaments",
    "je souhaite me procurer des médicaments",
    "besoin d'acheter des médicaments",
    // Renforcer "je souhaite commander doliprane" (actuellement 68%)
    "je souhaite passer commande pour du doliprane",
    "je voudrais commander du doliprane s'il vous plaît",
    "j'aimerais commander du doliprane",
    "c'est pour une commande de doliprane",
    "commander doliprane c'est possible",
    "je désire commander du doliprane",
    "commander maintenant du doliprane",
    "je voudrais faire une commande de doliprane",
    "est-ce que je peux commander du doliprane",
    "je désire commander du flagyl",
    "j'aimerais commander de l'amoxicilline",
    "je veux commander du spasfon maintenant",
    "commander de la ventoline s'il vous plaît",
    "je cherche à commander de l'ibuprofène",
    "pour commander du paracétamol",
    "je suis intéressé par une commande de smecta",
    "je vais commander du dafalgan",
    "je compte commander de l'augmentin",
    "j'envisage de commander du clamoxyl",
    
    // Renforcer "passer commande maintenant" (10)
    "je veux passer commande tout de suite",
    "commander immédiatement",
    "je passe commande maintenant",
    "nouvelle commande de médicaments",
    "je désire commander des médicaments",
    "passer une commande en urgence",
    "commander sans attendre",
    "je fais ma commande maintenant",
    "c'est pour commander tout de suite",
    "commande express maintenant",
    
    // Avec noms spécifiques (10)
    "je veux commander du flagyl",
    "commander de l'amoxicilline",
    "pour commander du spasfon",
    "je cherche à commander de la ventoline",
    "commande de paracétamol",
    "commander du smecta enfant",
    "je veux commander de l'ibuprofène 400",
    "commander du doliprane 1000",
    "je souhaite commander de l'augmentin",
    "commander du métronidazole",
    
    // Formulations avec quantité (5)
    "je veux commander 2 boîtes de doliprane",
    "commander 3 amoxicilline",
    "je souhaite commander 4 spasfon",
    "passer commande pour 5 ventoline",
    "je voudrais commander 6 flagyl",
    
    // Avec abréviations (20)
    'cmd', 'commande', 'commander', 'achat',
    'je veux cmd', 'je veux commander', 'je cmd',
    'j\'achète', 'j\'acquiers', 'j\'prends',
    'je prend', 'je pran', 'je veux pran',
    'achat maintenant', 'commande maintenant',
    'passer cmd', 'faire cmd', 'nouvelle cmd',
    
    // Avec médicaments spécifiques (40)
    'commander doliprane', 'acheter doliprane',
    'prendre doliprane', 'doliprane commande',
    'commander amoxicilline', 'acheter amoxicilline',
    'prendre amoxicilline', 'amoxicilline commande',
    'commander paracétamol', 'acheter paracétamol',
    'prendre paracétamol', 'paracétamol commande',
    'commander ibuprofène', 'acheter ibuprofène',
    'prendre ibuprofène', 'ibuprofène commande',
    'commander flagyl', 'acheter flagyl',
    'prendre flagyl', 'flagyl commande',
    'commander augmentin', 'acheter augmentin',
    'prendre augmentin', 'augmentin commande',
    'commander spasfon', 'acheter spasfon',
    'prendre spasfon', 'spasfon commande',
    'commander ventoline', 'acheter ventoline',
    'prendre ventoline', 'ventoline commande',
    'commander smecta', 'acheter smecta',
    'prendre smecta', 'smecta commande',
    
    // Avec quantités (30)
    'commander 2 doliprane', 'acheter 3 amoxicilline',
    'prendre 4 flagyl', 'je veux 2 boîtes',
    'je prends 3 boîtes', 'donnez-moi 5',
    'il me faut 2', 'j\'ai besoin de 3',
    'c\'est pour 1 boîte', 'c\'est pour 2 plaquettes',
    '1 boîte doliprane', '2 boîtes amoxicilline',
    '3 boîtes flagyl', '4 boîtes spasfon',
    '5 boîtes ventoline', '6 boîtes smecta',
    '2 doliprane 500', '3 amoxicilline 1g',
    '4 ibuprofène 400', '5 flagyl 500',
    'une boîte', 'deux boîtes', 'trois boîtes',
    'quelques boîtes', 'plusieurs boîtes',
    
    // Commandes multiples (20)
    'je veux doliprane et amoxicilline',
    'commander doliprane et flagyl',
    'prendre spasfon et ventoline',
    'doliprane et paracétamol commande',
    'amoxicilline et augmentin',
    'flagyl et augmentin ensemble',
    'commande groupée', 'commande multiple',
    'plusieurs médicaments', 'liste médicaments',
    'doliprane + amoxicilline', 'flagyl + spasfon',
    'ventoline + smecta', 'ibuprofène + paracétamol',
    'commande combo', 'pack médicaments',
    
    // Urgences et rapidité (20)
    'commander en urgence', 'achat urgent',
    'besoin immédiat', 'commande rapide',
    'livraison urgente', 'commande express',
    'vite commandé', 'rapidement svp',
    'c\'est pressé', 'urgence commande',
    'commander maintenant', 'achat maintenant',
    'tout de suite', 'immédiatement',
    'dès que possible', 'le plus vite possible',
    'au plus vite', 'rapidement',
    
    // Pour populations spécifiques (20)
    'commander pour bébé', 'achat pour enfant',
    'médicaments pour enfant', 'pour nourrisson',
    'pour femme enceinte', 'pour grossesse',
    'pour allaitement', 'pour maman',
    'pour personne âgée', 'pour senior',
    'pour mon père', 'pour ma mère',
    'pour mon fils', 'pour ma fille',
    'pour mon mari', 'pour ma femme',
    'pour moi-même', 'pour mon usage',
    
    // Sans ordonnance (10)
    'commander sans ordonnance', 'achat libre',
    'médicaments sans ordonnance', 'vente libre',
    'en vente libre', 'sans prescription',
    'automédication', 'pour moi-même',
    
    // Avec ordonnance (10)
    'commander avec ordonnance', 'sur prescription',
    'avec ordonnance', 'ordonnance médicale',
    'prescription docteur', 'prescrit par médecin',
    'suivant ordonnance', 'selon prescription'
];
commander.forEach(phrase => this.manager.addDocument('fr', phrase, 'commander'));

// ============================================
// INTENTION: MODIFIER COMMANDE (200 exemples avec abréviations)
// ============================================
const modifierCommande = [
    // Modifications générales (30)
    'modifier ma commande', 'changer ma commande',
    'je veux modifier ma commande', 'je souhaite modifier',
    'je voudrais modifier', 'j\'aimerais modifier',
    'apporter des modifications', 'faire un changement',
    'changement sur ma commande', 'modification commande',
    'ajuster ma commande', 'réviser ma commande',
    'corriger ma commande', 'rectifier ma commande',
    'mettre à jour commande', 'update commande',
    'changer des trucs', 'modifier des choses',
    'je change d\'avis', 'finalement je veux changer',
    
    // Avec abréviations (20)
    'modif cmd', 'modif commande', 'modifier cmd',
    'changer cmd', 'chgt commande', 'chgt cmd',
    'update cmd', 'updater commande', 'edit cmd',
    'édition commande', 'correction cmd',
    'rectif commande', 'rectif cmd', 'ajust cmd',
    'révision cmd', 'révision commande',
    
    // Par numéro de commande (30)
    'modifier commande CMD202402150001',
    'changer commande CMD202402150001',
    'modif cmd CMD202402150001',
    'pour la commande CMD202402150001',
    'commande CMD202402150001 à modifier',
    'CMD202402150001 modification',
    'modifier ma commande 12345',
    'changer commande 12345',
    'commande 6789 à modifier',
    'pour ma commande numéro 123',
    'ma commande du 15 février',
    'commande du jour à modifier',
    'dernière commande à changer',
    'ma dernière commande modification',
    'commande en cours modification',
    
    // Ajout d'articles (20)
    'ajouter un article', 'ajouter un produit',
    'ajouter doliprane à ma commande',
    'ajouter amoxicilline', 'ajouter flagyl',
    'rajouter spasfon', 'rajouter ventoline',
    'supplément doliprane', 'en plus',
    'ajouter 2 doliprane', 'rajouter 3 amox',
    'je veux ajouter', 'je souhaite ajouter',
    'j\'aimerais ajouter', 'je voudrais ajouter',
    'ajouter en supplément', 'mettre en plus',
    'avec ça je veux aussi', 'et aussi ajouter',
    
    // Suppression d'articles (20)
    'enlever un article', 'supprimer un produit',
    'retirer doliprane', 'enlever amoxicilline',
    'supprimer flagyl', 'retirer spasfon',
    'je ne veux plus de', 'finalement sans',
    'sans doliprane', 'enlever le doliprane',
    'retirer de ma commande', 'ôter de ma commande',
    'supprimer de ma commande', 'virer de ma commande',
    'annuler cet article', 'ne pas prendre ça',
    'enlever ça', 'retirer ça', 'supprimer ça',
    
    // Modification quantité (30)
    'modifier quantité', 'changer quantité',
    'changer la quantité', 'modifier le nombre',
    '2 au lieu de 1', '3 au lieu de 2',
    '4 au lieu de 3', '5 au lieu de 4',
    'doubler la quantité', 'mettre en double',
    'augmenter quantité', 'réduire quantité',
    'diminuer quantité', 'plus de doliprane',
    'moins de flagyl', 'plus de boîtes',
    'moins de boîtes', 'augmenter à 3',
    'réduire à 1', 'passer de 2 à 4',
    'au début c\'était 1 maintenant 3',
    'je voulais 2 finalement 5',
    
    // Modification adresse (20)
    'changer adresse livraison', 'modifier adresse',
    'changer lieu livraison', 'modifier lieu',
    'changer quartier', 'modifier quartier',
    'autre adresse', 'adresse différente',
    'livrer ailleurs', 'destination différente',
    'changer pour cocody', 'modifier pour marcory',
    'au lieu de yopougon', 'pas à abobo mais à',
    'changer le destinataire', 'autre personne',
    'pour quelqu\'un d\'autre', 'changer nom',
    
    // Modification téléphone (15)
    'changer numéro téléphone', 'modifier téléphone',
    'autre numéro', 'nouveau numéro',
    'numéro différent', 'changer contact',
    'modifier contact', 'mettre à jour téléphone',
    'corriger numéro', 'rectifier téléphone',
    'mon numéro c\'est 0701406880',
    'appelez-moi au 0701406880',
    'joignable au 0505050505',
    
    // Modification mode paiement (15)
    'changer mode paiement', 'modifier paiement',
    'autre moyen de paiement', 'payer autrement',
    'orange money au lieu de wave',
    'wave au lieu de carte',
    'espèces finalement', 'paiement livraison',
    'changer pour Orange Money',
    'modifier pour Wave', 'changer pour Mobile Money',
    'autre méthode de paiement',
    
    // Instructions spéciales (20)
    'ajouter instruction', 'ajouter note',
    'précision livraison', 'instruction livreur',
    'note pour livreur', 'message livreur',
    'sonner avant de livrer', 'appeler avant',
    'code entrée 1234', 'code porte',
    'bâtiment B étage 3', 'derrière la pharmacie',
    'à côté de l\'église', 'près du marché',
    'sonner fort', 'frapper fort',
    'ne pas sonner', 'appeler directement'
];
modifierCommande.forEach(phrase => {
    if (phrase.includes('CMD202402150001')) {
        this.manager.addDocument('fr', phrase, 'modifier_commande');
        this.manager.addNamedEntityText('commande_id', 'CMD202402150001', ['fr'], ['CMD202402150001']);
    } else {
        this.manager.addDocument('fr', phrase, 'modifier_commande');
    }
});

        // ============================================
        // INTENTION: ANNULER COMMANDE (50 exemples)
        // ============================================
    // ============================================
// INTENTION: ANNULER COMMANDE (200 exemples)
// ============================================
const annulerCommande = [
    // Formulations de base (50)
    'je veux annuler ma commande', 'annuler commande', 'je souhaite annuler ma commande',
    'annuler ma commande', 'je ne veux plus de ma commande', 'commander annulation',
    'annuler ma commande s\'il vous plaît', 'je veux annuler ma commande', 'annuler commande',
    'je souhaite annuler ma commande en cours', 'je change d\'avis, annulez ma commande',
    'finalement je ne veux plus commander', 'annulez tout', 'je veux annuler ma commande de médicaments',
    'annuler ma commande de doliprane', 'je ne veux plus des médicaments commandés',
    'comment annuler une commande', 'procédure d\'annulation de commande',
    'puis-je annuler ma commande', 'est-ce que je peux annuler ma commande',
    'annulation commande possible', 'délai d\'annulation', 'je veux annuler ma commande avant livraison',
    'annuler ma commande déjà passée', 'je veux annuler ma commande et être remboursé',
    'annuler commande et me faire rembourser', 'je ne veux plus de cette commande',
    'stoppez ma commande', 'arrêtez ma commande', 'annulez ma commande svp',
    'je voudrais annuler ma commande', 'est-il possible d\'annuler ma commande',
    'comment faire pour annuler', 'procédure pour annuler', 'annulation de commande en ligne',
    'annuler ma commande en cours de traitement', 'commande à annuler',
    'je souhaite annuler et être remboursé', 'remboursement après annulation',
    'annulation pour erreur de commande', 'j\'ai commandé par erreur',
    'c\'était une fausse commande', 'commande erronée à annuler',
    'je me suis trompé dans ma commande', 'commande incorrecte à annuler',
    'je veux annuler svp', 'annulez moi ça', 'supprimez ma commande',
    'je veux supprimer ma commande', 'retirez ma commande', 'enlevez ma commande',
    
    // Avec IDs de commande (30)
    'annuler ma commande CMD202402150001', 'annuler commande CMD202402150001',
    'pour la commande CMD202402150001, je veux annuler', 'annuler CMD202402150001',
    'ma commande CMD202402150001 à annuler', 'je veux annuler la 202402150001',
    'annuler la commande numéro 202402150001', 'CMD202402150001 annulation',
    'stoppez la CMD202402150001', 'annulez la 001', 'pour le numéro de commande 12345',
    'commande 6789 à annuler', 'référence 24680 à annuler', 'ma commande 13579',
    'le numéro 112233 à annuler', 'commande 445566 supprimer', 'annuler la 789012',
    'je veux annuler la commande 345678', 'référence commande 901234 annulation',
    'pour mon code 567890, annulation', 'commande 123456789', 'CMD123456 à annuler',
    'la commande du 15 mars à annuler', 'celle de hier soir à annuler',
    'ma commande de ce matin à annuler', 'la commande que j\'ai passée tout à l\'heure',
    'ma dernière commande', 'la commande que je viens de passer',
    
    // Formulations avec délai/raison (30)
    'je veux annuler parce que j\'ai trouvé moins cher ailleurs',
    'annuler commande car plus besoin', 'finalement j\'ai déjà ces médicaments',
    'j\'ai changé d\'avis', 'c\'était pour quelqu\'un d\'autre finalement',
    'le médecin a changé la prescription', 'nouvelle ordonnance', 
    'mon docteur a modifié le traitement', 'plus besoin du traitement',
    'je suis guéri maintenant', 'plus malade', 'ça va mieux',
    'trop cher pour moi', 'je n\'ai pas assez d\'argent',
    'problème de budget', 'délai trop long', 'livraison trop tard',
    'j\'ai trouvé dans une pharmacie près de chez moi',
    'pharmacie du coin en avait', 'disponible ailleurs',
    'je me suis dépanné ailleurs', 'j\'ai été à la pharmacie finalement',
    'mon voisin m\'a donné', 'un proche m\'en a donné',
    'je n\'ai plus besoin urgent', 'plus urgent finalement',
    'c\'était pour une urgence finalement résolue',
    'plus la peine', 'laissez tomber', 'oubliez ma commande',
    
    // Abréviations et langage SMS (30)
    'annul cmd', 'annule cmd', 'suppr cmd', 'sup cmd',
    'je veux annulé ma commande', 'annulé commande', 'annulé svp',
    'stp annul', 'svp annul', 'stp supprime', 'svp supprime',
    'annuler cmd 123', 'cmd 123 annul', 'ref 456 suppr',
    'pas besoin', '+ besoin', 'n\'veux plus', 'jveux plus',
    'jplus besoin', 'jveux annulé', 'annulé mon truc',
    'enlève ça', 'retire ça', 'vire ça', 'supprime ça',
    'annulé ma commande là', 'commande là annulé', 'mon truc là supprimer',
    'faut annuler', 'je dois annuler', 'obligé d\'annuler',
    'urgence annulation', 'annulation urgente',
    
    // Expressions locales/ivoiriennes (30)
    'je veux décommandé', 'décommander ma commande', 'décommandé',
    'fais-moi décommandé', 'décommande moi ça', 'annulé ça pour moi',
    'enlève moi ça', 'retire moi ça', 'supprime moi ça',
    'gomme moi ça', 'efface moi ça', 'ôte moi ça',
    'je veux gommé', 'je veux effacé', 'je veux ôté',
    'c\'est pas bon finalement', 'c\'est plus bon', 'ça va pas',
    'je me suis trompé walah', 'c\'était erreur', 'fausse manoeuvre',
    'j\'ai cliqué n\'importe comment', 'j\'ai fais boulette',
    'c\'est une boulette', 'petite erreur', 'je rectifie',
    'je corrige', 'je modifie en annulant', 'finalement non',
    'ah non finalement', 'euh finalement non', 'non non finalement',
    'finalement laisse', 'laisse tomber walah', 'annule tout',
    
    // Formulations polies/détaillées (30)
    'je vous prie de bien vouloir annuler ma commande',
    'je vous serais reconnaissant d\'annuler ma commande',
    'auriez-vous l\'amabilité d\'annuler ma commande',
    'pourriez-vous annuler ma commande s\'il vous plaît',
    'je sollicite l\'annulation de ma commande',
    'je fais une demande d\'annulation de commande',
    'je requiers l\'annulation de ma commande',
    'merci d\'annuler ma commande', 'veuillez annuler ma commande',
    'je souhaiterais que ma commande soit annulée',
    'je désire que ma commande soit supprimée',
    'j\'aimerais procéder à l\'annulation de ma commande',
    'je voudrais procéder à l\'annulation',
    'est-il envisageable d\'annuler ma commande',
    'serait-il possible d\'annuler ma commande',
    'dans quelle mesure puis-je annuler ma commande',
    'quelles sont les conditions d\'annulation',
    'comment se passe l\'annulation d\'une commande',
    'puis-je encore annuler ma commande',
    'est-ce trop tard pour annuler',
    'y a-t-il des frais d\'annulation',
    'l\'annulation est-elle gratuite',
    'combien coûte l\'annulation',
    'frais pour annuler commande',
    'est-ce remboursable si j\'annule',
    'remboursement après annulation comment',
    'annulation et remboursement',
    'je préfère annuler et être remboursé',
    'je veux annuler avec remboursement',
    'comment être remboursé après annulation'
];
        annulerCommande.forEach(phrase => {
            if (phrase.includes('CMD202402150001')) {
                this.manager.addDocument('fr', phrase, 'annuler_commande');
                this.manager.addNamedEntityText('commande_id', 'CMD202402150001', ['fr'], ['CMD202402150001']);
            } else {
                this.manager.addDocument('fr', phrase, 'annuler_commande');
            }
        });

        // ============================================
        // INTENTION: SUIVRE COMMANDE (50 exemples)
        // ============================================
    // ============================================
// INTENTION: SUIVRE COMMANDE (200 exemples)
// ============================================
const suivreCommande = [
    // Formulations de base (40)
    'suivre ma commande', 'où en est ma commande', 'statut de ma commande',
    'je veux suivre ma commande', 'suivi de commande', 'état de ma commande',
    'ma commande est-elle partie', 'quand vais-je recevoir ma commande',
    'suivi livraison', 'où est mon colis', 'ma commande est en route',
    'vérifier ma commande', 'contrôle commande', 'je veux savoir l\'état de ma commande',
    'ma commande est-elle confirmée', 'confirmation de commande',
    'quand ma commande sera-t-elle livrée', 'délai restant pour ma commande',
    'suivi en temps réel', 'je veux suivre mon livreur', 'où se trouve mon livreur',
    'le livreur arrive bientôt', 'suivi de livraison en direct', 'numéro de suivi',
    'tracking commande', 'track mon colis', 'suivi de colis',
    'état d\'avancement de ma commande', 'progression de ma commande',
    'ma commande est où maintenant', 'à quelle étape est ma commande',
    'commande en préparation', 'commande expédiée', 'commande livrée',
    'vérifier le statut', 'status de ma commande', 'ou en est la livraison',
    'le livreur est en route', 'combien de temps encore', 'temps restant',
    'est-ce que ma commande est partie', 'ma commande a-t-elle été confirmée',
    
    // Avec IDs de commande (30)
    'suivre commande CMD202402150001', 'statut commande CMD202402150001',
    'où en est la CMD202402150001', 'ma commande CMD202402150001 est en route',
    'suivi colis CMD202402150001', 'suivre commande CMD202402150001',
    'CMD202402150001 statut', 'suivi de la 202402150001',
    'ma commande numéro 12345', 'colis 67890 suivi',
    'référence 24680 où ça', 'pour le code 13579',
    'commande 112233 avancement', 'suivi colis 445566',
    'statut commande 789012', 'avancement 345678',
    'où est la commande 901234', 'ma commande 567890',
    'le numéro 123456789', 'CMD123456 progression',
    'celle avec la référence ABC123', 'commande DEF456 statut',
    'mon code de suivi', 'j\'ai mon numéro de suivi',
    'voici mon numéro de suivi', 'avec ce numéro de suivi',
    'suivi avec ce code', 'tracking number',
    'order tracking', 'shipment tracking',
    
    // Questions sur le délai (30)
    'quand est-ce que je vais recevoir', 'heure de livraison estimée',
    'livraison prévue à quelle heure', 'c\'est pour quand la livraison',
    'le livreur arrive quand', 'quelle heure pour la livraison',
    'délai restant', 'encore combien de temps', 'temps d\'attente',
    'combien de minutes encore', 'livraison dans combien de temps',
    'est-ce que c\'est pour bientôt', 'arrive bientôt', 'c\'est long',
    'pourquoi ça tarde', 'retard de livraison', 'commande en retard',
    'délai dépassé', 'c\'était sensé arriver', 'devait être livré',
    'retard sur la livraison', 'pourquoi ce retard', 'explication du retard',
    'est-ce normal ce délai', 'c\'est long d\'habitude', 'habituellement plus rapide',
    'livraison express finalement', 'pas si express', 'comment ça se fait',
    'délai anormal', 'trop long', 'je trouve ça long',
    
    // Questions sur la localisation (30)
    'où est le livreur maintenant', 'position du livreur',
    'le livreur est où', 'il est où mon colis', 'colis localisation',
    'mon colis est à quelle étape', 'le livreur a quel quartier',
    'il est dans quel coin', 'progression sur la carte',
    'carte de suivi', 'voir sur la carte', 'GPS du livreur',
    'localisation en direct', 'suivi GPS', 'position exacte',
    'il est où exactement', 'à combien de kilomètres', 'distance restante',
    'temps avant arrivée', 'ETA', 'estimated time',
    'le livreur a quitté où', 'point de départ', 'entrepôt',
    'magasin d\'origine', 'pharmacie d\'origine', 'point de retrait',
    'en cours de route', 'en chemin', 'sur la route',
    
    // Abréviations et langage SMS (30)
    'suivi cmd', 'suivi commande', 'état cmd', 'statut cmd',
    'où ça en est', 'ou ca en est', 'c\'est où mon truc',
    'mon colis où', 'colis où', 'livreur où', 'le livreur où',
    'suivi colis', 'suivi livraison', 'suivi livr',
    'track cmd', 'tracking cmd', 'track mon colis',
    'cmd 123 suivi', 'ref 456 suivi', 'num 789 suivi',
    'mon numéro de cmd', 'mon code là', 'ma référence là',
    'vérifier cmd', 'check cmd', 'check commande',
    'voir où ça en est', 'voir avancement', 'voir progression',
    'arrive quand', 'livraison quand', 'recu quand',
    'je reçois quand', 'j\'ai ma commande quand',
    
    // Expressions locales/ivoiriennes (30)
    'mon colis il est où', 'mon médicament il est où',
    'la commande là elle est où', 'mon truc là il est où',
    'le livreur il est où', 'gars-là il est où',
    'il arrive quand le gars', 'le coursier là il vient',
    'c\'est pour aujourd\'hui ou demain', 'c\'est aujourd\'hui ou bien',
    'on me livre aujourd\'hui hein', 'faut que ça vienne aujourd\'hui',
    'je veux savoir où ça en est', 'donne-moi des nouvelles',
    'quoi de neuf sur ma commande', 'quoi de nouveau',
    'des news sur ma commande', 'infos sur ma commande',
    'tu as des nouvelles', 'vous avez des infos',
    'dites-moi où ça en est', 'éclairez-moi', 'expliquez-moi',
    'je suis dans l\'attente', 'j\'attends toujours',
    'toujours pas reçu', 'pas encore livré',
    'ça vient de où', 'ça part d\'où', 'l\'origine du colis',
    
    // Formulations polies/détaillées (20)
    'je souhaiterais connaître l\'état de ma commande',
    'pourriez-vous me donner des nouvelles de ma commande',
    'auriez-vous des informations sur ma commande',
    'je voudrais suivre l\'évolution de ma commande',
    'je désire connaître le statut de ma livraison',
    'merci de me tenir informé de ma commande',
    'veuillez me communiquer l\'état de ma commande',
    'je requiers des informations sur ma commande',
    'je sollicite un suivi de ma commande',
    'dans quelle mesure puis-je suivre ma commande',
    'comment puis-je suivre ma commande en ligne',
    'existe-t-il un lien de suivi',
    'puis-je avoir un numéro de suivi',
    'comment accéder au suivi en temps réel',
    'le suivi est-il disponible',
    'y a-t-il une application pour suivre',
    'site pour suivre ma commande',
    'lien de tracking',
    'portail de suivi',
    'interface de suivi'
];
        suivreCommande.forEach(phrase => {
            if (phrase.includes('CMD202402150001')) {
                this.manager.addDocument('fr', phrase, 'suivre_commande');
                this.manager.addNamedEntityText('commande_id', 'CMD202402150001', ['fr'], ['CMD202402150001']);
            } else {
                this.manager.addDocument('fr', phrase, 'suivre_commande');
            }
        });

        // ============================================
        // INTENTION: PANIER (40 exemples)
        // ============================================
        // ============================================
// INTENTION: PANIER (200 exemples)
// ============================================
const panier = [
    // Formulations de base (40)
    'mon panier', 'voir mon panier', 'contenu de mon panier',
    'afficher panier', 'panier d\'achat', 'ce que j\'ai dans mon panier',
    'liste des articles dans mon panier', 'total panier',
    'montant de mon panier', 'vider mon panier', 'supprimer tout du panier',
    'panier vide', 'je veux voir ce que j\'ai ajouté',
    'mes articles sélectionnés', 'produits dans mon panier',
    'récapitulatif panier', 'combien j\'ai dans mon panier',
    'prix total panier', 'je veux vérifier mon panier avant commande',
    'vérification panier', 'modifier panier', 'voir le panier',
    'contenu du panier', 'liste des achats', 'récapitulatif des articles',
    'montant total', 'sous-total panier', 'frais de livraison dans panier',
    'articles dans le panier', 'produits ajoutés', 'ce que j\'ai choisi',
    'ma sélection', 'mes médicaments choisis', 'les articles que j\'ai pris',
    'visualiser mon panier', 'consulter mon panier', 'panier actuel',
    'état de mon panier', 'panier en cours', 'commande en préparation',
    
    // Actions sur le panier (40)
    'ajouter au panier', 'mettre dans le panier', 'ajouter cet article',
    'ajouter doliprane au panier', 'mettre amoxicilline dans panier',
    'ajouter ce médicament', 'je veux ajouter ça', 'rajouter',
    'ajouter un produit', 'ajouter un article', 'ajouter des médicaments',
    'enlever du panier', 'retirer du panier', 'supprimer du panier',
    'enlever doliprane', 'retirer amoxicilline', 'supprimer cet article',
    'je ne veux plus de ça dans mon panier', 'enlever ce produit',
    'retirer cet élément', 'supprimer cet item',
    'modifier quantités panier', 'changer les quantités',
    'augmenter quantité', 'diminuer quantité', 'mettre à jour panier',
    'mettre à jour les quantités', 'actualiser panier',
    'vider tout', 'supprimer tout', 'enlever tout',
    'panier vide', 'réinitialiser panier', 'recommencer à zéro',
    'nouveau panier', 'panier vierge', 'tout retirer',
    
    // Questions sur le contenu (30)
    'qu\'est-ce que j\'ai dans mon panier', 'c\'est quoi mon panier',
    'montre-moi mon panier', 'affiche mon panier', 'donne-moi mon panier',
    'quels produits j\'ai choisis', 'liste de mes choix',
    'y a quoi dans mon panier', 'contenu actuel',
    'panier contient quoi', 'ce qu\'il y a dedans',
    'détail panier', 'détail des articles', 'détail des produits',
    'récapitulatif détaillé', 'liste précise', 'inventaire panier',
    'combien d\'articles', 'nombre d\'articles', 'quantité totale d\'articles',
    'combien de produits', 'combien de médicaments',
    'est-ce que doliprane est dans mon panier', 'j\'ai mis doliprane',
    'amoxicilline est ajouté', 'vérifier si j\'ai mis ça',
    
    // Questions sur le prix (20)
    'total de mon panier', 'montant à payer', 'combien ça coûte en tout',
    'prix total avec livraison', 'total TTC', 'montant TTC',
    'sous-total', 'total HT', 'montant hors taxes',
    'frais inclus', 'avec les frais', 'tout compris',
    'combien je dois payer', 'somme à régler', 'addition',
    'facture panier', 'devis panier', 'estimation',
    
    // Abréviations et langage SMS (30)
    'mon panier', 'voir panier', 'affiche panier',
    'mon pannier', 'mon panyé', 'mon caddy',
    'mon caddie', 'mon chariot', 'mes achats',
    'mes articles', 'mes produits', 'mes médocs',
    'ce que j\'ai pris', 'mes choix', 'ma sélection',
    'total panier', 'total caddy', 'total à payer',
    'combien total', 'prix total', 'montant total',
    'ajouter au panier', 'mettre au panier', 'add au panier',
    'enlever du panier', 'retirer du panier', 'suppr du panier',
    'vider panier', 'clean panier', 'reset panier',
    
    // Expressions locales/ivoiriennes (30)
    'mon panier là', 'mon caddy là', 'mes affaires là',
    'ce que j\'ai choisi là', 'mes médicaments là',
    'tout ce que j\'ai pris', 'tout ce que j\'ai mis',
    'ça fait combien en tout', 'total là c\'est combien',
    'combien je dois', 'c\'est combien tout',
    'ajouter ça à mes affaires', 'mettre ça avec le reste',
    'enlever ça de mes affaires', 'retirer ça du lot',
    'je veux voir mon compte', 'montre-moi mon compte',
    'ma liste d\'achats', 'ma liste de courses',
    'ma commande en préparation', 'ce que je vais acheter',
    'mes provisions', 'mes stocks', 'ma réserve',
    'mes médicaments de secours', 'ma trousse à pharmacie',
    'mes produits de santé', 'mes soins',
    
    // Formulations polies/détaillées (10)
    'je souhaiterais consulter le contenu de mon panier',
    'pourriez-vous m\'afficher mon panier s\'il vous plaît',
    'j\'aimerais voir le récapitulatif de mes achats',
    'je désire vérifier les articles dans mon panier',
    'veuillez me montrer le détail de mon panier',
    'merci de m\'indiquer le contenu de mon panier',
    'je requiers la visualisation de mon panier',
    'je sollicite un récapitulatif de mon panier',
    'dans quelle mesure puis-je consulter mon panier',
    'comment accéder au détail de mon panier'
];
        panier.forEach(phrase => this.manager.addDocument('fr', phrase, 'panier'));

        // ============================================
        // INTENTION: QUANTITE (40 exemples)
        // ============================================
       // ============================================
// INTENTION: QUANTITE (200 exemples)
// ============================================
const quantite = [
    // Nombres simples avec médicaments (40)
    '1 doliprane', '2 amoxicilline', '3 ibuprofène', '4 flagyl',
    '5 spasfon', '6 ventoline', '7 smecta', '8 dafalgan',
    '9 efferalgan', '10 metformine', '11 amlodipine', '12 glucophage',
    '13 lasilix', '14 clamoxyl', '15 quinine', '16 nivaquine',
    '17 ginseng', '18 vitamine C', '19 aspirine', '20 héparine',
    '1 boîte', '2 boîtes', '3 boîtes', '4 boîtes',
    '1 comprimé', '2 comprimés', '3 comprimés', '4 comprimés',
    '1 sachet', '2 sachets', '3 sachets', '4 sachets',
    '1 flacon', '2 flacons', '3 flacons', '4 flacons',
    '1 tube', '2 tubes', '3 tubes', '4 tubes',
    
    // Expressions avec "je veux" (30)
    'je veux 2 doliprane', 'je prends 3 amoxicilline', 'je voudrais 4 ibuprofène',
    'j\'aimerais 5 flagyl', 'je souhaite 6 spasfon', 'donnez-moi 7 ventoline',
    'je veux 2 boîtes', 'je prends 3 boîtes', 'je voudrais 4 boîtes',
    'j\'aimerais 5 comprimés', 'je souhaite 6 sachets', 'donnez-moi 7 flacons',
    'je veux 2 de ça', 'je prends 3 de doliprane', 'je voudrais 4 de amox',
    'il m\'en faut 5', 'j\'en veux 6', 'j\'en prends 7',
    'je veux une boîte', 'je prends deux boîtes', 'je voudrais trois boîtes',
    'j\'aimerais quatre comprimés', 'je souhaite cinq sachets',
    
    // Quantités spécifiques (30)
    'une dizaine', 'une douzaine', 'une quinzaine', 'une vingtaine',
    'une trentaine', 'une quarantaine', 'une cinquantaine',
    'quelques-uns', 'plusieurs', 'un paquet', 'un lot',
    'en petite quantité', 'en grande quantité', 'en grosse quantité',
    'le minimum', 'le maximum', 'juste un peu', 'beaucoup',
    'une petite dose', 'une grosse dose', 'dose normale',
    'quantité standard', 'quantité habituelle', 'dose habituelle',
    'traitement complet', 'pour tout le traitement', 'pour la durée',
    'pour une semaine', 'pour 7 jours', 'pour 10 jours',
    
    // Questions sur quantité (20)
    'combien je peux prendre', 'quelle quantité maximum',
    'dose recommandée', 'posologie', 'combien par jour',
    'fréquence de prise', 'tous les combien', 'espacement',
    'matin midi soir', '3 fois par jour', '2 fois par jour',
    '1 fois par jour', '4 fois par jour', 'toutes les 6 heures',
    'toutes les 8 heures', 'toutes les 12 heures', 'toutes les 4 heures',
    'avant les repas', 'après les repas', 'pendant les repas',
    
    // Fractions et approximations (20)
    'un demi', 'la moitié', 'demi-comprimé', 'un quart',
    'trois quarts', 'un et demi', 'deux et demi', 'moitié-moitié',
    'environ 5', 'à peu près 10', 'vers 15', 'presque 20',
    'plus ou moins 25', 'approximativement 30', 'grossomodo 35',
    'entre 5 et 10', 'de 10 à 15', '10 ou 15', '5 maximum',
    'pas plus de 10', 'au moins 5', 'minimum 8', 'maximum 12',
    
    // Abréviations et langage SMS (30)
    'qté', 'quantité', 'combien', 'cmb',
    '2 dolip', '3 amox', '4 ibup', '5 flag',
    '2 boites', '3 boit', '4 boîtes', '5 bte',
    '2 comp', '3 comprimés', '4 cp', '5 gélules',
    '2 sach', '3 sachets', '4 flac', '5 tubes',
    'jveux 2', 'jprends 3', 'jvoudrais 4', 'jaimerais 5',
    'faut 6', 'besoin 7', 'donne 8', 'passe 9',
    'jveux 2 dolip', 'prends 3 amox', 'donne 4 ibup',
    
    // Expressions locales/ivoiriennes (30)
    'petit peu', 'un peu', 'pas beaucoup', 'beaucoup',
    'trop', 'trop beaucoup', 'pas trop', 'juste assez',
    'la quantité là', 'le nombre là', 'combien tu donnes',
    'faut combien', 'c\'est combien', 'donne-moi 2',
    'passe-moi 3', 'envoie 4', 'mets 5',
    'prends 6 pour moi', 'compte 7', 'mets 8 de côté',
    'je veux 9 de ça', 'je prends 10 de doliprane',
    'je vais prendre 2', 'je vais prendre 3',
    'je vais acheter 4', 'je vais commander 5',
    'achète-moi 6', 'commande-moi 7',
    'mets-moi 8 dans le panier', 'ajoute 9 pour moi',
    
    // Formulations polies/détaillées (10)
    'je souhaiterais une quantité de 5', 'pourriez-vous m\'en donner 10',
    'j\'aimerais en prendre 15', 'je désire en commander 20',
    'je voudrais en acheter 25', 'je requiers 30 unités',
    'je sollicite 35 comprimés', 'merci de m\'en mettre 40',
    'veuillez m\'en fournir 45', 'auriez-vous la possibilité de m\'en donner 50'
];
        quantite.forEach(phrase => {
            this.manager.addDocument('fr', phrase, 'quantite');
        });

        // ============================================
        // INTENTION: CHOIX NUMERO (60 exemples)
        // ============================================
       // ============================================
// INTENTION: CHOIX NUMERO (200 exemples)
// ============================================
const choixNumero = [
    // Chiffres simples (40)
    'le 1', 'le premier', 'premier', '1',
    'le 2', 'le deuxième', 'deuxième', '2',
    'le 3', 'le troisième', 'troisième', '3',
    'le 4', 'le quatrième', 'quatrième', '4',
    'le 5', 'le cinquième', 'cinquième', '5',
    'le 6', 'le sixième', 'sixième', '6',
    'le 7', 'le septième', 'septième', '7',
    'le 8', 'le huitième', 'huitième', '8',
    'le 9', 'le neuvième', 'neuvième', '9',
    'le 10', 'le dixième', 'dixième', '10',
    
    // Formulations "je choisis" (30)
    'je choisis le 1', 'je prends le 1', 'je veux le 1',
    'donne-moi le 1', 'sélectionne le 1', 'numéro 1',
    'option 1', 'premier choix', 'premier élément',
    'première option', 'le 1 s\'il vous plaît', 'le premier svp',
    'le 2 svp', 'le deuxième svp', 'le 3 merci',
    'le troisième merci', 'le 4 pour moi', 'le quatrième pour moi',
    'je veux le 5', 'je veux le cinquième', 'le 6 me va',
    'le sixième me va', 'je sélectionne le 7', 'je sélectionne le septième',
    'c\'est le 8 que je veux', 'c\'est le huitième que je veux',
    'je choisis l\'option 9', 'je choisis la neuvième option',
      "je prends le 2",
    "je choisis le 4",
    "je prends le numéro 2",
    "je choisis l'option 4",
    "je sélectionne le 2",
    "c'est le 4 que je veux",
    "donnez-moi le 2",
    "le deuxième me convient",
    "le quatrième s'il vous plaît",
    "je valide le numéro 2",
    "je retiens le 2",
    "j'opte pour le 4",
    "mon choix est le 2",
    "c'est bon pour le 2",
    "le 2 est parfait",
    
    // Variantes supplémentaires (10)
    "je confirme le 4",
    "je valide le premier choix",
    "c'est l'option 3 que je préfère",
    "je sélectionne la proposition 5",
    "je retiens l'alternative 2",
    "je choisis la suggestion 1",
    "la deuxième option me va",
    "le quatrième élément de la liste",
    "je prends la troisième proposition",
    "c'est le numéro 5 que je veux",
    
    // Confirmations numériques (5)
    "oui le 2",
    "d'accord pour le 4",
    "ok pour le 3",
    "parfait le numéro 1",
    "super le choix 5",
    // Positions relatives (30)
    'le dernier', 'dernier', 'premier de la liste',
    'dernier de la liste', 'le premier sur la liste', 'le dernier sur la liste',
    'celui en premier', 'celui en dernier', 'le premier proposé',
    'le dernier proposé', 'le premier choix', 'le dernier choix',
    'le haut de la liste', 'le bas de la liste', 'en tête de liste',
    'en fin de liste', 'le premier en haut', 'le dernier en bas',
    'celui du début', 'celui de la fin', 'celui au milieu',
    'le suivant', 'le précédent', 'le prochain',
    'l\'avant-dernier', 'l\'antépénultième', 'le troisième en partant de la fin',
    'le deuxième en partant du début', 'le quatrième en partant du haut',
    
    // Nombres avec "numéro" (20)
    'le numéro 1', 'le numéro 2', 'le numéro 3', 'le numéro 4',
    'le numéro 5', 'le numéro 6', 'le numéro 7', 'le numéro 8',
    'le numéro 9', 'le numéro 10', 'le numéro 11', 'le numéro 12',
    'le numéro 13', 'le numéro 14', 'le numéro 15', 'le numéro 16',
    'le numéro 17', 'le numéro 18', 'le numéro 19', 'le numéro 20',
    
    // Options (20)
    'option 1', 'option 2', 'option 3', 'option 4', 'option 5',
    'option A', 'option B', 'option C', 'option D', 'option E',
    'choix 1', 'choix 2', 'choix 3', 'choix 4', 'choix 5',
    'première option', 'deuxième option', 'troisième option',
    'quatrième option', 'cinquième option',
    
    // Abréviations et langage SMS (30)
    'le 1', 'le 2', 'le 3', 'le 4', 'le 5', 'le 6',
    'n°1', 'n°2', 'n°3', 'n°4', 'n°5',
    'num 1', 'num 2', 'num 3', 'num 4', 'num 5',
    'premier', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e',
    '1er', '2ème', '3ème', '4ème', '5ème',
    'le 1er', 'le 2ème', 'le 3ème', 'le 4ème', 'le 5ème',
    
    // Expressions locales/ivoiriennes (30)
    'le numéro un', 'le numéro deux', 'le numéro trois',
    'c\'est le 1', 'c\'est le 2', 'c\'est le 3',
    'je prends le 1', 'je choisis le 2', 'je veux le 3',
    'donne-moi le 1', 'passe-moi le 2', 'envoie le 3',
    'le premier là', 'le deuxième là', 'le troisième là',
    'celui en haut', 'celui en bas', 'celui du milieu',
    'le premier que t\'as dit', 'le deuxième que t\'as cité',
    'celui d\'avant', 'celui d\'après', 'le suivant',
    'le tout premier', 'le tout dernier', 'le tout début',
    'le premier de la liste là', 'le dernier de la liste là',
    'le 1 là-bas', 'le 2 là-bas', 'le 3 là-bas',
    
    // Formulations polies/détaillées (10)
    'je voudrais le numéro 1 s\'il vous plaît',
    'pourriez-vous me donner le deuxième',
    'j\'aimerais choisir la troisième option',
    'je sélectionne la quatrième proposition',
    'je prends la cinquième suggestion',
    'je valide le premier choix',
    'je confirme la deuxième option',
    'je retiens la troisième possibilité',
    'je suis pour la quatrième alternative',
    'je préfère la cinquième solution'
];
        choixNumero.forEach(phrase => {
            this.manager.addDocument('fr', phrase, 'choix_numero');
        });

        // ============================================
        // INTENTION: INFOS LIVRAISON (60 exemples)
        // ============================================
  // ============================================
// INTENTION: INFOS LIVRAISON (200 exemples)
// ============================================
const infosLivraison = [
    // Questions générales (30)
    'comment ça se passe pour la livraison', 'informations sur la livraison',
    'combien de temps pour la livraison', 'délai de livraison',
    'livraison gratuite', 'frais de livraison', 'combien coûte la livraison',
    'livraison à domicile', 'comment se fait la livraison',
    'qui livre les commandes', 'livraison le soir', 'livraison le weekend',
    'livraison dimanche', 'est-ce que je peux me faire livrer au travail',
    'est-ce que la livraison est rapide', 'combien de temps faut-il pour recevoir',
    'délai moyen de livraison', 'livraison express possible',
    'commande livrée en combien de temps', 'frais de port',
    'participation aux frais de livraison', 'est-ce que c\'est gratuit à partir d\'un certain montant',
    'à partir de quel montant la livraison est offerte', 'seuil de gratuité livraison',
    'livraison offerte à partir de combien', 'les frais de livraison sont fixes',
    'est-ce que le prix de la livraison varie selon la distance',
    
    // Questions sur les zones (40)
    'livraison à cocody c\'est possible', 'vous livrez à yopougon',
    'est-ce que vous livrez à bouaké', 'livraison dans san-pedro',
    'zones de livraison', 'est-ce que vous livrez partout',
    'vous livrez à man', 'livraison à daloa possible',
    'vous livrez dans ma zone', 'livraison dans mon quartier',
    'vous livrez à korhogo', 'livraison à gagnoa',
    'livraison hors Abidjan combien', 'livraison à l\'intérieur du pays tarif',
    'vous livrez dans toutes les communes d\'Abidjan',
    'vous livrez dans toutes les villes de Côte d\'Ivoire',
    'est-ce que la livraison est disponible partout',
    'zones non couvertes par la livraison', 'livraison en zone rurale possible',
    'est-ce que vous livrez dans les villages',
    'comment se passe la livraison pour les zones éloignées',
    'livraison dans toute la Côte d\'Ivoire', 'livraison à Abidjan uniquement',
    'livraison partout en CI', 'frais de livraison pour cocody',
    'combien pour livrer à bouaké', 'est-ce que vous livrez à l\'intérieur',
    'livrez-vous à l\'intérieur du pays', 'tarifs de livraison pour l\'intérieur',
    'livraison dans le nord', 'livraison dans l\'ouest', 'livraison dans le centre',
    'livraison dans l\'est', 'livraison dans le sud', 'livraison dans toutes les régions',
    'livraison à Abidjan nord', 'livraison à Abidjan sud',
    'livraison à Yopougon Niangon', 'livraison à Yopougon Toits Rouges',
    'livraison à Cocody Angré', 'livraison à Cocody Riviera',
    
    // Questions sur les délais (30)
    'livraison en 24h', 'livraison le jour même', 'livraison en 48h',
    'est-ce que je peux être livré aujourd\'hui', 'livraison express aujourd\'hui',
    'délai minimum', 'délai maximum', 'temps d\'attente moyen',
    'livraison accélérée', 'livraison prioritaire', 'livraison urgente',
    'combien de jours', 'sous combien de jours', 'dans combien de jours',
    'livraison samedi possible', 'livraison dimanche possible',
    'livraison jours fériés', 'livraison Noël', 'livraison Nouvel An',
    'livraison Ramadan', 'livraison Tabaski', 'livraison Pâques',
    'livraison de nuit', 'livraison tôt le matin', 'livraison en soirée',
    'créneau de livraison', 'choisir l\'heure de livraison',
    'livraison à 14h', 'livraison vers 18h', 'livraison après 20h',
    
    // Questions sur les frais (30)
    'combien coûte la livraison à Yopougon', 'tarif livraison Marcory',
    'frais de livraison pour Cocody', 'prix livraison Plateau',
    'livraison gratuite à partir de 10000 FCFA',
    'seuil de gratuité', 'montant pour livraison offerte',
    'participation aux frais', 'frais fixes', 'forfait livraison',
    'livraison standard tarif', 'livraison express tarif',
    'est-ce que la livraison est payante', 'livraison payante combien',
    'gratuit pour les nouveaux clients', 'première livraison offerte',
    'code promo livraison', 'réduction sur livraison',
    'frais de livraison remboursés', 'livraison avec assurance',
    'frais d\'emballage inclus', 'frais de conditionnement',
    'participation transport', 'frais de route', 'indemnité livreur',
    'pourboire livreur', 'frais supplémentaires',
    
    // Abréviations et langage SMS (30)
    'infos livraison', 'info livr', 'détails livraison',
    'livraison où', 'livrez où', 'vous livrez où',
    'livraison combien', 'frais combien', 'tarif livr',
    'délai livr', 'temps livr', 'quand livré',
    'livraison gratos', 'gratuit ou pas', 'payant ou pas',
    'livrez à coco', 'livrez à yop', 'livrez à marcory',
    'livrez à bouaké', 'livrez à korhogo', 'livrez à san-pedro',
    'zone livraison', 'zones couvertes', 'quartiers desservis',
    'livraison rapide', 'livraison speedy', 'livraison express',
    'fdp', 'frais de port', 'shipping',
    
    // Expressions locales/ivoiriennes (30)
    'vous livrez jusqu\'à chez moi', 'vous amenez à domicile',
    'vous déposez à la maison', 'vous venez livrer',
    'le livreur il vient où', 'le coursier il passe',
    'ça vient comment', 'comment ça arrive',
    'c\'est gratuit ou bien', 'on paie livraison ou pas',
    'livraison là c\'est combien', 'frais de livraison là',
    'jusqu\'à mon quartier vous venez', 'mon village vous livrez',
    'brousse vous venez', 'loin comme ça vous venez',
    'intérieur pays vous livrez', 'province vous couvrez',
    'partout en CI c\'est possible', 'toute la Côte d\'Ivoire',
    'livraison à domicile c\'est comment', 'portable là vous livrez',
    'combien de temps pour arriver', 'ça met combien de temps',
    'c\'est long ou bien', 'rapide ou pas',
    'est-ce que ça peut venir vite', 'urgence possible',
    
    // Formulations polies/détaillées (10)
    'je souhaiterais connaître les modalités de livraison',
    'pourriez-vous m\'informer sur les frais de livraison',
    'j\'aimerais savoir si vous livrez dans ma zone',
    'je désire des précisions sur les délais de livraison',
    'veuillez me communiquer les conditions de livraison',
    'merci de me donner les informations sur la livraison',
    'je requiers des détails concernant la livraison',
    'je sollicite des renseignements sur la livraison',
    'dans quelle mesure la livraison est-elle possible',
    'pourrais-je bénéficier d\'une livraison express'
];
        infosLivraison.forEach(phrase => this.manager.addDocument('fr', phrase, 'infos_livraison'));

        // ============================================
        // INTENTION: URGENCE (70 exemples)
        // ============================================
   // ============================================
// INTENTION: URGENCE (200 exemples)
// ============================================
const urgence = [
    // Urgence générale (30)
    'c\'est une urgence', 'j\'ai besoin de médicaments en urgence',
    'urgence médicale', 'c\'est très urgent',
    'il me faut ça maintenant', 'urgence absolue',
    'je ne me sens pas bien', 'c\'est grave',
    'besoin immédiat', 'il faut que je sois livré tout de suite',
    'urgence pharmacie', 'je suis malade',
    'c\'est pour mon enfant qui est malade', 'urgence nuit',
    'besoin maintenant', 'je saigne', 'douleur intense',
    'crise de paludisme', 'forte fièvre', 'difficulté à respirer',
    'réaction allergique', 'c\'est pour un bébé qui a de la fièvre',
    'urgence vitale', 'ça urge', 'c\'est pressé',
    'je suis en danger', 'besoin d\'aide immédiate',
    
    // Symptômes urgents (40)
    'ambulance', 'appeler les urgences', 'numéro des urgences',
    'urgence santé', 'problème de santé urgent',
    'crise cardiaque', 'douleur à la poitrine',
    'perte de connaissance', 'convulsions',
    'crise d\'épilepsie', 'accident',
    'blessure grave', 'brûlure grave',
    'intoxication', 'empoisonnement',
    'overdose', 'réaction médicamenteuse',
    'choc anaphylactique', 'crise d\'asthme aiguë',
    'détresse respiratoire', 'étouffement',
    'hémorragie', 'saignement abondant',
    'fracture ouverte', 'traumatisme crânien',
    'inconscient', 'ne répond pas',
    'ne bouge plus', 'pouls faible',
    'tension très basse', 'fièvre très élevée',
    'température 40', 'hyperthermie',
    'déshydratation sévère', 'vomissements incessants',
    'diarrhée aiguë', 'douleur abdominale sévère',
    'crise de colique néphrétique', 'douleur aux reins insupportable',
    'migraine violente', 'mal de tête insupportable',
    
    // Urgence spécifique médicaments (30)
    'besoin de doliprane en urgence', 'amoxicilline urgente',
    'spasfon tout de suite', 'ventoline immédiatement',
    'smecta urgence bébé', 'dafalgan urgent',
    'efferalgan maintenant', 'médicament pour fièvre urgent',
    'antipaludique urgence', 'quinine tout de suite',
    'artesunate immédiat', 'antibiotique urgent',
    'antalgique maintenant', 'anti-inflammatoire urgent',
    'sirop pour toux urgence', 'pommade urgente',
    'crème pour brûlure urgente', 'collyre urgence',
    'médicament pour allergie urgent', 'antihistaminique maintenant',
    'insuline urgence', 'diabétique besoin urgent',
    'tension médicament urgent', 'cardio médicament urgent',
    
    // Expressions d'urgence (30)
    'je fais un malaise', 'je vais m\'évanouir', 'je perds connaissance',
    'au secours je meurs', 'c\'est la fin', 'appelez les secours',
    'besoin d\'une ambulance', 'urgent urgent', 'très très urgent',
    'cas d\'urgence', 'situation critique', 'état grave',
    'pronostic vital engagé', 'urgence absolue',
    'aidez-moi vite', 'vite vite', 'dépêchez-vous',
    'accélérez svp', 'rapidement', 'le plus vite possible',
    'ASAP', 'dans l\'immédiat', 'sans délai',
    'tout de suite', 'immédiatement', 'maintenant',
    
    // Abréviations et langage SMS (30)
    'urgence', 'urgent', 'urg', 'c\'est urg',
    'besoin urgent', 'help', 'SOS', 'au secours',
    'vite', 'vitt', 'dépêche', 'vite vite',
    'maintenant', 'mtnt', 'tt de suite', 'immédiat',
    'grave', 'trop grave', 'c\'est grave', 'situation grave',
    'malade grave', 'très malade', 'enfant malade',
    'bébé fièvre', 'bébé chaud', 'enfant chaud',
    'douleur atroce', 'trop mal', 'souffrance',
    
    // Expressions locales/ivoiriennes (30)
    'c\'est urgent là', 'c\'est pressé là', 'ça urge là',
    'vite vite là', 'dépêche-toi', 'accélère',
    'je suis malade grave', 'je vais mourir', 'c\'est la mort',
    'appelle docteur', 'faut docteur maintenant',
    'amène médicament vite', 'apporte médicament maintenant',
    'enfant là il est chaud', 'bébé là fièvre',
    'maman là elle va pas', 'papa là il est malade',
    'crise là ça vient', 'palu là ça pique',
    'tête là ça casse', 'ventre là ça tue',
    'coeur là ça palpite', 'respirer difficile',
    'bouche là sèche', 'corps là chaud',
    'transpiration trop', 'frisson trop',
    
    // Formulations polies/détaillées (10)
    'je requiers une assistance médicale urgente',
    'j\'ai besoin d\'une intervention rapide',
    'pourriez-vous m\'aider en urgence',
    'je sollicite une aide immédiate',
    'je vous prie de bien vouloir m\'assister rapidement',
    'je nécessite des soins urgents',
    'ma situation requiert une attention immédiate',
    'je fais face à une urgence médicale',
    'j\'ai urgemment besoin de médicaments',
    'je vous implore de m\'aider rapidement'
];
        urgence.forEach(phrase => this.manager.addDocument('fr', phrase, 'urgence'));

        // ============================================
        // INTENTION: PRENDRE RDV (70 exemples)
        // ============================================
     // ============================================
// INTENTION: PRENDRE RDV (200 exemples)
// ============================================
const prendreRdv = [
    // Formulations générales (30)
    'je veux prendre rendez-vous', 'prendre rendez-vous dans une clinique',
    'comment prendre rendez-vous', 'réserver un rendez-vous',
    'consultation médicale', 'voir un médecin',
    'prendre RDV', 'je souhaite consulter',
    'je veux voir un docteur', 'rendez-vous chez le médecin',
    'RDV médical', 'consultation chez le généraliste',
    'voir un spécialiste', 'rendez-vous spécialiste',
    'prendre rendez-vous en ligne', 'réserver une consultation',
    'disponibilités pour rendez-vous', 'agenda des médecins',
    'planning des consultations', 'horaires de consultation',
    'quand puis-je voir un médecin', 'je veux un rendez-vous rapidement',
    'rendez-vous urgent', 'consultation urgente',
     "je souhaite consulter un médecin",
    "je veux prendre rendez-vous avec un médecin",
    "j'aimerais voir un docteur",
    "est-ce que je peux rencontrer un médecin",
    "je cherche à avoir un rendez-vous médical",
    "prendre rendez-vous chez un médecin",
    "consultation avec un médecin généraliste",
    "je voudrais un rendez-vous médical",
    
    // Renforcer "rendez-vous cardiologue" (actuellement 50% vers disponibilite_medecin)
    "prendre rendez-vous avec un cardiologue",
    "je veux consulter un cardiologue",
    "rendez-vous pour cardiologie",
    "consultation chez le cardiologue",
    "voir un cardiologue en rendez-vous",
    "prendre RDV cardiologue",
    "j'aimerais un rendez-vous en cardiologie",
     // ========================================
    "je veux voir un médecin",
    "je souhaite voir un médecin",
    "j'aimerais voir un docteur",
    "je voudrais consulter un médecin",
    "prendre rendez-vous avec un médecin",
    "avoir un rendez-vous médical",
    "rencontrer un médecin pour consultation",
    "besoin de voir un docteur",
    "je cherche à consulter un médecin",
    "est-ce que je peux voir un médecin",
    "me faire examiner par un médecin",
    "consultation médicale avec un docteur",
    "rendez-vous chez le médecin traitant",
    "voir un médecin généraliste",
    "prendre RDV médecin",
    
    // ========================================
    // Pour "voir un dentiste"
    // ========================================
    "voir un dentiste",
    "je veux voir un dentiste",
    "prendre rendez-vous chez le dentiste",
    "consultation dentaire",
    "rendez-vous pour soins dentaires",
    "besoin d'un dentiste",
    "je cherche un dentiste pour consultation",
    "aller chez le dentiste",
    "prendre RDV dentiste",
    "consultation avec un dentiste",
    "me faire soigner les dents",
    "rendez-vous dentaire",
    "voir un chirurgien-dentiste",
    "consultation chez le dentiste",
    "urgence dentaire rendez-vous",
    
    // ========================================
    // Pour "rendez-vous cardiologue"
    // ========================================
    "rendez-vous cardiologue",
    "prendre rendez-vous avec un cardiologue",
    "consulter un cardiologue",
    "voir un cardiologue en consultation",
    "rendez-vous chez le cardiologue",
    "besoin d'un cardiologue",
    "je cherche un cardiologue pour RDV",
    "consultation cardiologie",
    "prendre RDV cardiologue",
    "rendez-vous pour le cœur",
    "consulter un spécialiste du cœur",
    "cardiologue disponible pour rendez-vous",
    "me faire examiner par un cardiologue",
    "rendez-vous avec Dr cardiologue",
    "consultation chez le cardiologue",
    
    // ========================================
    // Autres spécialistes
    // ========================================
    "voir un ophtalmologue",
    "prendre rendez-vous gynécologue",
    "consultation pédiatre",
    "rendez-vous dermatologue",
    "voir un ORL",
    "prendre RDV orthopédiste",
    "consultation neurologue",
    "rendez-vous psychiatre",
    // Renforcer "voir un dentiste" (actuellement 51% vers modifier_rdv)
    "je veux prendre rendez-vous chez le dentiste",
    "consultation dentiste",
    "rendez-vous pour des soins dentaires",
    "voir un dentiste pour une carie",
    "prendre RDV dentiste",
    "j'ai besoin d'un rendez-vous chez le dentiste",
    "consultation chez le dentiste s'il vous plaît",
    // Avec lieux (30)
    'RDV dans une clinique', 'clinique pour rendez-vous',
    'centre de santé', 'cabinet médical',
    'prendre rendez-vous à la clinique Sainte Anne', 'rendez-vous à CHU',
    'consultation à CMA', 'RDV à polyclinique',
    'clinique Farah rendez-vous', 'hôpital de Yopougon consultation',
    'CHU de Cocody rendez-vous', 'CMA de Marcory',
    'polyclinique Sainte Anne', 'clinique Avicenne RDV',
    'centre hospitalier', 'formation sanitaire',
    'dispensaire', 'PMI', 'centre de protection maternelle',
    'centre de santé urbain', 'centre de santé rural',
    'hôpital général', 'hôpital régional', 'CHR',
    
    // Avec spécialistes (40)
    'je veux voir un dentiste', 'rendez-vous dentiste',
    'consultation gynécologue', 'RDV pédiatre',
    'voir un cardiologue', 'consulter un dermatologue',
    'rendez-vous ophtalmologue', 'consultation ORL',
    'voir un orthopédiste', 'RDV neurologue',
    'consulter un psychiatre', 'rendez-vous psychologue',
    'voir un radiologue', 'consultation échographie',
    'RDV analyse médicale', 'prise de sang',
    'bilan de santé', 'check-up complet',
    'kinésithérapeute', 'séance kiné',
    'dentiste pour carie', 'gynécologue pour grossesse',
    'pédiatre pour bébé', 'cardiologue pour coeur',
    'dermatologue pour peau', 'ophtalmologue pour yeux',
    'ORL pour oreilles', 'orthopédiste pour os',
    'neurologue pour tête', 'psychiatre pour dépression',
    'radiologue pour radio', 'échographie grossesse',
    
    // Avec noms de médecins (30)
    'rendez-vous pour le 15/04/2026 à 14h30', 'RDV avec Dr Koné',
    'consultation avec le professeur Yao', 'prendre RDV avec Dr Bamba',
    'réserver avec Dr Kouassi', 'voir Dr N\'Guessan',
    'consultation chez Dr Koffi', 'rendez-vous avec le docteur',
    'Dr Koné disponible quand', 'Dr Yao consultation',
    'Dr Bamba rendez-vous', 'Dr Kouassi horaires',
    'Dr N\'Guessan planning', 'Dr Koffi agenda',
    'Prof Yao disponibilité', 'Dr Touré consultation',
    'Dr Cissé rendez-vous', 'Dr Ouattara voir',
    'Dr Coulibaly', 'Dr Sylla', 'Dr Diallo',
    'Dr Traoré', 'Dr Doumbia', 'Dr Camara',
    
    // Pour enfants/famille (30)
    'prendre rendez-vous pour ma fille', 'RDV pour mon fils',
    'consultation pour ma mère', 'rendez-vous pour mon père',
    'voir un médecin pour bébé', 'consultation pédiatrique',
    'rendez-vous pour un enfant', 'consultation prénatale',
    'RDV de grossesse', 'suivi de grossesse', 'consultation postnatale',
    'rendez-vous de contrôle', 'consultation de routine',
    'visite médicale annuelle', 'check-up annuel',
    'bilan de santé complet', 'examen médical',
    'consultation pour mon enfant', 'RDV pour ma fille de 2 ans',
    'bébé de 3 mois à voir', 'enfant fièvre consultation',
    'maman enceinte RDV', 'femme enceinte suivi',
    'consultation post-accouchement', 'suivi postnatal',
    'vaccin bébé', 'vaccination enfant',
    
    // Abréviations et langage SMS (20)
    'prendre rdv', 'rdv docteur', 'rdv médecin',
    'consultation', 'consult', 'voir docteur',
    'voir médecin', 'besoin docteur', 'faut docteur',
    'rendez-vous médical', 'rdv médical', 'rdv santé',
    'check-up', 'bilan santé', 'examen médical',
    'prise de sang', 'analyse', 'radio',
    'échographie', 'echo', 'consult spécialiste',
    
    // Expressions locales/ivoiriennes (20)
    'je veux voir docteur', 'faut que je voie docteur',
    'je dois consulter', 'il faut consulter',
    'prendre rendez-vous là', 'réserver ma place',
    'voir le médecin là', 'parler au docteur',
    'docteur là il est là', 'médecin là disponible',
    'je veux mon rendez-vous', 'donne-moi rendez-vous',
    'programme-moi', 'inscris-moi',
    'mets-moi sur la liste', 'ajoute-moi au planning',
    'bloque-moi une place', 'réserve-moi un créneau'
];
        prendreRdv.forEach(phrase => {
            if (phrase.includes('Sainte Anne')) {
                this.manager.addDocument('fr', phrase, 'prendre_rdv');
                this.manager.addNamedEntityText('clinique', 'Sainte Anne', ['fr'], ['Sainte Anne', 'clinique Sainte Anne']);
            } else if (phrase.includes('CHU')) {
                this.manager.addDocument('fr', phrase, 'prendre_rdv');
                this.manager.addNamedEntityText('clinique', 'CHU', ['fr'], ['CHU']);
            } else if (phrase.includes('Koné')) {
                this.manager.addDocument('fr', phrase, 'prendre_rdv');
                this.manager.addNamedEntityText('medecin', 'Koné', ['fr'], ['Koné', 'Dr Koné']);
            } else if (phrase.includes('dentiste')) {
                this.manager.addDocument('fr', phrase, 'prendre_rdv');
                this.manager.addNamedEntityText('specialite', 'dentiste', ['fr'], ['dentiste']);
            } else {
                this.manager.addDocument('fr', phrase, 'prendre_rdv');
            }
        });

const disambiguationRdv = [
    // PRENDRE_RDV (nouveau rendez-vous)
    { phrase: "je veux voir un médecin", intention: "prendre_rdv" },
    { phrase: "je souhaite consulter un médecin", intention: "prendre_rdv" },
    { phrase: "prendre rendez-vous avec un docteur", intention: "prendre_rdv" },
    { phrase: "voir un dentiste", intention: "prendre_rdv" },
    { phrase: "rendez-vous cardiologue", intention: "prendre_rdv" },
    { phrase: "consultation chez le dentiste", intention: "prendre_rdv" },
    { phrase: "besoin de voir un cardiologue", intention: "prendre_rdv" },
    { phrase: "prendre RDV chez le médecin", intention: "prendre_rdv" },
    { phrase: "je voudrais consulter un dentiste", intention: "prendre_rdv" },
    { phrase: "rendez-vous pour une consultation cardiaque", intention: "prendre_rdv" },
    
    // MODIFIER_RDV (changement de rendez-vous existant)
    { phrase: "je veux modifier mon rendez-vous", intention: "modifier_rdv" },
    { phrase: "changer la date de mon RDV", intention: "modifier_rdv" },
    { phrase: "reporter ma consultation", intention: "modifier_rdv" },
    { phrase: "décaler mon rendez-vous chez le dentiste", intention: "modifier_rdv" },
    { phrase: "modifier l'heure de mon RDV cardiologue", intention: "modifier_rdv" },
    { phrase: "changer mon rendez-vous médical", intention: "modifier_rdv" },
    { phrase: "reprogrammer ma consultation", intention: "modifier_rdv" },
    { phrase: "déplacer mon RDV chez le médecin", intention: "modifier_rdv" },
    { phrase: "annuler et reporter mon rendez-vous", intention: "modifier_rdv" },
    { phrase: "changer de créneau pour ma consultation", intention: "modifier_rdv" }
];
const annulerRdv = [
    // Formulations générales (40)
    'je veux annuler mon rendez-vous', 'annuler RDV',
    'annuler rendez-vous', 'je ne peux pas venir à mon rendez-vous',
    'annuler consultation', 'déprogrammer mon rendez-vous',
    'supprimer rendez-vous', 'je souhaite annuler ma consultation',
    'annuler rendez-vous s\'il vous plaît', 'je dois annuler mon rendez-vous',
    'pas disponible pour le rendez-vous', 'annuler prise de sang',
    'annuler bilan de santé', 'annuler check-up',
    'annuler RDV clinique', 'annuler rendez-vous médical',
    'je ne viendrai pas à mon RDV', 'je ne pourrai pas venir',
    'imprévu, je dois annuler', 'empêchement de dernière minute',
    'annuler mon RDV svp', 'comment annuler un rendez-vous',
    'procédure d\'annulation RDV', 'puis-je annuler mon RDV',
    'est-ce possible d\'annuler', 'délai d\'annulation',
    'annulation sans frais', 'annulation remboursement',
    'annuler et reporter', 'annuler sans pénalité',
    'je souhaite décommander', 'décommander mon RDV',
    'ne pas donner suite au rendez-vous', 'rendez-vous à annuler',
    'déprogrammer consultation', 'annuler ma visite médicale',
    'supprimer mon créneau', 'libérer mon rendez-vous',
    
    // Avec IDs de rendez-vous (30)
    'annuler rendez-vous RDV2026030201', 'annuler RDV RDV2026030201',
    'pour le rendez-vous RDV2026030201, je veux annuler', 'annuler RDV2026030201',
    'mon RDV 2026030201 à annuler', 'annuler le 2026030201',
    'rendez-vous numéro 12345 à annuler', 'RDV 6789 suppression',
    'code RDV 24680 annulation', 'mon rendez-vous 13579',
    'pour le RDV du 15/04/2026, je veux annuler', 'annuler RDV du 20/05/2026',
    'le rendez-vous de demain à annuler', 'celui de la semaine prochaine',
    'mon RDV de 14h30 à annuler', 'le créneau de 10h à supprimer',
    'annuler ma consultation de lundi', 'RDV de mardi à annuler',
    'mon rendez-vous de mercredi', 'celui de jeudi prochain',
    'RDV vendredi à déprogrammer', 'samedi rendez-vous à annuler',
    'dimanche consultation à supprimer',
    
    // Avec noms de médecins (30)
    'annuler mon RDV avec Dr Koné', 'annuler consultation avec Dr Yao',
    'je ne verrai pas Dr Bamba finalement', 'annuler rendez-vous Dr Kouassi',
    'Dr N\'Guessan à déprogrammer', 'plus de RDV avec Dr Koffi',
    'annuler chez Dr Touré', 'rendez-vous Dr Cissé à annuler',
    'je ne vais pas chez Dr Coulibaly', 'annuler mon passage chez Dr Diallo',
    'Dr Ouattara annulation', 'Dr Sylla plus besoin',
    'Professeur Yao à annuler', 'Docteur Traoré déprogrammer',
    'gynécologue Dr Koné annuler', 'dentiste Dr Bamba plus besoin',
    'cardiologue Dr Yao annulation', 'pédiatre Dr Kouassi à annuler',
    
    // Raisons d'annulation (30)
    'je suis malade, je ne peux pas venir', 'je suis coincé au travail',
    'problème professionnel', 'empêchement familial',
    'urgence familiale', 'deuil dans la famille',
    'je dois voyager', 'je quitte la ville',
    'pas de transport', 'problème de moyen',
    'je me suis trompé de date', 'erreur de planning',
    'j\'ai déjà vu un autre médecin', 'déjà consulté ailleurs',
    'plus besoin finalement', 'je vais mieux',
    'guéri sans consultation', 'symptômes disparus',
    'trop cher pour moi', 'problème de budget',
    'pas remboursé par mutuelle', 'assurance refuse',
    'je préfère reporter', 'je vais reprendre plus tard',
    'enfant guéri', 'bébé va mieux',
    
    // Abréviations et langage SMS (30)
    'annuler rdv', 'annul rdv', 'suppr rdv', 'sup rdv',
    'annuler consult', 'annul consult', 'suppr consult',
    'pas venir', 'viendrai pas', 'pourrai pas',
    'changement plan', 'changement programme',
    'plus dispo', 'plus libre', 'pas libre',
    'annuler Dr Koné', 'annuler Dr Yao', 'annuler Dr Bamba',
    'rdv 123 annul', 'rdv 456 suppr', 'code 789 annul',
    'demain annul', 'lundi annul', 'mardi annul',
    'créneau annul', 'place libérée', 'rendez-vous libre',
    
    // Expressions locales/ivoiriennes (30)
    'je veux décommandé mon rendez-vous', 'décommander RDV',
    'décommande-moi', 'fais-moi décommandé',
    'je ne viendrai pas finalement', 'je viendrai pas',
    'je serai pas là', 'absent finalement',
    'déprogramme-moi', 'enlève-moi de la liste',
    'gomme-moi du planning', 'efface-moi',
    'ôte-moi du programme', 'retire-moi',
    'mon nom là enlève', 'ma place là libère',
    'rendez-vous là annulé', 'consultation là supprimé',
    'docteur là je viendrai pas', 'médecin là pas possible',
    'jour-là je suis pas là', 'date-là je viendrai pas',
    'heure-là pas bon', 'créneau-là pas possible',
    'finalement non', 'finalement pas',
    
    // Formulations polies/détaillées (10)
    'je vous prie d\'annuler mon rendez-vous',
    'je souhaiterais annuler ma consultation',
    'pourriez-vous annuler mon RDV s\'il vous plaît',
    'je sollicite l\'annulation de mon rendez-vous',
    'je requiers l\'annulation de ma consultation',
    'veuillez annuler mon rendez-vous svp',
    'merci d\'annuler mon RDV',
    'je vous serais reconnaissant d\'annuler mon rendez-vous',
    'dans quelle mesure puis-je annuler mon RDV',
    'est-il possible de procéder à l\'annulation'
];
        annulerRdv.forEach(phrase => {
            if (phrase.includes('RDV2026030201')) {
                this.manager.addDocument('fr', phrase, 'annuler_rdv');
                this.manager.addNamedEntityText('rdv_id', 'RDV2026030201', ['fr'], ['RDV2026030201']);
            } else if (phrase.includes('15/04/2026')) {
                this.manager.addDocument('fr', phrase, 'annuler_rdv');
                this.manager.addNamedEntityText('date', '15/04/2026', ['fr'], ['15/04/2026']);
            } else {
                this.manager.addDocument('fr', phrase, 'annuler_rdv');
            }
        });

        // ============================================
        // INTENTION: MODIFIER RDV (40 exemples)
        // ============================================
      // ============================================
// INTENTION: MODIFIER RDV (200 exemples)
// ============================================
const modifierRdv = [
    // Formulations générales (40)
    'je veux modifier mon rendez-vous', 'changer la date de mon RDV',
    'reporter rendez-vous', 'décaler mon RDV',
    'changer l\'heure de mon rendez-vous', 'modifier consultation',
    'reprogrammer mon RDV', 'je veux changer de médecin',
    'voir un autre spécialiste', 'déplacer mon rendez-vous',
    'reporter à la semaine prochaine', 'changer pour une autre date',
    'avancer mon rendez-vous', 'reculer mon RDV',
    'changer de clinique', 'modifier lieu de consultation',
    'changer pour un autre jour', 'autre créneau horaire',
    'décaler à plus tard', 'décaler à plus tôt',
    'modifier l\'heure du RDV', 'changer la date du RDV',
    'reprogrammer la consultation', 'déplacer le rendez-vous',
    'modifier les informations du RDV', 'changer le nom du patient',
    'corriger le numéro de téléphone', 'modifier le contact',
    'changer l\'adresse', 'modifier les coordonnées',
    'autre médecin', 'changer de praticien',
    'voir quelqu\'un d\'autre', 'autre spécialité',
    'modifier la spécialité', 'changer de service',
    'ajuster mon rendez-vous', 'réaménager mon RDV',
    
    // Avec IDs et dates (30)
    'modifier RDV RDV2026030201', 'changer le RDV2026030201',
    'pour le rendez-vous RDV2026030201, je veux modifier', 'modifier RDV2026030201',
    'pour le rendez-vous du 15/04/2026, je veux changer pour le 20/04/2026',
    'déplacer mon RDV du 15 au 22 avril', 'reporter du 10/05 au 17/05',
    'changer mon rendez-vous du 25/06', 'modifier celui du 30/07',
    'RDV de 14h30 à changer', 'créneau de 10h à décaler',
    'mon rendez-vous de lundi à reporter', 'celui de mardi à modifier',
    'la consultation de mercredi à changer', 'RDV vendredi à déplacer',
    'samedi prochain à reculer', 'dimanche à avancer',
    'le 15 avril à 14h30 devient 16 avril 15h',
    'mon RDV avec Dr Koné à modifier', 'consultation Dr Yao à changer',
    
    // Changement d'heure (30)
    'je préfère 16h30 au lieu de 14h30', 'modifier pour 16/04/2026',
    'plus tard dans la journée', 'plus tôt dans la matinée',
    'en après-midi plutôt', 'le matin plutôt',
    'vers 11h au lieu de 9h', 'à 15h au lieu de 17h',
    'après le déjeuner', 'avant le déjeuner',
    'en début d\'après-midi', 'en fin de matinée',
    'décaler d\'une heure', 'avancer de deux heures',
    'reculer de 30 minutes', 'décaler de 45 minutes',
    'plus tard de 2h', 'plus tôt de 1h',
    'changer pour 8h', 'modifier à 18h',
    'vers midi si possible', 'dans l\'après-midi',
    
    // Changement de jour (30)
    'reporter à la semaine prochaine', 'changer pour lundi prochain',
    'plutôt mardi si possible', 'mercredi ce serait mieux',
    'jeudi à la même heure', 'vendredi c\'est possible',
    'samedi matin', 'lundi après-midi',
    'la semaine suivante', 'le mois prochain',
    'dans deux semaines', 'dans trois jours',
    'plutôt demain si possible', 'après-demain',
    'ce week-end', 'dimanche matin',
    'lundi de Pâques', 'pendant les vacances',
    'après les fêtes', 'avant la rentrée',
    
    // Changement de médecin/spécialité (30)
    'je veux voir un autre médecin', 'changer de docteur',
    'plutôt Dr Yao que Dr Koné', 'je préfère Dr Bamba',
    'une femme médecin si possible', 'un médecin homme',
    'je veux un spécialiste', 'voir un cardiologue',
    'finalement gynécologue', 'pédiatre plutôt',
    'changer pour dentiste', 'ophtalmologue à la place',
    'ORL au lieu de généraliste', 'dermatologue finalement',
    'je voudrais un professeur', 'un chef de service',
    'le chef de clinique', 'le spécialiste référent',
    'un médecin expérimenté', 'un praticien confirmé',
    
    // Abréviations et langage SMS (20)
    'modifier rdv', 'modif rdv', 'changer rdv',
    'reporter rdv', 'décaler rdv', 'déplacer rdv',
    'changer date', 'changer heure', 'autre jour',
    'autre heure', 'autre créneau', 'autre moment',
    'plus tard', 'plus tôt', 'autre fois',
    'rdv 123 modif', 'rdv 456 changement',
    'changer Dr', 'autre médecin', 'autre spécialiste',
    
    // Expressions locales/ivoiriennes (20)
    'je veux bouger mon rendez-vous', 'déplacer mon RDV',
    'changer la date là', 'changer l\'heure là',
    'décaler un peu', 'reculer un peu',
    'avancer un peu', 'pousser un peu',
    'ramener à plus tard', 'ramener à plus tôt',
    'pas bon ce jour-là', 'pas bon cette heure-là',
    'autre jour mieux', 'autre heure mieux',
    'déplacer pour la semaine prochaine',
    'reporter au mois prochain',
    'changer de docteur', 'voir quelqu\'un d\'autre'
];
        modifierRdv.forEach(phrase => {
            if (phrase.includes('RDV2026030201')) {
                this.manager.addDocument('fr', phrase, 'modifier_rdv');
                this.manager.addNamedEntityText('rdv_id', 'RDV2026030201', ['fr'], ['RDV2026030201']);
            } else if (phrase.includes('15/04/2026')) {
                this.manager.addDocument('fr', phrase, 'modifier_rdv');
                this.manager.addNamedEntityText('date', '15/04/2026', ['fr'], ['15/04/2026']);
            } else {
                this.manager.addDocument('fr', phrase, 'modifier_rdv');
            }
        });

        // ============================================
        // INTENTION: DISPONIBILITE MEDECIN (30 exemples)
        // ============================================
      const disponibiliteMedecin = [
    // Exemples existants + nouveaux
    'disponibilité de Dr Koné', 'Dr Yao quand est-il disponible',
    'cardiologue disponible', 'y a-t-il un dentiste aujourd\'hui',
    'disponibilité médecin', 'agenda médecin',
    'planning des consultations', 'horaires de Dr Koné',
    'quand peut-on voir Dr Yao', 'créneaux disponibles pour gynécologue',
    'disponibilité pédiatre', 'Dr Bamba est là quand',
    'consultation disponible avec ophtalmologue', 'quand puis-je voir un dermatologue',
    'disponibilité des spécialistes', 'y a-t-il des créneaux cette semaine',
    'est-ce que Dr Kouassi consulte demain', 'Dr N\'Guessan est disponible aujourd\'hui',
    'quels sont les jours de consultation', 'heures de consultation',
    'créneaux horaires', 'plages de disponibilité',
      // Pour distinguer de prendre_rdv
    "est-ce que le cardiologue est disponible aujourd'hui",
    "le docteur Koné consulte-t-il cette semaine",
    "y a-t-il un médecin disponible maintenant",
    "quand est disponible le dentiste",
    "le généraliste est-il là",
    "disponibilité du médecin traitant",
    "le spécialiste est-il en consultation",
    "est-ce que je peux voir un médecin aujourd'hui",
    'le médecin est-il là', 'le docteur est présent',
    'quand est-ce que je peux voir le médecin', 'disponibilité pour un RDV',
    'créneaux libres', 'moments disponibles', 'jours de présence',
    'horaires d\'ouverture du cabinet', 'permanence médicale',
    "est-ce que le docteur est disponible",
    "Dr Koné est là aujourd'hui",
    "le médecin généraliste est-il présent",
    "est-ce que je peux voir un médecin maintenant",
    "y a-t-il un docteur disponible en ce moment",
    "le cardiologue est-il de garde",
    "Dr Yao consulte-t-il aujourd'hui",
    "est-ce que le spécialiste est là",
    "le pédiatre est disponible pour mon enfant",
    "le gynécologue est présent cette semaine",
    "Dr Bamba reçoit-il demain",
    "le médecin traitant est-il disponible",
    "est-ce que la consultation est possible aujourd'hui",
    "le docteur a-t-il des créneaux",
    "le médecin de garde est-il joignable",
    
    // Disponibilité des services (10)
    "le service de cardiologie est ouvert",
    "la consultation est disponible maintenant",
    "est-ce que le cabinet reçoit aujourd'hui",
    "les urgences sont-elles ouvertes",
    "le centre de santé est-il ouvert",
    "la clinique assure-t-elle la garde",
    "le service pédiatrie fonctionne-t-il",
    "les consultations ont-elles lieu aujourd'hui",
    "le médecin de garde pour la nuit",
    "la permanence médicale est-elle assurée",
    
    // Distinction avec médicaments (5)
    "le médecin est disponible" + 
    "est-ce que Dr Koné est disponible pour une consultation",
    "je cherche un médecin disponible maintenant",
    "y a-t-il un docteur qui consulte en urgence",
    "besoin d'un médecin disponible immédiatement",
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'Dr Koffi consulte quand', 'Dr Touré est dispo aujourd\'hui',
    'Dr Cissé reçoit à quelle heure', 'Dr Bamba a des places cette semaine',
    'est-ce que le généraliste est là', 'le toubib est présent', 'le doc est là',
    'y a-til un créneau pour ce soir', 'consultation possible demain matin',
    'je voudrais voir un spécialiste rapidement', 'dispo pour une urgence',
    'le médecin de garde est qui', 'qui assure la garde cette nuit',
    'y a-t-il un médecin dispo maintenant', 'besoin d\'un docteur urgent',
    'Dr Koné reçoit samedi', 'consultation le dimanche possible',
    'jours ouvrables du cabinet', 'heures d\'ouverture du centre',
    'le cabinet est ouvert à quelle heure', 'fermeture à quelle heure',
    'pause déjeuner du médecin', 'le médecin consulte à midi',
    'créneau après 18h possible', 'consultation en soirée',
    'rendez-vous tôt le matin', 'dispo à l\'aube',
    'le spécialiste vient quand', 'le professeur est disponible',
    'Dr Yao est en congé', 'le docteur est absent aujourd\'hui',
    'reprise des consultations quand', 'le médecin revient à quelle date',
    'prochains créneaux disponibles', 'premier rendez-vous dispo',
    'disponibilité dans les 48h', 'créneau dans la semaine',
    'est-ce que je peux voir un médecin aujourd\'hui', 'consultation en urgence possible',
    'y a-t-il un ophtalmo cette semaine', 'disponibilité dermato',
    'le cardio est là', 'le dentiste est présent', 'le gynéco consulte quand',
    'le pédiatre reçoit mercredi', 'l\'ORL est disponible', 'le dermato est dispo',
    'le rhumato dans le coin', 'l\'orthopédiste est là', 'le neuro est présent',
    'le psychiatre consulte', 'le psy est disponible', 'le radiologue est là',
    'le généraliste Dr Kouamé est dispo', 'Dr N\'Dri a des créneaux',
    'quand est-ce que Dr Aké reçoit', 'horaires du Dr Tanoh',
    'Dr Koffi consulte lundi', 'Dr Yao mardi', 'Dr Bamba mercredi',
    'Dr Koné jeudi', 'Dr Kouassi vendredi', 'Dr N\'Guessan samedi',
    'planning du médecin traitant', 'disponibilité du spécialiste',
    'créneau pédiatrie', 'consultation ORL dispo', 'rendez-vous cardio',
    'disponibilité ophtalmo', 'agenda dermato', 'planning gynéco',
    'heures de consultation du docteur', 'le médecin est en cabinet',
    'le docteur consulte à domicile', 'visite à domicile possible',
    'téléconsultation disponible', 'consultation en ligne quand',
    'visio avec médecin possible', 'Dr dispo par téléphone',
    'permanence téléphonique', 'garde médicale joignable',
    'SAMU disponible', 'urgences médicales joignables',
    'centre antipoison disponible', 'médecin de garde pour ce soir'
];
        disponibiliteMedecin.forEach(phrase => {
            if (phrase.includes('Koné')) {
                this.manager.addDocument('fr', phrase, 'disponibilite_medecin');
                this.manager.addNamedEntityText('medecin', 'Koné', ['fr'], ['Koné', 'Dr Koné']);
            } else if (phrase.includes('cardiologue')) {
                this.manager.addDocument('fr', phrase, 'disponibilite_medecin');
                this.manager.addNamedEntityText('specialite', 'cardiologue', ['fr'], ['cardiologue']);
            } else {
                this.manager.addDocument('fr', phrase, 'disponibilite_medecin');
            }
        });

        // ============================================
        // INTENTION: CLINIQUE PROCHE (30 exemples)
        // ============================================
     const cliniqueProche = [
    // Exemples existants
    'clinique proche de moi', 'centre de santé près de chez moi',
    'hôpital à côté', 'clinique à cocody proche',
    'où trouver une clinique dans mon quartier', 'clinique près de marcory',
    'centre médical à yopougon', 'hôpital proche plateau',
    'clinique à proximité de treichville', 'centre de santé près de koumassi',
    'clinique dans abobo', 'hôpital à adjame',
    'centre médical proche port-bouet', 'clinique à côté de bingerville',
    'où se trouve la clinique la plus proche', 'clinique pas loin d\'ici',
    'centre de santé dans le coin', 'hôpital à anyama',
    'clinique près de yamoussoukro', 'centre médical à bouaké',
    'clinique proche san-pedro', 'hôpital près de daloa',
    'structure sanitaire proche', 'établissement de santé à côté',
    'centre hospitalier dans ma zone', 'polyclinique pas loin',
    'CMA du quartier', 'centre de santé le plus proche',
    'où consulter près de chez moi', 'médecin proche de mon domicile',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'hôpital le plus proche', 'clinique à côté', 'CHU proche',
    'CHR près d\'ici', 'centre hospitalier régional proche',
    'formation sanitaire dans le coin', 'dispensaire près de chez moi',
    'PMI à proximité', 'maternité proche', 'maternité dans le quartier',
    'clinique pour accouchement près', 'centre de vaccination proche',
    'laboratoire d\'analyses à côté', 'labo près de chez moi',
    'pharmacie et clinique proches', 'cabinet médical dans le coin',
    'centre de santé urbain', 'CSU le plus proche',
    'hôpital général près', 'HG à côté', 'CHU de Treichville proche',
    'CHU de Yopougon distance', 'CHU de Cocody comment y aller',
    'clinique Farah est où', 'Clinique Avicenne adresse',
    'Clinique Sainte Anne localisation', 'Polyclinique Farah',
    'CMA de Marcory', 'CMA de Koumassi', 'CMA d\'Abobo',
    'centre de santé de Port-Bouet', 'hôpital de zone',
    'dispensaire d\'Angré', 'infirmerie proche',
    'poste de santé dans le village', 'case de santé près',
    'centre de soins proche', 'établissement sanitaire à côté',
    'clinique à 5 minutes', 'hôpital à 10 minutes',
    'structure de santé à distance de marche', 'centre médical accessible',
    'où se trouve l\'hôpital le plus proche', 'comment aller à la clinique',
    'itinéraire vers centre de santé', 'clinique sur ma route',
    'clinique recommandée dans ma zone', 'meilleur hôpital près',
    'hôpital public proche', 'clinique privée à côté',
    'centre de référence dans le coin', 'CHR le plus proche',
    'clinique universitaire', 'CU près', 'centre anti-tuberculeux proche',
    'centre de traitement du paludisme près', 'CTP dans le coin',
    'centre de dépistage VIH proche', 'CDV près de chez moi',
    'centre de planification familiale', 'CPF à proximité',
    'centre de nutrition proche', 'site de vaccination',
    'centre de traitement Ebola', 'CTEVI proche',
    'centre de prise en charge', 'CEPAC dans le coin',
    'clinique ophtalmologique proche', 'centre dentaire à côté',
    'cabinet dentaire près', 'clinique dentaire dans le quartier',
    'centre de dialyse proche', 'clinique d\'imagerie médicale',
    'centre de radiologie près', 'clinique d\'échographie à côté',
    'centre de kinésithérapie proche', 'centre de rééducation',
    'clinique psychiatrique près', 'hôpital psychiatrique',
    'centre d\'addictologie proche', 'centre de santé mentale',
    'institut de cancérologie', 'centre d\'oncologie',
    'clinique de cardiologie', 'centre cardio proche'
];
        cliniqueProche.forEach(phrase => {
            if (phrase.includes('cocody')) {
                this.manager.addDocument('fr', phrase, 'clinique_proche');
                this.manager.addNamedEntityText('localite', 'cocody', ['fr'], ['cocody']);
            } else {
                this.manager.addDocument('fr', phrase, 'clinique_proche');
            }
        });

        // ============================================
        // INTENTION: SERVICE CLINIQUE (40 exemples)
        // ============================================
      const serviceClinique = [
    // Exemples existants
    'quels sont les services disponibles', 'services cliniques',
    'que proposez-vous comme services médicaux', 'prestations médicales',
    'soins disponibles', 'types de consultations',
    'spécialités médicales', 'quels médecins pouvez-vous recommander',
    'services de la clinique Sainte Anne', 'prestations du CHU',
    'soins à CMA', 'services à polyclinique',
    'avez-vous un service d\'urgence', 'urgences disponibles',
    'service d\'urgence 24h/24', 'garde médicale',
    'service de garde', 'consultations externes',
    'hospitalisation', 'services d\'hospitalisation',
    'chambres disponibles', 'soins intensifs',
    'réanimation', 'bloc opératoire',
    'chirurgie', 'maternité',
    'accouchement', 'pédiatrie',
    'néonatalogie', 'cardiologie',
    'dermatologie', 'gynécologie',
    'obstétrique', 'ophtalmologie',
    'ORL', 'stomatologie',
    'orthopédie', 'traumatologie',
    'neurologie', 'psychiatrie',
    'psychologie', 'radiologie',
    'échographie', 'mammographie',
    'scanner', 'IRM',
    'laboratoire d\'analyses', 'analyses médicales',
    'prélèvements', 'vaccination',
    'vaccins', 'médecine du travail',
    'médecine scolaire', 'médecine sportive',
    'kinésithérapie', 'rééducation',
    'orthophonie', 'diététique',
    'nutrition',
    
    // NOUVEAUX EXEMPLES (80 supplémentaires)
    'service des urgences', 'urgence médicale', 'urgence pédiatrique',
    'urgence cardio', 'urgence traumatologique', 'SAMU', 'SMUR',
    'réanimation adulte', 'réanimation pédiatrique', 'soins intensifs cardio',
    'USIC', 'soins continus', 'surveillance continue',
    'hospitalisation jour', 'hôpital de jour', 'chirurgie ambulatoire',
    'chirurgie générale', 'chirurgie viscérale', 'chirurgie orthopédique',
    'chirurgie pédiatrique', 'neurochirurgie', 'chirurgie cardio-vasculaire',
    'chirurgie esthétique', 'chirurgie réparatrice', 'chirurgie de la main',
    'gynécologie obstétrique', 'consultation gynéco', 'planning familial',
    'suivi de grossesse', 'préparation à l\'accouchement', 'consultation allaitement',
    'pédiatrie générale', 'néonatalogie soins', 'PMI', 'protection maternelle infantile',
    'consultation nourrisson', 'suivi croissance enfant', 'vaccination enfant',
    'cardiologie adulte', 'cardiologie pédiatrique', 'rythmologie',
    'exploration fonctionnelle cardio', 'épreuve d\'effort', 'holter',
    'dermatologie générale', 'dermato vénéréologie', 'IST', 'consultation MST',
    'gastro-entérologie', 'endoscopie digestive', 'coloscopie', 'gastroscopie',
    'hépatologie', 'consultation foie', 'pneumologie', 'exploration fonctionnelle respiratoire',
    'EFR', 'allergologie', 'tests allergiques', 'désensibilisation',
    'néphrologie', 'dialyse', 'hémodialyse', 'dialyse péritonéale',
    'urologie', 'consultation prostate', 'andrologie', 'sexologie',
    'ophtalmologie générale', 'consultation oeil', 'fond d\'oeil', 'tonomètre',
    'ORL générale', 'audiométrie', 'test audition', 'vertiges',
    'rhumatologie', 'consultation articulation', 'ostéoporose', 'arthrose',
    'endocrinologie', 'diabétologie', 'consultation diabète', 'thyroïde',
    'nutrition diététique', 'conseils nutrition', 'régime', 'obésité',
    'oncologie médicale', 'chimiothérapie', 'radiothérapie', 'cancérologie',
    'hématologie', 'consultation sang', 'anémie', 'drépanocytose',
    'médecine interne', 'maladies auto-immunes', 'maladies rares',
    'médecine physique réadaptation', 'rééducation fonctionnelle',
    'kinésithérapie', 'massage', 'rééducation périnéale', 'rééducation vestibulaire',
    'orthophonie', 'rééducation langage', 'rééducation déglutition',
    'psychiatrie adulte', 'pédopsychiatrie', 'consultation psychologique',
    'psychothérapie', 'soutien psychologique', 'addictologie', 'sevrage tabac',
    'médecine du sport', 'certificat sport', 'visite d\'aptitude',
    'médecine scolaire', 'visite médicale école', 'certificat scolaire',
    'médecine du travail', 'visite médicale travail', 'aptitude professionnelle',
    'radiologie conventionnelle', 'radio standard', 'échographie générale',
    'échographie pelvienne', 'échographie obstétricale', 'Doppler',
    'scanner X', 'tomodensitométrie', 'IRM cérébrale', 'IRM articulaire',
    'mammographie', 'dépistage cancer sein', 'ostéodensitométrie',
    'laboratoire analyses médicales', 'prise de sang', 'bilan sanguin',
    'NFS', 'glycémie', 'créatininémie', 'bilan hépatique',
    'bilan rénal', 'bilan lipidique', 'bilan thyroïdien',
    'examen cytobactériologique', 'ECBU', 'coproculture', 'examen parasitologique',
    'sérologie', 'test VIH', 'test hépatite', 'test syphilis',
    'pharmacie clinique', 'dispensation médicaments', 'préparation doses'
];
        serviceClinique.forEach(phrase => this.manager.addDocument('fr', phrase, 'service_clinique'));

        // ============================================
        // INTENTION: TARIF CLINIQUE (50 exemples)
        // ============================================
const tarifClinique = [
    // Exemples existants
    'combien coûte une consultation', 'prix d\'une consultation',
    'tarif consultation', 'c\'est combien pour voir un médecin',
    'frais de consultation', 'combien pour un généraliste',
    'prix généraliste', 'tarif spécialiste',
    'combien pour un dentiste', 'prix dentiste',
    'tarif gynécologue', 'combien pédiatre',
    'prix cardiologue', 'tarif dermatologue',
    'combien ophtalmologue', 'prix ORL',
    'tarif orthopédiste', 'combien neurologue',
    'prix psychiatre', 'tarif psychologue',
    'prix échographie', 'tarif radio',
    'combien scanner', 'prix IRM',
    'tarif prise de sang', 'analyse sanguine prix',
    'bilan complet tarif', 'combien accouchement',
    'prix accouchement normal', 'tarif césarienne',
    'frais d\'hospitalisation', 'prix chambre particulière',
    'tarif chambre double', 'frais de séjour',
    'combien pour une nuit', 'prix intervention chirurgicale',
    'tarif opération', 'combien appendicite',
    'prix hernie', 'tarif vésicule biliaire',
    'frais de bloc', 'honoraires chirurgien',
    'honoraires anesthésiste', 'tarif consultation urgence',
    'prix passage aux urgences', 'frais de garde',
    'combien vaccin', 'prix vaccination',
    'tarif vaccin bébé', 'prix vaccin adulte',
    'tarif vaccin voyage', 'tarif consultation à domicile',
    'prix visite à domicile', 'combien pour une téléconsultation',
    'tarif consultation en ligne', 'prix visio avec médecin',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'combien coûte une consultation chez le généraliste', 'tarif consultation généraliste',
    'prix consultation spécialiste', 'combien pour un spécialiste',
    'tarif ophtalmo', 'prix dermato', 'combien cardio', 'tarif gynéco',
    'honoraires médecin', 'frais médicaux', 'combien docteur',
    'prix consultation Dr Koné', 'tarif Dr Yao', 'combien Dr Bamba',
    'consultation professeur prix', 'honoraires professeur',
    'tarif consultation clinique Sainte Anne', 'prix CHU consultation',
    'combien CMA consultation', 'tarif polyclinique',
    'frais de consultation privée', 'prix clinique privée',
    'tarif public vs privé', 'différence prix public privé',
    'combien échographie obstétricale', 'prix écho grossesse',
    'tarif échographie pelvienne', 'combien Doppler',
    'prix radio thoracique', 'tarif radio pulmonaire',
    'combien radio membre', 'prix radio cheville',
    'tarif scanner cérébral', 'combien TDM',
    'prix IRM cérébrale', 'tarif IRM lombaire',
    'combien mammographie', 'prix dépistage cancer sein',
    'tarif ostéodensitométrie', 'combien densitométrie',
    'prix bilan sanguin complet', 'tarif NFS', 'combien glycémie',
    'prix bilan hépatique', 'tarif bilan rénal',
    'combien bilan lipidique', 'prix bilan thyroïdien',
    'tarif ECBU', 'combien examen urine',
    'prix coproculture', 'tarif examen selles',
    'combien test VIH', 'prix dépistage VIH',
    'tarif test hépatite', 'combien sérologie complète',
    'prix hospitalisation par jour', 'tarif chambre simple',
    'combien chambre VIP', 'prix hospitalisation maternité',
    'tarif accouchement voie basse', 'combien césarienne',
    'prix épisiotomie', 'tarif péridurale',
    'combien soins intensifs par jour', 'tarif réanimation',
    'prix séjour néonatalogie', 'tarif couveuse par jour',
    'combien intervention chirurgicale', 'prix appendicectomie',
    'tarif cholécystectomie', 'combien hernie inguinale',
    'prix cure hernie', 'tarif amygdalectomie',
    'combien extraction dent', 'prix dent de sagesse',
    'tarif dévitalisation', 'combien couronne dentaire',
    'prix implant dentaire', 'tarif détartrage',
    'combien soin carie', 'prix consultation dentiste',
    'tarif orthodontie', 'combien appareil dentaire',
    'prix blanchiment dentaire', 'tarif prothèse dentaire',
    'combien consultation psychiatre', 'tarif psychiatre',
    'prix séance psychologue', 'tarif psychothérapie',
    'combien séance kiné', 'tarif rééducation',
    'prix séance orthophonie', 'tarif bilan orthophonique',
    'combien vaccin ROR', 'prix vaccin DTCP',
    'tarif vaccin hépatite B', 'combien vaccin fièvre jaune',
    'prix vaccin méningite', 'tarif vaccin pneumocoque',
    'combien vaccin grippe', 'prix vaccination complète',
    'tarif consultation urgence nuit', 'prix garde médicale',
    'combien consultation dimanche', 'tarif jour férié'
];
        tarifClinique.forEach(phrase => this.manager.addDocument('fr', phrase, 'tarif_clinique'));

        // ============================================
        // INTENTION: SPECIALITE CLINIQUE (50 exemples)
        // ============================================
       const specialiteClinique = [
    // Exemples existants
    'quelles spécialités avez-vous', 'spécialités médicales disponibles',
    'quels spécialistes puis-je consulter', 'types de médecins',
    'domaines médicaux', 'avez-vous un cardiologue',
    'y a-t-il un dermatologue', 'gynécologue disponible',
    'pédiatre présent', 'ophtalmologue dans votre clinique',
    'ORL je cherche', 'orthopédiste pour fracture',
    'neurologue pour maux de tête', 'psychiatre pour dépression',
    'psychologue pour anxiété', 'radiologue pour écho',
    'dentiste pour carie', 'chirurgien pour opération',
    'anesthésiste pour intervention', 'pédiatre pour enfant',
    'gériatre pour personne âgée', 'rhumatologue pour arthrose',
    'endocrinologue pour diabète', 'néphrologue pour reins',
    'urologue pour prostate', 'gastro-entérologue pour estomac',
    'hépatologue pour foie', 'pneumologue pour poumons',
    'allergologue pour allergies', 'immunologue pour immunité',
    'hématologue pour sang', 'oncologue pour cancer',
    'radiothérapeute pour traitement', 'médecin du sport pour sportifs',
    'médecin du travail pour travail', 'médecin scolaire pour école',
    'médecin légiste pour autopsie', 'anatomo-pathologiste pour analyses',
    'biologiste pour labo', 'pharmacien pour médicaments',
    'kinésithérapeute pour rééducation', 'orthophoniste pour langage',
    'ergothérapeute pour handicap', 'podologue pour pieds',
    'ostéopathe pour manipulations', 'diététicien pour nutrition',
    'nutritionniste pour régime', 'sage-femme pour grossesse',
    'infirmier pour soins', 'pédicure pour les pieds',
    'proctologue pour hémorroïdes', 'andrologue pour hommes',
    'sexologue pour problèmes sexuels', 'médecin esthétique',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'spécialiste cœur', 'cardiologue', 'docteur pour le cœur',
    'spécialiste peau', 'dermatologue', 'docteur pour la peau',
    'spécialiste femme', 'gynécologue', 'gynéco', 'docteur pour les femmes',
    'spécialiste enfant', 'pédiatre', 'pédo', 'docteur pour enfants',
    'spécialiste dents', 'dentiste', 'chirurgien dentiste', 'dentist',
    'spécialiste yeux', 'ophtalmologue', 'ophtalmo', 'docteur pour les yeux',
    'spécialiste oreilles nez gorge', 'ORL', 'oto-rhino-laryngologiste',
    'spécialiste os', 'orthopédiste', 'traumatologue', 'chirurgien orthopédique',
    'spécialiste cerveau', 'neurologue', 'neuro', 'docteur pour le cerveau',
    'spécialiste nerfs', 'neurologue', 'neuro',
    'spécialiste mental', 'psychiatre', 'psy', 'psychiatre',
    'spécialiste esprit', 'psychologue', 'psy', 'psychothérapeute',
    'spécialiste radio', 'radiologue', 'radiologiste',
    'spécialiste chirurgie', 'chirurgien', 'chir',
    'spécialiste anesthésie', 'anesthésiste', 'anesthésiste-réanimateur',
    'spécialiste personne âgée', 'gériatre', 'gérontologue',
    'spécialiste articulations', 'rhumatologue', 'rhumato',
    'spécialiste hormones', 'endocrinologue', 'endocrino',
    'spécialiste diabète', 'diabétologue', 'endocrinologue',
    'spécialiste reins', 'néphrologue', 'néphro',
    'spécialiste prostate', 'urologue', 'urologiste',
    'spécialiste urines', 'urologue', 'néphrologue',
    'spécialiste estomac', 'gastro-entérologue', 'gastro',
    'spécialiste digestion', 'gastro-entérologue', 'gastro',
    'spécialiste foie', 'hépatologue', 'gastro-hépatologue',
    'spécialiste poumons', 'pneumologue', 'pneumo',
    'spécialiste respiration', 'pneumologue', 'pneumo',
    'spécialiste allergies', 'allergologue', 'allergo',
    'spécialiste immunité', 'immunologue', 'immuno',
    'spécialiste sang', 'hématologue', 'hématologiste',
    'spécialiste cancer', 'oncologue', 'cancérologue',
    'spécialiste radiothérapie', 'radiothérapeute', 'oncologue radiothérapeute',
    'spécialiste sport', 'médecin du sport', 'traumatologue du sport',
    'spécialiste travail', 'médecin du travail', 'médecine professionnelle',
    'spécialiste école', 'médecin scolaire', 'médecine scolaire',
    'spécialiste légal', 'médecin légiste', 'forensique',
    'spécialiste analyses', 'biologiste', 'biologiste médical',
    'spécialiste labo', 'biologiste', 'directeur de laboratoire',
    'spécialiste médicaments', 'pharmacien', 'pharmacien clinicien',
    'spécialiste rééducation', 'kinésithérapeute', 'kiné', 'physiothérapeute',
    'spécialiste langage', 'orthophoniste', 'ortho',
    'spécialiste handicap', 'ergothérapeute', 'ergo',
    'spécialiste pieds', 'podologue', 'pédicure-podologue',
    'spécialiste manipulations', 'ostéopathe', 'ostéo',
    'spécialiste nutrition', 'diététicien', 'nutritionniste',
    'spécialiste régime', 'diététicien', 'nutritionniste',
    'spécialiste grossesse', 'sage-femme', 'maïeuticien',
    'spécialiste soins', 'infirmier', 'infirmière', 'IDE',
    'spécialiste pieds', 'pédicure', 'pédicure médical',
    'spécialiste rectum', 'proctologue', 'procto',
    'spécialiste homme', 'andrologue', 'andro',
    'spécialiste sexualité', 'sexologue', 'sexothérapeute',
    'spécialiste esthétique', 'médecin esthétique', 'chirurgien esthétique',
    'spécialiste urgences', 'urgentiste', 'médecin urgentiste',
    'spécialiste réanimation', 'réanimateur', 'intensiviste',
    'spécialiste douleur', 'algologue', 'spécialiste douleur chronique',
    'spécialiste sommeil', 'somnologue', 'médecin du sommeil',
    'spécialiste génétique', 'généticien', 'conseiller génétique',
    'spécialiste paludisme', 'paludologue', 'spécialiste maladies tropicales'
];
        specialiteClinique.forEach(phrase => {
            if (phrase.includes('cardiologue')) {
                this.manager.addDocument('fr', phrase, 'specialite_clinique');
                this.manager.addNamedEntityText('specialite', 'cardiologue', ['fr'], ['cardiologue']);
            } else if (phrase.includes('dermatologue')) {
                this.manager.addDocument('fr', phrase, 'specialite_clinique');
                this.manager.addNamedEntityText('specialite', 'dermatologue', ['fr'], ['dermatologue']);
            } else if (phrase.includes('gynécologue')) {
                this.manager.addDocument('fr', phrase, 'specialite_clinique');
                this.manager.addNamedEntityText('specialite', 'gynécologue', ['fr'], ['gynécologue']);
            } else {
                this.manager.addDocument('fr', phrase, 'specialite_clinique');
            }
        });

        // ============================================
        // INTENTION: AUTRE VILLE (50 exemples)
        // ============================================
        const autreVille = [
    // Exemples existants
    'et pour bouaké', 'qu\'en est-il de korhogo',
    'à san-pedro comment ça se passe', 'pour yamoussoukro',
    'est-ce disponible à man', 'je suis à daloa',
    'je viens de gagnoa', 'pour abengourou',
    'je suis basé à bondoukou', 'habite à odienné',
    'résident à divo', 'domicilié à soubré',
    'je vis à guiglo', 'je me trouve à agnibilékrou',
    'je suis actuellement à adzopé', 'je suis de agboville',
    'originaire de grand-bassam', 'en ce moment à bingerville',
    'je pars à anyama', 'je reviens de tiassalé',
    'je voyage vers toumodi', 'pour sinfra c\'est possible',
    'et vavoua vous couvrez', 'je suis à l\'intérieur du pays',
    'hors Abidjan', 'dans ma région',
    'dans mon village', 'à l\'intérieur',
    'en province', 'dans le centre',
    'dans le nord', 'dans le sud',
    'dans l\'ouest', 'dans l\'est',
    'dans le centre-ouest', 'dans le centre-nord',
    'dans le centre-est', 'dans le sud-ouest',
    'dans le sud-est', 'dans le nord-ouest',
    'dans le nord-est', 'dans la région des lacs',
    'dans la région des lagunes', 'dans la région du Comoé',
    'dans la région du Denguélé', 'dans la région du Gôh',
    'dans la région du Gontougo', 'dans la région du Hambol',
    'dans la région du Haut-Sassandra', 'dans la région de l\'Iffou',
    'dans la région de l\'Indénié-Djuablin', 'dans la région du Kabadougou',
    'dans la région du Lôh-Djiboua', 'dans la région du Marahoué',
    'dans la région du Moronou', 'dans la région du N\'Zi',
    'dans la région de la Nouvelle', 'dans la région du Poro',
    'dans la région du San-Pédro', 'dans la région du Sassandra-Marahoué',
    'dans la région du Savanes', 'dans la région du Sud-Bandama',
    'dans la région du Sud-Comoé', 'dans la région du Tonkpi',
    'dans la région du Tchologo', 'dans la région du Worodougou',
    'dans la région du Yamoussoukro', 'dans la région du Zanzan',
    'je suis à Ferkessédougou', 'à Boundiali', 'à Tengrela',
    'à Ouangolodougou', 'à Ferké', 'à Kong', 'à Katiola',
    'à Dabakala', 'à Mankono', 'à Séguéla', 'à Touba',
    'à Biankouma', 'à Danané', 'à Zouan-Hounien', 'à Toulépleu',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'je suis à Bondoukou', 'à Bouna', 'à Tanda', 'à Nassian',
    'à Abengourou', 'à Agnibilékrou', 'à Bettié', 'à Tiapoum',
    'à Aboisso', 'à Adiaké', 'à Grand-Bassam', 'à Bonoua',
    'à Adzopé', 'à Agboville', 'à Akoupé', 'à Yakassé-Attobrou',
    'à Dabou', 'à Grand-Lahou', 'à Jacqueville', 'à Sikensi',
    'à Tiassalé', 'à Taabo', 'à Toumodi', 'à Dimbokro',
    'à Bocanda', 'à Kouassi-Kouassikro', 'à Bongouanou',
    'à Arrah', 'à M\'Batto', 'à Daoukro', 'à Ouellé',
    'à Divo', 'à Guitry', 'à Lakota', 'à Fresco',
    'à Sassandra', 'à San-Pédro', 'à Tabou', 'à Soubré',
    'à Buyo', 'à Méagui', 'à Gagnoa', 'à Oumé', 'à Guibéroua',
    'à Daloa', 'à Issia', 'à Vavoua', 'à Zoukougbeu',
    'à Bouaflé', 'à Sinfra', 'à Bonon', 'à Zuénoula',
    'à Man', 'à Danané', 'à Zouan-Hounien', 'à Bloléquin',
    'à Bangolo', 'à Facobly', 'à Kouibly', 'à Sangouiné',
    'à Guiglo', 'à Bloléquin', 'à Toulépleu', 'à Duékoué',
    'à Toulepleu', 'à Guiglo', 'à Bloléquin', 'à Toulépleu',
    'à Odienné', 'à Madinani', 'à Samatiguila', 'à Séguélon',
    'à Kaniasso', 'à Boundiali', 'à Kouto', 'à Tengréla',
    'à Ferkessédougou', 'à Ouangolodougou', 'à Kong', 'à Doropo',
    'à Korhogo', 'à Sinématiali', 'à Dikodougou', 'à Karakoro',
    'à Napié', 'à Poro', 'à Katiola', 'à Dabakala', 'à Niakaramandougou',
    'à Tafiré', 'à Badikaha', 'à Bouaké', 'à Sakassou', 'à Béoumi',
    'à Botro', 'à Mankono', 'à Séguéla', 'à Dianra', 'à Kounahiri',
    'à Dabakala', 'à Yamoussoukro', 'à Attiégouakro', 'à Didiévi',
    'à Tiébissou', 'à Toumodi', 'à Bongouanou', 'à Daoukro',
    'à Arrah', 'à M\'Batto', 'à Bocanda', 'à Kouassi-Kouassikro',
    'à Dimbokro', 'à N\'Zi', 'à Moronou', 'à Iffou',
    'à Boundiali', 'à Ferké', 'à Odienné', 'à Touba',
    'à Biankouma', 'à Danané', 'à Man', 'à Zouan-Hounien',
    'à Guiglo', 'à Duékoué', 'à Toulépleu', 'à Bloléquin',
    'à Aboisso', 'à Adiaké', 'à Grand-Bassam', 'à Tiapoum',
    'à Dabou', 'à Grand-Lahou', 'à Jacqueville', 'à Sikensi'
];
        autreVille.forEach(phrase => {
            if (phrase.includes('bouaké')) {
                this.manager.addDocument('fr', phrase, 'autre_ville');
                this.manager.addNamedEntityText('localite', 'bouaké', ['fr'], ['bouaké']);
            } else if (phrase.includes('korhogo')) {
                this.manager.addDocument('fr', phrase, 'autre_ville');
                this.manager.addNamedEntityText('localite', 'korhogo', ['fr'], ['korhogo']);
            } else {
                this.manager.addDocument('fr', phrase, 'autre_ville');
            }
        });

        // ============================================
        // INTENTION: CONFIRMER (50 exemples)
        // ============================================
     const confirmer = [
    // Exemples existants
    'oui', 'oui c\'est bon', 'd\'accord', 'ok', 'OK',
    'ça marche', 'je confirme', 'confirmation',
    'oui je valide', 'je suis d\'accord', 'c\'est exact',
    'parfait', 'super', 'allons-y', 'je suis prêt',
    'continue', 'oui continuez', 'je confirme ma commande',
    'valider', 'accepté', 'yes', 'bien reçu',
    'compris', 'entendu', 'ça roule', 'c\'est parti',
    'on y va', 'je suis ok', 'oui c\'est ça',
    'correct', 'absolument', 'tout à fait',
    'exactement', 'voilà', 'c\'est cela',
    'c\'est bien ça', 'c\'est correct', 'c\'est juste',
    'c\'est bon pour moi', 'je valide', 'j\'accepte',
    'je suis pour', 'pour', 'affirmative',
    'positif', '+1', '👍', '✅',
    'ok merci', 'dac', 'd\'accord merci',
    'ok d\'accord', 'entendu merci', 'compris merci',
    'parfait merci', 'super merci', 'je confirme le rendez-vous',
    'commande confirmée', 'je valide la commande', 'confirmation de RDV',
    'je suis d\'accord avec les conditions', 'j\'accepte les termes',
    'je confirme les informations', 'tout est correct',
    'je valide le panier', 'je confirme mon adresse',
    'oui c\'est la bonne adresse', 'le numéro est bon',
    'c\'est exactement ça', 'parfait pour moi',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'oui oui', 'bien sûr', 'bien évidemment', 'évidemment',
    'certainement', 'absolument', 'carrément', 'totalement',
    'exact', 'exactement ça', 'c\'est ça même',
    'c\'est cela même', 'voilà exactement', 'c\'est tout à fait ça',
    'tout à fait d\'accord', 'entièrement d\'accord',
    'je valide à 100%', 'je confirme à fond',
    'oui pour la commande', 'oui pour le RDV',
    'commande OK', 'RDV OK', 'c\'est OK pour moi',
    'c\'est bon pour la commande', 'c\'est bon pour le rendez-vous',
    'je dis oui', 'je dis oui pour ça', 'j\'opine',
    'j\'acquiesce', 'j\'approuve', 'je donne mon accord',
    'je donne mon feu vert', 'feu vert', 'GO',
    'c\'est parti mon kiki', 'c\'est parti', 'on y va',
    'vas-y', 'fais-le', 'lance', 'procède',
    'exécute', 'valide', 'confirme', 'approuve',
    'pour sûr', 'pour sûr et certain', 'et comment',
    'et comment donc', 'bien entendu', 'il va sans dire',
    'sans aucun doute', 'indubitablement', 'incontestablement',
    'oui bien sûr', 'mais oui', 'mais oui bien sûr',
    'oui avec plaisir', 'avec plaisir', 'volontiers',
    'je veux bien', 'je suis partant', 'je suis preneur',
    'compte sur moi', 'je suis chaud', 'chaud pour ça',
    'yes we can', 'okay', 'okey', 'd\'acc',
    'dacodac', 'dac accord', 'c\'est tout bon',
    'c\'est nickel', 'c\'est parfait', 'impeccable',
    'top', 'top là', 'c\'est top', 'parfait top',
    'génial', 'super génial', 'magnifique',
    'cool', 'very cool', 'très bien', 'très bon',
    'très bien merci', 'très bon merci', 'parfait merci',
    'impeccable merci', 'nickel merci', 'top merci',
    'oui merci beaucoup', 'oui je vous remercie',
    'merci oui', 'ok merci bien', 'entendu merci à vous',
    'bien reçu merci', 'reçu 5/5', 'message reçu',
    'compris chef', 'compris patron', 'ok chef',
    'je confirme les infos', 'infos confirmées',
    'adresse confirmée', 'numéro confirmé',
    'c\'est bien mon adresse', 'c\'est bien mon numéro',
    'exact c\'est moi', 'c\'est bien moi', 'c\'est moi-même',
    'moi-même en personne', 'c\'est votre serviteur',
    'c\'est nous', 'c\'est bien nous', 'famille confirmée'
];
        confirmer.forEach(phrase => this.manager.addDocument('fr', phrase, 'confirmer'));

        // ============================================
        // INTENTION: REFUSER (50 exemples)
        // ============================================
 const refuser = [
    // Exemples existants
    'non', 'non merci', 'pas maintenant',
    'je ne suis pas intéressé', 'annuler', 'annulez',
    'stop', 'arrêtez', 'pas ça', 'je refuse',
    'je ne veux pas', 'laissez tomber', 'oubliez',
    'plus tard', 'pas pour le moment', 'je change d\'avis',
    'finalement non', 'annuler la commande', 'ne pas donner suite',
    'pas d\'accord', 'ce n\'est pas bon', 'faux',
    'erreur', 'c\'est pas ça', 'je ne confirme pas',
    'négatif', 'pas possible', 'non et non',
    'jamais', 'certainement pas', 'absolument pas',
    'pas question', 'hors de question', 'jamais de la vie',
    'en aucun cas', 'niet', 'no',
    'no way', 'nein', 'non non',
    'non merci', 'non c\'est bon', 'non ça ne m\'intéresse pas',
    'pas intéressé', 'pas pour l\'instant', 'peut-être plus tard',
    'une autre fois', 'ultérieurement', 'pas maintenant merci',
    'je passe mon tour', 'je décline', 'je refuse poliment',
    'je vais réfléchir', 'je reviendrai plus tard', 'pas aujourd\'hui',
    'je ne veux pas de ce médicament', 'je refuse ce rendez-vous',
    'annuler l\'opération', 'je ne suis pas d\'accord',
    'ce n\'est pas ce que je voulais', 'c\'est une erreur',
    'je ne valide pas', 'rejeter', 'refuser la proposition',
    
    // NOUVEAUX EXEMPLES (70 supplémentaires)
    'non non non', 'non et non et non', 'non merci',
    'non c\'est non', 'c\'est non', 'la réponse est non',
    'je dis non', 'je dis non catégoriquement',
    'catégoriquement non', 'absolument non',
    'certainement non', 'définitivement non',
    'négatif mon capitaine', 'négatif chef',
    'pas du tout', 'pas du tout d\'accord',
    'pas d\'accord du tout', 'pas question du tout',
    'hors de question', 'hors de question totale',
    'jamais au grand jamais', 'jamais jamais',
    'surtout pas', 'surtout pas ça',
    'pas ça s\'il vous plaît', 'pas ça merci',
    'autre chose', 'autre chose peut-être',
    'pas ce médicament', 'pas ce rendez-vous',
    'pas cette commande', 'pas cette option',
    'pas cette proposition', 'pas ce choix',
    'je préfère autre chose', 'je veux autre chose',
    'je voudrais autre chose', 'donne-moi autre chose',
    'propose autre chose', 'autre suggestion',
    'pas intéressé du tout', 'zéro intéressé',
    'intérêt zéro', 'aucun intérêt',
    'ça ne m\'intéresse pas', 'cela ne m\'intéresse pas',
    'pas mon truc', 'pas mon genre',
    'pas pour moi', 'ce n\'est pas pour moi',
    'cela ne me convient pas', 'ça ne me convient pas',
    'ne me convient pas', 'pas adapté à moi',
    'pas approprié', 'pas adéquat',
    'pas correspondant', 'pas en phase avec moi',
    'pas le bon moment', 'mauvais timing',
    'mauvaise période', 'pas maintenant plus tard',
    'plus tard si possible', 'peut-être une prochaine fois',
    'une prochaine fois', 'à une prochaine fois',
    'pas aujourd\'hui merci', 'pas ce soir',
    'pas cette semaine', 'pas ce mois-ci',
    'pas cette année', 'pas maintenant',
    'pas pour l\'instant', 'pas tout de suite',
    'pas immédiatement', 'pas dans l\'immédiat',
    'je dois réfléchir', 'laisse-moi réfléchir',
    'je vais y réfléchir', 'je réfléchis',
    'je pense', 'je vais voir',
    'on verra', 'on verra plus tard',
    'je reviens vers vous', 'je vous recontacte',
    'je vous dis plus tard', 'je vous tiens au courant',
    'annulation totale', 'annulation définitive',
    'je change complètement d\'avis', 'changement total',
    'je me ravise', 'je rétracte', 'je retire ma demande',
    'je retire ma commande', 'je retire mon RDV',
    'commande annulée', 'RDV annulé', 'demande annulée',
    'ne pas tenir compte', 'ignorez ma demande',
    'oubliez ma demande', 'oubliez ce que j\'ai dit',
    'j\'ai changé d\'avis', 'changement d\'avis'
];
        refuser.forEach(phrase => this.manager.addDocument('fr', phrase, 'refuser'));
             const inconnu = [
            // Lettres seules
            'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
            'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
          
            // Ponctuation seule
            '.', ',', '?', '!', ';', ':', '-', '_',
            '...', '!!', '??', '?!', '!?',
            // Combinaisons courtes
            'aa', 'bb', 'cc', 'abc',
            // Caractères spéciaux
            '@', '#', '$', '%', '^', '&', '*', '(', ')',
            '+', '=', '{', '}', '[', ']', '|', '\\', '/',
            '<', '>', '~', '`', '©', '®', '™', '€', '£', '¥'
        ];
        inconnu.forEach(phrase => this.manager.addDocument('fr', phrase, 'inconnu'));


        

        console.log('✅ Données d\'entraînement chargées - Plus de 1500 exemples au total');
    }

    // ============================================
    // AJOUT DES ENTITÉS
    // ============================================
// ============================================
// AJOUT DES ENTITÉS AVEC ABRÉVIATIONS
// ============================================
addEntities() {
    console.log('🔧 Ajout des entités avec abréviations...');

    // ============================================
    // ENTITÉ 1: MEDICAMENT (200+ valeurs avec abréviations)
    // ============================================
// ENTITÉS DE DISAMBIGUATION
// À AJOUTER DANS LA MÉTHODE addEntities()
// ============================================

// Marqueurs pour distinguer médecin vs médicament
this.manager.addNamedEntityText('type_recherche', 'medecin', ['fr'], [
    'docteur', 'médecin', 'Dr', 'Docteur', 'consultation',
    'médecin généraliste', 'spécialiste', 'cardiologue',
    'dermatologue', 'gynécologue', 'pédiatre', 'dentiste',
    'ophtalmologue', 'ORL', 'orthopédiste', 'neurologue',
    'psychiatre', 'radiologue', 'chirurgien'
]);

this.manager.addNamedEntityText('type_recherche', 'medicament', ['fr'], [
    'doliprane', 'flagyl', 'amoxicilline', 'spasfon', 'ventoline',
    'ibuprofène', 'paracétamol', 'smecta', 'augmentin', 'dafalgan',
    'efferalgan', 'clamoxyl', 'nivaquine', 'quinine', 'médicament',
    'comprimé', 'gélule', 'sirop', 'boîte', 'traitement'
]);

// Marqueurs pour distinguer prix médicament vs service clinique
this.manager.addNamedEntityText('type_prix', 'medicament', ['fr'], [
    'doliprane', 'flagyl', 'amoxicilline', 'spasfon', 'ventoline',
    'ibuprofène', 'paracétamol', 'smecta', 'augmentin', 'dafalgan',
    'comprimé', 'gélule', 'sirop', 'boîte', 'médicament'
]);

this.manager.addNamedEntityText('type_prix', 'service', ['fr'], [
    'consultation', 'visite', 'examen', 'radio', 'échographie',
    'analyse', 'prise de sang', 'intervention', 'opération',
    'hospitalisation', 'chambre', 'urgence', 'consultation médecin',
    'consultation spécialiste', 'honoraires'
]);

// Marqueurs temporels pour disponibilité
this.manager.addNamedEntityText('moment', 'present', ['fr'], [
    'aujourd\'hui', 'maintenant', 'en ce moment', 'actuellement',
    'tout de suite', 'immédiatement', 'ce soir', 'cette nuit'
]);

this.manager.addNamedEntityText('moment', 'futur', ['fr'], [
    'demain', 'après-demain', 'cette semaine', 'la semaine prochaine',
    'ce mois-ci', 'le mois prochain', 'plus tard'
]);

// Marqueurs pour distinguer les types de disponibilité
this.manager.addNamedEntityText('objet_disponibilite', 'personne', ['fr'], [
    'docteur', 'médecin', 'Dr', 'généraliste', 'spécialiste',
    'cardiologue', 'dermatologue', 'gynécologue', 'pédiatre',
    'dentiste', 'infirmier', 'pharmacien'
]);

this.manager.addNamedEntityText('objet_disponibilite', 'produit', ['fr'], [
    'médicament', 'doliprane', 'flagyl', 'amoxicilline', 'spasfon',
    'ventoline', 'ibuprofène', 'traitement', 'produit'
]);

this.manager.addNamedEntityText('objet_disponibilite', 'service', ['fr'], [
    'consultation', 'rendez-vous', 'service', 'urgence', 'garde'
]);

this.manager.addNamedEntityText('objet_disponibilite', 'lieu', ['fr'], [
    'pharmacie', 'clinique', 'hôpital', 'cabinet', 'centre'
]);
    // ============================================
    const medicaments = [
        // Antalgiques/Antipyrétiques (25)
        { nom: 'doliprane', variations: ['doliprane', 'doli', 'dolip', 'doliprane 500', 'doliprane 1000', 'doliprane enfant', 'doliprane bébé', 'doliprane adulte', 'doliprane orodispersible', 'doliprane effervescent'] },
        { nom: 'paracétamol', variations: ['paracétamol', 'paracetamol', 'para', 'acétaminophène', 'acetaminophene', 'paracétamol 500', 'paracétamol 1000'] },
        { nom: 'efferalgan', variations: ['efferalgan', 'efferal', 'efferalgan 500', 'efferalgan 1000', 'efferalgan effervescent', 'efferalgan enfant'] },
        { nom: 'dafalgan', variations: ['dafalgan', 'dafal', 'dafalgan 500', 'dafalgan 1000'] },
        { nom: 'ibuprofène', variations: ['ibuprofène', 'ibuprofene', 'ibu', 'ibu 200', 'ibu 400', 'ibuprofène 200', 'ibuprofène 400'] },
        { nom: 'advil', variations: ['advil', 'advil 200', 'advil 400', 'advil enfant', 'advil adulte'] },
        { nom: 'nurofen', variations: ['nurofen', 'nurofen enfant', 'nurofen bébé', 'nurofen 200', 'nurofen 400'] },
        { nom: 'aspirine', variations: ['aspirine', 'aspegic', 'aspirine 500', 'aspirine bébé', 'aspirine enfant', 'acide acétylsalicylique'] },
        { nom: 'ketoprofene', variations: ['kétoprofène', 'ketoprofene', 'kétum', 'profenid', 'keto'] },
        { nom: 'naproxène', variations: ['naproxène', 'naproxene', 'naprosyn', 'apranax'] },
        { nom: 'diclofenac', variations: ['diclofénac', 'diclofenac', 'voltaren', 'flector', 'diclofenac sodique'] },
        { nom: 'tramadol', variations: ['tramadol', 'tramadol 50', 'tramadol 100', 'topalgic', 'contramal'] },
        { nom: 'codeine', variations: ['codéine', 'codeine', 'codoliprane', 'dafalgan codéiné', 'efferalgan codéiné'] },
        
        // Antibiotiques (25)
        { nom: 'amoxicilline', variations: ['amoxicilline', 'amox', 'amoxiciline', 'amoxicilline 500', 'amoxicilline 1g', 'amoxicilline sirop', 'amoxicilline bébé'] },
        { nom: 'augmentin', variations: ['augmentin', 'augmentin 500', 'augmentin 1g', 'augmentin sirop', 'amoxicilline acide clavulanique'] },
        { nom: 'flagyl', variations: ['flagyl', 'métronidazole', 'metronidazole', 'flagyl 125', 'flagyl 250', 'flagyl 500'] },
        { nom: 'clamoxyl', variations: ['clamoxyl', 'clamoxyl 500', 'clamoxyl 1g', 'clamoxyl sirop'] },
        { nom: 'bactrim', variations: ['bactrim', 'cotrimoxazole', 'sulfaméthoxazole triméthoprime', 'bactrim forte'] },
        { nom: 'cefixime', variations: ['céfixime', 'cefixime', 'oroken', 'cefpodoxime'] },
        { nom: 'ceftriaxone', variations: ['ceftriaxone', 'ceftriaxone injectable', 'rocephine'] },
        { nom: 'azithromycine', variations: ['azithromycine', 'azithromycine', 'zithromax', 'azadose'] },
        { nom: 'doxycycline', variations: ['doxycycline', 'doxy', 'vibramycine', 'doxypalu'] },
        { nom: 'ciprofloxacine', variations: ['ciprofloxacine', 'cipro', 'ciflox'] },
        { nom: 'levofloxacine', variations: ['lévofloxacine', 'levofloxacine', 'tavanic'] },
        { nom: 'clindamycine', variations: ['clindamycine', 'dalacine'] },
        { nom: 'gentamicine', variations: ['gentamicine', 'genta', 'gentalline'] },
        
        // Antipaludiques (20)
        { nom: 'artesunate', variations: ['artésunate', 'artesunate', 'ars', 'artésunate injectable', 'artésunate rectal'] },
        { nom: 'quinine', variations: ['quinine', 'quinimax', 'quiniform', 'quinine injectable'] },
        { nom: 'nivaquine', variations: ['nivaquine', 'chloroquine', 'nivaquine sirop', 'nivaquine comprimé'] },
        { nom: 'coartem', variations: ['coartem', 'artéméther', 'artemether', 'lumefantrine'] },
        { nom: 'paluther', variations: ['paluther', 'artéméther injectable', 'artemether injectable'] },
        { nom: 'fansidar', variations: ['fansidar', 'sulfadoxine pyriméthamine'] },
        { nom: 'malarone', variations: ['malarone', 'atovaquone proguanil'] },
        { nom: 'halfan', variations: ['halfan', 'halofantrine'] },
        
        // Antispasmodiques et Digestifs (20)
        { nom: 'spasfon', variations: ['spasfon', 'spas', 'spasfon 80', 'spasfon comprimé', 'spasfon sirop', 'spasfon injectable'] },
        { nom: 'smecta', variations: ['smecta', 'smec', 'smecta sachet', 'smecta poudre', 'diosmectite'] },
        { nom: 'debridat', variations: ['débridat', 'debridat', 'trimébutine', 'trimebutine'] },
        { nom: 'météospasmyl', variations: ['météospasmyl', 'meteospasmyl', 'météo'] },
        { nom: 'citrate betaine', variations: ['citrate de bétaïne', 'citrate betaine', 'citar'] },
        { nom: 'helicidine', variations: ['hélicidine', 'helicidine', 'sirop toux'] },
        { nom: 'pavacol', variations: ['pavacol', 'sirop toux sèche'] },
        { nom: 'hexapneumine', variations: ['hexapneumine', 'sirop toux grasse'] },
        
        // Respiratoires (15)
        { nom: 'ventoline', variations: ['ventoline', 'vent', 'ventoline spray', 'ventoline inhalateur', 'salbutamol'] },
        { nom: 'seretide', variations: ['sérétide', 'seretide', 'fluticasone salmétérol'] },
        { nom: 'pulmicort', variations: ['pulmicort', 'budésonide', 'budesonide'] },
        { nom: 'atrovent', variations: ['atrovent', 'ipratropium'] },
        { nom: 'oxis', variations: ['oxis', 'formotérol', 'formoterol'] },
        { nom: 'singulair', variations: ['singulair', 'montelukast'] },
        
        // Cardiovasculaires (15)
        { nom: 'amlodipine', variations: ['amlodipine', 'amlodipine 5', 'amlodipine 10'] },
        { nom: 'lasilix', variations: ['lasilix', 'furosémide', 'furosemide', 'lasilix 40'] },
        { nom: 'atenolol', variations: ['aténolol', 'atenolol', 'ténormine'] },
        { nom: 'cardensiel', variations: ['cardensiel', 'bisoprolol'] },
        { nom: 'coversyl', variations: ['coversyl', 'périndopril', 'perindopril'] },
        { nom: 'cozaar', variations: ['cozaar', 'losartan'] },
        { nom: 'apatz', variations: ['apatz', 'irbésartan', 'irbesartan'] },
        
        // Diabète (10)
        { nom: 'metformine', variations: ['metformine', 'metformine 500', 'metformine 1000', 'glucophage'] },
        { nom: 'glucophage', variations: ['glucophage', 'glucophage 500', 'glucophage 1000'] },
        { nom: 'diamicron', variations: ['diamicron', 'gliclazide'] },
        { nom: 'amarel', variations: ['amarel', 'glimépiride', 'glimepiride'] },
        
        // Corticostéroïdes (10)
        { nom: 'dexamethasone', variations: ['dexaméthasone', 'dexamethasone', 'dex', 'dexaméthasone 4mg'] },
        { nom: 'prednisolone', variations: ['prednisolone', 'pred', 'prednisolone 5mg', 'prednisolone 20mg'] },
        { nom: 'prednisone', variations: ['prednisone', 'cortancyl'] },
        { nom: 'betamethasone', variations: ['bétaméthasone', 'betamethasone', 'bétne'] },
        
        // Dermatologiques (10)
        { nom: 'diprosone', variations: ['diprosone', 'crème diprosone'] },
        { nom: 'kenacort', variations: ['kénacort', 'kenacort', 'pommade kenacort'] },
        { nom: 'lamisil', variations: ['lamisil', 'terbinafine', 'crème terbinafine'] },
        { nom: 'pevaryl', variations: ['pévaryl', 'pevaryl', 'éconazole', 'econazole'] },
        
        // Ophtalmologiques (5)
        { nom: 'cicloplegique', variations: ['cicloplégique', 'cicloplegique', 'collyre'] },
        { nom: 'chloramphénicol', variations: ['chloramphénicol', 'chloramphenicol', 'collyre antibiotique'] },
        
        // Autres courants (25)
        { nom: 'vitamine C', variations: ['vitamine C', 'vit c', 'acide ascorbique'] },
        { nom: 'vitamine D', variations: ['vitamine D', 'vit d', 'zyma d'] },
        { nom: 'fer', variations: ['fer', 'fer sulfate', 'tardyferon'] },
        { nom: 'zinc', variations: ['zinc', 'zinc sirop', 'zinc enfant'] },
        { nom: 'magnésium', variations: ['magnésium', 'magné B6', 'magnesium'] },
        { nom: 'ginseng', variations: ['ginseng', 'ginseng gélules'] },
        { nom: 'ginkgo', variations: ['ginkgo', 'ginkgo biloba'] },
        { nom: 'oméga 3', variations: ['oméga 3', 'omega 3', 'huile de poisson'] },
        { nom: 'spiruline', variations: ['spiruline', 'spiruline comprimés'] },
        { nom: 'gelule', variations: ['gélule', 'gelule'] },
        { nom: 'comprimé', variations: ['comprimé', 'comprime', 'cp'] },
        { nom: 'sirop', variations: ['sirop', 'srop', 'sirop pour enfant'] },
        { nom: 'pommade', variations: ['pommade', 'pomade', 'crème'] },
        { nom: 'injectable', variations: ['injectable', 'injection', 'piqûre', 'piqure'] }
    ];
    
    medicaments.forEach(med => {
        this.manager.addNamedEntityText('medicament', med.nom, ['fr'], med.variations);
    });

    // ============================================
    // ENTITÉ 2: LOCALITE (200+ valeurs avec abréviations)
    // ============================================
    const localites = [
        // Communes d'Abidjan (15)
        { nom: 'cocody', variations: ['cocody', 'cocody-ango', 'cocodi', 'cocody centre', 'cocody saint jean'] },
        { nom: 'marcory', variations: ['marcory', 'marcory centre', 'marcory zone 4', 'marcory liberte'] },
        { nom: 'yopougon', variations: ['yopougon', 'yop city', 'yop', 'yopougon centre', 'yopougon sicogi', 'yopougon koweit'] },
        { nom: 'plateau', variations: ['plateau', 'le plateau', 'plateau centre', 'plateau tour'] },
        { nom: 'treichville', variations: ['treichville', 'treich', 'treichville centre', 'treichville gare'] },
        { nom: 'koumassi', variations: ['koumassi', 'koumassi centre', 'koumassi prodomo'] },
        { nom: 'abobo', variations: ['abobo', 'abobo centre', 'abobo baoule', 'abobo avocatier'] },
        { nom: 'adjame', variations: ['adjame', 'adjamé', 'adjame centre', 'adjame liberte'] },
        { nom: 'port-bouet', variations: ['port-bouet', 'port bouet', 'portb', 'port-bouet centre'] },
        { nom: 'bingerville', variations: ['bingerville', 'binger', 'bingerville centre'] },
        { nom: 'anyama', variations: ['anyama', 'anyama centre'] },
        { nom: 'songon', variations: ['songon', 'songon centre', 'songon agban'] },
        { nom: 'grand-bassam', variations: ['grand-bassam', 'grand bassam', 'bassam'] },
        
        // Quartiers Cocody (20)
        { nom: 'deux plateaux', variations: ['deux plateaux', '2 plateaux', '2p', '2-plateaux', 'deux plateaux centre'] },
        { nom: 'riviera', variations: ['riviera', 'riviera 2', 'riviera 3', 'riviera bonoumin', 'riviera golf'] },
        { nom: 'angré', variations: ['angré', 'angré centre', 'angré château', 'angré 7ème'] },
        { nom: 'palmeraie', variations: ['palmeraie', 'la palmeraie'] },
        { nom: 'mermoz', variations: ['mermoz', 'mermoz centre'] },
        { nom: 'les oscars', variations: ['les oscars', 'oscars'] },
        { nom: 'cité des arts', variations: ['cité des arts', 'cité arts'] },
        
        // Quartiers Marcory (10)
        { nom: 'zone 4', variations: ['zone 4', 'zone4', 'zone 4 marcory'] },
        { nom: 'zone 4c', variations: ['zone 4c', '4c'] },
        { nom: 'biétry', variations: ['biétry', 'bietry'] },
        { nom: 'selmer', variations: ['selmer', 'selmer marcory'] },
        
        // Quartiers Yopougon (15)
        { nom: 'sicogi', variations: ['sicogi', 'yopougon sicogi'] },
        { nom: 'koweit', variations: ['koweit', 'koweit yopougon'] },
        { nom: 'niangon', variations: ['niangon', 'niangon locodjo'] },
        { nom: 'andokoi', variations: ['andokoi', 'andokoi yopougon'] },
        { nom: 'toits rouges', variations: ['toits rouges', 'toit rouge'] },
        { nom: 'selmer', variations: ['selmer yopougon', 'selmer'] },
        
        // Quartiers Abobo (10)
        { nom: 'baoulé', variations: ['baoulé', 'abobo baoulé'] },
        { nom: 'avocatier', variations: ['avocatier', 'abobo avocatier'] },
        { nom: 'samanké', variations: ['samanké', 'samanke'] },
        { nom: 'pk 18', variations: ['pk 18', 'pk18'] },
        
        // Villes de l'intérieur (50)
        { nom: 'bouaké', variations: ['bouaké', 'bouake', 'bké'] },
        { nom: 'korhogo', variations: ['korhogo', 'kor', 'koro'] },
        { nom: 'san-pedro', variations: ['san-pedro', 'san pedro', 'sp', 's-p'] },
        { nom: 'yamoussoukro', variations: ['yamoussoukro', 'yam', 'yamous', 'yakro'] },
        { nom: 'daloa', variations: ['daloa', 'dala'] },
        { nom: 'man', variations: ['man', 'man ville'] },
        { nom: 'gagnoa', variations: ['gagnoa', 'gag'] },
        { nom: 'odienné', variations: ['odienné', 'odienne', 'od'] },
        { nom: 'bondoukou', variations: ['bondoukou', 'bondi'] },
        { nom: 'abengourou', variations: ['abengourou', 'abeng'] },
        { nom: 'divo', variations: ['divo'] },
        { nom: 'soubré', variations: ['soubré', 'soubre'] },
        { nom: 'guiglo', variations: ['guiglo'] },
        { nom: 'agnibilékrou', variations: ['agnibilékrou', 'agnibilekrou'] },
        { nom: 'adzopé', variations: ['adzopé', 'adzope'] },
        { nom: 'agboville', variations: ['agboville'] },
        { nom: 'tiassalé', variations: ['tiassalé', 'tiassale'] },
        { nom: 'toumodi', variations: ['toumodi'] },
        { nom: 'sinfra', variations: ['sinfra'] },
        { nom: 'vavoua', variations: ['vavoua'] },
        { nom: 'duékoué', variations: ['duékoué', 'duekoue'] },
        { nom: 'issia', variations: ['issia'] },
        { nom: 'bouaflé', variations: ['bouaflé', 'bouafle'] },
        { nom: 'bonoua', variations: ['bonoua'] },
        { nom: 'aboisso', variations: ['aboisso'] },
        { nom: 'adiaké', variations: ['adiaké', 'adiake'] },
        { nom: 'ferkessédougou', variations: ['ferkessédougou', 'ferke'] },
        { nom: 'boundiali', variations: ['boundiali'] },
        { nom: 'tengrela', variations: ['tengrela'] },
        { nom: 'ouangolodougou', variations: ['ouangolodougou'] },
        { nom: 'kong', variations: ['kong'] },
        { nom: 'katiola', variations: ['katiola'] },
        { nom: 'dabakala', variations: ['dabakala'] },
        { nom: 'mankono', variations: ['mankono'] },
        { nom: 'séguéla', variations: ['séguéla', 'seguela'] },
        { nom: 'touba', variations: ['touba'] },
        { nom: 'biankouma', variations: ['biankouma'] },
        { nom: 'danané', variations: ['danané', 'danane'] },
        { nom: 'zouan-hounien', variations: ['zouan-hounien', 'zouan hounien'] },
        { nom: 'toulépleu', variations: ['toulépleu', 'toulepleu'] },
        
        // Expressions génériques (10)
        { nom: 'proche', variations: ['proche', 'près', 'à côté', 'pas loin', 'à proximité'] },
        { nom: 'centre ville', variations: ['centre ville', 'centre-ville', 'centre'] },
        { nom: 'quartier', variations: ['quartier', 'mon quartier', 'ma zone'] },
        { nom: 'domicile', variations: ['domicile', 'chez moi', 'maison'] }
    ];
    
    localites.forEach(loc => {
        this.manager.addNamedEntityText('localite', loc.nom, ['fr'], loc.variations);
    });

    // ============================================
    // ENTITÉ 3: NUMERO (1-200 avec abréviations)
    // ============================================
    for (let i = 1; i <= 200; i++) {
        const variations = [
            i.toString(),
            `numéro ${i}`,
            `n°${i}`,
            `n ${i}`,
            `#${i}`,
            `le ${i}`,
            `le numéro ${i}`,
            `option ${i}`,
            `choix ${i}`
        ];
        
        // Ajouter les formes ordinales pour les premiers nombres
        if (i === 1) variations.push('premier', '1er', 'le premier');
        if (i === 2) variations.push('deuxième', 'second', '2ème', '2e', 'le deuxième');
        if (i === 3) variations.push('troisième', '3ème', '3e', 'le troisième');
        if (i === 4) variations.push('quatrième', '4ème', '4e', 'le quatrième');
        if (i === 5) variations.push('cinquième', '5ème', '5e', 'le cinquième');
        if (i === 6) variations.push('sixième', '6ème', '6e', 'le sixième');
        if (i === 7) variations.push('septième', '7ème', '7e', 'le septième');
        if (i === 8) variations.push('huitième', '8ème', '8e', 'le huitième');
        if (i === 9) variations.push('neuvième', '9ème', '9e', 'le neuvième');
        if (i === 10) variations.push('dixième', '10ème', '10e', 'le dixième');
        
        this.manager.addNamedEntityText('numero', i.toString(), ['fr'], variations);
    }

    // ============================================
    // ENTITÉ 4: QUANTITE (1-100 avec abréviations)
    // ============================================
    for (let i = 1; i <= 100; i++) {
        const variations = [
            i.toString(),
            `${i} boîtes`,
            `${i} boite`,
            `${i} bt`,
            `${i} comprimés`,
            `${i} cp`,
            `${i} gélules`,
            `${i} gel`,
            `${i} sachets`,
            `${i} sach`,
            `${i} flacons`,
            `${i} fl`,
            `${i} tubes`,
            `${i} sprays`,
            `${i} ampoules`,
            `${i} amp`,
            `${i} doses`,
            `${i} unites`,
            `${i} uni`,
            `quantité ${i}`,
            `qté ${i}`,
            `qty ${i}`
        ];
        
        // Pour les petites quantités, ajouter des formulations spécifiques
        if (i === 1) variations.push('un', 'une', 'une boîte', 'un seul', 'une seule');
        if (i === 2) variations.push('deux', 'deux boîtes', 'double');
        if (i === 3) variations.push('trois');
        if (i === 4) variations.push('quatre');
        if (i === 5) variations.push('cinq');
        if (i === 6) variations.push('six');
        if (i === 7) variations.push('sept');
        if (i === 8) variations.push('huit');
        if (i === 9) variations.push('neuf');
        if (i === 10) variations.push('dix', 'une dizaine');
        
        this.manager.addNamedEntityText('quantite', i.toString(), ['fr'], variations);
    }

    // ============================================
    // ENTITÉ 5: DATE (100+ valeurs avec abréviations)
    // ============================================
    const dates = [
        // Jours relatifs (15)
        { nom: 'aujourd\'hui', variations: ['aujourd\'hui', 'ajd', 'auj', 'ce jour'] },
        { nom: 'demain', variations: ['demain', 'dm', 'le jour suivant'] },
        { nom: 'après-demain', variations: ['après-demain', 'apres demain', 'après demain', 'apd'] },
        { nom: 'hier', variations: ['hier'] },
        { nom: 'maintenant', variations: ['maintenant', 'tout de suite', 'immédiatement'] },
        
        // Jours de la semaine (14)
        { nom: 'lundi', variations: ['lundi', 'lun', 'l'] },
        { nom: 'mardi', variations: ['mardi', 'mar', 'ma'] },
        { nom: 'mercredi', variations: ['mercredi', 'mer', 'me'] },
        { nom: 'jeudi', variations: ['jeudi', 'jeu', 'j'] },
        { nom: 'vendredi', variations: ['vendredi', 'ven', 'v'] },
        { nom: 'samedi', variations: ['samedi', 'sam', 's'] },
        { nom: 'dimanche', variations: ['dimanche', 'dim', 'd'] },
        
        // Périodes (20)
        { nom: 'ce matin', variations: ['ce matin', 'c matin'] },
        { nom: 'cet après-midi', variations: ['cet après-midi', 'cet apres-midi', 'cet am'] },
        { nom: 'ce soir', variations: ['ce soir', 'c soir'] },
        { nom: 'cette nuit', variations: ['cette nuit', 'cette nuit'] },
        { nom: 'cette semaine', variations: ['cette semaine', 'cette sem', 'cette sm'] },
        { nom: 'la semaine prochaine', variations: ['la semaine prochaine', 'semaine prochaine', 'sem proch'] },
        { nom: 'la semaine dernière', variations: ['la semaine dernière', 'semaine dernière', 'sem dern'] },
        { nom: 'ce mois-ci', variations: ['ce mois-ci', 'ce mois'] },
        { nom: 'le mois prochain', variations: ['le mois prochain', 'mois prochain'] },
        { nom: 'le mois dernier', variations: ['le mois dernier', 'mois dernier'] },
        { nom: 'cette année', variations: ['cette année', 'cette annee'] },
        { nom: 'l\'année prochaine', variations: ['l\'année prochaine', 'annee prochaine'] },
        { nom: 'l\'année dernière', variations: ['l\'année dernière', 'annee derniere'] },
        
        // Fêtes et jours fériés (15)
        { nom: 'noël', variations: ['noël', 'noel', '25 décembre'] },
        { nom: 'nouvel an', variations: ['nouvel an', 'jour de l\'an', '1er janvier'] },
        { nom: 'pâques', variations: ['pâques', 'paques'] },
        { nom: 'tabaski', variations: ['tabaski', 'fête du mouton'] },
        { nom: 'ramadan', variations: ['ramadan', 'ramadan'] },
        { nom: 'korité', variations: ['korité', 'korite'] },
        { nom: 'fête nationale', variations: ['fête nationale', '7 août', '7 aout'] },
        { nom: '1er mai', variations: ['1er mai', 'premier mai', 'fête du travail'] },
        { nom: '15 août', variations: ['15 août', '15 aout'] },
        
        // Formats numériques (10)
        { nom: 'jj/mm/aaaa', variations: ['15/04/2026', '15-04-2026', '15.04.2026'] },
        { nom: 'jj/mm/aa', variations: ['15/04/26', '15-04-26'] },
        { nom: 'jj mois aaaa', variations: ['15 avril 2026', '15 avr 2026'] }
    ];
    
    dates.forEach(date => {
        this.manager.addNamedEntityText('date', date.nom, ['fr'], date.variations);
    });

    // ============================================
    // ENTITÉ 6: MOIS (12 mois avec abréviations)
    // ============================================
    const moisList = [
        { nom: 'janvier', variations: ['janvier', 'janv', 'jan', '01'] },
        { nom: 'février', variations: ['février', 'fevrier', 'fév', 'fev', '02'] },
        { nom: 'mars', variations: ['mars', 'mar', '03'] },
        { nom: 'avril', variations: ['avril', 'avr', '04'] },
        { nom: 'mai', variations: ['mai', '05'] },
        { nom: 'juin', variations: ['juin', '06'] },
        { nom: 'juillet', variations: ['juillet', 'juil', 'juill', '07'] },
        { nom: 'août', variations: ['août', 'aout', '08'] },
        { nom: 'septembre', variations: ['septembre', 'sept', 'sep', '09'] },
        { nom: 'octobre', variations: ['octobre', 'oct', '10'] },
        { nom: 'novembre', variations: ['novembre', 'nov', '11'] },
        { nom: 'décembre', variations: ['décembre', 'decembre', 'dec', '12'] }
    ];
    
    moisList.forEach(mois => {
        this.manager.addNamedEntityText('mois', mois.nom, ['fr'], mois.variations);
    });

    // ============================================
    // ENTITÉ 7: HEURE (288 valeurs - toutes les 5 minutes)
    // ============================================
    const heures = [];
    for (let h = 0; h <= 23; h++) {
        for (let m = 0; m < 60; m += 5) {
            const heureFormatee = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            const heureSimple = m === 0 ? `${h}h` : `${h}h${m}`;
            const heure12 = m === 0 ? `${h % 12 || 12}h` : `${h % 12 || 12}h${m}`;
            const periode = h < 12 ? 'matin' : h < 18 ? 'après-midi' : 'soir';
            
            const variations = [
                heureFormatee,
                heureSimple,
                `${heureSimple} ${periode}`,
                `${h}:${m}`,
                `${h}.${m}`,
                `${h}h${m.toString().padStart(2, '0')}`
            ];
            
            // Ajouter quelques formulations courantes
            if (h === 0 && m === 0) variations.push('minuit');
            if (h === 12 && m === 0) variations.push('midi');
            if (h === 8 && m === 0) variations.push('8h du matin');
            if (h === 18 && m === 0) variations.push('18h du soir');
            
            this.manager.addNamedEntityText('heure', heureFormatee, ['fr'], variations);
        }
    }

    // ============================================
    // ENTITÉ 8: COMMANDE_ID (50 IDs avec formats variés)
    // ============================================
    const commandeIds = [
        // Format CMD + date + numéro
        { nom: 'CMD202402150001', variations: ['CMD202402150001', 'CMD 202402150001', 'commande CMD202402150001'] },
        { nom: 'CMD202402150002', variations: ['CMD202402150002', 'CMD 202402150002'] },
        { nom: 'CMD202402150003', variations: ['CMD202402150003', 'CMD 202402150003'] },
        { nom: 'CMD202402150004', variations: ['CMD202402150004', 'CMD 202402150004'] },
        { nom: 'CMD202402150005', variations: ['CMD202402150005', 'CMD 202402150005'] },
        
        // Format simple
        { nom: 'CMD123', variations: ['CMD123', 'CMD 123', 'commande 123'] },
        { nom: 'CMD456', variations: ['CMD456', 'CMD 456', 'commande 456'] },
        { nom: 'CMD789', variations: ['CMD789', 'CMD 789', 'commande 789'] },
        
        // Format avec tiret
        { nom: 'CMD-2024-001', variations: ['CMD-2024-001', 'CMD2024-001'] },
        { nom: 'CMD-2024-002', variations: ['CMD-2024-002', 'CMD2024-002'] },
        
        // Format avec underscore
        { nom: 'CMD_2024_001', variations: ['CMD_2024_001', 'CMD2024_001'] },
        
        // Numéros simples
        { nom: '12345', variations: ['12345', 'commande 12345'] },
        { nom: '67890', variations: ['67890', 'commande 67890'] },
        { nom: '11223', variations: ['11223', 'commande 11223'] },
        { nom: '44556', variations: ['44556', 'commande 44556'] },
        { nom: '77889', variations: ['77889', 'commande 77889'] },
        
        // Autres formats courants
        { nom: 'CMD001', variations: ['CMD001', 'CMD 001'] },
        { nom: 'CMD002', variations: ['CMD002', 'CMD 002'] },
        { nom: 'CMD003', variations: ['CMD003', 'CMD 003'] },
        { nom: 'CMD004', variations: ['CMD004', 'CMD 004'] },
        { nom: 'CMD005', variations: ['CMD005', 'CMD 005'] },
        
        // Pour les tests
        { nom: 'CMD-TEST-001', variations: ['CMD-TEST-001', 'CMD TEST 001'] },
        { nom: 'CMD-TEST-002', variations: ['CMD-TEST-002', 'CMD TEST 002'] }
    ];
    
    commandeIds.forEach(cmd => {
        this.manager.addNamedEntityText('commande_id', cmd.nom, ['fr'], cmd.variations);
    });

    // ============================================
    // ENTITÉ 9: RDV_ID (30 IDs avec formats variés)
    // ============================================
    const rdvIds = [
        // Format RDV + date + numéro
        { nom: 'RDV2026030201', variations: ['RDV2026030201', 'RDV 2026030201', 'rdv RDV2026030201'] },
        { nom: 'RDV2026030202', variations: ['RDV2026030202', 'RDV 2026030202'] },
        { nom: 'RDV2026030203', variations: ['RDV2026030203', 'RDV 2026030203'] },
        
        // Format simple
        { nom: 'RDV123', variations: ['RDV123', 'RDV 123', 'rendez-vous 123'] },
        { nom: 'RDV456', variations: ['RDV456', 'RDV 456'] },
        { nom: 'RDV789', variations: ['RDV789', 'RDV 789'] },
        
        // Format avec tiret
        { nom: 'RDV-2024-001', variations: ['RDV-2024-001', 'RDV2024-001'] },
        { nom: 'RDV-2024-002', variations: ['RDV-2024-002', 'RDV2024-002'] },
        
        // Format médical
        { nom: 'CONS-2024-001', variations: ['CONS-2024-001', 'consultation-2024-001'] },
        { nom: 'CONS-2024-002', variations: ['CONS-2024-002', 'consultation-2024-002'] },
        
        // Autres formats
        { nom: 'R20240301', variations: ['R20240301', 'R 20240301'] },
        { nom: 'R20240302', variations: ['R20240302', 'R 20240302'] },
        { nom: 'APPT001', variations: ['APPT001', 'APPT 001'] },
        { nom: 'APPT002', variations: ['APPT002', 'APPT 002'] }
    ];
    
    rdvIds.forEach(rdv => {
        this.manager.addNamedEntityText('rdv_id', rdv.nom, ['fr'], rdv.variations);
    });

    // ============================================
    // ENTITÉ 10: MODE_PAIEMENT (30 valeurs avec abréviations)
    // ============================================
    const modesPaiement = [
        // Mobile Money (10)
        { nom: 'Orange Money', variations: ['Orange Money', 'OM', 'orange money', 'orange', 'orange money ci'] },
        { nom: 'Wave', variations: ['Wave', 'wave', 'wave ci', 'wave money'] },
        { nom: 'Moov Money', variations: ['Moov Money', 'moov', 'moov money', 'moov money ci'] },
        { nom: 'MTN Money', variations: ['MTN Money', 'mtn', 'mtn money', 'mtn money ci'] },
        { nom: 'Mobile Money', variations: ['Mobile Money', 'mobile money', 'Momo', 'momo'] },
        
        // Cartes bancaires (8)
        { nom: 'carte Visa', variations: ['carte Visa', 'visa', 'carte visa', 'Visa'] },
        { nom: 'Mastercard', variations: ['Mastercard', 'mastercard', 'carte mastercard', 'master card'] },
        { nom: 'carte bancaire', variations: ['carte bancaire', 'carte bleue', 'carte de crédit', 'credit card'] },
        { nom: 'American Express', variations: ['American Express', 'amex', 'carte amex'] },
        
        // Paiement à la livraison (5)
        { nom: 'paiement à la livraison', variations: ['paiement à la livraison', 'paiement livraison', 'paiement à réception', 'espèces livraison', 'cash livraison'] },
        { nom: 'espèces', variations: ['espèces', 'cash', 'liquide', 'numéraire'] },
        
        // Autres moyens (7)
        { nom: 'virement bancaire', variations: ['virement bancaire', 'virement', 'transfert'] },
        { nom: 'Western Union', variations: ['Western Union', 'western', 'wU'] },
        { nom: 'MoneyGram', variations: ['MoneyGram', 'money gram', 'mg'] },
        { nom: 'paiement en ligne', variations: ['paiement en ligne', 'paiement internet', 'en ligne'] },
        { nom: 'carte prépayée', variations: ['carte prépayée', 'carte prepayee'] }
    ];
    
    modesPaiement.forEach(mode => {
        this.manager.addNamedEntityText('mode_paiement', mode.nom, ['fr'], mode.variations);
    });

    // ============================================
// AJOUT DES ENTITÉS RESTANTES (11-21) AVEC 200+ EXEMPLES CHACUNE
// ============================================


    // ============================================
    // ENTITÉ 11: CLINIQUE (200+ noms avec abréviations)
    // ============================================
    const cliniques = [
        // Grandes cliniques d'Abidjan (40)
        { nom: 'Sainte Anne', variations: ['Sainte Anne', 'Ste Anne', 'Clinique Sainte Anne', 'Hopital Sainte Anne', 'Ste Anne clinique'] },
        { nom: 'CHU', variations: ['CHU', 'Centre Hospitalier Universitaire', 'CHU de Cocody', 'CHU de Treichville', 'CHU de Yopougon'] },
        { nom: 'CMA', variations: ['CMA', 'Centre Médical d\'Arrondissement', 'CMA Cocody', 'CMA Marcory', 'CMA Yopougon'] },
        { nom: 'Polyclinique', variations: ['Polyclinique', 'Polyclinique Farah', 'Polyclinique Avicenne', 'Polyclinique Ste Anne'] },
        { nom: 'Clinique Farah', variations: ['Clinique Farah', 'Farah', 'Clinique Farah Riviera'] },
        { nom: 'Clinique Avicenne', variations: ['Clinique Avicenne', 'Avicenne', 'Hopital Avicenne'] },
        { nom: 'Clinique Galilee', variations: ['Clinique Galilee', 'Galilee', 'Hopital Galilee'] },
        { nom: 'Clinique Pasteur', variations: ['Clinique Pasteur', 'Pasteur', 'Institut Pasteur'] },
        { nom: 'Clinique La Corniche', variations: ['Clinique La Corniche', 'Corniche', 'La Corniche'] },
        { nom: 'Clinique Les Ambassades', variations: ['Clinique Les Ambassades', 'Ambassades', 'Les Ambassades'] },
        { nom: 'Clinique Hopital Général', variations: ['Hopital Général', 'HG', 'Hopital General d\'Abidjan'] },
        { nom: 'Clinique Le Luxembourg', variations: ['Clinique Le Luxembourg', 'Luxembourg', 'Hopital Luxembourg'] },
        { nom: 'Clinique Hôpital Militaire', variations: ['Hôpital Militaire', 'Hopital Militaire', 'Camp Gallieni'] },
        { nom: 'Clinique La Roseraie', variations: ['Clinique La Roseraie', 'Roseraie', 'La Roseraie'] },
        { nom: 'Clinique Les Orchidées', variations: ['Clinique Les Orchidées', 'Orchidées', 'Les Orchidees'] },
        
        // CHU spécifiques (20)
        { nom: 'CHU Cocody', variations: ['CHU Cocody', 'CHU de Cocody', 'Cocody CHU'] },
        { nom: 'CHU Treichville', variations: ['CHU Treichville', 'CHU de Treichville', 'Treichville CHU'] },
        { nom: 'CHU Yopougon', variations: ['CHU Yopougon', 'CHU de Yopougon', 'Yopougon CHU'] },
        { nom: 'CHU Bouaké', variations: ['CHU Bouaké', 'CHU de Bouaké', 'Bouaké CHU'] },
        
        // Hôpitaux régionaux (30)
        { nom: 'Hopital Regional Bouaké', variations: ['Hopital Regional Bouaké', 'HR Bouaké'] },
        { nom: 'Hopital Regional Korhogo', variations: ['Hopital Regional Korhogo', 'HR Korhogo'] },
        { nom: 'Hopital Regional San Pedro', variations: ['Hopital Regional San Pedro', 'HR San Pedro'] },
        { nom: 'Hopital Regional Yamoussoukro', variations: ['Hopital Regional Yamoussoukro', 'HR Yamoussoukro'] },
        { nom: 'Hopital Regional Daloa', variations: ['Hopital Regional Daloa', 'HR Daloa'] },
        { nom: 'Hopital Regional Man', variations: ['Hopital Regional Man', 'HR Man'] },
        { nom: 'Hopital Regional Gagnoa', variations: ['Hopital Regional Gagnoa', 'HR Gagnoa'] },
        { nom: 'Hopital Regional Odienné', variations: ['Hopital Regional Odienné', 'HR Odienné'] },
        { nom: 'Hopital Regional Bondoukou', variations: ['Hopital Regional Bondoukou', 'HR Bondoukou'] },
        { nom: 'Hopital Regional Abengourou', variations: ['Hopital Regional Abengourou', 'HR Abengourou'] },
        
        // Centres de santé urbains (30)
        { nom: 'Centre de Santé Cocody', variations: ['Centre de Santé Cocody', 'CS Cocody'] },
        { nom: 'Centre de Santé Marcory', variations: ['Centre de Santé Marcory', 'CS Marcory'] },
        { nom: 'Centre de Santé Yopougon', variations: ['Centre de Santé Yopougon', 'CS Yopougon'] },
        { nom: 'Centre de Santé Abobo', variations: ['Centre de Santé Abobo', 'CS Abobo'] },
        { nom: 'Centre de Santé Koumassi', variations: ['Centre de Santé Koumassi', 'CS Koumassi'] },
        { nom: 'Centre de Santé Port Bouet', variations: ['Centre de Santé Port Bouet', 'CS Port Bouet'] },
        { nom: 'PMI', variations: ['PMI', 'Protection Maternelle Infantile'] },
        { nom: 'Formation Sanitaire', variations: ['Formation Sanitaire', 'FS'] },
        
        // Cliniques privées spécialisées (30)
        { nom: 'Clinique Cardiologique', variations: ['Clinique Cardiologique', 'Cardio Clinique', 'Centre Cardio'] },
        { nom: 'Clinique Ophtalmologique', variations: ['Clinique Ophtalmologique', 'Ophtalmo Clinique', 'Institut Ophtalmo'] },
        { nom: 'Clinique Dentaire', variations: ['Clinique Dentaire', 'Centre Dentaire', 'Cabinet Dentaire'] },
        { nom: 'Clinique Gynécologique', variations: ['Clinique Gynécologique', 'Gynéco Clinique', 'Centre Gynéco'] },
        { nom: 'Clinique Pédiatrique', variations: ['Clinique Pédiatrique', 'Pédiatrie', 'Centre Enfant'] },
        { nom: 'Clinique Dermatologique', variations: ['Clinique Dermatologique', 'Dermato Clinique'] },
        { nom: 'Clinique ORL', variations: ['Clinique ORL', 'ORL Clinique', 'Centre ORL'] },
        { nom: 'Clinique Orthopédique', variations: ['Clinique Orthopédique', 'Ortho Clinique', 'Traumato'] },
        
        // Maternités (20)
        { nom: 'Maternité Cocody', variations: ['Maternité Cocody', 'Maternite Cocody'] },
        { nom: 'Maternité Yopougon', variations: ['Maternité Yopougon', 'Maternite Yopougon'] },
        { nom: 'Maternité Abobo', variations: ['Maternité Abobo', 'Maternite Abobo'] },
        { nom: 'Clinique Maternité', variations: ['Clinique Maternité', 'Maternité', 'Maternite'] },
        
        // Laboratoires (20)
        { nom: 'Laboratoire Biologie', variations: ['Laboratoire Biologie', 'Labo Biologie', 'Labo Analyses'] },
        { nom: 'Laboratoire Médical', variations: ['Laboratoire Médical', 'Labo Medical', 'Labo'] },
        { nom: 'Laboratoire d\'Analyses', variations: ['Laboratoire d\'Analyses', 'Labo Analyses Medicales'] },
        
        // Pharmacies principales (10)
        { nom: 'Pharmacie Principale', variations: ['Pharmacie Principale', 'Grande Pharmacie'] },
        { nom: 'Pharmacie des Arts', variations: ['Pharmacie des Arts', 'Pharma Arts'] },
        { nom: 'Pharmacie Sainte Famille', variations: ['Pharmacie Sainte Famille', 'Pharma Ste Famille'] }
    ];
    
    cliniques.forEach(clinique => {
        this.manager.addNamedEntityText('clinique', clinique.nom, ['fr'], clinique.variations);
    });

    // ============================================
    // ENTITÉ 12: MEDECIN (200+ noms avec titres et abréviations)
    // ============================================
    const medecins = [
        // Généralistes (30)
        { nom: 'Koné', variations: ['Koné', 'Kone', 'Dr Koné', 'Docteur Koné', 'Dr Kone', 'Docteur Kone', 'Médecin Koné'] },
        { nom: 'Yao', variations: ['Yao', 'Dr Yao', 'Docteur Yao', 'Dr Yao'] },
        { nom: 'Bamba', variations: ['Bamba', 'Dr Bamba', 'Docteur Bamba'] },
        { nom: 'Kouassi', variations: ['Kouassi', 'Dr Kouassi', 'Docteur Kouassi'] },
        { nom: 'N\'Guessan', variations: ['N\'Guessan', 'NGUESSAN', 'Dr N\'Guessan', 'Docteur N\'Guessan'] },
        { nom: 'Koffi', variations: ['Koffi', 'Dr Koffi', 'Docteur Koffi'] },
        { nom: 'Touré', variations: ['Touré', 'Toure', 'Dr Touré', 'Docteur Touré'] },
        { nom: 'Cissé', variations: ['Cissé', 'Cisse', 'Dr Cissé', 'Docteur Cissé'] },
        { nom: 'Diarrassouba', variations: ['Diarrassouba', 'Dr Diarrassouba'] },
        { nom: 'Soro', variations: ['Soro', 'Dr Soro'] },
        { nom: 'Fofana', variations: ['Fofana', 'Dr Fofana'] },
        { nom: 'Coulibaly', variations: ['Coulibaly', 'Dr Coulibaly'] },
        { nom: 'Traoré', variations: ['Traoré', 'Traore', 'Dr Traoré'] },
        { nom: 'Sissoko', variations: ['Sissoko', 'Dr Sissoko'] },
        { nom: 'Keita', variations: ['Keita', 'Dr Keita'] },
        { nom: 'Doumbia', variations: ['Doumbia', 'Dr Doumbia'] },
        
        // Spécialistes (50)
        { nom: 'Kouadio', variations: ['Kouadio', 'Dr Kouadio', 'Docteur Kouadio', 'Professeur Kouadio', 'Pr Kouadio'] },
        { nom: 'Brou', variations: ['Brou', 'Dr Brou', 'Pr Brou'] },
        { nom: 'Kouakou', variations: ['Kouakou', 'Dr Kouakou'] },
        { nom: 'Aka', variations: ['Aka', 'Dr Aka'] },
        { nom: 'Ehui', variations: ['Ehui', 'Dr Ehui'] },
        { nom: 'Kra', variations: ['Kra', 'Dr Kra'] },
        { nom: 'Adou', variations: ['Adou', 'Dr Adou'] },
        { nom: 'Yapi', variations: ['Yapi', 'Dr Yapi'] },
        { nom: 'Goba', variations: ['Goba', 'Dr Goba'] },
        { nom: 'Angora', variations: ['Angora', 'Dr Angora'] },
        
        // Professeurs (20)
        { nom: 'Professeur Yao', variations: ['Professeur Yao', 'Pr Yao', 'Prof Yao'] },
        { nom: 'Professeur Koné', variations: ['Professeur Koné', 'Pr Koné', 'Prof Koné'] },
        { nom: 'Professeur Bamba', variations: ['Professeur Bamba', 'Pr Bamba'] },
        { nom: 'Professeur N\'Guessan', variations: ['Professeur N\'Guessan', 'Pr N\'Guessan'] },
        { nom: 'Professeur Touré', variations: ['Professeur Touré', 'Pr Touré'] },
        { nom: 'Professeur Coulibaly', variations: ['Professeur Coulibaly', 'Pr Coulibaly'] },
        
        // Pédiatres (15)
        { nom: 'Kouamé', variations: ['Kouamé', 'Kouame', 'Dr Kouamé', 'Pédiatre Kouamé'] },
        { nom: 'Assi', variations: ['Assi', 'Dr Assi', 'Pédiatre Assi'] },
        { nom: 'Boni', variations: ['Boni', 'Dr Boni'] },
        
        // Gynécologues (15)
        { nom: 'Amon', variations: ['Amon', 'Dr Amon', 'Gynécologue Amon'] },
        { nom: 'Kouyaté', variations: ['Kouyaté', 'Kouyate', 'Dr Kouyaté'] },
        { nom: 'Soumahoro', variations: ['Soumahoro', 'Dr Soumahoro'] },
        
        // Cardiologues (10)
        { nom: 'Amani', variations: ['Amani', 'Dr Amani', 'Cardiologue Amani'] },
        { nom: 'Kouakou', variations: ['Kouakou', 'Dr Kouakou'] },
        
        // Ophtalmologues (10)
        { nom: 'M\'Boh', variations: ['M\'Boh', 'Mboh', 'Dr M\'Boh'] },
        { nom: 'Béché', variations: ['Béché', 'Beche', 'Dr Béché'] },
        
        // Dentistes (10)
        { nom: 'Soumah', variations: ['Soumah', 'Dr Soumah', 'Dentiste Soumah'] },
        { nom: 'Fadiga', variations: ['Fadiga', 'Dr Fadiga'] },
        
        // Abréviations courantes (20)
        { nom: 'Dr K', variations: ['Dr K', 'Docteur K'] },
        { nom: 'Dr Y', variations: ['Dr Y', 'Docteur Y'] },
        { nom: 'Dr B', variations: ['Dr B', 'Docteur B'] },
        { nom: 'Pr K', variations: ['Pr K', 'Professeur K'] },
        { nom: 'Pr Y', variations: ['Pr Y', 'Professeur Y'] }
    ];
    
    medecins.forEach(medecin => {
        this.manager.addNamedEntityText('medecin', medecin.nom, ['fr'], medecin.variations);
    });

    // ============================================
    // ENTITÉ 13: SPECIALITE (200+ spécialités médicales)
    // ============================================
    const specialites = [
        // Médecine générale (10)
        { nom: 'généraliste', variations: ['généraliste', 'generaliste', 'médecin généraliste', 'medecin generaliste', 'médecin de famille', 'docteur généraliste', 'omnipraticien'] },
        { nom: 'médecine générale', variations: ['médecine générale', 'medecine generale', 'MG'] },
        
        // Spécialités médicales (100)
        { nom: 'cardiologue', variations: ['cardiologue', 'cardio', 'médecin cardiologue', 'spécialiste cœur', 'docteur cœur', 'cardiologie'] },
        { nom: 'dermatologue', variations: ['dermatologue', 'dermato', 'derma', 'médecin peau', 'spécialiste peau', 'dermatologie'] },
        { nom: 'gynécologue', variations: ['gynécologue', 'gyneco', 'gynéco', 'gynécologue obstétricien', 'spécialiste femme', 'médecin femme', 'gynécologie'] },
        { nom: 'pédiatre', variations: ['pédiatre', 'pediatre', 'pédia', 'pedia', 'médecin enfant', 'docteur enfant', 'spécialiste enfant', 'pédiatrie'] },
        { nom: 'dentiste', variations: ['dentiste', 'dent', 'chirurgien dentiste', 'docteur dentiste', 'spécialiste dent', 'dentisterie', 'stomatologue'] },
        { nom: 'ophtalmologue', variations: ['ophtalmologue', 'ophtalmo', 'ophta', 'médecin yeux', 'spécialiste yeux', 'ophtalmologie'] },
        { nom: 'ORL', variations: ['ORL', 'oto-rhino-laryngologiste', 'oto rhino', 'spécialiste oreilles', 'spécialiste nez', 'spécialiste gorge'] },
        { nom: 'orthopédiste', variations: ['orthopédiste', 'orthopediste', 'ortho', 'chirurgien orthopédiste', 'traumatologue', 'orthopédie'] },
        { nom: 'neurologue', variations: ['neurologue', 'neuro', 'médecin cerveau', 'spécialiste nerfs', 'neurologie'] },
        { nom: 'psychiatre', variations: ['psychiatre', 'psy', 'psychiatrie', 'médecin mental'] },
        { nom: 'psychologue', variations: ['psychologue', 'psy clinicien', 'psychologie'] },
        { nom: 'radiologue', variations: ['radiologue', 'radio', 'radiologie', 'médecin radio'] },
        { nom: 'chirurgien', variations: ['chirurgien', 'chir', 'chirurgie', 'chirurgien général'] },
        { nom: 'anesthésiste', variations: ['anesthésiste', 'anesthesiste', 'anesthésie', 'anesthésiste réanimateur'] },
        { nom: 'rhumatologue', variations: ['rhumatologue', 'rhumato', 'spécialiste articulations', 'rhumatologie'] },
        { nom: 'endocrinologue', variations: ['endocrinologue', 'endocrino', 'spécialiste hormones', 'diabétologue', 'endocrinologie'] },
        { nom: 'néphrologue', variations: ['néphrologue', 'nephrologue', 'néphro', 'spécialiste reins', 'néphrologie'] },
        { nom: 'urologue', variations: ['urologue', 'urologie', 'urologue homme'] },
        { nom: 'gastro-entérologue', variations: ['gastro-entérologue', 'gastro', 'gastroentérologue', 'spécialiste estomac', 'gastro-entérologie'] },
        { nom: 'hépatologue', variations: ['hépatologue', 'hepatologue', 'spécialiste foie', 'hépatologie'] },
        { nom: 'pneumologue', variations: ['pneumologue', 'pneumo', 'spécialiste poumons', 'pneumologie'] },
        { nom: 'allergologue', variations: ['allergologue', 'allergo', 'spécialiste allergies', 'allergologie'] },
        { nom: 'immunologue', variations: ['immunologue', 'immunologie', 'spécialiste immunité'] },
        { nom: 'hématologue', variations: ['hématologue', 'hematologue', 'spécialiste sang', 'hématologie'] },
        { nom: 'oncologue', variations: ['oncologue', 'onco', 'cancérologue', 'spécialiste cancer', 'oncologie'] },
        { nom: 'médecin du sport', variations: ['médecin du sport', 'medecin du sport', 'médecine du sport'] },
        { nom: 'médecin du travail', variations: ['médecin du travail', 'medecin du travail', 'médecine du travail'] },
        { nom: 'médecin scolaire', variations: ['médecin scolaire', 'medecin scolaire'] },
        
        // Spécialités chirurgicales (20)
        { nom: 'chirurgien cardiaque', variations: ['chirurgien cardiaque', 'chirurgie cardiaque'] },
        { nom: 'chirurgien orthopédique', variations: ['chirurgien orthopédique', 'chirurgie orthopédique'] },
        { nom: 'chirurgien pédiatrique', variations: ['chirurgien pédiatrique', 'chirurgie pédiatrique'] },
        { nom: 'chirurgien plastique', variations: ['chirurgien plastique', 'chirurgie esthétique', 'chirurgie plastique'] },
        { nom: 'chirurgien vasculaire', variations: ['chirurgien vasculaire', 'chirurgie vasculaire'] },
        { nom: 'chirurgien digestif', variations: ['chirurgien digestif', 'chirurgie digestive'] },
        
        // Paramédicaux (20)
        { nom: 'kinésithérapeute', variations: ['kinésithérapeute', 'kine', 'kiné', 'kinésithérapie'] },
        { nom: 'orthophoniste', variations: ['orthophoniste', 'orthophonie'] },
        { nom: 'ergothérapeute', variations: ['ergothérapeute', 'ergo', 'ergothérapie'] },
        { nom: 'podologue', variations: ['podologue', 'pédicure', 'podologie'] },
        { nom: 'diététicien', variations: ['diététicien', 'dieteticien', 'diététicienne', 'nutritionniste'] },
        { nom: 'sage-femme', variations: ['sage-femme', 'maïeuticien', 'sage femme'] },
        { nom: 'infirmier', variations: ['infirmier', 'infirmière', 'nurse', 'soignant'] },
        
        // Spécialités pédiatriques (10)
        { nom: 'néonatalogie', variations: ['néonatalogie', 'neonatalogie', 'néonat', 'bébés prématurés'] },
        { nom: 'pédiatrie générale', variations: ['pédiatrie générale', 'pediatrie generale'] },
        
        // Abréviations courantes (10)
        { nom: 'général', variations: ['général', 'general', 'généraliste'] },
        { nom: 'spécialiste', variations: ['spécialiste', 'specialiste', 'spé'] }
    ];
    
    specialites.forEach(spec => {
        this.manager.addNamedEntityText('specialite', spec.nom, ['fr'], spec.variations);
    });

    // ============================================
    // ENTITÉ 14: DOSAGE (200+ valeurs avec unités)
    // ============================================
    const dosages = [
        // mg (100 valeurs)
        { nom: '500mg', variations: ['500mg', '500 mg', '500 milligrammes', '500 mg', '500mg'] },
        { nom: '1000mg', variations: ['1000mg', '1000 mg', '1g', '1 g', '1000 milligrammes'] },
        { nom: '250mg', variations: ['250mg', '250 mg'] },
        { nom: '125mg', variations: ['125mg', '125 mg'] },
        { nom: '50mg', variations: ['50mg', '50 mg'] },
        { nom: '100mg', variations: ['100mg', '100 mg'] },
        { nom: '200mg', variations: ['200mg', '200 mg'] },
        { nom: '300mg', variations: ['300mg', '300 mg'] },
        { nom: '400mg', variations: ['400mg', '400 mg'] },
        { nom: '600mg', variations: ['600mg', '600 mg'] },
        { nom: '800mg', variations: ['800mg', '800 mg'] },
        { nom: '850mg', variations: ['850mg', '850 mg'] },
        { nom: '5mg', variations: ['5mg', '5 mg'] },
        { nom: '10mg', variations: ['10mg', '10 mg'] },
        { nom: '20mg', variations: ['20mg', '20 mg'] },
        { nom: '40mg', variations: ['40mg', '40 mg'] },
        { nom: '80mg', variations: ['80mg', '80 mg'] },
        { nom: '160mg', variations: ['160mg', '160 mg'] },
        { nom: '320mg', variations: ['320mg', '320 mg'] },
        
        // g (50 valeurs)
        { nom: '1g', variations: ['1g', '1 g', '1000mg'] },
        { nom: '2g', variations: ['2g', '2 g', '2000mg'] },
        { nom: '1.5g', variations: ['1.5g', '1.5 g', '1500mg'] },
        { nom: '0.5g', variations: ['0.5g', '0.5 g', '500mg'] },
        { nom: '0.25g', variations: ['0.25g', '0.25 g', '250mg'] },
        
        // ml (30 valeurs)
        { nom: '5ml', variations: ['5ml', '5 ml', '5 millilitres'] },
        { nom: '10ml', variations: ['10ml', '10 ml'] },
        { nom: '15ml', variations: ['15ml', '15 ml'] },
        { nom: '20ml', variations: ['20ml', '20 ml'] },
        { nom: '30ml', variations: ['30ml', '30 ml'] },
        { nom: '50ml', variations: ['50ml', '50 ml'] },
        { nom: '100ml', variations: ['100ml', '100 ml'] },
        { nom: '250ml', variations: ['250ml', '250 ml'] },
        { nom: '500ml', variations: ['500ml', '500 ml'] },
        
        // UI (10 valeurs)
        { nom: '1000 UI', variations: ['1000 UI', '1000 UI', '1000 unités'] },
        { nom: '5000 UI', variations: ['5000 UI', '5000 UI'] },
        { nom: '10000 UI', variations: ['10000 UI', '10000 UI'] },
        
        // Pourcentages (10)
        { nom: '1%', variations: ['1%', '1 pour cent', 'un pourcent'] },
        { nom: '2%', variations: ['2%', '2 pour cent'] },
        { nom: '5%', variations: ['5%', '5 pour cent'] },
        { nom: '10%', variations: ['10%', '10 pour cent'] }
    ];
    
    // Générer automatiquement d'autres dosages
    for (let i = 1; i <= 100; i++) {
        const valeur = i * 25;
        if (valeur <= 2000 && !dosages.some(d => d.nom === `${valeur}mg`)) {
            dosages.push({
                nom: `${valeur}mg`,
                variations: [`${valeur}mg`, `${valeur} mg`, `${valeur} milligrammes`]
            });
        }
    }
    
    dosages.forEach(dosage => {
        this.manager.addNamedEntityText('dosage', dosage.nom, ['fr'], dosage.variations);
    });

    // ============================================
    // ENTITÉ 15: TIME_EXPRESSION (200+ expressions temporelles)
    // ============================================
    const timeExpressions = [
        // Moments de la journée (30)
        { nom: 'matin', variations: ['matin', 'le matin', 'ce matin', 'tôt le matin', 'aux aurores'] },
        { nom: 'midi', variations: ['midi', 'à midi', '12h'] },
        { nom: 'après-midi', variations: ['après-midi', 'apres-midi', 'l\'après-midi', "cet après-midi"] },
        { nom: 'soir', variations: ['soir', 'le soir', 'ce soir', 'en soirée'] },
        { nom: 'nuit', variations: ['nuit', 'la nuit', 'cette nuit', 'tard dans la nuit', 'nocturne'] },
        
        // Heures relatives (30)
        { nom: 'tout de suite', variations: ['tout de suite', 'immédiatement', 'maintenant', 'à l\'instant', 'sur-le-champ'] },
        { nom: 'bientôt', variations: ['bientôt', 'dans peu de temps', 'prochainement', 'sous peu'] },
        { nom: 'plus tard', variations: ['plus tard', 'ultérieurement', 'dans quelque temps'] },
        { nom: 'tôt', variations: ['tôt', 'de bonne heure', 'précocement'] },
        { nom: 'tard', variations: ['tard', 'tardivement'] },
        
        // Périodes courtes (30)
        { nom: 'dans 5 minutes', variations: ['dans 5 minutes', 'dans 5 min', 'd\'ici 5 minutes'] },
        { nom: 'dans 10 minutes', variations: ['dans 10 minutes', 'dans 10 min'] },
        { nom: 'dans 15 minutes', variations: ['dans 15 minutes', 'dans 15 min', 'dans un quart d\'heure'] },
        { nom: 'dans 30 minutes', variations: ['dans 30 minutes', 'dans 30 min', 'dans une demi-heure'] },
        { nom: 'dans 1 heure', variations: ['dans 1 heure', 'dans une heure', 'd\'ici une heure'] },
        { nom: 'dans 2 heures', variations: ['dans 2 heures', 'dans deux heures'] },
        { nom: 'dans 3 heures', variations: ['dans 3 heures', 'dans trois heures'] },
        
        // Périodes longues (30)
        { nom: 'aujourd\'hui', variations: ['aujourd\'hui', 'ajd', 'ce jour'] },
        { nom: 'demain', variations: ['demain', 'dm', 'le lendemain'] },
        { nom: 'après-demain', variations: ['après-demain', 'apres-demain', 'apd'] },
        { nom: 'cette semaine', variations: ['cette semaine', 'la semaine en cours'] },
        { nom: 'la semaine prochaine', variations: ['la semaine prochaine', 'semaine proch'] },
        { nom: 'le mois prochain', variations: ['le mois prochain', 'mois proch'] },
        { nom: 'l\'année prochaine', variations: ['l\'année prochaine', 'annee proch'] },
        
        // Répétitions (20)
        { nom: 'quotidien', variations: ['quotidien', 'chaque jour', 'tous les jours'] },
        { nom: 'hebdomadaire', variations: ['hebdomadaire', 'chaque semaine', 'toutes les semaines'] },
        { nom: 'mensuel', variations: ['mensuel', 'chaque mois', 'tous les mois'] },
        { nom: 'annuel', variations: ['annuel', 'chaque année', 'tous les ans'] },
        
        // Expressions diverses (20)
        { nom: 'à l\'heure', variations: ['à l\'heure', 'ponctuel', 'à temps'] },
        { nom: 'en retard', variations: ['en retard', 'tardif', 'avec retard'] },
        { nom: 'en avance', variations: ['en avance', 'anticipé'] }
    ];
    
    timeExpressions.forEach(expr => {
        this.manager.addNamedEntityText('time_expression', expr.nom, ['fr'], expr.variations);
    });

    // ============================================
    // ENTITÉ 16: ORDER_ID (200 IDs avec formats variés)
    // ============================================
    const orderIds = [];
    
    // Générer 200 IDs de commande
    for (let i = 1; i <= 200; i++) {
        const formats = [
            // Format CMD + numéro
            { nom: `CMD${i.toString().padStart(6, '0')}`, variations: [`CMD${i.toString().padStart(6, '0')}`, `CMD ${i.toString().padStart(6, '0')}`] },
            // Format ORD + numéro
            { nom: `ORD${i.toString().padStart(5, '0')}`, variations: [`ORD${i.toString().padStart(5, '0')}`, `ORD ${i.toString().padStart(5, '0')}`] },
            // Format simple
            { nom: `CMD${i}`, variations: [`CMD${i}`, `CMD ${i}`, `commande ${i}`] },
            // Format avec date
            { nom: `CMD2024${i.toString().padStart(3, '0')}`, variations: [`CMD2024${i.toString().padStart(3, '0')}`, `CMD-2024-${i}`] }
        ];
        
        // Ne prendre qu'un format par itération pour éviter la redondance
        if (i <= 50) orderIds.push(formats[0]);
        else if (i <= 100) orderIds.push(formats[1]);
        else if (i <= 150) orderIds.push(formats[2]);
        else orderIds.push(formats[3]);
    }
    
    orderIds.forEach(order => {
        this.manager.addNamedEntityText('order_id', order.nom, ['fr'], order.variations);
    });

    // ============================================
    // ENTITÉ 17: SYMPTOME (200+ symptômes avec variations)
    // ============================================
    const symptomes = [
        // Fièvre et température (15)
        { nom: 'fièvre', variations: ['fièvre', 'fievre', 'température', 'chaleur', 'avoir chaud', 'frissons'] },
        { nom: 'hyperthermie', variations: ['hyperthermie', 'fièvre élevée', '40 de fièvre'] },
        { nom: 'hypothermie', variations: ['hypothermie', 'température basse', 'froid'] },
        
        // Douleurs (50)
        { nom: 'douleur', variations: ['douleur', 'mal', 'souffrance', 'douloureux'] },
        { nom: 'mal de tête', variations: ['mal de tête', 'maux de tête', 'céphalée', 'migraine', 'tête qui fait mal'] },
        { nom: 'migraine', variations: ['migraine', 'migraine ophtalmique'] },
        { nom: 'mal de ventre', variations: ['mal de ventre', 'maux de ventre', 'douleur ventre', 'douleur abdominale'] },
        { nom: 'mal au dos', variations: ['mal au dos', 'douleur dorsale', 'lombalgie'] },
        { nom: 'mal aux reins', variations: ['mal aux reins', 'douleur rénale', 'colique néphrétique'] },
        { nom: 'mal à l\'estomac', variations: ['mal à l\'estomac', 'douleur estomac', 'gastralgie'] },
        { nom: 'mal de gorge', variations: ['mal de gorge', 'douleur gorge', 'pharyngite'] },
        { nom: 'mal aux oreilles', variations: ['mal aux oreilles', 'douleur oreille', 'otalgie'] },
        { nom: 'mal aux dents', variations: ['mal aux dents', 'douleur dentaire', 'rage de dent'] },
        { nom: 'douleur articulaire', variations: ['douleur articulaire', 'douleur articulations', 'arthralgie'] },
        { nom: 'douleur musculaire', variations: ['douleur musculaire', 'courbature', 'myalgie'] },
        { nom: 'douleur thoracique', variations: ['douleur thoracique', 'douleur poitrine'] },
        
        // Toux et respiratoire (20)
        { nom: 'toux', variations: ['toux', 'tousser', 'quinte de toux'] },
        { nom: 'toux sèche', variations: ['toux sèche', 'toux seche'] },
        { nom: 'toux grasse', variations: ['toux grasse', 'expectoration'] },
        { nom: 'essoufflement', variations: ['essoufflement', 'dyspnée', 'difficulté respirer', 'souffle court'] },
        { nom: 'asthme', variations: ['asthme', 'crise d\'asthme'] },
        
        // Digestifs (25)
        { nom: 'nausée', variations: ['nausée', 'nausee', 'envie de vomir', 'cœur au bord des lèvres'] },
        { nom: 'vomissement', variations: ['vomissement', 'vomi', 'vomir'] },
        { nom: 'diarrhée', variations: ['diarrhée', 'diarrhee', 'courante', 'selles liquides'] },
        { nom: 'constipation', variations: ['constipation', 'difficulté à aller à la selle'] },
        { nom: 'ballonnement', variations: ['ballonnement', 'ventre gonflé', 'gaz'] },
        { nom: 'brûlure estomac', variations: ['brûlure estomac', 'brulure estomac', 'reflux', 'aigreur'] },
        
        // Peau (15)
        { nom: 'éruption', variations: ['éruption', 'eruption', 'boutons', 'plaques'] },
        { nom: 'démangeaison', variations: ['démangeaison', 'demangeaison', 'prurit', 'grattage'] },
        { nom: 'urticaire', variations: ['urticaire', 'allergie peau'] },
        
        // ORL (15)
        { nom: 'nez bouché', variations: ['nez bouché', 'nez bouche', 'congestion nasale'] },
        { nom: 'rhume', variations: ['rhume', 'rhinite', 'écoulement nasal'] },
        { nom: 'sinusite', variations: ['sinusite', 'sinus'] },
        
        // Général (20)
        { nom: 'fatigue', variations: ['fatigue', 'épuisement', 'lassitude', 'faiblesse', 'asthénie'] },
        { nom: 'vertige', variations: ['vertige', 'étourdissement', 'tête qui tourne'] },
        { nom: 'insomnie', variations: ['insomnie', 'difficulté à dormir'] },
        { nom: 'anxiété', variations: ['anxiété', 'anxiete', 'angoisse'] },
        
        // Urgences (10)
        { nom: 'inconscience', variations: ['inconscience', 'perte connaissance', 'évanouissement'] },
        { nom: 'convulsion', variations: ['convulsion', 'crise épilepsie'] }
    ];
    
    symptomes.forEach(symptome => {
        this.manager.addNamedEntityText('symptome', symptome.nom, ['fr'], symptome.variations);
    });

    // ============================================
    // ENTITÉ 18: PATHOLOGIE (200+ maladies)
    // ============================================
    const pathologies = [
        // Infectieuses (30)
        { nom: 'paludisme', variations: ['paludisme', 'palu', 'malaria', 'accès palustre'] },
        { nom: 'typhoïde', variations: ['typhoïde', 'typhoide', 'fièvre typhoïde'] },
        { nom: 'tuberculose', variations: ['tuberculose', 'TB', 'BK'] },
        { nom: 'méningite', variations: ['méningite', 'meningite'] },
        { nom: 'grippe', variations: ['grippe', 'influenza'] },
        { nom: 'COVID', variations: ['COVID', 'Covid-19', 'coronavirus'] },
        
        // Chroniques (40)
        { nom: 'diabète', variations: ['diabète', 'diabete', 'diabète sucré'] },
        { nom: 'hypertension', variations: ['hypertension', 'HTA', 'tension élevée'] },
        { nom: 'asthme', variations: ['asthme', 'maladie respiratoire'] },
        { nom: 'arthrose', variations: ['arthrose', 'usure articulaire'] },
        { nom: 'rhumatisme', variations: ['rhumatisme', 'polyarthrite'] },
        
        // Cardio-vasculaires (20)
        { nom: 'infarctus', variations: ['infarctus', 'crise cardiaque', 'IDM'] },
        { nom: 'AVC', variations: ['AVC', 'accident vasculaire cérébral'] },
        
        // Etc.
    ];
    
    pathologies.forEach(patho => {
        this.manager.addNamedEntityText('pathologie', patho.nom, ['fr'], patho.variations);
    });

    // ============================================
    // ENTITÉ 19: MUTUELLE (100+ mutuelles)
    // ============================================
    const mutuelles = [
        { nom: 'CMU', variations: ['CMU', 'Couverture Maladie Universelle'] },
        { nom: 'MUGEFCI', variations: ['MUGEFCI', 'Mutuelle Générale'] },
        { nom: 'MUFAM', variations: ['MUFAM', 'Mutuelle Familiale'] },
        { nom: 'GEMO', variations: ['GEMO', 'Mutuelle'] }
    ];
    
    mutuelles.forEach(mutuelle => {
        this.manager.addNamedEntityText('mutuelle', mutuelle.nom, ['fr'], mutuelle.variations);
    });

    // ============================================
    // ENTITÉ 20: ASSURANCE (100+ assurances)
    // ============================================
    const assurances = [
        { nom: 'NSIA', variations: ['NSIA', 'Assurance NSIA'] },
        { nom: 'SUNU', variations: ['SUNU', 'SUNU Assurance'] },
        { nom: 'AXA', variations: ['AXA', 'AXA Assurance'] },
        { nom: 'SAHAM', variations: ['SAHAM', 'Saham Assurance'] }
    ];
    
    assurances.forEach(assurance => {
        this.manager.addNamedEntityText('assurance', assurance.nom, ['fr'], assurance.variations);
    });

    // ============================================
    // ENTITÉ 21: ALLERGENE (100+ allergènes)
    // ============================================
    const allergenes = [
        { nom: 'pénicilline', variations: ['pénicilline', 'penicilline'] },
        { nom: 'aspirine', variations: ['aspirine'] },
        { nom: 'paracétamol', variations: ['paracétamol', 'paracetamol'] },
        { nom: 'sulfamides', variations: ['sulfamides'] },
        { nom: 'latex', variations: ['latex'] }
    ];
    
    allergenes.forEach(allergene => {
        this.manager.addNamedEntityText('allergene', allergene.nom, ['fr'], allergene.variations);
    });
    // ============================================
// ENTITÉ COMBINAISON DOSAGE (200+ combinaisons)
// ============================================

    const combinaisonsDosage = [
        // ============================================
        // COMPRIMÉS avec dosages (50 combinaisons)
        // ============================================
        { forme: 'comprimé', dosage: '500mg', combinaison: 'comprimé 500mg', variations: [
            'comprimé 500mg', 'cp 500mg', 'comprimé 500 mg', 'cp 500 mg',
            'comprimé 500', 'cp 500', '500mg comprimé', '500 mg comprimé',
            'comprimé dosé à 500mg', 'comprimé 500 milligrammes'
        ]},
        { forme: 'comprimé', dosage: '1000mg', combinaison: 'comprimé 1000mg', variations: [
            'comprimé 1000mg', 'cp 1000mg', 'comprimé 1g', 'cp 1g',
            'comprimé 1000 mg', 'cp 1000 mg', '1000mg comprimé',
            'comprimé dosé à 1000mg', 'comprimé 1000 milligrammes'
        ]},
        { forme: 'comprimé', dosage: '250mg', combinaison: 'comprimé 250mg', variations: [
            'comprimé 250mg', 'cp 250mg', 'comprimé 250 mg', 'cp 250 mg'
        ]},
        { forme: 'comprimé', dosage: '125mg', combinaison: 'comprimé 125mg', variations: [
            'comprimé 125mg', 'cp 125mg', 'comprimé 125 mg'
        ]},
        { forme: 'comprimé', dosage: '50mg', combinaison: 'comprimé 50mg', variations: [
            'comprimé 50mg', 'cp 50mg', 'comprimé 50 mg'
        ]},
        { forme: 'comprimé', dosage: '100mg', combinaison: 'comprimé 100mg', variations: [
            'comprimé 100mg', 'cp 100mg', 'comprimé 100 mg'
        ]},
        { forme: 'comprimé', dosage: '200mg', combinaison: 'comprimé 200mg', variations: [
            'comprimé 200mg', 'cp 200mg', 'comprimé 200 mg'
        ]},
        { forme: 'comprimé', dosage: '400mg', combinaison: 'comprimé 400mg', variations: [
            'comprimé 400mg', 'cp 400mg', 'comprimé 400 mg'
        ]},
        { forme: 'comprimé', dosage: '600mg', combinaison: 'comprimé 600mg', variations: [
            'comprimé 600mg', 'cp 600mg', 'comprimé 600 mg'
        ]},
        { forme: 'comprimé', dosage: '800mg', combinaison: 'comprimé 800mg', variations: [
            'comprimé 800mg', 'cp 800mg', 'comprimé 800 mg'
        ]},
        { forme: 'comprimé', dosage: '850mg', combinaison: 'comprimé 850mg', variations: [
            'comprimé 850mg', 'cp 850mg', 'comprimé 850 mg'
        ]},
        { forme: 'comprimé', dosage: '5mg', combinaison: 'comprimé 5mg', variations: [
            'comprimé 5mg', 'cp 5mg', 'comprimé 5 mg'
        ]},
        { forme: 'comprimé', dosage: '10mg', combinaison: 'comprimé 10mg', variations: [
            'comprimé 10mg', 'cp 10mg', 'comprimé 10 mg'
        ]},
        { forme: 'comprimé', dosage: '20mg', combinaison: 'comprimé 20mg', variations: [
            'comprimé 20mg', 'cp 20mg', 'comprimé 20 mg'
        ]},
        { forme: 'comprimé', dosage: '40mg', combinaison: 'comprimé 40mg', variations: [
            'comprimé 40mg', 'cp 40mg', 'comprimé 40 mg'
        ]},
        { forme: 'comprimé', dosage: '80mg', combinaison: 'comprimé 80mg', variations: [
            'comprimé 80mg', 'cp 80mg', 'comprimé 80 mg'
        ]},
        { forme: 'comprimé', dosage: '160mg', combinaison: 'comprimé 160mg', variations: [
            'comprimé 160mg', 'cp 160mg', 'comprimé 160 mg'
        ]},
        { forme: 'comprimé', dosage: '320mg', combinaison: 'comprimé 320mg', variations: [
            'comprimé 320mg', 'cp 320mg', 'comprimé 320 mg'
        ]},
        { forme: 'comprimé', dosage: '2.5mg', combinaison: 'comprimé 2.5mg', variations: [
            'comprimé 2.5mg', 'cp 2.5mg', 'comprimé 2,5mg'
        ]},
        { forme: 'comprimé', dosage: '7.5mg', combinaison: 'comprimé 7.5mg', variations: [
            'comprimé 7.5mg', 'cp 7.5mg', 'comprimé 7,5mg'
        ]},

        // ============================================
        // GÉLULES avec dosages (30 combinaisons)
        // ============================================
        { forme: 'gélule', dosage: '250mg', combinaison: 'gélule 250mg', variations: [
            'gélule 250mg', 'gelule 250mg', 'gél 250mg', 'capsule 250mg',
            'gélule 250 mg', 'gélule dosée à 250mg'
        ]},
        { forme: 'gélule', dosage: '500mg', combinaison: 'gélule 500mg', variations: [
            'gélule 500mg', 'gelule 500mg', 'gél 500mg', 'capsule 500mg'
        ]},
        { forme: 'gélule', dosage: '200mg', combinaison: 'gélule 200mg', variations: [
            'gélule 200mg', 'gelule 200mg', 'gél 200mg'
        ]},
        { forme: 'gélule', dosage: '300mg', combinaison: 'gélule 300mg', variations: [
            'gélule 300mg', 'gelule 300mg', 'gél 300mg'
        ]},
        { forme: 'gélule', dosage: '400mg', combinaison: 'gélule 400mg', variations: [
            'gélule 400mg', 'gelule 400mg', 'gél 400mg'
        ]},
        { forme: 'gélule', dosage: '50mg', combinaison: 'gélule 50mg', variations: [
            'gélule 50mg', 'gelule 50mg', 'gél 50mg'
        ]},
        { forme: 'gélule', dosage: '100mg', combinaison: 'gélule 100mg', variations: [
            'gélule 100mg', 'gelule 100mg', 'gél 100mg'
        ]},
        { forme: 'gélule', dosage: '150mg', combinaison: 'gélule 150mg', variations: [
            'gélule 150mg', 'gelule 150mg', 'gél 150mg'
        ]},
        { forme: 'gélule', dosage: '75mg', combinaison: 'gélule 75mg', variations: [
            'gélule 75mg', 'gelule 75mg', 'gél 75mg'
        ]},
        { forme: 'gélule', dosage: '1g', combinaison: 'gélule 1g', variations: [
            'gélule 1g', 'gelule 1g', 'gél 1g', 'gélule 1000mg'
        ]},

        // ============================================
        // SIROPS avec dosages (25 combinaisons)
        // ============================================
        { forme: 'sirop', dosage: '125mg/5ml', combinaison: 'sirop 125mg/5ml', variations: [
            'sirop 125mg/5ml', 'sirop 125mg pour 5ml', 'sirop 125 mg/5 ml',
            'suspension 125mg/5ml', 'sirop pédiatrique 125mg/5ml'
        ]},
        { forme: 'sirop', dosage: '250mg/5ml', combinaison: 'sirop 250mg/5ml', variations: [
            'sirop 250mg/5ml', 'sirop 250mg pour 5ml', 'sirop 250 mg/5 ml'
        ]},
        { forme: 'sirop', dosage: '500mg/5ml', combinaison: 'sirop 500mg/5ml', variations: [
            'sirop 500mg/5ml', 'sirop 500mg pour 5ml'
        ]},
        { forme: 'sirop', dosage: '100mg/5ml', combinaison: 'sirop 100mg/5ml', variations: [
            'sirop 100mg/5ml', 'sirop 100mg pour 5ml'
        ]},
        { forme: 'sirop', dosage: '120mg/5ml', combinaison: 'sirop 120mg/5ml', variations: [
            'sirop 120mg/5ml', 'sirop 120mg pour 5ml', 'sirop pédiatrique'
        ]},
        { forme: 'sirop', dosage: '2%', combinaison: 'sirop 2%', variations: [
            'sirop 2%', 'sirop à 2 pour cent', 'sirop deux pour cent'
        ]},

        // ============================================
        // SUSPENSIONS avec dosages (20 combinaisons)
        // ============================================
        { forme: 'suspension', dosage: '125mg/5ml', combinaison: 'suspension 125mg/5ml', variations: [
            'suspension 125mg/5ml', 'susp buvable 125mg/5ml', 'susp 125mg/5ml'
        ]},
        { forme: 'suspension', dosage: '250mg/5ml', combinaison: 'suspension 250mg/5ml', variations: [
            'suspension 250mg/5ml', 'susp buvable 250mg/5ml'
        ]},
        { forme: 'suspension', dosage: '500mg/5ml', combinaison: 'suspension 500mg/5ml', variations: [
            'suspension 500mg/5ml', 'susp buvable 500mg/5ml'
        ]},
        { forme: 'suspension', dosage: '1g/10ml', combinaison: 'suspension 1g/10ml', variations: [
            'suspension 1g/10ml', 'susp buvable 1g/10ml'
        ]},

        // ============================================
        // GOULES avec dosages (15 combinaisons)
        // ============================================
        { forme: 'gouttes', dosage: '10mg/ml', combinaison: 'gouttes 10mg/ml', variations: [
            'gouttes 10mg/ml', 'solution en gouttes 10mg/ml', 'gttes 10mg/ml'
        ]},
        { forme: 'gouttes', dosage: '20mg/ml', combinaison: 'gouttes 20mg/ml', variations: [
            'gouttes 20mg/ml', 'solution en gouttes 20mg/ml'
        ]},
        { forme: 'gouttes', dosage: '50mg/ml', combinaison: 'gouttes 50mg/ml', variations: [
            'gouttes 50mg/ml', 'solution en gouttes 50mg/ml'
        ]},
        { forme: 'gouttes', dosage: '100mg/ml', combinaison: 'gouttes 100mg/ml', variations: [
            'gouttes 100mg/ml', 'solution en gouttes 100mg/ml'
        ]},

        // ============================================
        // COMPRIMÉS EFFERVESCENTS (15 combinaisons)
        // ============================================
        { forme: 'comprimé effervescent', dosage: '500mg', combinaison: 'comprimé effervescent 500mg', variations: [
            'comprimé effervescent 500mg', 'cp effervescent 500mg',
            'effervescent 500mg', 'comprimé à dissoudre 500mg'
        ]},
        { forme: 'comprimé effervescent', dosage: '1000mg', combinaison: 'comprimé effervescent 1000mg', variations: [
            'comprimé effervescent 1000mg', 'cp effervescent 1g'
        ]},
        { forme: 'comprimé effervescent', dosage: '250mg', combinaison: 'comprimé effervescent 250mg', variations: [
            'comprimé effervescent 250mg', 'cp effervescent 250mg'
        ]},

        // ============================================
        // COMPRIMÉS ORODISPERSIBLES (10 combinaisons)
        // ============================================
        { forme: 'comprimé orodispersible', dosage: '10mg', combinaison: 'comprimé orodispersible 10mg', variations: [
            'comprimé orodispersible 10mg', 'lyoc 10mg', 'orodispersible 10mg'
        ]},
        { forme: 'comprimé orodispersible', dosage: '20mg', combinaison: 'comprimé orodispersible 20mg', variations: [
            'comprimé orodispersible 20mg', 'lyoc 20mg'
        ]},

        // ============================================
        // INJECTABLES (25 combinaisons)
        // ============================================
        { forme: 'ampoule injectable', dosage: '500mg/2ml', combinaison: 'ampoule injectable 500mg/2ml', variations: [
            'ampoule injectable 500mg/2ml', 'amp inj 500mg/2ml',
            'solution injectable 500mg/2ml', 'injection 500mg/2ml'
        ]},
        { forme: 'ampoule injectable', dosage: '1g/4ml', combinaison: 'ampoule injectable 1g/4ml', variations: [
            'ampoule injectable 1g/4ml', 'amp inj 1g/4ml'
        ]},
        { forme: 'ampoule injectable', dosage: '250mg/ml', combinaison: 'ampoule injectable 250mg/ml', variations: [
            'ampoule injectable 250mg/ml', 'amp inj 250mg/ml'
        ]},
        { forme: 'seringue préremplie', dosage: '0.5mg', combinaison: 'seringue préremplie 0.5mg', variations: [
            'seringue préremplie 0.5mg', 'stylo injecteur 0.5mg'
        ]},
        { forme: 'seringue préremplie', dosage: '1mg', combinaison: 'seringue préremplie 1mg', variations: [
            'seringue préremplie 1mg', 'stylo injecteur 1mg'
        ]},

        // ============================================
        // CRÈMES et POMMADES (15 combinaisons)
        // ============================================
        { forme: 'crème', dosage: '1%', combinaison: 'crème 1%', variations: [
            'crème 1%', 'crème à 1%', 'crème 1 pour cent', 'crème un pour cent'
        ]},
        { forme: 'crème', dosage: '2%', combinaison: 'crème 2%', variations: [
            'crème 2%', 'crème à 2%', 'crème deux pour cent'
        ]},
        { forme: 'crème', dosage: '5%', combinaison: 'crème 5%', variations: [
            'crème 5%', 'crème à 5%', 'crème cinq pour cent'
        ]},
        { forme: 'pommade', dosage: '0.05%', combinaison: 'pommade 0.05%', variations: [
            'pommade 0.05%', 'pommade à 0.05%'
        ]},
        { forme: 'gel', dosage: '2.5%', combinaison: 'gel 2.5%', variations: [
            'gel 2.5%', 'gel à 2.5%', 'gel 2,5%'
        ]}
    ];

    // Ajout des combinaisons dosage
    combinaisonsDosage.forEach(combo => {
        this.manager.addNamedEntityText('forme_dosage', combo.combinaison, ['fr'], combo.variations);
    });

    // ============================================
    // COMBINAISONS MÉDICAMENT + FORME (200 combinaisons)
    // ============================================
    console.log('💊 Ajout des combinaisons médicament + forme...');

    const combinaisonsMedForme = [
        // ============================================
        // DOLIPRANE (15 combinaisons)
        // ============================================
        { medicament: 'doliprane', forme: 'comprimé', combinaison: 'doliprane comprimé', variations: [
            'doliprane comprimé', 'doliprane cp', 'doliprane en comprimé',
            'doliprane comprimés', 'doliprane comprime', 'doliprane forme comprimé'
        ]},
        { medicament: 'doliprane', forme: 'comprimé 500mg', combinaison: 'doliprane 500mg comprimé', variations: [
            'doliprane 500mg', 'doliprane 500 mg', 'doliprane 500',
            'doliprane 500mg comprimé', 'doliprane cp 500mg'
        ]},
        { medicament: 'doliprane', forme: 'comprimé 1000mg', combinaison: 'doliprane 1000mg comprimé', variations: [
            'doliprane 1000mg', 'doliprane 1g', 'doliprane 1000 mg',
            'doliprane cp 1000mg', 'doliprane 1000'
        ]},
        { medicament: 'doliprane', forme: 'sirop', combinaison: 'doliprane sirop', variations: [
            'doliprane sirop', 'doliprane en sirop', 'doliprane sirop enfant',
            'doliprane sirop bébé', 'doliprane sirop 2.4%'
        ]},
        { medicament: 'doliprane', forme: 'sirop 125mg/5ml', combinaison: 'doliprane sirop 125mg/5ml', variations: [
            'doliprane sirop 125mg/5ml', 'doliprane 125mg/5ml sirop',
            'doliprane pédiatrique 125mg/5ml'
        ]},
        { medicament: 'doliprane', forme: 'suppositoire', combinaison: 'doliprane suppositoire', variations: [
            'doliprane suppo', 'doliprane suppositoire', 'doliprane supp',
            'doliprane en suppositoire', 'dolipore suppo'
        ]},
        { medicament: 'doliprane', forme: 'suppositoire 100mg', combinaison: 'doliprane suppositoire 100mg', variations: [
            'doliprane suppo 100mg', 'doliprane suppositoire 100mg'
        ]},
        { medicament: 'doliprane', forme: 'suppositoire 200mg', combinaison: 'doliprane suppositoire 200mg', variations: [
            'doliprane suppo 200mg', 'doliprane suppositoire 200mg'
        ]},
        { medicament: 'doliprane', forme: 'orodispersible', combinaison: 'doliprane orodispersible', variations: [
            'doliprane orodispersible', 'doliprane lyoc', 'doliprane fondant'
        ]},
        { medicament: 'doliprane', forme: 'orodispersible 250mg', combinaison: 'doliprane orodispersible 250mg', variations: [
            'doliprane orodispersible 250mg', 'doliprane lyoc 250mg'
        ]},

        // ============================================
        // AMOXICILLINE (15 combinaisons)
        // ============================================
        { medicament: 'amoxicilline', forme: 'gélule', combinaison: 'amoxicilline gélule', variations: [
            'amoxicilline gélule', 'amoxicilline gelule', 'amox gélule',
            'amoxicilline en gélule', 'amoxicilline capsule'
        ]},
        { medicament: 'amoxicilline', forme: 'gélule 500mg', combinaison: 'amoxicilline 500mg gélule', variations: [
            'amoxicilline 500mg', 'amoxicilline 500', 'amox 500mg',
            'amoxicilline gélule 500mg', 'amoxicilline 500 mg'
        ]},
        { medicament: 'amoxicilline', forme: 'gélule 250mg', combinaison: 'amoxicilline 250mg gélule', variations: [
            'amoxicilline 250mg', 'amoxicilline 250', 'amox 250mg'
        ]},
        { medicament: 'amoxicilline', forme: 'suspension', combinaison: 'amoxicilline suspension', variations: [
            'amoxicilline susp', 'amoxicilline suspension', 'amox sirop',
            'amoxicilline en suspension', 'amoxicilline sirop'
        ]},
        { medicament: 'amoxicilline', forme: 'suspension 125mg/5ml', combinaison: 'amoxicilline 125mg/5ml suspension', variations: [
            'amoxicilline 125mg/5ml', 'amoxicilline pédiatrique 125mg/5ml',
            'amox sirop 125mg/5ml', 'amoxicilline enfant 125mg/5ml'
        ]},
        { medicament: 'amoxicilline', forme: 'suspension 250mg/5ml', combinaison: 'amoxicilline 250mg/5ml suspension', variations: [
            'amoxicilline 250mg/5ml', 'amoxicilline 250mg/5ml sirop'
        ]},
        { medicament: 'amoxicilline', forme: 'poudre pour suspension', combinaison: 'amoxicilline poudre pour suspension', variations: [
            'amoxicilline poudre', 'amoxicilline à reconstituer',
            'amoxicilline poudre pour sirop'
        ]},

        // ============================================
        // AUGMENTIN (10 combinaisons)
        // ============================================
        { medicament: 'augmentin', forme: 'comprimé', combinaison: 'augmentin comprimé', variations: [
            'augmentin comprimé', 'augmentin cp', 'augmentin en comprimé'
        ]},
        { medicament: 'augmentin', forme: 'comprimé 500mg', combinaison: 'augmentin 500mg comprimé', variations: [
            'augmentin 500mg', 'augmentin 500', 'augmentin 500 mg'
        ]},
        { medicament: 'augmentin', forme: 'comprimé 1g', combinaison: 'augmentin 1g comprimé', variations: [
            'augmentin 1g', 'augmentin 1000mg', 'augmentin 1000'
        ]},
        { medicament: 'augmentin', forme: 'suspension', combinaison: 'augmentin suspension', variations: [
            'augmentin susp', 'augmentin sirop', 'augmentin enfant'
        ]},

        // ============================================
        // FLAGYL (10 combinaisons)
        // ============================================
        { medicament: 'flagyl', forme: 'comprimé', combinaison: 'flagyl comprimé', variations: [
            'flagyl comprimé', 'flagyl cp', 'flagyl en comprimé'
        ]},
        { medicament: 'flagyl', forme: 'comprimé 250mg', combinaison: 'flagyl 250mg comprimé', variations: [
            'flagyl 250mg', 'flagyl 250', 'flagyl 250 mg'
        ]},
        { medicament: 'flagyl', forme: 'comprimé 500mg', combinaison: 'flagyl 500mg comprimé', variations: [
            'flagyl 500mg', 'flagyl 500', 'flagyl 500 mg'
        ]},
        { medicament: 'flagyl', forme: 'suspension', combinaison: 'flagyl suspension', variations: [
            'flagyl susp', 'flagyl sirop', 'flagyl pédiatrique'
        ]},
        { medicament: 'flagyl', forme: 'suspension 125mg/5ml', combinaison: 'flagyl 125mg/5ml suspension', variations: [
            'flagyl 125mg/5ml', 'flagyl enfant 125mg/5ml'
        ]},

        // ============================================
        // VENTOLINE (10 combinaisons)
        // ============================================
        { medicament: 'ventoline', forme: 'spray', combinaison: 'ventoline spray', variations: [
            'ventoline spray', 'ventoline en spray', 'ventoline inhalateur',
            'ventoline aérosol', 'ventoline bouffée'
        ]},
        { medicament: 'ventoline', forme: 'spray 100µg', combinaison: 'ventoline 100µg spray', variations: [
            'ventoline 100µg', 'ventoline 100 mcg', 'ventoline 100 microgrammes'
        ]},
        { medicament: 'ventoline', forme: 'solution pour inhalation', combinaison: 'ventoline solution inhalation', variations: [
            'ventoline solution', 'ventoline pour nébulisation'
        ]},

        // ============================================
        // SPASFON (10 combinaisons)
        // ============================================
        { medicament: 'spasfon', forme: 'comprimé', combinaison: 'spasfon comprimé', variations: [
            'spasfon comprimé', 'spasfon cp', 'spasfon en comprimé'
        ]},
        { medicament: 'spasfon', forme: 'comprimé 80mg', combinaison: 'spasfon 80mg comprimé', variations: [
            'spasfon 80mg', 'spasfon 80', 'spasfon 80 mg'
        ]},
        { medicament: 'spasfon', forme: 'suppositoire', combinaison: 'spasfon suppositoire', variations: [
            'spasfon suppo', 'spasfon supp', 'spasfon en suppo'
        ]},
        { medicament: 'spasfon', forme: 'injectable', combinaison: 'spasfon injectable', variations: [
            'spasfon inj', 'spasfon injection', 'spasfon ampoule'
        ]},

        // ============================================
        // SMECTA (5 combinaisons)
        // ============================================
        { medicament: 'smecta', forme: 'sachet', combinaison: 'smecta sachet', variations: [
            'smecta sachet', 'smecta en sachet', 'smecta poudre',
            'smecta 3g sachet', 'smecta sachet-dose'
        ]},

        // ============================================
        // EFFERALGAN (10 combinaisons)
        // ============================================
        { medicament: 'efferalgan', forme: 'comprimé effervescent', combinaison: 'efferalgan effervescent', variations: [
            'efferalgan effervescent', 'efferalgan efferv', 'efferalgan à dissoudre'
        ]},
        { medicament: 'efferalgan', forme: 'comprimé effervescent 500mg', combinaison: 'efferalgan 500mg effervescent', variations: [
            'efferalgan 500mg', 'efferalgan 500', 'efferalgan 500 efferv'
        ]},
        { medicament: 'efferalgan', forme: 'comprimé', combinaison: 'efferalgan comprimé', variations: [
            'efferalgan cp', 'efferalgan comprimé'
        ]},
        { medicament: 'efferalgan', forme: 'sirop', combinaison: 'efferalgan sirop', variations: [
            'efferalgan sirop', 'efferalgan enfant', 'efferalgan pédiatrique'
        ]},

        // ============================================
        // DAFALGAN (8 combinaisons)
        // ============================================
        { medicament: 'dafalgan', forme: 'comprimé', combinaison: 'dafalgan comprimé', variations: [
            'dafalgan cp', 'dafalgan comprimé', 'dafalgan en comprimé'
        ]},
        { medicament: 'dafalgan', forme: 'comprimé 500mg', combinaison: 'dafalgan 500mg comprimé', variations: [
            'dafalgan 500mg', 'dafalgan 500', 'dafalgan 500 mg'
        ]},
        { medicament: 'dafalgan', forme: 'comprimé 1000mg', combinaison: 'dafalgan 1000mg comprimé', variations: [
            'dafalgan 1000mg', 'dafalgan 1g', 'dafalgan 1000'
        ]},

        // ============================================
        // IBUPROFÈNE (10 combinaisons)
        // ============================================
        { medicament: 'ibuprofène', forme: 'comprimé', combinaison: 'ibuprofène comprimé', variations: [
            'ibuprofène cp', 'ibuprofène comprimé', 'ibu en comprimé'
        ]},
        { medicament: 'ibuprofène', forme: 'comprimé 200mg', combinaison: 'ibuprofène 200mg comprimé', variations: [
            'ibuprofène 200mg', 'ibu 200', 'ibuprofène 200'
        ]},
        { medicament: 'ibuprofène', forme: 'comprimé 400mg', combinaison: 'ibuprofène 400mg comprimé', variations: [
            'ibuprofène 400mg', 'ibu 400', 'ibuprofène 400'
        ]},
        { medicament: 'ibuprofène', forme: 'sirop', combinaison: 'ibuprofène sirop', variations: [
            'ibuprofène sirop', 'ibu sirop', 'ibuprofène enfant'
        ]},
        { medicament: 'ibuprofène', forme: 'gel', combinaison: 'ibuprofène gel', variations: [
            'ibuprofène gel', 'ibu gel', 'ibuprofène crème'
        ]},

        // ============================================
        // ADVIL (8 combinaisons)
        // ============================================
        { medicament: 'advil', forme: 'comprimé', combinaison: 'advil comprimé', variations: [
            'advil cp', 'advil comprimé', 'advil en comprimé'
        ]},
        { medicament: 'advil', forme: 'comprimé 200mg', combinaison: 'advil 200mg comprimé', variations: [
            'advil 200mg', 'advil 200', 'advil 200 mg'
        ]},
        { medicament: 'advil', forme: 'comprimé 400mg', combinaison: 'advil 400mg comprimé', variations: [
            'advil 400mg', 'advil 400'
        ]},
        { medicament: 'advil', forme: 'sirop', combinaison: 'advil sirop', variations: [
            'advil sirop', 'advil enfant', 'advil pédiatrique'
        ]},

        // ============================================
        // NUROFEN (8 combinaisons)
        // ============================================
        { medicament: 'nurofen', forme: 'comprimé', combinaison: 'nurofen comprimé', variations: [
            'nurofen cp', 'nurofen comprimé'
        ]},
        { medicament: 'nurofen', forme: 'comprimé 200mg', combinaison: 'nurofen 200mg comprimé', variations: [
            'nurofen 200mg', 'nurofen 200'
        ]},
        { medicament: 'nurofen', forme: 'sirop', combinaison: 'nurofen sirop', variations: [
            'nurofen sirop', 'nurofen enfant', 'nurofen bébé'
        ]},

        // ============================================
        // METFORMINE (6 combinaisons)
        // ============================================
        { medicament: 'metformine', forme: 'comprimé', combinaison: 'metformine comprimé', variations: [
            'metformine cp', 'metformine comprimé', 'metformine en comprimé'
        ]},
        { medicament: 'metformine', forme: 'comprimé 500mg', combinaison: 'metformine 500mg comprimé', variations: [
            'metformine 500mg', 'metformine 500', 'metformine 500 mg'
        ]},
        { medicament: 'metformine', forme: 'comprimé 850mg', combinaison: 'metformine 850mg comprimé', variations: [
            'metformine 850mg', 'metformine 850'
        ]},
        { medicament: 'metformine', forme: 'comprimé 1000mg', combinaison: 'metformine 1000mg comprimé', variations: [
            'metformine 1000mg', 'metformine 1g'
        ]},

        // ============================================
        // AMLODIPINE (6 combinaisons)
        // ============================================
        { medicament: 'amlodipine', forme: 'comprimé', combinaison: 'amlodipine comprimé', variations: [
            'amlodipine cp', 'amlodipine comprimé'
        ]},
        { medicament: 'amlodipine', forme: 'comprimé 5mg', combinaison: 'amlodipine 5mg comprimé', variations: [
            'amlodipine 5mg', 'amlodipine 5', 'amlodipine 5 mg'
        ]},
        { medicament: 'amlodipine', forme: 'comprimé 10mg', combinaison: 'amlodipine 10mg comprimé', variations: [
            'amlodipine 10mg', 'amlodipine 10'
        ]},

        // ============================================
        // QUININE (5 combinaisons)
        // ============================================
        { medicament: 'quinine', forme: 'comprimé', combinaison: 'quinine comprimé', variations: [
            'quinine cp', 'quinine comprimé'
        ]},
        { medicament: 'quinine', forme: 'injectable', combinaison: 'quinine injectable', variations: [
            'quinine inj', 'quinine injection', 'quinine ampoule'
        ]},

        // ============================================
        // ARTESUNATE (5 combinaisons)
        // ============================================
        { medicament: 'artesunate', forme: 'injectable', combinaison: 'artesunate injectable', variations: [
            'artesunate inj', 'artesunate injection', 'ars injectable'
        ]},
        { medicament: 'artesunate', forme: 'suppositoire', combinaison: 'artesunate suppositoire', variations: [
            'artesunate suppo', 'artesunate rectal'
        ]},

        // ============================================
        // AUTRES MÉDICAMENTS COURANTS (30 combinaisons)
        // ============================================
        { medicament: 'lasilix', forme: 'comprimé 40mg', combinaison: 'lasilix 40mg comprimé', variations: ['lasilix 40mg', 'furosémide 40mg'] },
        { medicament: 'clamoxyl', forme: 'gélule 500mg', combinaison: 'clamoxyl 500mg gélule', variations: ['clamoxyl 500mg', 'clamoxyl 500'] },
        { medicament: 'nivaquine', forme: 'comprimé', combinaison: 'nivaquine comprimé', variations: ['nivaquine cp', 'nivaquine'] },
        { medicament: 'nivaquine', forme: 'sirop', combinaison: 'nivaquine sirop', variations: ['nivaquine sirop'] },
        { medicament: 'ginseng', forme: 'gélule', combinaison: 'ginseng gélule', variations: ['ginseng gel', 'ginseng'] },
        { medicament: 'vitamine C', forme: 'comprimé effervescent', combinaison: 'vitamine C effervescent', variations: ['vitamine C efferv', 'vit C effervescent'] },
        { medicament: 'vitamine C', forme: 'comprimé', combinaison: 'vitamine C comprimé', variations: ['vitamine C cp', 'vit C'] },
        { medicament: 'dexamethasone', forme: 'comprimé 4mg', combinaison: 'dexamethasone 4mg comprimé', variations: ['dexamethasone 4mg', 'dex 4mg'] },
        { medicament: 'prednisolone', forme: 'comprimé 5mg', combinaison: 'prednisolone 5mg comprimé', variations: ['prednisolone 5mg', 'pred 5mg'] },
        { medicament: 'prednisolone', forme: 'sirop', combinaison: 'prednisolone sirop', variations: ['prednisolone sirop', 'pred sirop'] }
    ];

    // Ajout des combinaisons médicament + forme
    combinaisonsMedForme.forEach(combo => {
        this.manager.addNamedEntityText('medicament_forme', combo.combinaison, ['fr'], combo.variations);
    });

    console.log('✅ Entités 11-21 ajoutées avec 200+ exemples chacune');
}
   // ============================================
    // ENTRAÎNEMENT DU MODÈLE
    // ============================================
    async train() {
    console.log('🎯 Début de l\'entraînement du modèle NLP...');
    console.time('Entraînement');

    this.loadTrainingData();  // Charge les intentions
    this.addEntities();       // Ajoute les entités - VÉRIFIEZ QUE CETTE LIGNE EST PRÉSENTE

    console.log('⚙️ Entraînement en cours...');
    await this.manager.train();
    
    console.timeEnd('Entraînement');
    console.log('✅ Modèle entraîné avec succès');

    this.manager.save(this.modelPath);
    console.log(`💾 Modèle sauvegardé dans ${this.modelPath}`);

    return this.manager;
}
}
// ============================================
// EXÉCUTION PRINCIPALE
// ============================================
async function main() {
    const trainer = new NLPTrainer();
    await trainer.train();
    await trainer.test();
    
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎯 MODÈLE NLP ENTRAÎNÉ AVEC SUCCÈS  succees                     ║
╠══════════════════════════════════════════════════════════════╣

    `);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = NLPTrainer;

