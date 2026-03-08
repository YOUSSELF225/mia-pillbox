// ============================================
// test-nlp-complet.js - Test complet du modèle NLP
// Version 2.0 - Test de toutes les intentions et entités
// ============================================

const { NlpManager } = require('node-nlp');
const path = require('path');

async function testNLP() {
    console.log('🧪 TEST COMPLET DU MODÈLE NLP - TOUTES INTENTIONS & ENTITÉS\n');
    console.log('=' .repeat(80));

    // Charger le modèle
    const manager = new NlpManager({ languages: ['fr'] });
    manager.load(path.join(__dirname, 'model.nlp'));
    
    console.log('✅ Modèle chargé avec succès\n');

    // Statistiques globales
    let totalTests = 0;
    let excellentCount = 0;
    let bonCount = 0;
    let faibleCount = 0;
    let intentionsRatees = [];

    // ============================================
    // 1. TESTS DES INTENTIONS PRINCIPALES
    // ============================================
    
    const testsIntentions = [
        {
            category: '🔹 1. SALUTATIONS',
            expectedIntent: 'saluer',
            phrases: [
                'bonjour',
                'salut',
                'bonsoir',
                'hello',
                'coucou',
                'ça va ?',
                'bjr',
                'bsr',
                'wesh',
                'cc'
            ]
        },
        {
            category: '🔹 2. REMERCIEMENTS',
            expectedIntent: 'remercier',
            phrases: [
                'merci',
                'merci beaucoup',
                'je te remercie',
                'thanks',
                'merci pour ton aide',
                'thx',
                'merci docteur',
                'c\'est gentil',
                'merci bcp',
                'je vous remercie'
            ]
        },
        {
            category: '🔹 3. AU REVOIR',
            expectedIntent: 'au_revoir',
            phrases: [
                'au revoir',
                'bye',
                'à bientôt',
                'bonne journée',
                'à la prochaine',
                'ciao',
                'a+',
                'bonne soirée',
                'à demain',
                'bye bye'
            ]
        },
        {
            category: '🔹 4. AIDE',
            expectedIntent: 'aide',
            phrases: [
                'aide',
                'help',
                'besoin d\'aide',
                'comment faire',
                'que pouvez-vous faire',
                'aidez-moi',
                'SOS',
                'au secours',
                'comment ça marche',
                'liste des commandes'
            ]
        },
        {
            category: '🔹 5. QUESTION BOT',
            expectedIntent: 'question_bot',
            phrases: [
                'qui es-tu',
                'c\'est quoi MIA',
                'tu es qui',
                'parle-moi de toi',
                'tu es un robot',
                'qui t\'a créé',
                'c\'est un projet étudiant',
                'vous êtes des étudiants',
                'comment tu fonctionnes',
                'à quoi tu sers'
            ]
        },
        {
            category: '🔹 6. RECHERCHE MÉDICAMENTS',
            expectedIntent: 'rechercher_medicament',
            phrases: [
                'je cherche doliprane',
                'avez-vous amoxicilline',
                'est-ce que flagyl est disponible',
                'je veux du spasfon',
                'vous avez ventoline',
                'paracétamol dispo',
                'doliprane disponible',
                'amoxicilline en stock',
                'flagyl en pharmacie',
                'spasfon vous avez'
            ]
        },
        {
            category: '🔹 7. PRIX MÉDICAMENTS',
            expectedIntent: 'prix_medicament',
            phrases: [
                'combien coûte doliprane',
                'prix amoxicilline',
                'c\'est combien le flagyl',
                'augmentin prix',
                'tarif spasfon',
                'ibuprofène c\'est combien',
                'doliprane combien',
                'prix de la ventoline',
                'le flagyl coûte combien',
                'tarif du paracétamol'
            ]
        },
        {
            category: '🔹 8. PHARMACIES DE GARDE',
            expectedIntent: 'pharmacie_garde',
            phrases: [
                'pharmacie de garde',
                'pharmacie de garde à cocody',
                'où trouver une pharmacie à yopougon',
                'pharmacie ouverte maintenant',
                'pharmacie de nuit à marcory',
                'pharmacie 24h/24 plateau',
                'pharmacie garde bouaké',
                'qui garde cette nuit',
                'pharmacie proche de moi',
                'pharmacie de garde ce soir'
            ]
        },
        {
            category: '🔹 9. COMMANDER',
            expectedIntent: 'commander',
            phrases: [
                'je veux commander',
                'comment passer commande',
                'acheter des médicaments',
                'je souhaite commander doliprane',
                'passer commande maintenant',
                'je veux acheter',
                'commander en ligne',
                'faire une commande',
                'prendre doliprane',
                'j\'aimerais commander'
            ]
        },
        {
            category: '🔹 10. MODIFIER COMMANDE',
            expectedIntent: 'modifier_commande',
            phrases: [
                'modifier ma commande',
                'changer ma commande',
                'ajouter doliprane à ma commande',
                'enlever flagyl de ma commande',
                'modifier quantité',
                'changer adresse livraison',
                'ajouter un article',
                'supprimer un produit',
                'je veux changer ma commande',
                'modifier mon panier'
            ]
        },
        {
            category: '🔹 11. ANNULER COMMANDE',
            expectedIntent: 'annuler_commande',
            phrases: [
                'annuler ma commande',
                'je ne veux plus de ma commande',
                'annuler commande CMD123',
                'je veux annuler',
                'supprimer ma commande',
                'annulation commande',
                'stoppez ma commande',
                'je change d\'avis annulez',
                'finalement non',
                'annulez tout'
            ]
        },
        {
            category: '🔹 12. SUIVRE COMMANDE',
            expectedIntent: 'suivre_commande',
            phrases: [
                'suivre ma commande',
                'où en est ma commande',
                'statut de ma commande',
                'suivi livraison',
                'ma commande est où',
                'quand vais-je recevoir',
                'tracking commande',
                'suivi colis',
                'ma commande est-elle partie',
                'état de ma commande'
            ]
        },
        {
            category: '🔹 13. PANIER',
            expectedIntent: 'panier',
            phrases: [
                'mon panier',
                'voir mon panier',
                'contenu de mon panier',
                'afficher panier',
                'total panier',
                'vider mon panier',
                'ajouter au panier',
                'enlever du panier',
                'récapitulatif panier',
                'montre-moi mon panier'
            ]
        },
        {
            category: '🔹 14. QUANTITÉ',
            expectedIntent: 'quantite',
            phrases: [
                '2 doliprane',
                'je veux 3 amoxicilline',
                'combien de boîtes',
                '3 boîtes',
                'une boîte',
                'deux comprimés',
                '5 sachets',
                'la quantité',
                'combien je peux prendre',
                'dose recommandée'
            ]
        },
        {
            category: '🔹 15. CHOIX NUMÉRO',
            expectedIntent: 'choix_numero',
            phrases: [
                'le 1',
                'je prends le 2',
                'numéro 3',
                'le premier',
                'le deuxième',
                'je choisis le 4',
                'option 5',
                'le dernier',
                'premier choix',
                'le numéro 1'
            ]
        },
        {
            category: '🔹 16. INFOS LIVRAISON',
            expectedIntent: 'infos_livraison',
            phrases: [
                'frais de livraison',
                'combien coûte la livraison',
                'délai de livraison',
                'vous livrez à bouaké',
                'livraison gratuite',
                'zones de livraison',
                'livraison à domicile',
                'combien de temps livraison',
                'livraison express',
                'livrez-vous à yopougon'
            ]
        },
        {
            category: '🔹 17. URGENCE',
            expectedIntent: 'urgence',
            phrases: [
                'c\'est une urgence',
                'besoin de médicaments urgent',
                'je suis malade',
                'forte fièvre',
                'douleur intense',
                'appeler les urgences',
                'urgence médicale',
                'c\'est grave',
                'besoin immédiat',
                'je saigne'
            ]
        },
        {
            category: '🔹 18. PRENDRE RDV',
            expectedIntent: 'prendre_rdv',
            phrases: [
                'prendre rendez-vous',
                'je veux voir un médecin',
                'consultation médicale',
                'rendez-vous cardiologue',
                'voir un dentiste',
                'RDV avec Dr Koné',
                'prendre rendez-vous en ligne',
                'consulter un spécialiste',
                'rendez-vous chez le médecin',
                'je veux consulter'
            ]
        },
        {
            category: '🔹 19. ANNULER RDV',
            expectedIntent: 'annuler_rdv',
            phrases: [
                'annuler mon rendez-vous',
                'annuler RDV',
                'je ne peux pas venir',
                'annuler consultation',
                'déprogrammer mon RDV',
                'supprimer rendez-vous',
                'annuler mon RDV chez le dentiste',
                'rendez-vous à annuler',
                'je dois annuler',
                'annuler mon rendez-vous médical'
            ]
        },
        {
            category: '🔹 20. MODIFIER RDV',
            expectedIntent: 'modifier_rdv',
            phrases: [
                'modifier mon rendez-vous',
                'changer la date de mon RDV',
                'reporter rendez-vous',
                'décaler mon RDV',
                'changer l\'heure',
                'reprogrammer mon RDV',
                'changer de médecin',
                'déplacer mon rendez-vous',
                'modifier ma consultation',
                'changer pour un autre jour'
            ]
        },
        {
            category: '🔹 21. DISPONIBILITÉ MÉDECIN',
            expectedIntent: 'disponibilite_medecin',
            phrases: [
                'disponibilité de Dr Koné',
                'Dr Yao quand est-il disponible',
                'cardiologue disponible',
                'y a-t-il un dentiste aujourd\'hui',
                'le médecin est-il là',
                'quand peut-on voir Dr Bamba',
                'créneaux disponibles',
                'le docteur consulte aujourd\'hui',
                'disponibilité spécialiste',
                'le généraliste est présent'
            ]
        },
        {
            category: '🔹 22. CLINIQUE PROCHE',
            expectedIntent: 'clinique_proche',
            phrases: [
                'clinique proche de moi',
                'centre de santé près de chez moi',
                'hôpital à côté',
                'clinique à cocody proche',
                'où trouver une clinique',
                'clinique pas loin',
                'centre médical à proximité',
                'hôpital proche',
                'clinique dans mon quartier',
                'CMA du quartier'
            ]
        },
        {
            category: '🔹 23. SERVICE CLINIQUE',
            expectedIntent: 'service_clinique',
            phrases: [
                'quels sont les services disponibles',
                'services cliniques',
                'prestations médicales',
                'spécialités médicales',
                'avez-vous un service d\'urgence',
                'service de garde',
                'consultations externes',
                'hospitalisation',
                'maternité',
                'laboratoire d\'analyses'
            ]
        },
        {
            category: '🔹 24. TARIF CLINIQUE',
            expectedIntent: 'tarif_clinique',
            phrases: [
                'combien coûte une consultation',
                'prix d\'une consultation',
                'tarif consultation',
                'frais de consultation',
                'combien pour un dentiste',
                'prix échographie',
                'tarif radio',
                'combien scanner',
                'prix accouchement',
                'frais d\'hospitalisation'
            ]
        },
        {
            category: '🔹 25. SPÉCIALITÉ CLINIQUE',
            expectedIntent: 'specialite_clinique',
            phrases: [
                'quelles spécialités avez-vous',
                'spécialistes disponibles',
                'avez-vous un cardiologue',
                'y a-t-il un dermatologue',
                'gynécologue disponible',
                'pédiatre présent',
                'ophtalmologue',
                'ORL',
                'dentiste',
                'chirurgien'
            ]
        },
        {
            category: '🔹 26. AUTRE VILLE',
            expectedIntent: 'autre_ville',
            phrases: [
                'et pour bouaké',
                'qu\'en est-il de korhogo',
                'à san-pedro comment ça se passe',
                'je suis à man',
                'pour daloa',
                'est disponible à gagnoa',
                'je suis basé à odienné',
                'habite à bondoukou',
                'je vis à divo',
                'je suis à l\'intérieur du pays'
            ]
        },
        {
            category: '🔹 27. CONFIRMER',
            expectedIntent: 'confirmer',
            phrases: [
                'oui',
                'd\'accord',
                'ok',
                'je confirme',
                'c\'est bon',
                'je valide',
                'ça marche',
                'parfait',
                'super',
                'yes'
            ]
        },
        {
            category: '🔹 28. REFUSER',
            expectedIntent: 'refuser',
            phrases: [
                'non',
                'non merci',
                'pas maintenant',
                'je refuse',
                'annuler',
                'je ne veux pas',
                'laissez tomber',
                'pas intéressé',
                'finalement non',
                'pas question'
            ]
        },
        {
            category: '🔹 29. AMBIGU (phrases à clarifier)',
            expectedIntent: 'ambigu',
            phrases: [
                'c\'est disponible',
                'vous en avez',
                'je veux savoir',
                'renseignez-moi',
                'j\'ai besoin d\'information',
                'dites-moi',
                'expliquez-moi',
                'comment faire',
                'c\'est comment',
                'est-ce possible'
            ]
        },
        {
            category: '🔹 30. INCONNU (bruit)',
            expectedIntent: 'inconnu',
            phrases: [
                'a',
                'b',
                'c',
                '???',
                '!!!',
                '...',
                '@#$',
                '123',
                'x',
                'zzz'
            ]
        }
    ];

    // ============================================
    // 2. TESTS DES ENTITÉS
    // ============================================
    
    const testsEntites = [
        {
            category: '🔸 ENTITÉ: MÉDICAMENTS',
            tests: [
                { phrase: 'je cherche doliprane 500mg', entities: ['medicament', 'dosage'] },
                { phrase: 'amoxicilline 500mg prix', entities: ['medicament', 'dosage'] },
                { phrase: 'spasfon comprimé 80mg', entities: ['medicament', 'forme_dosage'] },
                { phrase: 'ventoline spray 100µg', entities: ['medicament', 'dosage'] },
                { phrase: 'smecta sachet', entities: ['medicament', 'forme_dosage'] },
                { phrase: 'doliprane sirop enfant', entities: ['medicament', 'medicament_forme'] },
                { phrase: 'augmentin 1g comprimé', entities: ['medicament', 'dosage', 'forme_dosage'] },
                { phrase: 'flagyl 500', entities: ['medicament', 'dosage'] },
                { phrase: 'ibuprofène 400mg', entities: ['medicament', 'dosage'] },
                { phrase: 'paracétamol 1000mg', entities: ['medicament', 'dosage'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: LOCALITÉS',
            tests: [
                { phrase: 'pharmacie de garde à cocody', entities: ['localite'] },
                { phrase: 'livraison à yopougon', entities: ['localite'] },
                { phrase: 'clinique à marcory', entities: ['localite'] },
                { phrase: 'pharmacie ouverte à bouaké', entities: ['localite'] },
                { phrase: 'rdv à korhogo', entities: ['localite'] },
                { phrase: 'médicament à san-pedro', entities: ['localite'] },
                { phrase: 'pharmacie de nuit plateau', entities: ['localite'] },
                { phrase: 'clinique proche de moi', entities: ['localite'] },
                { phrase: 'livrez-vous à abidjan', entities: ['localite'] },
                { phrase: 'pharmacie garde deux plateaux', entities: ['localite'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: DOSAGES',
            tests: [
                { phrase: 'doliprane 500mg', entities: ['dosage'] },
                { phrase: 'amoxicilline 1g', entities: ['dosage'] },
                { phrase: 'spasfon 80mg', entities: ['dosage'] },
                { phrase: 'ventoline 100µg', entities: ['dosage'] },
                { phrase: 'augmentin 500mg/5ml', entities: ['dosage'] },
                { phrase: 'sirop 125mg/5ml', entities: ['dosage'] },
                { phrase: 'crème 1%', entities: ['dosage'] },
                { phrase: 'comprimé 1000mg', entities: ['dosage'] },
                { phrase: 'gélule 250mg', entities: ['dosage'] },
                { phrase: 'solution 2%', entities: ['dosage'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: MÉDECINS',
            tests: [
                { phrase: 'rdv avec Dr Koné', entities: ['medecin'] },
                { phrase: 'consultation Dr Yao', entities: ['medecin'] },
                { phrase: 'disponibilité Dr Bamba', entities: ['medecin'] },
                { phrase: 'voir Dr Kouassi', entities: ['medecin'] },
                { phrase: 'Dr N\'Guessan consulte', entities: ['medecin'] },
                { phrase: 'Professeur Touré', entities: ['medecin'] },
                { phrase: 'cardiologue Dr Koffi', entities: ['specialite', 'medecin'] },
                { phrase: 'le docteur Koné', entities: ['medecin'] },
                { phrase: 'Dr Cissé rendez-vous', entities: ['medecin'] },
                { phrase: 'Pr Yao', entities: ['medecin'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: SPÉCIALITÉS',
            tests: [
                { phrase: 'consulter un cardiologue', entities: ['specialite'] },
                { phrase: 'voir un dentiste', entities: ['specialite'] },
                { phrase: 'rendez-vous gynécologue', entities: ['specialite'] },
                { phrase: 'pédiatre disponible', entities: ['specialite'] },
                { phrase: 'ophtalmologue', entities: ['specialite'] },
                { phrase: 'ORL consultation', entities: ['specialite'] },
                { phrase: 'dermatologue', entities: ['specialite'] },
                { phrase: 'neurologue', entities: ['specialite'] },
                { phrase: 'psychiatre', entities: ['specialite'] },
                { phrase: 'radiologue', entities: ['specialite'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: QUANTITÉS',
            tests: [
                { phrase: '2 boîtes de doliprane', entities: ['quantite'] },
                { phrase: '3 amoxicilline', entities: ['quantite'] },
                { phrase: 'je veux 5 spasfon', entities: ['quantite'] },
                { phrase: 'une boîte', entities: ['quantite'] },
                { phrase: 'deux comprimés', entities: ['quantite'] },
                { phrase: '10 sachets', entities: ['quantite'] },
                { phrase: '1 flacon', entities: ['quantite'] },
                { phrase: 'quelques boîtes', entities: ['quantite'] },
                { phrase: 'plusieurs', entities: ['quantite'] },
                { phrase: 'trois', entities: ['quantite'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: MODES DE PAIEMENT',
            tests: [
                { phrase: 'payer avec orange money', entities: ['mode_paiement'] },
                { phrase: 'wave', entities: ['mode_paiement'] },
                { phrase: 'moov money', entities: ['mode_paiement'] },
                { phrase: 'carte visa', entities: ['mode_paiement'] },
                { phrase: 'espèces à la livraison', entities: ['mode_paiement'] },
                { phrase: 'paiement mobile money', entities: ['mode_paiement'] },
                { phrase: 'mtn money', entities: ['mode_paiement'] },
                { phrase: 'carte mastercard', entities: ['mode_paiement'] },
                { phrase: 'paiement en ligne', entities: ['mode_paiement'] },
                { phrase: 'virement bancaire', entities: ['mode_paiement'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: CLINIQUES',
            tests: [
                { phrase: 'clinique sainte anne', entities: ['clinique'] },
                { phrase: 'CHU de Cocody', entities: ['clinique', 'localite'] },
                { phrase: 'polyclinique farah', entities: ['clinique'] },
                { phrase: 'CMA marcory', entities: ['clinique', 'localite'] },
                { phrase: 'hopital général', entities: ['clinique'] },
                { phrase: 'clinique avicenne', entities: ['clinique'] },
                { phrase: 'CHU Treichville', entities: ['clinique', 'localite'] },
                { phrase: 'clinique les ambassades', entities: ['clinique'] },
                { phrase: 'centre de santé', entities: ['clinique'] },
                { phrase: 'formation sanitaire', entities: ['clinique'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: SYMPTÔMES',
            tests: [
                { phrase: 'j\'ai de la fièvre', entities: ['symptome'] },
                { phrase: 'mal de tête', entities: ['symptome'] },
                { phrase: 'douleur ventre', entities: ['symptome'] },
                { phrase: 'toux sèche', entities: ['symptome'] },
                { phrase: 'nausée', entities: ['symptome'] },
                { phrase: 'vomissement', entities: ['symptome'] },
                { phrase: 'diarrhée', entities: ['symptome'] },
                { phrase: 'fatigue', entities: ['symptome'] },
                { phrase: 'vertige', entities: ['symptome'] },
                { phrase: 'démangeaison', entities: ['symptome'] }
            ]
        },
        {
            category: '🔸 ENTITÉ: DATES ET HEURES',
            tests: [
                { phrase: 'rendez-vous demain', entities: ['date', 'time_expression'] },
                { phrase: 'commander pour lundi', entities: ['date'] },
                { phrase: 'livraison à 14h', entities: ['heure'] },
                { phrase: 'RDV 15 avril', entities: ['date'] },
                { phrase: 'ce soir à 18h', entities: ['time_expression', 'heure'] },
                { phrase: 'aujourd\'hui', entities: ['date'] },
                { phrase: 'la semaine prochaine', entities: ['date', 'time_expression'] },
                { phrase: 'à midi', entities: ['time_expression'] },
                { phrase: 'dans 30 minutes', entities: ['time_expression'] },
                { phrase: 'tout de suite', entities: ['time_expression'] }
            ]
        }
    ];

    // ============================================
    // 3. EXÉCUTION DES TESTS D'INTENTIONS
    // ============================================
    
    console.log('📌 TESTS DES INTENTIONS');
    console.log('=' .repeat(80));

    for (const testGroup of testsIntentions) {
        console.log(`\n${testGroup.category}`);
        console.log('-'.repeat(60));

        for (const phrase of testGroup.phrases) {
            totalTests++;
            const result = await manager.process('fr', phrase);
            
            // Calcul du score
            const score = (result.score * 100).toFixed(2);
            const isCorrectIntent = result.intent === testGroup.expectedIntent;
            
            // Déterminer l'emoji et mettre à jour les stats
            let emoji;
            if (isCorrectIntent && result.score > 0.9) {
                emoji = '✅';
                excellentCount++;
            } else if (isCorrectIntent && result.score > 0.7) {
                emoji = '⚠️';
                bonCount++;
            } else if (isCorrectIntent) {
                emoji = '❌';
                faibleCount++;
            } else {
                emoji = '❌';
                faibleCount++;
                intentionsRatees.push({
                    phrase,
                    attendu: testGroup.expectedIntent,
                    obtenu: result.intent,
                    score: score
                });
            }

            // Affichage
            console.log(`📝 "${phrase}"`);
            console.log(`   ${emoji} Attendu: ${testGroup.expectedIntent}`);
            console.log(`   ${emoji} Obtenu: ${result.intent} (${score}%)`);
            
            // Afficher les entités si présentes
            if (result.entities && result.entities.length > 0) {
                console.log(`   🔍 Entités:`);
                result.entities.forEach(entity => {
                    console.log(`      • ${entity.entity}: ${entity.option || entity.sourceText} (${(entity.accuracy * 100).toFixed(0)}%)`);
                });
            }
            console.log('');
        }
    }

    // ============================================
    // 4. EXÉCUTION DES TESTS D'ENTITÉS
    // ============================================
    
    console.log('\n📌 TESTS DES ENTITÉS');
    console.log('=' .repeat(80));

    for (const testGroup of testsEntites) {
        console.log(`\n${testGroup.category}`);
        console.log('-'.repeat(60));

        for (const test of testGroup.tests) {
            totalTests++;
            const result = await manager.process('fr', test.phrase);
            
            // Vérifier les entités trouvées
            const entitesTrouvees = result.entities ? result.entities.map(e => e.entity) : [];
            const entitesAttendues = test.entities;
            
            // Vérifier si toutes les entités attendues sont présentes
            const toutesPresentes = entitesAttendues.every(e => entitesTrouvees.includes(e));
            
            // Score de précision moyen des entités
            const scoreMoyen = result.entities && result.entities.length > 0
                ? (result.entities.reduce((acc, e) => acc + e.accuracy, 0) / result.entities.length * 100).toFixed(2)
                : 0;
            
            // Déterminer l'emoji
            const emoji = toutesPresentes && scoreMoyen > 80 ? '✅' : '⚠️';
            
            if (toutesPresentes && scoreMoyen > 80) {
                excellentCount++;
            } else if (toutesPresentes || scoreMoyen > 60) {
                bonCount++;
            } else {
                faibleCount++;
            }

            console.log(`📝 "${test.phrase}"`);
            console.log(`   ${emoji} Entités attendues: ${entitesAttendues.join(', ')}`);
            console.log(`   ${emoji} Entités trouvées: ${entitesTrouvees.length ? entitesTrouvees.join(', ') : 'aucune'}`);
            console.log(`   ${emoji} Score moyen: ${scoreMoyen}%`);
            
            // Détail des entités
            if (result.entities && result.entities.length > 0) {
                result.entities.forEach(entity => {
                    console.log(`      • ${entity.entity}: "${entity.option || entity.sourceText}" (${(entity.accuracy * 100).toFixed(0)}%)`);
                });
            }
            console.log('');
        }
    }

    // ============================================
    // 5. RÉSUMÉ FINAL
    // ============================================
    
    console.log('=' .repeat(80));
    console.log('📊 RÉSUMÉ GLOBAL DES TESTS');
    console.log('=' .repeat(80));
    
    console.log(`📝 Total des tests: ${totalTests}`);
    console.log(`✅ Excellent (>90%): ${excellentCount} tests (${((excellentCount/totalTests)*100).toFixed(1)}%)`);
    console.log(`⚠️ Bon (70-90%): ${bonCount} tests (${((bonCount/totalTests)*100).toFixed(1)}%)`);
    console.log(`❌ À améliorer (<70%): ${faibleCount} tests (${((faibleCount/totalTests)*100).toFixed(1)}%)`);
    
    // Afficher les intentions ratées
    if (intentionsRatees.length > 0) {
        console.log('\n📋 INTENTIONS À RENFORCER:');
        console.log('-'.repeat(40));
        intentionsRatees.forEach((item, index) => {
            console.log(`${index + 1}. "${item.phrase}"`);
            console.log(`   Attendu: ${item.attendu}, Obtenu: ${item.obtenu} (${item.score}%)`);
        });
    }
    
    console.log('\n🔍 LÉGENDE:');
    console.log('✅ Score > 90% ou toutes entités présentes');
    console.log('⚠️ Score 70-90% ou entités partiellement reconnues');
    console.log('❌ Score < 70% ou mauvaises entités');
    console.log('=' .repeat(80));
}

// Exécuter les tests
testNLP().catch(console.error);