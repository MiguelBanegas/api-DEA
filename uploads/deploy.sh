#!/bin/bash
STATUS_FILE="/tmp/api-status.txt"
sudo -u miguel touch $STATUS_FILE
sudo chmod 666 $STATUS_FILE

### ===========================
### CONFIGURACIÓN
### ===========================

PROJECT_DIR="/var/www/api-DEA"        # Ruta de tu API
PM2_NAME="api-DEA"                    # Nombre del proceso PM2
BRANCH="master"                       # Rama de git
LOGFILE="/var/log/api-deploy.log"     # Log del deploy

### ===========================
### FUNCIONES
### ===========================

timestamp() {
    date +"%Y-%m-%d %H:%M:%S"
}

log() {
    echo "$(timestamp) - $1" | tee -a $LOGFILE
}

check_status() {
    if [ $? -ne 0 ]; then
        log "ERROR: $1"
        exit 1
    fi
}

test_api() {
    # Testea la API
    curl -s -o /dev/null -w "%{http_code}" https://dea.mabcontrol.ar/api/ > /tmp/api-status.txt
    STATUS=$(cat /tmp/api-status.txt)

    if [ "$STATUS" != "200" ]; then
        log "ERROR: La API no respondió correctamente. Código: $STATUS"
        exit 1
    fi

    log "API funcionando correctamente (200 OK)."
}

### ===========================
### INICIO DEL SCRIPT
### ===========================

log "===================================="
log "INICIANDO DEPLOY AUTOMÁTICO..."
log "===================================="

log "Moviéndose al directorio del proyecto: $PROJECT_DIR"
cd $PROJECT_DIR
check_status "No se pudo cambiar a la carpeta del proyecto."

log "Haciendo git fetch..."
git fetch origin
check_status "git fetch falló."

log "Actualizando código (git pull origin $BRANCH)..."
git pull origin $BRANCH
check_status "git pull falló."

log "Instalando dependencias..."
npm install --omit=dev
check_status "npm install falló."

log "Construyendo (si corresponde)..."
npm run build 2>/dev/null
# No hago check de error porque algunas APIs no usan build
sudo -u miguel pm2 stop api-DEA || true
sudo -u miguel pm2 start api-DEA || pm2 start index.js --name api-DEA

log "Reiniciando PM2..."
sudo -u miguel pm2 reload $PM2_NAME --update-env
check_status "Error reiniciando PM2."

log "Guardando estado de PM2..."
sudo -u miguel pm2 save

log "Testeando salud de la API..."
sleep 2
test_api

log "Revisando estado de Nginx..."
systemctl is-active --quiet nginx
if [ $? -ne 0 ]; then
    log "Nginx no está activo. Intentando reiniciar..."
    systemctl restart nginx
    check_status "No se pudo reiniciar Nginx."
else
    log "Nginx está funcionando OK."
fi

log "DEPLOY COMPLETADO EXITOSAMENTE."

