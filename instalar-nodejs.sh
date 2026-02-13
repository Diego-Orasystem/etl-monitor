#!/bin/bash

# Script para instalar Node.js y npm en el servidor principal

echo "=== Instalación de Node.js y npm ==="
echo ""

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Verificar si ya está instalado
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js ya está instalado: $NODE_VERSION${NC}"
    
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        echo -e "${GREEN}✅ npm ya está instalado: $NPM_VERSION${NC}"
        exit 0
    fi
fi

echo "Instalando Node.js y npm..."
echo ""

# Método 1: Usar NodeSource (recomendado para versión más reciente)
echo "Opción 1: Instalando desde NodeSource (Node.js 18.x)..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Node.js instalado correctamente${NC}"
    node --version
    npm --version
    exit 0
fi

# Método 2: Usar apt (versión más antigua pero funciona)
echo ""
echo "Opción 1 falló. Intentando con apt..."
sudo apt update
sudo apt install -y nodejs npm

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Node.js instalado correctamente${NC}"
    node --version
    npm --version
    exit 0
else
    echo ""
    echo -e "${RED}❌ Error al instalar Node.js${NC}"
    echo ""
    echo "Instalación manual:"
    echo "  1. curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "  2. sudo apt-get install -y nodejs"
    exit 1
fi



