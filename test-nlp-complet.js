// ============================================
// test-nlp-complet.js - Test complet du modèle NLP
// ============================================

const { NlpManager } = require('node-nlp');
const path = require('path');

async function testNLP() {
    console.log('🧪 TEST COMPLET DU MODÈLE NLP\n');
    console.log('=' .repeat(60));

    // Charger le modèle
    const manager = new NlpManager({ languages: ['fr'] });
    manager.load(path.join(__dirname, 'model.nlp'));
    
    console.log('✅ Modèle chargé avec succès\n');

    // Liste de tests par catégorie
    const tests = [
        {
            category: '🔹 SALUTATIONS',
            phrases: [
                'bonjour',
                'salut',
                'bonsoir',
                'hello',
                'coucou',
                'ça va ?'
            ]
        },
        {
            category: '🔹 RECHERCHE MÉDICAMENTS',
            phrases: [
                'je cherche doliprane',
                'avez-vous amoxicilline',
                'est-ce que flagyl est disponible',
                'je veux du spasfon',
                'vous avez ventoline',
                'paracétamol dispo'
            ]
        },
        {
            category: '🔹 PRIX MÉDICAMENTS',
            phrases: [
                'combien coûte doliprane',
                'prix amoxicilline',
                'c\'est combien le flagyl',
                'augmentin prix',
                'tarif spasfon',
                'ibuprofène c\'est combien'
            ]
        },
        {
            category: '🔹 PHARMACIES DE GARDE',
            phrases: [
                'pharmacie de garde',
                'pharmacie de garde à cocody',
                'où trouver une pharmacie à yopougon',
                'pharmacie ouverte maintenant',
                'pharmacie de nuit à marcory',
                'pharmacie 24h/24 plateau'
            ]
        },
        {
            category: '🔹 COMMANDES',
            phrases: [
                'je veux commander',
                'comment passer commande',
                'acheter des médicaments',
                'je souhaite commander doliprane',
                'passer commande maintenant'
            ]
        },
        {
            category: '🔹 CHOIX NUMÉRO',
            phrases: [
                'le 1',
                'je prends le 2',
                'numéro 3',
                'le premier',
                'le deuxième',
                'je choisis le 4'
            ]
        },
        {
            category: '🔹 LIVRAISON',
            phrases: [
                'frais de livraison',
                'combien coûte la livraison',
                'délai de livraison',
                'vous livrez à bouaké',
                'livraison gratuite',
                'zones de livraison'
            ]
        },
        {
            category: '🔹 URGENCES',
            phrases: [
                'c\'est une urgence',
                'besoin de médicaments urgent',
                'je suis malade',
                'forte fièvre',
                'douleur intense',
                'appeler les urgences'
            ]
        },
        {
            category: '🔹 RENDEZ-VOUS',
            phrases: [
                'prendre rendez-vous',
                'je veux voir un médecin',
                'consultation médicale',
                'rendez-vous cardiologue',
                'voir un dentiste',
                'RDV avec Dr Koné'
            ]
        },
        {
            category: '🔹 CONFIRMATION/REFUS',
            phrases: [
                'oui',
                'd\'accord',
                'ok',
                'je confirme',
                'non',
                'non merci',
                'pas maintenant',
                'annuler'
            ]
        },
        {
            category: '🔹 REMERCIEMENTS',
            phrases: [
                'merci',
                'merci beaucoup',
                'je te remercie',
                'thanks',
                'merci pour ton aide'
            ]
        },
        {
            category: '🔹 AU REVOIR',
            phrases: [
                'au revoir',
                'bye',
                'à bientôt',
                'bonne journée',
                'à la prochaine'
            ]
        }
    ];

    // Exécuter les tests
    for (const testGroup of tests) {
        console.log(`\n${testGroup.category}`);
        console.log('-'.repeat(40));

        for (const phrase of testGroup.phrases) {
            const result = await manager.process('fr', phrase);
            
            // Afficher avec couleur selon le score
            const score = (result.score * 100).toFixed(2);
            let scoreColor = '';
            if (result.score > 0.9) scoreColor = '✅';
            else if (result.score > 0.7) scoreColor = '⚠️';
            else scoreColor = '❌';

            console.log(`📝 "${phrase}"`);
            console.log(`   ${scoreColor} Intention: ${result.intent} (${score}%)`);
            
            // Afficher les entités trouvées
            if (result.entities && result.entities.length > 0) {
                console.log(`   🔍 Entités trouvées:`);
                result.entities.forEach(entity => {
                    console.log(`      • ${entity.entity}: ${entity.option || entity.sourceText} (${(entity.accuracy * 100).toFixed(0)}%)`);
                });
            }
            console.log('');
        }
    }

    // Résumé
    console.log('=' .repeat(60));
    console.log('📊 RÉSUMÉ DES TESTS');
    console.log('=' .repeat(60));
    console.log('✅ Score > 90% : Excellent');
    console.log('⚠️ Score 70-90% : Bon');
    console.log('❌ Score < 70% : À améliorer');
    console.log('=' .repeat(60));
}

// Exécuter les tests
testNLP().catch(console.error);