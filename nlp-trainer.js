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
            nlu: { log: true },
            ner: { 
                builtins: ['number', 'date', 'time', 'email', 'url', 'phone'],
                threshold: 0.7
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
        // INTENTION: SALUTATIONS (50 exemples)
        // ============================================
        const saluer = [
            'bonjour', 'salut', 'hello', 'coucou', 'Bonsoir', 'Bonne nuit',
            'Bien le bonjour', 'MIA', 'Bonjour MIA', 'Salut MIA', 'Hey', 'Yo',
            'bsr', 'bjr', 'Bon matin', 'Bonne après-midi', 'ça va ?',
            'Comment ça va ?', 'Comment tu vas ?', 'Bien ou bien ?', 'Wesh',
            'Salut la team', 'Bonjour à tous', 'Bonsoir à vous', 'Salutations',
            'Bienvenue', 'Enchanté', 'ravi de te parler', 'content de te voir',
            'me voilà', 'je reviens', 'me revoilà', 'hello there', 'hi',
            'good morning', 'good evening', 'Bonjour l\'équipe', 'Salut les amis',
            'Bonsoir tout le monde', 'Bonne nuit à tous', 'Hey salut', 'Yo mec',
            'Wsh', 'Kikou', 'Allô', 'Bonjour docteur', 'Bonsoir pharmacien',
            'Salut l\'assistant', 'Bonjour MIA comment vas-tu', 'Salut MIA ça roule',
            'Bonjour MIA ça va', 'Salut beauté', 'Bonjour la team', 'Salut les gens'
        ];
        saluer.forEach(phrase => this.manager.addDocument('fr', phrase, 'saluer'));

        // ============================================
        // INTENTION: REMERCIEMENTS (45 exemples)
        // ============================================
        const remercier = [
            'merci', 'merci beaucoup', 'Merci MIA', 'je te remercie', 'Thanks',
            'merci bien', 'c\'est gentil', 'Merci pour ton aide',
            'je t\'en suis reconnaissant', 'je tiens à te remercier', 'un grand merci',
            'Merci infiniment', 'Merci bcp', 'Merci mille fois', 'Dieu te bénisse',
            'Bonne continuation', 'merci merci', 'merci à toi', 'je t\'apprécie',
            'c\'est super gentil', 'vraiment merci', 'merci pour tout',
            'merci de m\'aider', 'je te dis merci', 'merci pour les infos',
            'merci pour ta réponse', 'merci pour ton temps', 'je vous remercie',
            'merci à vous', 'avec tout mon coeur merci', 'mille mercis',
            'un énorme merci', 'merci du fond du coeur', 'merci infiniment pour ton aide',
            'je ne sais pas comment te remercier', 'merci pour ta disponibilité',
            'merci d\'avoir répondu rapidement', 'merci pour ces informations précieuses',
            'merci pour ton professionnalisme', 'merci pour ta gentillesse',
            'merci pour ton service', 'merci pour ton aide précieuse', 'je t\'en suis très reconnaissant',
            'merci du fond du cœur', 'merci pour tout ce que tu fais', 'merci d\'être là',
            'merci pour ton écoute', 'merci pour tes conseils'
        ];
        remercier.forEach(phrase => this.manager.addDocument('fr', phrase, 'remercier'));

        // ============================================
        // INTENTION: AU REVOIR (40 exemples)
        // ============================================
        const auRevoir = [
            'au revoir', 'bye', 'a plus', 'à bientôt', 'à la prochaine',
            'bonne journée', 'bonne soirée', 'bonne nuit', 'a tout à l\'heure',
            'je te laisse', 'je dois y aller', 'salut à plus', 'à demain',
            'on se reparle', 'bye bye', 'ciao', 'A+', 'à plus tard',
            'à très bientôt', 'on se voit plus tard', 'je me casse', 'je file',
            'je dois partir', 'je quitte', 'bonne fin de journée',
            'passe une bonne journée', 'passe une bonne soirée', 'fais de beaux rêves',
            'à la revoyure', 'adieu', 'take care', 'see you later', 'goodbye',
            'à un de ces quatre', 'je m\'en vais', 'je te laisse tranquille',
            'je te dis à plus tard', 'on se capte plus tard', 'bonne continuation',
            'à la prochaine fois', 'à tout à l\'heure', 'je repars', 'je te quitte',
            'bonne fin de semaine', 'bon week-end', 'à lundi', 'à demain si Dieu veut',
            'passe une bonne fin de journée', 'je te dis à bientôt'
        ];
        auRevoir.forEach(phrase => this.manager.addDocument('fr', phrase, 'au_revoir'));

        // ============================================
        // INTENTION: AIDE (50 exemples)
        // ============================================
        const aide = [
            'aide', 'help', 'j\'ai besoin d\'aide', 'comment utiliser ce bot',
            'que pouvez-vous faire', 'fonctionnalités', 'qu\'est-ce que tu sais faire',
            'dis-moi ce que tu peux faire', 'guide d\'utilisation', 'mode d\'emploi',
            'comment ça marche', 'besoin d\'assistance', 'à quoi tu sers',
            'c\'est quoi Pillbox', 'présentation du service', 'help me',
            'j\'ai besoin de toi', 'instructions', 'manuel', 'tutoriel',
            'débuter', 'commencer', 'par où commencer', 'que faire',
            'aide moi s\'il te plaît', 'assistance', 'au secours', 'SOS',
            'explique-moi', 'comment fonctionnes-tu', 'quelles sont tes capacités',
            'liste des commandes', 'commandes disponibles', 'ce que je peux faire',
            'quelles sont les options', 'menu principal', 'menu d\'aide',
            'guide utilisateur', 'documentation', 'foire aux questions', 'FAQ',
            'questions fréquentes', 'besoin d\'un coup de main', 'peux-tu m\'aider',
            'est-ce que tu peux m\'aider', 'un peu d\'aide', 'aide-moi à commander',
            'aide-moi à trouver une pharmacie', 'comment chercher un médicament',
            'comment connaître le prix d\'un médicament', 'comment passer commande',
            'comment prendre rendez-vous', 'comment suivre ma commande', 'comment annuler une commande',
            'comment modifier mon rendez-vous', 'comment voir mon panier', 'comment ça fonctionne',
            'je ne comprends pas comment utiliser', 'explique-moi le fonctionnement', 'c\'est compliqué aide-moi',
            'je suis perdu aide-moi', 'guide pas à pas', 'tutoriel pour débutant'
        ];
        aide.forEach(phrase => this.manager.addDocument('fr', phrase, 'aide'));

        // ============================================
        // INTENTION: QUESTION BOT (35 exemples)
        // ============================================
        const questionBot = [
            'qui es-tu', 'c\'est quoi MIA', 'qui a créé ce bot', 'tu es un robot',
            'tu es humain', 'es-tu une IA', 'comment tu t\'appelles', 'ton nom',
            'présente-toi', 'que signifie MIA', 'ton créateur', 'quelle est ta fonction',
            'est-ce que tu es une vraie personne', 'parle-moi de toi', 'qui es-tu vraiment',
            'es-tu intelligent', 'comment fonctionnes-tu', 'technologie utilisée',
            'es-tu gratuit', 'pourquoi t\'appelles-tu MIA', 'MIA c\'est quoi',
            'ton âge', 'depuis quand tu existes', 'qui est derrière toi',
            'équipe Pillbox', 'qui vous a développé', 'les développeurs',
            'qui sont tes créateurs', 'qui t\'a programmé', 'qui t\'a conçu',
            'les personnes derrière ce projet', 'l\'équipe de développement',
            'les fondateurs', 'les créateurs', 'vous êtes de quelle université',
            'vous êtes de San Pedro', 'vous êtes de l\'Université Polytechnique de San Pedro',
            'qui est Yousself', 'qui est Delphin', 'Yousself et Delphin',
            'les deux étudiants', 'vous avez créé ça en 2026', 'c\'est un projet étudiant',
            'projet universitaire', 'c\'est vous qui avez codé ça', 'vous avez fait ça tout seuls',
            'c\'est un projet de fin d\'études', 'vous êtes en quelle année', 'L2 et M1 c\'est ça'
        ];
        questionBot.forEach(phrase => this.manager.addDocument('fr', phrase, 'question_bot'));

        // ============================================
        // INTENTION: RECHERCHER MEDICAMENT (150 exemples)
        // ============================================
        const rechercherMedicament = [
            'je cherche un médicament', 'je veux un médicament',
            'j\'ai besoin d\'un médicament', 'est-ce que vous avez des médicaments',
            'je voudrais savoir si vous avez des médicaments', 'vous vendez des médicaments',
            'je recherche un produit pharmaceutique', 'où puis-je trouver des médicaments',
            'avez-vous des médicaments en stock', 'je veux acheter des médicaments',
            'je cherche doliprane', 'est-ce que vous avez doliprane',
            'doliprane est disponible', 'je veux doliprane',
            'je cherche amoxicilline', 'amoxicilline dispo',
            'je veux amoxicilline', 'est-ce que paracétamol est en stock',
            'ibuprofène disponible', 'vous avez flagyl',
            'je cherche flagyl', 'augmentin en stock',
            'est-ce que fervex est dispo', 'artesunate disponible',
            'je veux quinine', 'smecta vous avez',
            'ventoline dispo', 'je cherche spasfon',
            'dafalgan est dispo', 'efferalgan disponible',
            'je cherche metformine', 'amlodipine 5mg disponible',
            'je cherche glucophage', 'vous avez lasilix',
            'clamoxyl disponible', 'je veux piqûre pour le paludisme',
            'est-ce que nivaquine existe encore', 'ginseng pour la forme',
            'vitamine C 1000mg', 'aspirine du matin',
            'héparine pour bébé', 'dexamethasone 4mg',
            'prednisolone sirop', 'zinc pour enfant',
            'fer pour grossesse', 'actifed rhume',
            'rhinofébral grippe', 'doliprane 500',
            'doliprane 1000', 'advil 400mg',
            'nurofen enfant', 'je cherche sirop pour la toux',
            'cough sirop', 'antibiotique large spectre',
            'pommade pour douleur', 'crème antifongique',
            'collyre pour yeux', 'je cherche des médicaments pour bébé',
            'vous avez des médicaments pour enfant', 'je veux des médicaments pour adulte',
            'avez-vous des médicaments génériques', 'je cherche un antibiotique',
            'vous avez des antipaludiques', 'je veux des antalgiques',
            'vous avez des anti-inflammatoires', 'je cherche des antiviraux',
            'vous avez des antifongiques', 'je cherche des vaccins',
            'vous avez des sirops pour la toux', 'je veux des comprimés pour le mal de tête',
            'vous avez des gélules pour le palu', 'je cherche des pastilles pour la gorge',
            'vous avez des inhalateurs pour l\'asthme', 'je veux des crèmes pour les allergies',
            'vous avez des pommades pour les douleurs', 'je cherche des collyres pour les yeux',
            'vous avez des suppositoires pour bébé', 'je veux des injections pour la fièvre',
            'vous avez des perfusions', 'je cherche des solutions buvables',
            'vous avez des sirops pédiatriques', 'je veux des médicaments pour la tension',
            'vous avez des médicaments pour le diabète', 'je cherche des médicaments pour le cholestérol',
            'vous avez des médicaments pour le coeur', 'je veux des médicaments pour l\'estomac',
            'vous avez des médicaments pour les reins', 'je cherche des médicaments pour les articulations',
            'vous avez des médicaments pour la peau', 'je cherche un médicament contre la fièvre',
            'je veux quelque chose pour la douleur', 'avez-vous du doliprane pour enfant',
            'est-ce que l\'amoxicilline est en stock', 'je veux du flagyl 500mg',
            'vous avez l\'ibuprofène en gel', 'je cherche ventoline pour mon fils',
            'smecta est disponible pour bébé', 'je veux spasfon pour les règles douloureuses',
            'avez-vous dafalgan 1000mg', 'efferalgan effervescent c\'est dispo',
            'je cherche metformine 500mg', 'amlodipine 10mg vous avez',
            'je veux glucophage 1000mg', 'vous avez lasilix 40mg',
            'clamoxyl 1g est disponible', 'je cherche de la quinine injectable',
            'est-ce que nivaquine sirop existe', 'ginseng en gélules',
            'vitamine C 500mg effervescent', 'aspirine pour bébé',
            'héparine pour bébé est disponible', 'dexamethasone en crème',
            'prednisolone 5mg', 'zinc sirop', 'fer en comprimé',
            'actifed jour et nuit', 'rhinofébral comprimé', 'je cherche du citrate de bétaïne',
            'vous avez du dextroproproxyphène', 'est-ce que le tramadol est disponible',
            'je veux du zaldiar', 'vous avez du lamaline', 'je cherche du kétoprofène',
            'est-ce que le piroxicam est dispo', 'je veux du meloxicam', 'vous avez de l\'indométacine',
            'je cherche de la colchicine', 'est-ce que l\'allopurinol est en stock',
            'je veux du furosémide', 'vous avez de l\'hydrochlorothiazide',
            'je cherche de la digoxine', 'est-ce que l\'amiodarone est disponible'
        ];
        rechercherMedicament.forEach(phrase => {
            // Ajouter avec entités pour les noms de médicaments
            if (phrase.includes('doliprane')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'doliprane', ['fr'], ['doliprane', 'doliprane 500', 'doliprane 1000']);
            } else if (phrase.includes('amoxicilline')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'amoxicilline', ['fr'], ['amoxicilline', 'amox']);
            } else if (phrase.includes('paracétamol')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'paracétamol', ['fr'], ['paracétamol', 'paracetamol']);
            } else if (phrase.includes('ibuprofène')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'ibuprofène', ['fr'], ['ibuprofène', 'ibuprofene']);
            } else if (phrase.includes('flagyl')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'flagyl', ['fr'], ['flagyl']);
            } else if (phrase.includes('augmentin')) {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
                this.manager.addNamedEntityText('medicament', 'augmentin', ['fr'], ['augmentin']);
            } else {
                this.manager.addDocument('fr', phrase, 'rechercher_medicament');
            }
        });

        // ============================================
        // INTENTION: PRIX MEDICAMENT (100 exemples)
        // ============================================
        const prixMedicament = [
            'c\'est combien le doliprane', 'quel est le prix du doliprane',
            'combien coûte doliprane', 'prix doliprane',
            'tarif doliprane', 'doliprane c\'est combien',
            'le doliprane est à quel prix', 'je voudrais connaître le prix du doliprane',
            'donne-moi le prix du doliprane', 'combien pour doliprane',
            'c\'est combien le paracétamol', 'prix du paracétamol',
            'combien coûte amoxicilline', 'augmentin prix',
            'quel est le prix de flagyl', 'ibuprofène c\'est combien',
            'combien pour spasfon', 'ventoline prix en pharmacie',
            'tarif smecta', 'combien coûte le dafalgan',
            'efferalgan 500mg prix', 'quel est le prix du fansidar',
            'artesunate combien', 'quinine injectable prix',
            'prix doliprane 1000', 'combien pour une boîte de clamoxyl',
            'metformine 500mg c\'est combien', 'amlodipine 10mg prix',
            'ginseng combien', 'vitamine C prix',
            'aspirine tarif', 'nivaquine prix actuel',
            'combien coûte nurofen enfant', 'sirop pour toux prix',
            'pommade voltarene prix', 'crème mycose combien',
            'collyre chloramphénicol prix', 'combien le flagyl 500mg',
            'prix augmentin 1g', 'doliprane orodispersible prix',
            'efferalgan effervescent combien', 'spasfon comprimé prix',
            'smecta sachet tarif', 'ventoline spray prix',
            'lasilix 40mg combien', 'héparine sirop prix',
            'dexamethasone 4mg prix', 'prednisolone 20mg tarif',
            'zinc sirop enfant combien', 'fer grossesse prix',
            'actifed comprimé combien', 'combien coûte une boîte de médicaments',
            'quel est le prix moyen des médicaments', 'les médicaments sont à combien',
            'c\'est cher les médicaments chez vous', 'vous avez des promotions sur les médicaments',
            'est-ce que les prix sont fixes', 'y a-t-il des réductions pour les médicaments',
            'combien pour une ordonnance complète', 'prix des antibiotiques',
            'tarif des antipaludiques', 'combien coûtent les antalgiques',
            'prix des sirops pour enfants', 'combien pour les vaccins',
            'tarif des injections', 'prix des perfusions',
            'combien pour les crèmes dermatologiques', 'prix des pommades',
            'combien pour les collyres', 'combien coûte le doliprane en pharmacie',
            'le doliprane est à combien', 'amoxicilline prix en pharmacie',
            'flagyl 125mg prix', 'combien le spasfon en boîte de 30',
            'ventoline 100µg prix', 'smecta 3g boîte prix',
            'dafalgan codéïné prix', 'efferalgan vitamine C prix',
            'combien le citrate de bétaïne', 'prix du dextroproproxyphène',
            'le tramadol c\'est combien', 'prix du zaldiar', 'lamaline tarif',
            'kétoprofène combien', 'piroxicam prix', 'meloxicam c\'est combien',
            'indométacine tarif', 'colchicine prix', 'allopurinol combien',
            'furosémide c\'est combien', 'hydrochlorothiazide prix',
            'digoxine tarif', 'amiodarone combien', 'cordarone prix',
            'le générique du doliprane coûte combien', 'prix du générique de l\'amoxicilline'
        ];
        prixMedicament.forEach(phrase => {
            this.manager.addDocument('fr', phrase, 'prix_medicament');
        });

        // ============================================
        // INTENTION: PHARMACIE DE GARDE (100 exemples)
        // ============================================
        const pharmacieGarde = [
            'pharmacie de garde', 'je cherche une pharmacie de garde',
            'où trouver une pharmacie de garde', 'quelle pharmacie est de garde',
            'pharmacie ouverte maintenant', 'pharmacie de nuit',
            'pharmacie 24h/24', 'pharmacie ouverte dimanche',
            'pharmacie ouverte aujourd\'hui', 'qui garde cette nuit',
            'pharmacie de garde pour ce soir', 'urgence pharmacie',
            'besoin d\'une pharmacie d\'urgence', 'pharmacie de garde à cocody',
            'pharmacie de garde à marcory', 'pharmacie de garde à yopougon',
            'pharmacie de garde à plateau', 'pharmacie de garde à treichville',
            'pharmacie de garde à koumassi', 'pharmacie de garde à abobo',
            'pharmacie de garde à adjame', 'pharmacie de garde à port-bouet',
            'pharmacie de garde à bingerville', 'pharmacie de garde à anyama',
            'pharmacie de garde à yamoussoukro', 'pharmacie de garde à bouaké',
            'pharmacie de garde à san-pedro', 'pharmacie de garde à daloa',
            'pharmacie de garde à korhogo', 'pharmacie de garde à man',
            'pharmacie de garde à gagnoa', 'pharmacie de garde à bouaflé',
            'pharmacie de garde à grand-bassam', 'pharmacie de garde à abengourou',
            'pharmacie de garde à aboisso', 'pharmacie de garde à adiaké',
            'pharmacie de garde à adzopé', 'pharmacie de garde à agboville',
            'pharmacie de garde à agnibilékrou', 'pharmacie de garde à bondoukou',
            'pharmacie de garde à bonoua', 'pharmacie de garde à duékoué',
            'pharmacie de garde à divo', 'pharmacie de garde à guiglo',
            'pharmacie de garde à issia', 'pharmacie de garde à odienné',
            'pharmacie de garde à sinfra', 'pharmacie de garde à soubré',
            'pharmacie de garde à tiassalé', 'pharmacie de garde à toumodi',
            'pharmacie de garde à vavoua', 'quelle pharmacie garde à cocody aujourd\'hui',
            'qui garde ce soir à marcory', 'pharmacie ouverte maintenant à yopougon',
            'garde pharmaceutique plateau', 'pharmacie de nuit à treichville',
            'urgence pharmacie koumassi', 'je cherche une pharmacie de garde à abobo',
            'pharmacie garde adjame', 'qui garde cette nuit à port-bouet',
            'pharmacie ouverte dimanche à bingerville', 'garde du jour à anyama',
            'pharmacie de garde dans ma zone', 'qui garde dans mon quartier',
            'où trouver pharmacie ouverte maintenant', 'pharmacie proche de moi ouverte',
            'pharmacie ouverte tard le soir', 'pharmacie ouverte tôt le matin',
            'pharmacie de garde pour le week-end', 'pharmacie de garde jour férié',
            'pharmacie de garde noël', 'pharmacie de garde nouvel an',
            'pharmacie de garde lundi', 'pharmacie de garde mardi',
            'pharmacie de garde mercredi', 'pharmacie de garde jeudi',
            'pharmacie de garde vendredi', 'pharmacie de garde samedi',
            'pharmacie de garde dimanche', 'quelle pharmacie est ouverte en ce moment',
            'je cherche une pharmacie ouverte à côté de chez moi',
            'y a-t-il une pharmacie de garde près d\'ici', 'pharmacie ouverte à cette heure-ci',
            'pharmacie de garde pour ce week-end', 'pharmacie de garde pour le 1er mai',
            'pharmacie de garde pour la fête de l\'indépendance', 'pharmacie de garde pour le 15 août',
            'pharmacie de garde pour la tabaski', 'pharmacie de garde pour le ramadan',
            'pharmacie de garde pour la fête du mouton', 'pharmacie de garde pour le jour de l\'an',
            'pharmacie de garde à angré', 'pharmacie de garde à deux plateaux',
            'pharmacie de garde à riviera', 'pharmacie de garde à palmeraie',
            'pharmacie de garde à vridi', 'pharmacie de garde à zonago',
            'pharmacie de garde à williamsville', 'pharmacie de garde à belleville',
            'pharmacie de garde au château', 'pharmacie de garde à la banco',
            'pharmacie de garde à la forêt', 'pharmacie de garde à saint-ville'
        ];
        pharmacieGarde.forEach(phrase => {
            if (phrase.includes('cocody')) {
                this.manager.addDocument('fr', phrase, 'pharmacie_garde');
                this.manager.addNamedEntityText('localite', 'cocody', ['fr'], ['cocody', 'cocody-ango']);
            } else if (phrase.includes('marcory')) {
                this.manager.addDocument('fr', phrase, 'pharmacie_garde');
                this.manager.addNamedEntityText('localite', 'marcory', ['fr'], ['marcory']);
            } else if (phrase.includes('yopougon')) {
                this.manager.addDocument('fr', phrase, 'pharmacie_garde');
                this.manager.addNamedEntityText('localite', 'yopougon', ['fr'], ['yopougon', 'yop city']);
            } else if (phrase.includes('plateau')) {
                this.manager.addDocument('fr', phrase, 'pharmacie_garde');
                this.manager.addNamedEntityText('localite', 'plateau', ['fr'], ['plateau', 'le plateau']);
            } else {
                this.manager.addDocument('fr', phrase, 'pharmacie_garde');
            }
        });

        // ============================================
        // INTENTION: COMMANDER (100 exemples)
        // ============================================
        const commander = [
            'je veux commander', 'je souhaite acheter des médicaments',
            'comment passer commande', 'je veux faire une commande',
            'acheter doliprane', 'je prends amoxicilline',
            'commande de médicaments', 'je veux me faire livrer',
            'livraison de médicaments', 'je veux acheter',
            'passer commande maintenant', 'commander ibuprofène 400mg',
            'je veux paracétamol 1000', 'prendre augmentin',
            'je voudrais flagyl', 'commande pour spasfon',
            'j\'aimerais acheter ventoline', 'je veux du smecta',
            'commander dafalgan', 'je prends efferalgan',
            'commander des médicaments pour bébé', 'besoin de médicaments urgents',
            'je veux acheter des produits pharmaceutiques', 'commande en ligne',
            'je veux commander et payer à la livraison', 'comment acheter sur Pillbox',
            'je souhaite passer ma première commande', 'je voudrais commander maintenant',
            'achat médicaments', 'je veux commander 2 boîtes de doliprane',
            'ajouter au panier', 'je veux 3 boîtes de amoxicilline',
            '2 doliprane s\'il vous plaît', 'je prends 5 paracétamol',
            'commander en urgence', 'je souhaite passer une commande groupée',
            'commander pour plusieurs personnes', 'je veux acheter en gros',
            'commande de médicaments en lot', 'je veux passer commande pour l\'hôpital',
            'commander pour une clinique', 'achat de médicaments pour une association',
            'je veux commander des médicaments pour toute la famille', 'passer commande pour bébé',
            'commander pour enfant', 'commander pour adulte',
            'commander pour personne âgée', 'je veux commander des médicaments sans ordonnance',
            'commander des médicaments avec ordonnance', 'je veux acheter des médicaments en vente libre',
            'commander des médicaments sur prescription', 'je voudrais commander des génériques',
            'commander des médicaments de marque', 'je veux commander doliprane 500mg',
            'commande de amoxicilline 1g', 'je veux passer commande pour ibuprofène',
            'commander flagyl 500mg', 'je voudrais commander spasfon 80mg',
            'commande de ventoline spray', 'je veux commander smecta 3g',
            'commander dafalgan 500mg', 'je veux acheter efferalgan effervescent',
            'commande de metformine 500mg', 'je veux commander amlodipine 10mg',
            'commander glucophage 1000mg', 'je voudrais commander lasilix 40mg',
            'commande de clamoxyl 1g', 'je veux acheter quinine injectable',
            'commander nivaquine sirop', 'je veux commander ginseng gélules',
            'commande de vitamine C 1000mg', 'je veux acheter aspirine 500mg',
            'commander héparine pour bébé', 'je veux commander du citrate de bétaïne',
            'je voudrais acheter du dextroproproxyphène', 'commander du tramadol 50mg',
            'je veux du zaldiar', 'je voudrais du lamaline', 'commander du kétoprofène',
            'je veux du piroxicam', 'commander du meloxicam', 'je voudrais de l\'indométacine',
            'commander de la colchicine', 'je veux de l\'allopurinol',
            'je voudrais commander du furosémide', 'commander de l\'hydrochlorothiazide',
            'je veux de la digoxine', 'commander de l\'amiodarone',
            'je souhaite commander pour ma mère', 'je veux commander pour mon père',
            'commander pour mon enfant malade', 'je veux commander pour mon bébé',
            'commander pour ma grossesse', 'je veux commander pour mon accouchement',
            'passer commande pour une urgence', 'je dois commander rapidement',
            'je veux commander et être livré aujourd\'hui', 'commande express'
        ];
        commander.forEach(phrase => this.manager.addDocument('fr', phrase, 'commander'));

        // ============================================
        // INTENTION: MODIFIER COMMANDE (60 exemples)
        // ============================================
        const modifierCommande = [
            'je veux modifier ma commande', 'changer ma commande',
            'modifier commande CMD202402150001', 'je souhaite changer des articles',
            'ajouter un article à ma commande', 'enlever un produit de ma commande',
            'modifier quantité', 'changer la quantité de doliprane',
            'je veux 3 au lieu de 2', 'je veux annuler un article',
            'je ne veux plus de amoxicilline', 'remplacer doliprane par paracétamol',
            'changer d\'avis sur ma commande', 'je veux modifier l\'adresse de livraison',
            'changer le quartier de livraison', 'modifier le numéro de téléphone',
            'je veux changer le mode de paiement', 'passer de carte à Orange Money',
            'modifier les indications de livraison', 'ajouter des instructions pour le livreur',
            'je veux modifier ma commande CMD202402150001', 'changer commande CMD202402150001',
            'pour la commande CMD202402150001, je veux modifier', 'je souhaite modifier ma commande en cours',
            'je veux ajouter spasfon à ma commande', 'je veux enlever flagyl de ma commande',
            'modifier quantité de ibuprofène de 2 à 3', 'je veux 4 doliprane au lieu de 2',
            'je ne veux plus de ventoline dans ma commande', 'remplacer smecta par spasfon',
            'je veux changer le quartier de cocody à marcory', 'modifier téléphone pour le 0701406880',
            'je veux payer avec Wave maintenant', 'je souhaite ajouter un produit',
            'je voudrais retirer un article', 'changer la quantité de ma commande',
            'modifier les articles de ma commande', 'changer l\'adresse de livraison',
            'je veux livrer à une autre adresse', 'changer le destinataire',
            'c\'est pour quelqu\'un d\'autre finalement', 'modifier le nom du client',
            'je veux changer le numéro de commande CMD202402150001', 'pour la commande 123, modifier',
            'modifier ma dernière commande', 'changer ma commande en cours',
            'ajouter du doliprane à ma commande existante', 'enlever du paracétamol',
            'je veux 5 boîtes au lieu de 3', 'doubler la quantité de spasfon',
            'réduire la quantité de flagyl', 'annuler un article de ma commande',
            'remplacer un produit par un autre', 'substituer amoxicilline par augmentin',
            'changer le mode de livraison', 'modifier le créneau de livraison',
            'changer pour livraison express', 'modifier les instructions spéciales',
            'ajouter un code d\'accès', 'changer le code d\'entrée',
            'préciser le nom du quartier', 'modifier la localisation exacte'
        ];
        modifierCommande.forEach(phrase => {
            if (phrase.includes('CMD202402150001')) {
                this.manager.addDocument('fr', phrase, 'modifier_commande');
                this.manager.addNamedEntityText('commande_id', 'CMD202402150001', ['fr'], ['CMD202402150001', 'CMD202402150001']);
            } else {
                this.manager.addDocument('fr', phrase, 'modifier_commande');
            }
        });

        // ============================================
        // INTENTION: ANNULER COMMANDE (50 exemples)
        // ============================================
        const annulerCommande = [
            'je veux annuler ma commande', 'annuler commande',
            'je souhaite annuler ma commande', 'annuler ma commande CMD202402150001',
            'je ne veux plus de ma commande', 'commander annulation',
            'annuler ma commande s\'il vous plaît', 'je veux annuler ma commande CMD202402150001',
            'annuler commande CMD202402150001', 'pour la commande CMD202402150001, je veux annuler',
            'je souhaite annuler ma commande en cours', 'je change d\'avis, annulez ma commande',
            'finalement je ne veux plus commander', 'annulez tout',
            'je veux annuler ma commande de médicaments', 'annuler ma commande de doliprane',
            'je ne veux plus des médicaments commandés', 'comment annuler une commande',
            'procédure d\'annulation de commande', 'puis-je annuler ma commande',
            'est-ce que je peux annuler ma commande', 'annulation commande possible',
            'délai d\'annulation', 'je veux annuler ma commande avant livraison',
            'annuler ma commande déjà passée', 'je veux annuler ma commande et être remboursé',
            'annuler commande et me faire rembourser', 'annuler ma commande 123456',
            'annuler la commande 789', 'je ne veux plus de cette commande',
            'stoppez ma commande', 'arrêtez ma commande', 'annulez ma commande svp',
            'je voudrais annuler ma commande', 'est-il possible d\'annuler ma commande',
            'comment faire pour annuler', 'procédure pour annuler', 'annulation de commande en ligne',
            'annuler ma commande en cours de traitement', 'commande à annuler',
            'je souhaite annuler et être remboursé', 'remboursement après annulation',
            'annulation pour erreur de commande', 'j\'ai commandé par erreur',
            'c\'était une fausse commande', 'commande erronée à annuler',
            'je me suis trompé dans ma commande', 'commande incorrecte à annuler'
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
        const suivreCommande = [
            'suivre ma commande', 'où en est ma commande', 'statut de ma commande',
            'commande CMD202402150001 statut', 'je veux suivre ma commande',
            'suivi de commande', 'état de ma commande', 'ma commande est-elle partie',
            'quand vais-je recevoir ma commande', 'suivi livraison',
            'où est mon colis', 'suivi colis CMD202402150001',
            'ma commande CMD202402150001 est en route', 'suivre commande CMD202402150001',
            'statut commande CMD202402150001', 'vérifier ma commande',
            'contrôle commande', 'je veux savoir l\'état de ma commande',
            'ma commande est-elle confirmée', 'confirmation de commande',
            'quand ma commande sera-t-elle livrée', 'délai restant pour ma commande',
            'suivi en temps réel', 'je veux suivre mon livreur',
            'où se trouve mon livreur', 'le livreur arrive bientôt',
            'suivi de livraison en direct', 'numéro de suivi',
            'tracking commande', 'track mon colis', 'suivi de colis',
            'état d\'avancement de ma commande', 'progression de ma commande',
            'ma commande est où maintenant', 'à quelle étape est ma commande',
            'commande en préparation', 'commande expédiée', 'commande livrée',
            'vérifier le statut', 'status de ma commande', 'ou en est la livraison',
            'le livreur est en route', 'combien de temps encore', 'temps restant',
            'est-ce que ma commande est partie', 'ma commande a-t-elle été confirmée',
            'ai-je une confirmation de commande', 'code de suivi', 'lien de suivi',
            'suivre mon colis en ligne', 'surveiller ma commande'
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
        const panier = [
            'mon panier', 'voir mon panier', 'contenu de mon panier',
            'afficher panier', 'panier d\'achat', 'ce que j\'ai dans mon panier',
            'liste des articles dans mon panier', 'total panier',
            'montant de mon panier', 'vider mon panier', 'supprimer tout du panier',
            'panier vide', 'je veux voir ce que j\'ai ajouté',
            'mes articles sélectionnés', 'produits dans mon panier',
            'récapitulatif panier', 'combien j\'ai dans mon panier',
            'prix total panier', 'panier avec doliprane',
            'mon panier contient doliprane et amoxicilline', 'je veux vérifier mon panier avant commande',
            'vérification panier', 'modifier panier', 'voir le panier',
            'contenu du panier', 'liste des achats', 'récapitulatif des articles',
            'montant total', 'sous-total panier', 'frais de livraison dans panier',
            'articles dans le panier', 'produits ajoutés', 'ce que j\'ai choisi',
            'ma sélection', 'mes médicaments choisis', 'les articles que j\'ai pris',
            'visualiser mon panier', 'consulter mon panier', 'panier actuel'
        ];
        panier.forEach(phrase => this.manager.addDocument('fr', phrase, 'panier'));

        // ============================================
        // INTENTION: QUANTITE (40 exemples)
        // ============================================
        const quantite = [
            '2 doliprane', '3 boîtes de amoxicilline', 'je veux 4 ibuprofène',
            '5 flagyl', '1 spasfon', '10 comprimés', '2 boîtes', '3 flacons',
            '4 tubes', '1 spray', '6 sachets', '2 plaquettes', '3 gélules',
            '4 ampoules', '1 sirop', '2 crèmes', '3 pommades', '5 collyres',
            '2 boîtes de doliprane 500mg', '3 boîtes de amoxicilline 1g',
            'je veux 2 doliprane et 3 amoxicilline', 'quantité: 5',
            'en quantité de 4', 'j\'en veux 6', 'donnez-m\'en 2', 'je prends 3',
            'il m\'en faut 4', 'je veux 1 seule boîte', '2 suffisent',
            '3 c\'est bon', 'combien de boîtes', 'quelle quantité',
            'je veux une douzaine', 'une dizaine', 'une vingtaine',
            'plusieurs boîtes', 'quelques-uns', 'un peu', 'beaucoup',
            'en grande quantité', 'en petite quantité', 'en grosse quantité',
            'en mini dose', 'maxi dose', 'dose normale', 'dose simple'
        ];
        quantite.forEach(phrase => {
            this.manager.addDocument('fr', phrase, 'quantite');
        });

        // ============================================
        // INTENTION: CHOIX NUMERO (60 exemples)
        // ============================================
        const choixNumero = [
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
            'le dernier', 'dernier', 'premier de la liste',
            'dernier de la liste', 'le premier sur la liste', 'le dernier sur la liste',
            'celui en premier', 'celui en dernier', 'le premier proposé',
            'le dernier proposé', 'le numéro 1', 'l\'option 2',
            'le choix 3', 'je prends la 4 option', 'la 5 proposition',
            'article 6', 'produit 7', 'sélection 8',
            'je valide le 9', 'je confirme le 10', 'le numéro 11',
            'le douzième', 'le 13', 'le quatorzième', 'le 15',
            'le seizième', 'le 17', 'le dix-huitième', 'le 19',
            'le vingtième', 'le numéro 20'
        ];
        choixNumero.forEach(phrase => {
            this.manager.addDocument('fr', phrase, 'choix_numero');
        });

        // ============================================
        // INTENTION: INFOS LIVRAISON (60 exemples)
        // ============================================
        const infosLivraison = [
            'comment ça se passe pour la livraison', 'informations sur la livraison',
            'livraison à cocody c\'est possible', 'vous livrez à yopougon',
            'est-ce que vous livrez à bouaké', 'livraison dans san-pedro',
            'zones de livraison', 'combien de temps pour la livraison',
            'délai de livraison', 'livraison gratuite',
            'frais de livraison', 'combien coûte la livraison',
            'livraison à domicile', 'est-ce que vous livrez partout',
            'vous livrez à man', 'livraison à daloa possible',
            'vous livrez dans ma zone', 'comment se fait la livraison',
            'qui livre les commandes', 'livraison le soir',
            'livraison le weekend', 'livraison dimanche',
            'est-ce que je peux me faire livrer au travail', 'livraison dans mon quartier',
            'vous livrez à korhogo', 'livraison à gagnoa',
            'est-ce que la livraison est rapide', 'combien de temps faut-il pour recevoir',
            'délai moyen de livraison', 'livraison express possible',
            'commande livrée en combien de temps', 'frais de port',
            'participation aux frais de livraison', 'est-ce que c\'est gratuit à partir d\'un certain montant',
            'à partir de quel montant la livraison est offerte', 'seuil de gratuité livraison',
            'livraison offerte à partir de combien', 'les frais de livraison sont fixes',
            'est-ce que le prix de la livraison varie selon la distance', 'livraison hors Abidjan combien',
            'livraison à l\'intérieur du pays tarif', 'vous livrez dans toutes les communes d\'Abidjan',
            'vous livrez dans toutes les villes de Côte d\'Ivoire', 'est-ce que la livraison est disponible partout',
            'zones non couvertes par la livraison', 'livraison en zone rurale possible',
            'est-ce que vous livrez dans les villages', 'comment se passe la livraison pour les zones éloignées',
            'livraison dans toute la Côte d\'Ivoire', 'livraison à Abidjan uniquement',
            'livraison partout en CI', 'frais de livraison pour cocody',
            'combien pour livrer à bouaké', 'est-ce que vous livrez à l\'intérieur',
            'livrez-vous à l\'intérieur du pays', 'tarifs de livraison pour l\'intérieur',
            'livraison dans le nord', 'livraison dans l\'ouest', 'livraison dans le centre',
            'livraison dans l\'est', 'livraison dans le sud', 'livraison dans toutes les régions'
        ];
        infosLivraison.forEach(phrase => this.manager.addDocument('fr', phrase, 'infos_livraison'));

        // ============================================
        // INTENTION: URGENCE (70 exemples)
        // ============================================
        const urgence = [
            'c\'est une urgence', 'j\'ai besoin de médicaments en urgence',
            'urgence médicale', 'c\'est très urgent',
            'il me faut ça maintenant', 'urgence absolue',
            'je ne me sens pas bien', 'c\'est grave',
            'besoin immédiat', 'il faut que je sois livré tout de suite',
            'urgence pharmacie', 'je suis malade',
            'c\'est pour mon enfant qui est malade', 'urgence nuit',
            'besoin maintenant', 'je saigne',
            'douleur intense', 'crise de paludisme',
            'forte fièvre', 'difficulté à respirer',
            'réaction allergique', 'c\'est pour un bébé qui a de la fièvre',
            'urgence vitale', 'ça urge',
            'c\'est pressé', 'je suis en danger',
            'besoin d\'aide immédiate', 'ambulance',
            'appeler les urgences', 'numéro des urgences',
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
            'je fais un malaise', 'je vais m\'évanouir', 'je perds connaissance',
            'au secours je meurs', 'c\'est la fin', 'appelez les secours',
            'besoin d\'une ambulance', 'urgent urgent', 'très très urgent',
            'cas d\'urgence', 'situation critique', 'état grave',
            'pronostic vital engagé', 'urgence absolue'
        ];
        urgence.forEach(phrase => this.manager.addDocument('fr', phrase, 'urgence'));

        // ============================================
        // INTENTION: PRENDRE RDV (70 exemples)
        // ============================================
        const prendreRdv = [
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
            'RDV dans une clinique', 'clinique pour rendez-vous',
            'centre de santé', 'cabinet médical',
            'prendre rendez-vous à la clinique Sainte Anne', 'rendez-vous à CHU',
            'consultation à CMA', 'RDV à polyclinique',
            'je veux voir un dentiste', 'rendez-vous dentiste',
            'consultation gynécologue', 'RDV pédiatre',
            'voir un cardiologue', 'consulter un dermatologue',
            'rendez-vous ophtalmologue', 'consultation ORL',
            'voir un orthopédiste', 'RDV neurologue',
            'consulter un psychiatre', 'rendez-vous psychologue',
            'voir un radiologue', 'consultation échographie',
            'RDV analyse médicale', 'prise de sang',
            'bilan de santé', 'check-up complet',
            'rendez-vous pour le 15/04/2026 à 14h30', 'RDV avec Dr Koné',
            'consultation avec le professeur Yao', 'prendre RDV avec Dr Bamba',
            'réserver avec Dr Kouassi', 'voir Dr N\'Guessan',
            'consultation chez Dr Koffi', 'rendez-vous avec le docteur',
            'prendre rendez-vous pour ma fille', 'RDV pour mon fils',
            'consultation pour ma mère', 'rendez-vous pour mon père',
            'voir un médecin pour bébé', 'consultation pédiatrique',
            'rendez-vous pour un enfant', 'consultation prénatale',
            'RDV de grossesse', 'suivi de grossesse', 'consultation postnatale',
            'rendez-vous de contrôle', 'consultation de routine',
            'visite médicale annuelle', 'check-up annuel',
            'bilan de santé complet', 'examen médical'
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

        // ============================================
        // INTENTION: ANNULER RDV (40 exemples)
        // ============================================
        const annulerRdv = [
            'je veux annuler mon rendez-vous', 'annuler RDV',
            'annuler rendez-vous RDV2026030201', 'je ne peux pas venir à mon rendez-vous',
            'annuler consultation', 'déprogrammer mon rendez-vous',
            'supprimer rendez-vous', 'annuler RDV RDV2026030201',
            'pour le rendez-vous du 15/04/2026, je veux annuler', 'annuler mon RDV avec Dr Koné',
            'je souhaite annuler ma consultation', 'annuler rendez-vous s\'il vous plaît',
            'je dois annuler mon rendez-vous', 'pas disponible pour le rendez-vous',
            'annuler prise de sang', 'annuler bilan de santé',
            'annuler check-up', 'annuler RDV clinique',
            'annuler rendez-vous médical', 'je ne viendrai pas à mon RDV',
            'annuler pour le 15/04/2026', 'annuler mon rendez-vous de demain',
            'annuler le RDV de la semaine prochaine', 'je ne pourrai pas venir',
            'imprévu, je dois annuler', 'empêchement de dernière minute',
            'annuler mon RDV svp', 'comment annuler un rendez-vous',
            'procédure d\'annulation RDV', 'puis-je annuler mon RDV',
            'est-ce possible d\'annuler', 'délai d\'annulation',
            'annulation sans frais', 'annulation remboursement',
            'annuler et reporter', 'annuler sans pénalité',
            'je souhaite décommander', 'décommander mon RDV',
            'ne pas donner suite au rendez-vous', 'rendez-vous à annuler'
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
        const modifierRdv = [
            'je veux modifier mon rendez-vous', 'changer la date de mon RDV',
            'reporter rendez-vous', 'décaler mon RDV',
            'modifier RDV RDV2026030201', 'changer l\'heure de mon rendez-vous',
            'pour le rendez-vous du 15/04/2026, je veux changer pour le 20/04/2026',
            'modifier consultation', 'reprogrammer mon RDV',
            'je veux changer de médecin', 'voir un autre spécialiste',
            'modifier mon RDV avec Dr Koné', 'déplacer mon rendez-vous à 15h00',
            'reporter à la semaine prochaine', 'changer pour une autre date',
            'je préfère 16h30 au lieu de 14h30', 'modifier pour 16/04/2026',
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
            'modifier la spécialité', 'changer de service'
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
            'le médecin est-il là', 'le docteur est présent',
            'quand est-ce que je peux voir le médecin', 'disponibilité pour un RDV',
            'créneaux libres', 'moments disponibles', 'jours de présence',
            'horaires d\'ouverture du cabinet', 'permanence médicale'
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
            'où consulter près de chez moi', 'médecin proche de mon domicile'
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
            'nutrition'
        ];
        serviceClinique.forEach(phrase => this.manager.addDocument('fr', phrase, 'service_clinique'));

        // ============================================
        // INTENTION: TARIF CLINIQUE (50 exemples)
        // ============================================
        const tarifClinique = [
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
            'tarif consultation en ligne', 'prix visio avec médecin'
        ];
        tarifClinique.forEach(phrase => this.manager.addDocument('fr', phrase, 'tarif_clinique'));

        // ============================================
        // INTENTION: SPECIALITE CLINIQUE (50 exemples)
        // ============================================
        const specialiteClinique = [
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
            'sexologue pour problèmes sexuels', 'médecin esthétique'
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
            'à Biankouma', 'à Danané', 'à Zouan-Hounien', 'à Toulépleu'
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
            'c\'est exactement ça', 'parfait pour moi'
        ];
        confirmer.forEach(phrase => this.manager.addDocument('fr', phrase, 'confirmer'));

        // ============================================
        // INTENTION: REFUSER (50 exemples)
        // ============================================
        const refuser = [
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
            'je ne valide pas', 'rejeter', 'refuser la proposition'
        ];
        refuser.forEach(phrase => this.manager.addDocument('fr', phrase, 'refuser'));

        // ============================================
        // INTENTION: FALLBACK (50 exemples)
        // ============================================
        const fallback = [
            'blablabla', 'test test test', 'asdfghjkl', 'zxcvbnm',
            'qwertyuiop', '123456789', 'a', 'b', 'c',
            'bonjour test', 'salut test', 'je ne sais pas quoi dire',
            'je parle tout seul', 'message aléatoire', 'texte sans sens',
            'phrase incompréhensible', 'mots en vrac', 'suite de lettres',
            'caractères spéciaux', '&é"(-è_çà)', 'rien de spécial',
            'juste pour voir', 'je tape n\'importe quoi', 'test de connexion',
            'vérification', 'check', 'testing', 'essai',
            'essaie', 'on verra', 'peut-être', 'pourquoi pas',
            'je sais pas', 'je ne comprends pas', 'pas compris',
            'j\'ai pas compris', 'je n\'ai pas compris', 'répète',
            'dis encore', 'quoi', 'hein', 'pardon',
            'comment', 'comment ça', 'c\'est-à-dire', 'autre chose',
            'autre', 'd\'autres', 'felfrjrghrvrj', 'kjhgfdsq',
            'mlkjhgfd', 'poiuytreza', 'qsdqsdqsd', 'fghfghfgh',
            'jhgjhgjhg', 'vbnvbnvbn', 'çàçàçàçà', 'rrrrr',
            'ttttt', 'yyyyy', 'uuuuu', 'iiiii',
            'ooooo', 'ppppp', '^^^^', '¨¨¨¨',
            '££££', '€€€€', '{{}}', '[[]]',
            '<<>>', '||', '///', '\\\\\\',
            '@@@', '###', '$$$', '%%%',
            '~~~~', ',,,,', '....', '......',
            '!!!!!!!!!', '????????', '******',
            '+_+_+_', ')(*&^%$#', '1234abc',
            'azerty', 'qsdfgh', 'wxcvbn', 'jklm'
        ];
        fallback.forEach(phrase => this.manager.addDocument('fr', phrase, 'nlu_fallback'));

        console.log('✅ Données d\'entraînement chargées - Plus de 1500 exemples au total');
    }

    // ============================================
    // AJOUT DES ENTITÉS
    // ============================================
    addEntities() {
        console.log('🔧 Ajout des entités...');

        // Entité: numéro
        for (let i = 1; i <= 100; i++) {
            this.manager.addNamedEntityText('numero', i.toString(), ['fr'], [i.toString(), `numéro ${i}`, `n°${i}`]);
        }

        // Entité: quantite
        for (let i = 1; i <= 50; i++) {
            this.manager.addNamedEntityText('quantite', i.toString(), ['fr'], [i.toString(), `${i} boîtes`, `${i} comprimés`]);
        }

        // Entité: date - formats courants
        const datePatterns = [
            'aujourd\'hui', 'demain', 'après-demain', 'hier',
            'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
            'la semaine prochaine', 'la semaine dernière', 'ce mois-ci', 'le mois prochain'
        ];
        datePatterns.forEach(date => {
            this.manager.addNamedEntityText('date', date, ['fr'], [date]);
        });

        // Entité: mois
        const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 
                       'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
        months.forEach((month, index) => {
            this.manager.addNamedEntityText('mois', month, ['fr'], [month]);
        });

        // Entité: heure
        for (let h = 0; h <= 23; h++) {
            for (let m = 0; m <= 45; m += 15) {
                const heure = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                const heureSimple = `${h}h${m ? m : ''}`;
                this.manager.addNamedEntityText('heure', heure, ['fr'], [heure, heureSimple]);
            }
        }

        // Entité: commande_id
        const commandeIds = ['CMD202402150001', 'CMD202402150002', 'CMD202402150003', 'CMD123', 'CMD456'];
        commandeIds.forEach(id => {
            this.manager.addNamedEntityText('commande_id', id, ['fr'], [id]);
        });

        // Entité: rdv_id
        const rdvIds = ['RDV2026030201', 'RDV2026030202', 'RDV2026030203', 'RDV123', 'RDV456'];
        rdvIds.forEach(id => {
            this.manager.addNamedEntityText('rdv_id', id, ['fr'], [id]);
        });

        // Entité: clinique
        const cliniques = ['Sainte Anne', 'CHU', 'CMA', 'polyclinique', 'Clinique Farah', 'Clinique Avicenne'];
        cliniques.forEach(clinique => {
            this.manager.addNamedEntityText('clinique', clinique, ['fr'], [clinique.toLowerCase(), clinique]);
        });

        // Entité: medecin
        const medecins = ['Koné', 'Yao', 'Bamba', 'Kouassi', 'N\'Guessan', 'Koffi', 'Touré', 'Cissé'];
        medecins.forEach(medecin => {
            this.manager.addNamedEntityText('medecin', medecin, ['fr'], [medecin.toLowerCase(), medecin, `Dr ${medecin}`]);
        });

        // Entité: specialite
        const specialites = [
            'cardiologue', 'dermatologue', 'gynécologue', 'pédiatre', 'dentiste',
            'ophtalmologue', 'ORL', 'orthopédiste', 'neurologue', 'psychiatre',
            'psychologue', 'radiologue', 'généraliste', 'chirurgien', 'anesthésiste',
            'rhumatologue', 'endocrinologue', 'néphrologue', 'urologue', 'gastro-entérologue',
            'hépatologue', 'pneumologue', 'allergologue', 'immunologue', 'hématologue',
            'oncologue', 'médecin du sport', 'kinésithérapeute', 'orthophoniste', 'sage-femme'
        ];
        specialites.forEach(spec => {
            this.manager.addNamedEntityText('specialite', spec, ['fr'], [spec.toLowerCase(), spec]);
        });

        // Entité: mode_paiement
        const modesPaiement = [
            'Orange Money', 'Wave', 'Moov Money', 'MTN Money', 'carte Visa', 
            'espèces', 'carte bancaire', 'Mastercard', 'carte de crédit', 
            'virement', 'Mobile Money', 'paiement à la livraison'
        ];
        modesPaiement.forEach(mode => {
            this.manager.addNamedEntityText('mode_paiement', mode, ['fr'], [mode.toLowerCase(), mode]);
        });

        // Entité: localite - toutes les communes d'Abidjan et principales villes
        const localites = [
            'cocody', 'marcory', 'yopougon', 'plateau', 'treichville',
            'koumassi', 'abobo', 'adjame', 'port-bouet', 'bingerville',
            'anyama', 'songon', 'grand-bassam', 'abidjan', 'bouaké',
            'korhogo', 'san-pedro', 'yamoussoukro', 'daloa', 'man',
            'gagnoa', 'odienné', 'bondoukou', 'abengourou', 'divo',
            'soubré', 'guiglo', 'agnibilékrou', 'adzopé', 'agboville',
            'tiassalé', 'toumodi', 'sinfra', 'vavoua', 'duékoué',
            'issia', 'bouaflé', 'bonoua', 'aboisso', 'adiaké'
        ];
        localites.forEach(loc => {
            this.manager.addNamedEntityText('localite', loc, ['fr'], [loc.toLowerCase(), loc]);
        });

        console.log('✅ Entités ajoutées - Plus de 300 entités différentes');
    }

    // ============================================
    // ENTRAÎNEMENT DU MODÈLE
    // ============================================
    async train() {
        console.log('🎯 Début de l\'entraînement du modèle NLP...');
        console.time('Entraînement');

        this.loadTrainingData();
        this.addEntities();

        console.log('⚙️ Entraînement en cours (cela peut prendre quelques minutes)...');
        await this.manager.train();
        
        console.timeEnd('Entraînement');
        console.log('✅ Modèle entraîné avec succès');

        // Sauvegarde du modèle
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
║     🎯 MODÈLE NLP ENTRAÎNÉ AVEC SUCCÈS                       ║
╠══════════════════════════════════════════════════════════════╣
║  • 30+ intentions principales                                ║
║  • 2000+ exemples d'entraînement                             ║
║  • 20+ types d'entités                                       ║
║  • 300+ valeurs d'entités                                    ║
║                                                              ║
║  INTENTIONS AJOUTÉES :                                       ║
║  ✓ modifier_commande  (60 exemples)                          ║
║  ✓ annuler_commande   (50 exemples)                          ║
║  ✓ suivre_commande    (50 exemples)                          ║
║  ✓ panier             (40 exemples)                          ║
║  ✓ quantite           (40 exemples)                          ║
║  ✓ annuler_rdv        (40 exemples)                          ║
║  ✓ modifier_rdv       (40 exemples)                          ║
║  ✓ disponibilite_medecin (30 exemples)                       ║
║  ✓ clinique_proche    (30 exemples)                          ║
║  ✓ service_clinique   (40 exemples)                          ║
║  ✓ tarif_clinique     (50 exemples)                          ║
║  ✓ specialite_clinique (50 exemples)                         ║
║                                                              ║
║  Modèle sauvegardé: model.nlp                                 ║
║  Utilisez NLPService dans votre application                  ║
╚══════════════════════════════════════════════════════════════╝
    `);
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = NLPTrainer;