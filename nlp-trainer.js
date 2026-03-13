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
            nlu: { log: false },
            ner: { threshold: 0.8 }
        });
        this.modelFile = path.join(__dirname, 'model.nlp');
        this.intentsData = this.loadIntentsData();
    }

    loadIntentsData() {
        return {
            intents: [
                {
                    name: "greet",
                    patterns: [
                        "salut", "bonjour", "bonsoir", "bonne nuit", "coucou", "hey", "hello",
                        "slt", "bjr", "bsr", "bn", "cc", "salut mariam", "bonjour mariam",
                        "hello mariam", "coucou mariam", "yo", "wesh", "salut ça va",
                        "bonjour comment ça va", "hey comment tu vas", "salut la team",
                        "bonjour à tous", "salut beauté", "bonsoir madame", "bonjour monsieur",
                        "salut les amis", "hello world", "bonne journée", "bonne soirée",
                        "bonne nuit mariam", "salut ma belle", "bonjour ma chérie", "coucou toi",
                        "hey toi", "salut comment tu t'appelles", "bonjour je suis nouveau",
                        "salut je viens de découvrir", "hi", "hiii", "hellooo", "saluuut",
                        "bonjouur", "bonsooiiir", "cc c'est moi", "salut c'est encore moi",
                        "rebonjour", "resalut", "coucou me revoilà", "me voici", "je suis là",
                        "présent", "oui bonjour", "eh bonjour", "hé bien bonjour", "tiens salut",
                        "oh salut", "ah bonjour", "bon ben salut", "bonjour dans la maison",
                        "salut la compagnie", "bonjour le monde", "hello there", "hi there",
                        "good morning", "good evening", "good afternoon", "salutations",
                        "bien le bonjour", "bien ou bien", "ça va bien", "la famille",
                        "les amis", "frère salut", "soeur salut", "papa salut", "maman salut",
                        "salut la famille", "bonjour à toutes et à tous", "bonsoir tout le monde",
                        "coucou les amis", "hey les gens", "hello tout le monde"
                    ],
                    responses: ["salutation"]
                },
                {
                    name: "goodbye",
                    patterns: [
                        "au revoir", "bye", "à plus", "à bientôt", "ciao", "adieu",
                        "bonne journée", "bonne soirée", "bonne nuit", "à la prochaine",
                        "à demain", "à tout à l'heure", "à plus tard", "salut",
                        "bye bye", "tchao", "ciao ciao", "à plus dans le bus",
                        "à la revoyure", "je me casse", "je me tire", "je dois y aller",
                        "faut que j'y aille", "je file", "ciao à plus", "bye à demain",
                        "au revoir et merci", "bonne continuation", "prends soin de toi",
                        "prends soin de vous", "à un de ces jours", "à la prochaine fois",
                        "on se revoit bientôt", "j'espère à bientôt", "merci au revoir",
                        "merci bye", "ok bye", "ok ciao", "bon ben au revoir",
                        "bon je pars", "je quitte", "je m'en vais", "je te laisse",
                        "je vous laisse", "je dois te laisser", "je dois vous laisser",
                        "faut que je te laisse", "on se reparle", "on se capte plus tard",
                        "on se voit plus tard", "à plus les amis", "bye la famille",
                        "bonne fin de journée", "bonne soirée à vous", "bonne nuit à tous",
                        "dors bien", "passe une bonne nuit", "passe une bonne journée",
                        "excellente journée", "bonne continuation à toi", "goodbye",
                        "see you later", "see you soon", "take care", "see ya",
                        "laters", "peace out", "peace", "à plus dans l'ascenseur",
                        "je me sauve", "je me trotte", "je me casse de là",
                        "faut que j'aille", "je suis obligé de partir", "je dois partir",
                        "il est temps pour moi de partir", "je vais te laisser",
                        "je vais vous laisser", "on se revoit", "à très bientôt",
                        "à toute", "à plus les amis"
                    ],
                    responses: ["au_revoir"]
                },
                {
                    name: "thanks",
                    patterns: [
                        "merci", "merci beaucoup", "thanks", "thank you", "je te remercie",
                        "je vous remercie", "c'est gentil", "trop gentil", "vraiment gentil",
                        "merci infiniment", "mille mercis", "un grand merci", "merci bien",
                        "merci à toi", "merci à vous", "merci du fond du coeur",
                        "merci pour tout", "merci pour ton aide", "merci pour votre aide",
                        "merci pour les infos", "merci pour la commande", "merci d'avance",
                        "merci par avance", "merci merci", "thank you so much",
                        "thanks a lot", "much appreciated", "merci beaucoup pour tout",
                        "je te dis merci", "je vous dis merci", "merci bien à toi",
                        "merci bien à vous", "merci les amis", "merci la team",
                        "merci du conseil", "merci pour l'info", "merci pour ta réponse",
                        "merci pour votre réponse", "merci d'être là", "merci de m'aider",
                        "c'est vraiment sympa", "c'est trop gentil de ta part",
                        "c'est gentil de votre part", "t'es un amour", "t'es trop mignon",
                        "t'es adorable", "tu assures", "vous assurez", "bravo et merci",
                        "super merci", "parfait merci", "nickel merci", "top merci",
                        "génial merci", "cool merci", "ok merci", "merci ok",
                        "merci d'avoir répondu", "merci de ta disponibilité",
                        "merci de votre disponibilité", "je t'en suis reconnaissant",
                        "je vous en suis reconnaissant", "je te suis redevable",
                        "je vous suis redevable", "je n'oublierai pas", "c'est noté merci",
                        "j'ai tout compris merci", "merci pour la livraison",
                        "merci pour les médicaments", "merci pour le service",
                        "merci pour la rapidité", "merci pour ton professionnalisme",
                        "merci pour votre professionnalisme", "merci à toute l'équipe",
                        "merci à vous tous", "grâce à vous", "grâce à toi",
                        "je vous remercie infiniment", "toutes mes reconnaissances"
                    ],
                    responses: ["remerciement"]
                },
                {
                    name: "emergency",
                    patterns: [
                        "urgence", "185", "samu", "secours", "au secours", "à l'aide",
                        "aide moi", "aidez moi", "besoin d'aide", "besoin de secours",
                        "appelle le 185", "appelez le 185", "appelle le samu", "appelez le samu",
                        "accident", "il y a un accident", "accident de voiture", "accident de moto",
                        "vomi", "vomissement", "il vomit", "elle vomit", "vomissements répétés",
                        "blessé", "blessés", "il est blessé", "elle est blessée",
                        "ils sont blessés", "gravement blessé", "saigne", "ça saigne",
                        "il saigne beaucoup", "elle saigne", "hémorragie", "perte de sang",
                        "évanoui", "il s'est évanoui", "elle s'est évanouie", "perte de connaissance",
                        "inconscient", "inconsciente", "crise", "crise cardiaque",
                        "crise d'épilepsie", "crise de convulsions", "convulsions", "ambulance",
                        "besoin d'une ambulance", "envoyez une ambulance", "appelle une ambulance",
                        "appelez une ambulance", "urgence médicale", "malaise",
                        "il fait un malaise", "elle fait un malaise", "mal au coeur",
                        "douleur à la poitrine", "douleur thoracique", "difficulté à respirer",
                        "étouffe", "il étouffe", "elle étouffe", "arrêt cardiaque",
                        "coeur qui s'arrête", "pas de pouls", "il ne respire plus",
                        "elle ne respire plus", "il est par terre", "elle est par terre",
                        "il est tombé", "elle est tombée", "chute", "grave chute",
                        "traumatisme", "fracture", "os cassé", "jambe cassée", "bras cassé",
                        "brûlure", "brûlé", "brûlée", "brûlures graves", "intoxication",
                        "empoisonnement", "il a avalé quelque chose", "elle a avalé quelque chose",
                        "surdose", "overdose", "overdose de médicaments", "trop de médicaments",
                        "réaction allergique", "allergie grave", "choc anaphylactique",
                        "piqûre d'insecte", "morsure de serpent", "serpent",
                        "il s'est fait mordre", "elle s'est fait mordre", "crise d'asthme",
                        "asthme grave", "il fait une crise", "elle fait une crise",
                        "urgent", "c'est urgent", "très urgent", "vite",
                        "dépêche toi", "dépêchez vous", "c'est grave", "très grave",
                        "il faut venir vite", "venez vite", "accourez", "au feu",
                        "incendie", "il y a le feu", "maison en feu", "noyade",
                        "quelqu'un se noie", "il se noie", "elle se noie", "électrocution",
                        "il s'est électrocuté", "elle s'est électrocutée", "accident de travail",
                        "accident domestique", "accident de la route", "accident vasculaire cérébral",
                        "avc", "infarctus", "crise cardiaque", "arrêt respiratoire",
                        "détresse respiratoire", "étouffement", "fausse route"
                    ],
                    responses: ["urgence"]
                },
                {
                    name: "help",
                    patterns: [
                        "aide", "aidez moi", "j'ai besoin d'aide", "je ne comprends pas",
                        "comment faire", "comment ça marche", "comment commander",
                        "comment passer commande", "comment ça fonctionne", "explique moi",
                        "expliquez moi", "je suis perdu", "je ne sais pas comment faire",
                        "tu peux m'aider", "vous pouvez m'aider", "besoin d'assistance",
                        "besoin de guidance", "tutoriel", "guide", "mode d'emploi",
                        "notice", "manuel", "instructions", "comment utiliser",
                        "comment acheter", "comment se faire livrer", "comment ça se passe",
                        "quelles sont les étapes", "par où commencer", "je débute",
                        "je suis nouveau", "première fois", "c'est la première fois",
                        "je ne connais pas", "je ne sais pas", "je n'y comprends rien",
                        "c'est compliqué", "c'est difficile", "tu peux expliquer",
                        "vous pouvez expliquer", "éclaire moi", "éclairez moi",
                        "guide moi", "guidez moi", "aide moi à comprendre",
                        "aidez moi à comprendre", "je veux apprendre", "j'aimerais comprendre",
                        "fonctionnement", "procédure", "processus", "étapes à suivre",
                        "qu'est-ce qu'il faut faire", "quoi faire", "comment procéder",
                        "quelle est la marche à suivre", "démarche", "je galère",
                        "je suis dans le flou", "c'est flou", "pas clair",
                        "besoin d'éclaircissements", "besoin de précisions", "peux tu m'éclairer",
                        "pouvez vous m'éclairer", "je ne capte pas", "j'ai pas compris",
                        "j'ai rien compris", "explique en détail", "explique simplement",
                        "c'est quoi ce site", "c'est quoi cette app", "à quoi ça sert",
                        "quel est le but", "objectif", "mission", "comment tu fonctionnes",
                        "comment vous fonctionnez", "que peux tu faire", "que pouvez vous faire",
                        "quels sont tes services", "quels sont vos services",
                        "liste des commandes", "liste des options", "aide s'il te plaît",
                        "aide svp", "help me", "i need help", "help please",
                        "what can you do", "how does it work", "how to order",
                        "j'ai besoin d'explications", "je suis paumé", "je suis largué"
                    ],
                    responses: ["aide"]
                },
                {
                    name: "ask_delivery_info",
                    patterns: [
                        "où livrez vous", "vous livrez où", "quels quartiers livrez vous",
                        "livrez vous à", "est ce que vous livrez à", "vous livrez à san pedro",
                        "vous livrez à abidjan", "vous livrez à yopougon", "vous livrez à cocody",
                        "vous livrez à marcory", "vous livrez à treichville", "vous livrez à plateau",
                        "vous livrez à adjamé", "vous livrez à koumassi", "vous livrez à port bouët",
                        "vous livrez à grand bassam", "livraison possible où", "zones de livraison",
                        "secteurs de livraison", "dans quelles villes", "dans quels quartiers",
                        "livrez vous partout", "livrez vous dans toute la ville",
                        "est ce que la livraison est disponible", "livraison disponible à",
                        "puis je me faire livrer à", "je peux commander depuis", "je suis à san pedro",
                        "je suis à cocody", "je suis à yopougon", "j'habite à marcory",
                        "j'habite à treichville", "mon quartier c'est adjamé",
                        "je suis dans le quartier koumassi", "domicile à port bouët",
                        "résident à grand bassam", "je me trouve à", "je vis à",
                        "je demeure à", "je réside à", "mon lieu d'habitation",
                        "adresse de livraison", "où puis je recevoir ma commande",
                        "est ce que vous livrez chez moi", "livrez vous à domicile",
                        "livraison à domicile", "livraison possible", "conditions de livraison",
                        "frais de livraison par quartier", "tarif livraison selon quartier",
                        "combien coûte la livraison à", "prix livraison pour", "livraison gratuite",
                        "y a t il livraison gratuite", "est ce que la livraison est payante",
                        "combien pour la livraison", "frais de port", "zone de couverture",
                        "couverture géographique", "dans quelle zone livrez vous",
                        "limites de livraison", "jusqu'où livrez vous",
                        "livrez vous dans les villages autour", "livrez vous à san pedro centre",
                        "livrez vous à saguitta", "livrez vous à grand bereby", "livrez vous à tabou",
                        "est ce que vous livrez dans ma zone", "je suis en zone rurale",
                        "je suis en campagne", "vous livrez en campagne",
                        "livraison possible en brousse", "est ce que vous venez jusqu'ici",
                        "vous déplacez vous", "pouvez vous me livrer", "puis je commander",
                        "commande possible depuis", "je veux savoir si vous livrez chez moi",
                        "vous livrez à san-pédro", "vous livrez à san pedro centre"
                    ],
                    responses: ["infos_livraison"]
                },
                {
                    name: "search_medicine",
                    patterns: [
                        "je cherche {medicine}", "tu as {medicine}", "vous avez {medicine}",
                        "est ce que vous avez {medicine}", "avez vous {medicine}",
                        "disponibilité {medicine}", "{medicine} disponible",
                        "est ce que {medicine} est disponible", "vous vendez {medicine}",
                        "tu vends {medicine}", "je veux {medicine}", "je voudrais {medicine}",
                        "j'aimerais {medicine}", "donne moi {medicine}", "montre moi {medicine}",
                        "je cherche du doliprane", "tu as du doliprane", "vous avez du doliprane",
                        "doliprane disponible", "est ce que le doliprane est disponible",
                        "je cherche de l'amoxicilline", "tu as de l'amoxicilline",
                        "vous avez de l'amoxicilline", "amoxicilline disponible",
                        "je cherche de l'acfran", "acfran disponible", "vous avez acfran",
                        "je cherche de l'aspirine", "aspirine disponible", "vous avez aspirine",
                        "je cherche du paracétamol", "paracétamol disponible", "vous avez paracétamol",
                        "je cherche de l'ibuprofène", "ibuprofène disponible", "vous avez ibuprofène",
                        "je cherche du dafalgan", "dafalgan disponible", "vous avez dafalgan",
                        "je cherche de l'efferalgan", "efferalgan disponible", "vous avez efferalgan",
                        "je cherche du nurofen", "nurofen disponible", "vous avez nurofen",
                        "je cherche du spasfon", "spasfon disponible", "vous avez spasfon",
                        "je cherche du dexamethasone", "dexamethasone disponible", "vous avez dexamethasone",
                        "je cherche de la betadine", "betadine disponible", "vous avez betadine",
                        "je cherche de la biseptine", "biseptine disponible", "vous avez biseptine",
                        "je cherche de l'alcool", "alcool disponible", "vous avez de l'alcool",
                        "je cherche des compresses", "compresses disponibles", "vous avez des compresses",
                        "je cherche des sparadraps", "sparadraps disponibles", "vous avez des sparadraps",
                        "je cherche des seringues", "seringues disponibles", "vous avez des seringues",
                        "je cherche des gants", "gants disponibles", "vous avez des gants",
                        "je cherche des masques", "masques disponibles", "vous avez des masques",
                        "je cherche un thermomètre", "thermomètre disponible", "vous avez un thermomètre",
                        "je cherche un tensiomètre", "tensiomètre disponible", "vous avez un tensiomètre",
                        "je cherche un médicament pour le mal de tête", "médicament pour migraine",
                        "quel médicament pour le mal de tête", "quel médicament pour la fièvre",
                        "quel médicament pour la douleur", "quel médicament pour le rhume",
                        "quel médicament pour la toux", "quel médicament pour le mal de gorge",
                        "quel médicament pour les maux de ventre", "quel médicament pour la diarrhée",
                        "quel médicament pour la constipation", "quel médicament pour les allergies",
                        "quel médicament pour l'hypertension", "quel médicament pour le diabète",
                        "contre le paludisme", "médicament contre le palu", "traitement palu",
                        "antipaludique", "contre le covid", "traitement covid", "médicaments disponibles",
                        "liste des médicaments", "catalogue médicaments", "ce que vous avez",
                        "tous les médicaments", "qu'est ce que vous avez en stock", "votre stock",
                        "vos produits", "vos médicaments", "que vendez vous", "que proposez vous",
                        "gamme de produits", "produits disponibles", "je veux voir ce que vous avez",
                        "vous avez des médicaments contre la fièvre", "quel traitement pour le palu"
                    ],
                    responses: ["recherche"]
                },
                {
                    name: "ask_price",
                    patterns: [
                        "prix de {medicine}", "combien coûte {medicine}", "c'est combien {medicine}",
                        "tarif {medicine}", "prix", "combien", "quel est le prix de {medicine}",
                        "donne moi le prix de {medicine}", "je veux connaître le prix de {medicine}",
                        "prix du doliprane", "combien coûte le doliprane", "c'est combien le doliprane",
                        "tarif doliprane", "prix de l'amoxicilline", "combien coûte l'amoxicilline",
                        "c'est combien l'amoxicilline", "tarif amoxicilline", "prix de l'acfran",
                        "combien coûte l'acfran", "c'est combien l'acfran", "tarif acfran",
                        "prix du paracétamol", "combien coûte le paracétamol", "c'est combien le paracétamol",
                        "prix de l'ibuprofène", "combien coûte l'ibuprofène", "c'est combien l'ibuprofène",
                        "prix du dafalgan", "combien coûte le dafalgan", "c'est combien le dafalgan",
                        "prix de l'efferalgan", "combien coûte l'efferalgan", "c'est combien l'efferalgan",
                        "prix du nurofen", "combien coûte le nurofen", "c'est combien le nurofen",
                        "prix du spasfon", "combien coûte le spasfon", "c'est combien le spasfon",
                        "prix de la betadine", "combien coûte la betadine", "c'est combien la betadine",
                        "prix de la biseptine", "combien coûte la biseptine", "c'est combien la biseptine",
                        "combien pour le doliprane", "combien pour l'amoxicilline", "combien pour acfran",
                        "à quel prix", "quel prix", "combien ça coûte", "c'est cher",
                        "c'est combien en tout", "prix total", "combien je vais payer", "coût total",
                        "facture", "addition", "montant à payer", "estimation prix", "devis",
                        "je veux un devis", "combien pour ma commande", "tarifs", "grille tarifaire",
                        "liste des prix", "prix catalogue", "combien coûte la boîte", "prix à l'unité",
                        "prix par boîte", "combien la boîte de doliprane", "prix du doliprane 1000",
                        "prix du doliprane 500", "combien le doliprane en sirop", "prix acfran sirop",
                        "combien l'acfran comprimé", "tarif selon dosage", "est ce que c'est abordable",
                        "est ce que c'est pas trop cher", "y a t il moins cher", "promotion",
                        "réduction", "prix en promotion", "c'est en solde",
                        "quel est le tarif du doliprane", "combien pour une boîte de doliprane"
                    ],
                    responses: ["prix"]
                },
                {
                    name: "order_medicine",
                    patterns: [
                        "je veux {quantity} {medicine}", "je voudrais {quantity} {medicine}",
                        "j'aimerais {quantity} {medicine}", "commande {quantity} {medicine}",
                        "je commande {quantity} {medicine}", "prends {quantity} {medicine}",
                        "je prends {quantity} {medicine}", "achète {quantity} {medicine}",
                        "j'achète {quantity} {medicine}", "donne moi {quantity} {medicine}",
                        "passe moi {quantity} {medicine}", "je veux 2 doliprane",
                        "je voudrais 2 doliprane", "j'aimerais 2 doliprane",
                        "commande 2 doliprane", "prends 2 doliprane", "je prends 2 doliprane",
                        "achète 2 doliprane", "donne moi 2 doliprane", "je veux 3 amoxicilline",
                        "je voudrais 3 amoxicilline", "commande 3 amoxicilline",
                        "prends 3 amoxicilline", "je prends 3 amoxicilline", "achète 3 amoxicilline",
                        "je veux 1 boîte de doliprane", "je veux 2 boîtes de doliprane",
                        "je voudrais 1 boîte d'amoxicilline", "je voudrais 2 boîtes d'amoxicilline",
                        "j'aimerais 1 boîte d'acfran", "j'aimerais 2 boîtes d'acfran",
                        "commande 1 boîte de paracétamol", "commande 2 boîtes de paracétamol",
                        "prends 1 boîte d'ibuprofène", "prends 2 boîtes d'ibuprofène",
                        "je prends 1 flacon de sirop", "je prends 2 flacons de sirop",
                        "achète 1 tube de crème", "achète 2 tubes de crème",
                        "donne moi 1 boîte de dafalgan", "donne moi 2 boîtes de dafalgan",
                        "je veux 3 doliprane 1000", "je veux 2 acfran sirop",
                        "je veux 1 amoxicilline 500", "je commande 1 doliprane et 1 amoxicilline",
                        "je veux 2 doliprane et 1 amoxicilline", "prends moi 2 doliprane et 1 amoxicilline",
                        "achète moi 2 doliprane et 1 amoxicilline", "je prends 2 doliprane et 1 amoxicilline",
                        "commande groupée", "plusieurs médicaments", "une liste de médicaments",
                        "je veux plusieurs choses", "je veux faire une commande",
                        "je souhaite commander", "j'aimerais passer commande", "je veux passer commande",
                        "commande s'il vous plaît", "je commande aujourd'hui", "commande maintenant",
                        "commande immédiate", "je prends ça", "c'est bon pour moi",
                        "je valide ma commande", "je confirme ma commande", "ma commande est prête",
                        "je suis prêt à commander", "je veux acheter", "je souhaite acheter",
                        "je veux me procurer", "je cherche à acheter", "acquisition de médicaments",
                        "achat de médicaments", "procéder à un achat", "effectuer un achat",
                        "réaliser un achat", "je prends 2 doliprane et 2 amoxicilline et 1 acfran"
                    ],
                    responses: ["commande"]
                },
                {
                    name: "add_to_cart",
                    patterns: [
                        "ajoute {quantity} {medicine}", "ajoute {medicine}", "ajoute au panier {medicine}",
                        "mets dans le panier {medicine}", "mets {quantity} {medicine} dans le panier",
                        "rajoute {medicine}", "rajoute {quantity} {medicine}", "ajoute encore {medicine}",
                        "ajoute encore {quantity} {medicine}", "supplément {medicine}",
                        "ajoute 1 doliprane", "ajoute 2 doliprane", "ajoute doliprane",
                        "ajoute au panier doliprane", "mets dans le panier doliprane",
                        "mets 2 doliprane dans le panier", "rajoute doliprane", "rajoute 2 doliprane",
                        "ajoute encore doliprane", "ajoute encore 2 doliprane", "ajoute 1 amoxicilline",
                        "ajoute 2 amoxicilline", "ajoute amoxicilline", "ajoute au panier amoxicilline",
                        "mets dans le panier amoxicilline", "mets 2 amoxicilline dans le panier",
                        "rajoute amoxicilline", "rajoute 2 amoxicilline", "ajoute 1 acfran",
                        "ajoute 2 acfran", "ajoute acfran", "ajoute au panier acfran",
                        "mets dans le panier acfran", "mets 2 acfran dans le panier", "rajoute acfran",
                        "rajoute 2 acfran", "ajoute 1 paracétamol", "ajoute 2 paracétamol",
                        "ajoute ibuprofène", "ajoute 1 ibuprofène", "ajoute au panier ibuprofène",
                        "mets ibuprofène dans le panier", "rajoute ibuprofène", "ajoute dafalgan",
                        "ajoute 1 dafalgan", "ajoute au panier dafalgan", "mets dafalgan dans le panier",
                        "rajoute dafalgan", "ajoute efferalgan", "ajoute 1 efferalgan", "ajoute nurofen",
                        "ajoute 1 nurofen", "ajoute spasfon", "ajoute 1 spasfon", "ajoute betadine",
                        "ajoute 1 betadine", "ajoute biseptine", "ajoute 1 biseptine", "ajoute un autre",
                        "ajoute le même", "ajoute le deuxième", "ajoute aussi", "ajoute en plus",
                        "en plus de ça", "je veux aussi", "je voudrais aussi", "j'aimerais aussi",
                        "je prends aussi", "je rajoute", "je veux ajouter", "je souhaite ajouter",
                        "j'aimerais ajouter", "j'ajoute", "supplémentaire", "en supplément",
                        "en plus", "et aussi", "ainsi que", "avec ça", "accompagné de",
                        "ajout panier", "mettre au panier", "intégrer au panier",
                        "insérer dans le panier", "placer dans le panier", "glisser dans le panier",
                        "ajoute encore 2 boîtes de doliprane"
                    ],
                    responses: ["ajout_panier"]
                },
                {
                    name: "view_cart",
                    patterns: [
                        "mon panier", "voir mon panier", "afficher mon panier", "montre moi mon panier",
                        "que j'ai dans mon panier", "contenu du panier", "articles dans mon panier",
                        "liste de mes articles", "mes achats", "ma sélection", "mes produits",
                        "mes médicaments choisis", "ce que j'ai pris", "ce que j'ai commandé",
                        "récapitulatif de ma commande", "récap de ma commande", "résumé de ma commande",
                        "voir ce que j'ai", "afficher panier", "ouvrir panier", "consulter panier",
                        "vérifier panier", "panier actuel", "état du panier", "détail du panier",
                        "contenu", "mon caddie", "mon chariot", "ma liste", "mes articles",
                        "je veux voir mon panier", "j'aimerais voir mon panier",
                        "je souhaite consulter mon panier", "affiche moi mon panier", "montre panier",
                        "panier s'il te plaît", "panier svp", "je regarde mon panier",
                        "je vérifie mon panier", "je contrôle mon panier", "je fais le point",
                        "bilan de ma commande", "ce que j'ai pour l'instant", "ma commande en cours",
                        "commande en préparation", "articles sélectionnés", "produits choisis",
                        "médicaments dans mon panier", "liste des médicaments choisis",
                        "je veux voir avant de confirmer", "vérification avant achat", "dernier regard",
                        "je récapitule", "je résume", "donne moi le contenu", "dis moi ce que j'ai pris",
                        "rappelle moi ma commande", "mémo de commande", "affiche le contenu du panier"
                    ],
                    responses: ["voir_panier"]
                },
                {
                    name: "clear_cart",
                    patterns: [
                        "vide mon panier", "vider le panier", "supprime tout", "supprime tous les articles",
                        "enlève tout", "retire tout", "efface tout", "panier vide",
                        "rends le panier vide", "réinitialise le panier", "remets à zéro", "raz",
                        "tout supprimer", "tout enlever", "tout retirer", "tout effacer",
                        "annule tout", "supprime la commande", "annule la commande", "oublie tout",
                        "recommence à zéro", "nouveau panier", "panier neuf", "vider",
                        "clear cart", "empty cart", "remove all", "delete all", "tout virer",
                        "tout jeter", "tout balayer", "supprime tous mes articles",
                        "enlève tous mes médicaments", "retire tous les produits", "efface la sélection",
                        "supprime la sélection", "annule ma sélection", "je ne veux plus rien",
                        "finalement rien", "je change d'avis", "je veux tout annuler",
                        "je veux recommencer", "je repars de zéro", "je veux un nouveau panier",
                        "je veux refaire ma commande", "je me suis trompé", "j'ai fait une erreur",
                        "c'est pas ça", "faux", "erreur", "pas bon", "mauvais choix",
                        "je veux tout changer", "je veux modifier complètement", "changement total",
                        "reset", "restart", "from scratch", "start over", "begin again",
                        "supprime tout du panier"
                    ],
                    responses: ["panier_vide"]
                },
                {
                    name: "remove_from_cart",
                    patterns: [
                        "enlève {medicine}", "supprime {medicine}", "retire {medicine}",
                        "enlève le {medicine}", "supprime le {medicine}", "retire le {medicine}",
                        "enlève l'article {index}", "supprime l'article {index}",
                        "retire l'article {index}", "enlève le numéro {index}",
                        "supprime le numéro {index}", "retire le numéro {index}",
                        "enlève le premier", "enlève le deuxième", "enlève le troisième",
                        "supprime le premier", "supprime le deuxième", "supprime le troisième",
                        "retire le premier", "retire le deuxième", "retire le troisième",
                        "enlève doliprane", "supprime doliprane", "retire doliprane",
                        "enlève le doliprane", "supprime le doliprane", "retire le doliprane",
                        "enlève amoxicilline", "supprime amoxicilline", "retire amoxicilline",
                        "enlève acfran", "supprime acfran", "retire acfran",
                        "enlève paracétamol", "supprime paracétamol", "retire paracétamol",
                        "enlève ibuprofène", "supprime ibuprofène", "retire ibuprofène",
                        "enlève dafalgan", "supprime dafalgan", "retire dafalgan",
                        "enlève efferalgan", "supprime efferalgan", "retire efferalgan",
                        "enlève nurofen", "supprime nurofen", "retire nurofen",
                        "enlève spasfon", "supprime spasfon", "retire spasfon",
                        "enlève betadine", "supprime betadine", "retire betadine",
                        "enlève biseptine", "supprime biseptine", "retire biseptine",
                        "enlever", "supprimer", "retirer", "ôte", "ôter",
                        "enlève moi ça", "supprime moi ça", "retire moi ça", "je ne veux plus de ça",
                        "pas celui là", "pas celui ci", "je veux enlever", "je souhaite retirer",
                        "j'aimerais supprimer", "à enlever", "à retirer", "à supprimer",
                        "supprime l'élément", "enlève l'élément", "retire cet article",
                        "enlève cet article", "supprime cet article", "ce produit je ne le veux plus",
                        "ce médicament je ne le veux plus", "finalement sans celui ci",
                        "finalement sans ça", "enlève le 1", "supprime le 2", "retire le 3",
                        "enlève 1", "supprime 2", "retire 3", "pas le premier",
                        "pas le deuxième", "pas le troisième", "sans le premier",
                        "sans le deuxième", "sans le troisième", "retire le premier article"
                    ],
                    responses: ["retrait_panier"]
                },
                {
                    name: "select_option",
                    patterns: [
                        "{index}", "le {index}", "numéro {index}", "choisis {index}", "prends {index}",
                        "le premier", "le deuxième", "le troisième", "le 1er", "le 2ème", "le 3ème",
                        "le 1", "le 2", "le 3", "premier", "deuxième", "troisième", "1er",
                        "2ème", "3ème", "1", "2", "3", "4", "5", "le 4", "le 5",
                        "numéro 1", "numéro 2", "numéro 3", "numéro 4", "numéro 5",
                        "choisis le premier", "choisis le deuxième", "choisis le troisième",
                        "choisis le 1", "choisis le 2", "choisis le 3", "prends le premier",
                        "prends le deuxième", "prends le troisième", "je prends le premier",
                        "je prends le deuxième", "je prends le troisième", "je choisis le premier",
                        "je choisis le deuxième", "je choisis le troisième", "je veux le premier",
                        "je veux le deuxième", "je veux le troisième", "je voudrais le premier",
                        "je voudrais le deuxième", "je voudrais le troisième", "j'aimerais le premier",
                        "j'aimerais le deuxième", "j'aimerais le troisième", "c'est le premier",
                        "c'est le deuxième", "c'est le troisième", "celui ci", "celui là",
                        "ça", "c'est ça", "c'est celui ci", "c'est celui là", "option 1",
                        "option 2", "option 3", "première option", "deuxième option",
                        "troisième option", "choix 1", "choix 2", "choix 3", "le choix 1",
                        "le choix 2", "le choix 3", "sélection 1", "sélection 2", "sélection 3",
                        "article 1", "article 2", "article 3", "produit 1", "produit 2",
                        "produit 3", "médicament 1", "médicament 2", "médicament 3",
                        "le médicament 1", "le médicament 2", "le médicament 3", "en premier",
                        "en deuxième", "en troisième", "le premier de la liste",
                        "le deuxième de la liste", "le troisième de la liste", "je prends la 1"
                    ],
                    responses: ["selection"]
                },
                {
                    name: "provide_quartier",
                    patterns: [
                        "je suis à {quartier}", "j'habite à {quartier}", "mon quartier c'est {quartier}",
                        "c'est {quartier}", "je me trouve à {quartier}", "je réside à {quartier}",
                        "je demeure à {quartier}", "mon lieu d'habitation est {quartier}",
                        "mon adresse c'est {quartier}", "quartier {quartier}", "je suis à san pedro",
                        "j'habite à san pedro", "mon quartier c'est san pedro", "c'est san pedro",
                        "je suis à cocody", "j'habite à cocody", "mon quartier c'est cocody",
                        "c'est cocody", "je suis à yopougon", "j'habite à yopougon",
                        "mon quartier c'est yopougon", "c'est yopougon", "je suis à marcory",
                        "j'habite à marcory", "mon quartier c'est marcory", "c'est marcory",
                        "je suis à treichville", "j'habite à treichville", "mon quartier c'est treichville",
                        "c'est treichville", "je suis à adjamé", "j'habite à adjamé",
                        "mon quartier c'est adjamé", "c'est adjamé", "je suis à koumassi",
                        "j'habite à koumassi", "mon quartier c'est koumassi", "c'est koumassi",
                        "je suis à port bouët", "j'habite à port bouët", "mon quartier c'est port bouët",
                        "c'est port bouët", "je suis à grand bassam", "j'habite à grand bassam",
                        "mon quartier c'est grand bassam", "c'est grand bassam", "je suis à saguitta",
                        "j'habite à saguitta", "mon quartier c'est saguitta", "c'est saguitta",
                        "je suis à grand bereby", "j'habite à grand bereby", "mon quartier c'est grand bereby",
                        "c'est grand bereby", "je suis à tabou", "j'habite à tabou",
                        "mon quartier c'est tabou", "c'est tabou", "je viens de", "je suis originaire de",
                        "je vis dans le quartier", "je réside dans le quartier", "dans le quartier",
                        "au quartier", "du quartier", "adresse de livraison", "lieu de livraison",
                        "endroit où je veux être livré", "livrez moi à", "je veux être livré à",
                        "j'aimerais être livré à", "je souhaite la livraison à", "à livrer à",
                        "adresse", "mon adresse", "voici mon adresse", "c'est là où j'habite",
                        "c'est mon quartier", "je te donne mon quartier", "je vous donne mon quartier",
                        "quartier de livraison", "zone de livraison", "je suis à yopougon sagbé"
                    ],
                    responses: ["quartier_enregistre"]
                },
                {
                    name: "provide_ville",
                    patterns: [
                        "je suis à {ville}", "j'habite à {ville}", "ma ville c'est {ville}",
                        "c'est {ville}", "je me trouve à {ville}", "je réside à {ville}",
                        "je demeure à {ville}", "ma ville est {ville}", "ville {ville}",
                        "je suis à san pedro", "j'habite à san pedro", "ma ville c'est san pedro",
                        "c'est san pedro", "je suis à abidjan", "j'habite à abidjan",
                        "ma ville c'est abidjan", "c'est abidjan", "je suis à bouaké",
                        "j'habite à bouaké", "ma ville c'est bouaké", "c'est bouaké",
                        "je suis à yamoussoukro", "j'habite à yamoussoukro", "ma ville c'est yamoussoukro",
                        "c'est yamoussoukro", "je suis à daloa", "j'habite à daloa",
                        "ma ville c'est daloa", "c'est daloa", "je suis à korhogo",
                        "j'habite à korhogo", "ma ville c'est korhogo", "c'est korhogo",
                        "je suis à man", "j'habite à man", "ma ville c'est man", "c'est man",
                        "je suis à gagnoa", "j'habite à gagnoa", "ma ville c'est gagnoa",
                        "c'est gagnoa", "je suis à san-pédro", "j'habite à san-pédro",
                        "ma ville c'est san-pédro", "c'est san-pédro", "je viens de la ville de",
                        "je suis originaire de", "je vis dans la ville de", "je réside dans la ville de",
                        "dans la ville de", "à la ville de", "de la ville de", "en ville",
                        "hors de la ville", "en dehors de la ville", "je suis en ville",
                        "je suis à la campagne", "je suis en brousse", "je suis dans un village",
                        "mon village", "localité", "commune", "département", "région",
                        "district", "je te donne ma ville", "je vous donne ma ville", "voici ma ville",
                        "c'est ma ville", "lieu de livraison", "ville de livraison",
                        "j'habite à san pedro ville"
                    ],
                    responses: ["ville_enregistree"]
                },
                {
                    name: "provide_name",
                    patterns: [
                        "je m'appelle {name}", "mon nom c'est {name}", "mon nom est {name}",
                        "c'est {name}", "je suis {name}", "moi c'est {name}", "appelle moi {name}",
                        "prénom {name}", "nom {name}", "je m'appelle jean", "je m'appelle marie",
                        "je m'appelle jean kouassi", "je m'appelle marie claire", "je m'appelle koffi",
                        "je m'appelle amoin", "je m'appelle konan", "je m'appelle affoué",
                        "mon nom c'est jean", "mon nom c'est marie", "mon nom c'est jean kouassi",
                        "mon nom c'est marie claire", "c'est jean", "c'est marie",
                        "c'est jean kouassi", "c'est marie claire", "je suis jean",
                        "je suis marie", "je suis jean kouassi", "je suis marie claire",
                        "moi c'est jean", "moi c'est marie", "moi c'est jean kouassi",
                        "moi c'est marie claire", "appelle moi jean", "appelle moi marie",
                        "appelle moi jean kouassi", "appelle moi marie claire", "prénom jean",
                        "prénom marie", "nom kouassi", "nom konan", "jean kouassi",
                        "marie claire", "koffi konan", "amoin akissi", "konan kouadio",
                        "affoué kouamé", "yapo", "n'guessan", "brou", "kra", "ahou",
                        "esmel", "arsène", "youssef", "mohamed", "fatou", "amina",
                        "rachida", "jean-paul", "jean-marc", "marie-louise", "marie-paule",
                        "mon identité", "ma pièce d'identité", "mon nom complet", "nom et prénom",
                        "mes noms", "mes prénoms", "voici mon nom", "je te donne mon nom",
                        "je vous donne mon nom", "c'est mon nom", "mon petit nom", "mon surnom",
                        "mon blaze", "comment je m'appelle", "comment me nommer", "comment m'appeler",
                        "moi c'est konan kouadio"
                    ],
                    responses: ["nom_enregistre"]
                },
                {
                    name: "provide_age",
                    patterns: [
                        "j'ai {age} ans", "mon âge c'est {age}", "mon âge est {age}",
                        "âge {age}", "{age} ans", "j'ai 25 ans", "j'ai 30 ans",
                        "j'ai 40 ans", "j'ai 50 ans", "j'ai 18 ans", "j'ai 20 ans",
                        "j'ai 22 ans", "j'ai 35 ans", "j'ai 45 ans", "j'ai 60 ans",
                        "j'ai 65 ans", "j'ai 70 ans", "j'ai 15 ans", "j'ai 10 ans",
                        "j'ai 5 ans", "j'ai 2 ans", "j'ai 1 an", "j'ai 6 mois",
                        "mon âge c'est 25", "mon âge est 30", "âge 40", "25 ans",
                        "30 ans", "40 ans", "50 ans", "18 ans", "20 ans", "22 ans",
                        "35 ans", "45 ans", "60 ans", "65 ans", "70 ans", "15 ans",
                        "10 ans", "5 ans", "2 ans", "1 an", "6 mois", "je suis âgé de",
                        "je suis âgée de", "j'ai l'âge de", "mon année de naissance",
                        "né en", "née en", "date de naissance", "ddn", "ma date de naissance",
                        "je suis né le", "je suis née le", "je suis un adulte",
                        "je suis une adulte", "je suis majeur", "je suis majeure",
                        "je suis mineur", "je suis mineure", "c'est pour un enfant",
                        "c'est pour un bébé", "c'est pour une personne âgée", "c'est pour moi",
                        "c'est pour mon enfant", "c'est pour ma mère", "c'est pour mon père",
                        "c'est pour ma grand-mère", "c'est pour mon grand-père",
                        "j'ai vingt-cinq ans", "j'ai trente ans"
                    ],
                    responses: ["age_enregistre"]
                },
                {
                    name: "provide_gender",
                    patterns: [
                        "je suis un homme", "je suis une femme", "homme", "femme",
                        "masculin", "féminin", "m", "f", "genre masculin", "genre féminin",
                        "sexe masculin", "sexe féminin", "de sexe masculin", "de sexe féminin",
                        "c'est un homme", "c'est une femme", "c'est pour un homme",
                        "c'est pour une femme", "c'est un garçon", "c'est une fille",
                        "garçon", "fille", "mâle", "femelle", "monsieur", "madame",
                        "mademoiselle", "pour monsieur", "pour madame", "pour mademoiselle",
                        "je suis masculin", "je suis féminin", "je suis du genre masculin",
                        "je suis du genre féminin", "je suis de sexe masculin",
                        "je suis de sexe féminin", "c'est masculin", "c'est féminin",
                        "sexe", "genre", "mon genre", "mon sexe", "je te dis mon genre",
                        "je vous dis mon genre", "homme ou femme", "masculin ou féminin",
                        "m ou f", "je suis m", "je suis f", "c'est m", "c'est f",
                        "patient homme", "patient femme", "patiente", "c'est pour un patient",
                        "c'est pour une patiente", "de sexe masculin", "de sexe féminin"
                    ],
                    responses: ["genre_enregistre"]
                },
                {
                    name: "provide_weight",
                    patterns: [
                        "je pèse {weight} kg", "mon poids c'est {weight} kg", "mon poids est {weight} kg",
                        "poids {weight} kg", "{weight} kg", "je pèse 70 kg", "je pèse 75 kg",
                        "je pèse 80 kg", "je pèse 65 kg", "je pèse 60 kg", "je pèse 55 kg",
                        "je pèse 50 kg", "je pèse 45 kg", "je pèse 40 kg", "je pèse 90 kg",
                        "je pèse 100 kg", "je pèse 30 kg", "je pèse 20 kg", "je pèse 10 kg",
                        "je pèse 5 kg", "mon poids c'est 70", "mon poids est 75", "poids 80",
                        "70 kg", "75 kg", "80 kg", "65 kg", "60 kg", "55 kg", "50 kg",
                        "45 kg", "40 kg", "90 kg", "100 kg", "30 kg", "20 kg", "10 kg",
                        "5 kg", "mon poids corporel", "ma masse", "je fais", "je fais 70 kilos",
                        "je fais 75 kilos", "je pèse environ", "à peu près", "environ",
                        "poids approximatif", "poids exact", "dernier poids", "poids actuel",
                        "je suis lourd", "je suis léger", "je suis mince", "je suis gros",
                        "je suis corpulent", "je suis costaud", "je suis maigre",
                        "je suis filiforme", "c'est pour un adulte", "c'est pour un enfant",
                        "c'est pour un bébé", "poids du patient", "poids de la patiente",
                        "poids du malade", "je fais 80 kilos"
                    ],
                    responses: ["poids_enregistre"]
                },
                {
                    name: "provide_height",
                    patterns: [
                        "je mesure {height} cm", "ma taille c'est {height} cm", "ma taille est {height} cm",
                        "taille {height} cm", "{height} cm", "je mesure 170 cm", "je mesure 175 cm",
                        "je mesure 180 cm", "je mesure 165 cm", "je mesure 160 cm", "je mesure 155 cm",
                        "je mesure 150 cm", "je mesure 185 cm", "je mesure 190 cm", "je mesure 140 cm",
                        "je mesure 130 cm", "je mesure 120 cm", "je mesure 110 cm", "je mesure 100 cm",
                        "je mesure 90 cm", "je mesure 80 cm", "je mesure 70 cm", "ma taille c'est 170",
                        "ma taille est 175", "taille 180", "170 cm", "175 cm", "180 cm", "165 cm",
                        "160 cm", "155 cm", "150 cm", "185 cm", "190 cm", "140 cm", "130 cm",
                        "120 cm", "110 cm", "100 cm", "90 cm", "80 cm", "70 cm", "ma stature",
                        "ma hauteur", "je fais", "je fais 1m70", "je fais 1m75", "je fais 1m80",
                        "1 mètre 70", "1 mètre 75", "1 mètre 80", "1,70 m", "1,75 m", "1,80 m",
                        "je suis grand", "je suis petit", "je suis de taille moyenne",
                        "je suis élancé", "je suis trapu", "je suis de grande taille",
                        "je suis de petite taille", "taille du patient", "taille de la patiente",
                        "taille du malade", "je mesure un mètre soixante-dix"
                    ],
                    responses: ["taille_enregistree"]
                },
                {
                    name: "provide_phone",
                    patterns: [
                        "mon téléphone c'est {phone}", "mon numéro c'est {phone}", "appelle moi au {phone}",
                        "joignable au {phone}", "c'est le {phone}", "voici mon numéro {phone}",
                        "{phone}", "07 58 01 97 27", "07 58 01 97 27", "07.58.01.97.27",
                        "07-58-01-97-27", "0758019727", "07 58 01 97 27", "01 02 03 04 05",
                        "01.02.03.04.05", "01-02-03-04-05", "0102030405", "05 04 03 02 01",
                        "05.04.03.02.01", "05-04-03-02-01", "0504030201", "07 00 00 00 00",
                        "07 11 22 33 44", "07 55 66 77 88", "07 99 88 77 66",
                        "+225 07 58 01 97 27", "+2250758019727", "00225 07 58 01 97 27",
                        "002250758019727", "225 07 58 01 97 27", "2250758019727",
                        "mon téléphone portable", "mon portable", "mon mobile", "mon fixe",
                        "mon numéro de téléphone", "mon numéro de portable", "mon numéro de mobile",
                        "mon numéro de téléphone portable", "mon contact", "mes coordonnées",
                        "mon whatsapp", "mon numéro whatsapp", "joignable sur whatsapp",
                        "appelle moi", "contacte moi", "tu peux me joindre au",
                        "vous pouvez me joindre au", "me joindre sur", "c'est par ce numéro",
                        "voici mon contact", "voici comment me joindre", "numéro de téléphone",
                        "numéro pour la livraison", "téléphone de livraison", "contact de livraison",
                        "téléphone du client", "téléphone du patient", "c'est le 07 58 01 97 27"
                    ],
                    responses: ["telephone_enregistre"]
                },
                {
                    name: "provide_indications",
                    patterns: [
                        "les indications {indications}", "c'est {indications}", "au {indications}",
                        "derrière {indications}", "à côté de {indications}", "en face de {indications}",
                        "près de {indications}", "non", "pas d'indications", "rien",
                        "aucune indication", "sans indications", "c'est au 3ème étage",
                        "au 3ème étage", "troisième étage", "sonnette rouge", "porte rouge",
                        "portail rouge", "grille rouge", "sonnette bleue", "porte bleue",
                        "portail bleu", "grille bleue", "entrée B", "porte gauche", "porte droite",
                        "bâtiment C", "immeuble A", "appartement 12", "appartement 25",
                        "numéro 15", "numéro 27", "code 1234", "digicode 1234", "code d'entrée 1234",
                        "près du marché", "derrière le marché", "à côté du marché", "en face du marché",
                        "près de l'école", "derrière l'école", "à côté de l'école", "en face de l'école",
                        "près de l'église", "derrière l'église", "à côté de l'église", "en face de l'église",
                        "près de la mosquée", "derrière la mosquée", "à côté de la mosquée", "en face de la mosquée",
                        "près de la pharmacie", "derrière la pharmacie", "à côté de la pharmacie", "en face de la pharmacie",
                        "près de la banque", "derrière la banque", "à côté de la banque", "en face de la banque",
                        "immeuble bleu", "maison jaune", "villa blanche", "bâtiment gris",
                        "au rond-point", "au carrefour", "au feu", "au stop", "au terrain",
                        "au stade", "à la plage", "au bord de la mer", "au bord de la lagune",
                        "après le pont", "avant le pont", "sur la route principale", "sur la rue principale",
                        "dans la rue secondaire", "dans l'impasse", "au bout de la rue", "au fond de la rue",
                        "c'est indiqué", "suivre les panneaux", "suivre les indications",
                        "des instructions", "des précisions", "des détails", "des explications",
                        "comment trouver", "comment accéder", "comment arriver", "comment me trouver",
                        "comment nous trouver", "point de repère", "repère", "proche de",
                        "à proximité de", "non loin de", "pas d'indications particulières",
                        "rien de spécial", "aucune info supplémentaire", "sans instructions",
                        "c'est à côté du marché"
                    ],
                    responses: ["indications_enregistrees"]
                },
                {
                    name: "confirm_order",
                    patterns: [
                        "je confirme", "je confirme la commande", "je confirme ma commande",
                        "oui je confirme", "je valide", "je valide la commande", "je valide ma commande",
                        "c'est bon", "c'est bon pour moi", "c'est parfait", "c'est ok",
                        "ok", "d'accord", "oui", "yes", "yep", "okay",
                        "ok d'accord", "ok c'est bon", "oui c'est bon", "oui ça me va",
                        "ça me va", "c'est comme ça", "c'est ce que je veux", "c'est ce que j'ai choisi",
                        "parfait", "super", "génial", "top", "nickel", "impeccable",
                        "très bien", "parfaitement", "exactement", "voilà", "c'est tout bon",
                        "tout est bon", "tout est correct", "rien à changer", "tout va bien",
                        "c'est bon pour la commande", "commande validée", "commande confirmée",
                        "je passe commande", "je commande maintenant", "je veux commander maintenant",
                        "lance la commande", "envoie la commande", "procède à la commande",
                        "valide et envoie", "confirme et envoie", "je suis prêt",
                        "je suis prêt à commander", "on y va", "c'est parti", "allez-y",
                        "vas-y", "fais-le", "fais la commande", "ok pour la commande",
                        "accord pour la commande", "j'accepte", "j'accepte la commande",
                        "j'approuve", "j'approuve la commande", "j'acquiesce", "je dis oui",
                        "mon accord", "donne mon accord", "feu vert", "go", "let's go",
                        "yes go", "ok go", "c'est validé", "c'est confirmé", "je valide tout"
                    ],
                    responses: ["commande_confirmee"]
                },
                {
                    name: "modify_order",
                    patterns: [
                        "je veux modifier", "je veux modifier ma commande", "je voudrais modifier",
                        "je voudrais modifier ma commande", "j'aimerais modifier",
                        "j'aimerais modifier ma commande", "modifier la commande", "modifier ma commande",
                        "changer", "je veux changer", "je veux changer quelque chose",
                        "je voudrais changer", "j'aimerais changer", "changer ma commande",
                        "changer la commande", "changer quelque chose", "apporter des modifications",
                        "faire des modifications", "modifications", "ajuster", "ajuster ma commande",
                        "réajuster", "réajuster ma commande", "corriger", "corriger ma commande",
                        "rectifier", "rectifier ma commande", "revoir", "revoir ma commande",
                        "réviser", "réviser ma commande", "mettre à jour", "mettre à jour ma commande",
                        "updater", "update commande", "je me suis trompé", "j'ai fait une erreur",
                        "ce n'est pas ça", "c'est pas ce que je voulais", "j'ai mal choisi",
                        "je me suis mal exprimé", "je voulais dire autre chose", "en fait",
                        "finalement", "en réalité", "à vrai dire", "pour être précis",
                        "plus exactement", "plus précisément", "je rectifie", "je corrige",
                        "je modifie", "je change", "changement", "modification", "correction",
                        "rectification", "ajustement", "réajustement", "revoir la copie",
                        "revoir ma sélection", "changer d'avis", "j'ai changé d'avis",
                        "je change d'avis", "finalement je veux", "en fait je veux",
                        "en définitive", "tout compte fait", "après réflexion", "réflexion faite",
                        "bien réfléchi", "mûre réflexion", "je veux modifier ma commande"
                    ],
                    responses: ["modification"]
                },
                {
                    name: "cancel_order",
                    patterns: [
                        "annule", "annule la commande", "annule ma commande", "j'annule",
                        "j'annule la commande", "j'annule ma commande", "non merci",
                        "non pas maintenant", "pas maintenant", "plus tard", "laisse tomber",
                        "laissez tomber", "oublie", "oubliez", "oublie ça", "oubliez ça",
                        "laisse ça", "laissez ça", "abandonne", "abandonnez", "j'abandonne",
                        "je laisse tomber", "finalement non", "en fait non", "non finalement",
                        "non en fait", "finalement je ne veux pas", "je ne veux finalement pas",
                        "je ne veux plus", "je ne veux pas commander", "je ne veux pas finaliser",
                        "je ne commande pas", "pas de commande", "annulation", "commande annulée",
                        "j'ai changé d'avis", "changement d'avis", "finalement j'ai changé d'avis",
                        "je change d'avis", "retour en arrière", "step back", "go back",
                        "back", "cancel", "cancellation", "abort", "abandon", "stop",
                        "arrête", "arrêtez", "stop là", "arrête là", "ne continue pas",
                        "ne continuez pas", "ne pas poursuivre", "ne pas finaliser",
                        "ne pas valider", "revenir en arrière", "retour", "revenir",
                        "annuler tout", "tout annuler", "rien finalement", "rien du tout",
                        "ce sera pour une autre fois", "une prochaine fois", "plus tard peut-être",
                        "pas pour l'instant", "pas maintenant merci", "annule tout"
                    ],
                    responses: ["annulation"]
                },
                {
                    name: "order_status",
                    patterns: [
                        "où est ma commande", "où en est ma commande", "suivi de commande",
                        "suivi commande", "état de ma commande", "statut de ma commande",
                        "ma commande est où", "ma commande est-elle partie", "ma commande est-elle en route",
                        "quand ma commande arrive", "quand arrive ma commande", "livraison de ma commande",
                        "suivi livraison", "où est mon colis", "où en est mon colis", "suivi colis",
                        "état colis", "colis", "commande {order_id}", "où est ma commande CMD1234",
                        "suivi commande CMD1234", "état commande CMD1234", "CMD1234",
                        "commande 1234", "code {code}", "code 584721", "code de confirmation 584721",
                        "584721", "je veux suivre ma commande", "je souhaite suivre ma commande",
                        "j'aimerais suivre ma commande", "je veux savoir où est ma commande",
                        "je veux savoir l'état de ma commande", "donne moi le statut de ma commande",
                        "dis moi où est ma commande", "des nouvelles de ma commande",
                        "nouvelles de ma commande", "avancement de ma commande", "progression de ma commande",
                        "temps restant", "délai restant", "estimation livraison", "heure de livraison",
                        "quand vais-je être livré", "à quelle heure arrive le livreur",
                        "le livreur est où", "où est le livreur", "livreur", "tracking",
                        "track commande", "track order", "order status", "delivery status",
                        "check order", "status", "vérifier commande", "vérification commande",
                        "contrôle commande", "je vérifie ma commande", "je contrôle ma commande",
                        "je suis ma commande", "je track ma commande", "suivi de ma commande"
                    ],
                    responses: ["statut_commande"]
                },
                {
                    name: "ask_patient_info",
                    patterns: [
                        "quelles informations vous faut-il", "quelles infos vous faut-il",
                        "de quoi avez-vous besoin", "qu'est-ce que vous avez besoin",
                        "qu'est-ce que vous voulez savoir", "quelles informations dois-je donner",
                        "quels renseignements dois-je fournir", "que devez-vous savoir",
                        "que voulez-vous savoir", "dites moi ce qu'il faut",
                        "dites moi ce que vous voulez", "informations nécessaires",
                        "renseignements nécessaires", "infos nécessaires", "informations requises",
                        "renseignements requis", "infos requises", "qu'est-ce qu'il faut fournir",
                        "quoi fournir", "quoi donner", "quoi communiquer", "quoi envoyer",
                        "données patient", "infos patient", "informations patient",
                        "données du patient", "infos du patient", "informations du patient",
                        "fiche patient", "profil patient", "dossier patient",
                        "pourquoi toutes ces questions", "pourquoi tant de questions",
                        "pourquoi demandez-vous tout ça", "à quoi servent ces informations",
                        "utilité de ces informations", "est-ce obligatoire",
                        "faut-il vraiment donner tout ça", "je dois donner quoi exactement",
                        "précisez ce qu'il faut", "détaillez s'il vous plaît",
                        "éclaircissez moi", "expliquez moi ce que vous voulez",
                        "qu'attendez-vous de moi", "que dois-je vous dire",
                        "que dois-je communiquer", "que dois-je renseigner",
                        "les champs à remplir", "les rubriques à renseigner",
                        "le formulaire à remplir", "les questions à répondre",
                        "quelles infos vous voulez"
                    ],
                    responses: ["infos_patient_demandees"]
                },
                {
                    name: "unknown",
                    patterns: [
                        "blabla", "test", "essai", "123", "1234", "abc", "azerty",
                        "qwerty", "lorem ipsum", "test test", "ceci est un test", "essai 123",
                        "rien", "bon", "ben", "bah", "euh", "hein", "quoi",
                        "comment", "pourquoi", "quand", "où", "qui", "que",
                        "lequel", "auquel", "duquel", "dont", "auprès", "concernant",
                        "à propos", "vis-à-vis", "relativement", "par rapport", "quant à",
                        "en ce qui concerne", "pour ce qui est de", "s'agissant de",
                        "question de", "côté", "niveau", "au niveau de", "du côté de",
                        "du point de vue", "sous l'angle", "dans l'optique", "dans la perspective",
                        "dans le cadre", "dans le contexte", "dans le domaine", "dans le secteur",
                        "dans le milieu", "dans la sphère", "dans la branche", "dans la filière",
                        "dans la discipline", "dans la matière", "dans le registre", "dans le champ",
                        "dans le rayon", "dans le coin", "dans le secteur", "dans la zone",
                        "dans la région", "dans le pays", "dans le monde", "dans l'univers",
                        "dans la galaxie", "dans l'espace", "dans le temps", "dans l'histoire",
                        "dans la vie", "dans la réalité", "dans la pratique", "dans la théorie",
                        "dans l'absolu", "dans le relatif", "dans le concret", "dans l'abstrait",
                        "dans le réel", "dans l'imaginaire", "dans le virtuel", "dans le numérique",
                        "dans le digital", "dans le technologique", "dans le scientifique",
                        "dans le médical", "dans le paramédical", "dans le pharmaceutique",
                        "dans le médicamenteux", "dans le thérapeutique", "dans le curatif",
                        "dans le préventif", "dans le palliatif", "dans le symptomatique",
                        "dans le causal", "dans le génétique", "dans le héréditaire",
                        "dans le congénital", "dans l'acquis", "dans l'inné", "dans le chronique",
                        "dans l'aigu", "dans le bénin", "dans le malin", "dans le grave",
                        "dans le léger", "dans le modéré", "dans le sévère", "je ne sais pas",
                        "j'ai rien à dire", "je sais pas", "j'comprends pas"
                    ],
                    responses: ["inconnu"]
                },
                {
  "name": "ask_bot_creation",
  "patterns": [
    // Qui a créé le bot
    "qui t'a créé",
    "qui t'a créé ?",
    "qui t'a développé",
    "qui t'a programmé",
    "qui t'a fait",
    "qui est ton créateur",
    "qui est ton développeur",
    "qui est ton concepteur",
    "c'est qui ton créateur",
    "c'est qui ton développeur",
    "ton créateur c'est qui",
    "ton développeur c'est qui",
    
    // Quand a été créé le bot
    "quand as-tu été créé",
    "quand as-tu été développé",
    "quand as-tu été lancé",
    "quelle est ta date de création",
    "ta date de création",
    "ton année de création",
    "depuis quand existes-tu",
    "tu existes depuis quand",
    "tu es là depuis quand",
    "date de naissance",
    "ta date de naissance",
    
    // Pourquoi a été créé le bot
    "pourquoi as-tu été créé",
    "pourquoi tu as été créé",
    "pourquoi existes-tu",
    "quel est ton but",
    "quel est ton objectif",
    "quelle est ta mission",
    "pourquoi tu es là",
    "à quoi tu sers",
    "quelle est ta raison d'être",
    "dans quel but as-tu été créé",
    "objectif de ta création",
    
    // Comment a été créé le bot
    "comment as-tu été créé",
    "comment tu as été fait",
    "comment tu as été développé",
    "comment tu as été programmé",
    "avec quoi tu as été créé",
    "avec quel langage tu as été créé",
    "quel langage de programmation",
    "quelle technologie utilises-tu",
    "comment tu fonctionnes",
    "comment ça marche dans les coulisses",
    "c'est quoi ton architecture",
    "comment tu as été construit",
    
    // Technologies utilisées
    "quelle technologie utilises-tu",
    "quelles technologies utilises-tu",
    "avec quoi es-tu programmé",
    "c'est quoi ton framework",
    "quel framework utilises-tu",
    "node js",
    "node.js",
    "javascript",
    "typescript",
    "quel langage",
    "en quoi es-tu écrit",
    "dans quel langage es-tu codé",
    "bibliothèques utilisées",
    "librairies utilisées",
    "dépendances",
    "npm packages",
    "modules utilisés",
    
    // Version du bot
    "quelle est ta version",
    "ta version",
    "version",
    "numéro de version",
    "v1",
    "v2",
    "version actuelle",
    "dernière version",
    
    // Histoire du bot
    "raconte-moi ton histoire",
    "ton histoire",
    "comment tout a commencé",
    "comment es-tu né",
    "la genèse de ta création",
    "l'histoire de ta création",
    "parle-moi de ta création",
    
    // Informations générales
    "parle-moi de toi",
    "qui es-tu",
    "tu peux te présenter",
    "présente-toi",
    "dis-moi qui tu es",
    "c'est quoi ton nom",
    "tu t'appelles comment",
    "comment tu t'appelles",
    "quel est ton nom",
    "ton identité",
    
    // Équipe de développement
    "qui est derrière ce projet",
    "quelle équipe t'a développé",
    "l'équipe de développement",
    "les développeurs",
    "les créateurs",
    "c'est une entreprise",
    "c'est une startup",
    "c'est un projet personnel",
    
    // Open source / propriétaire
    "es-tu open source",
    "tu es open source",
    "code source disponible",
    "peut-on voir ton code",
    "ton code est public",
    "code accessible",
    "github",
    "dépôt github",
    "repository",
    "lien github",
    
    // Collaborateurs
    "combien de personnes t'ont créé",
    "vous êtes combien à avoir développé",
    "taille de l'équipe",
    "combien de développeurs",
    "combien de créateurs",
    
    // Inspiration
    "quelle est l'inspiration derrière toi",
    "pourquoi ce projet",
    "qu'est-ce qui a motivé ta création",
    "origine du projet",
    "idée de départ",
    
    // Futur du bot
    "quel est ton avenir",
    "évolutions prévues",
    "nouvelles fonctionnalités",
    "roadmap",
    "feuille de route",
    "projets futurs",
    "mises à jour prévues",
    
    // Contact créateur
    "comment contacter ton créateur",
    "joindre ton développeur",
    "contacter l'équipe",
    "adresse email du créateur",
    "contact du développeur",
    "support",
    "comment vous joindre",
    "comment vous contacter",
    
    // Localisation / pays
    "d'où venez-vous",
    "vous êtes d'où",
    "pays d'origine",
    "créé en côte d'ivoire",
    "made in côte d'ivoire",
    "fabriqué en côte d'ivoire",
    "développé en côte d'ivoire",
    "origine ivoirienne",
    
    // Spécificités techniques
    "combien de lignes de code",
    "taille du code",
    "nombre de fichiers",
    "complexité du projet",
    "temps de développement",
    "combien de temps pour te créer",
    "durée de développement",
    "mois de travail",
    "années de développement",
    
    // Intelligence artificielle
    "utilises-tu de l'ia",
    "intelligence artificielle",
    "machine learning",
    "deep learning",
    "modèle nlp",
    "entraînement",
    "comment as-tu été entraîné",
    "données d'entraînement",
    
    // Phrases complètes et naturelles
    "j'aimerais savoir qui t'a créé",
    "je veux connaître ton créateur",
    "tu peux me dire qui t'a développé",
    "dis-moi qui est ton concepteur",
    "explique-moi comment tu as été fait",
    "raconte-moi comment tu es né",
    "je suis curieux de connaître ton histoire",
    "parle-moi un peu de toi",
    "je voudrais en savoir plus sur ta création",
    "tu as été créé par qui exactement",
    "c'est une entreprise ou un particulier",
    "dans quel pays as-tu été développé",
    "tu es un projet professionnel ou personnel",
    "quelles sont les technologies derrière toi",
    "tu fonctionnes avec quel moteur",
    "c'est quoi ton architecture technique",
    "tu tournes sur quel serveur",
    "tu es hébergé où",
    "quel est ton environnement d'exécution",
    "tu utilises quelle base de données",
    "comment gères-tu les conversations",
    "quel est ton framework NLP",
    "node-nlp",
    "tu utilises node-nlp",
    "c'est quoi node-nlp",
    
    // Questions sur l'auteur
    "l'auteur s'appelle comment",
    "nom du créateur",
    "prénom du développeur",
    "c'est un homme ou une femme",
    "le créateur est ivoirien",
    "développeur ivoirien",
    
    // Réseaux sociaux / portfolio
    "le créateur a un site web",
    "portfolio du développeur",
    "linkedin du créateur",
    "twitter du développeur",
    "github du créateur",
    "réseaux sociaux",
    
    // Intention derrière le bot
    "pourquoi ce bot a été créé",
    "quel problème résout-il",
    "quelle est son utilité",
    "à qui s'adresse-t-il",
    "public cible",
    "utilisateurs visés",
    
    // Questions sur le nom
    "pourquoi ce nom",
    "origine du nom",
    "signification du nom",
    "pourquoi t'appelles-tu comme ça",
    "comment as-tu été nommé",
    
    // Formulations polies
    "est-ce que je peux savoir qui t'a créé",
    "puis-je connaître ton créateur",
    "tu peux me donner des infos sur ta création",
    "ça t'embête de me parler de tes origines",
    "j'aimerais en apprendre plus sur toi",
    
    // Curiosité générale
    "tu as été créé quand",
    "c'est récent",
    "c'est un vieux projet",
    "depuis combien de temps tu existes",
    "tu es tout jeune",
    
    // Technologies spécifiques
    "javascript ou typescript",
    "framework backend",
    "express.js",
    "nodejs version",
    "npm ou yarn",
    "gestionnaire de paquets",
    "api utilisées",
    "webhooks",
    "whatsapp api",
    "api de messagerie",
    
    // Maintenance
    "qui te maintient",
    "qui s'occupe de tes mises à jour",
    "fréquence des mises à jour",
    "dernière mise à jour",
    "maintenance",
    
    // Licence
    "sous quelle licence",
    "licence du projet",
    "droits d'utilisation",
    "peut-on te réutiliser",
    "conditions d'utilisation",
    
    // Variantes avec fautes courantes
    "qui ta créé",
    "qui ta developpé",
    "comment ta été créé",
    "ta version",
    "kel language tu utilise",
    "c koi ton langage",
    "qui est ton createur",
    "ton createur",
    "ta date de creassion",
    "comment tu fonctionne",
    "avec koi ta été programmé"
  ],
  "entities": [],
  "responses": ["bot_creation_info"]
}
            ]
        };
    }

    async addDocuments() {
        console.log('📚 Ajout des documents d\'entraînement...');
        
        const intentsData = this.intentsData;
        
        for (const intent of intentsData.intents) {
            for (const pattern of intent.patterns) {
                // Vérifier si le pattern contient des entités
                if (pattern.includes('{medicine}')) {
                    // Ajouter avec différentes variantes de médicaments pour l'entité medicine
                    const medicines = ['doliprane', 'amoxicilline', 'acfran', 'aspirine', 'paracétamol', 'ibuprofène', 'dafalgan', 'efferalgan', 'nurofen', 'spasfon', 'betadine', 'biseptine'];
                    for (const med of medicines) {
                        const variant = pattern.replace('{medicine}', med);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{quantity}') && pattern.includes('{medicine}')) {
                    // Patterns avec quantité et médicament
                    const quantities = ['1', '2', '3', '4', '5', 'un', 'deux', 'trois', 'une'];
                    const medicines = ['doliprane', 'amoxicilline', 'acfran'];
                    for (const qty of quantities) {
                        for (const med of medicines) {
                            let variant = pattern.replace('{quantity}', qty).replace('{medicine}', med);
                            this.manager.addDocument('fr', variant, intent.name);
                        }
                    }
                } else if (pattern.includes('{medicine}')) {
                    // Patterns avec seulement médicament
                    const medicines = ['doliprane', 'amoxicilline', 'acfran', 'aspirine', 'paracétamol'];
                    for (const med of medicines) {
                        const variant = pattern.replace('{medicine}', med);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{index}')) {
                    // Patterns avec index
                    const indices = ['1', '2', '3', 'premier', 'deuxième', 'troisième', '1er', '2ème', '3ème'];
                    for (const idx of indices) {
                        const variant = pattern.replace('{index}', idx);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{quartier}')) {
                    // Patterns avec quartier
                    const quartiers = ['san pedro', 'cocody', 'yopougon', 'marcory', 'treichville', 'adjamé', 'koumassi', 'port bouët', 'grand bassam'];
                    for (const q of quartiers) {
                        const variant = pattern.replace('{quartier}', q);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{ville}')) {
                    // Patterns avec ville
                    const villes = ['san pedro', 'abidjan', 'bouaké', 'yamoussoukro', 'daloa', 'korhogo', 'man', 'gagnoa'];
                    for (const v of villes) {
                        const variant = pattern.replace('{ville}', v);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{name}')) {
                    // Patterns avec nom
                    const noms = ['jean', 'marie', 'koffi', 'amoin', 'konan', 'affoué', 'yapo', 'n\'guessan'];
                    for (const n of noms) {
                        const variant = pattern.replace('{name}', n);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{age}')) {
                    // Patterns avec âge
                    const ages = ['25', '30', '40', '18', '20', '35', '45', '60'];
                    for (const a of ages) {
                        const variant = pattern.replace('{age}', a);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{gender}')) {
                    // Patterns avec genre
                    const genres = ['homme', 'femme', 'masculin', 'féminin', 'm', 'f'];
                    for (const g of genres) {
                        const variant = pattern.replace('{gender}', g);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{weight}')) {
                    // Patterns avec poids
                    const poids = ['70', '75', '80', '65', '60', '55', '50', '90'];
                    for (const w of poids) {
                        const variant = pattern.replace('{weight}', w);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{height}')) {
                    // Patterns avec taille
                    const tailles = ['170', '175', '180', '165', '160', '155', '185', '190'];
                    for (const h of tailles) {
                        const variant = pattern.replace('{height}', h);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{phone}')) {
                    // Patterns avec téléphone
                    const phones = ['07 58 01 97 27', '07 58 01 97 27', '+225 07 58 01 97 27', '0758019727'];
                    for (const p of phones) {
                        const variant = pattern.replace('{phone}', p);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{indications}')) {
                    // Patterns avec indications
                    const indications = ['3ème étage', 'porte rouge', 'près du marché', 'derrière l\'école', 'code 1234'];
                    for (const ind of indications) {
                        const variant = pattern.replace('{indications}', ind);
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else if (pattern.includes('{order_id}') || pattern.includes('{code}')) {
                    // Patterns avec ID commande ou code
                    const codes = ['CMD1234', '584721', '1234', 'ABC123'];
                    for (const c of codes) {
                        let variant = pattern;
                        if (pattern.includes('{order_id}')) {
                            variant = pattern.replace('{order_id}', c);
                        } else if (pattern.includes('{code}')) {
                            variant = pattern.replace('{code}', c);
                        }
                        this.manager.addDocument('fr', variant, intent.name);
                    }
                } else {
                    // Pattern sans entité
                    this.manager.addDocument('fr', pattern, intent.name);
                    
                    // Ajouter des variations avec répétitions de mots (pour simuler les fautes)
                    if (pattern.includes('2') || pattern.includes('deux')) {
                        // Créer des variations avec "2 deux" comme demandé
                        const words = pattern.split(' ');
                        for (let i = 0; i < words.length; i++) {
                            if (words[i].includes('2') || words[i].includes('deux')) {
                                const variantWithRepeat = [...words];
                                variantWithRepeat[i] = '2 deux';
                                this.manager.addDocument('fr', variantWithRepeat.join(' '), intent.name);
                            }
                        }
                    }
                }
            }
            
            console.log(`  ✓ ${intent.name}: ${intent.patterns.length} patterns de base ajoutés (avec variations)`);
        }
        
        console.log('✅ Ajout des documents terminé !');
    }

    async train() {
        console.log('🚀 Début de l\'entraînement du modèle NLP...');
        console.log('⏳ Cela peut prendre quelques minutes...');
        
        await this.addDocuments();
        
        console.log('🏋️ Entraînement en cours...');
        await this.manager.train();
        
        console.log('💾 Sauvegarde du modèle...');
        this.manager.save(this.modelFile);
        
        console.log('✅ Entraînement terminé avec succès !');
        console.log(`📁 Modèle sauvegardé dans: ${this.modelFile}`);
    }

    async evaluate() {
        console.log('🔍 Évaluation du modèle sur quelques exemples...');
        
        const testPhrases = [
            "bonjour",
            "salut mariam",
            "merci beaucoup",
            "au revoir",
            "je cherche du doliprane",
            "combien coûte l'amoxicilline",
            "je veux 2 doliprane",
            "ajoute 1 acfran",
            "mon panier",
            "je suis à yopougon",
            "je m'appelle konan",
            "j'ai 30 ans",
            "je confirme ma commande",
            "urgence",
            "aide moi",
            "où livrez vous",
            "je prends 2 doliprane et 2 amoxicilline",
            "ajoute encore 2 doliprane",
            "enlève le premier",
            "07 58 01 97 27",
            "c'est au 3ème étage"
            ,"qui ta creer "
        ];
        
        console.log('\n📊 Résultats des tests:');
        console.log('='.repeat(80));
        
        for (const phrase of testPhrases) {
            const result = await this.manager.process('fr', phrase);
            console.log(`Phrase: "${phrase}"`);
            console.log(`  Intent: ${result.intent} (score: ${result.score?.toFixed(4) || 'N/A'})`);
            if (result.entities && result.entities.length > 0) {
                console.log(`  Entités: ${JSON.stringify(result.entities)}`);
            }
            console.log('-'.repeat(40));
        }
    }

    async loadAndUse() {
        if (fs.existsSync(this.modelFile)) {
            console.log('📂 Chargement du modèle existant...');
            this.manager.load(this.modelFile);
            return true;
        }
        return false;
    }

    async process(phrase) {
        return await this.manager.process('fr', phrase);
    }
}

// Fonction principale pour l'entraînement
async function main() {
    const trainer = new NLPTrainer();
    
    try {
        const args = process.argv.slice(2);
        
        if (args.includes('--eval')) {
            // Mode évaluation uniquement
            if (await trainer.loadAndUse()) {
                await trainer.evaluate();
            } else {
                console.log('❌ Modèle non trouvé. Lancez d\'abord l\'entraînement.');
            }
        } else if (args.includes('--train')) {
            // Mode entraînement uniquement
            await trainer.train();
        } else {
            // Mode par défaut: entraînement + évaluation
            await trainer.train();
            await trainer.evaluate();
        }
    } catch (error) {
        console.error('❌ Erreur lors de l\'entraînement:', error);
        process.exit(1);
    }
}

// Export pour utilisation dans d'autres modules
module.exports = { NLPTrainer };

// Lancement si exécuté directement
if (require.main === module) {
    main();
}