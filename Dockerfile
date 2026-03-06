FROM rasa/rasa:3.5.17-full-slim

# Créer un utilisateur non-root
RUN useradd -m -u 1000 user

# Donner les permissions
RUN chown -R user:user /opt/venv
RUN chmod -R 755 /opt/venv

# Définir le répertoire de travail
WORKDIR /app

# Copier tes fichiers de configuration Rasa
COPY --chown=user ./rasa /app

# Switcher à l'utilisateur non-root
USER user

# IMPORTANT: Hugging Face utilise le port 7860
EXPOSE 7860

# Commande de démarrage
CMD ["rasa", "run", "--enable-api", "-i", "0.0.0.0", "-p", "7860", "--cors", "*"]
