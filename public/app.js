// Prevenir ejecución múltiple del script
if (window.__ETL_MONITOR_INITIALIZED) {
    console.warn('ETL Monitor ya está inicializado, evitando ejecución duplicada');
    // No hacer nada si ya está inicializado
}
window.__ETL_MONITOR_INITIALIZED = true;

const API_BASE = '';

// Estado de los servicios
let servicesState = {};

// Referencias a los intervalos para poder limpiarlos
let servicesInterval = null;
let upsertStatusInterval = null;
let analysisStatusInterval = null;

// Banderas para evitar llamadas simultáneas
let isLoadingServices = false;
let isLoadingUpsertStatus = false;
let isLoadingAnalysisStatus = false;

// Bandera para asegurar que la inicialización solo ocurra una vez
let isInitialized = false;

// Función para limpiar todos los intervalos
function clearAllIntervals() {
    if (servicesInterval) {
        clearInterval(servicesInterval);
        servicesInterval = null;
    }
    if (upsertStatusInterval) {
        clearInterval(upsertStatusInterval);
        upsertStatusInterval = null;
    }
    if (analysisStatusInterval) {
        clearInterval(analysisStatusInterval);
        analysisStatusInterval = null;
    }
}

// Inicializar aplicación
document.addEventListener('DOMContentLoaded', () => {
    // Prevenir inicialización múltiple
    if (isInitialized) {
        console.warn('La aplicación ya está inicializada, omitiendo inicialización duplicada');
        return;
    }
    
    // Limpiar intervalos anteriores si existen (por si se recarga la página)
    clearAllIntervals();
    
    isInitialized = true;
    
    // Cargar estado inicial después de un pequeño delay para evitar carga inmediata
    setTimeout(() => {
        loadServices();
    }, 500);
    
    // Actualizar estado cada 15 segundos (aumentado significativamente)
    servicesInterval = setInterval(loadServices, 15000);
    // Actualizar estado de upsert cada 10 segundos (aumentado significativamente)
    upsertStatusInterval = setInterval(loadUpsertStatus, 10000);
    // Actualizar estado de analysis cada 10 segundos (aumentado significativamente)
    analysisStatusInterval = setInterval(loadAnalysisStatus, 10000);
});

// Limpiar intervalos cuando se descarga la página
window.addEventListener('beforeunload', () => {
    clearAllIntervals();
    isInitialized = false;
});

// Cargar estado de los servicios
async function loadServices() {
    // Evitar llamadas simultáneas
    if (isLoadingServices) {
        return;
    }
    
    isLoadingServices = true;
    try {
        const response = await fetch(`${API_BASE}/api/services/status`);
        const data = await response.json();
        
        if (data.success) {
            servicesState = data.services;
            renderServices(data.services);
        } else {
            showError('Error al cargar el estado de los servicios');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    } finally {
        isLoadingServices = false;
    }
}

// Renderizar servicios
function renderServices(services) {
    const grid = document.getElementById('servicesGrid');
    grid.innerHTML = '';
    
    for (const [key, service] of Object.entries(services)) {
        const card = createServiceCard(key, service);
        grid.appendChild(card);
    }
}

// Crear tarjeta de servicio
function createServiceCard(key, service) {
    const card = document.createElement('div');
    card.className = 'service-card';
    
    const isActive = service.active;
    const isEnabled = service.enabled;
    
    card.innerHTML = `
        <div class="service-header">
            <div class="service-title">${service.name}</div>
            <div>
                <span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">
                    ${isActive ? '● Activo' : '○ Inactivo'}
                </span>
                ${isEnabled ? '<span class="status-badge status-enabled">Auto</span>' : ''}
            </div>
        </div>
        <div class="service-description">${service.description}</div>
        <div class="service-info">
            <div class="info-item">
                <span class="info-label">Estado:</span>
                <span>${isActive ? 'En ejecución' : 'Detenido'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Inicio automático:</span>
                <span>${isEnabled ? 'Habilitado' : 'Deshabilitado'}</span>
            </div>
            ${key === 'etl-upsert' && isActive ? `
            <div class="info-item" id="upsert-status-${key}">
                <span class="info-label">Progreso:</span>
                <span>Cargando...</span>
            </div>
            ` : ''}
            ${key === 'etl-analysis' && isActive ? `
            <div class="info-item" id="analysis-status-${key}">
                <span class="info-label">Progreso:</span>
                <span>Cargando...</span>
            </div>
            ` : ''}
        </div>
        <div class="service-actions">
            ${key === 'trigger-manager' 
                ? `<button class="btn btn-primary" onclick="showTriggerManager()">Gestionar Triggers y APIs</button>`
                : `
            ${!isActive 
                ? `<button class="btn btn-success" onclick="controlService('${key}', 'start')">Iniciar</button>`
                : `<button class="btn btn-danger" onclick="controlService('${key}', 'stop')">Detener</button>`
            }
            <button class="btn btn-warning" onclick="controlService('${key}', 'restart')">Reiniciar</button>
            <button class="btn btn-secondary" onclick="toggleAutoStart('${key}', ${!isEnabled})">
                ${isEnabled ? 'Deshabilitar Auto' : 'Habilitar Auto'}
            </button>
            <button class="btn btn-secondary" onclick="showLogs('${key}')">Ver Logs</button>
            ${key === 'etl-consol' 
                ? `<button class="btn btn-primary" onclick="showTcodeEditor()">Gestionar TCODEs</button>
                   <button class="btn btn-success" onclick="runConsolidation()">Ejecutar Consolidación</button>`
                : ''
            }
            ${key === 'etl-upsert' 
                ? `<button class="btn btn-success" onclick="runUpsert()">Ejecutar Procesamiento</button>`
                : ''
            }
            ${key === 'etl-analysis' 
                ? `<button class="btn btn-success" onclick="runAnalysis()">Ejecutar Análisis</button>`
                : ''
            }
            `
            }
        </div>
    `;
    
    return card;
}

// Controlar servicio (start, stop, restart)
async function controlService(serviceId, action) {
    const actionNames = {
        'start': 'iniciar',
        'stop': 'detener',
        'restart': 'reiniciar'
    };
    
    if (!confirm(`¿Estás seguro de que deseas ${actionNames[action]} el servicio ${servicesState[serviceId]?.name}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/services/${serviceId}/${action}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(`Servicio ${actionNames[action]} correctamente`);
            // Recargar estado después de un breve delay
            setTimeout(loadServices, 1000);
        } else {
            showError(`Error al ${actionNames[action]} el servicio: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Habilitar/deshabilitar inicio automático
async function toggleAutoStart(serviceId, enabled) {
    try {
        const response = await fetch(`${API_BASE}/api/services/${serviceId}/enable`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(data.message);
            setTimeout(loadServices, 1000);
        } else {
            showError(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Mostrar logs
async function showLogs(serviceId) {
    const logsSection = document.getElementById('logsSection');
    const logsText = document.getElementById('logsContent');
    
    logsSection.style.display = 'block';
    logsText.innerHTML = '<div class="loading">Cargando logs...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/api/services/${serviceId}/logs?lines=200`);
        const data = await response.json();
        
        if (data.success) {
            const logs = data.logs || 'No hay logs disponibles';
            // Formatear los logs con colores y mejor formato
            logsText.innerHTML = formatLogs(logs);
            // Scroll al final
            setTimeout(() => {
                logsText.scrollTop = logsText.scrollHeight;
            }, 100);
            
            // Auto-refresh cada 3 segundos
            if (window.logsInterval) {
                clearInterval(window.logsInterval);
            }
            window.logsInterval = setInterval(async () => {
                try {
                    const refreshResponse = await fetch(`${API_BASE}/api/services/${serviceId}/logs?lines=200`);
                    const refreshData = await refreshResponse.json();
                    if (refreshData.success) {
                        logsText.innerHTML = formatLogs(refreshData.logs || 'No hay logs disponibles');
                        logsText.scrollTop = logsText.scrollHeight;
                    }
                } catch (e) {
                    console.error('Error refrescando logs:', e);
                }
            }, 3000);
        } else {
            logsText.innerHTML = `<div class="error-message">Error al cargar logs: ${data.error}</div>`;
        }
    } catch (error) {
        console.error('Error:', error);
        logsText.innerHTML = '<div class="error-message">Error de conexión con el servidor</div>';
    }
}

// Formatear logs con colores y mejor estructura
function formatLogs(logs) {
    if (!logs || logs.trim() === '') {
        return '<div class="loading">No hay logs disponibles</div>';
    }
    
    // Dividir en líneas
    const lines = logs.split('\n');
    let html = '<div class="logs-container">';
    
    let inSeparator = false;
    let currentLog = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detectar separadores (líneas con ─)
        if (line.includes('────────────────────────────────────────────────────────────────────────────────')) {
            if (inSeparator && currentLog.length > 0) {
                // Cerrar el log anterior
                html += formatLogBlock(currentLog.join('\n'));
                currentLog = [];
            }
            inSeparator = true;
            html += '<div class="log-separator"></div>';
            continue;
        }
        
        if (inSeparator && line.trim() !== '') {
            inSeparator = false;
        }
        
        if (!inSeparator && line.trim() !== '') {
            currentLog.push(line);
        } else if (line.trim() === '' && currentLog.length > 0) {
            // Línea vacía después de un log - procesar el bloque
            html += formatLogBlock(currentLog.join('\n'));
            currentLog = [];
        }
    }
    
    // Procesar último bloque si existe
    if (currentLog.length > 0) {
        html += formatLogBlock(currentLog.join('\n'));
    }
    
    html += '</div>';
    return html;
}

// Formatear un bloque de log individual
function formatLogBlock(logBlock) {
    const lines = logBlock.split('\n');
    
    // Determinar el tipo de bloque basado en la primera línea
    let blockClass = 'log-block';
    const firstLine = lines[0] || '';
    
    if (firstLine.includes('| ERROR |')) {
        blockClass += ' log-block-error';
    } else if (firstLine.includes('| WARN |')) {
        blockClass += ' log-block-warn';
    } else if (firstLine.includes('| INFO |')) {
        blockClass += ' log-block-info';
    } else if (firstLine.includes('| DEBUG |')) {
        blockClass += ' log-block-debug';
    }
    
    let html = `<div class="${blockClass}">`;
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        let className = 'log-line';
        let content = escapeHtml(line);
        
        // Detectar tipo de línea y aplicar estilos
        if (line.includes('| ERROR |')) {
            className += ' log-error';
        } else if (line.includes('| WARN |')) {
            className += ' log-warn';
        } else if (line.includes('| INFO |')) {
            className += ' log-info';
        } else if (line.includes('| DEBUG |')) {
            className += ' log-debug';
        } else if (line.trim().startsWith('Mensaje:')) {
            className += ' log-message';
        } else if (line.trim().startsWith('Detalles:') || line.trim().startsWith('•')) {
            className += ' log-detail';
        } else if (line.includes('[TASK:')) {
            className += ' log-task';
        }
        
        // Resaltar timestamps
        content = content.replace(
            /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/g,
            '<span class="log-timestamp">$1</span>'
        );
        
        // Resaltar tags
        content = content.replace(
            /\[([A-Z_]+)\]/g,
            '<span class="log-tag">[$1]</span>'
        );
        
        html += `<div class="${className}">${content}</div>`;
    }
    
    html += '</div>';
    return html;
}

// Escapar HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Cerrar logs
function closeLogs() {
    if (window.logsInterval) {
        clearInterval(window.logsInterval);
        window.logsInterval = null;
    }
    document.getElementById('logsSection').style.display = 'none';
}

// Mostrar mensaje de error
function showError(message) {
    const grid = document.getElementById('servicesGrid');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    grid.insertBefore(errorDiv, grid.firstChild);
    
    setTimeout(() => {
        errorDiv.remove();
    }, 5000);
}

// Mostrar mensaje de éxito
function showSuccess(message) {
    const grid = document.getElementById('servicesGrid');
    const successDiv = document.createElement('div');
    successDiv.className = 'success-message';
    successDiv.textContent = message;
    grid.insertBefore(successDiv, grid.firstChild);
    
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Gestión de TCODE Spec (etl_consol)
// ═══════════════════════════════════════════════════════════════════════════

// Mostrar editor de TCODEs
async function showTcodeEditor() {
    const editorSection = document.getElementById('tcodeEditorSection');
    if (!editorSection) {
        createTcodeEditor();
    }
    
    const editorSection2 = document.getElementById('tcodeEditorSection');
    editorSection2.style.display = 'block';
    await loadTcodeSpec();
}

// Crear interfaz del editor
function createTcodeEditor() {
    const container = document.querySelector('.container');
    const editorDiv = document.createElement('div');
    editorDiv.id = 'tcodeEditorSection';
    editorDiv.className = 'tcode-editor-section';
    editorDiv.style.display = 'none';
    
    editorDiv.innerHTML = `
        <div class="tcode-editor-header">
            <h2>📝 Gestión de TCODEs - ETL Consolidation</h2>
            <button class="btn btn-secondary" onclick="closeTcodeEditor()">Cerrar</button>
        </div>
        <div class="tcode-editor-content">
            <div class="tcode-editor-toolbar">
                <button class="btn btn-success" onclick="addNewTcode()">➕ Agregar TCODE</button>
                <button class="btn btn-primary" onclick="saveTcodeSpec()">💾 Guardar</button>
                <button class="btn btn-secondary" onclick="loadTcodeSpec()">🔄 Recargar</button>
            </div>
            <div id="tcodeList" class="tcode-list">
                <div class="loading">Cargando TCODEs...</div>
            </div>
        </div>
    `;
    
    container.appendChild(editorDiv);
}

// Cargar spec desde el servidor (con información completa incluyendo enabled)
async function loadTcodeSpec() {
    const tcodeList = document.getElementById('tcodeList');
    if (!tcodeList) return;
    
    tcodeList.innerHTML = '<div class="loading">Cargando TCODEs...</div>';
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-consol/spec-full`);
        const data = await response.json();
        
        if (data.success) {
            renderTcodeList(data.spec || {});
        } else {
            // Fallback a endpoint anterior si no existe el nuevo
            const response2 = await fetch(`${API_BASE}/api/etl-consol/spec`);
            const data2 = await response2.json();
            if (data2.success) {
                renderTcodeList(data2.spec || {});
            } else {
                tcodeList.innerHTML = `<div class="error-message">Error: ${data2.error}</div>`;
            }
        }
    } catch (error) {
        console.error('Error:', error);
        tcodeList.innerHTML = '<div class="error-message">Error de conexión con el servidor</div>';
    }
}

// Renderizar lista de TCODEs
function renderTcodeList(spec) {
    const tcodeList = document.getElementById('tcodeList');
    if (!tcodeList) return;
    
    const tcodes = Object.keys(spec);
    
    if (tcodes.length === 0) {
        tcodeList.innerHTML = `
            <div class="tcode-empty">
                <p>No hay TCODEs configurados</p>
                <button class="btn btn-success" onclick="addNewTcode()">Agregar primer TCODE</button>
            </div>
        `;
        return;
    }
    
    // Separar habilitados y deshabilitados
    const enabled = [];
    const disabled = [];
    
    for (const tcode of tcodes) {
        const config = spec[tcode];
        if (config.enabled === true) {
            enabled.push({ tcode, config });
        } else {
            disabled.push({ tcode, config });
        }
    }
    
    let html = '';
    
    if (enabled.length > 0) {
        html += '<div class="tcode-group">';
        html += `<h3 class="tcode-group-title">✅ Habilitados (${enabled.length})</h3>`;
        html += '<div class="tcode-items">';
        for (const { tcode, config } of enabled) {
            html += createTcodeCard(tcode, config);
        }
        html += '</div></div>';
    }
    
    if (disabled.length > 0) {
        html += '<div class="tcode-group">';
        html += `<h3 class="tcode-group-title">❌ Deshabilitados (${disabled.length})</h3>`;
        html += '<div class="tcode-items">';
        for (const { tcode, config } of disabled) {
            html += createTcodeCard(tcode, config);
        }
        html += '</div></div>';
    }
    
    tcodeList.innerHTML = html;
}

// Toggle habilitar/deshabilitar TCODE
async function toggleTcode(tcode, enabled) {
    try {
        const response = await fetch(`${API_BASE}/api/etl-consol/spec/${tcode}/toggle`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(`TCODE ${tcode} ${enabled ? 'habilitado' : 'deshabilitado'} correctamente`);
            await loadTcodeSpec();
        } else {
            showError(`Error: ${data.error}`);
            // Revertir el toggle si falló
            await loadTcodeSpec();
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
        // Revertir el toggle si falló
        await loadTcodeSpec();
    }
}

// Crear tarjeta de TCODE
function createTcodeCard(tcode, config) {
    // Detectar si es formato antiguo (array directo) o nuevo (objeto con enabled)
    let enabled = true;
    let spec = config;
    
    if (Array.isArray(config)) {
        // Formato antiguo: array directo = habilitado por defecto (comportamiento original)
        enabled = true;
        spec = { columns: config };
    } else if (typeof config === 'object' && config !== null) {
        // Formato nuevo: objeto con enabled (default: false si no está definido)
        enabled = config.enabled !== undefined ? config.enabled : false;
        spec = config;
    }
    
    const hasKeyColumns = spec.keyColumns && Array.isArray(spec.keyColumns);
    const keyColumns = hasKeyColumns ? spec.keyColumns : (spec.columns || []);
    const mergeColumns = hasKeyColumns ? (spec.mergeColumns || []) : [];
    
    return `
        <div class="tcode-card ${enabled ? 'tcode-enabled' : 'tcode-disabled'}" data-tcode="${tcode}">
            <div class="tcode-card-header">
                <div class="tcode-title-section">
                    <h3>${tcode}</h3>
                    <label class="tcode-toggle">
                        <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleTcode('${tcode}', this.checked)">
                        <span class="tcode-toggle-slider"></span>
                        <span class="tcode-toggle-label">${enabled ? 'Habilitado' : 'Deshabilitado'}</span>
                    </label>
                </div>
                <div class="tcode-card-actions">
                    <button class="btn btn-small btn-secondary" onclick="editTcode('${tcode}')">✏️ Editar</button>
                    <button class="btn btn-small btn-danger" onclick="deleteTcode('${tcode}')">🗑️ Eliminar</button>
                </div>
            </div>
            <div class="tcode-card-body">
                ${hasKeyColumns ? `
                    <div class="tcode-spec-section">
                        <h4>Key Columns (${keyColumns.length})</h4>
                        <div class="tcode-columns">
                            ${keyColumns.map(col => `<span class="tcode-column">${escapeHtml(col)}</span>`).join('')}
                        </div>
                    </div>
                    ${mergeColumns.length > 0 ? `
                        <div class="tcode-spec-section">
                            <h4>Merge Columns (${mergeColumns.length})</h4>
                            <div class="tcode-columns">
                                ${mergeColumns.map(col => `<span class="tcode-column">${escapeHtml(col)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                ` : `
                    <div class="tcode-spec-section">
                        <h4>Columns (${keyColumns.length})</h4>
                        <div class="tcode-columns">
                            ${keyColumns.map(col => `<span class="tcode-column">${escapeHtml(col)}</span>`).join('')}
                        </div>
                    </div>
                `}
            </div>
        </div>
    `;
}

// Agregar nuevo TCODE
function addNewTcode() {
    const tcode = prompt('Ingresa el nombre del TCODE:');
    if (!tcode || !tcode.trim()) return;
    
    const tcodeName = tcode.trim().toUpperCase();
    editTcode(tcodeName, true);
}

// Editar TCODE - actualizado para manejar enabled
async function editTcode(tcode, isNew = false) {
    let config = { enabled: true };
    
    if (!isNew) {
        try {
            const response = await fetch(`${API_BASE}/api/etl-consol/spec-full`);
            const data = await response.json();
            if (data.success && data.spec[tcode]) {
                config = data.spec[tcode];
            }
        } catch (error) {
            console.error('Error cargando TCODE:', error);
        }
    }
    
    const hasKeyColumns = config.keyColumns && Array.isArray(config.keyColumns);
    const keyColumns = hasKeyColumns ? config.keyColumns : (config.columns || []);
    const mergeColumns = hasKeyColumns ? (config.mergeColumns || []) : [];
    
    const modal = document.createElement('div');
    modal.className = 'tcode-modal';
    modal.innerHTML = `
        <div class="tcode-modal-content">
            <div class="tcode-modal-header">
                <h2>${isNew ? 'Nuevo' : 'Editar'} TCODE: ${tcode}</h2>
                <button class="btn btn-secondary" onclick="this.closest('.tcode-modal').remove()">Cerrar</button>
            </div>
            <div class="tcode-modal-body">
                <div class="tcode-form-group">
                    <label>
                        <input type="checkbox" ${config.enabled !== false ? 'checked' : ''} id="tcodeEnabled">
                        Habilitado (se procesará en la consolidación)
                    </label>
                </div>
                ${hasKeyColumns ? `
                    <div class="tcode-form-group">
                        <label>Key Columns (una por línea):</label>
                        <textarea id="tcodeKeyColumns" rows="10" placeholder="cod_municipio&#10;cod_cuenta&#10;ejercicio">${keyColumns.join('\n')}</textarea>
                    </div>
                    <div class="tcode-form-group">
                        <label>Merge Columns (una por línea, opcional):</label>
                        <textarea id="tcodeMergeColumns" rows="10" placeholder="COALESCE(nombre_cuenta_n, nombre_cuenta_nivel_) AS nombre_cuenta_n1&#10;COALESCE(debe_ene, debe_enero) AS debe_enero">${mergeColumns.join('\n')}</textarea>
                        <small>Formato: COALESCE(col1, col2) AS alias</small>
                    </div>
                ` : `
                    <div class="tcode-form-group">
                        <label>Columns (una por línea):</label>
                        <textarea id="tcodeKeyColumns" rows="10" placeholder="cod_municipio&#10;cod_cuenta&#10;ejercicio">${keyColumns.join('\n')}</textarea>
                    </div>
                    <div class="tcode-form-group" style="display: none;">
                        <textarea id="tcodeMergeColumns" rows="1"></textarea>
                    </div>
                `}
            </div>
            <div class="tcode-modal-footer">
                <button class="btn btn-primary" onclick="saveTcode('${tcode}')">💾 Guardar</button>
                <button class="btn btn-secondary" onclick="this.closest('.tcode-modal').remove()">Cancelar</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
}


// Guardar TCODE individual
async function saveTcode(tcode) {
    const keyColumnsText = document.getElementById('tcodeKeyColumns').value.trim();
    const mergeColumnsText = document.getElementById('tcodeMergeColumns').value.trim();
    const enabled = document.getElementById('tcodeEnabled') ? document.getElementById('tcodeEnabled').checked : true;
    
    const keyColumns = keyColumnsText.split('\n').map(s => s.trim()).filter(s => s);
    const mergeColumns = mergeColumnsText.split('\n').map(s => s.trim()).filter(s => s);
    
    let spec;
    if (mergeColumns.length > 0) {
        spec = {
            enabled: enabled,
            keyColumns,
            mergeColumns
        };
    } else {
        spec = {
            enabled: enabled,
            columns: keyColumns
        };
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-consol/spec/${tcode}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ spec })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(data.message || `TCODE ${tcode} guardado correctamente`);
            document.querySelector('.tcode-modal').remove();
            await loadTcodeSpec();
        } else {
            showError(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Guardar spec completo
async function saveTcodeSpec() {
    try {
        // Usar spec-full para obtener TODOS los TCODEs (habilitados y deshabilitados)
        const response = await fetch(`${API_BASE}/api/etl-consol/spec-full`);
        const data = await response.json();
        
        if (!data.success) {
            showError('Error cargando spec actual');
            return;
        }
        
        // Convertir el formato normalizado de vuelta al formato del archivo
        const specToSave = {};
        for (const [tcode, config] of Object.entries(data.spec)) {
            if (config.enabled === true && config.columns && !config.keyColumns) {
                // Si está habilitado y solo tiene columns, guardar como array (formato antiguo)
                specToSave[tcode] = config.columns;
            } else {
                // Guardar con estructura completa (incluyendo enabled)
                specToSave[tcode] = config;
            }
        }
        
        const response2 = await fetch(`${API_BASE}/api/etl-consol/spec`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ spec: specToSave })
        });
        
        const data2 = await response2.json();
        
        if (data2.success) {
            showSuccess('Especificación guardada correctamente');
            // Recargar para mostrar cambios
            await loadTcodeSpec();
        } else {
            showError(`Error: ${data2.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Eliminar TCODE
async function deleteTcode(tcode) {
    if (!confirm(`¿Estás seguro de que deseas eliminar el TCODE "${tcode}"?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-consol/spec/${tcode}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(data.message || `TCODE ${tcode} eliminado correctamente`);
            await loadTcodeSpec();
        } else {
            showError(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Cerrar editor
function closeTcodeEditor() {
    const editorSection = document.getElementById('tcodeEditorSection');
    if (editorSection) {
        editorSection.style.display = 'none';
    }
}

// Ejecutar consolidación manualmente
async function runConsolidation() {
    if (!confirm('¿Estás seguro de que deseas ejecutar la consolidación manualmente?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-consol/run`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Consolidación iniciada correctamente');
            // Recargar estado después de un breve delay
            setTimeout(loadServices, 1000);
        } else {
            showError(`Error al ejecutar consolidación: ${data.error || data.message || 'Error desconocido'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Ejecutar upsert manualmente
async function runUpsert() {
    if (!confirm('¿Estás seguro de que deseas ejecutar el procesamiento de upsert manualmente?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-upsert/run`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Procesamiento iniciado correctamente');
            // Recargar estado después de un breve delay
            setTimeout(loadServices, 1000);
            setTimeout(loadUpsertStatus, 1000);
        } else {
            showError(`Error al ejecutar procesamiento: ${data.error || data.message || 'Error desconocido'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Cargar estado de upsert
async function loadUpsertStatus() {
    // Evitar llamadas simultáneas
    if (isLoadingUpsertStatus) {
        return;
    }
    
    isLoadingUpsertStatus = true;
    try {
        const response = await fetch(`${API_BASE}/api/etl-upsert/status`);
        const data = await response.json();
        
        if (data.success) {
            const statusElement = document.getElementById('upsert-status-etl-upsert');
            if (statusElement) {
                const { totalPending, progress, byContext } = data;
                let statusText = '';
                
                if (totalPending > 0) {
                    statusText = `${totalPending} archivo(s) pendiente(s)`;
                    if (progress.total > 0) {
                        statusText += ` | Progreso: ${progress.done}/${progress.total} (${progress.percentage}%)`;
                    }
                    if (byContext && Object.keys(byContext).length > 0) {
                        const ctxDetails = Object.entries(byContext)
                            .filter(([_, count]) => count > 0)
                            .map(([ctx, count]) => `${ctx}: ${count}`)
                            .join(', ');
                        if (ctxDetails) {
                            statusText += ` | ${ctxDetails}`;
                        }
                    }
                } else if (progress.total > 0) {
                    statusText = `Completado: ${progress.done}/${progress.total} (${progress.percentage}%)`;
                } else {
                    statusText = 'Sin archivos pendientes';
                }
                
                statusElement.innerHTML = `
                    <span class="info-label">Progreso:</span>
                    <span>${statusText}</span>
                `;
            }
        }
    } catch (error) {
        // Silenciar errores para no llenar la consola
        console.debug('Error cargando estado de upsert:', error);
    } finally {
        isLoadingUpsertStatus = false;
    }
}

// Cargar estado de analysis
async function loadAnalysisStatus() {
    // Evitar llamadas simultáneas
    if (isLoadingAnalysisStatus) {
        return;
    }
    
    isLoadingAnalysisStatus = true;
    try {
        const response = await fetch(`${API_BASE}/api/etl-analysis/status`);
        const data = await response.json();
        
        if (data.success) {
            const statusElement = document.getElementById('analysis-status-etl-analysis');
            if (statusElement) {
                const { totalPending, inFlight, processed, byContext, phase, capacity } = data;
                let statusText = '';
                
                if (totalPending > 0 || inFlight > 0) {
                    statusText = `${totalPending} pendiente(s)`;
                    if (inFlight > 0) {
                        statusText += ` | ${inFlight} en procesamiento`;
                    }
                    if (processed > 0) {
                        statusText += ` | ${processed} procesado(s)`;
                    }
                    if (byContext && Object.keys(byContext).length > 0) {
                        const ctxDetails = Object.entries(byContext)
                            .filter(([_, count]) => count > 0)
                            .map(([ctx, count]) => `${ctx}: ${count}`)
                            .join(', ');
                        if (ctxDetails) {
                            statusText += ` | ${ctxDetails}`;
                        }
                    }
                    if (capacity && capacity.available < capacity.limit) {
                        statusText += ` | Capacidad: ${capacity.used}/${capacity.limit}`;
                    }
                } else if (processed > 0) {
                    statusText = `Completado: ${processed} archivo(s) procesado(s)`;
                } else {
                    statusText = 'Sin archivos pendientes';
                }
                
                if (phase && phase !== 'IDLE') {
                    statusText += ` | Fase: ${phase}`;
                }
                
                statusElement.innerHTML = `
                    <span class="info-label">Progreso:</span>
                    <span>${statusText}</span>
                `;
            }
        }
    } catch (error) {
        // Silenciar errores para no llenar la consola
        console.debug('Error cargando estado de analysis:', error);
    } finally {
        isLoadingAnalysisStatus = false;
    }
}

// Ejecutar analysis manualmente
async function runAnalysis() {
    if (!confirm('¿Estás seguro de que deseas ejecutar el análisis manualmente?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/etl-analysis/run`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess('Análisis iniciado correctamente');
            // Recargar estado después de un breve delay
            setTimeout(loadServices, 1000);
        } else {
            showError(`Error al ejecutar análisis: ${data.error || data.message || 'Error desconocido'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Funciones de seguimiento de archivos
let trackingInterval = null;
let currentTrackingFile = null;
let isTrackingInProgress = false; // Bandera para evitar múltiples llamadas simultáneas

function openTrackingModal() {
    // Detener cualquier actualización en curso
    stopTracking();
    
    document.getElementById('trackingModal').style.display = 'flex';
    document.getElementById('trackingSearchInput').focus();
}

function closeTrackingModal() {
    // Detener actualizaciones automáticas
    stopTracking();
    
    document.getElementById('trackingModal').style.display = 'none';
    document.getElementById('trackingResults').style.display = 'none';
    document.getElementById('trackingError').style.display = 'none';
    document.getElementById('trackingSearchInput').value = '';
}

function stopTracking() {
    // Detener actualización anterior si existe
    if (trackingInterval) {
        clearTimeout(trackingInterval);
        trackingInterval = null;
    }
    currentTrackingFile = null;
    isTrackingInProgress = false;
}

async function trackFile() {
    // Evitar múltiples llamadas simultáneas
    if (isTrackingInProgress) {
        console.log('Tracking ya en progreso, ignorando llamada duplicada');
        return;
    }
    
    const filename = document.getElementById('trackingSearchInput').value.trim();
    if (!filename) {
        showTrackingError('Por favor ingresa un nombre de archivo');
        return;
    }
    
    // Detener actualización anterior si existe
    if (trackingInterval) {
        clearTimeout(trackingInterval);
        trackingInterval = null;
    }
    
    // Asegurar que tenga extensión .xlsx
    const searchFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    
    // Si cambió el archivo, reiniciar el tracking
    if (currentTrackingFile !== searchFilename) {
        stopTracking();
    }
    
    currentTrackingFile = searchFilename;
    isTrackingInProgress = true;
    
    try {
        document.getElementById('trackingError').style.display = 'none';
        document.getElementById('trackingResults').style.display = 'block';
        document.getElementById('trackingFileName').textContent = `📄 ${searchFilename}`;
        document.getElementById('pipelineStatus').innerHTML = '<div class="loading">Cargando estado...</div>';
        
        const response = await fetch(`${API_BASE}/api/track/${encodeURIComponent(searchFilename)}`);
        const data = await response.json();
        
        isTrackingInProgress = false;
        
        // Verificar que el archivo no haya cambiado mientras se procesaba la respuesta
        const currentInput = document.getElementById('trackingSearchInput').value.trim();
        const currentSearchFilename = currentInput.endsWith('.xlsx') ? currentInput : `${currentInput}.xlsx`;
        
        if (currentSearchFilename !== searchFilename) {
            // El usuario cambió el archivo mientras se procesaba, no actualizar
            return;
        }
        
        if (data.success) {
            renderPipelineStatus(data);
            // Programar próxima actualización solo si el archivo sigue siendo el mismo
            trackingInterval = setTimeout(() => {
                const stillCurrent = document.getElementById('trackingSearchInput').value.trim();
                const stillCurrentFilename = stillCurrent.endsWith('.xlsx') ? stillCurrent : `${stillCurrent}.xlsx`;
                if (stillCurrentFilename === searchFilename && currentTrackingFile === searchFilename) {
                    trackFile();
                }
            }, 15000);
        } else {
            showTrackingError(data.error || 'Error al obtener el estado del archivo');
        }
    } catch (error) {
        isTrackingInProgress = false;
        console.error('Error:', error);
        showTrackingError('Error de conexión con el servidor');
    }
}

function renderPipelineStatus(data) {
    const pipeline = data.pipeline || {};
    const analysis = data.analysis || {};
    const upsert = data.upsert || {};
    
    const steps = [
        {
            name: 'KNFO',
            status: pipeline.step1_knfo || 'unknown',
            description: 'Análisis y creación de archivo KNFO',
            details: analysis.hasKnfo ? '✓ Archivo KNFO creado' : '⏳ Pendiente'
        },
        {
            name: 'META',
            status: pipeline.step2_meta || 'unknown',
            description: 'Generación de archivo META',
            details: analysis.hasMeta ? '✓ Archivo META creado' : '⏳ Pendiente'
        },
        {
            name: 'UPSERT',
            status: pipeline.step3_upsert || 'unknown',
            description: 'Procesamiento e inserción en base de datos',
            details: upsert.processed || upsert.hasTable 
                ? `✓ Procesado${upsert.rowCount ? ` (${upsert.rowCount} filas)` : ''}` 
                : '⏳ Pendiente'
        },
        {
            name: 'CONSOL',
            status: pipeline.step4_consol || 'waiting',
            description: 'Consolidación en LEK-JOINED',
            details: '⏳ Pendiente'
        }
    ];
    
    const statusHTML = steps.map(step => {
        const statusClass = getStatusClass(step.status);
        const statusIcon = getStatusIcon(step.status);
        
        return `
            <div class="pipeline-step ${statusClass}">
                <div class="step-header">
                    <span class="step-icon">${statusIcon}</span>
                    <span class="step-name">${step.name}</span>
                </div>
                <div class="step-description">${step.description}</div>
                <div class="step-details">${step.details}</div>
            </div>
        `;
    }).join('');
    
    document.getElementById('pipelineStatus').innerHTML = `
        <div class="pipeline-steps">
            ${statusHTML}
        </div>
        <div class="pipeline-info">
            <small>Última actualización: ${new Date(data.timestamp).toLocaleString()} | Se actualiza automáticamente cada 15 segundos</small>
        </div>
    `;
}

function getStatusClass(status) {
    switch(status) {
        case 'completed': return 'status-completed';
        case 'processing': return 'status-processing';
        case 'pending': return 'status-pending';
        case 'waiting': return 'status-waiting';
        default: return 'status-unknown';
    }
}

function getStatusIcon(status) {
    switch(status) {
        case 'completed': return '🟢';
        case 'processing': return '🟡';
        case 'pending': return '🟠';
        case 'waiting': return '⚪';
        default: return '⚫';
    }
}

function showTrackingError(message) {
    const errorDiv = document.getElementById('trackingError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('trackingResults').style.display = 'none';
}

// Cerrar modal al hacer clic fuera
document.addEventListener('click', (e) => {
    const modal = document.getElementById('trackingModal');
    if (e.target === modal) {
        closeTrackingModal();
    }
    const triggerModal = document.getElementById('triggerManagerModal');
    if (e.target === triggerModal) {
        closeTriggerManager();
    }
    const prefixModal = document.getElementById('prefixModal');
    if (e.target === prefixModal) {
        closePrefixModal();
    }
});

// ========== MANTENEDOR DE TRIGGERS Y APIs ==========
let currentSelectedTriggerId = null;

// Abrir modal del mantenedor
async function showTriggerManager() {
    document.getElementById('triggerManagerModal').style.display = 'flex';
    await loadTriggers();
}

// Cerrar modal del mantenedor
function closeTriggerManager() {
    // Detener ejecución si está en curso
    if (isExecuting) {
        stopExecution();
    }
    
    // Cerrar modal de prefijos si está abierto
    const prefixModal = document.getElementById('prefixModal');
    if (prefixModal.style.display === 'flex') {
        closePrefixModal();
    }
    
    // Restaurar vista
    restoreTriggerManagerView();
    
    document.getElementById('triggerManagerModal').style.display = 'none';
    currentSelectedTriggerId = null;
    document.getElementById('apiSection').style.display = 'none';
    document.getElementById('apiSectionEmpty').style.display = 'block';
}

// Cargar triggers
async function loadTriggers() {
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (data.success) {
            renderTriggers(data.triggers || {});
        } else {
            showError('Error al cargar los triggers');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Renderizar lista de triggers
function renderTriggers(triggers) {
    const triggerList = document.getElementById('triggerList');
    triggerList.innerHTML = '';
    
    const triggerArray = Object.values(triggers);
    
    if (triggerArray.length === 0) {
        triggerList.innerHTML = '<p class="empty-message">No hay triggers. Crea uno nuevo para comenzar.</p>';
        return;
    }
    
    triggerArray.forEach(trigger => {
        const triggerItem = document.createElement('div');
        triggerItem.className = `trigger-item ${currentSelectedTriggerId === trigger.id ? 'selected' : ''}`;
        triggerItem.innerHTML = `
            <div class="trigger-item-content" onclick="selectTrigger('${trigger.id}')">
                <div class="trigger-item-name">${trigger.name}</div>
                <div class="trigger-item-description">${trigger.description || 'Sin descripción'}</div>
                <div class="trigger-item-meta">
                    <span>${trigger.apis?.length || 0} API(s)</span>
                    <span>•</span>
                    <span>Creado: ${new Date(trigger.createdAt).toLocaleDateString()}</span>
                </div>
            </div>
            <div class="trigger-item-actions">
                <button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); editTrigger('${trigger.id}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteTrigger('${trigger.id}')">🗑️</button>
            </div>
        `;
        triggerList.appendChild(triggerItem);
    });
}

// Seleccionar un trigger
async function selectTrigger(triggerId) {
    currentSelectedTriggerId = triggerId;
    await loadTriggers(); // Recargar para actualizar el estilo selected
    await loadApis(triggerId);
    await loadTriggerTags(triggerId); // Cargar tags del trigger
    
    // Obtener nombre del trigger
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        if (data.success && data.triggers[triggerId]) {
            document.getElementById('selectedTriggerName').textContent = data.triggers[triggerId].name;
        }
    } catch (error) {
        console.error('Error:', error);
    }
    
    document.getElementById('apiSection').style.display = 'block';
    document.getElementById('apiSectionEmpty').style.display = 'none';
}

// Cargar APIs de un trigger
async function loadApis(triggerId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis`);
        const data = await response.json();
        
        if (data.success) {
            renderApis(data.apis || []);
        } else {
            showError('Error al cargar las APIs');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Renderizar lista de APIs
function renderApis(apis) {
    const apiList = document.getElementById('apiList');
    apiList.innerHTML = '';
    
    if (apis.length === 0) {
        apiList.innerHTML = '<p class="empty-message">No hay APIs. Agrega una nueva API para este trigger.</p>';
        return;
    }
    
    apis.forEach(api => {
        const apiItem = document.createElement('div');
        apiItem.className = 'api-item';
        apiItem.innerHTML = `
            <div class="api-item-content">
                <div class="api-item-name">${api.name}</div>
                <div class="api-item-endpoint">${api.endpoint}</div>
            </div>
            <div class="api-item-actions">
                <button class="btn btn-sm btn-warning" onclick="editApi('${currentSelectedTriggerId}', '${api.id}')">✏️</button>
                <button class="btn btn-sm btn-danger" onclick="deleteApi('${currentSelectedTriggerId}', '${api.id}')">🗑️</button>
            </div>
        `;
        apiList.appendChild(apiItem);
    });
}

// Mostrar formulario para agregar trigger
function showAddTriggerForm() {
    document.getElementById('triggerFormTitle').textContent = 'Agregar Trigger';
    document.getElementById('triggerFormId').value = '';
    document.getElementById('triggerName').value = '';
    document.getElementById('triggerDescription').value = '';
    document.getElementById('triggerFormModal').style.display = 'flex';
}

// Editar trigger
async function editTrigger(triggerId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (data.success && data.triggers[triggerId]) {
            const trigger = data.triggers[triggerId];
            document.getElementById('triggerFormTitle').textContent = 'Editar Trigger';
            document.getElementById('triggerFormId').value = triggerId;
            document.getElementById('triggerName').value = trigger.name;
            document.getElementById('triggerDescription').value = trigger.description || '';
            document.getElementById('triggerFormModal').style.display = 'flex';
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar el trigger');
    }
}

// Cerrar formulario de trigger
function closeTriggerForm() {
    document.getElementById('triggerFormModal').style.display = 'none';
}

// Guardar trigger
async function saveTrigger(event) {
    event.preventDefault();
    
    const triggerId = document.getElementById('triggerFormId').value;
    const name = document.getElementById('triggerName').value.trim();
    const description = document.getElementById('triggerDescription').value.trim();
    
    try {
        let response;
        if (triggerId) {
            // Actualizar
            response = await fetch(`${API_BASE}/api/triggers/${triggerId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
        } else {
            // Crear
            response = await fetch(`${API_BASE}/api/triggers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
        }
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(triggerId ? 'Trigger actualizado correctamente' : 'Trigger creado correctamente');
            closeTriggerForm();
            await loadTriggers();
        } else {
            showError(data.error || 'Error al guardar el trigger');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Eliminar trigger
async function deleteTrigger(triggerId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        const trigger = data.success && data.triggers[triggerId];
        const triggerName = trigger ? trigger.name : triggerId;
        
        if (!confirm(`¿Estás seguro de que deseas eliminar el trigger "${triggerName}"? Esto también eliminará todas sus APIs.`)) {
            return;
        }
        
        const deleteResponse = await fetch(`${API_BASE}/api/triggers/${triggerId}`, {
            method: 'DELETE'
        });
        
        const deleteData = await deleteResponse.json();
        
        if (deleteData.success) {
            showSuccess('Trigger eliminado correctamente');
            if (currentSelectedTriggerId === triggerId) {
                currentSelectedTriggerId = null;
                document.getElementById('apiSection').style.display = 'none';
                document.getElementById('apiSectionEmpty').style.display = 'block';
            }
            await loadTriggers();
        } else {
            showError(deleteData.error || 'Error al eliminar el trigger');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Mostrar formulario para agregar API
function showAddApiForm() {
    if (!currentSelectedTriggerId) {
        showError('Por favor selecciona un trigger primero');
        return;
    }
    
    document.getElementById('apiFormTitle').textContent = 'Agregar API';
    document.getElementById('apiFormTriggerId').value = currentSelectedTriggerId;
    document.getElementById('apiFormId').value = '';
    document.getElementById('apiName').value = '';
    document.getElementById('apiEndpoint').value = '';
    document.getElementById('apiFormModal').style.display = 'flex';
}

// Editar API
async function editApi(triggerId, apiId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis`);
        const data = await response.json();
        
        if (data.success) {
            const api = data.apis.find(a => a.id === apiId);
            if (api) {
                document.getElementById('apiFormTitle').textContent = 'Editar API';
                document.getElementById('apiFormTriggerId').value = triggerId;
                document.getElementById('apiFormId').value = apiId;
                document.getElementById('apiName').value = api.name;
                document.getElementById('apiEndpoint').value = api.endpoint;
                document.getElementById('apiFormModal').style.display = 'flex';
            }
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error al cargar la API');
    }
}

// Cerrar formulario de API
function closeApiForm() {
    document.getElementById('apiFormModal').style.display = 'none';
}

// Guardar API
async function saveApi(event) {
    event.preventDefault();
    
    const triggerId = document.getElementById('apiFormTriggerId').value;
    const apiId = document.getElementById('apiFormId').value;
    const name = document.getElementById('apiName').value.trim();
    const endpoint = document.getElementById('apiEndpoint').value.trim();
    
    try {
        let response;
        if (apiId) {
            // Actualizar
            response = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis/${apiId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, endpoint })
            });
        } else {
            // Crear
            response = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, endpoint })
            });
        }
        
        const data = await response.json();
        
        if (data.success) {
            showSuccess(apiId ? 'API actualizada correctamente' : 'API creada correctamente');
            closeApiForm();
            await loadApis(triggerId);
        } else {
            showError(data.error || 'Error al guardar la API');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Eliminar API
async function deleteApi(triggerId, apiId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis`);
        const data = await response.json();
        const api = data.success && data.apis.find(a => a.id === apiId);
        const apiName = api ? api.name : apiId;
        
        if (!confirm(`¿Estás seguro de que deseas eliminar la API "${apiName}"?`)) {
            return;
        }
        
        const deleteResponse = await fetch(`${API_BASE}/api/triggers/${triggerId}/apis/${apiId}`, {
            method: 'DELETE'
        });
        
        const deleteData = await deleteResponse.json();
        
        if (deleteData.success) {
            showSuccess('API eliminada correctamente');
            await loadApis(triggerId);
        } else {
            showError(deleteData.error || 'Error al eliminar la API');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// ========== GESTIÓN DE PREFIJOS TCODE Y TAGS ==========
let selectedPrefixes = new Set(); // Prefijos seleccionados en el modal
let currentTriggerTags = []; // Tags actuales del trigger seleccionado

// Abrir modal de prefijos
async function openPrefixModal() {
    if (!currentSelectedTriggerId) {
        showError('Por favor selecciona un trigger primero');
        return;
    }
    
    // Cargar tags actuales del trigger
    await loadTriggerTags(currentSelectedTriggerId);
    
    // Cargar tablas actuales de la base de datos (nombres reales actuales)
    try {
        const response = await fetch(`${API_BASE}/api/current-tables`);
        const data = await response.json();
        
        if (data.success && data.tables) {
            // Usar las tablas actuales en lugar de los prefijos estáticos
            renderPrefixes(data.tables);
            // Marcar como seleccionados los tags que ya están en el trigger
            selectedPrefixes.clear();
            currentTriggerTags.forEach(tag => {
                if (data.tables.includes(tag)) {
                    selectedPrefixes.add(tag);
                }
            });
            updatePrefixCheckboxes();
            document.getElementById('prefixModal').style.display = 'flex';
        } else {
            // Fallback a prefijos estáticos si falla
            const fallbackResponse = await fetch(`${API_BASE}/api/tcode-prefixes`);
            const fallbackData = await fallbackResponse.json();
            if (fallbackData.success) {
                renderPrefixes(fallbackData.prefixes);
                selectedPrefixes.clear();
                currentTriggerTags.forEach(tag => {
                    if (fallbackData.prefixes.includes(tag)) {
                        selectedPrefixes.add(tag);
                    }
                });
                updatePrefixCheckboxes();
                document.getElementById('prefixModal').style.display = 'flex';
            } else {
                showError('Error al cargar las tablas actuales');
            }
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Cerrar modal de prefijos
function closePrefixModal() {
    document.getElementById('prefixModal').style.display = 'none';
    selectedPrefixes.clear();
}

// Renderizar lista de prefijos en el modal
function renderPrefixes(prefixes) {
    const prefixList = document.getElementById('prefixList');
    prefixList.innerHTML = '';
    
    prefixes.forEach(prefix => {
        const prefixItem = document.createElement('div');
        prefixItem.className = 'prefix-item';
        prefixItem.innerHTML = `
            <input type="checkbox" id="prefix_${prefix}" value="${prefix}" 
                   onchange="togglePrefix('${prefix}')">
            <label for="prefix_${prefix}">${prefix}</label>
        `;
        prefixList.appendChild(prefixItem);
    });
}

// Actualizar checkboxes según selección
function updatePrefixCheckboxes() {
    selectedPrefixes.forEach(prefix => {
        const checkbox = document.getElementById(`prefix_${prefix}`);
        if (checkbox) {
            checkbox.checked = true;
            checkbox.closest('.prefix-item').classList.add('selected');
        }
    });
}

// Toggle de selección de prefijo
function togglePrefix(prefix) {
    const checkbox = document.getElementById(`prefix_${prefix}`);
    const prefixItem = checkbox.closest('.prefix-item');
    
    if (checkbox.checked) {
        selectedPrefixes.add(prefix);
        prefixItem.classList.add('selected');
    } else {
        selectedPrefixes.delete(prefix);
        prefixItem.classList.remove('selected');
    }
}

// Aplicar prefijos seleccionados como tags al trigger
async function applySelectedPrefixes() {
    if (!currentSelectedTriggerId) {
        showError('No hay trigger seleccionado');
        return;
    }
    
    try {
        // Obtener trigger actual
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (!data.success || !data.triggers[currentSelectedTriggerId]) {
            showError('Error al obtener el trigger');
            return;
        }
        
        const trigger = data.triggers[currentSelectedTriggerId];
        
        // Actualizar tags del trigger con los prefijos seleccionados
        const tags = Array.from(selectedPrefixes);
        
        // Actualizar trigger con los nuevos tags
        const updateResponse = await fetch(`${API_BASE}/api/triggers/${currentSelectedTriggerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: trigger.name,
                description: trigger.description || '',
                tags: tags
            })
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.success) {
            showSuccess('Prefijos aplicados correctamente como tags');
            closePrefixModal();
            await loadTriggerTags(currentSelectedTriggerId);
        } else {
            showError(updateData.error || 'Error al aplicar los prefijos');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// Cargar tags del trigger
async function loadTriggerTags(triggerId) {
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (data.success && data.triggers[triggerId]) {
            const trigger = data.triggers[triggerId];
            currentTriggerTags = trigger.tags || [];
            renderTriggerTags(currentTriggerTags);
        }
    } catch (error) {
        console.error('Error:', error);
        currentTriggerTags = [];
        renderTriggerTags([]);
    }
}

// Renderizar tags del trigger
function renderTriggerTags(tags) {
    const tagsContainer = document.getElementById('triggerTags');
    tagsContainer.innerHTML = '';
    
    if (tags.length === 0) {
        tagsContainer.innerHTML = '<span style="color: var(--text-secondary); font-style: italic;">No hay tags. Usa el botón "Prefijos" para agregar tags.</span>';
        return;
    }
    
    tags.forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.className = 'trigger-tag';
        tagElement.innerHTML = `
            <span>${tag}</span>
            <span class="tag-remove" onclick="removeTag('${tag}')">×</span>
        `;
        tagsContainer.appendChild(tagElement);
    });
}

// Eliminar un tag del trigger
async function removeTag(tag) {
    if (!currentSelectedTriggerId) {
        return;
    }
    
    if (!confirm(`¿Estás seguro de que deseas eliminar el tag "${tag}"?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (!data.success || !data.triggers[currentSelectedTriggerId]) {
            showError('Error al obtener el trigger');
            return;
        }
        
        const trigger = data.triggers[currentSelectedTriggerId];
        const tags = (trigger.tags || []).filter(t => t !== tag);
        
        const updateResponse = await fetch(`${API_BASE}/api/triggers/${currentSelectedTriggerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: trigger.name,
                description: trigger.description || '',
                tags: tags
            })
        });
        
        const updateData = await updateResponse.json();
        
        if (updateData.success) {
            showSuccess('Tag eliminado correctamente');
            await loadTriggerTags(currentSelectedTriggerId);
        } else {
            showError(updateData.error || 'Error al eliminar el tag');
        }
    } catch (error) {
        console.error('Error:', error);
        showError('Error de conexión con el servidor');
    }
}

// ========== EJECUCIÓN DE TRIGGERS Y APIs ==========
let isExecuting = false;
let executionCancelled = false;

// Ejecutar todos los triggers y sus APIs
async function executeAllTriggers() {
    if (isExecuting) {
        showError('Ya hay una ejecución en curso');
        return;
    }
    
    if (!confirm('¿Estás seguro de que deseas ejecutar todos los triggers y sus APIs?')) {
        return;
    }
    
    isExecuting = true;
    executionCancelled = false;
    
    // Mostrar área de progreso
    document.getElementById('executionProgress').style.display = 'block';
    document.getElementById('triggerManagerSplit').style.display = 'none';
    document.getElementById('executionLog').innerHTML = '';
    document.getElementById('progressBar').style.width = '0%';
    document.getElementById('executeTriggersBtn').disabled = true;
    
    try {
        // Obtener todos los triggers
        const response = await fetch(`${API_BASE}/api/triggers`);
        const data = await response.json();
        
        if (!data.success) {
            throw new Error('Error al cargar los triggers');
        }
        
        const triggers = data.triggers || {};
        const triggerArray = Object.values(triggers);
        
        if (triggerArray.length === 0) {
            addExecutionLog('⚠️ No hay triggers para ejecutar', 'warning');
            stopExecution();
            return;
        }
        
        let totalApis = 0;
        let completedApis = 0;
        
        // Contar total de APIs
        for (const trigger of triggerArray) {
            totalApis += (trigger.apis || []).length;
        }
        
        if (totalApis === 0) {
            addExecutionLog('⚠️ No hay APIs para ejecutar', 'warning');
            stopExecution();
            return;
        }
        
        addExecutionLog(`📋 Iniciando ejecución: ${triggerArray.length} trigger(s), ${totalApis} API(s)`, 'info');
        
        // Ejecutar cada trigger secuencialmente
        for (let i = 0; i < triggerArray.length; i++) {
            if (executionCancelled) {
                addExecutionLog('⏹️ Ejecución cancelada por el usuario', 'error');
                break;
            }
            
            const trigger = triggerArray[i];
            addExecutionLog(`\n🔧 [${i + 1}/${triggerArray.length}] Ejecutando trigger: ${trigger.name}`, 'trigger');
            
            const apis = trigger.apis || [];
            
            if (apis.length === 0) {
                addExecutionLog(`   ⚠️ Trigger "${trigger.name}" no tiene APIs`, 'warning');
                continue;
            }
            
            // Ejecutar cada API del trigger secuencialmente
            for (let j = 0; j < apis.length; j++) {
                if (executionCancelled) {
                    addExecutionLog('⏹️ Ejecución cancelada por el usuario', 'error');
                    break;
                }
                
                const api = apis[j];
                addExecutionLog(`   🔌 [${j + 1}/${apis.length}] Ejecutando API: ${api.name} (${api.endpoint})`, 'api');
                
                try {
                    // Ejecutar la API
                    const apiResponse = await executeApi(api.endpoint);
                    
                    if (apiResponse.status === 200) {
                        completedApis++;
                        addExecutionLog(`      ✅ Éxito (${apiResponse.status})`, 'success');
                    } else {
                        const statusText = apiResponse.statusText || 'Error desconocido';
                        addExecutionLog(`      ❌ Error: Respuesta ${apiResponse.status} - ${statusText}`, 'error');
                        // Detener ejecución si no es 200
                        addExecutionLog(`      ⏹️ Deteniendo ejecución debido a error en API`, 'error');
                        stopExecution();
                        return;
                    }
                } catch (error) {
                    let errorMsg = error.message || 'Error desconocido';
                    if (error.code) {
                        errorMsg += ` (Código: ${error.code})`;
                    }
                    addExecutionLog(`      ❌ Error: ${errorMsg}`, 'error');
                    // Detener ejecución si hay error
                    addExecutionLog(`      ⏹️ Deteniendo ejecución debido a error`, 'error');
                    stopExecution();
                    return;
                }
                
                // Actualizar barra de progreso
                const progress = (completedApis / totalApis) * 100;
                document.getElementById('progressBar').style.width = `${progress}%`;
            }
        }
        
        if (!executionCancelled) {
            addExecutionLog(`\n✅ Ejecución completada: ${completedApis}/${totalApis} APIs ejecutadas exitosamente`, 'success');
            document.getElementById('progressBar').style.width = '100%';
        }
        
    } catch (error) {
        console.error('Error:', error);
        addExecutionLog(`❌ Error general: ${error.message}`, 'error');
    } finally {
        isExecuting = false;
        document.getElementById('executeTriggersBtn').disabled = false;
        document.getElementById('stopExecutionBtn').style.display = 'none';
        document.getElementById('backToManagerBtn').style.display = 'inline-block';
    }
}

// Ejecutar una API individual
async function executeApi(endpoint) {
    // Normalizar el endpoint
    let url = endpoint.trim();
    
    // Si es una ruta relativa (sin http:// o https://), ejecutarla directamente desde el navegador
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.startsWith('/')) {
            url = `${window.location.origin}${url}`;
        } else {
            url = `${window.location.origin}/${url}`;
        }
        
        // Para rutas relativas, usar fetch directo
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            return {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok
            };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Timeout: La API no respondió en 30 segundos');
            }
            throw error;
        }
    }
    
    // Para URLs externas, usar el endpoint del backend para evitar CORS
    try {
        const response = await fetch(`${API_BASE}/api/execute-api`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ endpoint: url })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            const error = new Error(data.error || `Error: ${data.status || 'Error desconocido'}`);
            if (data.code) {
                error.code = data.code;
            }
            throw error;
        }
        
        return {
            status: data.status,
            statusText: data.statusText || 'OK',
            ok: data.status >= 200 && data.status < 300
        };
    } catch (error) {
        // Si el error ya tiene un mensaje, lanzarlo tal cual
        if (error.message) {
            throw error;
        }
        // Si no, crear un error más descriptivo
        throw new Error(`Error al ejecutar API: ${error.message || 'Error desconocido'}`);
    }
}

// Agregar log de ejecución
// Mostrar vista de ejecución automática cuando se ejecuta un trigger desde el monitoreo
function showAutoExecutionView(data) {
    // Asegurar que el modal del trigger manager esté abierto
    const modal = document.getElementById('triggerManagerModal');
    if (modal.style.display === 'none') {
        modal.style.display = 'flex';
    }
    
    // Ocultar la vista normal y mostrar la vista de ejecución
    document.getElementById('executionProgress').style.display = 'block';
    document.getElementById('triggerManagerSplit').style.display = 'none';
    document.getElementById('stopExecutionBtn').style.display = 'none';
    document.getElementById('backToManagerBtn').style.display = 'block';
    
    // Limpiar logs anteriores
    const executionLog = document.getElementById('executionLog');
    executionLog.innerHTML = '';
    
    // Agregar mensaje inicial
    addExecutionLog(`🔄 Ejecución Automática Iniciada`, 'info');
    addExecutionLog(`📊 Tabla: ${data.tableName} (${data.changeType})`, 'info');
    if (data.renameInfo) {
        addExecutionLog(`🔄 Renombrado: ${data.renameInfo.oldName} → ${data.renameInfo.newName}`, 'info');
    }
    addExecutionLog(`📋 Total de triggers: ${data.totalTriggers}`, 'info');
    addExecutionLog('', 'info'); // Línea en blanco
    
    // Resetear barra de progreso
    updateProgressBar(0);
    
    // Marcar que está ejecutando automáticamente
    isExecuting = true;
    executionCancelled = false;
}

// Actualizar barra de progreso
function updateProgressBar(percentage) {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    }
}

function addExecutionLog(message, type = 'info') {
    const log = document.getElementById('executionLog');
    if (!log) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `execution-log-entry execution-log-${type}`;
    logEntry.textContent = message;
    log.appendChild(logEntry);
    log.scrollTop = log.scrollHeight;
}

// Detener ejecución
function stopExecution() {
    executionCancelled = true;
    isExecuting = false;
    document.getElementById('executeTriggersBtn').disabled = false;
    document.getElementById('stopExecutionBtn').style.display = 'none';
    document.getElementById('backToManagerBtn').style.display = 'inline-block';
    addExecutionLog('⏹️ Ejecución detenida', 'warning');
}

// Restaurar vista normal después de ejecución
function restoreTriggerManagerView() {
    document.getElementById('executionProgress').style.display = 'none';
    document.getElementById('triggerManagerSplit').style.display = 'grid';
    document.getElementById('stopExecutionBtn').style.display = 'inline-block';
    document.getElementById('backToManagerBtn').style.display = 'none';
}

// ========== MONITOREO DE CAMBIOS DE TABLAS CON SOCKET.IO ==========
let socket = null;
let notificationCounter = 0;
let tableChangesHistory = [];
const MAX_HISTORY_ITEMS = 50; // Máximo de cambios en el historial

// Conectar a Socket.IO
function initSocketConnection() {
    try {
        socket = io();
        
        socket.on('connect', () => {
            console.log('[SOCKET] Conectado al servidor');
        });
        
        socket.on('disconnect', () => {
            console.log('[SOCKET] Desconectado del servidor');
        });
        
        socket.on('monitor_status', (status) => {
            console.log('[SOCKET] Estado del monitoreo:', status);
        });
        
        // Escuchar cambios de tablas
        socket.on('table_change', (notification) => {
            console.log('[SOCKET] Cambio de tabla detectado:', notification);
            showTableChangeNotification(notification);
            addToTableChangesHistory(notification);
        });
        
        // Escuchar inicio de ejecución automática de triggers
        socket.on('trigger_auto_execution_start', (data) => {
            console.log('[SOCKET] Inicio de ejecución automática:', data);
            // Abrir el modal de trigger manager si no está abierto
            if (document.getElementById('triggerManagerModal').style.display === 'none') {
                showTriggerManager();
            }
            // Mostrar vista de ejecución automáticamente
            showAutoExecutionView(data);
        });
        
        // Escuchar ejecución de trigger individual
        socket.on('trigger_auto_execution_trigger', (data) => {
            console.log('[SOCKET] Ejecutando trigger:', data);
            addExecutionLog(`🔧 [${data.triggerIndex}/${data.totalTriggers}] Ejecutando trigger: ${data.triggerName}`, 'trigger');
        });
        
        // Escutar ejecución de API
        socket.on('trigger_auto_execution_api', (data) => {
            console.log('[SOCKET] Ejecutando API:', data);
            addExecutionLog(`🔌 [${data.apiIndex}/${data.totalApis}] Ejecutando API: ${data.apiName} (${data.endpoint})`, 'api');
        });
        
        // Escuchar resultado de API
        socket.on('trigger_auto_execution_api_result', (data) => {
            console.log('[SOCKET] Resultado de API:', data);
            if (data.success) {
                addExecutionLog(`✅ Éxito (${data.status})`, 'success');
            } else {
                addExecutionLog(`❌ Error: ${data.error}`, 'error');
            }
        });
        
        // Escuchar finalización de trigger
        socket.on('trigger_auto_execution_trigger_complete', (data) => {
            console.log('[SOCKET] Trigger completado:', data);
            addExecutionLog(`✅ Trigger "${data.triggerName}" completado`, 'success');
        });
        
        // Escuchar finalización de ejecución automática
        socket.on('trigger_auto_execution_complete', (data) => {
            console.log('[SOCKET] Ejecución automática completada:', data);
            addExecutionLog(`✅ Ejecución automática completada: ${data.totalTriggers} trigger(s) ejecutado(s)`, 'success');
            // Actualizar barra de progreso al 100%
            updateProgressBar(100);
        });
        
    } catch (error) {
        console.error('[SOCKET] Error al conectar:', error);
    }
}

// Mostrar notificación de cambio de tabla
function showTableChangeNotification(notification) {
    const container = document.getElementById('notificationsContainer');
    if (!container) return;
    
    notificationCounter++;
    const notificationId = `notification-${notificationCounter}`;
    
    const notificationDiv = document.createElement('div');
    notificationDiv.id = notificationId;
    notificationDiv.className = `notification ${notification.changeType}`;
    
    let title = '';
    let icon = '';
    let body = '';
    
    switch (notification.changeType) {
        case 'added':
            title = '📊 Nueva Tabla Agregada';
            icon = '➕';
            body = `
                <div class="notification-body">
                    <strong>Tabla:</strong> <code>${notification.data.table}</code>
                    <div class="notification-time">Total de tablas: ${notification.data.totalTables}</div>
                </div>
            `;
            break;
        case 'removed':
            title = '🗑️ Tabla Eliminada';
            icon = '➖';
            body = `
                <div class="notification-body">
                    <strong>Tabla:</strong> <code>${notification.data.table}</code>
                    <div class="notification-time">Total de tablas: ${notification.data.totalTables}</div>
                </div>
            `;
            break;
        case 'renamed':
            title = '🔄 Tabla Renombrada';
            icon = '🔄';
            body = `
                <div class="notification-body">
                    <div><strong>Antes:</strong> <code>${notification.data.oldName}</code></div>
                    <div><strong>Ahora:</strong> <code>${notification.data.newName}</code></div>
                    <div class="notification-time">TCODE: ${notification.data.tcodeBase} | Total: ${notification.data.totalTables}</div>
                </div>
            `;
            break;
        case 'multiple':
            title = '🔄 Múltiples Cambios Detectados';
            icon = '🔄';
            const addedList = notification.data.added.map(t => `<li>➕ ${t}</li>`).join('');
            const removedList = notification.data.removed.map(t => `<li>➖ ${t}</li>`).join('');
            const renamedList = (notification.data.renamed || []).map(r => `<li>🔄 ${r.oldName} → ${r.newName}</li>`).join('');
            body = `
                <div class="notification-body">
                    <div class="notification-table-list">
                        ${addedList ? `<div><strong>Agregadas:</strong><ul>${addedList}</ul></div>` : ''}
                        ${removedList ? `<div><strong>Eliminadas:</strong><ul>${removedList}</ul></div>` : ''}
                        ${renamedList ? `<div><strong>Renombradas:</strong><ul>${renamedList}</ul></div>` : ''}
                    </div>
                    <div class="notification-time">Total de tablas: ${notification.data.totalTables}</div>
                </div>
            `;
            break;
        default:
            title = '📊 Cambio en Tablas';
            body = `<div class="notification-body">${JSON.stringify(notification.data)}</div>`;
    }
    
    notificationDiv.innerHTML = `
        <div class="notification-header">
            <div class="notification-title">
                <span>${icon}</span>
                <span>${title}</span>
            </div>
            <button class="notification-close" onclick="closeNotification('${notificationId}')">×</button>
        </div>
        ${body}
    `;
    
    container.appendChild(notificationDiv);
    
    // Auto-cerrar después de 10 segundos
    setTimeout(() => {
        closeNotification(notificationId);
    }, 10000);
    
    // Sonido de notificación (opcional)
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OSdTgwOUKjk8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUqgc7y2Yk2CBtpvfDknU4MDlCo5PC2YxwGOJHX8sx5LAUkd8fw3ZBAC');
        audio.volume = 0.3;
        audio.play().catch(() => {}); // Ignorar errores de audio
    } catch (e) {
        // Ignorar errores de audio
    }
}

// Cerrar notificación
function closeNotification(notificationId) {
    const notification = document.getElementById(notificationId);
    if (!notification) return;
    
    notification.classList.add('hiding');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

// Agregar cambio al historial del panel
function addToTableChangesHistory(notification) {
    // Agregar al inicio del array
    tableChangesHistory.unshift({
        id: Date.now(),
        ...notification
    });
    
    // Limitar el tamaño del historial
    if (tableChangesHistory.length > MAX_HISTORY_ITEMS) {
        tableChangesHistory = tableChangesHistory.slice(0, MAX_HISTORY_ITEMS);
    }
    
    // Actualizar la vista
    renderTableChangesHistory();
    updateTableChangesCount();
}

// Renderizar el historial de cambios
function renderTableChangesHistory() {
    const list = document.getElementById('tableChangesList');
    if (!list) return;
    
    if (tableChangesHistory.length === 0) {
        list.innerHTML = '<div class="table-changes-empty">No hay cambios registrados aún</div>';
        return;
    }
    
    list.innerHTML = tableChangesHistory.map(change => {
        let typeLabel = '';
        let icon = '';
        let tablesHtml = '';
        
        switch (change.changeType) {
            case 'added':
                typeLabel = 'Tabla Agregada';
                icon = '➕';
                tablesHtml = `<div class="table-change-tables"><code>${change.data.table}</code></div>`;
                break;
            case 'removed':
                typeLabel = 'Tabla Eliminada';
                icon = '➖';
                tablesHtml = `<div class="table-change-tables"><code>${change.data.table}</code></div>`;
                break;
            case 'renamed':
                typeLabel = 'Tabla Renombrada';
                icon = '🔄';
                tablesHtml = `
                    <div class="table-change-tables">
                        <div><strong>Antes:</strong> <code>${change.data.oldName}</code></div>
                        <div><strong>Ahora:</strong> <code>${change.data.newName}</code></div>
                        <div style="margin-top: 4px; font-size: 0.8rem; opacity: 0.7;">TCODE: ${change.data.tcodeBase}</div>
                    </div>
                `;
                break;
            case 'multiple':
                typeLabel = 'Múltiples Cambios';
                icon = '🔄';
                const addedList = change.data.added.map(t => `<li>➕ <code>${t}</code></li>`).join('');
                const removedList = change.data.removed.map(t => `<li>➖ <code>${t}</code></li>`).join('');
                const renamedList = (change.data.renamed || []).map(r => `<li>🔄 <code>${r.oldName}</code> → <code>${r.newName}</code></li>`).join('');
                tablesHtml = `
                    <div class="table-change-tables">
                        ${addedList ? `<div><strong>Agregadas:</strong><ul>${addedList}</ul></div>` : ''}
                        ${removedList ? `<div><strong>Eliminadas:</strong><ul>${removedList}</ul></div>` : ''}
                        ${renamedList ? `<div><strong>Renombradas:</strong><ul>${renamedList}</ul></div>` : ''}
                    </div>
                `;
                break;
            default:
                typeLabel = 'Cambio Detectado';
                icon = '📊';
                tablesHtml = `<div class="table-change-tables">${JSON.stringify(change.data)}</div>`;
        }
        
        const time = new Date(change.timestamp).toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        return `
            <div class="table-change-item ${change.changeType}" id="change-${change.id}">
                <div class="table-change-content">
                    <div class="table-change-type">
                        <span>${icon}</span>
                        <span>${typeLabel}</span>
                    </div>
                    ${tablesHtml}
                    <div class="table-change-time">${time}</div>
                </div>
                <button class="table-change-remove" onclick="removeTableChange(${change.id})" title="Eliminar">×</button>
            </div>
        `;
    }).join('');
}

// Actualizar contador de cambios
function updateTableChangesCount() {
    const countEl = document.getElementById('tableChangesCount');
    if (countEl) {
        countEl.textContent = tableChangesHistory.length;
    }
}

// Toggle del panel (expandir/colapsar)
function toggleTableChangesPanel() {
    const panel = document.getElementById('tableChangesPanel');
    const body = document.getElementById('tableChangesBody');
    const toggle = document.getElementById('tableChangesToggle');
    
    if (!panel || !body || !toggle) return;
    
    const isExpanded = body.style.display !== 'none';
    
    if (isExpanded) {
        body.style.display = 'none';
        panel.classList.remove('expanded');
        toggle.textContent = '▼';
    } else {
        body.style.display = 'block';
        panel.classList.add('expanded');
        toggle.textContent = '▲';
    }
}

// Limpiar historial de cambios
function clearTableChangesHistory() {
    if (tableChangesHistory.length === 0) return;
    
    if (!confirm(`¿Estás seguro de que deseas eliminar todos los ${tableChangesHistory.length} cambios del historial?`)) {
        return;
    }
    
    tableChangesHistory = [];
    renderTableChangesHistory();
    updateTableChangesCount();
}

// Eliminar un cambio específico del historial
function removeTableChange(changeId) {
    tableChangesHistory = tableChangesHistory.filter(change => change.id !== changeId);
    renderTableChangesHistory();
    updateTableChangesCount();
}

// Inicializar conexión Socket.IO cuando se carga la página
if (typeof io !== 'undefined') {
    initSocketConnection();
} else {
    // Esperar a que Socket.IO se cargue
    window.addEventListener('load', () => {
        if (typeof io !== 'undefined') {
            initSocketConnection();
        }
    });
}

// Inicializar el panel cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    updateTableChangesCount();
    renderTableChangesHistory();
});



