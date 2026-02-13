# Instrucciones: Acceder a ETL Monitor desde tu PC

## Problema
Tu PC accede al servidor principal, pero la VM (debian-vm06) está en una red interna no accesible directamente.

## Solución: Servidor Proxy

Ejecuta el servidor proxy en el **servidor principal**. Este servidor se conecta a la VM vía SSH y gestiona los servicios.

## Instalación Rápida

### 1. Instalar dependencias (si no están)
```bash
cd /home/fits/etl-monitor
npm install
```

### 2. Configurar como servicio (Recomendado)
```bash
cd /home/fits/etl-monitor
sudo ./configurar-proxy-servicio.sh
```

Este script:
- ✅ Verifica/instala Node.js
- ✅ Instala dependencias npm
- ✅ Configura el servicio systemd
- ✅ Opcionalmente configura SSH sin contraseña
- ✅ Inicia el servicio

### 3. O ejecutar manualmente
```bash
cd /home/fits/etl-monitor
node proxy-server.js
```

## Acceso desde tu PC

Una vez iniciado, accede desde tu navegador:

```
http://[IP_DEL_SERVIDOR_PRINCIPAL]:3000
```

Por ejemplo:
- `http://10.4.0.131:3000`
- `http://192.168.0.5:3000`

## Configurar SSH sin contraseña (Opcional pero Recomendado)

Para que el proxy funcione sin pedir contraseña:

```bash
# Generar clave SSH (si no tienes)
ssh-keygen -t rsa

# Copiar clave a la VM
ssh-copy-id root@192.168.122.222
```

## Verificar que Funciona

```bash
# Ver estado del servicio
sudo systemctl status etl-monitor-proxy.service

# Ver logs
sudo journalctl -u etl-monitor-proxy.service -f

# Probar desde el servidor
curl http://localhost:3000
```

## Diferencias entre server.js y proxy-server.js

- **server.js**: Se ejecuta EN la VM, accesible solo desde la red interna
- **proxy-server.js**: Se ejecuta en el SERVIDOR PRINCIPAL, accesible desde tu PC, se conecta a la VM vía SSH

## Solución de Problemas

### El servicio no inicia
```bash
# Ver logs de error
sudo journalctl -u etl-monitor-proxy.service -n 50

# Verificar que Node.js está instalado
node --version

# Verificar que las dependencias están instaladas
cd /home/fits/etl-monitor && npm list
```

### Error de conexión SSH
```bash
# Probar conexión manual
ssh root@192.168.122.222 "echo 'Conexión OK'"

# Si pide contraseña, configurar SSH sin contraseña (ver arriba)
```

### No puedo acceder desde mi PC
1. Verifica que el puerto 3000 esté abierto en el firewall
2. Verifica la IP del servidor: `hostname -I`
3. Prueba desde el servidor: `curl http://localhost:3000`
4. Verifica que el servicio esté corriendo: `sudo systemctl status etl-monitor-proxy.service`



