#!/bin/bash
# Script para actualizar y reiniciar el sistema ETL Monitor

echo "🔄 Actualizando sistema ETL Monitor..."
echo ""

# Detener el servidor actual si está corriendo
echo "1️⃣ Deteniendo servidor actual..."
PID=$(ps aux | grep "node.*server.js" | grep -v grep | awk '{print $2}')
if [ ! -z "$PID" ]; then
    echo "   Proceso encontrado: PID $PID"
    kill $PID
    sleep 2
    
    # Verificar si se detuvo
    if ps -p $PID > /dev/null 2>&1; then
        echo "   ⚠️  Forzando cierre..."
        kill -9 $PID
        sleep 1
    fi
    echo "   ✅ Servidor detenido"
else
    echo "   ℹ️  No hay servidor corriendo"
fi

# Verificar que no haya procesos residuales
REMAINING=$(ps aux | grep "node.*server.js" | grep -v grep | wc -l)
if [ "$REMAINING" -gt 0 ]; then
    echo "   ⚠️  Aún hay procesos corriendo, forzando cierre..."
    pkill -f "node.*server.js"
    sleep 2
fi

echo ""
echo "2️⃣ Iniciando servidor actualizado..."
cd /home/fits/etl-monitor

# Iniciar el servidor en background
nohup node server.js > /tmp/etl-monitor.log 2>&1 &
NEW_PID=$!

sleep 3

# Verificar que el servidor se inició correctamente
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo "   ✅ Servidor iniciado (PID: $NEW_PID)"
    echo ""
    echo "3️⃣ Verificando estado del servicio..."
    
    # Esperar un poco más para que el servidor esté listo
    sleep 2
    
    # Verificar que responde
    if curl -s http://localhost:3000/api/table-monitor/status > /dev/null 2>&1; then
        echo "   ✅ API respondiendo correctamente"
    else
        echo "   ⚠️  API aún no responde (puede tardar unos segundos más)"
    fi
    
    echo ""
    echo "📊 Estado del monitoreo:"
    curl -s http://localhost:3000/api/table-monitor/status | python3 -m json.tool 2>/dev/null || echo "   Esperando inicialización..."
    
    echo ""
    echo "📋 Logs del servidor (últimas 10 líneas):"
    tail -10 /tmp/etl-monitor.log 2>/dev/null || echo "   No hay logs aún"
    
    echo ""
    echo "✅ Sistema actualizado y funcionando"
    echo "🌐 Accede a: http://localhost:3000"
    echo "📝 Logs: tail -f /tmp/etl-monitor.log"
else
    echo "   ❌ Error al iniciar el servidor"
    echo "   Revisa los logs: cat /tmp/etl-monitor.log"
    exit 1
fi



