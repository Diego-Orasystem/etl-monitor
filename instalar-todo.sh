#!/bin/bash

# Script completo para instalar todo lo necesario

echo "=== Instalación Completa de ETL Monitor Proxy ==="
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 1. Instalar Node.js
echo -e "${BLUE}Paso 1: Instalando Node.js y npm...${NC}"
if ! command -v node &> /dev/null; then
    ./instalar-nodejs.sh
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Error al instalar Node.js. Ejecuta manualmente: ./instalar-nodejs.sh${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Node.js ya está instalado: $(node --version)${NC}"
fi

echo ""

# 2. Instalar dependencias npm
echo -e "${BLUE}Paso 2: Instalando dependencias npm...${NC}"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Error al instalar dependencias${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Dependencias instaladas${NC}"
echo ""

# 3. Verificar archivos
echo -e "${BLUE}Paso 3: Verificando archivos...${NC}"
if [ ! -f "proxy-server.js" ]; then
    echo -e "${RED}❌ No se encontró proxy-server.js${NC}"
    exit 1
fi

if [ ! -d "public" ]; then
    echo -e "${RED}❌ No se encontró el directorio public${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Archivos verificados${NC}"
echo ""

# 4. Obtener IP del servidor
SERVER_IP=$(hostname -I | awk '{print $1}')

echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ INSTALACIÓN COMPLETADA                                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Para iniciar el servidor proxy:"
echo ""
echo -e "${YELLOW}  Opción 1: Ejecutar manualmente${NC}"
echo "    node proxy-server.js"
echo ""
echo -e "${YELLOW}  Opción 2: Configurar como servicio (recomendado)${NC}"
echo "    sudo ./configurar-proxy-servicio.sh"
echo ""
echo "Una vez iniciado, accede desde tu PC:"
echo -e "${GREEN}  http://$SERVER_IP:3000${NC}"
echo ""



