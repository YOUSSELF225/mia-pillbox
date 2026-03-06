// ============================================
// conversation-states.js - États de conversation
// ============================================

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
    RDV_COMPLETED: 'RDV_COMPLETED'
};

module.exports = { ConversationStates };