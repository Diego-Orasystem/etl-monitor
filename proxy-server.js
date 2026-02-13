const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = 3000;

// Configuración del proxy
const VM_IP = '192.168.122.222';  // IP estática de la VM (debian11)
const VM_PORT = 3000;

// Servicios a gestionar
const SERVICES = {
    'etl-upsert': {
        name: 'ETL Upsert',
        description: 'Procesamiento automático de archivos Excel desde SFTP',
        service: 'websocket-upsert-client.service'  // Cambiado a servicio WebSocket
    },
    'etl-analysis': {
        name: 'ETL Analysis',
        description: 'Análisis de archivos Excel',
        service: 'websocket-analysis-client.service'  // Cambiado a servicio WebSocket
    }
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Función para ejecutar comandos en la VM vía SSH
async function sshCommand(command) {
    try {
        const { stdout, stderr } = await execAsync(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@${VM_IP} "${command}"`);
        return { success: true, output: stdout, error: stderr };
    } catch (error) {
        const errorMsg = error.stderr || error.message || '';
        if (errorMsg.includes('No route to host') || errorMsg.includes('Connection refused') || errorMsg.includes('Connection timed out')) {
            return { 
                success: false, 
                output: error.stdout || '', 
                error: `No se puede conectar a la VM (${VM_IP}). Verifica que la VM esté corriendo y accesible.`
            };
        }
        return { success: false, output: error.stdout || '', error: errorMsg };
    }
}

// Función para ejecutar comandos systemctl en la VM
async function systemctlCommand(action, serviceName) {
    const command = `systemctl ${action} ${serviceName}`;
    return await sshCommand(command);
}

// Función para obtener estado del servicio en la VM
async function getServiceStatus(serviceName) {
    try {
        const { stdout: active } = await execAsync(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@${VM_IP} "systemctl is-active ${serviceName}"`);
        const isActive = active.trim() === 'active';
        
        const { stdout: enabled } = await execAsync(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@${VM_IP} "systemctl is-enabled ${serviceName}"`);
        const isEnabled = enabled.trim() === 'enabled';
        
        return { active: isActive, enabled: isEnabled };
    } catch (error) {
        const errorMsg = error.stderr || error.message || '';
        if (errorMsg.includes('No route to host') || errorMsg.includes('Connection refused') || errorMsg.includes('Connection timed out')) {
            return { 
                active: false, 
                enabled: false, 
                error: `No se puede conectar a la VM (${VM_IP}). Verifica que la VM esté corriendo.`
            };
        }
        return { active: false, enabled: false, error: errorMsg };
    }
}

// API Routes

// Obtener estado de todos los servicios
app.get('/api/services/status', async (req, res) => {
    try {
        const statuses = {};
        for (const [key, service] of Object.entries(SERVICES)) {
            const status = await getServiceStatus(service.service);
            statuses[key] = {
                ...service,
                ...status
            };
        }
        res.json({ success: true, services: statuses });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener estado de un servicio específico
app.get('/api/services/:serviceId/status', async (req, res) => {
    const { serviceId } = req.params;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    try {
        const status = await getServiceStatus(service.service);
        res.json({ success: true, service: { ...service, ...status } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Controlar servicio (start, stop, restart)
app.post('/api/services/:serviceId/:action', async (req, res) => {
    const { serviceId, action } = req.params;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    const validActions = ['start', 'stop', 'restart'];
    if (!validActions.includes(action)) {
        return res.status(400).json({ success: false, error: 'Acción no válida' });
    }
    
    try {
        const result = await systemctlCommand(action, service.service);
        if (result.success) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const status = await getServiceStatus(service.service);
            res.json({ 
                success: true, 
                message: `Servicio ${action} ejecutado correctamente`,
                status 
            });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Obtener logs de un servicio
app.get('/api/services/:serviceId/logs', async (req, res) => {
    const { serviceId } = req.params;
    const { lines = 50 } = req.query;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    try {
        const { stdout } = await execAsync(`ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no root@${VM_IP} "journalctl -u ${service.service} -n ${lines} --no-pager"`);
        res.json({ success: true, logs: stdout });
    } catch (error) {
        const errorMsg = error.stderr || error.message || '';
        if (errorMsg.includes('No route to host') || errorMsg.includes('Connection refused') || errorMsg.includes('Connection timed out')) {
            res.status(503).json({ 
                success: false, 
                error: `No se puede conectar a la VM (${VM_IP}). Verifica que la VM esté corriendo y accesible.`
            });
        } else {
            res.status(500).json({ success: false, error: errorMsg });
        }
    }
});

// Habilitar/deshabilitar inicio automático
app.post('/api/services/:serviceId/enable', async (req, res) => {
    const { serviceId } = req.params;
    const { enabled } = req.body;
    const service = SERVICES[serviceId];
    
    if (!service) {
        return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    
    try {
        const action = enabled ? 'enable' : 'disable';
        const result = await systemctlCommand(action, service.service);
        
        if (result.success) {
            const status = await getServiceStatus(service.service);
            res.json({ 
                success: true, 
                message: `Servicio ${enabled ? 'habilitado' : 'deshabilitado'} correctamente`,
                status 
            });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Inicio del servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor ETL Monitor (Proxy) corriendo en http://0.0.0.0:${PORT}`);
    console.log(`📊 Accede desde tu PC: http://[IP_SERVIDOR]:${PORT}`);
    console.log(`🔗 Conectando a VM: ${VM_IP}:${VM_PORT}`);
});

